import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

var CATEGORIES = ['flower', 'pre-roll', 'vape', 'extract', 'edible', 'tincture', 'topical'];

var CAT_MAP = {
  'flower': 'flower',
  'pre-roll': 'pre-rolls',
  'vape': 'vaporizers',
  'extract': 'concentrate',
  'edible': 'edible',
  'tincture': 'tincture',
  'topical': 'topical',
};

function parseProductsFromText(text, category) {
  var products = [];
  var seen = {};
  var blocks = text.split('Add to bag');

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i].trim();
    if (block.length < 20) continue;

    // Match SKU code (C followed by 7+ digits, or standalone 5-digit code)
    var skuMatch = block.match(/(C\d{7,})/) || block.match(/\b(\d{5})\b/);
    if (!skuMatch) continue;
    var skuCode = skuMatch[1];
    if (seen[skuCode]) continue;
    seen[skuCode] = true;

    // Extract product name line — everything before the SKU on the same logical line
    // Format can be: "Brand - Product Name SKU" or "Brand Product Name SKU"
    var nameLineMatch = block.match(/([A-Za-z][^\n]*?)\s+(C\d{7,})/);
    if (!nameLineMatch) continue;
    var nameLine = nameLineMatch[1].trim();

    var brand = '';
    var rawName = '';
    if (nameLine.includes(' - ')) {
      var parts = nameLine.split(' - ');
      brand = parts[0].trim();
      rawName = parts.slice(1).join(' - ').trim();
    } else {
      // No dash — first word is brand, rest is name
      var words = nameLine.split(/\s+/);
      brand = words[0];
      rawName = words.slice(1).join(' ');
    }

    var strainMatch = block.match(/\b(Sativa|Indica|Hybrid)\b/i);
    var strain = strainMatch ? strainMatch[1].toLowerCase() : null;

    var thcMatch = block.match(/THC\s*(\d+\.?\d*)%?/);
    var thc = thcMatch ? parseFloat(thcMatch[1]) : null;

    var cbdMatch = block.match(/CBD\s*(\d+\.?\d*)%?/);
    var cbd = cbdMatch ? parseFloat(cbdMatch[1]) : null;

    // Try price/weight format first: $XX/weight
    var priceWeightPairs = block.match(/\$(\d+\.?\d*)\/(\d+\.?\d*\s*(?:g|mg|ml|oz|pk))/gi) || [];
    var salePrice = null;
    var originalPrice = null;
    var weight = null;

    if (priceWeightPairs.length >= 2) {
      var m1 = priceWeightPairs[0].match(/\$(\d+\.?\d*)\/(.+)/);
      var m2 = priceWeightPairs[1].match(/\$(\d+\.?\d*)\/(.+)/);
      if (m1 && m2) {
        var p1 = parseFloat(m1[1]);
        var p2 = parseFloat(m2[1]);
        if (p1 < p2) { salePrice = p1; originalPrice = p2; }
        else { salePrice = p1; }
        weight = m1[2].trim();
      }
    } else if (priceWeightPairs.length === 1) {
      var m = priceWeightPairs[0].match(/\$(\d+\.?\d*)\/(.+)/);
      if (m) { salePrice = parseFloat(m[1]); weight = m[2].trim(); }
    }

    // Fallback: bare price format $XX (no weight)
    if (!salePrice) {
      var barePrices = block.match(/\$(\d+\.?\d*)/g) || [];
      if (barePrices.length >= 2) {
        var bp1 = parseFloat(barePrices[0].replace('$', ''));
        var bp2 = parseFloat(barePrices[1].replace('$', ''));
        if (bp1 < bp2) { salePrice = bp1; originalPrice = bp2; }
        else { salePrice = bp1; }
      } else if (barePrices.length === 1) {
        salePrice = parseFloat(barePrices[0].replace('$', ''));
      }
      // Try to extract weight from name or block
      var wMatch = (rawName + ' ' + block).match(/(\d+\.?\d*\s*(?:g|mg|ml|oz))\b/i);
      if (wMatch) weight = wMatch[1].trim();
      var pkMatch = (rawName + ' ' + block).match(/(\d+)\s*pk\b/i);
      if (!weight && pkMatch) weight = pkMatch[1] + 'pk';
    }

    if (!salePrice || salePrice < 1) continue;

    var discountMatch = block.match(/(\d+)%\s*OFF/i);
    var discount = discountMatch ? discountMatch[1] + '% Off' : null;

    products.push({
      external_id: 'ff-' + skuCode,
      name: rawName,
      brand: brand,
      category: CAT_MAP[category] || category,
      strain_type: strain,
      thc_pct: thc,
      cbd_pct: cbd,
      price: salePrice,
      original_price: (originalPrice && originalPrice > salePrice) ? originalPrice : null,
      weight_label: weight,
      deal_description: discount || ((originalPrice && originalPrice > salePrice) ? 'Sale' : null),
    });
  }

  return products;
}

function normalizeFFProduct(raw) {
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

export async function scrapeFineFettle(dispensary) {
  console.log('[finefettle] Scraping: ' + dispensary.name);

  if (!dispensary.store_ids) {
    console.error('  [finefettle] No store_ids for ' + dispensary.name);
    return { products: [], errors: ['No store_ids configured'] };
  }

  try {
    var { chromium } = await import('playwright');
    var browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });

    var allProducts = new Map();
    var errors = [];

    var storeEntries = [];
    var menuType = dispensary.menu_type;
    if ((!menuType || menuType === 'rec') && dispensary.store_ids.rec) storeEntries.push({ type: 'rec', id: dispensary.store_ids.rec });
    if ((!menuType || menuType === 'med') && dispensary.store_ids.med) storeEntries.push({ type: 'med', id: dispensary.store_ids.med });

    for (var s = 0; s < storeEntries.length; s++) {
      var store = storeEntries[s];

      for (var c = 0; c < CATEGORIES.length; c++) {
        var cat = CATEGORIES[c];
        var url = 'https://www.finefettle.com/shop/' + cat + '?storeid=' + store.id;

        var page = null;
        try {
          page = await context.newPage();
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(5000);

          // Click "View more" / "Show more" / "Load more" buttons repeatedly
          for (var vm = 0; vm < 20; vm++) {
            try {
              var moreBtn = page.locator('button:has-text("View more"), button:has-text("Show more"), button:has-text("Load more"), a:has-text("View more"), a:has-text("Show more")').first();
              if (await moreBtn.isVisible({ timeout: 1500 })) {
                await moreBtn.scrollIntoViewIfNeeded();
                await moreBtn.click();
                await page.waitForTimeout(2000);
              } else {
                break;
              }
            } catch(e) { break; }
          }

          for (var scroll = 0; scroll < 20; scroll++) {
            await page.evaluate(function() { window.scrollBy(0, 800); });
            await page.waitForTimeout(200);
          }
          await page.waitForTimeout(1500);

          var text = await page.evaluate(function() {
            var main = document.querySelector('main');
            return main ? main.innerText : document.body.innerText;
          });

          var products = parseProductsFromText(text, cat);
          for (var p = 0; p < products.length; p++) {
            var key = products[p].external_id;
            if (!allProducts.has(key)) allProducts.set(key, products[p]);
          }

          await page.close();
        } catch (err) {
          errors.push(store.type + '/' + cat + ': ' + err.message);
          try { if (page) await page.close(); } catch(e) {}
        }
      }

      console.log('  [finefettle] ' + store.type + ' (storeid ' + store.id + '): ' + allProducts.size + ' products so far');
    }

    await context.close();
    await browser.close();

    var validProducts = [];
    var catCounts = {};
    for (var [key, raw] of allProducts) {
      var normalized = normalizeFFProduct(raw);
      if (validateProduct(normalized).length === 0) {
        catCounts[normalized.category] = (catCounts[normalized.category] || 0) + 1;
        validProducts.push(normalized);
      }
    }

    var catInfo = Object.entries(catCounts).map(function(e) { return e[0] + ': ' + e[1]; }).join(', ');
    console.log('  [finefettle] Categories: ' + catInfo);
    console.log('  [finefettle] Done: ' + validProducts.length + ' valid products');
    return { products: validProducts, errors: errors };
  } catch (err) {
    console.error('  [finefettle] FAILED: ' + err.message);
    return { products: [], errors: [err.message] };
  }
}

export default { scrapeFineFettle };
