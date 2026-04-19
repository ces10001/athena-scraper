import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

function parseJaneProducts(text) {
  var products = [];
  var seen = {};
  var blocks = text.split('Add to bag');

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i].trim();
    if (block.length < 15) continue;
    if (block.includes('Gift Card') || block.includes('gift card')) continue;

    var strainMatch = block.match(/\b(Sativa|Indica|Hybrid)\b/i);
    var strain = strainMatch ? strainMatch[1].toLowerCase() : null;

    var thcMatch = block.match(/THC\s*(\d+\.?\d*)%?/);
    var cbdMatch = block.match(/CBD\s*(\d+\.?\d*)%?/);

    var priceWeightMatch = block.match(/\$(\d+\.?\d*)\/(\d+\.?\d*\s*(?:g|mg|ml|oz))/i);
    var plainPrice = block.match(/\$(\d+\.?\d*)/);

    var price = null;
    var weight = null;

    if (priceWeightMatch) {
      price = parseFloat(priceWeightMatch[1]);
      weight = priceWeightMatch[2].trim();
    } else if (plainPrice) {
      price = parseFloat(plainPrice[1]);
    }

    if (!price || price <= 0) continue;

    var brand = '';
    var name = '';

    var codeMatch = block.match(/(\d{4,6})\s*([A-Z][a-z])/);
    if (codeMatch) {
      var afterCode = block.indexOf(codeMatch[0]) + codeMatch[1].length;
      var remainder = block.substring(afterCode);
      var catKeywords = ['Flower', 'Pre Roll', 'Vape', 'Cartridge', 'Edible', 'Gummy', 'Gummies',
                         'Concentrate', 'Tincture', 'Topical', 'AIO Vape', 'Distillate',
                         'Ground Flower', 'Shorties', 'Pack Pre Roll', 'BRIQ', 'Disposable'];
      var brandEnd = remainder.length;
      for (var c = 0; c < catKeywords.length; c++) {
        var idx = remainder.indexOf(catKeywords[c]);
        if (idx > 0 && idx < brandEnd) brandEnd = idx;
      }
      brand = remainder.substring(0, brandEnd).trim();
    }

    if (codeMatch) {
      var beforeCode = block.indexOf(codeMatch[0]);
      var nameStart = 0;
      var strIdx = block.search(/\b(Sativa|Indica|Hybrid)\b/i);
      if (strIdx >= 0) nameStart = strIdx + block.match(/\b(Sativa|Indica|Hybrid)\b/i)[0].length;
      name = block.substring(nameStart, beforeCode + codeMatch[1].length).trim();
    }

    if (!name || name.length < 3) {
      var endIdx = Math.min(
        block.indexOf('THC') > 0 ? block.indexOf('THC') : 999,
        block.indexOf('$') > 0 ? block.indexOf('$') : 999,
        80
      );
      name = block.substring(0, endIdx).trim();
      name = name.replace(/^(Sativa|Indica|Hybrid)\s*/i, '').trim();
    }

    name = name.replace(/\s+/g, ' ').trim();
    if (name.length > 80) name = name.substring(0, 80).trim();

    var category = 'other';
    var catPatterns = [
      [/\bFlower\b/i, 'flower'],
      [/\bGround Flower\b/i, 'flower'],
      [/\bPre Roll|Pre-Roll|Shorties\b/i, 'pre-rolls'],
      [/\bVape|Cartridge|Cart|AIO|BRIQ|Disposable\b/i, 'vaporizers'],
      [/\bEdible|Gummy|Gummies|Chocolate|Confection\b/i, 'edible'],
      [/\bConcentrate|Rosin|Resin|Wax|Badder\b/i, 'concentrate'],
      [/\bTincture|Oil|Drops\b/i, 'tincture'],
      [/\bTopical|Balm|Cream\b/i, 'topical'],
    ];
    for (var cp = 0; cp < catPatterns.length; cp++) {
      if (catPatterns[cp][0].test(block)) { category = catPatterns[cp][1]; break; }
    }

    if (!weight) {
      var wMatch = block.match(/\((\d+\.?\d*)\s*[Gg]\)/);
      if (wMatch) weight = wMatch[1] + 'g';
    }

    var productCode = block.match(/\b(\d{5})\b/)?.[1] || block.match(/\b(\d{4,6})\b/)?.[1];
    var externalId = 'jane-' + (productCode || (name + price).replace(/[^a-z0-9]/gi, '').substring(0, 20));

    if (seen[externalId]) continue;
    seen[externalId] = true;

    products.push({
      external_id: externalId,
      name: name,
      brand: brand,
      category: category,
      strain_type: strain,
      thc_pct: thcMatch ? parseFloat(thcMatch[1]) : null,
      cbd_pct: cbdMatch ? parseFloat(cbdMatch[1]) : null,
      price: price,
      original_price: null,
      weight_label: weight,
      deal_description: null,
    });
  }

  return products;
}

function normalizeJaneProduct(raw) {
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

export async function scrapeJane(dispensary) {
  console.log('[jane] Scraping: ' + dispensary.name);

  if (!dispensary.jane_stores || dispensary.jane_stores.length === 0) {
    console.error('  [jane] No jane_stores for ' + dispensary.name);
    return { products: [], errors: ['No jane_stores configured'] };
  }

  try {
    var { chromium } = await import('playwright');
    var browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });

    var allProducts = new Map();
    var errors = [];

    var CATS = ['flower', 'pre-rolls', 'vape', 'edibles', 'concentrates', 'tinctures', 'topicals'];

    for (var s = 0; s < dispensary.jane_stores.length; s++) {
      var store = dispensary.jane_stores[s];

      for (var c = 0; c < CATS.length; c++) {
        var cat = CATS[c];
        var url = 'https://www.iheartjane.com/stores/' + store.id + '/' + store.slug + '/menu/' + cat;

        var page = null;
        try {
          page = await context.newPage();
          await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
          await page.waitForTimeout(2000);

          for (var scroll = 0; scroll < 20; scroll++) {
            await page.evaluate(function() { window.scrollBy(0, 800); });
            await page.waitForTimeout(200);
          }
          await page.waitForTimeout(1000);

          var text = await page.evaluate(function() {
            return document.body?.innerText || '';
          });

          var products = parseJaneProducts(text);
          for (var p = 0; p < products.length; p++) {
            var key = products[p].external_id;
            if (!allProducts.has(key)) allProducts.set(key, products[p]);
          }

          await page.close();
        } catch (err) {
          if (!err.message.includes('404')) errors.push(cat + ': ' + err.message);
          try { if (page) await page.close(); } catch(e) {}
        }
      }

      console.log('  [jane] Store ' + store.id + ': ' + allProducts.size + ' products');
    }

    await context.close();
    await browser.close();

    var validProducts = [];
    var catCounts = {};
    for (var [key, raw] of allProducts) {
      var normalized = normalizeJaneProduct(raw);
      if (validateProduct(normalized).length === 0) {
        catCounts[normalized.category] = (catCounts[normalized.category] || 0) + 1;
        validProducts.push(normalized);
      }
    }

    var catInfo = Object.entries(catCounts).map(function(e) { return e[0] + ': ' + e[1]; }).join(', ');
    console.log('  [jane] Categories: ' + catInfo);
    console.log('  [jane] Done: ' + validProducts.length + ' valid products');
    return { products: validProducts, errors: errors };
  } catch (err) {
    console.error('  [jane] FAILED: ' + err.message);
    return { products: [], errors: [err.message] };
  }
}

export default { scrapeJane };
