#!/usr/bin/env node
import { CT_DISPENSARIES } from '../config/dispensaries.mjs';
import { writeFile } from 'fs/promises';

/* ═══════════════════════════════════════
   ATHENA — Store-Wide Deals Scraper v2
   
   Redundant, multi-platform deals scraping:
   - Dutchie: 2x GraphQL queries with retry + fallback
   - Fine Fettle: Browser-based /shop/deals
   - Sweed/Curaleaf: Browser-based deals extraction
   - BUDR: Browser-based specials page
   ═══════════════════════════════════════ */

var DUTCHIE_API = 'https://dutchie.com/api-2/graphql';
var HASHES = {
  GetSpecialMenuCards: '7803304c8df8df5d30281503d75f98f6b4a9db0c022bb4c4375cb717d2910586',
  FilteredSpecials: '0dfb85a4fc138c55a076d4d11bf6d1a25f7cbd511428e1cf5a5b863b3eb23f25',
};

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function fetchJSON(url, retries) {
  retries = retries || 3;
  var headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept': 'application/json' };
  for (var attempt = 1; attempt <= retries; attempt++) {
    try {
      var resp = await fetch(url, { headers: headers });
      if (resp.ok) return await resp.json();
      if (attempt < retries) await sleep(1000 * attempt);
    } catch (err) {
      if (attempt < retries) await sleep(1000 * attempt);
    }
  }
  return null;
}

// ─── DUTCHIE: Primary query ───
async function dutchieMenuCards(dispensaryId, menuType) {
  var v = JSON.stringify({ dispensaryId: dispensaryId, menuType: menuType, platformType: 'ONLINE_MENU' });
  var e = JSON.stringify({ persistedQuery: { version: 1, sha256Hash: HASHES.GetSpecialMenuCards } });
  var url = DUTCHIE_API + '?operationName=GetSpecialMenuCards&variables=' + encodeURIComponent(v) + '&extensions=' + encodeURIComponent(e);
  var data = await fetchJSON(url);
  var cards = data?.data?.getSpecialMenuCards?.menuCards;
  if (!cards || !Array.isArray(cards)) return null;
  return cards.map(function(c) {
    return { title: c.menuDisplayName || '', description: c.menuDisplayDescription || '', type: c.specialType || 'sale' };
  }).filter(function(d) { return d.title.length > 0; });
}

// ─── DUTCHIE: Fallback query ───
async function dutchieFiltered(dispensaryId) {
  var v = JSON.stringify({ includeEnterpriseSpecials: false, specialsFilter: { dispensaryId: dispensaryId, current: true, platformType: 'ONLINE_MENU', preOrderType: null } });
  var e = JSON.stringify({ persistedQuery: { version: 1, sha256Hash: HASHES.FilteredSpecials } });
  var url = DUTCHIE_API + '?operationName=FilteredSpecials&variables=' + encodeURIComponent(v) + '&extensions=' + encodeURIComponent(e);
  var data = await fetchJSON(url);
  var specials = data?.data?.filteredSpecials;
  if (!specials || !Array.isArray(specials)) return null;
  return specials.map(function(s) {
    return { title: s.name || s.menuDisplayName || '', description: s.description || s.menuDisplayDescription || '', type: s.specialType || 'sale' };
  }).filter(function(d) { return d.title.length > 0; });
}

// ─── DUTCHIE: Combined with logging ───
async function scrapeDutchieDeals(dispensary) {
  var id = dispensary.dispensary_id;
  var mt = (dispensary.menu_type || 'rec').toUpperCase();
  if (!id) return [];
  try {
    var deals = await dutchieMenuCards(id, mt);
    if (!deals || deals.length === 0) deals = await dutchieFiltered(id);
    if (!deals || deals.length === 0) return [];
    console.log('  [deals] ' + dispensary.name + ': ' + deals.length + ' deals');
    return deals.map(function(d) { return { title: d.title, description: d.description, type: d.type, dispensary: dispensary.name, platform: 'dutchie' }; });
  } catch (err) {
    console.warn('  [deals] Dutchie FAIL ' + dispensary.name + ': ' + err.message);
    return [];
  }
}

// ─── DUTCHIE: Browser fallback (makes API calls from page context to bypass IP blocks) ───
async function scrapeDutchieDealsViaBrowser(dispensaries, browser) {
  var allDeals = [];
  var context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
  var page = await context.newPage();
  
  // Navigate to Dutchie once to establish cookies
  try {
    await page.goto('https://dutchie.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
  } catch(e) {}

  for (var i = 0; i < dispensaries.length; i++) {
    var disp = dispensaries[i];
    var id = disp.dispensary_id;
    var mt = (disp.menu_type || 'rec').toUpperCase();
    if (!id) continue;

    try {
      var deals = await page.evaluate(function(args) {
        var API = 'https://dutchie.com/api-2/graphql';
        var HASH1 = '7803304c8df8df5d30281503d75f98f6b4a9db0c022bb4c4375cb717d2910586';
        var HASH2 = '0dfb85a4fc138c55a076d4d11bf6d1a25f7cbd511428e1cf5a5b863b3eb23f25';
        
        function tryQuery(opName, vars, hash) {
          var url = API + '?operationName=' + opName + '&variables=' + encodeURIComponent(JSON.stringify(vars)) + '&extensions=' + encodeURIComponent(JSON.stringify({persistedQuery:{version:1,sha256Hash:hash}}));
          return fetch(url, {headers:{'Accept':'application/json'}}).then(function(r){return r.json()}).catch(function(){return null});
        }
        
        return tryQuery('GetSpecialMenuCards', {dispensaryId:args.id, menuType:args.mt, platformType:'ONLINE_MENU'}, HASH1)
          .then(function(data) {
            var cards = data && data.data && data.data.getSpecialMenuCards && data.data.getSpecialMenuCards.menuCards;
            if (cards && cards.length > 0) {
              return cards.map(function(c) { return {title: c.menuDisplayName||'', description: c.menuDisplayDescription||'', type: c.specialType||'sale'}; });
            }
            // Fallback query
            return tryQuery('FilteredSpecials', {includeEnterpriseSpecials:false, specialsFilter:{dispensaryId:args.id, current:true, platformType:'ONLINE_MENU', preOrderType:null}}, HASH2)
              .then(function(data2) {
                var specials = data2 && data2.data && data2.data.filteredSpecials;
                if (specials && specials.length > 0) {
                  return specials.map(function(s) { return {title: s.name||s.menuDisplayName||'', description: s.description||s.menuDisplayDescription||'', type: s.specialType||'sale'}; });
                }
                return [];
              });
          });
      }, {id: id, mt: mt});

      var validDeals = (deals || []).filter(function(d) { return d.title && d.title.length > 0; });
      if (validDeals.length > 0) {
        console.log('  [deals] ' + disp.name + ': ' + validDeals.length + ' deals (browser)');
        validDeals.forEach(function(d) {
          allDeals.push({ title: d.title, description: d.description || '', type: d.type, dispensary: disp.name, platform: 'dutchie' });
        });
      }
    } catch (err) {
      // Silent fail per store
    }
  }

  await page.close();
  await context.close();
  return allDeals;
}

// ─── FINE FETTLE (Browser) ───
async function scrapeFineFettleDeals(dispensaries, browser) {
  var allDeals = [];
  var context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
  for (var i = 0; i < dispensaries.length; i++) {
    var disp = dispensaries[i];
    var storeId = disp.store_ids?.rec || disp.store_ids?.med;
    if (!storeId) continue;
    var page;
    try {
      page = await context.newPage();
      await page.goto('https://www.finefettle.com/shop/deals?storeid=' + storeId, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);
      var deals = await page.evaluate(function() {
        var lines = document.body.innerText.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
        var d = [];
        for (var i = 0; i < lines.length; i++) {
          if (lines[i] === 'Bundle' || lines[i] === 'Product') {
            if (i + 1 < lines.length) {
              var t = lines[i + 1];
              if (t.length > 3 && t.length < 100 && !t.match(/^Sort:|^Deals$/)) d.push({ title: t, type: lines[i].toLowerCase() });
            }
          }
        }
        return d;
      });
      deals.forEach(function(d) { allDeals.push({ title: d.title, description: '', type: d.type, dispensary: disp.name, platform: 'finefettle' }); });
      console.log('  [deals] ' + disp.name + ': ' + deals.length + ' deals');
      await page.close();
    } catch (err) {
      console.warn('  [deals] FF FAIL ' + disp.name + ': ' + err.message);
      try { if (page) await page.close(); } catch(e) {}
    }
  }
  await context.close();
  return allDeals;
}

// ─── SWEED/CURALEAF (Browser) ───
async function scrapeSweedDeals(dispensaries, browser) {
  var allDeals = [];
  var context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
  for (var i = 0; i < dispensaries.length; i++) {
    var disp = dispensaries[i];
    if (!disp.url) continue;
    var dealsUrl = disp.url.replace(/\/menu\/?$/, '/menu/discounts');
    var page;
    try {
      page = await context.newPage();
      await page.goto(dealsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);
      // Dismiss popups
      try { var btn = await page.$('button:has-text("Confirm"), button:has-text("Accept")'); if (btn) { await btn.click(); await page.waitForTimeout(1000); } } catch(e) {}
      // Try clicking Deals tab
      try { var dt = await page.$('button:has-text("Deals"), a:has-text("Deals")'); if (dt) { await dt.click(); await page.waitForTimeout(3000); } } catch(e) {}
      var deals = await page.evaluate(function() {
        var r = [];
        var lines = document.body.innerText.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
        for (var i = 0; i < lines.length; i++) {
          var l = lines[i];
          if (l.length > 8 && l.length < 120 && (l.match(/\d+%\s*off/i) || l.match(/buy\s+\d/i) || l.match(/bogo/i) || l.match(/save\s+\$/i) || l.match(/free\b/i))) {
            if (l.match(/^(home|shop|menu|cart|login|sign|account|about|privacy)/i)) continue;
            r.push({ title: l, type: 'sale' });
          }
        }
        return r;
      });
      if (deals.length > 0) {
        deals.forEach(function(d) { allDeals.push({ title: d.title, description: '', type: d.type, dispensary: disp.name, platform: 'sweed' }); });
        console.log('  [deals] ' + disp.name + ': ' + deals.length + ' deals');
      }
      await page.close();
    } catch (err) {
      console.warn('  [deals] Sweed FAIL ' + disp.name + ': ' + err.message);
      try { if (page) await page.close(); } catch(e) {}
    }
  }
  await context.close();
  return allDeals;
}

// ─── BUDR (Browser) ───
async function scrapeBudrDeals(dispensaries, browser) {
  var allDeals = [];
  var context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
  var seen = new Set();
  var unique = dispensaries.filter(function(d) {
    var base = (d.budr_url || '').replace(/-(adult-use|medical)/, '');
    if (!base || seen.has(base)) return false;
    seen.add(base); return true;
  });
  for (var i = 0; i < unique.length; i++) {
    var disp = unique[i];
    if (!disp.budr_url) continue;
    var specialsUrl = disp.budr_url.replace(/\/menu\/.*$/, '/menu/specials');
    var page;
    try {
      page = await context.newPage();
      await page.goto(specialsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      try { var ab = await page.$('button:has-text("Yes"), button:has-text("Enter")'); if (ab) { await ab.click(); await page.waitForTimeout(2000); } } catch(e) {}
      var deals = await page.evaluate(function() {
        var r = [];
        var lines = document.body.innerText.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
        for (var i = 0; i < lines.length; i++) {
          var l = lines[i];
          if (l.length > 8 && l.length < 120 && (l.match(/\d+%\s*off/i) || l.match(/buy\s+\d/i) || l.match(/bogo/i) || l.match(/save\s+/i) || l.match(/cash\s*back/i) || l.match(/free\b/i))) {
            if (l.match(/^(home|shop|menu|cart|login|sign)/i)) continue;
            r.push({ title: l, type: 'sale' });
          }
        }
        return r;
      });
      if (deals.length > 0) {
        var baseName = disp.name.replace(/\s*\((?:Med|Rec)\)/, '');
        deals.forEach(function(d) { allDeals.push({ title: d.title, description: '', type: d.type, dispensary: baseName, platform: 'budr' }); });
        console.log('  [deals] ' + baseName + ': ' + deals.length + ' deals');
      }
      await page.close();
    } catch (err) {
      console.warn('  [deals] BUDR FAIL ' + disp.name + ': ' + err.message);
      try { if (page) await page.close(); } catch(e) {}
    }
  }
  await context.close();
  return allDeals;
}

// ─── MAIN ───
export async function scrapeAllDeals() {
  console.log('\n── Scraping store-wide deals ──');
  var allDeals = [];

  // Phase 1: Dutchie (HTTP, fast)
  var dutchieDisps = CT_DISPENSARIES.filter(function(d) { return d.platform === 'dutchie'; });
  console.log('[deals] Phase 1: ' + dutchieDisps.length + ' Dutchie stores (HTTP)...');
  for (var i = 0; i < dutchieDisps.length; i += 8) {
    var batch = dutchieDisps.slice(i, i + 8);
    var results = await Promise.all(batch.map(scrapeDutchieDeals));
    results.forEach(function(deals) { allDeals.push(...deals); });
  }
  console.log('[deals] Dutchie total: ' + allDeals.length);
  var dutchieHttpCount = allDeals.length;

  // Phase 2: Browser platforms (+ Dutchie browser fallback if HTTP got 0)
  var ffDisps = CT_DISPENSARIES.filter(function(d) { return d.platform === 'finefettle'; });
  var sweedDisps = CT_DISPENSARIES.filter(function(d) { return d.platform === 'sweed' && d.url; });
  var budrDisps = CT_DISPENSARIES.filter(function(d) { return d.platform === 'budrcannabis' && d.budr_url; });

  var ffSeen = new Set();
  var ffUnique = ffDisps.filter(function(d) { var s = d.store_ids?.rec || d.store_ids?.med; if (ffSeen.has(s)) return false; ffSeen.add(s); return true; });
  var swSeen = new Set();
  var swUnique = sweedDisps.filter(function(d) { var u = (d.url || '').replace(/\/(recreational|medical)\//, '/'); if (swSeen.has(u)) return false; swSeen.add(u); return true; });

  // Always need browser now (for Dutchie fallback + other platforms)
  try {
    var { chromium } = await import('playwright');
    var browser = await chromium.launch({ headless: true });

    // Dutchie browser fallback
    if (dutchieHttpCount === 0) {
      console.log('[deals] Phase 1b: Dutchie HTTP returned 0 — trying browser fallback...');
      var dutchieBrowser = await scrapeDutchieDealsViaBrowser(dutchieDisps, browser);
      allDeals.push(...dutchieBrowser);
      console.log('[deals] Dutchie browser fallback: ' + dutchieBrowser.length + ' deals');
    }

    if (ffUnique.length > 0) {
      console.log('[deals] Phase 2a: ' + ffUnique.length + ' Fine Fettle (browser)...');
      var ff = await scrapeFineFettleDeals(ffUnique, browser);
      allDeals.push(...ff);
      console.log('[deals] Fine Fettle total: ' + ff.length);
    }
    if (swUnique.length > 0) {
      console.log('[deals] Phase 2b: ' + swUnique.length + ' Sweed stores (browser)...');
      var sw = await scrapeSweedDeals(swUnique, browser);
      allDeals.push(...sw);
      console.log('[deals] Sweed total: ' + sw.length);
    }
    if (budrDisps.length > 0) {
      console.log('[deals] Phase 2c: ' + budrDisps.length + ' BUDR stores (browser)...');
      var bd = await scrapeBudrDeals(budrDisps, browser);
      allDeals.push(...bd);
      console.log('[deals] BUDR total: ' + bd.length);
    }
    await browser.close();
  } catch (err) {
    console.warn('[deals] Browser phase failed: ' + err.message);
  }

  // Phase 3: Deduplicate
  var seen = new Set();
  var deduped = allDeals.filter(function(d) {
    var key = d.title.toLowerCase().trim() + '|' + d.dispensary.replace(/\s*\((?:Med|Rec)\)/i, '');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  var byP = {};
  deduped.forEach(function(d) { byP[d.platform] = (byP[d.platform] || 0) + 1; });
  console.log('[deals] ═══ FINAL: ' + deduped.length + ' unique deals (' + Object.entries(byP).map(function(e) { return e[0] + ':' + e[1]; }).join(', ') + ') ═══\n');
  return deduped;
}

if (process.argv[1]?.endsWith('scrape-deals.mjs')) {
  scrapeAllDeals().then(function(deals) {
    writeFile('./data/store_promos.json', JSON.stringify(deals, null, 2));
    console.log('Saved ' + deals.length + ' deals to data/store_promos.json');
    process.exit(0);
  }).catch(function(err) { console.error('Fatal:', err); process.exit(1); });
}
