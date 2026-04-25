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
    name = name.replace(/^(?:Sponsored|Only \d+ left|Popular|\d+% (?:back|OFF!?)|SALE!|New|Cash back|Jane Gold.*?View all|Our Best.*?View all|.*?View all\s*)+/gi, '').trim();
    
    // ─── BUDR shadow DOM cleanup: strip concatenated brand/category/weight ───
    // Strip trailing weight: (3.5G), (14G), (EACH), (.5G), etc.
    name = name.replace(/\s*\(\s*\.?\d*\.?\d*\s*[Gg]\s*\)\s*$/i, '');
    name = name.replace(/\s*\(EACH\)\s*$/i, '');
    
    // Strip trailing category labels concatenated from shadow DOM
    name = name.replace(/\s*(FLOWER|Flower|Pre Roll|Pre-Roll|Cartridge|Vape|Gummies|Gummy|Edible|Infused Blunt|Mini Tank|Mixed Buds|Disposable|AIO|5 Pack Pre Rol|5 Pack Mini Dogs|Infused Pre-Roll|BRIQ Flavor Series Dispo|RSO Syringe|Live Resin|Tincture|Topical|Capsule|Spray|Beverage|Seltzer|Chocolate|Confection|Lozenges|Concentrate|10 Pack|Elite Pod|Strut All-In-One|Macro Dosed Gummy|Purple Cones|Pink Cones|Tea Leaf Cones|Pink Rolling|Rose Wraps|King Size Cones|Hemp Wraps)\s*(\(.*\))?\s*$/i, '');
    
    // Strip trailing brand name duplicates
    var ctBrands = ['Theraplant','CTPharma','CTP','Curaleaf','Advanced Grow Labs','AGL','Affinity','Affinity Grow','BRIX','Brix Cannabis','RYTHM','Rythm','Select','SelectLegacy Series','Savvy','Good Green','Dogwalkers','Encore','Encore Edibles','Camino','Wana','Zone','Shaka','Awssom','FIND','Find','Springtime','SoundView','Comffy','Amigos','Lighthouse','Rodeo','Rodeo Cannabis','Rodeo Cannabis Co','Miss Grass','Earl Baker','COAST Cannabis Co','Coast','Let\'s Burn','Nova','Crisp','Lucky Break','Loud','Borealis Cannabis','JAMS','Grassroots','Dark Heart','inc.edibles','all:hours','Canyon Water','Fizz','Corgi','Flying Corgi','Airo Brands','Airo','Blazy Susan','Budr','The Happy Confection','On The Rocks','Edie Parker','Asteroid','Asteroid Galaxeats','Loki','Hi5','Five Islands','Chemdog','Cookies','Craic','Float House','Hyphen','\'Fused','Fused','ozBudrHemp'];
    for (var bi = 0; bi < ctBrands.length; bi++) {
      var bn = ctBrands[bi];
      var bnIdx = name.lastIndexOf(bn);
      if (bnIdx > 5 && bnIdx > name.length - bn.length - 5) {
        name = name.substring(0, bnIdx).trim();
        if (!brand) brand = bn;
        break;
      }
    }
    // Also try brand at the START if brand is still empty
    if (!brand) {
      for (var bi = 0; bi < ctBrands.length; bi++) {
        var bn = ctBrands[bi];
        if (name.startsWith(bn + ' ') || name.startsWith(bn + '|')) {
          brand = bn;
          break;
        }
      }
    }
    // Fallback: scan the full block text for brand names
    if (!brand) {
      for (var bi = 0; bi < ctBrands.length; bi++) {
        var bn = ctBrands[bi];
        if (bn.length < 4) continue; // Skip short brand names to avoid false matches
        if (block.includes(bn)) {
          brand = bn;
          break;
        }
      }
    }
    
    name = name.replace(/\s*\(\s*\)\s*$/, '').trim();
    
    // ─── Fix category using detected keywords ───
    if (category === 'other' || !category) {
      var nameLower = name.toLowerCase();
      var blockLower = block.toLowerCase();
      if (blockLower.includes('mixed buds') || blockLower.includes('whole flower') || blockLower.includes('smalls') || blockLower.includes('pre-pack') || (nameLower.match(/\b(?:flower|3\.5g|7g|14g|28g|1oz)\b/) && !nameLower.includes('vape') && !nameLower.includes('cart'))) category = 'flower';
      else if (blockLower.includes('elite pod') || blockLower.includes('aio') || blockLower.includes('all-in-one') || blockLower.includes('cartridge') || blockLower.includes('vape') || blockLower.includes('disposable') || blockLower.includes('distillate') || blockLower.includes('mini tank') || blockLower.includes('briq') || blockLower.includes('airoPod')) category = 'vaporizers';
      else if (blockLower.includes('gummies') || blockLower.includes('gummy') || blockLower.includes('chocolate') || blockLower.includes('confection') || blockLower.includes('seltzer') || blockLower.includes('beverage') || blockLower.includes('lozenge') || blockLower.includes('rso') || blockLower.includes('edible')) category = 'edible';
      else if (blockLower.includes('pre roll') || blockLower.includes('pre-roll') || blockLower.includes('preroll') || blockLower.includes('infused blunt') || blockLower.includes('mini dogs') || blockLower.includes('big dog') || blockLower.includes('big ray')) category = 'pre-rolls';
      else if (blockLower.includes('badder') || blockLower.includes('rosin') || blockLower.includes('live resin') || blockLower.includes('wax') || blockLower.includes('shatter') || blockLower.includes('concentrate')) category = 'concentrate';
      else if (blockLower.includes('tincture') || blockLower.includes('oil') || blockLower.includes('dropper')) category = 'tincture';
      else if (blockLower.includes('topical') || blockLower.includes('balm') || blockLower.includes('cream') || blockLower.includes('transdermal') || blockLower.includes('roll-on')) category = 'topical';
    }
    
    // Filter out non-cannabis products (accessories, papers, etc.)
    if (name.match(/Blazy Susan|Zig.?Zag|Hemp Wraps|Rolling Papers?|Cones \d+pk|Accessories|Grinder/i)) continue;
    
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
