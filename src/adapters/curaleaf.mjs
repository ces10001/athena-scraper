import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

async function extractProductsFromCurrentPage(page) {
  return await page.evaluate(function() {
    var results = [];
    var seen = {};
    var links = document.querySelectorAll('a[href*="/menu/"]');

    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute('href') || '';
      var idMatch = href.match(/-(\d+)(?:\?|$)/);
      if (!idMatch) continue;
      var productId = idMatch[1];
      if (seen[productId]) continue;
      seen[productId] = true;

      var catMatch = href.match(/\/menu\/([a-z-]+)-\d+\//);
      var category = catMatch ? catMatch[1] : 'other';

      var text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 5) continue;

      var strainMatch = text.match(/\b(Sativa|Indica|Hybrid)\b/i);
      var strain = strainMatch ? strainMatch[1] : null;
      var thcMatch = text.match(/THC:\s*(\d+\.?\d*)%?/);
      var cbdMatch = text.match(/CBD:\s*(\d+\.?\d*)%?/);
      var thcMgMatch = text.match(/THC:\s*(\d+\.?\d*)\s*MG/i);
      var prices = text.match(/\$(\d+\.?\d*)/g) || [];
      var discountMatch = text.match(/(\d+)%\s*Off/i);
      var weightMatch = text.match(/\b(\d+\.?\d*)\s*g\b(?!\s*ea)/i) ||
                        text.match(/\b(\d+)\s*mg\s*$/im) ||
                        text.match(/(\d+-Pack)/i);

      var brandMatch = text.match(/by\s+([A-Za-z][A-Za-z\s.!'&]+?)(?=[A-Z][a-z]{2,})/);
      if (!brandMatch) brandMatch = text.match(/by\s+([A-Za-z][A-Za-z\s.!'&]+?)(?=THC|CBD|\$|\d+%)/);
      var brand = brandMatch ? brandMatch[1].trim() : null;

      var name = '';
      if (brand) {
        var brandIdx = text.indexOf(brand);
        var afterBrand = brandIdx + brand.length;
        var thcIdx = text.indexOf('THC:');
        var cbdIdx = text.indexOf('CBD:');
        var priceIdx = text.indexOf('$');
        var endPoints = [thcIdx, cbdIdx, priceIdx].filter(function(x) { return x > afterBrand; });
        var endIdx = endPoints.length > 0 ? Math.min.apply(null, endPoints) : text.length;
        name = text.substring(afterBrand, endIdx).trim();
        name = name.replace(/\b\d+\.?\d*\s*g\b/gi, '').replace(/\b\d+mg\b/gi, '').trim();
        name = name.replace(/^\d+\s*/, '').replace(/\s*\d+$/, '').trim();
      }
      if (!name || name.length < 2) {
        var slugMatch = href.match(/\/menu\/[^/]+\/[a-z-]+-[a-z]+-(.+?)-\d+(?:\?|$)/);
        if (slugMatch) {
          name = slugMatch[1].replace(/-/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
        }
      }

      var salePrice = null;
      var originalPrice = null;
      if (prices.length >= 2) {
        var p1 = parseFloat(prices[0].replace('$', ''));
        var p2 = parseFloat(prices[1].replace('$', ''));
        if (p1 < p2) { salePrice = p1; originalPrice = p2; }
        else { salePrice = p1; }
      } else if (prices.length === 1) {
        salePrice = parseFloat(prices[0].replace('$', ''));
      }

      if (!salePrice && !name) continue;

      results.push({
        external_id: 'curaleaf-' + productId,
        name: name || 'Unknown Product',
        brand: brand || '',
        category: category,
        strain_type: strain ? strain.toLowerCase() : null,
        thc_pct: thcMatch ? parseFloat(thcMatch[1]) : (thcMgMatch ? parseFloat(thcMgMatch[1]) : null),
        cbd_pct: cbdMatch ? parseFloat(cbdMatch[1]) : null,
        price: salePrice,
        original_price: (originalPrice && originalPrice > salePrice) ? originalPrice : null,
        weight_label: weightMatch ? weightMatch[0] : null,
        deal_description: discountMatch ? discountMatch[1] + '% Off' : (originalPrice ? 'Sale' : null),
      });
    }

    var pageLinks = document.querySelectorAll('a[href*="page="]');
    var maxPage = 1;
    for (var k = 0; k < pageLinks.length; k++) {
      var pm = (pageLinks[k].getAttribute('href') || '').match(/page=(\d+)/);
      if (pm) { var pn = parseInt(pm[1]); if (pn > maxPage) maxPage = pn; }
    }

    return { products: results, maxPage: maxPage };
  });
}

function normalizeCuraleafProduct(raw) {
  var normalized = normalizeProduct({
    external_id: raw.external_id,
    name: raw.name || '',
    brand: raw.brand || '',
    category: raw.category || '',
    subcategory: null,
    strain_type: raw.strain_type || null,
    price: raw.price,
    original_price: raw.original_price,
    weight_label: raw.weight_label || null,
    thc_pct: raw.thc_pct,
    cbd_pct: raw.cbd_pct,
    in_stock: true,
    deal_description: raw.deal_description || null,
    image_url: null,
    product_url: null,
  });
  normalized.category = (raw.category || '').toLowerCase();
  return normalized;
}

export async function scrapeCuraleaf(dispensary) {
  console.log('[curaleaf] Scraping: ' + dispensary.name);

  if (!dispensary.store_slug) {
    console.error('  [curaleaf] No store_slug for ' + dispensary.name);
    return { products: [], errors: ['No store_slug configured'] };
  }

  try {
    var { chromium } = await import('playwright');
    var browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });

    var allProducts = new Map();
    var errors = [];
    var menuTypes = dispensary.menu_types || ['recreational'];

    for (var m = 0; m < menuTypes.length; m++) {
      var menuType = menuTypes[m];
      var baseUrl = 'https://ct.curaleaf.com/shop/connecticut/' + dispensary.store_slug + '/' + menuType + '/menu';

      try {
        var page = await context.newPage();
        await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(2000);

        var firstResult = await extractProductsFromCurrentPage(page);
        var maxPage = firstResult.maxPage || 1;
        var pageProducts = firstResult.products || [];

        console.log('  [curaleaf] ' + menuType + ' page 1: ' + pageProducts.length + ' products, ' + maxPage + ' total pages');

        for (var p = 0; p < pageProducts.length; p++) {
          var id = pageProducts[p].external_id;
          if (!allProducts.has(id)) allProducts.set(id, pageProducts[p]);
        }
        await page.close();

        for (var pg = 2; pg <= maxPage; pg++) {
          var pageUrl = baseUrl + '?page=' + pg;
          var nextPage = await context.newPage();
          try {
            await nextPage.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });
            await nextPage.waitForTimeout(1500);
            var pgResult = await extractProductsFromCurrentPage(nextPage);
            var pgProducts = pgResult.products || [];
            for (var pp = 0; pp < pgProducts.length; pp++) {
              var pid = pgProducts[pp].external_id;
              if (!allProducts.has(pid)) allProducts.set(pid, pgProducts[pp]);
            }
            if (pg % 5 === 0 || pg === maxPage) {
              console.log('  [curaleaf] ' + menuType + ' page ' + pg + '/' + maxPage + ': ' + allProducts.size + ' total so far');
            }
          } catch (pgErr) {
            console.warn('  [curaleaf] Page ' + pg + ' failed: ' + pgErr.message);
          } finally {
            await nextPage.close();
          }
          await new Promise(function(r) { setTimeout(r, 500); });
        }
      } catch (err) {
        errors.push(menuType + ': ' + err.message);
        console.error('  [curaleaf] ' + menuType + ' error: ' + err.message);
      }
    }

    await context.close();
    await browser.close();

    var validProducts = [];
    var catCounts = {};
    for (var [key, raw] of allProducts) {
      var cat = (raw.category || '').toLowerCase();
      if (cat === 'accessories' || cat === 'apparel') continue;
      var normalized = normalizeCuraleafProduct(raw);
      if (validateProduct(normalized).length === 0) {
        catCounts[normalized.category] = (catCounts[normalized.category] || 0) + 1;
        validProducts.push(normalized);
      }
    }

    var catInfo = Object.entries(catCounts).map(function(e) { return e[0] + ': ' + e[1]; }).join(', ');
    console.log('  [curaleaf] Categories: ' + catInfo);
    console.log('  [curaleaf] Done: ' + validProducts.length + ' valid products (from ' + allProducts.size + ' total)');
    return { products: validProducts, errors: errors };
  } catch (err) {
    console.error('  [curaleaf] FAILED: ' + err.message);
    return { products: [], errors: [err.message] };
  }
}

export default { scrapeCuraleaf };
