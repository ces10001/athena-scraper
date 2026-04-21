import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

/* ═══════════════════════════════════════
   SWEED ADAPTER — ATHENA v3
   
   Three extraction strategies (tried in order):
   1. Hydration: Extract __sw_qc JSON from page (Curaleaf, HC)
   2. Text: Parse "Add to Cart" blocks from innerText (Zen Leaf)
   3. Links: DOM a[href] parsing (legacy fallback)
   ═══════════════════════════════════════ */

// ─── STRATEGY 1: HYDRATION DATA EXTRACTION ───
// Curaleaf and HC embed product data as JSON in __sw_qc
// This is the fastest and most reliable approach

async function tryHydrationExtraction(page) {
  return await page.evaluate(function() {
    try {
      var raw = window.__sw_qc;
      if (!raw) return null;
      var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      var queries = parsed.queries || [];
      var productQuery = null;
      for (var i = 0; i < queries.length; i++) {
        var d = queries[i] && queries[i].state && queries[i].state.data;
        if (d && d.list && d.total !== undefined) { productQuery = d; break; }
      }
      if (!productQuery) return null;
      return { list: productQuery.list, total: productQuery.total, page: productQuery.page, pageSize: productQuery.pageSize };
    } catch(e) { return null; }
  });
}

function normalizeHydrationProduct(raw) {
  var variant = raw.variants && raw.variants[0];
  if (!variant) return null;
  
  var price = variant.promoPrice || variant.price;
  var originalPrice = variant.promoPrice ? variant.price : null;
  if (!price || price <= 0) return null;

  var thcVal = null;
  var cbdVal = null;
  if (variant.labTests) {
    if (variant.labTests.thc && variant.labTests.thc.value) {
      thcVal = variant.labTests.thc.value[0] || null;
    }
    if (variant.labTests.cbd && variant.labTests.cbd.value) {
      cbdVal = variant.labTests.cbd.value[0] || null;
    }
  }

  var cat = raw.category ? raw.category.name : 'Other';
  var catMap = {
    'Flower': 'flower', 'Pre-Rolls': 'pre-rolls', 'Infused Pre-Rolls': 'pre-rolls',
    'Vapes': 'vaporizers', 'Vape': 'vaporizers',
    'Edibles': 'edible', 'Edible': 'edible', 'Beverage': 'edible', 'Oral': 'edible', 'Drinks': 'edible',
    'Concentrates': 'concentrate', 'Concentrate': 'concentrate',
    'Tinctures': 'tincture', 'Tincture': 'tincture',
    'Topicals': 'topical', 'Topical': 'topical',
    'Hemp Derived': 'edible', 'Hemp Products': 'edible', 'CBD': 'cbd',
  };
  var mappedCat = catMap[cat] || cat.toLowerCase();

  var weight = variant.name || '';
  if (variant.unitSize) {
    weight = variant.unitSize.value + (variant.unitSize.unitAbbr || 'g').toLowerCase();
  }

  var dealDesc = null;
  if (variant.promoPrice && variant.price > variant.promoPrice) {
    var pctOff = Math.round((1 - variant.promoPrice / variant.price) * 100);
    dealDesc = pctOff + '% Off';
  }
  if (variant.promos && variant.promos.length > 0) {
    dealDesc = variant.promos[0].name || dealDesc;
  }

  return {
    external_id: 'sweed-' + (variant.id || raw.id),
    name: raw.name || '',
    brand: raw.brand ? raw.brand.name : '',
    category: mappedCat,
    strain_type: raw.strain && raw.strain.prevalence ? raw.strain.prevalence.name.toLowerCase() : null,
    thc_pct: thcVal,
    cbd_pct: cbdVal,
    price: price,
    original_price: originalPrice,
    weight_label: weight,
    deal_description: dealDesc,
    in_stock: variant.availableQty > 0,
  };
}

// ─── STRATEGY 2: TEXT-BASED "ADD TO CART" PARSING ───
// Zen Leaf renders products client-side with no hydration data
// We extract innerText and split by "Add to Cart" buttons

function parseTextProducts(text) {
  var products = [];
  var seen = {};
  var blocks = text.split('Add to Cart');

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i].trim();
    if (block.length < 10) continue;
    if (block.length > 400) block = block.substring(block.length - 400);
    if (block.includes('Gift Card') || block.includes('gift card')) continue;
    if (block.includes('Dispensary Menu') && !block.includes('$')) continue;

    var strainMatch = block.match(/\b(Sativa|Indica|Hybrid)\b/i);
    var strain = strainMatch ? strainMatch[1].toLowerCase() : null;
    var thcMatch = block.match(/THC:\s*(\d+\.?\d*)%?/i) || block.match(/THC\s*(\d+\.?\d*)\s*MG/i);
    var cbdMatch = block.match(/CBD:\s*(\d+\.?\d*)%?/i) || block.match(/CBD\s*(\d+\.?\d*)\s*MG/i);

    var prices = block.match(/\$(\d+\.?\d*)/g) || [];
    if (prices.length === 0) continue;

    var salePrice = null;
    var originalPrice = null;
    var discountMatch = block.match(/(\d+)%\s*OFF/i);

    if (prices.length >= 2) {
      var p1 = parseFloat(prices[0].replace('$', ''));
      var p2 = parseFloat(prices[1].replace('$', ''));
      if (p1 < p2) { salePrice = p1; originalPrice = p2; }
      else if (p2 < p1) { salePrice = p2; originalPrice = p1; }
      else { salePrice = p1; }
    } else {
      salePrice = parseFloat(prices[0].replace('$', ''));
    }

    if (!salePrice || salePrice <= 0 || salePrice > 500) continue;

    var brand = '';
    var brandMatch = block.match(/by\s+([A-Za-z][A-Za-z\s.!'&]+?)(?=\n|THC|CBD|\$)/i);
    if (brandMatch) brand = brandMatch[1].trim();

    var name = '';
    var lines = block.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (/^(Sativa|Indica|Hybrid|SALE|Deals|Only \d|from \$|\$|THC|CBD|\d+%|View all|Featured)/.test(line)) continue;
      if (/by\s+\w/.test(line)) continue;
      if (/^\d+\s*(g|mg|ml|pk|Cartridge|Disposable|Gummy)/.test(line)) continue;
      if (/^(Flower|Vape|Edible|Pre-Roll|Concentrate|Tincture|Topical|Accessor)/.test(line) && line.length < 20) continue;
      if (line.length >= 3 && line.length <= 80 && !name) { name = line; }
    }

    if (!name || name.length < 2) continue;
    name = name.substring(0, 80);

    var category = 'other';
    var catPatterns = [
      [/\bFlower\b/i, 'flower'], [/\bGround Flower\b/i, 'flower'],
      [/\bPre.?Roll/i, 'pre-rolls'], [/\bInfused Pre.?Roll/i, 'pre-rolls'],
      [/\bVape|Cartridge|Cart|Disposable\b/i, 'vaporizers'],
      [/\bEdible|Gummy|Gummies|Chocolate|Seltzer|Beverage\b/i, 'edible'],
      [/\bConcentrate|Rosin|Resin|Wax|Badder|Shatter\b/i, 'concentrate'],
      [/\bTincture|Oil|Drops\b/i, 'tincture'],
      [/\bTopical|Balm|Cream\b/i, 'topical'],
    ];
    for (var cp = 0; cp < catPatterns.length; cp++) {
      if (catPatterns[cp][0].test(block)) { category = catPatterns[cp][1]; break; }
    }

    var weightMatch = block.match(/\b(\d+\.?\d*)\s*g\s+(?:Cartridge|Disposable|Cart)/i) ||
                      block.match(/\b(\d+\.?\d*)g\b/i) || block.match(/\b(\d+)\s*mg\b/i) ||
                      block.match(/(\d+)\s*(?:pk|pack)\b/i);
    var weight = weightMatch ? weightMatch[0].trim() : null;

    var externalId = 'sweed-text-' + (name + salePrice).replace(/[^a-z0-9]/gi, '').substring(0, 25);
    if (seen[externalId]) continue;
    seen[externalId] = true;

    products.push({
      external_id: externalId, name: name, brand: brand, category: category,
      strain_type: strain, thc_pct: thcMatch ? parseFloat(thcMatch[1]) : null,
      cbd_pct: cbdMatch ? parseFloat(cbdMatch[1]) : null, price: salePrice,
      original_price: (originalPrice && originalPrice > salePrice) ? originalPrice : null,
      weight_label: weight,
      deal_description: discountMatch ? discountMatch[1] + '% Off' : (originalPrice ? 'Sale' : null),
    });
  }
  return products;
}

// ─── STRATEGY 3: LINK-BASED DOM PARSING (legacy) ───

async function extractProductsFromLinks(pageOrFrame) {
  return await pageOrFrame.evaluate(function() {
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

      var text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 5) continue;

      var catMatch = href.match(/\/menu\/([a-z-]+)-\d+\//);
      var category = catMatch ? catMatch[1] : 'other';
      var strainMatch = text.match(/\b(Sativa|Indica|Hybrid)\b/i);
      var thcMatch = text.match(/THC:\s*(\d+\.?\d*)%?/) || text.match(/THC\s*(\d+\.?\d*)%/);
      var cbdMatch = text.match(/CBD:\s*(\d+\.?\d*)%?/) || text.match(/CBD\s*(\d+\.?\d*)%/);
      var thcMgMatch = text.match(/THC:\s*(\d+\.?\d*)\s*MG/i);
      var prices = text.match(/\$(\d+\.?\d*)/g) || [];
      var discountMatch = text.match(/(\d+)%\s*Off/i);
      var weightMatch = text.match(/\b(\d+\.?\d*)\s*g\b(?!\s*ea)/i) || text.match(/\b(\d+)\s*mg\b/i) || text.match(/(\d+-Pack)/i);
      var priceWeightMatch = text.match(/\$(\d+\.?\d*)\/(\d+\.?\d*\s*(?:g|mg|ml|oz))/i);
      if (priceWeightMatch && !weightMatch) weightMatch = [priceWeightMatch[2]];

      var brandMatch = text.match(/by\s+([A-Za-z][A-Za-z\s.!'&]+?)(?=[A-Z][a-z]{2,})/);
      if (!brandMatch) brandMatch = text.match(/by\s+([A-Za-z][A-Za-z\s.!'&]+?)(?=THC|CBD|\$|\d+%)/);
      var brand = brandMatch ? brandMatch[1].trim() : null;

      var name = '';
      if (brand) {
        var brandIdx = text.indexOf(brand);
        var afterBrand = brandIdx + brand.length;
        var endPoints = [text.indexOf('THC'), text.indexOf('CBD'), text.indexOf('$')].filter(function(x) { return x > afterBrand; });
        var endIdx = endPoints.length > 0 ? Math.min.apply(null, endPoints) : text.length;
        name = text.substring(afterBrand, endIdx).replace(/\b\d+\.?\d*\s*g\b/gi, '').replace(/\b\d+mg\b/gi, '').replace(/^\d+\s*/, '').replace(/\s*\d+$/, '').replace(/^-\s*/, '').trim();
      }
      if (!name || name.length < 2) {
        var slugMatch = href.match(/\/menu\/[^/]+\/[a-z-]+-[a-z]+-(.+?)-\d+(?:\?|$)/);
        if (slugMatch) name = slugMatch[1].replace(/-/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
      }

      var salePrice = null;
      var originalPrice = null;
      if (prices.length >= 2) {
        var p1 = parseFloat(prices[0].replace('$', '')); var p2 = parseFloat(prices[1].replace('$', ''));
        if (p1 < p2) { salePrice = p1; originalPrice = p2; } else { salePrice = p1; }
      } else if (prices.length === 1) { salePrice = parseFloat(prices[0].replace('$', '')); }
      if (!salePrice && !name) continue;

      results.push({
        external_id: 'sweed-' + productId, name: name || 'Unknown Product', brand: brand || '',
        category: category, strain_type: strainMatch ? strainMatch[1].toLowerCase() : null,
        thc_pct: thcMatch ? parseFloat(thcMatch[1]) : (thcMgMatch ? parseFloat(thcMgMatch[1]) : null),
        cbd_pct: cbdMatch ? parseFloat(cbdMatch[1]) : null, price: salePrice,
        original_price: (originalPrice && originalPrice > salePrice) ? originalPrice : null,
        weight_label: weightMatch ? weightMatch[0] : null,
        deal_description: discountMatch ? discountMatch[1] + '% Off' : (originalPrice ? 'Sale' : null),
      });
    }
    return results;
  });
}

// ─── NORMALIZE ───

function normalizeSweedProduct(raw) {
  var normalized = normalizeProduct({
    external_id: raw.external_id, name: raw.name || '', brand: raw.brand || '',
    category: raw.category || '', subcategory: null, strain_type: raw.strain_type || null,
    price: raw.price, original_price: raw.original_price, weight_label: raw.weight_label || null,
    thc_pct: raw.thc_pct, cbd_pct: raw.cbd_pct, in_stock: raw.in_stock !== false,
    deal_description: raw.deal_description || null, image_url: null, product_url: null,
  });
  normalized.category = (raw.category || '').toLowerCase();
  return normalized;
}

// ─── HELPERS ───

async function getTargetFrame(page) {
  try {
    var sweedFrame = page.frame('sweed-iframe-display');
    if (sweedFrame) { console.log('  [sweed] Found sweed iframe'); return sweedFrame; }
  } catch (e) {}
  try {
    var frames = page.frames();
    for (var f = 0; f < frames.length; f++) {
      var frameUrl = frames[f].url() || '';
      if (frameUrl.includes('isIframe=true') || frameUrl.includes('sweed')) {
        console.log('  [sweed] Found sweed iframe by URL');
        return frames[f];
      }
    }
  } catch (e) {}
  return page;
}

async function scrollPage(target, page) {
  try {
    for (var s = 0; s < 15; s++) {
      await target.evaluate(function() { window.scrollBy(0, 600); });
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(1000);
  } catch (e) {}
}

// ─── MAIN SCRAPER ───

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
      var domain = menuUrl.replace(/https?:\/\//, '').split('/')[0];

      try {
        var page = await context.newPage();
        await page.goto(menuUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(5000);

        // ═══ STRATEGY 1: Try hydration extraction ═══
        var hydration = await tryHydrationExtraction(page);
        
        // If no hydration on homepage, try appending /menu for "All Products" page (HC pattern)
        if (!hydration) {
          var allProductsUrl = menuUrl.replace(/\/?$/, '') + '/menu';
          console.log('  [sweed] No hydration on homepage, trying All Products: ' + allProductsUrl);
          await page.goto(allProductsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(5000);
          hydration = await tryHydrationExtraction(page);
        }

        if (hydration && hydration.list && hydration.list.length > 0) {
          console.log('  [sweed] ✓ Hydration found! ' + hydration.list.length + '/' + hydration.total + ' products on page 1');

          // Parse first page products from hydration data
          for (var h = 0; h < hydration.list.length; h++) {
            var prod = normalizeHydrationProduct(hydration.list[h]);
            if (prod && prod.price > 0) {
              var cat = (prod.category || '').toLowerCase();
              if (cat === 'accessories' || cat === 'apparel') continue;
              allProducts.set(prod.external_id, prod);
            }
          }

          // Paginate through remaining pages if needed
          var totalPages = Math.ceil(hydration.total / (hydration.pageSize || 24));
          if (totalPages > 1) {
            var baseUrl = page.url().split('?')[0];
            console.log('  [sweed] Paginating ' + totalPages + ' pages (' + hydration.total + ' total products)...');

            for (var pg = 2; pg <= totalPages; pg++) {
              try {
                var pgUrl = baseUrl + '?page=' + pg;
                await page.goto(pgUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForTimeout(3000);

                var pgHydration = await tryHydrationExtraction(page);
                if (pgHydration && pgHydration.list) {
                  for (var ph = 0; ph < pgHydration.list.length; ph++) {
                    var pgProd = normalizeHydrationProduct(pgHydration.list[ph]);
                    if (pgProd && pgProd.price > 0) {
                      var pgCat = (pgProd.category || '').toLowerCase();
                      if (pgCat === 'accessories' || pgCat === 'apparel') continue;
                      allProducts.set(pgProd.external_id, pgProd);
                    }
                  }
                }
                if (pg % 5 === 0 || pg === totalPages) {
                  console.log('  [sweed] page ' + pg + '/' + totalPages + ': ' + allProducts.size + ' total');
                }
              } catch (pgErr) {
                console.warn('  [sweed] Page ' + pg + ' failed: ' + pgErr.message);
              }
            }
          }

          console.log('  [sweed] ' + domain + ' hydration: ' + allProducts.size + ' products');
          await page.close();
          continue; // Done with this URL, move to next
        }

        // ═══ STRATEGY 2: Text-based parsing (Zen Leaf) ═══
        console.log('  [sweed] No hydration data, trying text/link extraction...');
        await page.waitForTimeout(7000); // Extra wait for JS rendering

        var targetFrame = await getTargetFrame(page);
        await scrollPage(targetFrame, page);

        // Try text-based "Add to Cart" parsing
        var textProducts = [];
        try {
          var text = await targetFrame.evaluate(function() { return document.body ? document.body.innerText : ''; });
          var addToCartCount = (text.match(/Add to Cart/g) || []).length;
          if (addToCartCount > 0) {
            console.log('  [sweed] Found ' + addToCartCount + ' "Add to Cart" blocks');
            textProducts = parseTextProducts(text);
            console.log('  [sweed] Text parser: ' + textProducts.length + ' products');
          }
        } catch (e) { console.warn('  [sweed] Text extraction failed: ' + e.message); }

        // ═══ STRATEGY 3: Link-based DOM parsing (fallback) ═══
        var linkProducts = await extractProductsFromLinks(targetFrame);
        console.log('  [sweed] Link parser: ' + linkProducts.length + ' products');

        // Use whichever method got more products
        var bestProducts = textProducts.length > linkProducts.length ? textProducts : linkProducts;
        console.log('  [sweed] ' + domain + ': using ' + (textProducts.length > linkProducts.length ? 'text' : 'link') + ' parser (' + bestProducts.length + ' products)');

        for (var bp = 0; bp < bestProducts.length; bp++) {
          allProducts.set(bestProducts[bp].external_id, bestProducts[bp]);
        }

        await page.close();
      } catch (err) {
        errors.push(menuUrl + ': ' + err.message);
        console.error('  [sweed] Error: ' + err.message);
      }
    }

    await context.close();
    await browser.close();

    // Normalize and validate all products
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
