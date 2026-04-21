import { chromium } from 'playwright';
import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

/* ═══════════════════════════════════════
   BUDR CANNABIS ADAPTER
   Parses Jane-powered shadow DOM product text
   Navigates to /menu/all and clicks "View more" to load all products
   ═══════════════════════════════════════ */

function findCategoryAndBrand(block) {
  // Brand name appears RIGHT BEFORE the category keyword followed by "("
  // e.g., "SavvyFLOWER (7G)" → brand="Savvy", cat="flower"
  var catPatterns = [
    [/([A-Za-z][A-Za-z\s.':!&]*?)(?:Small Flower|Ground Flower|FLOWER|Flower)\s*\(/i, 'flower'],
    [/([A-Za-z][A-Za-z\s.':!&]*?)(?:Over:Timers|Smalls)\s*\(/i, 'flower'],
    [/([A-Za-z][A-Za-z\s.':!&]*?)(?:THCA Infused Pre Roll|Infused Pre Roll|Infused Blunt|Pre Roll|Pre-Roll)\s*\(/i, 'pre-rolls'],
    [/([A-Za-z][A-Za-z\s.':!&]*?)(?:Strut All-In-One|All-In-One|AIO Vape|Cartridge|Disposable|Cliq Pod|Briq)\s*\(/i, 'vaporizers'],
    [/([A-Za-z][A-Za-z\s.':!&]*?)(?:Macro Dosed Gummy|Gummies|Gummy|Chocolate|Chew|Lozenge|Mints)\s*\(/i, 'edible'],
    [/([A-Za-z][A-Za-z\s.':!&]*?)(?:Seltzer|Social Soda|Beverage|Iced Tea)\s*\(/i, 'edible'],
    [/([A-Za-z][A-Za-z\s.':!&]*?)(?:Badder|Live Rosin|Live Resin|Rosin|Resin|Sugar|Sauce|Diamond|Concentrate)\s*\(/i, 'concentrate'],
    [/([A-Za-z][A-Za-z\s.':!&]*?)(?:Tincture|Oral|Capsule|RSO Syringe|Oil Syringe)\s*\(/i, 'tincture'],
    [/([A-Za-z][A-Za-z\s.':!&]*?)(?:Topical|Balm|Cream|Lotion)\s*\(/i, 'topical'],
    [/([A-Za-z][A-Za-z\s.':!&]*?)(?:Sweatsuit|Hoodie|T-Shirt|Hat|Chillum|Grinder|Rolling Tray|Pipe)\s*\(/i, 'accessories'],
  ];
  for (var i = 0; i < catPatterns.length; i++) {
    var m = block.match(catPatterns[i][0]);
    if (m) {
      var brand = m[1].trim().replace(/\d+$/, '').trim();
      return { brand: brand, category: catPatterns[i][1] };
    }
  }
  return { brand: '', category: 'other' };
}

function parseJaneProducts(text) {
  var products = [];
  var seen = {};
  var blocks = text.split('Add to bag');

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i].trim();
    if (block.length < 15) continue;
    if (block.includes('Gift Card') || block.includes('gift card')) continue;
    if (block.length > 500) block = block.substring(block.length - 500);

    // ─── PRICE ───
    var priceWeightMatch = block.match(/\$(\d+\.?\d*)\/(\d+\.?\d*\s*(?:g|mg|ml|oz))\s*$/i);
    var allPrices = block.match(/\$(\d+\.?\d*)/g) || [];
    if (allPrices.length === 0) continue;

    var price = null;
    var originalPrice = null;
    var weight = null;

    if (priceWeightMatch) {
      price = parseFloat(priceWeightMatch[1]);
      weight = priceWeightMatch[2].trim();
    } else {
      price = parseFloat(allPrices[allPrices.length - 1].replace('$', ''));
    }
    if (!price || price <= 0 || price > 500) continue;

    // ─── CATEGORY + BRAND ───
    var catBrand = findCategoryAndBrand(block);
    var brand = catBrand.brand;
    var category = catBrand.category;
    if (category === 'accessories') continue;

    // ─── STRAIN ───
    var strainMatch = block.match(/(?:^|[^a-z])(Sativa|Indica|Hybrid)(?=[A-Z]|[^a-z])/i);
    var strain = strainMatch ? strainMatch[1].toLowerCase() : null;

    // ─── THC/CBD ───
    var thcMatch = block.match(/THC\s*(\d+\.?\d*)%/);
    var cbdMatch = block.match(/CBD\s*(\d+\.?\d*)%/) || block.match(/(\d+\.?\d*)\s*mg\s*CBD/i);

    // ─── PRODUCT NAME ───
    var name = '';
    if (brand) {
      var strainIdx = block.search(/(?:Sativa|Indica|Hybrid|CBD)(?=[A-Z])/i);
      if (strainIdx >= 0) {
        var afterStrain = block.substring(strainIdx).replace(/^(?:Sativa|Indica|Hybrid|CBD)/i, '');
        var brandCatIdx = afterStrain.lastIndexOf(brand);
        if (brandCatIdx > 2) {
          name = afterStrain.substring(0, brandCatIdx).trim();
        }
      }
    }
    if (!name || name.length < 3) {
      var strainStart = block.search(/(?:Sativa|Indica|Hybrid|CBD)/i);
      if (strainStart >= 0) {
        var afterS = block.substring(strainStart).replace(/^(?:Sativa|Indica|Hybrid|CBD)\s*/i, '');
        var endP = Math.min(
          afterS.search(/THC\s*\d/) > 0 ? afterS.search(/THC\s*\d/) : 999,
          afterS.indexOf('$') > 0 ? afterS.indexOf('$') : 999, 80
        );
        name = afterS.substring(0, endP).trim();
      }
    }
    name = name.replace(/\s+/g, ' ').trim();
    name = name.replace(/^(?:Only \d+ left|Popular|\d+% (?:back|OFF!?)|SALE!|New|Cash back|.*?View all\s*)+/gi, '').trim();
    if (name.length > 80) name = name.substring(0, 80).trim();
    if (name.length < 2) continue;

    // ─── WEIGHT ───
    if (!weight) {
      var sizeMatch = block.match(/\((\d+\.?\d*)\s*[Gg]\)/);
      if (sizeMatch) weight = sizeMatch[1] + 'g';
    }

    // ─── DEAL ───
    var discountMatch = block.match(/(\d+)%\s*OFF/i);
    var cashbackMatch = block.match(/(\d+)%\s*back/i);
    var dealDesc = discountMatch ? discountMatch[1] + '% Off' : (cashbackMatch ? cashbackMatch[1] + '% Cash Back' : null);
    if (originalPrice && !dealDesc) dealDesc = 'Sale';

    // ─── DEDUP ───
    var productCode = block.match(/\b(\d{5})\b/)?.[1] || block.match(/\b[A-Z]?\d{4,6}\b/)?.[0];
    var externalId = 'budr-' + (productCode || (name + price).replace(/[^a-z0-9]/gi, '').substring(0, 25));
    if (seen[externalId]) continue;
    seen[externalId] = true;

    products.push({
      external_id: externalId, name: name, brand: brand, category: category,
      strain_type: strain, thc_pct: thcMatch ? parseFloat(thcMatch[1]) : null,
      cbd_pct: cbdMatch ? parseFloat(cbdMatch[1]) : null, price: price,
      original_price: originalPrice, weight_label: weight, deal_description: dealDesc,
    });
  }
  return products;
}

function normalizeBUDRProduct(raw) {
  var normalized = normalizeProduct({
    external_id: raw.external_id, name: raw.name || '', brand: raw.brand || '',
    category: raw.category || '', subcategory: null, strain_type: raw.strain_type || null,
    price: raw.price, original_price: raw.original_price, weight_label: raw.weight_label || null,
    thc_pct: raw.thc_pct, cbd_pct: raw.cbd_pct, in_stock: true,
    deal_description: raw.deal_description || null, image_url: null, product_url: null,
  });
  normalized.category = (raw.category || '').toLowerCase();
  return normalized;
}

export async function scrapeBUDRCannabis(dispensary) {
  console.log('[budrcannabis] Scraping: ' + dispensary.name);
  if (!dispensary.store_url) {
    console.error('  [budrcannabis] No store_url for ' + dispensary.name);
    return { products: [], errors: ['No store_url configured'] };
  }

  try {
    var browser = await chromium.launch({ headless: true });
    var context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });
    var page = await context.newPage();

    try {
      // Step 1: Load store page and pass age gate
      await page.goto(dispensary.store_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      try {
        var ageBtn = page.locator('button:has-text("Yes"), a:has-text("Yes")').first();
        if (await ageBtn.isVisible({ timeout: 3000 })) {
          await ageBtn.click();
          console.log('  [budrcannabis] Age gate passed');
          await page.waitForTimeout(2000);
        }
      } catch (e) {}

      // Step 2: Navigate to /menu/all to see ALL products
      var allUrl = dispensary.store_url.replace(/\/?$/, '/') + 'menu/all';
      console.log('  [budrcannabis] Loading All Products: ' + allUrl);
      await page.goto(allUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(8000);

      // Step 3: Get total product count
      var totalProducts = await page.evaluate(function() {
        var host = document.getElementById('shadow-host');
        if (!host || !host.shadowRoot) return 0;
        var text = host.shadowRoot.textContent || '';
        var m = text.match(/(\d+)\s*products/i);
        return m ? parseInt(m[1]) : 0;
      });
      console.log('  [budrcannabis] Total products indicated: ' + totalProducts);

      // Step 4: Click "View more" repeatedly to load ALL products
      var maxClicks = Math.ceil(totalProducts / 20) + 5; // Safety margin
      var lastCount = 0;
      var stableRounds = 0;

      for (var click = 0; click < maxClicks; click++) {
        var currentCount = await page.evaluate(function() {
          var host = document.getElementById('shadow-host');
          if (!host || !host.shadowRoot) return 0;
          return (host.shadowRoot.textContent.match(/Add to bag/g) || []).length;
        });

        if (currentCount === lastCount) {
          stableRounds++;
          if (stableRounds >= 3) {
            console.log('  [budrcannabis] Product count stabilized at ' + currentCount);
            break;
          }
        } else {
          stableRounds = 0;
        }
        lastCount = currentCount;

        // Click "View more" button inside shadow DOM
        var clicked = await page.evaluate(function() {
          var host = document.getElementById('shadow-host');
          if (!host || !host.shadowRoot) return false;
          var btns = host.shadowRoot.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.trim() === 'View more') {
              btns[i].click();
              return true;
            }
          }
          return false;
        });

        if (!clicked) {
          console.log('  [budrcannabis] No more "View more" button at ' + currentCount + ' products');
          break;
        }

        await page.waitForTimeout(1500);

        // Also scroll down to trigger lazy rendering
        if (click % 3 === 0) {
          await page.evaluate(function() { window.scrollTo(0, document.body.scrollHeight); });
          await page.waitForTimeout(500);
        }

        if (click % 10 === 0 && click > 0) {
          console.log('  [budrcannabis] Loading... ' + currentCount + ' products after ' + click + ' clicks');
        }
      }

      // Step 5: Final scroll to render everything
      for (var s = 0; s < 20; s++) {
        await page.evaluate(function() { window.scrollBy(0, 800); });
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(2000);

      // Step 6: Extract and parse
      var text = await page.evaluate(function() {
        var host = document.getElementById('shadow-host');
        if (host && host.shadowRoot) return host.shadowRoot.textContent || '';
        return document.body.innerText || '';
      });

      var addToBagCount = (text.match(/Add to bag/g) || []).length;
      console.log('  [budrcannabis] Final Add to bag count: ' + addToBagCount);

      var rawProducts = parseJaneProducts(text);
      console.log('  [budrcannabis] Parsed: ' + rawProducts.length + ' raw products');

      var catCounts = {};
      var normalized = [];
      for (var i = 0; i < rawProducts.length; i++) {
        var prod = normalizeBUDRProduct(rawProducts[i]);
        var cat = (prod.category || '').toLowerCase();
        if (cat === 'accessories' || cat === 'apparel') continue;
        if (validateProduct(prod).length > 0) continue;
        catCounts[prod.category] = (catCounts[prod.category] || 0) + 1;
        normalized.push(prod);
      }

      var catInfo = Object.entries(catCounts).map(function(e) { return e[0] + ': ' + e[1]; }).join(', ');
      console.log('  [budrcannabis] Categories: ' + catInfo);
      console.log('  [budrcannabis] Done: ' + normalized.length + ' valid products');

      await page.close();
      await context.close();
      await browser.close();
      return { products: normalized, errors: [] };
    } catch (err) {
      try { await page.close(); } catch(e) {}
      try { await context.close(); } catch(e) {}
      try { await browser.close(); } catch(e) {}
      console.error('  [budrcannabis] FAILED: ' + err.message);
      return { products: [], errors: [err.message] };
    }
  } catch (err) {
    console.error('  [budrcannabis] FATAL: ' + err.message);
    return { products: [], errors: [err.message] };
  }
}

export default { scrapeBUDRCannabis };
