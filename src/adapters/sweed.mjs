import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

/* ═══════════════════════════════════════
   SWEED ADAPTER — ATHENA v4 (HTTP-first)
   
   Uses HTTP fetch instead of Playwright browser.
   The __sw_qc hydration data is server-side rendered in the HTML.
   We extract it with regex — no browser needed.
   Falls back to Playwright if HTTP fails.
   
   ~200ms per page vs ~8s with Playwright = ~40x faster
   ═══════════════════════════════════════ */

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cookie': 'ageGateConfirmed=true',
};

// ─── HTTP FETCH + HYDRATION EXTRACTION ───

async function fetchHydration(url) {
  try {
    var resp = await fetch(url, { headers: HEADERS, redirect: 'follow' });
    if (!resp.ok) return null;
    var html = await resp.text();
    return extractHydrationFromHtml(html);
  } catch (e) {
    return null;
  }
}

function extractHydrationFromHtml(html) {
  // The __sw_qc data is in an inline <script> tag:
  // window.__sw_qc = {"mutations":[],"queries":[...]};
  var match = html.match(/window\.__sw_qc\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!match) {
    match = html.match(/window\.__sw_qc\s*=\s*(\{[\s\S]*?"queries"[\s\S]*?\});\s*(?:window\.|<\/script>)/);
  }
  if (!match) return null;

  try {
    var parsed = JSON.parse(match[1]);
    var queries = parsed.queries || [];
    for (var i = 0; i < queries.length; i++) {
      var d = queries[i] && queries[i].state && queries[i].state.data;
      if (d && d.list && d.total !== undefined) {
        return { list: d.list, total: d.total, page: d.page, pageSize: d.pageSize || 24 };
      }
    }
  } catch (e) {
    try {
      var cleaned = match[1].replace(/,\s*([}\]])/g, '$1');
      var parsed2 = JSON.parse(cleaned);
      var queries2 = parsed2.queries || [];
      for (var j = 0; j < queries2.length; j++) {
        var d2 = queries2[j] && queries2[j].state && queries2[j].state.data;
        if (d2 && d2.list && d2.total !== undefined) {
          return { list: d2.list, total: d2.total, page: d2.page, pageSize: d2.pageSize || 24 };
        }
      }
    } catch (e2) {}
  }
  return null;
}

// ─── PRODUCT NORMALIZATION ───

function normalizeHydrationProduct(raw) {
  var variant = raw.variants && raw.variants[0];
  if (!variant) return null;
  
  var price = variant.promoPrice || variant.price;
  var originalPrice = variant.promoPrice ? variant.price : null;
  if (!price || price <= 0) return null;

  var thcVal = null;
  var cbdVal = null;
  if (variant.labTests) {
    if (variant.labTests.thc && variant.labTests.thc.value) thcVal = variant.labTests.thc.value[0] || null;
    if (variant.labTests.cbd && variant.labTests.cbd.value) cbdVal = variant.labTests.cbd.value[0] || null;
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
  if (variant.unitSize) weight = variant.unitSize.value + (variant.unitSize.unitAbbr || 'g').toLowerCase();

  var dealDesc = null;
  if (variant.promoPrice && variant.price > variant.promoPrice) {
    dealDesc = Math.round((1 - variant.promoPrice / variant.price) * 100) + '% Off';
  }
  if (variant.promos && variant.promos.length > 0) dealDesc = variant.promos[0].name || dealDesc;

  return {
    external_id: 'sweed-' + (variant.id || raw.id),
    name: raw.name || '', brand: raw.brand ? raw.brand.name : '',
    category: mappedCat,
    strain_type: raw.strain && raw.strain.prevalence ? raw.strain.prevalence.name.toLowerCase() : null,
    thc_pct: thcVal, cbd_pct: cbdVal,
    price: price, original_price: originalPrice,
    weight_label: weight, deal_description: dealDesc,
    in_stock: variant.availableQty > 0,
  };
}

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

// ─── URL HELPERS ───

function buildPageUrl(baseUrl, page) {
  return baseUrl.includes('?') ? baseUrl + '&page=' + page : baseUrl + '?page=' + page;
}

// ─── MAIN SCRAPER ───

export async function scrapeSweed(dispensary) {
  console.log('[sweed] Scraping: ' + dispensary.name);

  if (!dispensary.sweed_urls || dispensary.sweed_urls.length === 0) {
    console.error('  [sweed] No sweed_urls for ' + dispensary.name);
    return { products: [], errors: ['No sweed_urls configured'] };
  }

  var allProducts = new Map();
  var errors = [];

  for (var u = 0; u < dispensary.sweed_urls.length; u++) {
    var menuUrl = dispensary.sweed_urls[u];
    var domain = menuUrl.replace(/https?:\/\//, '').split('/')[0];

    try {
      // ═══ TRY HTTP FETCH (fast path) ═══
      var hydration = null;
      var workingUrl = null;

      // Strategy 1: Direct URL
      hydration = await fetchHydration(menuUrl);
      if (hydration) workingUrl = menuUrl;

      // Strategy 2: Append /menu (HC pattern)
      if (!hydration) {
        var allProductsUrl = menuUrl.replace(/\/?$/, '') + '/menu';
        console.log('  [sweed] Trying All Products: ' + allProductsUrl);
        hydration = await fetchHydration(allProductsUrl);
        if (hydration) workingUrl = allProductsUrl;
      }

      // Strategy 3: iframe URL (Zen Leaf pattern)
      if (!hydration) {
        var iframeUrl = menuUrl.replace(/\/?$/, '') + '/menu?isIframe=true';
        console.log('  [sweed] Trying iframe URL: ' + iframeUrl);
        hydration = await fetchHydration(iframeUrl);
        if (hydration) workingUrl = iframeUrl;
      }

      // Strategy 4: Direct + isIframe
      if (!hydration) {
        var directIframe = menuUrl.replace(/\/?$/, '') + '?isIframe=true';
        hydration = await fetchHydration(directIframe);
        if (hydration) workingUrl = directIframe;
      }

      if (hydration && hydration.list && hydration.list.length > 0) {
        console.log('  [sweed] ✓ HTTP hydration! ' + hydration.list.length + '/' + hydration.total + ' products (page 1)');

        // Parse first page
        for (var h = 0; h < hydration.list.length; h++) {
          var prod = normalizeHydrationProduct(hydration.list[h]);
          if (prod && prod.price > 0) {
            var cat = (prod.category || '').toLowerCase();
            if (cat === 'accessories' || cat === 'apparel') continue;
            allProducts.set(prod.external_id, prod);
          }
        }

        // Paginate via HTTP
        var totalPages = Math.ceil(hydration.total / (hydration.pageSize || 24));
        if (totalPages > 1) {
          console.log('  [sweed] Paginating ' + totalPages + ' pages (' + hydration.total + ' total)...');
          for (var pg = 2; pg <= totalPages; pg++) {
            try {
              var pgHydration = await fetchHydration(buildPageUrl(workingUrl, pg));
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

        console.log('  [sweed] ' + domain + ' HTTP: ' + allProducts.size + ' products');
        continue;
      }

      // ═══ FALLBACK: Playwright browser ═══
      console.log('  [sweed] HTTP failed, falling back to Playwright...');
      await scrapeWithPlaywright(menuUrl, domain, allProducts, errors);

    } catch (err) {
      errors.push(menuUrl + ': ' + err.message);
      console.error('  [sweed] Error: ' + err.message);
    }
  }

  // Normalize and validate
  var validProducts = [];
  var catCounts = {};
  for (var [key, raw] of allProducts) {
    var vCat = (raw.category || '').toLowerCase();
    if (vCat === 'accessories' || vCat === 'apparel') continue;
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
}

// ─── PLAYWRIGHT FALLBACK ───

async function scrapeWithPlaywright(menuUrl, domain, allProducts, errors) {
  try {
    var { chromium } = await import('playwright');
    var browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });
    var page = await context.newPage();

    var tryExtract = async function(url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);
      return await page.evaluate(function() {
        try {
          var raw = window.__sw_qc;
          if (!raw) return null;
          var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          var queries = parsed.queries || [];
          for (var i = 0; i < queries.length; i++) {
            var d = queries[i] && queries[i].state && queries[i].state.data;
            if (d && d.list && d.total !== undefined) return { list: d.list, total: d.total, pageSize: d.pageSize };
          }
        } catch(e) {}
        return null;
      });
    };

    var hydration = await tryExtract(menuUrl);
    if (!hydration) hydration = await tryExtract(menuUrl.replace(/\/?$/, '') + '/menu');
    if (!hydration) hydration = await tryExtract(menuUrl.replace(/\/?$/, '') + '/menu?isIframe=true');

    // ═══ IFRAME STRATEGY (Zen Leaf pattern) ═══
    // Zen Leaf embeds Sweed in an iframe called 'sweed-iframe-display'
    // The iframe only exists on the /menu subpage, and needs time to hydrate
    if (!hydration) {
      console.log('  [sweed] Trying iframe frame extraction...');
      
      // Try both the base URL and /menu URL for finding the iframe
      var iframePages = [
        menuUrl.replace(/\/?$/, '') + '/menu',
        menuUrl,
      ];
      
      for (var ip = 0; ip < iframePages.length && !hydration; ip++) {
        try {
          await page.goto(iframePages[ip], { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(5000);
          
          // Poll for the iframe and its hydration data (up to 20 seconds)
          for (var poll = 0; poll < 6 && !hydration; poll++) {
            var sweedFrame = page.frame('sweed-iframe-display');
            if (!sweedFrame) {
              var frames = page.frames();
              for (var fi = 0; fi < frames.length; fi++) {
                var fUrl = frames[fi].url() || '';
                if (fUrl.includes('isIframe=true') || fUrl.includes('sweed')) {
                  sweedFrame = frames[fi];
                  break;
                }
              }
            }
            
            if (sweedFrame) {
              if (poll === 0) console.log('  [sweed] Found sweed iframe, waiting for hydration...');
              try {
                hydration = await sweedFrame.evaluate(function() {
                  try {
                    var raw = window.__sw_qc;
                    if (!raw) return null;
                    var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    var queries = parsed.queries || [];
                    for (var i = 0; i < queries.length; i++) {
                      var d = queries[i] && queries[i].state && queries[i].state.data;
                      if (d && d.list && d.total !== undefined) return { list: d.list, total: d.total, pageSize: d.pageSize };
                    }
                  } catch(e) {}
                  return null;
                });
              } catch (frameErr) {}
            }
            
            if (!hydration) await page.waitForTimeout(3000);
          }
          
          if (hydration) console.log('  [sweed] ✓ Iframe hydration found after ' + ((poll + 1) * 3) + 's');
        } catch (iframeErr) {
          console.warn('  [sweed] Iframe page ' + iframePages[ip] + ' failed: ' + iframeErr.message);
        }
      }
    }

    if (hydration && hydration.list && hydration.list.length > 0) {
      console.log('  [sweed] ✓ Playwright hydration! ' + hydration.list.length + '/' + hydration.total);
      for (var h = 0; h < hydration.list.length; h++) {
        var prod = normalizeHydrationProduct(hydration.list[h]);
        if (prod && prod.price > 0) {
          var cat = (prod.category || '').toLowerCase();
          if (cat === 'accessories' || cat === 'apparel') continue;
          allProducts.set(prod.external_id, prod);
        }
      }

      var totalPages = Math.ceil(hydration.total / (hydration.pageSize || 24));
      if (totalPages > 1) {
        var currentUrl = page.url();
        var baseUrl = currentUrl.split('?')[0];
        var existingParams = currentUrl.includes('?') ? currentUrl.split('?')[1].replace(/[&?]?page=\d+/, '') : '';
        var joiner = existingParams ? baseUrl + '?' + existingParams + '&' : baseUrl + '?';

        for (var pg = 2; pg <= totalPages; pg++) {
          try {
            await page.goto(joiner + 'page=' + pg, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(3000);
            var pgH = await page.evaluate(function() {
              try {
                var raw = window.__sw_qc;
                if (!raw) return null;
                var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                for (var i = 0; i < parsed.queries.length; i++) {
                  var d = parsed.queries[i]?.state?.data;
                  if (d && d.list) return { list: d.list };
                }
              } catch(e) {}
              return null;
            });
            if (pgH && pgH.list) {
              for (var ph = 0; ph < pgH.list.length; ph++) {
                var pgProd = normalizeHydrationProduct(pgH.list[ph]);
                if (pgProd && pgProd.price > 0) {
                  var pgCat = (pgProd.category || '').toLowerCase();
                  if (pgCat === 'accessories' || pgCat === 'apparel') continue;
                  allProducts.set(pgProd.external_id, pgProd);
                }
              }
            }
          } catch (pgErr) {}
        }
      }
      console.log('  [sweed] ' + domain + ' Playwright: ' + allProducts.size + ' products');
    }

    await page.close();
    await context.close();
    await browser.close();
  } catch (err) {
    errors.push(domain + ' PW: ' + err.message);
    console.error('  [sweed] Playwright failed: ' + err.message);
  }
}
