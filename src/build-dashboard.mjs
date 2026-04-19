#!/usr/bin/env node
import { readFile, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';

const RESULTS_DIR = './data/results';
const OUTPUT_FILE = './dashboard_data.json';

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
  return { name: slug.replace(/-+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), city: 'CT' };
}

// ─── Skip categories ───
const SKIP_CATS = new Set(['accessories', 'apparel', 'gear']);

function shouldSkip(cat) {
  return SKIP_CATS.has((cat || '').toLowerCase());
}

// ─── Fuzzy product matching ───
const NOISE_WORDS = new Set([
  'warning', 'high', 'thc', 'cbd', 'pre', 'pack', 'prepack', 'whole',
  'flower', 'premium', 'reserve', 'select', 'grind', 'mini', 'minis',
  'cartridge', 'cart', 'vape', 'disposable', 'pod', 'roll', 'rolls',
  'infused', 'gummy', 'gummies', 'edible', 'chocolate', 'chew', 'chews',
  'tincture', 'topical', 'concentrate', 'wax', 'shatter', 'rosin', 'resin',
  'live', 'cured', 'badder', 'budder', 'sugar', 'sauce', 'diamond', 'diamonds',
  'capsule', 'capsules', 'tablet', 'tablets', 'softgel', 'softgels',
  'rec', 'med', 'adult', 'use', 'only',
  'indica', 'sativa', 'hybrid', 'balanced',
  'pk', 'ct', 'ea', 'pck',
]);

const KNOWN_BRANDS = [
  'rythm', 'good green', 'agl', 'advanced grow labs', 'affinity', 'affinity grow',
  'curaleaf', 'select', 'grassroots', 'theraplant', 'ctpharma', 'ct pharma',
  'prime wellness', 'matter', 'kind tree', 'verano', 'encore', 'incredibles',
  'wana', 'dogwalkers', 'mindy', 'cookies', 'tyson', 'all hours', 'all:hours',
  'back forty', 'comffy', 'brix', 'earl baker', 'lucky break', 'soundview',
  'inc edibles', 'inc.edibles', 'happy confection', 'galaxeats', 'pulsar',
];

function extractStrainTokens(name, brand) {
  var s = (name || '').toLowerCase();
  var brandLower = (brand || '').toLowerCase();
  if (brandLower && s.includes(brandLower)) s = s.replace(brandLower, '');
  for (var kb of KNOWN_BRANDS) { if (s.includes(kb)) s = s.replace(kb, ''); }
  s = s.replace(/[A-Z]*\d{5,}/gi, '');
  s = s.replace(/\b\d{4,}\b/g, '');
  s = s.replace(/\b\d+\.?\d*\s*(?:g|mg|ml|oz|lb)\b/gi, '');
  s = s.replace(/\b[tcbdTCBD]+\s*\d+\.?\d*\s*%?/g, '');
  s = s.replace(/\d+\.?\d*\s*%/g, '');
  s = s.replace(/\b\d+\s*pk\b/gi, '');
  s = s.replace(/\([ISHC]\)/gi, '');
  s = s.replace(/\((?:indica|sativa|hybrid|cbd)\)/gi, '');
  s = s.replace(/warning[^|]*/gi, '');
  s = s.replace(/[|()[\]{}]/g, ' ');
  s = s.replace(/[-_/]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s.split(' ').filter(function(w) {
    return w.length > 1 && !NOISE_WORDS.has(w) && !/^\d+$/.test(w);
  });
}

function makeMatchKey(brand, name, category) {
  var tokens = extractStrainTokens(name, brand);
  var brandKey = (brand || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15);
  var catKey = (category || '').toLowerCase().substring(0, 5);
  tokens.sort();
  return brandKey + '|' + catKey + '|' + tokens.join(' ');
}

function tokenSimilarity(a, b) {
  if (a.length === 0 || b.length === 0) return 0;
  var setA = new Set(a);
  var setB = new Set(b);
  var intersection = 0;
  setA.forEach(function(t) { if (setB.has(t)) intersection++; });
  var union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
}

function mapCategory(cat) {
  var map = {
    'flower': 'Flower', 'vaporizers': 'Vaporizers', 'vape': 'Vaporizers',
    'edible': 'Edible', 'edibles': 'Edible',
    'pre-rolls': 'Pre-Rolls', 'pre-roll': 'Pre-Rolls',
    'concentrate': 'Concentrate', 'concentrates': 'Concentrate',
    'tincture': 'Tincture', 'tinctures': 'Tincture',
    'topical': 'Topical', 'topicals': 'Topical',
    'cbd': 'CBD',
  };
  return map[(cat || '').toLowerCase()] || cat || 'Other';
}

async function main() {
  console.log('Building dashboard_data.json...\n');
  if (!existsSync(RESULTS_DIR)) { console.error('No results directory'); process.exit(1); }
  var files = (await readdir(RESULTS_DIR)).filter(f => f.endsWith('.json'));
  if (files.length === 0) { console.error('No result files'); process.exit(1); }
  console.log('Found ' + files.length + ' dispensary files');

  var allDisps = {};
  var allRaw = [];

  for (var file of files) {
    var slug = file.replace('.json', '');
    var info = getDispInfo(slug);
    var raw = JSON.parse(await readFile(RESULTS_DIR + '/' + file, 'utf-8'));
    if (!Array.isArray(raw) || raw.length === 0) continue;

    // Filter out accessories and apparel
    var filtered = raw.filter(function(p) { return !shouldSkip(p.category); });

    allDisps[info.name] = { city: info.city, product_count: filtered.length, daily_sales: 0 };

    for (var product of filtered) {
      allRaw.push({
        ...product,
        _disp: info.name,
        _price: product.price_cents ? product.price_cents / 100 : null,
        _origPrice: product.original_price_cents ? product.original_price_cents / 100 : null,
        _cat: mapCategory(product.category),
      });
    }
  }

  console.log('Loaded ' + allRaw.length + ' products from ' + Object.keys(allDisps).length + ' dispensaries');

  // ─── Fuzzy merge ───
  var exactGroups = {};
  for (var p of allRaw) {
    if (!p._price) continue;
    var key = makeMatchKey(p.brand, p.name, p._cat);
    if (!exactGroups[key]) exactGroups[key] = [];
    exactGroups[key].push(p);
  }
  console.log('Exact match groups: ' + Object.keys(exactGroups).length);

  var groupKeys = Object.keys(exactGroups);
  var merged = {};
  var used = new Set();

  for (var i = 0; i < groupKeys.length; i++) {
    if (used.has(i)) continue;
    var baseGroup = exactGroups[groupKeys[i]];
    var baseBrand = (baseGroup[0].brand || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    var baseCat = baseGroup[0]._cat;
    var baseTokens = extractStrainTokens(baseGroup[0].name, baseGroup[0].brand);
    var mergedGroup = [...baseGroup];
    used.add(i);

    for (var j = i + 1; j < groupKeys.length; j++) {
      if (used.has(j)) continue;
      var candGroup = exactGroups[groupKeys[j]];
      var candBrand = (candGroup[0].brand || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      var candCat = candGroup[0]._cat;
      if (candBrand !== baseBrand || candCat !== baseCat) continue;
      var candTokens = extractStrainTokens(candGroup[0].name, candGroup[0].brand);
      if (tokenSimilarity(baseTokens, candTokens) >= 0.5) {
        mergedGroup = mergedGroup.concat(candGroup);
        used.add(j);
      }
    }
    merged[groupKeys[i]] = mergedGroup;
  }
  console.log('After fuzzy merge: ' + Object.keys(merged).length + ' product groups');

  // ─── Convert to dashboard format ───
  var products = [];
  var comparable = 0;

  for (var [key, group] of Object.entries(merged)) {
    var bestName = group[0].name;
    for (var g of group) { if (g.name && g.name.length > bestName.length) bestName = g.name; }

    var product = { name: bestName, brand: group[0].brand || '', category: group[0]._cat, dispensaries: {}, promos: {} };

    for (var g of group) {
      var existing = product.dispensaries[g._disp];
      if (!existing || g._price < existing) product.dispensaries[g._disp] = g._price;
      if (g.on_sale && g._origPrice && g._price < g._origPrice) {
        product.promos[g._disp] = g._price;
        product.dispensaries[g._disp] = g._origPrice;
      }
    }
    if (Object.keys(product.dispensaries).length >= 2) comparable++;
    products.push(product);
  }
  console.log('Comparable products (2+ dispensaries): ' + comparable);

  // ─── Deals ───
  var deals = [];
  for (var p of allRaw) {
    if (p.on_sale && p._origPrice && p._price && p._price < p._origPrice) {
      var pctOff = Math.round((1 - p._price / p._origPrice) * 100);
      if (pctOff > 0 && pctOff < 100) {
        deals.push({
          product: p.name, brand: p.brand || '', dispensary: p._disp,
          category: p._cat, pct_off: pctOff,
          discounted: Math.round(p._price * 100) / 100,
          original: Math.round(p._origPrice * 100) / 100,
        });
      }
    }
  }

  // ─── Category stats ───
  var catCounts = {};
  allRaw.forEach(function(p) { catCounts[p._cat] = (catCounts[p._cat] || 0) + 1; });
  console.log('Categories: ' + Object.entries(catCounts).map(function(e) { return e[0] + ': ' + e[1]; }).join(', '));

  var dispensaryCounts = {};
  for (var [name, info] of Object.entries(allDisps)) dispensaryCounts[name] = info.product_count;

  // ─── Output ───
  var output = {
    scraped_at: new Date().toISOString(),
    stats: {
      total_active: allRaw.length,
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
  console.log('\nWritten to ' + OUTPUT_FILE);
  console.log('  Products:     ' + products.length);
  console.log('  Comparable:   ' + comparable);
  console.log('  Deals:        ' + deals.length);
  console.log('  Categories:   ' + Object.keys(catCounts).length);
  console.log('  Dispensaries: ' + Object.keys(allDisps).length);
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
