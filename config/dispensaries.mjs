// ATHENA — CT Dispensary Database (Dutchie Focus)
// Updated April 17, 2026 — IDs captured via live browser recon
//
// For Dutchie dispensaries you need TWO things:
//   1. api_base     — the dispensary's own website (proxies Dutchie API)
//   2. dispensary_id — 24-char hex ID (from Chrome DevTools → Network → filter "dispensary_id")
//
// HOW TO FIND A MISSING dispensary_id:
//   1. Open the dispensary website in Chrome
//   2. Right-click → Inspect → Network tab
//   3. Reload the page
//   4. In the filter box, type: dispensary_id
//   5. Click on the Google Analytics request that appears
//   6. In the URL, find ep.dispensary_id=XXXXXXXXXXXXXXXXXXXXXXXX
//   7. Copy that 24-character hex string
//   8. Paste it below as the dispensary_id value

export const CT_DISPENSARIES = [

  // ════════════════════════════════════════════════════
  // HIGH PROFILE (C3 Industries) — 3 CT locations
  // api_base confirmed: highprofilecannabis.com
  // ════════════════════════════════════════════════════
  {
    name: "High Profile - Canton",
    city: "Canton",
    platform: "dutchie",
    api_base: "https://highprofilecannabis.com",
    dispensary_id: "662a9bc046220d3c1b6df676",  // ✅ CONFIRMED via live recon
    menu_url: "https://highprofilecannabis.com/stores/ct-canton-hp",
  },
  {
    name: "High Profile - Hamden",
    city: "Hamden",
    platform: "dutchie",
    api_base: "https://highprofilecannabis.com",
    dispensary_id: null,  // ❓ NEED: open highprofilecannabis.com/stores/ct-hamden-hp → DevTools → get ID
    menu_url: "https://highprofilecannabis.com/stores/ct-hamden-hp",
  },
  {
    name: "High Profile - Stratford",
    city: "Stratford",
    platform: "dutchie",
    api_base: "https://highprofilecannabis.com",
    dispensary_id: null,  // ❓ NEED: open highprofilecannabis.com/stores/ct-stratford-hp → DevTools → get ID
    menu_url: "https://highprofilecannabis.com/stores/ct-stratford-hp",
  },

  // ════════════════════════════════════════════════════
  // SHANGRI-LA — 5 CT locations
  // api_base confirmed: shangriladispensaries.com
  // ════════════════════════════════════════════════════
  {
    name: "Shangri-La - Norwalk (Main Ave)",
    city: "Norwalk",
    platform: "dutchie",
    api_base: "https://shangriladispensaries.com",
    dispensary_id: "65415b87b296d800097b6601",  // ✅ CONFIRMED via live recon
    menu_url: "https://shangriladispensaries.com/stores/shangri-la-norwalk",
  },
  {
    name: "Shangri-La - South Norwalk",
    city: "Norwalk",
    platform: "dutchie",
    api_base: "https://shangriladispensaries.com",
    dispensary_id: null,  // ❓ NEED
    menu_url: "https://shangriladispensaries.com/stores/shangri-la-norwalk-ct-ave",
  },
  {
    name: "Shangri-La - Waterbury",
    city: "Waterbury",
    platform: "dutchie",
    api_base: "https://shangriladispensaries.com",
    dispensary_id: null,  // ❓ NEED
    menu_url: "https://shangriladispensaries.com/stores/shangri-la-waterbury",
  },
  {
    name: "Shangri-La - Plainville",
    city: "Plainville",
    platform: "dutchie",
    api_base: "https://shangriladispensaries.com",
    dispensary_id: null,  // ❓ NEED
    menu_url: "https://shangriladispensaries.com/stores/shangri-la-plainville",
  },
  {
    name: "Shangri-La - East Hartford",
    city: "East Hartford",
    platform: "dutchie",
    api_base: "https://shangriladispensaries.com",
    dispensary_id: null,  // ❓ NEED
    menu_url: "https://shangriladispensaries.com/stores/shangri-la-east-hartford",
  },

  // ════════════════════════════════════════════════════
  // STILL RIVER WELLNESS — 1 location
  // ════════════════════════════════════════════════════
  {
    name: "Still River Wellness",
    city: "Torrington",
    platform: "dutchie",
    api_base: "https://stillriverwellness.com",
    dispensary_id: "63bec4feda338000b42c120d",  // ✅ CONFIRMED via live recon
    menu_url: "https://stillriverwellness.com/pre-order/",
  },

  // ════════════════════════════════════════════════════
  // SWEETSPOT — 1 CT location
  // ════════════════════════════════════════════════════
  {
    name: "SweetSpot - Stamford",
    city: "Stamford",
    platform: "dutchie",
    api_base: "https://sweetspotfarms.com",
    dispensary_id: null,  // ❓ NEED: open sweetspotfarms.com → DevTools → get ID
    menu_url: "https://sweetspotfarms.com/stores/sweetspot-stamford",
  },

  // ════════════════════════════════════════════════════
  // NOVA FARMS — 1 CT location
  // ════════════════════════════════════════════════════
  {
    name: "Nova Farms - New Britain",
    city: "New Britain",
    platform: "dutchie",
    api_base: "https://novafarms.com",
    dispensary_id: null,  // ❓ NEED: open novafarms.com New Britain menu → DevTools → get ID
    menu_url: "https://novafarms.com",
  },

  // ════════════════════════════════════════════════════
  // CRISP CANNABIS — 4 CT locations
  // ════════════════════════════════════════════════════
  {
    name: "Crisp Cannabis - Bridgeport",
    city: "Bridgeport",
    platform: "dutchie",
    api_base: "https://crispcannabis.com",
    dispensary_id: null,  // ❓ NEED
    menu_url: "https://crispcannabis.com",
  },
  {
    name: "Crisp Cannabis - Trumbull",
    city: "Trumbull",
    platform: "dutchie",
    api_base: "https://crispcannabis.com",
    dispensary_id: null,  // ❓ NEED
    menu_url: "https://crispcannabis.com",
  },
  {
    name: "Crisp Cannabis - East Hartford",
    city: "East Hartford",
    platform: "dutchie",
    api_base: "https://crispcannabis.com",
    dispensary_id: null,  // ❓ NEED
    menu_url: "https://crispcannabis.com",
  },
  {
    name: "Crisp Cannabis - Cromwell",
    city: "Cromwell",
    platform: "dutchie",
    api_base: "https://crispcannabis.com",
    dispensary_id: null,  // ❓ NEED
    menu_url: "https://crispcannabis.com",
  },

  // ════════════════════════════════════════════════════
  // YOUR STORE — use as benchmark data
  // ════════════════════════════════════════════════════
  {
    name: "Affinity Dispensary",
    city: "Bridgeport",
    platform: "owner",
    api_base: "https://www.affinityct.com",
    dispensary_id: null,  // You know this — it's YOUR Dutchie account
    menu_url: "https://www.affinityct.com/menu-med-bridgeport",
  },
];
