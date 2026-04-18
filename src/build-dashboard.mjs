#!/usr/bin/env node
// build-dashboard.mjs
// Transforms individual dispensary JSON files from data/results/
// into the single dashboard_data.json the ATHENA UI expects.

import { readFile, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';

const RESULTS_DIR = './data/results';
const OUTPUT_FILE = './dashboard_data.json';

// Dispensary display names and cities (mapped from slug)
const DISP_INFO = {
  'high-profile-canton': { name: 'High Profile - Canton', city: 'Canton' },
  'high-profile-hamden': { name: 'High Profile - Hamden', city: 'Hamden' },
  'high-profile-stratford': { name: 'High Profile - Stratford', city: 'Stratford' },
  'shangri-la-norwalk-main-ave': { name: 'Shangri-La - Norwalk', city: 'Norwalk' },
  'shangri-la-south-norwalk': { name: 'Shangri-La - South Norwalk', city: 'South Norwalk' },
  'shangri-la-waterbury': { name: 'Shangri-La - Waterbury', city: 'Waterbury' },
  'shangri-la-plainville': { name: 'Shangri-La - Plainville', city: 'Plainville' },
  'shangri-la-east-hartford': { name: 'Shangri-La - East Hartford', city: 'East Hartford' },
  'sweetspot-stamford': { name: 'SweetSpot - Stamford', city: 'Stamford' },
  'nova-farms-new-britain': { name: 'Nova Farms - New Britain', city: 'New Britain' },
  'still-river-wellness': { name: 'Still River Wellness', city: 'Torrington' },
  'crisp-cannabis-bridgeport': { name: 'Crisp Cannabis - Bridgeport', city: 'Bridgeport' },
  'crisp-cannabis-trumbull': { name: 'Crisp Cannabis - Trumbull', city: 'Stratford' },
  'crisp-cannabis-east-hartford': { name: 'Crisp Cannabis - East Hartford', city: 'East Hartford' },
  'crisp-cannabis-cromwell': { name: 'Crisp Cannabis - Cromwell', city: 'Middletown' },
  'affinity-dispensary': { name: 'Affinity Dispensary - Bridgeport (Rec)', city: 'Bridgeport' },
};

function getDispInfo(slug) {
  if (DISP_INFO[slug]) return DISP_INFO[slug];
  // Generate from slug
  var name = slug.replace(/-+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { name, city: 'CT' };
}

// Normalize product name for cross-dispensary matching
function normalizeName(name, brand) {
  var s = (name || '').toLowerCase();
  // Remove batch numbers, weights, warnings
  s = s.replace(/\|\s*warning[^|]*/gi, '');
  s = s.replace(/\|\s*\d+/g, '');
  s = s.replace(/\b\d{4,}\b/g, ''); // batch numbers
  s = s.replace(/\b\d+\.?\d*\s*(g|mg|ml|oz)\b/gi, '');
  s = s.replace(/\bpre-?pack\b/gi, '');
  s = s.replace(/[-_|]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // Combine with brand for uniqueness
  var key = ((brand || '') + ' ' + s).toLowerCase().trim();
  return key;
}

// Map our category names to the dashboard's expected categories
function mapCategory(cat) {
  var c = (cat || '').toLowerCase();
  if (c === 'flower') return 'Flower';
  if (c === 'vape' || c === 'vaporizers') return 'Vaporizers';
  if (c === 'edible' || c === 'edibles') return 'Edibles';
  if (c === 'pre-roll' || c === 'pre-rolls') return 'Pre-Rolls';
  if (c === 'concentrate' || c === 'concentrates') return 'Concentrates';
  if (c === 'tincture' || c === 'tinctures') return 'Tinctures';
  if (c === 'topical' || c === 'topicals') return 'Topicals';
  if (c === 'gear' || c === 'accessories') return 'Accessories';
  return cat || 'Other';
}

async function main() {
  console.log('Building dashboard_data.json...');

  if (!existsSync(RESULTS_DIR)) {
    console.error('No results directory found');
    process.exit(1);
  }

  var files = (await readdir(RESULTS_DIR)).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.error('No result files found');
    process.exit(1);
  }

  console.log('Found ' + files.length + ' dispensary files');

  // Load all dispensary data
  var allDisps = {};
  var allRawProducts = [];

  for (var file of files) {
    var slug = file.replace('.json', '');
    var info = getDispInfo(slug);
    var raw = JSON.parse(await readFile(RESULTS_DIR + '/' + file, 'utf-8'));

    if (!Array.isArray(raw) || raw.length === 0) continue;

    allDisps[info.name] = {
      city: info.city,
      product_count: raw.length,
      daily_sales: 0,
    };

    for (var product of raw) {
      allRawProducts.push({
        ...product,
        _dispensary: info.name,
        _price: product.price_cents ? product.price_cents / 100 : null,
        _origPrice: product.original_price_cents ? product.original_price_cents / 100 : null,
      });
    }
  }

  console.log('Loaded ' + allRawProducts.length + ' total products from ' + Object.keys(allDisps).length + ' dispensaries');

  // Merge products across dispensaries by normalized name
  var productMap = {};

  for (var p of allRawProducts) {
    if (!p._price) continue;

    var key = normalizeName(p.name, p.brand);
    if (!productMap[key]) {
      productMap[key] = {
        name: p.name,
        brand: p.brand || '',
        category: mapCategory(p.category),
        dispensaries: {},
        promos: {},
      };
    }

    // Use the best name (longest, most descriptive)
    if (p.name && p.name.length > productMap[key].name.length) {
      productMap[key].name = p.name;
    }

    // Set price for this dispensary
    productMap[key].dispensaries[p._dispensary] = p._price;

    // Set promo price if on sale
    if (p.on_sale && p._origPrice && p._price < p._origPrice) {
      productMap[key].promos[p._dispensary] = p._price;
      productMap[key].dispensaries[p._dispensary] = p._origPrice;
    }
  }

  var products = Object.values(productMap);
  console.log('Merged into ' + products.length + ' unique products');

  // Count comparable (available at 2+ dispensaries)
  var comparable = products.filter(p => Object.keys(p.dispensaries).length >= 2).length;

  // Build deals list
  var deals = [];
  for (var p of allRawProducts) {
    if (p.on_sale && p._origPrice && p._price && p._price < p._origPrice) {
      var pctOff = Math.round((1 - p._price / p._origPrice) * 100);
      if (pctOff > 0 && pctOff < 100) {
        deals.push({
          product: p.name,
          brand: p.brand || '',
          dispensary: p._dispensary,
          category: mapCategory(p.category),
          pct_off: pctOff,
          discounted: Math.round(p._price * 100) / 100,
          original: Math.round(p._origPrice * 100) / 100,
        });
      }
    }
  }

  // Build dispensary counts
  var dispensaryCounts = {};
  for (var [name, info] of Object.entries(allDisps)) {
    dispensaryCounts[name] = info.product_count;
  }

  // Build output
  var output = {
    scraped_at: new Date().toISOString(),
    stats: {
      total_active: allRawProducts.length,
      dispensary_count: Object.keys(allDisps).length,
      comparable: comparable,
      deals: deals.length,
      dispensary_counts: dispensaryCounts,
    },
    products: products,
    dispensaries: allDisps,
    deals: deals,
    velocity: [],
    stock_alerts: [],
  };

  await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log('Written to ' + OUTPUT_FILE);
  console.log('  Products: ' + products.length);
  console.log('  Comparable: ' + comparable);
  console.log('  Deals: ' + deals.length);
  console.log('  Dispensaries: ' + Object.keys(allDisps).length);
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
