import { chromium } from 'playwright';
import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

async function extractProductsFromBUDR(page) {
  return await page.evaluate(async () => {
    const results = [];
    const seen = {};

    // Scroll to trigger lazy loading - CRITICAL for Shopify
    for (let scroll = 0; scroll < 20; scroll++) {
      window.scrollBy(0, 600);
      await new Promise(r => setTimeout(r, 250));
    }

    // Extract products from Shopify grid
    // Look for product links with various Shopify patterns
    const selectors = [
      'a[href*="/products/"]',
      '[data-product-id] a',
      '.product-item a',
      '[class*="ProductCard"] a',
      '[class*="product-card"] a'
    ];

    let productLinks = [];
    for (const sel of selectors) {
      productLinks = document.querySelectorAll(sel);
      if (productLinks.length > 0) break;
    }

    // Fallback: get all links that look like products
    if (productLinks.length === 0) {
      productLinks = Array.from(document.querySelectorAll('a')).filter(a => 
        a.href.includes('/products/') && a.textContent.length > 3
      );
    }

    // Extract text from each product area
    const productContainers = document.querySelectorAll(
      '[data-product-id], [class*="ProductCard"], [class*="product-card"], li[class*="product"]'
    );

    for (let i = 0; i < productContainers.length; i++) {
      const container = productContainers[i];
      const text = (container.textContent || '').replace(/\s+/g, ' ').trim();
      
      if (!text || text.length < 10) continue;

      // Extract price (look for $ pattern)
      const priceMatch = text.match(/\$(\d+\.?\d*)/);
      if (!priceMatch) continue;

      const price = parseFloat(priceMatch[1]);
      if (price <= 0 || price > 500) continue; // Sanity check

      // Extract product name (usually first part before price/THC)
      let name = text;
      const nameEndIdx = Math.min(
        text.indexOf('$') > 0 ? text.indexOf('$') : 999,
        text.indexOf('THC') > 0 ? text.indexOf('THC') : 999,
        text.indexOf('CBD') > 0 ? text.indexOf('CBD') : 999,
        200
      );
      if (nameEndIdx < 200) {
        name = text.substring(0, nameEndIdx).trim();
      }
      name = name.replace(/^(Sativa|Indica|Hybrid)\s*/i, '').trim();
      name = name.substring(0, 80);

      if (!name || name.length < 3) continue;

      // Extract brand (usually "Brand Name -" pattern)
      let brand = '';
      const brandMatch = name.match(/^([A-Za-z][A-Za-z0-9\s.&!']+?)\s*[-\u2013\u2014]/);
      if (brandMatch) {
        brand = brandMatch[1].trim();
        name = name.substring(brandMatch[0].length).trim();
      }

      // Extract cannabinoids
      const thcMatch = text.match(/THC\s*[:\s]*(\d+\.?\d*)%?/i);
      const cbdMatch = text.match(/CBD\s*[:\s]*(\d+\.?\d*)%?/i);

      // Extract strain type
      const strainMatch = text.match(/\b(Sativa|Indica|Hybrid)\b/i);
      const strain = strainMatch ? strainMatch[1].toLowerCase() : null;

      // Extract weight
      const weightMatch = text.match(/(\d+\.?\d*)\s*(?:g|mg|ml|oz)/);
      const weight = weightMatch ? weightMatch[0] : null;

      // Create unique ID
      const productId = container.getAttribute('data-product-id') || 
                       (name + price).replace(/\W/g, '').substring(0, 20);
      const externalId = 'budrcannabis-' + productId;

      if (seen[externalId]) continue;
      seen[externalId] = true;

      results.push({
        external_id: externalId,
        name: name,
        brand: brand || '',
        category: determineCategoryFromText(text),
        strain_type: strain,
        thc_pct: thcMatch ? parseFloat(thcMatch[1]) : null,
        cbd_pct: cbdMatch ? parseFloat(cbdMatch[1]) : null,
        price: price,
        original_price: null,
        weight_label: weight,
        deal_description: null,
      });
    }

    return results;
  });
}

function determineCategoryFromText(text) {
  const lower = text.toLowerCase();
  if (lower.includes('flower') || lower.includes('oz') || lower.includes('gram')) return 'flower';
  if (lower.includes('pre-roll') || lower.includes('pre roll') || lower.includes('preroll')) return 'pre-rolls';
  if (lower.includes('vape') || lower.includes('cartridge') || lower.includes('cart') || lower.includes('disposable')) return 'vaporizers';
  if (lower.includes('edible') || lower.includes('gummy') || lower.includes('gummies') || lower.includes('chocolate')) return 'edible';
  if (lower.includes('concentrate') || lower.includes('wax') || lower.includes('rosin') || lower.includes('live resin')) return 'concentrate';
  if (lower.includes('tincture') || lower.includes('oil') || lower.includes('drops')) return 'tincture';
  if (lower.includes('topical') || lower.includes('balm') || lower.includes('cream')) return 'topical';
  return 'other';
}

function normalizeBUDRProduct(raw) {
  const normalized = normalizeProduct({
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
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();
    
    try {
      await page.goto(dispensary.store_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Handle age gate if present
      try {
        const ageButton = await page.locator('button:has-text("I confirm"), button:has-text("Yes"), [aria-label*="21"]').first();
        if (await ageButton.isVisible()) {
          await ageButton.click();
          await page.waitForTimeout(1500);
        }
      } catch (e) {
        // No age gate, continue
      }

      // Extract products
      const rawProducts = await extractProductsFromBUDR(page);
      console.log('  [budrcannabis] Extracted: ' + rawProducts.length + ' raw products');

      // Normalize and validate
      const catCounts = {};
      const normalized = [];
      for (const raw of rawProducts) {
        const prod = normalizeBUDRProduct(raw);
        const cat = (prod.category || '').toLowerCase();
        
        // Filter out non-products
        if (cat === 'accessories' || cat === 'apparel') continue;
        if (validateProduct(prod).length > 0) continue;
        
        catCounts[prod.category] = (catCounts[prod.category] || 0) + 1;
        normalized.push(prod);
      }

      const catInfo = Object.entries(catCounts).map(e => e[0] + ': ' + e[1]).join(', ');
      console.log('  [budrcannabis] Categories: ' + catInfo);
      console.log('  [budrcannabis] Done: ' + normalized.length + ' valid products');

      await page.close();
      await context.close();
      await browser.close();

      return { products: normalized, errors: [] };
    } catch (err) {
      await page.close();
      await context.close();
      await browser.close();
      console.error('  [budrcannabis] FAILED: ' + err.message);
      return { products: [], errors: [err.message] };
    }
  } catch (err) {
    console.error('  [budrcannabis] FATAL: ' + err.message);
    return { products: [], errors: [err.message] };
  }
}

export default { scrapeBUDRCannabis };
