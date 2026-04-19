import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

async function extractProductsFromPage(page) {
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
      var thcMatch = text.match(/THC:\s*(\d+\.?\d*)%?/) || text.match(/THC\s*(\d+\.?\d*)%/);
      var cbdMatch = text.match(/CBD:\s*(\d+\.?\d*)%?/) || text.match(/CBD\s*(\d+\.?\d*)%/);
      var thcMgMatch = text.match(/THC:\s*(\d+\.?\d*)\s*MG/i);
      var prices = text.match(/\$(\d+\.?\d*)/g) || [];
      var discountMatch = text.match(/(\d+)%\s*Off/i);
      var weightMatch = text.match(/\b(\d+\.?\d*)\s*g\b(?!\s*ea)/i) ||
                        text.match(/\b(\d+)\s*mg\b/i) ||
                        text.match(/(\d+-Pack)/i);

      var priceWeightMatch = text.match(/\$(\d+\.?\d*)\/(\d+\.?\d*\s*(?:g|mg|ml|oz))/i);
      if (priceWeightMatch && !weightMatch) {
        weightMatch = [priceWeightMatch[2]];
      }

      var brandMatch = text.match(/by\s+([A-Za-z][A-Za-z\s.!'&]+?)(?=[A-Z][a-z]{2,})/);
      if (!brandMatch) brandMatch = text.match(/by\s+([A-Za-z][A-Za-z\s.!'&]+?)(?=THC|CBD|\$|\d+%)/);
      var brand = brandMatch ? brandMatch[1].trim() : null;

      if (!brand) {
        var ffMatch = text.match(/([A-Za-z][A-Za-z\s.:'!&]+?)\s*-\s*([^\n$]+?)\s*(C\d{7,})/);
        if (ffMatch) brand = ffMatch[1].trim();
      }

      var name = '';
      if (brand) {
        var brandIdx = text.indexOf(brand);
        var afterBrand = brandIdx + brand.length;
        var thcIdx = text.indexOf('THC');
        var cbdIdx = text.indexOf('CBD');
        var priceIdx = text.indexOf('$');
        var endPoints = [thcIdx, cbdIdx, priceIdx].filter(function(x) { return x > afterBrand; });
        var endIdx = endPoints.length > 0 ? Math.min.apply(null, endPoints) : text.length;
        name = text.substring(afterBrand, endIdx).trim();
        name = name.replace(/\b\d+\.?\d*\s*g\b/gi, '').replace(/\b\d+mg\b/gi, '').trim();
        name = name.replace(/^\d+\s*/, '').replace(/\s*\d+$/, '').trim();
        name = name.replace(/^-\s*/, '').trim();
      }
      if (!name || name.length < 2) {
        var slugMatch = href.match(/\/menu\/[^/]+\/[a-z-]+-[a-z]+-(.+?)-\d+(?:\?|$)/);
        if (slugMatch) {
          name = slugMatch[1].replace(/-/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
        }
      }

      var salePrice = null;
      var originalPrice = null;
      if (priceWeightMatch) {
        var allPW = text.match(/\$(\d+\.?\d*)\/\d+\.?\d*\s*(?:g|mg|ml|oz)/gi) || [];
        if (allPW.length >= 2) {
          var pw1 = parseFloat(allPW[0].match(/\$(\d+\.?\d*)/)[1]);
          var pw2 = parseFloat(allPW[1].match(/\$(\d+\.?\d*)/)[1]);
          if (pw1 < pw2) { salePrice = pw1; originalPrice = pw2; }
          else { salePrice = pw1; }
        } else {
          salePrice = parseFloat(priceWeightMatch[1]);
        }
      } else if (prices.length >= 2) {
        var p1 = parseFloat(prices[0].replace('$', ''));
        var p2 = parseFloat(prices[1].replace('$', ''));
        if (p1 < p2) { salePrice = p1; originalPrice = p2; }
        else { salePrice = p1; }
      } else if (prices.length === 1) {
        salePrice = parseFloat(prices[0].replace('$', ''));
      }

      if (!salePrice && !name) continue;

      results.push({
        external_id: 'sweed-' + productId,
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

function normalizeSweedProduct(raw) {
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

export async function scrapeSweed(dispensary) {
  console.log('[sweed] Scraping: ' + dispensary.name);

  if (!dispensary.sweed_urls || dispensary.sweed_urls.length === 0) {
    console.error('  [sweed] No sweed_urls for ' + dispensary.name);
    return { products: [], errors: ['No sweed_urls configured'] };
  }

  try {
    var { chromium } = await import('playwright');
    var browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });

    var allProducts = new Map();
    var errors = [];

    for (var u = 0; u < dispensary.sweed_urls.length; u++) {
      var menuUrl = dispensary.sweed_urls[u];

      try {
        var page = await context.newPage();
        await page.goto(menuUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(5000);

        var firstResult = await extractProductsFromPage(page);
        var maxPage = firstResult.maxPage || 1;
        var pageProducts = firstResult.products || [];

        var domain = menuUrl.replace(/https?:\/\//, '').split('/')[0];
        console.log('  [sweed] ' + domain + ' page 1: ' + pageProducts.length + ' products' + (maxPage > 1 ? ', ' + maxPage + ' pages' : ''));

        for (var p = 0; p < pageProducts.length; p++) {
          var key = pageProducts[p].external_id;
          if (!allProducts.has(key)) allProducts.set(key, pageProducts[p]);
        }
        await page.close();

        if (maxPage > 1) {
          for (var pg = 2; pg <= maxPage; pg++) {
            var sep = menuUrl.includes('?') ? '&' : '?';
            var pageUrl = menuUrl + sep + 'page=' + pg;
            var nextPage = await context.newPage();
            try {
              await nextPage.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
              await nextPage.waitForTimeout(4000);
              var pgResult = await extractProductsFromPage(nextPage);
              for (var pp = 0; pp < pgResult.products.length; pp++) {
                var pid = pgResult.products[pp].external_id;
                if (!allProducts.has(pid)) allProducts.set(pid, pgResult.products[pp]);
              }
              if (pg % 5 === 0 || pg === maxPage) {
                console.log('  [sweed] page ' + pg + '/' + maxPage + ': ' + allProducts.size + ' total');
              }
            } catch (pgErr) {
              console.warn('  [sweed] Page ' + pg + ' failed: ' + pgErr.message);
            } finally {
              await nextPage.close();
            }
            await new Promise(function(r) { setTimeout(r, 500); });
          }
        }
      } catch (err) {
        errors.push(menuUrl + ': ' + err.message);
        console.error('  [sweed] Error: ' + err.message);
      }
    }

    await context.close();
    await browser.close();

    var validProducts = [];
    var catCounts = {};
    for (var [key, raw] of allProducts) {
      var cat = (raw.category || '').toLowerCase();
      if (cat === 'accessories' || cat === 'apparel') continue;
      var normalized = normalizeSweedProduct(raw);
      if (validateProduct(normalized).length === 0) {
        catCounts[normalized.category] = (catCounts[normalized.category] || 0) + 1;
        validProducts.push(normalized);
      }
    }

    var catInfo = Object.entries(catCounts).map(function(e) { return e[0] + ': ' + e[1]; }).join(', ');
    console.log('  [sweed] Categories: ' + catInfo);
    console.log('  [sweed] Done: ' + validProducts.length + ' valid products');
    return { products: validProducts, errors: errors };
  } catch (err) {
    console.error('  [sweed] FAILED: ' + err.message);
    return { products: [], errors: [err.message] };
  }
}

export default { scrapeSweed };
