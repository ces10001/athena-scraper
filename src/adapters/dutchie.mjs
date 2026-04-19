import { chromium } from 'playwright';
import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

const HASH = '98b4aaef79a84ae804b64d550f98dd64d7ba0aa6d836eb6b5d4b2ae815c95e32';

let browser = null;
let page = null;

async function ensureBrowser() {
  if (!browser) {
    console.log('  [dutchie] Launching Chrome...');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });
    page = await context.newPage();
    await page.goto('https://dutchie.com/dispensary/high-profile-canton', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    try {
      const yesBtn = page.getByRole('button', { name: 'Yes' });
      await yesBtn.click({ timeout: 5000 });
      console.log('  [dutchie] Age gate passed');
      await page.waitForTimeout(2000);
    } catch {
      console.log('  [dutchie] No age gate found');
    }
  }
  return page;
}

async function fetchAllProducts(p, dispensaryId, pricingType) {
  return await p.evaluate(async ({ dispensaryId, hash, pricingType }) => {
    var allProducts = [];
    for (var pg = 0; pg < 20; pg++) {
      var vars = {
        includeEnterpriseSpecials: false,
        productsFilter: {
          dispensaryId: dispensaryId,
          pricingType: pricingType,
          strainTypes: [],
          subcategories: [],
          Status: 'Active',
          types: [],
          useCache: true,
          isDefaultSort: true,
          sortBy: 'popularSortIdx',
          sortDirection: 1,
          bypassOnlineThresholds: false,
          isKioskMenu: false,
          removeProductsBelowOptionThresholds: true,
          platformType: 'ONLINE_MENU',
          preOrderType: null,
        },
        page: pg,
        perPage: 100,
      };
      var ext = { persistedQuery: { version: 1, sha256Hash: hash } };
      var url = '/graphql?operationName=FilteredProducts&variables='
        + encodeURIComponent(JSON.stringify(vars))
        + '&extensions=' + encodeURIComponent(JSON.stringify(ext));
      var res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'apollo-require-preflight': 'true',
          'x-apollo-operation-name': 'FilteredProducts',
        },
      });
      if (!res.ok) return { error: 'HTTP ' + res.status, products: [], total: 0 };
      var data = await res.json();
      if (data.errors) return { error: data.errors[0]?.message, products: [], total: 0 };
      var products = data.data?.filteredProducts?.products || [];
      var total = data.data?.filteredProducts?.queryInfo?.totalCount || 0;
      allProducts = allProducts.concat(products);
      if (products.length < 100 || allProducts.length >= total) break;
    }
    return { products: allProducts, total: allProducts.length };
  }, { dispensaryId, hash: HASH, pricingType });
}

function normalizeDutchieProduct(raw) {
  var recPrice = raw.recPrices?.[0] ?? raw.Prices?.[0] ?? null;
  var medPrice = raw.medicalPrices?.[0] ?? null;
  var recSpecial = raw.recSpecialPrices?.[0] ?? null;
  var medSpecial = raw.medicalSpecialPrices?.[0] ?? null;
  var hasRecSpecial = recSpecial != null && recSpecial > 0;
  var hasMedSpecial = medSpecial != null && medSpecial > 0;

  var normalized = normalizeProduct({
    external_id: raw.id || raw._id,
    name: raw.Name || '',
    brand: raw.brandName || '',
    category: raw.type || '',
    subcategory: raw.subcategory || null,
    strain_type: raw.strainType || null,
    price: hasRecSpecial ? recSpecial : recPrice,
    original_price: hasRecSpecial ? recPrice : null,
    weight_label: raw.Options?.[0] || null,
    thc_pct: raw.THCContent?.range?.[0] ?? null,
    cbd_pct: raw.CBDContent?.range?.[0] ?? null,
    in_stock: raw.Status === 'Active',
    deal_description: raw.special?.name || raw.specialData?.[0]?.name || null,
    image_url: raw.Image || null,
    product_url: null,
  });

  // Override category with raw Dutchie type
  normalized.category = (raw.type || '').toLowerCase();

  // Add medical pricing
  normalized.med_price_cents = medPrice ? Math.round(medPrice * 100) : null;
  normalized.med_original_price_cents = hasMedSpecial ? Math.round(medPrice * 100) : null;
  if (hasMedSpecial) normalized.med_price_cents = Math.round(medSpecial * 100);

  // Flag med-only and rec-only
  normalized.medical_only = raw.medicalOnly || false;
  normalized.rec_only = raw.recOnly || false;

  return normalized;
}

export async function scrapeDutchie(dispensary) {
  console.log('[dutchie] Scraping: ' + dispensary.name);
  var dispensaryId = dispensary.dispensary_id;
  if (!dispensaryId) {
    console.error('  [dutchie] No dispensary_id for ' + dispensary.name);
    return { products: [], errors: ['No dispensary_id'] };
  }
  try {
    var p = await ensureBrowser();
    await p.waitForTimeout(1500);

    // Determine which menu to scrape: if menu_type is set, scrape only that; otherwise both (legacy)
    var menuType = dispensary.menu_type;
    var allProducts = new Map();
    var catCounts = {};

    if (menuType === 'rec' || !menuType) {
      // Scrape rec menu
      var recResult = await fetchAllProducts(p, dispensaryId, 'rec');
      if (recResult.error) {
        console.error('  [dutchie] Rec error: ' + recResult.error);
        return { products: [], errors: [recResult.error] };
      }
      console.log('  [dutchie] Rec products: ' + recResult.total);
      
      for (var raw of recResult.products) {
        allProducts.set(raw.id || raw._id, raw);
      }
    }

    if (menuType === 'med' || !menuType) {
      // Scrape med menu
      if (!menuType) await p.waitForTimeout(1000);
      var medResult = await fetchAllProducts(p, dispensaryId, 'med');
      if (medResult.error && menuType === 'med') {
        console.error('  [dutchie] Med error: ' + medResult.error);
        return { products: [], errors: [medResult.error] };
      }
      console.log('  [dutchie] Med products: ' + medResult.total);
      
      // Add med products: if no menu_type set, only add med-only extras (merge mode)
      // If menu_type='med', include all med products
      if (menuType === 'med') {
        for (var raw of medResult.products) {
          allProducts.set(raw.id || raw._id, raw);
        }
      } else {
        // Legacy merge: add med-only extras
        var medOnlyCount = 0;
        for (var raw of medResult.products) {
          var id = raw.id || raw._id;
          if (!allProducts.has(id)) {
            allProducts.set(id, raw);
            medOnlyCount++;
          }
        }
        if (medOnlyCount > 0) console.log('  [dutchie] Med-only extras: ' + medOnlyCount);
      }
    }

    // Normalize and filter
    var normalized = [];
    for (var raw of allProducts.values()) {
      var prod = normalizeDutchieProduct(raw);
      var cat = (prod.category || '').toLowerCase();
      if (cat === 'accessories' || cat === 'apparel') continue;
      if (validateProduct(prod).length > 0) continue;
      catCounts[prod.category] = (catCounts[prod.category] || 0) + 1;
      normalized.push(prod);
    }

    var catInfo = Object.entries(catCounts).map(function(e) { return e[0] + ': ' + e[1]; }).join(', ');
    console.log('  [dutchie] Categories: ' + catInfo);
    console.log('  [dutchie] Done: ' + normalized.length + ' valid products');
    return { products: normalized, errors: [] };
  } catch (err) {
    console.error('  [dutchie] FAILED: ' + err.message);
    return { products: [], errors: [err.message] };
  }
}

export async function cleanup() {
  if (browser) {
    await browser.close().catch(function() {});
    browser = null;
    page = null;
    console.log('  [dutchie] Browser closed');
  }
}

export default { scrapeDutchie, cleanup };
