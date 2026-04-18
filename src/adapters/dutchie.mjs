import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

const API_URL = 'https://dutchie.com/graphql';
const PERSISTED_HASH = '98b4aaef79a84ae804b64d550f98dd64d7ba0aa6d836eb6b5d4b2ae815c95e32';
const DUTCHIE_TYPES = ['Flower', 'Vaporizers', 'Edibles', 'Pre-Rolls', 'Concentrates', 'Tinctures', 'Topicals', 'Accessories'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms + Math.random() * 1000)); }

async function fetchProducts(dispensaryId, category, page = 0) {
  const variables = {
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
    page,
    perPage: 100,
  };

  const extensions = {
    persistedQuery: { version: 1, sha256Hash: PERSISTED_HASH },
  };

  const url = API_URL
    + '?operationName=FilteredProducts'
    + '&variables=' + encodeURIComponent(JSON.stringify(variables))
    + '&extensions=' + encodeURIComponent(JSON.stringify(extensions));

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://dutchie.com/',
      'Origin': 'https://dutchie.com',
      'apollo-require-preflight': 'true',
      'x-apollo-operation-name': 'FilteredProducts',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0]?.message);

  return {
    products: data.data?.filteredProducts?.products || [],
    total: data.data?.filteredProducts?.queryInfo?.totalCount || 0,
  };
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
    const allProducts = new Map();
    const errors = [];

    for (const cat of DUTCHIE_TYPES) {
      try {
        await sleep(2000);
        const result = await fetchProducts(dispensaryId, cat);
        console.log(`  [dutchie] ${cat}: ${result.products.length}/${result.total}`);

        for (const raw of result.products) {
          const p = normalizeDutchieProduct(raw);
          if (p.external_id) allProducts.set(p.external_id, p);
        }

        if (result.total > 100) {
          for (let pg = 1; pg < Math.ceil(result.total / 100) && pg < 10; pg++) {
            await sleep(1500);
            const next = await fetchProducts(dispensaryId, cat, pg);
            for (const raw of next.products) {
              const p = normalizeDutchieProduct(raw);
              if (p.external_id) allProducts.set(p.external_id, p);
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

export default { scrapeDutchie };
