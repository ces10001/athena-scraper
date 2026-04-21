import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

// Updated category slugs (as of April 2026)
var CATEGORIES = ['flower', 'pre-roll', 'vape', 'edible', 'tincture', 'topical'];

var CAT_MAP = {
  'flower': 'flower',
  'pre-roll': 'pre-rolls',
  'vape': 'vaporizers',
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

    // Find the product line with a C-code (e.g. C0140000207)
    var skuCode = null;
    var brand = '';
    var rawName = '';

    // Pattern 1: "Brand - Name CXXXXXXX" (standard with dash)
    var nameMatch = block.match(/([A-Za-z][A-Za-z\s.:'!&]+?)\s*-\s*([^\n$]+?)\s+(C\d{7,})/);
    if (nameMatch) {
      brand = nameMatch[1].trim();
      rawName = nameMatch[2].trim();
      skuCode = nameMatch[3];
    }

    if (!skuCode) {
      // Pattern 2: Find any line with a C-code and parse around it
      var lines = block.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
      for (var li = 0; li < lines.length; li++) {
        var cMatch = lines[li].match(/^(.+?)\s+(C\d{7,})/);
        if (cMatch) {
          skuCode = cMatch[2];
          var fullName = cMatch[1].trim();
          var dashSplit = fullName.split(' - ');
          if (dashSplit.length >= 2) {
            brand = dashSplit[0].trim();
            rawName = dashSplit.slice(1).join(' - ').trim();
          } else {
            rawName = fullName;
            // Look for brand on the next line (Fine Fettle shows "Brand Category" below product name)
            if (li + 1 < lines.length) {
              var nextLine = lines[li + 1].trim();
              // Brand line is usually short and followed by category word
              var brandMatch = nextLine.match(/^([A-Za-z][A-Za-z\s.'!&]+?)(?:\s+(?:Flower|Vape|Pre-Roll|Edible|Tincture|Topical|Cartridge|Disposable|Gummy|Gummies|Concentrate|Capsule))/i);
              if (brandMatch) brand = brandMatch[1].trim();
              else if (nextLine.length < 30 && nextLine.match(/^[A-Z]/)) brand = nextLine.split(/\s+/)[0];
            }
          }
          break;
        }
      }
    }

    if (!skuCode) continue;
    if (seen[skuCode]) continue;
    seen[skuCode] = true;

    // Clean up brand - remove strain type prefix that sometimes appears
    brand = brand.replace(/^(?:Sativa|Indica|Hybrid|CBD)\s+(?:flower|vape|edible|pre-roll|tincture|topical|concentrate)\s*/i, '').trim();
    // Remove "OFF\n\n" prefix from sale items
    brand = brand.replace(/^OFF\s*/i, '').trim();

    var strainMatch = block.match(/\b(Sativa|Indica|Hybrid)\b/i);
    var strain = strainMatch ? strainMatch[1].toLowerCase() : null;

    var thcMatch = block.match(/THC\s*(\d+\.?\d*)%?/);
    var thc = thcMatch ? parseFloat(thcMatch[1]) : null;

    var cbdMatch = block.match(/CBD\s*(\d+\.?\d*)%?/);
    var cbd = cbdMatch ? parseFloat(cbdMatch[1]) : null;

    // Parse prices - formats: "$55/1g", "$25/3.5g", "$60", "$45.00"
    var priceWeightPairs = block.match(/\$(\d+\.?\d*)\/(\d+\.?\d*\s*(?:g|mg|ml|oz))/gi) || [];
    var plainPrices = block.match(/\$(\d+\.?\d*)/g) || [];

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
    } else if (plainPrices.length >= 2) {
      var pp1 = parseFloat(plainPrices[0].replace('$', ''));
      var pp2 = parseFloat(plainPrices[1].replace('$', ''));
      if (pp1 < pp2) { salePrice = pp1; originalPrice = pp2; }
      else { salePrice = pp1; }
    } else if (plainPrices.length === 1) {
      salePrice = parseFloat(plainPrices[0].replace('$', ''));
    }

    if (!salePrice || salePrice <= 0 || salePrice > 600) continue;

    // Extract weight from name if not from price
    if (!weight) {
      var wMatch = rawName.match(/\((\d+\.?\d*\s*g)\)/i) || rawName.match(/\b(\d+\.?\d*)\s*g\b/i) ||
                   rawName.match(/\b(\d+)\s*mg\b/i) || block.match(/\b(\d+\.?\d*)\s*(?:g|mg)\b/i);
      if (wMatch) weight = wMatch[1] || wMatch[0];
    }

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
    if (dispensary.store_ids.rec) storeEntries.push({ type: 'rec', id: dispensary.store_ids.rec });
    if (dispensary.store_ids.med) storeEntries.push({ type: 'med', id: dispensary.store_ids.med });

    for (var s = 0; s < storeEntries.length; s++) {
      var store = storeEntries[s];

      for (var c = 0; c < CATEGORIES.length; c++) {
        var cat = CATEGORIES[c];
        var url = 'https://www.finefettle.com/shop/' + cat + '?storeid=' + store.id;

        var page = null;
        try {
          page = await context.newPage();
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(6000);

          // Scroll to load all products
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
          console.log('  [finefettle] ' + store.type + '/' + cat + ': ' + products.length + ' products');

          for (var p = 0; p < products.length; p++) {
            var key = products[p].external_id;
            if (!allProducts.has(key)) allProducts.set(key, products[p]);
          }

          await page.close();
        } catch (err) {
          errors.push(store.type + '/' + cat + ': ' + err.message);
          console.warn('  [finefettle] ' + store.type + '/' + cat + ' error: ' + err.message);
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
