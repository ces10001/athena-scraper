import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

/* ═══════════════════════════════════════
   RISE ADAPTER — v2
   Scrapes Rise dispensaries at risecannabis.com
   Navigates to each category page via ?refinementList[root_types][]
   Rise renders ~24 products per category page (no working pagination)
   ═══════════════════════════════════════ */

var RISE_CATEGORIES = [
  { slug: 'flower', category: 'flower' },
  { slug: 'pre-roll', category: 'pre-rolls' },
  { slug: 'vape', category: 'vaporizers' },
  { slug: 'edible', category: 'edible' },
  { slug: 'extract', category: 'concentrate' },
  { slug: 'tincture', category: 'tincture' },
  { slug: 'topical', category: 'topical' },
];

function parseRiseBlocks(text, fallbackCategory) {
  var products = [];
  var seen = {};
  var blocks = text.split('Add to cart');

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i].trim();
    if (block.length < 20) continue;
    if (block.length > 600) block = block.substring(block.length - 600);

    // Rise format is newline-separated (bottom-up):
    // [Strain]
    // [Discount like "20% OFF" or "20% OFF 1/4 OZ"]
    // Brand
    // Product name
    // Category type
    // THC info
    // [Size]
    // $SalePrice
    // [$OrigPrice]

    var lines = block.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
    if (lines.length < 3) continue;

    var price = null;
    var originalPrice = null;
    var weight = null;
    var thc = null;
    var cbd = null;
    var brand = '';
    var name = '';
    var strain = null;
    var discount = null;
    var categoryLine = '';

    // Parse from bottom up
    var li = lines.length - 1;

    // Prices
    while (li >= 0 && lines[li].match(/^\$/)) {
      var p = parseFloat(lines[li].replace('$', '').replace(',', ''));
      if (!price) price = p;
      else if (p > price) originalPrice = p;
      else { originalPrice = price; price = p; }
      li--;
    }
    if (!price || price <= 0 || price > 500) continue;

    // Size (optional)
    if (li >= 0 && lines[li].match(/^\d+\.?\d*\s*(?:g|mg|ml|oz|pk)\b/i)) {
      weight = lines[li];
      li--;
    }

    // THC/CBD line
    if (li >= 0 && (lines[li].match(/THC/i) || lines[li].match(/CBD/i) || lines[li].match(/^\d+\.?\d*\s*mg/))) {
      var thcLine = lines[li];
      var thcM = thcLine.match(/THC\s*(\d+\.?\d*)%?/i);
      var cbdM = thcLine.match(/CBD\s*(\d+\.?\d*)%?/i);
      if (thcM) thc = parseFloat(thcM[1]);
      if (cbdM) cbd = parseFloat(cbdM[1]);
      if (!weight) {
        var wM = thcLine.match(/(\d+)\s*(?:pk|pack)\b/i);
        if (wM) weight = wM[0];
      }
      li--;
    }

    // Category line
    if (li >= 0) {
      categoryLine = lines[li];
      li--;
    }

    // Product name
    if (li >= 0) {
      name = lines[li];
      li--;
    }

    // Discount line (optional) — matches "20% OFF", "20% OFF 1/4 OZ", etc.
    if (li >= 0 && lines[li].match(/^\d+%\s*OFF/i)) {
      discount = lines[li].match(/(\d+)%\s*OFF/i)[0];
      li--;
    }

    // Brand line
    if (li >= 0 && !lines[li].match(/^(Sativa|Indica|Hybrid|CBD)$/i)) {
      brand = lines[li];
      li--;
    }

    // Strain line
    if (li >= 0 && lines[li].match(/^(Sativa|Indica|Hybrid|CBD)$/i)) {
      strain = lines[li].toLowerCase();
    }
    // Also check if brand was actually the strain
    if (!strain && brand.match(/^(Sativa|Indica|Hybrid)$/i)) {
      strain = brand.toLowerCase();
      brand = '';
    }

    if (!name || name.length < 2) continue;

    // Skip accessories/merch
    var catLower = (categoryLine + ' ' + name).toLowerCase();
    if (/chillum|shirt|hoodie|hat|grinder|pipe|rolling tray|sticker|sweatsuit|poster|candle|jersey|shorts|socks/i.test(catLower)) continue;

    // Map category from line, fallback to URL category
    var category = fallbackCategory || 'other';
    var cl = categoryLine.toLowerCase();
    if (/flower|premium flower|smalls|ground|mixed buds|whole buds|select grind/i.test(cl)) category = 'flower';
    else if (/pre.?roll|shorties|blunt|mini dogs|big dog|fatboy|minis|party pack/i.test(cl)) category = 'pre-rolls';
    else if (/cart|vape|disposable|pod|briq|all.in.one|mini tank/i.test(cl)) category = 'vaporizers';
    else if (/gummy|gummies|chocolate|edible|chew|lozenge|mint|confection/i.test(cl)) category = 'edible';
    else if (/seltzer|soda|beverage|tea|drink/i.test(cl)) category = 'edible';
    else if (/concentrate|badder|rosin|resin|sugar|sauce|diamond|wax/i.test(cl)) category = 'concentrate';
    else if (/tincture|capsule|oral|syringe/i.test(cl)) category = 'tincture';
    else if (/topical|balm|cream|lotion/i.test(cl)) category = 'topical';

    if (!weight) {
      var wMatch = name.match(/\b(\d+\.?\d*)\s*g\b/i) || name.match(/\b(\d+)\s*mg\b/i);
      if (wMatch) weight = wMatch[0];
    }

    var skuMatch = name.match(/\b(\d{5})\b/) || name.match(/\b(\d{4,6})\b/);
    var externalId = 'rise-' + (skuMatch ? skuMatch[1] : (name + price).replace(/[^a-z0-9]/gi, '').substring(0, 25));
    if (seen[externalId]) continue;
    seen[externalId] = true;

    var dealDesc = discount || (originalPrice && originalPrice > price ? 'Sale' : null);

    products.push({
      external_id: externalId, name: name, brand: brand, category: category,
      strain_type: strain, thc_pct: thc, cbd_pct: cbd, price: price,
      original_price: (originalPrice && originalPrice > price) ? originalPrice : null,
      weight_label: weight, deal_description: dealDesc,
    });
  }
  return products;
}

function normalizeRiseProduct(raw) {
  var normalized = normalizeProduct({
    external_id: raw.external_id, name: raw.name || '', brand: raw.brand || '',
    category: raw.category || '', subcategory: null, strain_type: raw.strain_type || null,
    price: raw.price, original_price: raw.original_price, weight_label: raw.weight_label || null,
    thc_pct: raw.thc_pct, cbd_pct: raw.cbd_pct, in_stock: true,
    deal_description: raw.deal_description || null, image_url: null, product_url: null,
  });
  normalized.category = (raw.category || '').toLowerCase();
  return normalized;
}

export async function scrapeRise(dispensary) {
  console.log('[rise] Scraping: ' + dispensary.name);
  if (!dispensary.rise_url) {
    console.error('  [rise] No rise_url for ' + dispensary.name);
    return { products: [], errors: ['No rise_url configured'] };
  }

  try {
    var { chromium } = await import('playwright');
    var browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });

    var allProducts = new Map();
    var errors = [];
    var baseUrl = dispensary.rise_url.replace(/\/?$/, '');

    // Use a single page for all categories
    var page = await context.newPage();

    for (var c = 0; c < RISE_CATEGORIES.length; c++) {
      var cat = RISE_CATEGORIES[c];
      var catUrl = baseUrl + '/?refinementList%5Broot_types%5D%5B%5D=' + cat.slug;

      try {
        // Force clean navigation by going to blank first (prevents React router interference)
        if (c > 0) {
          await page.goto('about:blank', { timeout: 5000 });
          await page.waitForTimeout(500);
        }
        
        await page.goto(catUrl, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(4000);

        // Check product count
        var totalForCat = await page.evaluate(function() {
          var m = document.body.innerText.match(/(\d+)\s*PRODUCTS/i);
          return m ? parseInt(m[1]) : 0;
        });

        if (totalForCat === 0) {
          console.log('  [rise] ' + cat.slug + ': 0 products (skipped)');
          continue;
        }

        console.log('  [rise] ' + cat.slug + ': ' + totalForCat + ' products');

        // Scroll to render all visible products
        for (var s = 0; s < 20; s++) {
          await page.evaluate(function() { window.scrollBy(0, 600); });
          await page.waitForTimeout(200);
        }
        await page.waitForTimeout(1500);

        var text = await page.evaluate(function() { return document.body.innerText || ''; });
        var catProducts = parseRiseBlocks(text, cat.category);

        for (var p = 0; p < catProducts.length; p++) {
          allProducts.set(catProducts[p].external_id, catProducts[p]);
        }

        console.log('  [rise] ' + cat.slug + ': parsed ' + catProducts.length + ' of ' + totalForCat);

      } catch (catErr) {
        errors.push(cat.slug + ': ' + catErr.message);
        console.warn('  [rise] ' + cat.slug + ' error: ' + catErr.message);
      }
    }

    await page.close();
    await context.close();
    await browser.close();

    // Normalize and validate
    var catCounts = {};
    var normalized = [];
    for (var [key, raw] of allProducts) {
      var prod = normalizeRiseProduct(raw);
      var pCat = (prod.category || '').toLowerCase();
      if (pCat === 'accessories' || pCat === 'other') continue;
      if (validateProduct(prod).length > 0) continue;
      catCounts[prod.category] = (catCounts[prod.category] || 0) + 1;
      normalized.push(prod);
    }

    var catInfo = Object.entries(catCounts).map(function(e) { return e[0] + ': ' + e[1]; }).join(', ');
    console.log('  [rise] Categories: ' + catInfo);
    console.log('  [rise] Done: ' + normalized.length + ' valid products');
    return { products: normalized, errors: errors };
  } catch (err) {
    console.error('  [rise] FATAL: ' + err.message);
    return { products: [], errors: [err.message] };
  }
}
