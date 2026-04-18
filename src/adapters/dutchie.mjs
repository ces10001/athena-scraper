// ATHENA Scraper — Dutchie Adapter (FINAL)
// Built from LIVE browser recon — exact API structure captured from High Profile Canton
//
// API: GET {dispensary-domain}/api-0/graphql?operationName=FilteredProducts&variables=...&extensions=...
// Persisted query hash: 98b4aaef79a84ae804b64d550f98dd64d7ba0aa6d836eb6b5d4b2ae815c95e32
// Product fields: id, Name, brandName, type, subcategory, strainType, Prices, recPrices,
//                 recSpecialPrices, Options, Image, THCContent, CBDContent, special, Status

import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

const PERSISTED_HASH = '98b4aaef79a84ae804b64d550f98dd64d7ba0aa6d836eb6b5d4b2ae815c95e32';

const DUTCHIE_TYPES = [
  'Flower', 'Vaporizers', 'Edibles', 'Pre-Rolls',
  'Concentrates', 'Tinctures', 'Topicals', 'Accessories'
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];

function randomUA() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms + Math.random() * 1000)); }

// ─── Core API call — exact structure from live recon ───
async function fetchProducts(apiBase, dispensaryId, category, page = 0) {
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

  const url = `${apiBase}/api-0/graphql?operationName=FilteredProducts&variables=${encodeURIComponent(JSON.stringify(variables))}&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': randomUA(),
      'Accept': 'application/json',
      'Referer': apiBase + '/',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${apiBase}`);

  const data = await res.json();
  if (data.errors) throw new Error(`GraphQL: ${data.errors[0]?.message}`);

  return {
    products: data.data?.filteredProducts?.products || [],
    total: data.data?.filteredProducts?.queryInfo?.totalCount || 0,
  };
}

// ─── Normalize real Dutchie product to ATHENA schema ───
function normalizeDutchieProduct(raw) {
  const price = raw.recPrices?.[0] ?? raw.Prices?.[0] ?? null;
  const specialPrice = raw.recSpecialPrices?.[0] ?? null;
  const hasSpecial = specialPrice != null && specialPrice > 0;
  const thc = raw.THCContent?.range?.[0] ?? null;
  const cbd = raw.CBDContent?.range?.[0] ?? null;
  const deal = raw.special?.name || raw.specialData?.[0]?.name || null;

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
    thc_pct: thc,
    cbd_pct: cbd,
    in_stock: raw.Status === 'Active',
    deal_description: deal,
    image_url: raw.Image || null,
    product_url: null,
  });
}

// ─── Main entry point ───
export async function scrapeDutchie(dispensary) {
  console.log(`[dutchie] Scraping: ${dispensary.name}`);

  const apiBase = dispensary.api_base;
  const dispensaryId = dispensary.dispensary_id;

  if (!dispensaryId) {
    console.error(`  [dutchie] ❌ No dispensary_id configured for ${dispensary.name}`);
    console.error(`  [dutchie]    HOW TO FIX: Open ${dispensary.menu_url || 'their website'} in Chrome`);
    console.error(`  [dutchie]    DevTools → Network → reload → filter "dispensary_id" → copy the 24-char hex`);
    return { products: [], errors: ['No dispensary_id — see console for instructions'] };
  }

  if (!apiBase) {
    console.error(`  [dutchie] ❌ No api_base configured for ${dispensary.name}`);
    return { products: [], errors: ['No api_base'] };
  }

  try {
    const allProducts = new Map();
    const errors = [];

    for (const cat of DUTCHIE_TYPES) {
      try {
        await sleep(1500);
        const result = await fetchProducts(apiBase, dispensaryId, cat);
        console.log(`  [dutchie] ${cat}: ${result.products.length}/${result.total}`);

        for (const raw of result.products) {
          const p = normalizeDutchieProduct(raw);
          if (p.external_id) allProducts.set(p.external_id, p);
        }

        // Paginate if more than 100
        if (result.total > 100) {
          for (let pg = 1; pg < Math.ceil(result.total / 100) && pg < 10; pg++) {
            await sleep(1000);
            const next = await fetchProducts(apiBase, dispensaryId, cat, pg);
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
    console.log(`  [dutchie] ✅ ${valid.length} valid products`);
    return { products: valid, errors };

  } catch (err) {
    console.error(`  [dutchie] ❌ FAILED: ${err.message}`);
    return { products: [], errors: [err.message] };
  }
}

export default { scrapeDutchie };
