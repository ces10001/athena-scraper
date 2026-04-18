// Normalizes product data from any adapter into the ATHENA standard schema
// Every adapter MUST return products matching this shape

/**
 * @typedef {Object} NormalizedProduct
 * @property {string} external_id     - Platform-specific product ID
 * @property {string} name            - Product name
 * @property {string} brand           - Brand name
 * @property {string} category        - Normalized: flower|vape|edible|pre-roll|concentrate|tincture|topical|gear
 * @property {string} subcategory     - More specific (e.g., "disposable vape", "gummy")
 * @property {string} strain_type     - indica|sativa|hybrid|cbd|null
 * @property {number} price_cents     - Current price in cents
 * @property {number|null} original_price_cents - Pre-discount price if on sale
 * @property {string} weight_label    - Display weight ("3.5g", "1oz")
 * @property {number|null} weight_grams - Normalized weight in grams
 * @property {number|null} unit_price_per_gram - Price per gram in cents
 * @property {number|null} thc_pct    - THC percentage
 * @property {number|null} cbd_pct    - CBD percentage
 * @property {boolean} in_stock
 * @property {boolean} on_sale
 * @property {string|null} deal_description
 * @property {string|null} image_url
 * @property {string|null} product_url
 */

// Category normalization map
const CATEGORY_MAP = {
  // Jane categories
  'flower': 'flower',
  'pre-roll': 'pre-roll',
  'pre-rolls': 'pre-roll',
  'preroll': 'pre-roll',
  'pre roll': 'pre-roll',
  'vape': 'vape',
  'vapes': 'vape',
  'vape pen': 'vape',
  'vape pens': 'vape',
  'disposable vape': 'vape',
  'cartridge': 'vape',
  'edible': 'edible',
  'edibles': 'edible',
  'gummy': 'edible',
  'gummies': 'edible',
  'chocolate': 'edible',
  'beverage': 'edible',
  'drink': 'edible',
  'drinks': 'edible',
  'concentrate': 'concentrate',
  'concentrates': 'concentrate',
  'wax': 'concentrate',
  'shatter': 'concentrate',
  'live resin': 'concentrate',
  'rosin': 'concentrate',
  'tincture': 'tincture',
  'tinctures': 'tincture',
  'topical': 'topical',
  'topicals': 'topical',
  'gear': 'gear',
  'accessories': 'gear',
  'accessory': 'gear',
  'wellness': 'topical',
};

const STRAIN_MAP = {
  'indica': 'indica',
  'sativa': 'sativa',
  'hybrid': 'hybrid',
  'cbd': 'cbd',
  'i': 'indica',
  's': 'sativa',
  'h': 'hybrid',
};

// Common weight patterns
const WEIGHT_PATTERNS = [
  { regex: /(\d+(?:\.\d+)?)\s*oz/i, multiplier: 28.3495 },
  { regex: /(\d+(?:\.\d+)?)\s*g(?:ram)?s?\b/i, multiplier: 1 },
  { regex: /(\d+(?:\.\d+)?)\s*mg/i, multiplier: 0.001 },
  { regex: /(\d+(?:\.\d+)?)\s*lb/i, multiplier: 453.592 },
];

// Well-known weight labels
const WEIGHT_LABEL_MAP = {
  'eighth': 3.5,
  '1/8': 3.5,
  '1/8 oz': 3.5,
  'quarter': 7,
  '1/4': 7,
  '1/4 oz': 7,
  'half': 14,
  '1/2': 14,
  '1/2 oz': 14,
  'ounce': 28,
  '1 oz': 28,
};

export function normalizeCategory(raw) {
  if (!raw) return 'other';
  const lower = raw.toLowerCase().trim();
  return CATEGORY_MAP[lower] || 'other';
}

export function normalizeStrainType(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  return STRAIN_MAP[lower] || null;
}

export function parseWeight(label) {
  if (!label) return null;
  const lower = label.toLowerCase().trim();

  // Check known labels first
  if (WEIGHT_LABEL_MAP[lower]) return WEIGHT_LABEL_MAP[lower];

  // Try regex patterns
  for (const { regex, multiplier } of WEIGHT_PATTERNS) {
    const match = lower.match(regex);
    if (match) return parseFloat(match[1]) * multiplier;
  }

  return null;
}

export function computeUnitPrice(priceCents, weightGrams) {
  if (!priceCents || !weightGrams || weightGrams <= 0) return null;
  return Math.round(priceCents / weightGrams);
}

export function parsePriceToCents(priceStr) {
  if (typeof priceStr === 'number') return Math.round(priceStr * 100);
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : Math.round(num * 100);
}

export function parsePercent(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return null;
  const match = raw.toString().match(/([\d.]+)\s*%?/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Full normalization pipeline â€” call this from each adapter
 * with the raw product fields. Missing fields get sane defaults.
 */
export function normalizeProduct(raw) {
  const priceCents = raw.price_cents ?? parsePriceToCents(raw.price);
  const origCents = raw.original_price_cents ?? parsePriceToCents(raw.original_price);
  const weightGrams = raw.weight_grams ?? parseWeight(raw.weight_label || raw.weight);
  const category = raw.category ? normalizeCategory(raw.category) : 'other';

  return {
    external_id: String(raw.external_id || raw.id || ''),
    name: (raw.name || '').trim(),
    brand: (raw.brand || '').trim() || null,
    category,
    subcategory: raw.subcategory || null,
    strain_type: normalizeStrainType(raw.strain_type || raw.strain),
    price_cents: priceCents,
    original_price_cents: origCents,
    weight_label: raw.weight_label || raw.weight || null,
    weight_grams: weightGrams ? Math.round(weightGrams * 100) / 100 : null,
    unit_price_per_gram: computeUnitPrice(priceCents, weightGrams),
    thc_pct: parsePercent(raw.thc_pct || raw.thc),
    cbd_pct: parsePercent(raw.cbd_pct || raw.cbd),
    in_stock: raw.in_stock !== false,
    on_sale: !!(origCents && priceCents && origCents > priceCents),
    deal_description: raw.deal_description || raw.deal || null,
    image_url: raw.image_url || null,
    product_url: raw.product_url || null,
  };
}

/**
 * Validate a normalized product â€” returns array of issues (empty = valid)
 */
export function validateProduct(product) {
  const issues = [];
  if (!product.name) issues.push('missing name');
  if (!product.external_id) issues.push('missing external_id');
  if (product.price_cents === null) issues.push('missing price');
  if (product.price_cents < 0) issues.push('negative price');
  if (product.price_cents > 100000) issues.push(`suspicious price: $${product.price_cents / 100}`);
  if (product.thc_pct && product.thc_pct > 100) issues.push(`impossible THC: ${product.thc_pct}%`);
  if (product.weight_grams && product.weight_grams > 500) issues.push(`suspicious weight: ${product.weight_grams}g`);
  return issues;
}
