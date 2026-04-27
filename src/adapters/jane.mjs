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

  var allProducts = new Map();
  var errors = [];

  // ═══ METHOD 1: Try Jane API first (faster and more reliable) ═══
  try {
    for (var s = 0; s < dispensary.jane_stores.length; s++) {
      var store = dispensary.jane_stores[s];
      var page = 1;
      var hasMore = true;
      var apiTotal = 0;

      while (hasMore) {
        var apiUrl = 'https://api.iheartjane.com/v1/stores/' + store.id + '/products?per_page=100&page=' + page;
        try {
          var resp = await fetch(apiUrl, {
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
          });
          if (!resp.ok) throw new Error('API returned ' + resp.status);
          var data = await resp.json();
          var items = data.data || data.products || [];
          if (items.length === 0) { hasMore = false; break; }

          for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var price = item.price_cents ? item.price_cents / 100 : (item.price || null);
            if (!price || price <= 0) continue;

            var name = item.name || '';
            var brand = (item.brand && item.brand.name) || item.brand_name || '';
            var cat = (item.kind || item.category || '').toLowerCase();
            if (cat === 'gear' || cat === 'accessories' || cat === 'merch') continue;

            // Map Jane categories
            if (cat === 'flower' || cat === 'pre_ground') cat = 'flower';
            else if (cat === 'pre-roll' || cat === 'pre_roll') cat = 'pre-rolls';
            else if (cat === 'vape' || cat === 'cartridge' || cat === 'disposable') cat = 'vaporizers';
            else if (cat === 'edible' || cat === 'gummy' || cat === 'chocolate' || cat === 'beverage') cat = 'edible';
            else if (cat === 'extract' || cat === 'concentrate') cat = 'concentrate';
            else if (cat === 'tincture' || cat === 'capsule' || cat === 'sublingual') cat = 'tincture';
            else if (cat === 'topical' || cat === 'transdermal') cat = 'topical';

            var weight = null;
            var wMatch = name.match(/\b(\d+\.?\d*)\s*[Gg]\b/) || (item.amount && String(item.amount).match(/(\d+\.?\d*)/));
            if (wMatch) weight = wMatch[1] + 'g';

            var key = 'jane-' + (item.id || (name + price).replace(/[^a-z0-9]/gi, '').substring(0, 25));
            if (!allProducts.has(key)) {
              allProducts.set(key, {
                external_id: key, name: name, brand: brand, category: cat,
                strain_type: (item.strain_type || '').toLowerCase() || null,
                thc_pct: item.percent_thc || null, cbd_pct: item.percent_cbd || null,
                price: price, original_price: null, weight_label: weight,
                deal_description: null
              });
            }
          }

          apiTotal += items.length;
          var meta = data.meta || {};
          if (meta.total && apiTotal >= meta.total) hasMore = false;
          else if (items.length < 100) hasMore = false;
          else page++;
        } catch (apiErr) {
          console.log('  [jane] API page ' + page + ' failed: ' + apiErr.message);
          hasMore = false;
        }
      }
      console.log('  [jane] API store ' + store.id + ': ' + allProducts.size + ' products (' + apiTotal + ' raw)');
    }

    if (allProducts.size > 10) {
      console.log('  [jane] API method successful with ' + allProducts.size + ' products');
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
    }
    console.log('  [jane] API returned only ' + allProducts.size + ' products, falling back to page scraping...');
    allProducts.clear();
  } catch(e) {
    console.log('  [jane] API method failed: ' + e.message + ', falling back to page scraping...');
  }

  // ═══ METHOD 2: Fall back to page scraping with API interception ═══
  try {
    var { chromium } = await import('playwright');
    var browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });

    for (var s = 0; s < dispensary.jane_stores.length; s++) {
      var store = dispensary.jane_stores[s];
      var url = 'https://www.iheartjane.com/stores/' + store.id + '/menu';
      var interceptedProducts = [];

      var page = null;
      try {
        page = await context.newPage();

        // ─── Intercept ALL API responses to capture product data ───
        var apiUrls = [];
        page.on('response', async function(response) {
          try {
            var rUrl = response.url();
            var ct = response.headers()['content-type'] || '';
            // Log all JSON API calls for diagnostics
            if (ct.includes('json') && response.status() === 200 && !rUrl.includes('.js') && !rUrl.includes('analytics') && !rUrl.includes('tracking')) {
              apiUrls.push(rUrl.substring(0, 120));
              // Try to extract products from ANY JSON response
              try {
                var body = await response.json();
                var items = body.data || body.products || body.menu_products || body.items || body.results || [];
                if (Array.isArray(items) && items.length > 0 && items[0] && (items[0].name || items[0].product_name || items[0].title)) {
                  console.log('  [jane] ✓ Found products in: ' + rUrl.substring(0, 100) + ' (' + items.length + ' items)');
                  for (var ix = 0; ix < items.length; ix++) interceptedProducts.push(items[ix]);
                }
              } catch(e) {}
            }
          } catch(e) {}
        });

        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(10000);
        var pageTitle = await page.title();
        var pageUrl = page.url();
        console.log('  [jane] Page loaded: "' + pageTitle + '" at ' + pageUrl);
        console.log('  [jane] Intercepted products so far: ' + interceptedProducts.length);
        console.log('  [jane] API URLs seen (' + apiUrls.length + '): ' + apiUrls.slice(0, 10).join(' | '));

        // Dismiss age gate
        try {
          var ageBtns = ['I\'m over 21', 'Yes', 'I Agree', 'Enter', 'Confirm'];
          for (var ab = 0; ab < ageBtns.length; ab++) {
            var ageBtn = page.locator('button:has-text("' + ageBtns[ab] + '")').first();
            if (await ageBtn.isVisible({ timeout: 2000 })) {
              await ageBtn.click();
              console.log('  [jane] Age gate passed: ' + ageBtns[ab]);
              await page.waitForTimeout(5000);
              break;
            }
          }
        } catch(e) {}

        // Close popups
        try {
          var closeBtn = page.locator('button[aria-label="Close"], button:has-text("×"), [class*="close"]').first();
          if (await closeBtn.isVisible({ timeout: 1500 })) { await closeBtn.click(); await page.waitForTimeout(1000); }
        } catch(e) {}

        // Click through each category tab to trigger API calls
        var categories = ['Flower', 'Edible', 'Pre-roll', 'Vape', 'Concentrate', 'Tincture', 'Topical'];
        for (var ci = 0; ci < categories.length; ci++) {
          var catName = categories[ci];
          try {
            var catTab = page.locator('button:has-text("' + catName + '"), a:has-text("' + catName + '"), [role="tab"]:has-text("' + catName + '")').first();
            if (await catTab.isVisible({ timeout: 2000 })) {
              await catTab.scrollIntoViewIfNeeded();
              await catTab.click();
              await page.waitForTimeout(3000);
              // Click "View more" repeatedly
              for (var vm = 0; vm < 40; vm++) {
                try {
                  var viewMore = page.locator('button:has-text("View more"), button:has-text("Show more"), button:has-text("Load more")').first();
                  if (await viewMore.isVisible({ timeout: 1500 })) {
                    await viewMore.scrollIntoViewIfNeeded();
                    await viewMore.click();
                    await page.waitForTimeout(2000);
                  } else break;
                } catch(e) { break; }
              }
            }
          } catch(e) {}
        }

        // Also try Featured/All
        try {
          var featTab = page.locator('button:has-text("Featured"), a:has-text("Featured"), button:has-text("All")').first();
          if (await featTab.isVisible({ timeout: 1500 })) {
            await featTab.click();
            await page.waitForTimeout(3000);
            for (var vm = 0; vm < 30; vm++) {
              try {
                var viewMore = page.locator('button:has-text("View more")').first();
                if (await viewMore.isVisible({ timeout: 1500 })) { await viewMore.scrollIntoViewIfNeeded(); await viewMore.click(); await page.waitForTimeout(2000); }
                else break;
              } catch(e) { break; }
            }
          }
        } catch(e) {}

        console.log('  [jane] Total intercepted API products: ' + interceptedProducts.length);

        // ─── Process intercepted products ───
        if (interceptedProducts.length > 0) {
          for (var i = 0; i < interceptedProducts.length; i++) {
            var item = interceptedProducts[i];
            var price = item.price_cents ? item.price_cents / 100 : (item.price_eighth ? item.price_eighth / 100 : (item.price || item.default_price || null));
            if (typeof price === 'string') price = parseFloat(price);
            if (!price || price <= 0) continue;

            var iName = item.name || item.product_name || '';
            var iBrand = (item.brand && typeof item.brand === 'object' ? item.brand.name : item.brand) || item.brand_name || '';
            var cat = (item.kind || item.root_subtype || item.category || item.product_type || '').toLowerCase();
            if (cat === 'gear' || cat === 'accessories' || cat === 'merch') continue;

            if (cat === 'flower' || cat === 'pre_ground') cat = 'flower';
            else if (cat === 'pre-roll' || cat === 'pre_roll') cat = 'pre-rolls';
            else if (cat === 'vape' || cat === 'cartridge' || cat === 'disposable') cat = 'vaporizers';
            else if (cat === 'edible' || cat === 'gummy' || cat === 'chocolate' || cat === 'beverage') cat = 'edible';
            else if (cat === 'extract' || cat === 'concentrate') cat = 'concentrate';
            else if (cat === 'tincture' || cat === 'capsule' || cat === 'sublingual') cat = 'tincture';
            else if (cat === 'topical' || cat === 'transdermal') cat = 'topical';

            var weight = null;
            var wMatch = iName.match(/\b(\d+\.?\d*)\s*[Gg]\b/) || (item.amount && String(item.amount).match(/(\d+\.?\d*)/));
            if (wMatch) weight = wMatch[1] + 'g';

            var key = 'jane-' + (item.id || item.product_id || (iName + price).replace(/[^a-z0-9]/gi, '').substring(0, 25));
            if (!allProducts.has(key)) {
              allProducts.set(key, {
                external_id: key, name: iName, brand: iBrand, category: cat,
                strain_type: (item.strain_type || item.classification || '').toLowerCase() || null,
                thc_pct: item.percent_thc || item.thc_percentage || null,
                cbd_pct: item.percent_cbd || item.cbd_percentage || null,
                price: price, original_price: null, weight_label: weight,
                deal_description: null
              });
            }
          }
          console.log('  [jane] Parsed from intercepted data: ' + allProducts.size + ' products');
        }

        // ─── Fallback: text parse if interception got nothing ───
        if (allProducts.size < 10) {
          console.log('  [jane] Interception got < 10, falling back to text parse...');
          // Scroll to load everything
          for (var scroll = 0; scroll < 30; scroll++) {
            await page.evaluate(function() { window.scrollBy(0, 1500); });
            await page.waitForTimeout(300);
          }
          await page.waitForTimeout(3000);
          var fullText = await page.evaluate(function() { return document.body?.innerText || ''; });
          console.log('  [jane] Page text length: ' + fullText.length + ' chars');
          console.log('  [jane] Page text preview: ' + fullText.substring(0, 300).replace(/\n/g, ' | '));
          var textProducts = parseJaneProducts(fullText);
          for (var p = 0; p < textProducts.length; p++) {
            var key = textProducts[p].external_id;
            if (!allProducts.has(key)) allProducts.set(key, textProducts[p]);
          }
          console.log('  [jane] After text fallback: ' + allProducts.size + ' products');
        }

        console.log('  [jane] Store ' + store.id + ': ' + allProducts.size + ' products');
        await page.close();
      } catch (err) {
        errors.push(store.id + ': ' + err.message);
        console.log('  [jane] Error for store ' + store.id + ': ' + err.message);
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
