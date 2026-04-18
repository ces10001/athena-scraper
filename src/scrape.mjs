#!/usr/bin/env node
import { CT_DISPENSARIES } from '../config/dispensaries.mjs';
import { scrapeDutchie } from './adapters/dutchie.mjs';
import { validateProduct } from './lib/normalizer.mjs';

const ADAPTERS = {
  dutchie: scrapeDutchie,
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { platform: null, name: null, dryRun: false, concurrency: 2, verbose: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--platform': opts.platform = args[++i]; break;
      case '--name': opts.name = args[++i]; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--concurrency': opts.concurrency = parseInt(args[++i]) || 2; break;
      case '--verbose': opts.verbose = true; break;
    }
  }
  return opts;
}

function diffProducts(oldProducts, newProducts) {
  const alerts = [];
  const oldMap = new Map(oldProducts.map(p => [p.external_id, p]));
  const newMap = new Map(newProducts.map(p => [p.external_id, p]));

  for (const [id, newP] of newMap) {
    const oldP = oldMap.get(id);
    if (!oldP) {
      alerts.push({ type: 'new_product', product_name: newP.name, brand: newP.brand, category: newP.category, message: `New: ${newP.brand} - ${newP.name} $${(newP.price_cents / 100).toFixed(2)}`, new_value: `$${(newP.price_cents / 100).toFixed(2)}` });
      continue;
    }
    if (oldP.price_cents && newP.price_cents && oldP.price_cents !== newP.price_cents) {
      const pct = ((newP.price_cents - oldP.price_cents) / oldP.price_cents * 100).toFixed(1);
      alerts.push({ type: newP.price_cents < oldP.price_cents ? 'price_drop' : 'price_increase', product_name: newP.name, brand: newP.brand, category: newP.category, old_value: `$${(oldP.price_cents / 100).toFixed(2)}`, new_value: `$${(newP.price_cents / 100).toFixed(2)}`, message: `${newP.brand} ${newP.name}: $${(oldP.price_cents / 100).toFixed(2)} → $${(newP.price_cents / 100).toFixed(2)} (${pct}%)` });
    }
    if (!oldP.on_sale && newP.on_sale) {
      alerts.push({ type: 'new_deal', product_name: newP.name, brand: newP.brand, category: newP.category, message: `Deal: ${newP.brand} ${newP.name} — ${newP.deal_description || 'on sale'}`, new_value: newP.deal_description });
    }
  }

  for (const [id, oldP] of oldMap) {
    if (!newMap.has(id)) {
      alerts.push({ type: 'out_of_stock', product_name: oldP.name, brand: oldP.brand, category: oldP.category, message: `Out of stock: ${oldP.brand} - ${oldP.name}` });
    }
  }
  return alerts;
}

import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

const DATA_DIR = './data';
const RESULTS_DIR = `${DATA_DIR}/results`;
const HISTORY_DIR = `${DATA_DIR}/history`;
const ALERTS_DIR = `${DATA_DIR}/alerts`;

async function ensureDirs() {
  for (const dir of [DATA_DIR, RESULTS_DIR, HISTORY_DIR, ALERTS_DIR]) {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }
}

function dispensarySlug(d) {
  return d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function loadPreviousProducts(dispensary) {
  const path = `${RESULTS_DIR}/${dispensarySlug(dispensary)}.json`;
  try { return JSON.parse(await readFile(path, 'utf-8')); } catch { return []; }
}

async function saveProducts(dispensary, products) {
  const slug = dispensarySlug(dispensary);
  await writeFile(`${RESULTS_DIR}/${slug}.json`, JSON.stringify(products, null, 2));
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(`${HISTORY_DIR}/${slug}_${ts}.json`, JSON.stringify(products, null, 2));
}

async function saveAlerts(dispensary, alerts) {
  if (alerts.length === 0) return;
  const slug = dispensarySlug(dispensary);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(`${ALERTS_DIR}/${slug}_${ts}.json`, JSON.stringify(alerts, null, 2));
}

class Semaphore {
  constructor(max) { this.max = max; this.count = 0; this.queue = []; }
  async acquire() { if (this.count < this.max) { this.count++; return; } await new Promise(r => this.queue.push(r)); this.count++; }
  release() { this.count--; if (this.queue.length > 0) this.queue.shift()(); }
}

async function main() {
  const opts = parseArgs();
  await ensureDirs();

  console.log('\n========================================');
  console.log('  ATHENA SCRAPER — CT Cannabis Intel');
  console.log(`  ${new Date().toISOString()}`);
  console.log('========================================\n');

  let targets = CT_DISPENSARIES.filter(d => {
    if (d.platform === 'owner') return false;
    if (d.platform === 'unknown') return false;
    if (d.platform === 'dutchie' && !d.dispensary_id) return false;
    if (!d.menu_url && !d.api_base) return false;
    if (opts.platform && d.platform !== opts.platform) return false;
    if (opts.name && !d.name.toLowerCase().includes(opts.name.toLowerCase())) return false;
    return true;
  });

  console.log(`Targets: ${targets.length} dispensaries`);
  if (opts.dryRun) console.log('DRY RUN — no data will be saved\n');

  const sem = new Semaphore(opts.concurrency);
  const runStats = { started: new Date(), total: targets.length, successful: 0, failed: 0, totalProducts: 0, totalAlerts: 0, errors: [] };

  const tasks = targets.map(async (dispensary) => {
    await sem.acquire();
    try {
      const adapter = ADAPTERS[dispensary.platform];
      if (!adapter) { runStats.failed++; return; }

      const result = await adapter(dispensary);

      const validProducts = [];
      for (const p of result.products) {
        const issues = validateProduct(p);
        if (issues.length === 0) validProducts.push(p);
        else if (opts.verbose) console.warn(`  [validate] Skipping ${p.name}: ${issues.join(', ')}`);
      }

      const previous = await loadPreviousProducts(dispensary);
      const alerts = diffProducts(previous, validProducts);

      if (!opts.dryRun && validProducts.length > 0) {
        await saveProducts(dispensary, validProducts);
        await saveAlerts(dispensary, alerts);
      }

      if (validProducts.length === 0) {
        const msg = `⚠️  ZERO PRODUCTS: ${dispensary.name}`;
        console.warn(msg);
        runStats.errors.push(msg);
      }

      runStats.successful++;
      runStats.totalProducts += validProducts.length;
      runStats.totalAlerts += alerts.length;

      if (alerts.length > 0) {
        console.log(`  📊 ${alerts.length} alerts for ${dispensary.name}:`);
        for (const a of alerts.slice(0, 5)) console.log(`     ${a.type}: ${a.message}`);
        if (alerts.length > 5) console.log(`     ... and ${alerts.length - 5} more`);
      }

      if (result.errors.length > 0) runStats.errors.push(...result.errors.map(e => `${dispensary.name}: ${e}`));
    } catch (err) {
      console.error(`[error] ${dispensary.name}: ${err.message}`);
      runStats.failed++;
      runStats.errors.push(`${dispensary.name}: ${err.message}`);
    } finally { sem.release(); }
  });

  await Promise.all(tasks);

  runStats.finished = new Date();
  runStats.duration_seconds = Math.round((runStats.finished - runStats.started) / 1000);

  console.log('\n========================================');
  console.log('  SCRAPE COMPLETE');
  console.log('========================================');
  console.log(`  Duration:  ${runStats.duration_seconds}s`);
  console.log(`  Success:   ${runStats.successful}/${runStats.total}`);
  console.log(`  Failed:    ${runStats.failed}`);
  console.log(`  Products:  ${runStats.totalProducts}`);
  console.log(`  Alerts:    ${runStats.totalAlerts}`);
  if (runStats.errors.length > 0) { console.log(`  Errors:`); for (const e of runStats.errors) console.log(`    - ${e}`); }
  console.log('========================================\n');

  if (!opts.dryRun) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile(`${DATA_DIR}/run_${ts}.json`, JSON.stringify(runStats, null, 2));

    const { readdirSync } = await import('fs');
    const resultFiles = readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
    const manifest = {
      lastUpdated: new Date().toISOString(),
      dispensaries: resultFiles.map(f => f.replace('.json', '')),
      stats: { total: runStats.totalProducts, scraped: runStats.successful, alerts: runStats.totalAlerts },
    };
    await writeFile(`${DATA_DIR}/manifest.json`, JSON.stringify(manifest, null, 2));
    console.log(`  Manifest: ${resultFiles.length} result files indexed`);
  }

  if (runStats.successful === 0 && runStats.total > 0) process.exit(1);
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
