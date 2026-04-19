import { normalizeProduct, validateProduct } from '../lib/normalizer.mjs';

async function extractProductsFromCurrentPage(page) {
  return await page.evaluate(function() {
    var results = [];
    var seen = {};
    var links = document.querySelectorAll('a[href*="/menu/"]');

    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute('href') || '';
      var idMatch = href.match(/-(\d+)(?:\?|$)/);
      if (!idMatch) continue;
      var productId = idMatch[1];
      if (seen[productId]) continue;
      seen[productId] = true;

      var catMatch = href.match(/\/menu\/([a-z-]+)-\d+\//);
      var category = catMatch ? catMatch[1] : 'other';

      var text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 5) continue;

      var strainMatch = text.match(/\b(Sativa|Indica|Hybrid)\b/i);
      var strain = strainMatch ? strainMatch[1] : null;
      var thcMatch = text.match(/THC:\s*(\d+\.?\d*)%?/);
      var cbdMatch = text.match(/CBD:\s*(\d+\.?\d*)%?/);
      var thcMgMatch = text.match(/THC:\s*(\d+\.?\d*)\s*MG/i);
      var prices = text.match(/\$(\d+\.?\d*)/g) || [];
      var discountMatch = text.match(/(\d+)%\s*Off/i);
      var weightMatch = text.match(/\b(\d+\.?\d*)\s*g\b(?!\s*ea)/i) ||
                        text.match(/\b(\d+)\s*mg\s*$/im) ||
                        text.match(/(\d+-Pack)/i);

      var brandMatch = text.match(/by\s+([A-Za-z][A-Za-z\s.!'&]+?)(?=[A-Z][a-z]{2,})/);
      if (!brandMatch) brandMatch = text.match(/by\s+([A-Za-z][A-Za-z\s.!'&]+?)(?=THC|CBD|\$|\d+%)/);
      var brand = brandMatch ? brandMatch[1].trim() : null;

      var name = '';
      if (brand) {
        var brandIdx = text.indexOf(brand);
        var afterBrand = brandIdx + brand.length;
        var thcIdx = text.indexOf('THC:');
        var cbdIdx = text.indexOf('CBD:');
        var priceIdx = text.indexOf('$');
        var endPoints = [thcIdx, cbdIdx, priceIdx].filter(function(x) { return x > afterBrand; });
        var endIdx = endPoints.length > 0 ? Math.min.apply(null, endPoints) : text.length;
        name = text.substring(afterBrand, endIdx).trim();
        name = name.replace(/\b\d+\.?\d*\s*g\b/gi, '').replace(/\b\d+mg\b/gi, '').trim();
        name = name.replace(/^\d+\s*/, '').replace(/\s*\d+$/, '').trim();
      }
      if (!name || name.length < 2) {
        var slugMatch = href.match(/\/menu\/[^/]+\/[a-z-]+-[a-z]+-(.+?)-\d+(?:\?|$)/);
        if (slugMatch) {
          name = slugMatch[1].replace(/-/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
        }
      }

      var salePrice = null;
      var originalPrice = null;
      if (prices.length >= 2) {
        var p1 = parseFloat(prices[0].replace('$', ''));
        var p2 = parseFloat(prices[1].replace('$', ''));
        if (p1 < p2) { salePrice = p1; originalPrice = p2; }
        else { salePrice = p1; }
      } else if (prices.length === 1) {
        salePrice = parseFloat(prices[0].replace('$', ''));
      }

      if (!salePrice && !name) continue;

      results.push({
        external_id: 'curaleaf-' + productId,
        name: name || 'Unknown Product',
        brand: brand || '',
        category: category,
        strain_type: strain ? strain.toLowerCase() : null,
        thc_pct: thcMatch ? parseFloat(thcMatch[1]) : (thcMgMatch ? parseFloat(thcMgMatch[1]) : null),
        cbd_pct: cbdMatch ? parseFloat(cbdMatch[1]) : null,
        price: salePrice,
        original_price: (originalPrice && originalPrice > salePrice) ? originalPrice : null,
        weight_label: weightMatch ? weightMatch[0] : null,
        deal_description: discountMatch ? discountMatch[1] + '% Off' : (originalPrice ? 'Sale' : null),
      });
    }

    var pageLinks = document.querySelectorAll('a[href*="page="]');
    var maxPage = 1;
    for (var k = 0; k < pageLinks.length; k++) {
      var pm = (pageLinks[k].getAttribute('href') || '').match(/page=(\d+)/);
      if (pm) { var pn = parseInt(pm[1]); if (pn > maxPage) maxPage = pn; }
    }

    return { products: results, maxPage: maxPage };
  });
}

function normalizeCuraleafProduct(raw) {
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

export async function scrapeCuraleaf(dispensary) {
  console.log('[curaleaf] Scraping: ' + dispensary.name);

  if (!dispensary.store_slug) {
    console.error('  [curaleaf] No store_slug for ' + dispensary.name);
    return { products: [], errors: ['No store_slug configured'] };
  }

  try {
    var { chromium } = await import('playwright');
    var browser = await chromium.launch({ headless: tru
