import { chromium } from 'playwright';
import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

const DUTCHIE_TYPES = ['Flower', 'Vaporizers', 'Edibles', 'Pre-Rolls', 'Concentrates', 'Tinctures', 'Topicals', 'Accessories'];

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

    // Navigate to dutchie.com and click age gate once
    await page.goto('https://dutchie.com/dispensary/high-profile-canton', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click Yes on age gate
    try {
      const yesBtn = page.getByRole('button', { name: 'Yes' });
      await yesBtn.click({ timeout: 5000 });
      console.log('  [dutchie] Age gate passed');
      await page.waitForTimeout(2000);
    } catch {
      console.log('  [dutchie] No age gate found, continuing');
    }
  }
  return page;
}

async function fetchProducts(p, dispensaryId, category) {
  const result = await p.evaluate(async ({ dispensaryId, category, hash }) => {
    const vars = {
      includeEnterpriseSpecials: false,
      productsFilter: {
        dispensaryId,
        pricingType: 'rec',
        strainTypes: [],
        subcategories: [],
        Status: 'Active',
        types: category ? [category] : [],
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
      page: 0,
      perPage: 100,
    };
    const ext = { persistedQuery: { version: 1, sha256Hash: hash } };
    const url = '/graphql?operationName=FilteredProducts&variables='
      + encodeURIComponent(JSON.stringify(vars))
      + '&extensions=' + encodeURIComponent(JSON.stringify(ext));

    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'apollo-require-preflight': 'true',
        'x-apollo-operation-name': 'FilteredProducts',
      },
    });

    if (!res.ok) return { error: 'HTTP ' + res.status, products: [], total: 0 };
    const data = await res.json();
    if (data.errors) return { error: data.errors[0]?.message, products: [], total: 0 };

    return {
      products: data.data?.filteredProducts?.products || [],
      total: data.data?.filteredProducts?.queryInfo?.totalCount || 0,
    };
  }, {
    dispensaryId,
    category,
    hash: '98b4aaef79a84ae804b64d550f98dd64d7ba0aa6d836eb6b5d4b2ae815c95e32',
  });

  if (result.error) throw new Error(result.error);
  return result;
}

function normalizeDutchieProduct(raw) {
  const price = raw.recPrices?.[0] ?? raw.Prices?.[0] ?? null;
  const specialPrice = raw.recSpecialPrices?.[0] ?? null;
  const hasSpecial = specialPrice != null && specialPrice > 0;

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
  console.log(`[dutchie] Scraping: ${dispensary.name}`);

  const dispensaryId = dispensary.dispensary_id;
  if (!dispensaryId) {
    console.error(`  [dutchie] No dispensary_id for ${dispensary.name}`);
    return { products: [], errors: ['No dispensary_id'] };
  }

  try {
    const p = await ensureBrowser();
    const allProducts = new Map();
    const errors = [];

    for (const cat of DUTCHIE_TYPES) {
      try {
        await p.waitForTimeout(1500);
        const result = await fetchProducts(p, dispensaryId, cat);
        console.log(`  [dutchie] ${cat}: ${result.products.length}/${result.total}`);

        for (const raw of result.products) {
          const prod = normalizeDutchieProduct(raw);
          if (prod.external_id) allProducts.set(prod.external_id, prod);
        }

        if (result.total > 100) {
          for (let pg = 1; pg < Math.ceil(result.total / 100) && pg < 10; pg++) {
            await p.waitForTimeout(1000);
            // For pagination, re-evaluate with page param
            const next = await p.evaluate(async ({ dispensaryId, category, hash, pg }) => {
              const vars = {
                includeEnterpriseSpecials: false,
                productsFilter: {
                  dispensaryId, pricingType: 'rec', strainTypes: [], subcategories: [],
                  Status: 'Active', types: [category], useCache: true, isDefaultSort: true,
                  sortBy: 'popularSortIdx', sortDirection: 1, bypassOnlineThresholds: false,
                  isKioskMenu: false, removeProductsBelowOptionThresholds: true,
                  platformType: 'ONLINE_MENU', preOrderType: null,
                },
                page: pg, perPage: 100,
              };
              const ext = { persistedQuery: { version: 1, sha256Hash: hash } };
              const url = '/graphql?operationName=FilteredProducts&variables='
                + encodeURIComponent(JSON.stringify(vars))
                + '&extensions=' + encodeURIComponent(JSON.stringify(ext));
              const res = await fetch(url, {
                headers: { 'Accept': 'application/json', 'apollo-require-preflight': 'true', 'x-apollo-operation-name': 'FilteredProducts' },
              });
              if (!res.ok) return { products: [] };
              const data = await res.json();
              return { products: data.data?.filteredProducts?.products || [] };
            }, { dispensaryId, category: cat, hash: '98b4aaef79a84ae804b64d550f98dd64d7ba0aa6d836eb6b5d4b2ae815c95e32', pg });

            for (const raw of next.products) {
              const prod = normalizeDutchieProduct(raw);
              if (prod.external_id) allProducts.set(prod.external_id, prod);
            }
          }
        }
      } catch (err) {
        errors.push(`${cat}: ${err.message}`);
      }
    }

    const products = Array.from(allProducts.values());
    const valid = products.filter(p => validateProduct(p).length === 0);
    console.log(`  [dutchie] Done: ${valid.length} valid products`);
    return { products: valid, errors };
  } catch (err) {
    console.error(`  [dutchie] FAILED: ${err.message}`);
    return { products: [], errors: [err.message] };
  }
}

// Close browser when process exits
process.on('exit', () => { if (browser) browser.close().catch(() => {}); });
process.on('SIGINT', async () => { if (browser) await browser.close(); process.exit(); });

export default { scrapeDutchie };
