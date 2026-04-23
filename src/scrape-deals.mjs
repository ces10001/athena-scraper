#!/usr/bin/env node
import { CT_DISPENSARIES } from '../config/dispensaries.mjs';
import { writeFile } from 'fs/promises';

/* ═══════════════════════════════════════
   ATHENA — Store-Wide Deals Scraper
   
   Scrapes promotional banners/deals from each platform:
   - Dutchie: GraphQL GetSpecialMenuCards API (no browser needed)
   - Fine Fettle: /shop/deals page (browser-based)
   - Sweed: variant.promos from hydration (already captured in product scrape)
   - BUDR: /menu/specials page (browser-based, future)
   ═══════════════════════════════════════ */

var DUTCHIE_SPECIALS_HASH = '7803304c8df8df5d30281503d75f98f6b4a9db0c022bb4c4375cb717d2910586';
var DUTCHIE_API = 'https://dutchie.com/api-2/graphql';

// ─── DUTCHIE DEALS (Pure HTTP — fast) ───

async function scrapeDutchieDeals(dispensary) {
  var dispensaryId = dispensary.dispensary_id;
  var menuType = (dispensary.menu_type || 'rec').toUpperCase();
  if (!dispensaryId) return [];

  try {
    var variables = JSON.stringify({
      dispensaryId: dispensaryId,
      menuType: menuType,
      platformType: 'ONLINE_MENU',
    });
    var extensions = JSON.stringify({
      persistedQuery: { version: 1, sha256Hash: DUTCHIE_SPECIALS_HASH },
    });
    var url = DUTCHIE_API + '?operationName=GetSpecialMenuCards&variables=' + encodeURIComponent(variables) + '&extensions=' + encodeURIComponent(extensions);

    var resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!resp.ok) return [];
    var data = await resp.json();
    var cards = data?.data?.getSpecialMenuCards?.menuCards || [];

    return cards.map(function(c) {
      return {
        title: c.menuDisplayName || '',
        description: c.menuDisplayDescription || '',
        type: c.specialType || 'sale',
        dispensary: dispensary.name,
        platform: 'dutchie',
      };
    }).filter(function(d) { return d.title.length > 0; });
  } catch (err) {
    console.warn('  [deals] Dutchie deals failed for ' + dispensary.name + ': ' + err.message);
    return [];
  }
}

// ─── FINE FETTLE DEALS (Browser-based) ───

async function scrapeFineFettleDeals(dispensaries) {
  var allDeals = [];
  try {
    var { chromium } = await import('playwright');
    var browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });

    for (var i = 0; i < dispensaries.length; i++) {
      var disp = dispensaries[i];
      var storeId = disp.store_ids?.rec || disp.store_ids?.med;
      if (!storeId) continue;

      try {
        var page = await context.newPage();
        var url = 'https://www.finefettle.com/shop/deals?storeid=' + storeId;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);

        var deals = await page.evaluate(function() {
          var text = document.body.innerText;
          var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
          var deals = [];
          var inDeals = false;

          for (var i = 0; i < lines.length; i++) {
            // Look for deal titles — they appear after "Bundle" or "Product" markers
            // and contain patterns like "% Off", "BOGO", "Buy", "$"
            if (lines[i] === 'Bundle' || lines[i] === 'Product') {
              if (i + 1 < lines.length) {
                var title = lines[i + 1];
                if (title.length > 3 && title.length < 100 && !title.match(/^Sort:|^Deals$/)) {
                  deals.push({ title: title, type: lines[i].toLowerCase() });
                }
              }
            }
          }
          return deals;
        });

        deals.forEach(function(d) {
          allDeals.push({
            title: d.title,
            description: '',
            type: d.type,
            dispensary: disp.name,
            platform: 'finefettle',
          });
        });

        await page.close();
        console.log('  [deals] ' + disp.name + ': ' + deals.length + ' deals');
      } catch (err) {
        console.warn('  [deals] Fine Fettle deals failed for ' + disp.name + ': ' + err.message);
      }
    }

    await context.close();
    await browser.close();
  } catch (err) {
    console.warn('  [deals] Fine Fettle browser failed: ' + err.message);
  }
  return allDeals;
}

// ─── MAIN ───

export async function scrapeAllDeals() {
  console.log('\n── Scraping store-wide deals ──');
  var allDeals = [];

  // Dutchie deals (pure HTTP, parallel)
  var dutchieDisps = CT_DISPENSARIES.filter(function(d) { return d.platform === 'dutchie'; });
  console.log('[deals] Scraping ' + dutchieDisps.length + ' Dutchie stores...');

  // Batch 8 at a time
  for (var i = 0; i < dutchieDisps.length; i += 8) {
    var batch = dutchieDisps.slice(i, i + 8);
    var results = await Promise.all(batch.map(scrapeDutchieDeals));
    results.forEach(function(deals) { allDeals.push(...deals); });
  }
  var dutchieCount = allDeals.length;
  console.log('[deals] Dutchie: ' + dutchieCount + ' deals from ' + dutchieDisps.length + ' stores');

  // Fine Fettle deals (browser-based, sequential)
  var ffDisps = CT_DISPENSARIES.filter(function(d) { return d.platform === 'finefettle'; });
  // Deduplicate by store ID (Med and Rec share the same deals page for rec store)
  var ffSeen = new Set();
  var ffUnique = ffDisps.filter(function(d) {
    var storeId = d.store_ids?.rec || d.store_ids?.med;
    if (ffSeen.has(storeId)) return false;
    ffSeen.add(storeId);
    return true;
  });
  console.log('[deals] Scraping ' + ffUnique.length + ' Fine Fettle stores...');
  var ffDeals = await scrapeFineFettleDeals(ffUnique);
  allDeals.push(...ffDeals);
  console.log('[deals] Fine Fettle: ' + ffDeals.length + ' deals');

  // Deduplicate by title + dispensary base name
  var seen = new Set();
  var deduped = allDeals.filter(function(d) {
    var key = d.title + '|' + d.dispensary.replace(/\s*\((?:Med|Rec)\)/i, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log('[deals] Total: ' + deduped.length + ' unique store-wide deals\n');
  return deduped;
}

// Allow running standalone
if (process.argv[1]?.endsWith('scrape-deals.mjs')) {
  scrapeAllDeals().then(function(deals) {
    writeFile('./data/store_promos.json', JSON.stringify(deals, null, 2));
    console.log('Saved to data/store_promos.json');
    process.exit(0);
  }).catch(function(err) {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
