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

async function fetchAllProducts(p, dispensaryId) {
  return await p.evaluate(async ({ dispensaryId, hash }) => {
    var allProducts = [];
    for (var pg = 0; pg < 20; pg++) {
      var vars = {
        includeEnterpriseSpecials: false,
        productsFilter: {
          dispensaryId: dispensaryId,
          pricingType: 'rec',
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
    var cats = {};
    allProducts.forEach(function(p) { var t = p.type || 'Other'; cats[t] = (cats[t] || 0) + 1; });
    return { products: allProducts, total: allProducts.length, categories: cats };
  }, { dispensaryId, hash: HASH });
}

function normalizeDutchieProduct(raw) {
  var price = raw.recPrices?.[0] ?? raw.Prices?.[0] ?? null;
  var specialPrice = raw.recSpecialPrices?.[0] ?? null;
  var hasSpecial = specialPrice != null && specialPrice > 0;
  return normalizeProduct({
    external_id: raw.id || raw._id,
    name: raw.Name || '',
    brand: raw.brandName || '',
    category: raw.type || '',
    subcategory: raw.subcategory || null,
    strain_type: raw.strainType || null,
    price: hasSpecial ? specialPrice : price,
    original_price: hasSpecial ? price : null,
    weight_label: raw.Options?.[0] || null,
    thc_pct: raw.THCContent?.range?.[0] ?? null,
    cbd_pct: raw.CBDContent?.range?.[0] ?? null,
    in_stock: raw.Status === 'Active',
    deal_description: raw.special?.name || raw.specialData?.[0]?.name || null,
    image_url: raw.Image || null,
    product_url: null,
  });
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
    var result = await fetchAllProducts(p, dispensaryId);
    if (result.error) {
      console.error('  [dutchie] API error: ' + result.error);
      return { products: [], errors: [result.error] };
    }
    var catInfo = Object.entries(result.categories || {}).map(function(e) { return e[0] + ': ' + e[1]; }).join(', ');
    console.log('  [dutchie] Categories: ' + catInfo);
    console.log('  [dutchie] Raw products: ' + result.total);

    var normalized = result.products.map(normalizeDutchieProduct);
    var valid = normalized.filter(function(p) {
      if (validateProduct(p).length > 0) return false;
      var cat = (p.category || '').toLowerCase();
      if (cat === 'accessories' || cat === 'apparel') return false;
      return true;
    });

    console.log('  [dutchie] Done: ' + valid.length + ' valid products (excluded accessories/apparel)');
    return { products: valid, errors: [] };
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
