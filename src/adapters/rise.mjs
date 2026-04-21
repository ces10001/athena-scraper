import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

/* ═══════════════════════════════════════
   RISE ADAPTER
   Scrapes Rise dispensaries at risecannabis.com
   Loops through categories with ?refinementList[root_types][] and paginates with &page=N
   ═══════════════════════════════════════ */

var RISE_CATEGORIES = [
  { slug: 'flower', category: 'flower' },
  { slug: 'pre-roll', category: 'pre-rolls' },
  { slug: 'vape', category: 'vaporizers' },
  { slug: 'edible', category: 'edible' },
  { slug: 'extract', category: 'concentrate' },
  { slug: 'tincture', category: 'tincture' },
  { slug: 'topical', category: 'topical' },
  { slug: 'cbd', category: 'cbd' },
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
    // $OrigPrice (optional)
    // $SalePrice
    // Size (optional)
    // THC info
    // Category type
    // Product name
    // [Discount]
    // Brand
    // Strain

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

    // Prices (1-2 lines of $XX.XX)
    while (li >= 0 && lines[li].match(/^\$\d/)) {
      var p = parseFloat(lines[li].replace('$', '').replace(',', ''));
      if (!price) price = p;
      else if (p > price) originalPrice = p;
      else { originalPrice = price; price = p; }
      li--;
    }
    if (!price || price <= 0 || price > 500) continue;

    // Size line (optional): "1g", "3.5g", "28g", "1 oz", etc.
    if (li >= 0 && lines[li].match(/^\d+\.?\d*\s*(?:g|mg|ml|oz|pk)\b/i)) {
      weight = lines[li];
      li--;
    }

    // THC/CBD line(s)
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

    // Category/type line: "Premium Flower", "Cartridge", "5 Pack Pre Roll"
    if (li >= 0) {
      categoryLine = lines[li];
      li--;
    }

    // Product name
    if (li >= 0) {
      name = lines[li];
      li--;
    }

    // Discount line (optional): "20% OFF"
    if (li >= 0 && lines[li].match(/^\d+%\s*OFF$/i)) {
      discount = lines[li];
      li--;
    }

    // Brand line
    if (li >= 0) {
      brand = lines[li];
      li--;
    }

    // Strain line
    if (li >= 0 && lines[li].match(/^(Sativa|Indica|Hybrid|CBD)$/i)) {
      strain = lines[li].toLowerCase();
    }

    if (!name || name.length < 2) continue;

    // Skip accessories/merch
    var catLower = (categoryLine + ' ' + name).toLowerCase();
    if (/chillum|shirt|hoodie|hat|grinder|pipe|rolling tray|sticker|sweatsuit|poster|candle/i.test(catLower)) continue;

    // Map category from the page category line, fallback to URL category
    var category = fallbackCategory || 'other';
    var cl = categoryLine.toLowerCase();
    if (/flower|premium flower|smalls|ground/i.test(cl)) category = 'flower';
    else if (/pre roll|pre-roll|shorties|blunt/i.test(cl)) category = 'pre-rolls';
    else if (/cart|vape|disposable|pod|briq|all.in.one/i.test(cl)) category = 'vaporizers';
    else if (/gummy|gummies|chocolate|edible|chew|lozenge|mint/i.test(cl)) category = 'edible';
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
    var baseUrl = dispensary.rise_url.replace(/\/?$/, '/');

    for (var c = 0; c < RISE_CATEGORIES.length; c++) {
      var cat = RISE_CATEGORIES[c];
      var catUrl = baseUrl + '?refinementList[root_types][]=' + cat.slug;
      var page = null;

      try {
        page = await context.newPage();
        await page.goto(catUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(6000);

        // Get total product count from "N PRODUCTS" text
        var totalForCat = await page.evaluate(function() {
          var m = document.body.innerText.match(/(\d+)\s*PRODUCTS/i);
          return m ? parseInt(m[1]) : 0;
        });

        if (totalForCat === 0) {
          await page.close();
          continue;
        }

        var totalPages = Math.ceil(totalForCat / 24);
        console.log('  [rise] ' + cat.slug + ': ' + totalForCat + ' products (' + totalPages + ' pages)');

        // Parse page 1
        for (var s = 0; s < 15; s++) {
          await page.evaluate(function() { window.scrollBy(0, 600); });
          await page.waitForTimeout(150);
        }
        await page.waitForTimeout(1000);

        var text = await page.evaluate(function() { return document.body.innerText || ''; });
        var pageProducts = parseRiseBlocks(text, cat.category);
        for (var p = 0; p < pageProducts.length; p++) {
          allProducts.set(pageProducts[p].external_id, pageProducts[p]);
        }

        await page.close();
        page = null;

        // Parse remaining pages
        for (var pg = 2; pg <= totalPages; pg++) {
          try {
            page = await context.newPage();
            var pgUrl = catUrl + '&page=' + pg;
            await page.goto(pgUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(5000);

            for (var s2 = 0; s2 < 15; s2++) {
              await page.evaluate(function() { window.scrollBy(0, 600); });
              await page.waitForTimeout(150);
            }
            await page.waitForTimeout(1000);

            var pgText = await page.evaluate(function() { return document.body.innerText || ''; });
            var pgProducts = parseRiseBlocks(pgText, cat.category);
            for (var pp = 0; pp < pgProducts.length; pp++) {
              allProducts.set(pgProducts[pp].external_id, pgProducts[pp]);
            }

            await page.close();
            page = null;
          } catch (pgErr) {
            console.warn('  [rise] ' + cat.slug + ' page ' + pg + ' failed: ' + pgErr.message);
            try { if (page) await page.close(); } catch(e) {}
            page = null;
          }
        }
      } catch (catErr) {
        errors.push(cat.slug + ': ' + catErr.message);
        console.warn('  [rise] ' + cat.slug + ' error: ' + catErr.message);
        try { if (page) await page.close(); } catch(e) {}
      }
    }

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
