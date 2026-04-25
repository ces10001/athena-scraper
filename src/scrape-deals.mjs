#!/usr/bin/env node
import { CT_DISPENSARIES } from '../config/dispensaries.mjs';
import { writeFile } from 'fs/promises';

/* ═══════════════════════════════════════
   ATHENA — Store-Wide Deals Scraper v3
   
   Platforms:
   - Dutchie: GraphQL API + browser fallback
   - Sweed/Curaleaf/Zen Leaf: ?modal=banners page
   - Fine Fettle: /shop/deals page
   - BUDR: /menu/specials page (Jane-powered)
   ═══════════════════════════════════════ */

var DUTCHIE_API = 'https://dutchie.com/api-2/graphql';
var HASH = '7803304c8df8df5d30281503d75f98f6b4a9db0c022bb4c4375cb717d2910586';

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// ─── DUTCHIE (GraphQL from browser context) ───
async function scrapeDutchieDeals(dispensaries, browser) {
  var allDeals = [];
  var context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
  var page = await context.newPage();
  try { await page.goto('https://dutchie.com', { waitUntil: 'domcontentloaded', timeout: 15000 }); } catch(e) {}
  await page.waitForTimeout(2000);

  // Try to get current hash from Dutchie's page source
  var currentHash = HASH;
  try {
    var pageHash = await page.evaluate(function() {
      var scripts = document.querySelectorAll('script[src]');
      for (var s of scripts) {
        if (s.src && s.src.includes('_next')) return s.src;
      }
      return null;
    });
    if (pageHash) console.log('  [deals] Dutchie page loaded, testing hash...');
  } catch(e) {}

  var errorLogged = false;
  for (var i = 0; i < dispensaries.length; i++) {
    var disp = dispensaries[i];
    var id = disp.dispensary_id;
    var mt = (disp.menu_type || 'rec').toUpperCase();
    if (!id) continue;
    try {
      var result = await page.evaluate(function(args) {
        var url = 'https://dutchie.com/api-2/graphql';
        var body = JSON.stringify({
          operationName: 'GetSpecialMenuCards',
          variables: {dispensaryId: args.id, menuType: args.mt, platformType: 'ONLINE_MENU'},
          extensions: {persistedQuery: {version: 1, sha256Hash: args.hash}}
        });
        return fetch(url, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
          body: body
        }).then(function(r) { return r.json(); }).then(function(data) {
          if (data.errors) return {error: JSON.stringify(data.errors).substring(0, 200)};
          var cards = data && data.data && data.data.getSpecialMenuCards && data.data.getSpecialMenuCards.menuCards;
          if (!cards) return {error: 'no menuCards in response', keys: Object.keys(data.data || {}).join(',')};
          return {deals: cards.map(function(c) { return {title: c.menuDisplayName||'', description: c.menuDisplayDescription||''}; }).filter(function(d) { return d.title.length > 0; })};
        }).catch(function(e) { return {error: e.message}; });
      }, {id: id, mt: mt, hash: currentHash});

      if (result.error && !errorLogged) {
        console.warn('  [deals] Dutchie GraphQL error: ' + result.error);
        errorLogged = true;
      }
      
      var deals = result.deals || [];
      if (deals.length > 0) {
        console.log('  [deals] ' + disp.name + ': ' + deals.length + ' deals');
        deals.forEach(function(d) { allDeals.push({title: d.title, description: d.description, dispensary: disp.name, platform: 'dutchie'}); });
      }
    } catch(e) {
      if (!errorLogged) { console.warn('  [deals] Dutchie evaluate error: ' + e.message); errorLogged = true; }
    }
  }
  await page.close();
  await context.close();
  return allDeals;
}

// ─── SWEED/CURALEAF/ZEN LEAF (?modal=banners approach) ───
async function scrapeSweedDeals(dispensaries, browser) {
  var allDeals = [];
  var context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });

  // Deduplicate by base store URL (Med and Rec share same deals)
  var seen = new Set();
  var unique = dispensaries.filter(function(d) {
    if (!d.sweed_urls || !d.sweed_urls[0]) return false;
    // Get base store URL without /menu and without /recreational or /medical
    var base = d.sweed_urls[0].replace(/\/menu\/?$/, '').replace(/\/(recreational|medical)\/?$/, '').replace(/\/menu\/?$/, '');
    if (seen.has(base)) return false;
    seen.add(base);
    return true;
  });

  for (var i = 0; i < unique.length; i++) {
    var disp = unique[i];
    var menuUrl = disp.sweed_urls[0];
    // Build deals URL: strip /menu, keep /recreational or /medical, add ?modal=banners
    var dealsUrl = menuUrl.replace(/\/menu\/?$/, '') + '?modal=banners';
    var page;
    try {
      page = await context.newPage();
      await page.goto(dealsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(6000);

      // Dismiss popups
      try {
        await page.evaluate(function() {
          var btns = document.querySelectorAll('button');
          btns.forEach(function(b) {
            var t = b.textContent.trim();
            if (t === 'Confirm' || t === 'Accept' || t === 'Accept Cookies' || t === 'I Agree') b.click();
          });
        });
        await page.waitForTimeout(2000);
      } catch(e) {}

      // Extract deal titles from "All Deals" section
      var deals = await page.evaluate(function() {
        var text = document.body.innerText;
        var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
        var allDealsIdx = lines.findIndex(function(l) { return l === 'All Deals'; });
        if (allDealsIdx < 0) return [];

        var dealLines = lines.slice(allDealsIdx + 1);
        var results = [];
        for (var i = 0; i < dealLines.length; i++) {
          var line = dealLines[i];
          // Deal titles are followed by validity lines ("Daily" or "Till ...")
          var nextLine = i + 1 < dealLines.length ? dealLines[i + 1] : '';
          if ((nextLine.match(/^(Daily|Till\s)/) || nextLine.match(/^(Expires|Valid|Ends)/i)) && line.length > 8 && line.length < 100) {
            results.push({ title: line, validity: nextLine });
            i++; // skip validity line
          }
        }
        return results;
      });

      if (deals.length > 0) {
        var baseName = disp.name.replace(/\s*\((?:Med|Rec)\)/, '');
        console.log('  [deals] ' + baseName + ': ' + deals.length + ' deals');
        deals.forEach(function(d) {
          allDeals.push({ title: d.title, description: d.validity || '', dispensary: baseName, platform: 'sweed' });
        });
      }
      await page.close();
    } catch(err) {
      console.warn('  [deals] Sweed FAIL ' + disp.name + ': ' + err.message);
      try { if (page) await page.close(); } catch(e) {}
    }
  }
  await context.close();
  return allDeals;
}

// ─── FINE FETTLE (/shop/deals page) ───
async function scrapeFineFettleDeals(dispensaries, browser) {
  var allDeals = [];
  var context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });

  var ffSeen = new Set();
  var unique = dispensaries.filter(function(d) {
    var s = d.store_ids && (d.store_ids.rec || d.store_ids.med);
    if (!s || ffSeen.has(s)) return false;
    ffSeen.add(s);
    return true;
  });

  for (var i = 0; i < unique.length; i++) {
    var disp = unique[i];
    var storeId = disp.store_ids.rec || disp.store_ids.med;
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
      deals.forEach(function(d) { allDeals.push({ title: d.title, description: '', dispensary: disp.name, platform: 'finefettle' }); });
      console.log('  [deals] ' + disp.name + ': ' + deals.length + ' deals');
      await page.close();
    } catch(err) {
      console.warn('  [deals] FF FAIL ' + disp.name + ': ' + err.message);
      try { if (page) await page.close(); } catch(e) {}
    }
  }
  await context.close();
  return allDeals;
}

// ─── BUDR (/menu/specials — Jane-powered deals page) ───
async function scrapeBudrDeals(dispensaries, browser) {
  var allDeals = [];
  var context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });

  var seen = new Set();
  var unique = dispensaries.filter(function(d) {
    var base = (d.store_url || '').replace(/-(adult-use|medical)/, '');
    if (!base || seen.has(base)) return false;
    seen.add(base);
    return true;
  });

  for (var i = 0; i < unique.length; i++) {
    var disp = unique[i];
    if (!disp.store_url) continue;
    var dealsUrl = disp.store_url + '/menu/specials';
    var page;
    try {
      page = await context.newPage();
      await page.goto(dealsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);
      // Pass age gate
      try {
        await page.evaluate(function() {
          var btns = document.querySelectorAll('button');
          btns.forEach(function(b) { if (b.textContent.trim() === 'YES') b.click(); });
        });
        await page.waitForTimeout(2000);
      } catch(e) {}
      // Accept location
      try {
        await page.evaluate(function() {
          var btns = document.querySelectorAll('button');
          btns.forEach(function(b) { if (b.textContent.trim() === 'ACCEPT') b.click(); });
        });
        await page.waitForTimeout(2000);
      } catch(e) {}

      // Click "Deals" tab if present
      try {
        await page.evaluate(function() {
          var tabs = document.querySelectorAll('a, button, div, span');
          tabs.forEach(function(el) { if (el.textContent.trim() === 'Deals' && el.offsetHeight > 0) el.click(); });
        });
        await page.waitForTimeout(3000);
      } catch(e) {}

      // Look for "All Deals" section or deal title patterns
      var deals = await page.evaluate(function() {
        var text = document.body.innerText;
        var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
        var results = [];
        
        // Find "All Deals" section first
        var allDealsIdx = lines.findIndex(function(l) { return l === 'All Deals'; });
        if (allDealsIdx >= 0) {
          var dealLines = lines.slice(allDealsIdx + 1);
          for (var i = 0; i < dealLines.length; i++) {
            var line = dealLines[i];
            var nextLine = i + 1 < dealLines.length ? dealLines[i + 1] : '';
            if ((nextLine.match(/^(Daily|Till\s)/) || nextLine.match(/^(Expires|Valid|Ends)/i)) && line.length > 8 && line.length < 100) {
              results.push({ title: line });
              i++;
            }
          }
        }
        
        // Fallback: look for deal title patterns
        if (results.length === 0) {
          for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            if (l.length > 12 && l.length < 80 && l.includes('!') &&
              (l.match(/\d+%/i) || l.includes('Off') || l.includes('BOGO') || l.includes('Last Chance') || l.includes('Free') || l.includes('Buy '))) {
              results.push({ title: l });
            }
          }
        }
        return results;
      });

      if (deals.length > 0) {
        var baseName = disp.name.replace(/\s*\((?:Med|Rec)\)/, '');
        console.log('  [deals] ' + baseName + ': ' + deals.length + ' deals');
        deals.forEach(function(d) { allDeals.push({ title: d.title, description: '', dispensary: baseName, platform: 'budr' }); });
      }
      await page.close();
    } catch(err) {
      console.warn('  [deals] BUDR FAIL ' + disp.name + ': ' + err.message);
      try { if (page) await page.close(); } catch(e) {}
    }
  }
  await context.close();
  return allDeals;
}

// ─── CUSTOM SPECIALS PAGES (High Profile, INSA, Shangri-La brand websites) ───
async function scrapeCustomSpecials(dispensaries, browser) {
  var allDeals = [];
  var context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });

  // Get unique specials URLs
  var seen = new Set();
  var unique = dispensaries.filter(function(d) {
    if (!d.specials_url || seen.has(d.specials_url)) return false;
    seen.add(d.specials_url);
    return true;
  });

  for (var i = 0; i < unique.length; i++) {
    var disp = unique[i];
    var page;
    try {
      page = await context.newPage();
      await page.goto(disp.specials_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);

      // Dismiss age gates
      try {
        await page.evaluate(function() {
          var btns = document.querySelectorAll('button');
          btns.forEach(function(b) {
            var t = b.textContent.trim();
            if (t === 'Yes' || t === 'YES' || t === 'Confirm' || t === 'Accept' || t === 'I Agree') b.click();
          });
        });
        await page.waitForTimeout(2000);
      } catch(e) {}

      var deals = await page.evaluate(function() {
        var text = document.body.innerText;
        var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
        var results = [];

        // Pattern 1: High Profile / INSA style — "Today's Specials" → title/SHOP pairs → "SUBCATEGORIES"
        var specialsIdx = lines.findIndex(function(l) { return l === "Today's Specials" || l === "Today\u2019s Specials"; });
        if (specialsIdx >= 0) {
          for (var i = specialsIdx + 1; i < lines.length; i++) {
            var line = lines[i];
            if (line === 'SUBCATEGORIES' || line === 'CATEGORIES') break;
            if (line === 'SHOP' || line === 'Shop' || line.length < 8) continue;
            if (line.match(/Shop today|sales and special/i)) continue;
            // Must look like a deal title (has %, $, Buy, B2G, Mix, Off, Free, etc.)
            if (line.match(/\d+%|\$\d+|buy\s+\d|b2g|mix.*match|free|off|save|featured/i) && line.length < 100) {
              results.push(line);
            }
          }
        }

        // Pattern 2: Shangri-La style — look for deal patterns anywhere on page
        if (results.length === 0) {
          var dealPatterns = [];
          for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            if (l.length > 10 && l.length < 100 && l.includes('!') &&
              (l.match(/\d+%/i) || l.match(/b2g/i) || l.match(/buy\s+\d/i) || 
               l.match(/\$0\.01/i) || l.match(/\$\d+\s+off/i) || l.includes('Off'))) {
              dealPatterns.push(l);
            }
          }
          // Also look for bullet-point deals (e.g. "Pre-Rolls B2G1 for $0.01")
          for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            if (l.length > 10 && l.length < 100 && 
              (l.match(/b2g1/i) || l.match(/penny/i) || l.match(/\d+%\s*off/i) ||
               l.match(/first.*(visit|time)/i) || l.match(/loyalty/i) || l.match(/discount/i))) {
              if (dealPatterns.indexOf(l) < 0) dealPatterns.push(l);
            }
          }
          results = dealPatterns;
        }

        return [...new Set(results)];
      });

      if (deals.length > 0) {
        var baseName = disp.name.replace(/\s*\((?:Med|Rec)\)/, '');
        console.log('  [deals] ' + baseName + ': ' + deals.length + ' deals (custom)');
        deals.forEach(function(d) {
          allDeals.push({ title: d, description: '', dispensary: baseName, platform: 'custom' });
        });
      }
      await page.close();
    } catch(err) {
      console.warn('  [deals] Custom FAIL ' + disp.name + ': ' + err.message);
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

  var { chromium } = await import('playwright');
  var browser = await chromium.launch({ headless: true });

  // Phase 1: Dutchie (browser-based GraphQL)
  var dutchieDisps = CT_DISPENSARIES.filter(function(d) { return d.platform === 'dutchie' && d.dispensary_id; });
  console.log('[deals] Phase 1: ' + dutchieDisps.length + ' Dutchie stores...');
  var dutchie = await scrapeDutchieDeals(dutchieDisps, browser);
  allDeals.push(...dutchie);
  console.log('[deals] Dutchie: ' + dutchie.length + ' deals');

  // Phase 2: Sweed/Curaleaf/Zen Leaf (?modal=banners)
  var sweedDisps = CT_DISPENSARIES.filter(function(d) { return d.platform === 'sweed' && d.sweed_urls; });
  console.log('[deals] Phase 2: ' + sweedDisps.length + ' Sweed stores (?modal=banners)...');
  var sweed = await scrapeSweedDeals(sweedDisps, browser);
  allDeals.push(...sweed);
  console.log('[deals] Sweed: ' + sweed.length + ' deals');

  // Phase 3: Fine Fettle (/shop/deals)
  var ffDisps = CT_DISPENSARIES.filter(function(d) { return d.platform === 'finefettle'; });
  console.log('[deals] Phase 3: ' + ffDisps.length + ' Fine Fettle stores...');
  var ff = await scrapeFineFettleDeals(ffDisps, browser);
  allDeals.push(...ff);
  console.log('[deals] Fine Fettle: ' + ff.length + ' deals');

  // Phase 4: BUDR (/menu/specials)
  var budrDisps = CT_DISPENSARIES.filter(function(d) { return d.platform === 'budrcannabis' && d.store_url; });
  console.log('[deals] Phase 4: ' + budrDisps.length + ' BUDR stores...');
  var budr = await scrapeBudrDeals(budrDisps, browser);
  allDeals.push(...budr);
  console.log('[deals] BUDR: ' + budr.length + ' deals');

  // Phase 5: Custom specials pages (High Profile, INSA, Shangri-La)
  var customDisps = CT_DISPENSARIES.filter(function(d) { return d.specials_url; });
  console.log('[deals] Phase 5: ' + customDisps.length + ' stores with custom specials pages...');
  var custom = await scrapeCustomSpecials(customDisps, browser);
  allDeals.push(...custom);
  console.log('[deals] Custom specials: ' + custom.length + ' deals');

  await browser.close();

  // Deduplicate
  var seen = new Set();
  var deduped = allDeals.filter(function(d) {
    var key = d.title.toLowerCase().trim() + '|' + d.dispensary.replace(/\s*\((?:Med|Rec)\)/i, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  var byP = {};
  deduped.forEach(function(d) { byP[d.platform] = (byP[d.platform] || 0) + 1; });
  console.log('[deals] ═══ FINAL: ' + deduped.length + ' unique deals (' + Object.entries(byP).map(function(e) { return e[0] + ':' + e[1]; }).join(', ') + ') ═══\n');
  return deduped;
}

if (process.argv[1]?.endsWith('scrape-deals.mjs')) {
  scrapeAllDeals().then(function(deals) {
    writeFile('./data/store_promos.json', JSON.stringify(deals, null, 2));
    console.log('Saved ' + deals.length + ' deals');
    process.exit(0);
  }).catch(function(err) { console.error('Fatal:', err); process.exit(1); });
}
