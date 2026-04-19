import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

async function scrapeStorePage(browser, url, storeName) {
  console.log('  [curaleaf] Loading: ' + url);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(3000);

    for (var i = 0; i < 30; i++) {
      await page.evaluate(function() { window.scrollBy(0, 800); });
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(2000);

    var products = await page.evaluate(function() {
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

        var strain = (text.match(/\b(Sativa|Indica|Hybrid)\b/i) || [])[1] || null;
        var thcMatch = text.match(/THC:\s*(\d+\.?\d*)%?/);
        var cbdMatch = text.match(/CBD:\s*(\d+\.?\d*)%?/);
        var prices = text.match(/\$(\d+\.?\d*)/g) || [];
        var discountMatch = text.match(/(\d+)%\s*Off/i);
        var weightMatch = text.match(/\b(\d+\.?\d*)\s*g\b/i) ||
                          text.match(/\b(\d+)\s*mg\b/i) ||
                          text.match(/(\d+-Pack)/i);

        var brandMatch = text.match(/by\s+([A-Za-z][A-Za-z\s.!']+?)(?:\s*[A-Z][a-z])/);
        var brand = brandMatch ? brandMatch[1].trim() : null;

        var name = '';
        if (brand) {
          var afterBrand = text.indexOf(brand) + brand.length;
          var beforeThc = text.indexOf('THC:');
          var beforePrice = text.indexOf('$');
          var endIdx = beforeThc > afterBrand ? beforeThc : (beforePrice > afterBrand ? beforePrice : text.length);
          name = text.substring(afterBrand, endIdx).trim();
        }
        if (!name) {
          var slugMatch = href.match(/\/menu\/[^/]+\/(.+?)-\d+(?:\?|$)/);
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
          else { salePrice = p1; originalPrice = p2 > 0 && p2 < p1 ? null : p2; }
        } else if (prices.length === 1) {
          salePrice = parseFloat(prices[0].replace('$', ''));
        }

        if (!salePrice && !name) continue;

        results.push({
          external_id: 'curaleaf-' + productId,
          name: name || 'Unknown',
          brand: brand || '',
          category: category,
          strain_type: strain ? strain.toLowerCase() : null,
          thc_pct: thcMatch ? parseFloat(thcMatch[1]) : null,
          cbd_pct: cbdMatch ? parseFloat(cbdMatch[1]) : null,
          price: salePrice,
          original_price: (originalPrice && originalPrice > salePrice) ? originalPrice : null,
          weight_label: weightMatch ? weightMatch[0] : null,
          deal_description: discountMatch ? discountMatch[1] + '% Off' : null,
        });
      }

      return results;
    });

    console.log('  [curaleaf] Extracted ' + products.length + ' products from DOM');
    return products;

  } catch (err) {
    console.error('  [curaleaf] Error on ' + url + ': ' + err.message);
    return [];
  } finally {
    await context.close();
  }
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

    var allProducts = new Map();
    var errors = [];
    var menuTypes = dispensary.menu_types || ['recreational'];

    for (var m = 0; m < menuTypes.length; m++) {
      var menuType = menuTypes[m];
      var url = 'https://ct.curaleaf.com/shop/connecticut/' + dispensary.store_slug + '/' + menuType;

      try {
        var products = await scrapeStorePage(browser, url, dispensary.name);

        for (var p = 0; p < products.length; p++) {
          var raw = products[p];
          var cat = (raw.category || '').toLowerCase();
          if (cat === 'accessories' || cat === 'apparel') continue;

          var normalized = normalizeCuraleafProduct(raw);
          if (validateProduct(normalized).length === 0) {
            var key = normalized.external_id;
            if (!allProducts.has(key)) {
              allProducts.set(key, normalized);
            }
          }
        }
      } catch (err) {
        errors.push(menuType + ': ' + err.message);
      }
    }

    await browser.close();

    var result = Array.from(allProducts.values());
    var catCounts = {};
    result.forEach(function(p) { catCounts[p.category] = (catCounts[p.category] || 0) + 1; });
    var catInfo = Object.entries(catCounts).map(function(e) { return e[0] + ': ' + e[1]; }).join(', ');
    console.log('  [curaleaf] Categories: ' + catInfo);
    console.log('  [curaleaf] Done: ' + result.length + ' valid products');
    return { products: result, errors: errors };

  } catch (err) {
    console.error('  [curaleaf] FAILED: ' + err.message);
    return { products: [], errors: [err.message] };
  }
}

export default { scrapeCuraleaf };
