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
    var allPrices = block.match(/\$(\d+\.?\d*)/g) || [];
    var plainPrice = block.match(/\$(\d+\.?\d*)/);

    var price = null;
    var originalPrice = null;
    var weight = null;

    if (priceWeightMatch) {
      price = parseFloat(priceWeightMatch[1]);
      weight = priceWeightMatch[2].trim();
    } else if (plainPrice) {
      price = parseFloat(plainPrice[1]);
    }
    
    // If there are two prices and a deal indicator, first is original, second is sale
    if (allPrices.length >= 2 && block.match(/\d+%\s*OFF/i)) {
      var p1 = parseFloat(allPrices[0].replace('$',''));
      var p2 = parseFloat(allPrices[1].replace('$',''));
      if (p2 < p1) {
        originalPrice = p1;
        price = p2;
      }
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

    // Clean up Jane-specific prefixes
    name = name.replace(/^Sponsored\s*/i, '');
    name = name.replace(/^\d+%\s*(?:back|OFF)\s*/i, '');
    name = name.replace(/^\d+%\s*OFF\s*\d*\/?(?:\d*\s*OZ)?\s*/i, '');
    name = name.replace(/^(Sativa|Indica|Hybrid)\s*/i, '');
    name = name.replace(/\s+/g, ' ').trim();
    if (name.length > 80) name = name.substring(0, 80).trim();

    // Skip garbage names
    if (name.match(/Skip to|Filters|Main Content|View all|New Drops|Top Terps|Best selling|Only \d+ left|Products Dispensa/i)) continue;
    if (name.length < 5) continue;

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

    for (var s = 0; s < dispensary.jane_stores.length; s++) {
      var store = dispensary.jane_stores[s];
      var url = 'https://www.iheartjane.com/stores/' + store.id + '/menu';

      var page = null;
      try {
        page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);

        // Dismiss age gate — try multiple button texts
        try {
          var ageBtns = ['I\'m over 21', 'Yes', 'I Agree', 'Enter', 'Confirm'];
          for (var ab = 0; ab < ageBtns.length; ab++) {
            var ageBtn = page.locator('button:has-text("' + ageBtns[ab] + '")').first();
            if (await ageBtn.isVisible({ timeout: 2000 })) {
              await ageBtn.click();
              console.log('  [jane] Age gate passed: ' + ageBtns[ab]);
              await page.waitForTimeout(3000);
              break;
            }
          }
        } catch(e) {}

        // Close any popups/overlays
        try {
          var closeBtn = page.locator('button[aria-label="Close"], button:has-text("×"), [class*="close"]').first();
          if (await closeBtn.isVisible({ timeout: 1500 })) { await closeBtn.click(); await page.waitForTimeout(1000); }
        } catch(e) {}

        // Click through each category tab to load all products
        var categories = ['Flower', 'Edible', 'Pre-roll', 'Vape', 'Concentrate', 'Tincture', 'Topical', 'Merch'];
        var beforeCount = allProducts.size;

        for (var ci = 0; ci < categories.length; ci++) {
          var catName = categories[ci];
          try {
            // Click category tab
            var catTab = page.locator('button:has-text("' + catName + '"), a:has-text("' + catName + '"), [role="tab"]:has-text("' + catName + '"), div:has-text("' + catName + '")').first();
            if (await catTab.isVisible({ timeout: 2000 })) {
              await catTab.scrollIntoViewIfNeeded();
              await catTab.click();
              await page.waitForTimeout(3000);

              // Click "View more" repeatedly in this category
              for (var vm = 0; vm < 20; vm++) {
                try {
                  var viewMore = page.locator('button:has-text("View more"), button:has-text("Show more"), button:has-text("Load more")').first();
                  if (await viewMore.isVisible({ timeout: 1500 })) {
                    await viewMore.scrollIntoViewIfNeeded();
                    await viewMore.click();
                    await page.waitForTimeout(2000);
                  } else { break; }
                } catch(e) { break; }
              }

              // Scroll down to load lazy content
              for (var scroll = 0; scroll < 10; scroll++) {
                await page.evaluate(function() { window.scrollBy(0, 1000); });
                await page.waitForTimeout(200);
              }
              await page.waitForTimeout(1000);

              // Collect products from this category
              var catText = await page.evaluate(function() { return document.body?.innerText || ''; });
              var catProducts = parseJaneProducts(catText);
              for (var p = 0; p < catProducts.length; p++) {
                var key = catProducts[p].external_id;
                if (!allProducts.has(key)) allProducts.set(key, catProducts[p]);
              }
            }
          } catch(e) {}
        }

        // Also try the Featured/All page for anything we missed
        try {
          var featTab = page.locator('button:has-text("Featured"), a:has-text("Featured"), button:has-text("All")').first();
          if (await featTab.isVisible({ timeout: 1500 })) {
            await featTab.click();
            await page.waitForTimeout(3000);
            for (var vm = 0; vm < 10; vm++) {
              try {
                var viewMore = page.locator('button:has-text("View more")').first();
                if (await viewMore.isVisible({ timeout: 1500 })) { await viewMore.scrollIntoViewIfNeeded(); await viewMore.click(); await page.waitForTimeout(2000); }
                else break;
              } catch(e) { break; }
            }
            var featText = await page.evaluate(function() { return document.body?.innerText || ''; });
            var featProducts = parseJaneProducts(featText);
            for (var p = 0; p < featProducts.length; p++) {
              var key = featProducts[p].external_id;
              if (!allProducts.has(key)) allProducts.set(key, featProducts[p]);
            }
          }
        } catch(e) {}

        console.log('  [jane] Store ' + store.id + ': ' + allProducts.size + ' products');
        await page.close();
      } catch (err) {
        errors.push(store.id + ': ' + err.message);
        try { if (page) await page.close(); } catch(e) {}
      }
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
