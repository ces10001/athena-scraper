import { chromium } from 'playwright';
import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

function parseJaneProducts(text) {
  var products = [];
  var seen = {};
  var blocks = text.split('Add to bag');

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i].trim();
    if (block.length < 15) continue;
    if (block.includes('Gift Card') || block.includes('gift card')) continue;

    var strainMatch = block.match(/\b(Sativa|Indica|Hybrid)\b/i);
    var strain = strainMatch ? strainMatch[1].toLowerCase() : null;

    var thcMatch = block.match(/THC\s*(\d+\.?\d*)%?/) || block.match(/(\d+\.?\d*)\s*mg\s*THC/i) || block.match(/(\d+\.?\d*)mg THC/i);
    var cbdMatch = block.match(/CBD\s*(\d+\.?\d*)%?/) || block.match(/(\d+\.?\d*)\s*mg\s*CBD/i);

    var priceWeightMatch = block.match(/\$(\d+\.?\d*)\/(\d+\.?\d*\s*(?:g|mg|ml|oz))/i);
    var plainPrice = block.match(/\$(\d+\.?\d*)/);

    var price = null;
    var weight = null;

    if (priceWeightMatch) {
      price = parseFloat(priceWeightMatch[1]);
      weight = priceWeightMatch[2].trim();
    } else if (plainPrice) {
      price = parseFloat(plainPrice[1]);
    }

    if (!price || price <= 0) continue;

    var brand = '';
    var name = '';

    // Try to extract name from start of block
    var endIdx = Math.min(
      block.indexOf('THC') > 0 ? block.indexOf('THC') : 999,
      block.indexOf('CBD') > 0 ? block.indexOf('CBD') : 999,
      block.indexOf('$') > 0 ? block.indexOf('$') : 999,
      120
    );
    name = block.substring(0, endIdx).trim();
    name = name.replace(/^(Sativa|Indica|Hybrid)\s*/i, '').trim();

    // Extract brand from name (pattern: "BrandProduct NameBrandCategory")
    var brandMatch = name.match(/^(.+?)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*$/);
    if (!brandMatch) {
      // Try another pattern: look for repeated brand name
      var nameText = block.substring(0, Math.min(block.indexOf('$') || 200, 200));
      var words = nameText.split(/(?=[A-Z])/);
      if (words.length > 2) {
        name = nameText.substring(0, 60).trim();
      }
    }

    name = name.replace(/\s+/g, ' ').trim();
    if (name.length > 80) name = name.substring(0, 80).trim();
    if (name.length < 3) continue;

    var category = 'other';
    var catPatterns = [
      [/\bFlower\b/i, 'flower'],
      [/\bGround Flower\b/i, 'flower'],
      [/\bPre Roll|Pre-Roll|Shorties\b/i, 'pre-rolls'],
      [/\bVape|Cartridge|Cart|AIO|BRIQ|Disposable\b/i, 'vaporizers'],
      [/\bEdible|Gummy|Gummies|Chocolate|Confection|Seltzer|Beverage\b/i, 'edible'],
      [/\bConcentrate|Rosin|Resin|Wax|Badder|Shatter|Crumble\b/i, 'concentrate'],
      [/\bTincture|Oil|Drops\b/i, 'tincture'],
      [/\bTopical|Balm|Cream\b/i, 'topical'],
    ];
    for (var cp = 0; cp < catPatterns.length; cp++) {
      if (catPatterns[cp][0].test(block)) { category = catPatterns[cp][1]; break; }
    }

    if (!weight) {
      var wMatch = block.match(/\((\d+\.?\d*)\s*[Gg]\)/) || block.match(/(\d+\.?\d*)\s*(?:g|oz)\b/i);
      if (wMatch) weight = wMatch[1] + 'g';
    }

    var productCode = block.match(/\b(\d{5})\b/)?.[1] || block.match(/\b(\d{4,6})\b/)?.[1];
    var externalId = 'budrcannabis-' + (productCode || (name + price).replace(/[^a-z0-9]/gi, '').substring(0, 20));

    if (seen[externalId]) continue;
    seen[externalId] = true;

    products.push({
      external_id: externalId,
      name: name,
      brand: brand,
      category: category,
      strain_type: strain,
      thc_pct: thcMatch ? parseFloat(thcMatch[1]) : null,
      cbd_pct: cbdMatch ? parseFloat(cbdMatch[1]) : null,
      price: price,
      original_price: null,
      weight_label: weight,
      deal_description: null,
    });
  }

  return products;
}

function normalizeBUDRProduct(raw) {
  var normalized = normalizeProduct({
    external_id: raw.external_id,
    name: raw.name || '',
    brand: raw.brand || '',
    category: raw.category || '',
    subcategory: null,
    strain_type: raw.strain_type || null,
    price: raw.price,
    original_price: raw.original_price,
    weight_label: raw.weight_label || null,
    thc_pct: raw.thc_pct,
    cbd_pct: raw.cbd_pct,
    in_stock: true,
    deal_description: raw.deal_description || null,
    image_url: null,
    product_url: null,
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

      // Handle age gate - click "Yes" button
      try {
        var ageBtn = page.locator('button:has-text("Yes"), a:has-text("Yes")').first();
        if (await ageBtn.isVisible({ timeout: 3000 })) {
          await ageBtn.click();
          console.log('  [budrcannabis] Age gate passed');
          await page.waitForTimeout(2000);
        }
      } catch (e) {
        // No age gate
      }

      // Wait for shadow DOM to load with products
      await page.waitForTimeout(8000);

      // Scroll to trigger lazy loading inside shadow DOM
      for (var s = 0; s < 15; s++) {
        await page.evaluate(function() { window.scrollBy(0, 600); });
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(2000);

      // Extract text from shadow DOM
      var text = await page.evaluate(function() {
        var host = document.getElementById('shadow-host');
        if (host && host.shadowRoot) {
          return host.shadowRoot.textContent || '';
        }
        // Fallback: try regular DOM
        return document.body.innerText || '';
      });

      console.log('  [budrcannabis] Shadow DOM text: ' + text.length + ' chars');

      var addToBagCount = (text.match(/Add to bag/g) || []).length;
      console.log('  [budrcannabis] Add to bag buttons: ' + addToBagCount);

      // Parse products using Jane-style parser
      var rawProducts = parseJaneProducts(text);
      console.log('  [budrcannabis] Parsed: ' + rawProducts.length + ' raw products');

      // Normalize and validate
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
