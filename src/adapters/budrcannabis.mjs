import { chromium } from 'playwright';
import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

/* ═══════════════════════════════════════
   BUDR CANNABIS ADAPTER — v3
   Parses Jane-powered shadow DOM product text
   Navigates to /menu/all and clicks "View more" to load all products
   ═══════════════════════════════════════ */

function findCategoryAndBrand(block) {
  // Brand name appears RIGHT BEFORE the category keyword followed by "("
  // Character class includes ™ () and digits for brands like "The Happy Confection™" and "Advanced Grow Labs (AGL)"
  var B = '([A-Za-z0-9][A-Za-z0-9\\s.\':!&™®(),-]*)';

  var catPatterns = [
    // Flower
    [new RegExp(B + '(?:FLOWER|Flower|Small Flower|Smalls|Over:Timers|Ground Flower|Select Grind|Whole Buds|Mixed Buds|Premium Flower)\\s*\\(', 'i'), 'flower'],
    // Pre-rolls
    [new RegExp(B + '(?:THCA Infused Pre Roll|Infused Pre Roll|Infused Blunt|Pack THCA Infused Shorties|Pack Infused Pre Rolls|Pre Roll|Pre-Roll|Big Dog|Pack Mini Dogs|Mini Dogs|5 Pack Minis|10 Pack Shorties|Party Pack|Fatboy)\\s*\\(', 'i'), 'pre-rolls'],
    // Vaporizers
    [new RegExp(B + '(?:Strut All-In-One|All-In-One|AIO Vape|Cartridge|Disposable|Cliq Pod|Cliq Elite Pod|Briq|Distillate Vape|Live Resin Series|Live Terpene Vape|Pure Vape|Elite Pod|AiroPod|Mini Tank|Vape Cart|510 Cart|Pod)\\s*\\(', 'i'), 'vaporizers'],
    // Edibles
    [new RegExp(B + '(?:Macro Dosed Gummy|Gummies|Gummy|Chocolate|Chew|Lozenge|Mints|Confection|RSO Gummies|Quick Gummies|Classic Gummies|Gummie)\\s*\\(', 'i'), 'edible'],
    [new RegExp(B + '(?:Seltzer|Social Soda|Beverage|Iced Tea|Hemp-Derived)\\s*\\(', 'i'), 'edible'],
    // Concentrate
    [new RegExp(B + '(?:Badder|Live Rosin|Live Resin|Rosin|Resin|Sugar|Sauce|Diamond|Concentrate|Wax|Crumble|Shatter|RSO Syringe)\\s*\\(', 'i'), 'concentrate'],
    // Tincture
    [new RegExp(B + '(?:Tincture|Oral|Capsule|Oil Syringe|Drops|Oil)\\s*\\(', 'i'), 'tincture'],
    // Topical
    [new RegExp(B + '(?:Topical|Balm|Cream|Lotion|Salve)\\s*\\(', 'i'), 'topical'],
    // Accessories (will be filtered out)
    [new RegExp(B + '(?:Hoodie|Tee|T-Shirt|Crewneck|Sweatsuit|Designer Polo|Beanie|Cuff Beanie|Dad Hat|Pom Hat|Mesh Hat|Hat|Candle|Pipe|Chillum|Rolling Tray|Grinder|Gift Card|Sticker|Pin)\\s*\\(', 'i'), 'accessories'],
  ];

  for (var i = 0; i < catPatterns.length; i++) {
    var m = block.match(catPatterns[i][0]);
    if (m) {
      var brand = m[1].trim().replace(/\d+$/, '').trim();
      // Clean common prefixes that leak into brand
      brand = brand.replace(/^.*?(?:Sponsored|For You|New Arrivals|Best Sellers)\s*/i, '').trim();
      return { brand: brand, category: catPatterns[i][1] };
    }
  }

  // Fallback: try to detect category from keywords anywhere in block
  if (/\bFlower\b/i.test(block) && /\bTHC\b/i.test(block)) return { brand: '', category: 'flower' };
  if (/\bPre.?Roll|Shorties|Mini Dogs|Big Dog|Fatboy\b/i.test(block)) return { brand: '', category: 'pre-rolls' };
  if (/\bVape|Cart|Disposable|AIO|Pod\b/i.test(block)) return { brand: '', category: 'vaporizers' };
  if (/\bGummies|Gummy|Chocolate|Edible|Chew|Seltzer|Beverage\b/i.test(block)) return { brand: '', category: 'edible' };
  if (/\bBadder|Rosin|Resin|Concentrate|Wax\b/i.test(block)) return { brand: '', category: 'concentrate' };

  return { brand: '', category: 'other' };
}

function parseJaneProducts(text) {
  var products = [];
  var seen = {};
  var blocks = text.split('Add to bag');

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i].trim();
    if (block.length < 15) continue;
    if (/Gift Card/i.test(block) && !/THC/i.test(block)) continue;
    if (block.length > 600) block = block.substring(block.length - 600);

    // Clean section headers that get prepended
    block = block.replace(/^.*?(?:Pre-Rolls For You|Flower For You|Vapes For You|Edibles For You|Concentrates For You|New Arrivals|Best Sellers|Deals|View all)\s*/i, '');

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
      // Last price is the main price (or sale price)
      price = parseFloat(allPrices[allPrices.length - 1].replace('$', ''));
    }
    if (!price || price <= 0 || price > 500) continue;

    // Check for sale (two prices at end)
    if (allPrices.length >= 2) {
      var last = parseFloat(allPrices[allPrices.length - 1].replace('$', ''));
      var secondLast = parseFloat(allPrices[allPrices.length - 2].replace('$', ''));
      if (secondLast < last && secondLast > 0) {
        price = secondLast;
        originalPrice = last;
      }
    }

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
    if (brand && brand.length > 1) {
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
    name = name.replace(/^(?:Only \d+ left|Popular|\d+% (?:back|OFF!?)|SALE!|New|Cash back|Sponsored|.*?View all\s*)+/gi, '').trim();
    if (name.length > 80) name = name.substring(0, 80).trim();
    if (name.length < 2) continue;

    // ─── WEIGHT ───
    if (!weight) {
      var sizeMatch = block.match(/\((\d+\.?\d*)\s*[Gg]\)/) || block.match(/\((\d+\.?\d*g)\s*x/i);
      if (sizeMatch) weight = sizeMatch[1] + (sizeMatch[1].match(/g$/i) ? '' : 'g');
      else {
        var pkMatch = block.match(/(\d+)\s*pk\b/i);
        if (pkMatch) weight = pkMatch[0];
      }
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
      await page.goto(dispensary.store_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Handle age gate
      try {
        var ageBtn = page.locator('button:has-text("Yes"), a:has-text("Yes")').first();
        if (await ageBtn.isVisible({ timeout: 3000 })) {
          await ageBtn.click();
          console.log('  [budrcannabis] Age gate passed');
          await page.waitForTimeout(2000);
        }
      } catch (e) {}

      // Navigate to /menu/all using the REDIRECTED URL (some stores redirect)
      var redirectedUrl = page.url();
      // Extract base: e.g. "shop-tolland/menu/" → "shop-tolland/"
      var baseUrl = redirectedUrl.replace(/\/menu\/?.*$/, '/');
      var allUrl = baseUrl + 'menu/all';
      console.log('  [budrcannabis] Loading All Products: ' + allUrl);
      await page.goto(allUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(8000);

      // Get total product count
      var totalProducts = await page.evaluate(function() {
        var host = document.getElementById('shadow-host');
        if (!host || !host.shadowRoot) return 0;
        var text = host.shadowRoot.textContent || '';
        var m = text.match(/(\d+)\s*products/i);
        return m ? parseInt(m[1]) : 0;
      });
      console.log('  [budrcannabis] Total products indicated: ' + totalProducts);

      // Click "View more" repeatedly
      var maxClicks = Math.ceil(totalProducts / 20) + 5;
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
        } else { stableRounds = 0; }
        lastCount = currentCount;

        var clicked = await page.evaluate(function() {
          var host = document.getElementById('shadow-host');
          if (!host || !host.shadowRoot) return false;
          var btns = host.shadowRoot.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.trim() === 'View more') { btns[i].click(); return true; }
          }
          return false;
        });

        if (!clicked) {
          console.log('  [budrcannabis] No more "View more" button at ' + currentCount + ' products');
          break;
        }

        await page.waitForTimeout(1500);
        if (click % 3 === 0) {
          await page.evaluate(function() { window.scrollTo(0, document.body.scrollHeight); });
          await page.waitForTimeout(500);
        }
        if (click % 10 === 0 && click > 0) {
          console.log('  [budrcannabis] Loading... ' + currentCount + ' products after ' + click + ' clicks');
        }
      }

      // Final scroll
      for (var s = 0; s < 20; s++) {
        await page.evaluate(function() { window.scrollBy(0, 800); });
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(2000);

      // Extract and parse
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
