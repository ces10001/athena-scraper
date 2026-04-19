#!/usr/bin/env node
import { CT_DISPENSARIES } from '../config/dispensaries.mjs';
import { scrapeDutchie, cleanup } from './adapters/dutchie.mjs';
import { scrapeCuraleaf } from './adapters/curaleaf.mjs';
import { validateProduct } from './lib/normalizer.mjs';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';

const ADAPTERS = { dutchie: scrapeDutchie, curaleaf: scrapeCuraleaf };

function parseArgs() {
  var args = process.argv.slice(2);
  var opts = { platform: null, name: null, dryRun: false, concurrency: 1, verbose: false };
  for (var i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--platform': opts.platform = args[++i]; break;
      case '--name': opts.name = args[++i]; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--verbose': opts.verbose = true; break;
    }
  }
  return opts;
}

function diffProducts(oldProducts, newProducts) {
  var alerts = [];
  var oldMap = new Map(oldProducts.map(function(p) { return [p.external_id, p]; }));
  var newMap = new Map(newProducts.map(function(p) { return [p.external_id, p]; }));
  for (var [id, newP] of newMap) {
    var oldP = oldMap.get(id);
    if (!oldP) {
      alerts.push({ type: 'new_product', product_name: newP.name, brand: newP.brand, message: 'New: ' + newP.brand + ' - ' + newP.name + ' $' + (newP.price_cents / 100).toFixed(2) });
      continue;
    }
    if (oldP.price_cents && newP.price_cents && oldP.price_cents !== newP.price_cents) {
      alerts.push({ type: newP.price_cents < oldP.price_cents ? 'price_drop' : 'price_increase', product_name: newP.name, brand: newP.brand, message: newP.brand + ' ' + newP.name + ': $' + (oldP.price_cents / 100).toFixed(2) + ' → $' + (newP.price_cents / 100).toFixed(2) });
    }
  }
  for (var [id, oldP] of oldMap) {
    if (!newMap.has(id)) alerts.push({ type: 'out_of_stock', product_name: oldP.name, brand: oldP.brand, message: 'Gone: ' + oldP.brand + ' - ' + oldP.name });
  }
  return alerts;
}

var DATA_DIR = './data';
var RESULTS_DIR = DATA_DIR + '/results';
var HISTORY_DIR = DATA_DIR + '/history';
var ALERTS_DIR = DATA_DIR + '/alerts';

async function ensureDirs() {
  for (var dir of [DATA_DIR, RESULTS_DIR, HISTORY_DIR, ALERTS_DIR]) {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }
}

function slug(d) { return d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); }

async function loadPrev(d) { try { return JSON.parse(await readFile(RESULTS_DIR + '/' + slug(d) + '.json', 'utf-8')); } catch { return []; } }
async function saveProd(d, products) { await writeFile(RESULTS_DIR + '/' + slug(d) + '.json', JSON.stringify(products, null, 2)); }
async function saveAlerts(d, alerts) { if (alerts.length > 0) await writeFile(ALERTS_DIR + '/' + slug(d) + '_' + Date.now() + '.json', JSON.stringify(alerts, null, 2)); }

async function main() {
  var opts = parseArgs();
  await ensureDirs();

  console.log('\n========================================');
  console.log('  ATHENA SCRAPER — CT Cannabis Intel');
  console.log('  ' + new Date().toISOString());
  console.log('========================================\n');

  var targets = CT_DISPENSARIES.filter(function(d) {
    if (d.platform === 'owner' || d.platform === 'unknown') return false;
    if (d.platform === 'dutchie' && !d.dispensary_id) return false;
    if (d.platform === 'curaleaf' && !d.store_slug) return false;
    if (opts.platform && d.platform !== opts.platform) return false;
    if (opts.name && !d.name.toLowerCase().includes(opts.name.toLowerCase())) return false;
    return true;
  });

  console.log('Targets: ' + targets.length + ' dispensaries\n');

  var stats = { total: targets.length, ok: 0, fail: 0, products: 0, alerts: 0, errors: [] };

  for (var i = 0; i < targets.length; i++) {
    var dispensary = targets[i];
    try {
      var adapter = ADAPTERS[dispensary.platform];
      if (!adapter) { stats.fail++; continue; }

      var result = await adapter(dispensary);
      var valid = result.products.filter(function(p) { return validateProduct(p).length === 0; });
      var prev = await loadPrev(dispensary);
      var alerts = diffProducts(prev, valid);

      if (!opts.dryRun && valid.length > 0) {
        await saveProd(dispensary, valid);
        await saveAlerts(dispensary, alerts);
      }

      if (valid.length === 0) {
        console.warn('  ⚠️  ZERO PRODUCTS: ' + dispensary.name);
        stats.errors.push('ZERO PRODUCTS: ' + dispensary.name);
      }

      stats.ok++;
      stats.products += valid.length;
      stats.alerts += alerts.length;

      if (alerts.length > 0) {
        console.log('  📊 ' + alerts.length + ' alerts');
        for (var a = 0; a < Math.min(alerts.length, 3); a++) console.log('     ' + alerts[a].type + ': ' + alerts[a].message);
      }

      if (result.errors.length > 0) stats.errors.push.apply(stats.errors, result.errors.map(function(e) { return dispensary.name + ': ' + e; }));
    } catch (err) {
      console.error('[error] ' + dispensary.name + ': ' + err.message);
      stats.fail++;
      stats.errors.push(dispensary.name + ': ' + err.message);
    }
  }

  console.log('\n========================================');
  console.log('  SCRAPE COMPLETE');
  console.log('========================================');
  console.log('  Success:   ' + stats.ok + '/' + stats.total);
  console.log('  Products:  ' + stats.products);
  console.log('  Alerts:    ' + stats.alerts);
  if (stats.errors.length > 0) { console.log('  Errors:'); for (var e of stats.errors) console.log('    - ' + e); }
  console.log('========================================\n');

  if (!opts.dryRun) {
    var resultFiles = readdirSync(RESULTS_DIR).filter(function(f) { return f.endsWith('.json'); });
    var manifest = {
      lastUpdated: new Date().toISOString(),
      dispensaries: resultFiles.map(function(f) { return f.replace('.json', ''); }),
      stats: { total: stats.products, scraped: stats.ok, alerts: stats.alerts },
    };
    await writeFile(DATA_DIR + '/manifest.json', JSON.stringify(manifest, null, 2));
    console.log('Manifest: ' + resultFiles.length + ' files indexed');
  }
}

main()
  .then(async function() {
    await cleanup();
    process.exit(0);
  })
  .catch(async function(err) {
    console.error('Fatal:', err);
    try { await cleanup(); } catch(e) {}
    process.exit(1);
  });
