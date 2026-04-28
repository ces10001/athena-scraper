#!/usr/bin/env node
import { readFile, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';

const RESULTS_DIR = './data/results';
const OUTPUT_FILE = './dashboard_data.json';

const DISP_INFO = {
  // ═══ DUTCHIE (original + rec/med split) ═══
  'high-profile-canton': { name: 'High Profile - Canton', city: 'Canton' },
  'high-profile-canton-rec': { name: 'High Profile - Canton (Rec)', city: 'Canton' },
  'high-profile-canton-med': { name: 'High Profile - Canton (Med)', city: 'Canton' },
  'high-profile-hamden': { name: 'High Profile - Hamden', city: 'Hamden' },
  'high-profile-hamden-rec': { name: 'High Profile - Hamden (Rec)', city: 'Hamden' },
  'high-profile-hamden-med': { name: 'High Profile - Hamden (Med)', city: 'Hamden' },
  'high-profile-stratford': { name: 'High Profile - Stratford', city: 'Stratford' },
  'high-profile-stratford-rec': { name: 'High Profile - Stratford (Rec)', city: 'Stratford' },
  'high-profile-stratford-med': { name: 'High Profile - Stratford (Med)', city: 'Stratford' },
  'shangri-la-norwalk-main-ave': { name: 'Shangri-La - Norwalk (Main Ave)', city: 'Norwalk' },
  'shangri-la-norwalk-main-ave-rec': { name: 'Shangri-La - Norwalk Main Ave (Rec)', city: 'Norwalk' },
  'shangri-la-norwalk-main-ave-med': { name: 'Shangri-La - Norwalk Main Ave (Med)', city: 'Norwalk' },
  'shangri-la-norwalk-ct-ave': { name: 'Shangri-La - Norwalk (CT Ave)', city: 'Norwalk' },
  'shangri-la-norwalk-ct-ave-rec': { name: 'Shangri-La - Norwalk CT Ave (Rec)', city: 'Norwalk' },
  'shangri-la-norwalk-ct-ave-med': { name: 'Shangri-La - Norwalk CT Ave (Med)', city: 'Norwalk' },
  'shangri-la-waterbury': { name: 'Shangri-La - Waterbury', city: 'Waterbury' },
  'shangri-la-waterbury-rec': { name: 'Shangri-La - Waterbury (Rec)', city: 'Waterbury' },
  'shangri-la-waterbury-med': { name: 'Shangri-La - Waterbury (Med)', city: 'Waterbury' },
  'shangri-la-plainville': { name: 'Shangri-La - Plainville', city: 'Plainville' },
  'shangri-la-plainville-rec': { name: 'Shangri-La - Plainville (Rec)', city: 'Plainville' },
  'shangri-la-plainville-med': { name: 'Shangri-La - Plainville (Med)', city: 'Plainville' },
  'sweetspot-stamford': { name: 'SweetSpot - Stamford', city: 'Stamford' },
  'sweetspot-stamford-rec': { name: 'SweetSpot - Stamford (Rec)', city: 'Stamford' },
  'sweetspot-stamford-med': { name: 'SweetSpot - Stamford (Med)', city: 'Stamford' },
  'sweetspot-west-hartford': { name: 'SweetSpot - West Hartford', city: 'West Hartford' },
  'sweetspot-west-hartford-rec': { name: 'SweetSpot - West Hartford (Rec)', city: 'West Hartford' },
  'sweetspot-west-hartford-med': { name: 'SweetSpot - West Hartford (Med)', city: 'West Hartford' },
  'nova-farms-new-britain': { name: 'Nova Farms - New Britain', city: 'New Britain' },
  'nova-farms-new-britain-rec': { name: 'Nova Farms - New Britain (Rec)', city: 'New Britain' },
  'nova-farms-new-britain-med': { name: 'Nova Farms - New Britain (Med)', city: 'New Britain' },
  'still-river-wellness': { name: 'Still River Wellness', city: 'Torrington' },
  'still-river-wellness-rec': { name: 'Still River Wellness (Rec)', city: 'Torrington' },
  'still-river-wellness-med': { name: 'Still River Wellness (Med)', city: 'Torrington' },
  'crisp-cannabis-trumbull': { name: 'Crisp Cannabis - Trumbull', city: 'Trumbull' },
  'crisp-cannabis-trumbull-rec': { name: 'Crisp Cannabis - Trumbull (Rec)', city: 'Trumbull' },
  'crisp-cannabis-trumbull-med': { name: 'Crisp Cannabis - Trumbull (Med)', city: 'Trumbull' },
  'crisp-cannabis-east-hartford': { name: 'Crisp Cannabis - East Hartford', city: 'East Hartford' },
  'crisp-cannabis-east-hartford-rec': { name: 'Crisp Cannabis - East Hartford (Rec)', city: 'East Hartford' },
  'crisp-cannabis-east-hartford-med': { name: 'Crisp Cannabis - East Hartford (Med)', city: 'East Hartford' },
  'crisp-cannabis-cromwell': { name: 'Crisp Cannabis - Cromwell', city: 'Cromwell' },
  'crisp-cannabis-cromwell-rec': { name: 'Crisp Cannabis - Cromwell (Rec)', city: 'Cromwell' },
  'crisp-cannabis-cromwell-med': { name: 'Crisp Cannabis - Cromwell (Med)', city: 'Cromwell' },
  'insa-new-haven': { name: 'INSA - New Haven', city: 'New Haven' },
  'insa-new-haven-rec': { name: 'INSA - New Haven (Rec)', city: 'New Haven' },
  'insa-new-haven-med': { name: 'INSA - New Haven (Med)', city: 'New Haven' },
  'insa-hartford': { name: 'INSA - Hartford', city: 'Hartford' },
  'insa-hartford-rec': { name: 'INSA - Hartford (Rec)', city: 'Hartford' },
  'insa-hartford-med': { name: 'INSA - Hartford (Med)', city: 'Hartford' },
  'trulieve-bristol': { name: 'Trulieve - Bristol', city: 'Bristol' },
  'trulieve-bristol-rec': { name: 'Trulieve - Bristol (Rec)', city: 'Bristol' },
  'trulieve-bristol-med': { name: 'Trulieve - Bristol (Med)', city: 'Bristol' },
  'zen-leaf-meriden': { name: 'Zen Leaf - Meriden', city: 'Meriden' },
  'zen-leaf-meriden-rec': { name: 'Zen Leaf - Meriden (Rec)', city: 'Meriden' },
  'zen-leaf-meriden-med': { name: 'Zen Leaf - Meriden (Med)', city: 'Meriden' },
  'willow-brook-wellness': { name: 'Zen Leaf - Meriden', city: 'Meriden' },
  'rejoice-meriden': { name: 'Rejoice - Meriden', city: 'Meriden' },
  'rejoice-meriden-rec': { name: 'Rejoice - Meriden (Rec)', city: 'Meriden' },
  'rejoice-meriden-med': { name: 'Rejoice - Meriden (Med)', city: 'Meriden' },
  'rejoice-seymour': { name: 'Rejoice - Seymour', city: 'Seymour' },
  'rejoice-seymour-rec': { name: 'Rejoice - Seymour (Rec)', city: 'Seymour' },
  'rejoice-seymour-med': { name: 'Rejoice - Seymour (Med)', city: 'Seymour' },
  'rejoice-norwich': { name: 'Rejoice - Norwich', city: 'Norwich' },
  'rejoice-norwich-rec': { name: 'Rejoice - Norwich (Rec)', city: 'Norwich' },
  'rejoice-norwich-med': { name: 'Rejoice - Norwich (Med)', city: 'Norwich' },
  'nightjar-hamden': { name: 'Nightjar - Hamden', city: 'Hamden' },
  'nightjar-hamden-rec': { name: 'Nightjar - Hamden (Rec)', city: 'Hamden' },
  'nightjar-hamden-med': { name: 'Nightjar - Hamden (Med)', city: 'Hamden' },
  'nightjar-east-lyme': { name: 'Nightjar - East Lyme', city: 'East Lyme' },
  'nightjar-east-lyme-rec': { name: 'Nightjar - East Lyme (Rec)', city: 'East Lyme' },
  'nightjar-east-lyme-med': { name: 'Nightjar - East Lyme (Med)', city: 'East Lyme' },
  'the-liv-newington': { name: 'The Liv - Newington', city: 'Newington' },
  'the-liv-newington-rec': { name: 'The Liv - Newington (Rec)', city: 'Newington' },
  'the-liv-newington-med': { name: 'The Liv - Newington (Med)', city: 'Newington' },
  'the-liv-putnam': { name: 'The Liv - Putnam', city: 'Putnam' },
  'the-liv-putnam-rec': { name: 'The Liv - Putnam (Rec)', city: 'Putnam' },
  'the-liv-putnam-med': { name: 'The Liv - Putnam (Med)', city: 'Putnam' },
  'lit-new-haven': { name: 'Lit New Haven', city: 'New Haven' },
  'lit-new-haven-rec': { name: 'Lit New Haven (Rec)', city: 'New Haven' },
  'lit-new-haven-med': { name: 'Lit New Haven (Med)', city: 'New Haven' },
  'rodeo-cannabis-rocky-hill': { name: 'Rodeo Cannabis - Rocky Hill', city: 'Rocky Hill' },
  'rodeo-cannabis-rocky-hill-rec': { name: 'Rodeo Cannabis - Rocky Hill (Rec)', city: 'Rocky Hill' },
  'rodeo-cannabis-rocky-hill-med': { name: 'Rodeo Cannabis - Rocky Hill (Med)', city: 'Rocky Hill' },
  'awwsom': { name: 'Awwsom', city: 'Naugatuck' },
  'awwsom-rec': { name: 'Awwsom (Rec)', city: 'Naugatuck' },
  'awwsom-med': { name: 'Awwsom (Med)', city: 'Naugatuck' },
  'octane': { name: 'Octane', city: 'Enfield' },
  'octane-rec': { name: 'Octane (Rec)', city: 'Enfield' },
  'octane-med': { name: 'Octane (Med)', city: 'Enfield' },
  'the-harvest-corner': { name: 'The Harvest Corner', city: 'Colchester' },
  'the-harvest-corner-rec': { name: 'The Harvest Corner (Rec)', city: 'Colchester' },
  'the-harvest-corner-med': { name: 'The Harvest Corner (Med)', city: 'Colchester' },
  // ═══ CURALEAF (original + rec/med split) ═══
  'curaleaf-stamford': { name: 'Curaleaf - Stamford', city: 'Stamford' },
  'curaleaf-stamford-rec': { name: 'Curaleaf - Stamford (Rec)', city: 'Stamford' },
  'curaleaf-stamford-med': { name: 'Curaleaf - Stamford (Med)', city: 'Stamford' },
  'curaleaf-hartford': { name: 'Curaleaf - Hartford', city: 'Hartford' },
  'curaleaf-hartford-rec': { name: 'Curaleaf - Hartford (Rec)', city: 'Hartford' },
  'curaleaf-hartford-med': { name: 'Curaleaf - Hartford (Med)', city: 'Hartford' },
  'curaleaf-groton': { name: 'Curaleaf - Groton', city: 'Groton' },
  'curaleaf-groton-rec': { name: 'Curaleaf - Groton (Rec)', city: 'Groton' },
  'curaleaf-groton-med': { name: 'Curaleaf - Groton (Med)', city: 'Groton' },
  'curaleaf-manchester': { name: 'Curaleaf - Manchester', city: 'Manchester' },
  'curaleaf-manchester-rec': { name: 'Curaleaf - Manchester (Rec)', city: 'Manchester' },
  'curaleaf-manchester-med': { name: 'Curaleaf - Manchester (Med)', city: 'Manchester' },
  // ═══ HIGHER COLLECTIVE (rec-only) ═══
  'higher-collective-bridgeport': { name: 'Higher Collective - Bridgeport', city: 'Bridgeport' },
  'higher-collective-killingly': { name: 'Higher Collective - Killingly', city: 'Killingly' },
  'higher-collective-new-london': { name: 'Higher Collective - New London', city: 'New London' },
  'higher-collective-torrington': { name: 'Higher Collective - Torrington', city: 'Torrington' },
  'higher-collective-hamden': { name: 'Higher Collective - Hamden', city: 'Hamden' },
  // ═══ ZEN LEAF (original + rec/med split) ═══
  'zen-leaf-waterbury': { name: 'Zen Leaf - Waterbury', city: 'Waterbury' },
  'zen-leaf-waterbury-rec': { name: 'Zen Leaf - Waterbury (Rec)', city: 'Waterbury' },
  'zen-leaf-waterbury-med': { name: 'Zen Leaf - Waterbury (Med)', city: 'Waterbury' },
  'zen-leaf-naugatuck': { name: 'Zen Leaf - Naugatuck', city: 'Naugatuck' },
  'zen-leaf-naugatuck-rec': { name: 'Zen Leaf - Naugatuck (Rec)', city: 'Naugatuck' },
  'zen-leaf-naugatuck-med': { name: 'Zen Leaf - Naugatuck (Med)', city: 'Naugatuck' },
  'zen-leaf-norwich': { name: 'Zen Leaf - Norwich', city: 'Norwich' },
  'zen-leaf-norwich-rec': { name: 'Zen Leaf - Norwich (Rec)', city: 'Norwich' },
  'zen-leaf-norwich-med': { name: 'Zen Leaf - Norwich (Med)', city: 'Norwich' },
  'zen-leaf-ashford': { name: 'Zen Leaf - Ashford', city: 'Ashford' },
  'zen-leaf-ashford-rec': { name: 'Zen Leaf - Ashford (Rec)', city: 'Ashford' },
  'zen-leaf-ashford-med': { name: 'Zen Leaf - Ashford (Med)', city: 'Ashford' },
  'zen-leaf-enfield': { name: 'Zen Leaf - Enfield', city: 'Enfield' },
  'zen-leaf-enfield-rec': { name: 'Zen Leaf - Enfield (Rec)', city: 'Enfield' },
  'zen-leaf-enfield-med': { name: 'Zen Leaf - Enfield (Med)', city: 'Enfield' },
  'zen-leaf-newington': { name: 'Zen Leaf - Newington', city: 'Newington' },
  'zen-leaf-newington-rec': { name: 'Zen Leaf - Newington (Rec)', city: 'Newington' },
  'zen-leaf-newington-med': { name: 'Zen Leaf - Newington (Med)', city: 'Newington' },
  // ═══ FINE FETTLE ═══
  'fine-fettle-bristol': { name: 'Fine Fettle - Bristol', city: 'Bristol' },
  'fine-fettle-bristol-rec': { name: 'Fine Fettle - Bristol (Rec)', city: 'Bristol' },
  'fine-fettle-bristol-med': { name: 'Fine Fettle - Bristol (Med)', city: 'Bristol' },
  'fine-fettle-manchester': { name: 'Fine Fettle - Manchester', city: 'Manchester' },
  'fine-fettle-manchester-rec': { name: 'Fine Fettle - Manchester (Rec)', city: 'Manchester' },
  'fine-fettle-manchester-med': { name: 'Fine Fettle - Manchester (Med)', city: 'Manchester' },
  'fine-fettle-newington': { name: 'Fine Fettle - Newington', city: 'Newington' },
  'fine-fettle-newington-rec': { name: 'Fine Fettle - Newington (Rec)', city: 'Newington' },
  'fine-fettle-newington-med': { name: 'Fine Fettle - Newington (Med)', city: 'Newington' },
  'fine-fettle-norwalk': { name: 'Fine Fettle - Norwalk', city: 'Norwalk' },
  'fine-fettle-norwalk-rec': { name: 'Fine Fettle - Norwalk (Rec)', city: 'Norwalk' },
  'fine-fettle-norwalk-med': { name: 'Fine Fettle - Norwalk (Med)', city: 'Norwalk' },
  'fine-fettle-old-saybrook': { name: 'Fine Fettle - Old Saybrook', city: 'Old Saybrook' },
  'fine-fettle-old-saybrook-rec': { name: 'Fine Fettle - Old Saybrook (Rec)', city: 'Old Saybrook' },
  'fine-fettle-old-saybrook-med': { name: 'Fine Fettle - Old Saybrook (Med)', city: 'Old Saybrook' },
  'fine-fettle-stamford': { name: 'Fine Fettle - Stamford', city: 'Stamford' },
  'fine-fettle-stamford-rec': { name: 'Fine Fettle - Stamford (Rec)', city: 'Stamford' },
  'fine-fettle-stamford-med': { name: 'Fine Fettle - Stamford (Med)', city: 'Stamford' },
  'fine-fettle-waterbury': { name: 'Fine Fettle - Waterbury', city: 'Waterbury' },
  'fine-fettle-waterbury-rec': { name: 'Fine Fettle - Waterbury (Rec)', city: 'Waterbury' },
  'fine-fettle-waterbury-med': { name: 'Fine Fettle - Waterbury (Med)', city: 'Waterbury' },
  'fine-fettle-west-hartford': { name: 'Fine Fettle - West Hartford', city: 'West Hartford' },
  'fine-fettle-west-hartford-rec': { name: 'Fine Fettle - West Hartford (Rec)', city: 'West Hartford' },
  'fine-fettle-west-hartford-med': { name: 'Fine Fettle - West Hartford (Med)', city: 'West Hartford' },
  'fine-fettle-willimantic': { name: 'Fine Fettle - Willimantic', city: 'Willimantic' },
  'fine-fettle-willimantic-rec': { name: 'Fine Fettle - Willimantic (Rec)', city: 'Willimantic' },
  'fine-fettle-willimantic-med': { name: 'Fine Fettle - Willimantic (Med)', city: 'Willimantic' },
  // ═══ BUDR CANNABIS (original + rec/med split) ═══
  'budr-danbury-mill-plain': { name: 'BUDR - Danbury (Mill Plain)', city: 'Danbury' },
  'budr-danbury-mill-plain-rec': { name: 'BUDR - Danbury (Mill Plain) (Rec)', city: 'Danbury' },
  'budr-danbury-mill-plain-med': { name: 'BUDR - Danbury (Mill Plain) (Med)', city: 'Danbury' },
  'budr-danbury-federal-rd': { name: 'BUDR - Danbury (Federal Rd)', city: 'Danbury' },
  'budr-danbury-federal-rd-rec': { name: 'BUDR - Danbury (Federal Rd) (Rec)', city: 'Danbury' },
  'budr-danbury-federal-rd-med': { name: 'BUDR - Danbury (Federal Rd) (Med)', city: 'Danbury' },
  'budr-montville': { name: 'BUDR - Montville', city: 'Montville' },
  'budr-montville-rec': { name: 'BUDR - Montville (Rec)', city: 'Montville' },
  'budr-montville-med': { name: 'BUDR - Montville (Med)', city: 'Montville' },
  'budr-vernon': { name: 'BUDR - Vernon', city: 'Vernon' },
  'budr-vernon-rec': { name: 'BUDR - Vernon (Rec)', city: 'Vernon' },
  'budr-vernon-med': { name: 'BUDR - Vernon (Med)', city: 'Vernon' },
  'budr-west-hartford': { name: 'BUDR - West Hartford', city: 'West Hartford' },
  'budr-west-hartford-rec': { name: 'BUDR - West Hartford (Rec)', city: 'West Hartford' },
  'budr-west-hartford-med': { name: 'BUDR - West Hartford (Med)', city: 'West Hartford' },
  'budr-stratford': { name: 'BUDR - Stratford', city: 'Stratford' },
  'budr-stratford-rec': { name: 'BUDR - Stratford (Rec)', city: 'Stratford' },
  'budr-stratford-med': { name: 'BUDR - Stratford (Med)', city: 'Stratford' },
  'budr-tolland': { name: 'BUDR - Tolland', city: 'Tolland' },
  'budr-tolland-rec': { name: 'BUDR - Tolland (Rec)', city: 'Tolland' },
  'budr-tolland-med': { name: 'BUDR - Tolland (Med)', city: 'Tolland' },
  // ═══ JANE (Rise + Venu) ═══
  'rise-branford': { name: 'Rise - Branford', city: 'Branford' },
  'rise-branford-rec': { name: 'Rise - Branford (Rec)', city: 'Branford' },
  'rise-branford-med': { name: 'Rise - Branford (Med)', city: 'Branford' },
  'rise-orange': { name: 'Rise - Orange', city: 'Orange' },
  'rise-orange-rec': { name: 'Rise - Orange (Rec)', city: 'Orange' },
  'rise-orange-med': { name: 'Rise - Orange (Med)', city: 'Orange' },
  'venu-flower-collective': { name: 'Venu Flower Collective', city: 'Middletown' },
  // ═══ AFFINITY (original + rec/med split) ═══
  'affinity-dispensary': { name: 'Affinity - Bridgeport', city: 'Bridgeport' },
  'affinity-dispensary-rec': { name: 'Affinity - Bridgeport (Rec)', city: 'Bridgeport' },
  'affinity-dispensary-med': { name: 'Affinity - Bridgeport (Med)', city: 'Bridgeport' },
  'affinity-bridgeport': { name: 'Affinity - Bridgeport', city: 'Bridgeport' },
  'affinity-bridgeport-rec': { name: 'Affinity - Bridgeport (Rec)', city: 'Bridgeport' },
  'affinity-bridgeport-med': { name: 'Affinity - Bridgeport (Med)', city: 'Bridgeport' },
  'affinity-new-haven-med': { name: 'Affinity - New Haven (Med)', city: 'New Haven' },
  'affinity-new-haven-rec': { name: 'Affinity - New Haven (Rec)', city: 'New Haven' },
};

// Map old result file slugs to new canonical slugs (when config names changed)
const SLUG_REMAP = {
  'affinity-dispensary': 'affinity-bridgeport',
  'affinity-dispensary-rec': 'affinity-bridgeport-rec',
  'affinity-dispensary-med': 'affinity-bridgeport-med',
};

function getDispInfo(slug) {
  var canonical = SLUG_REMAP[slug] || slug;
  if (DISP_INFO[canonical]) return DISP_INFO[canonical];
  return { name: slug.replace(/-+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), city: 'CT' };
}

function normalizeWeight(weightLabel, name) {
  var src = ((weightLabel || '') + ' ' + (name || '')).toLowerCase();
  if (/\b1\/8\s*oz\b|\beighth\b/.test(src)) return '3.5g';
  if (/\b1\/4\s*oz\b|\bquarter\b/.test(src)) return '7g';
  if (/\b1\/2\s*oz\b|\bhalf\b/.test(src)) return '14g';
  if (/\b1\s*oz\b|\bounce\b/.test(src)) return '28g';
  var gMatch = src.match(/\b(\d+\.?\d*)\s*g\b/);
  if (gMatch) return parseFloat(gMatch[1]) + 'g';
  var mgMatch = src.match(/\b(\d+)\s*mg\b/);
  if (mgMatch) return mgMatch[1] + 'mg';
  var mlMatch = src.match(/\b(\d+)\s*ml\b/);
  if (mlMatch) return mlMatch[1] + 'ml';
  var pkMatch = src.match(/\b(\d+)\s*(?:pk|pack|ct|count)\b/);
  if (pkMatch) return pkMatch[1] + 'pk';
  return 'unknown';
}

function mapCategory(cat, subcategory, name) {
  var c = (cat || '').toLowerCase();
  var sub = (subcategory || '').toLowerCase();
  var n = (name || '').toLowerCase();
  var map = {
    'flower': 'Flower',
    'vaporizers': 'Vaporizers', 'vape': 'Vaporizers', 'vapes': 'Vaporizers',
    'edible': 'Edible', 'edibles': 'Edible',
    'pre-rolls': 'Pre-Rolls', 'pre-roll': 'Pre-Rolls',
    'concentrate': 'Concentrate', 'concentrates': 'Concentrate',
    'tincture': 'Tincture', 'tinctures': 'Tincture',
    'topical': 'Topical', 'topicals': 'Topical',
    'cbd': 'CBD',
    'beverage': 'Edible',
    'oral': 'Edible',
    'hemp-products': 'CBD',
  };
  if (map[c]) return map[c];

  if (c === 'other') {
    if (sub.includes('cartridge') || sub.includes('disposable') || sub.includes('vape')) return 'Vaporizers';
    if (sub.includes('edible') || sub.includes('gummy') || sub.includes('chocolate')) return 'Edible';
    if (sub.includes('concentrate') || sub.includes('rosin') || sub.includes('resin') || sub.includes('wax') || sub.includes('shatter')) return 'Concentrate';
    if (sub.includes('tincture')) return 'Tincture';
    if (sub.includes('topical')) return 'Topical';
    if (/\b(vape|cart|cartridge|disposable|briq)\b/i.test(n)) return 'Vaporizers';
    if (/\b(gummy|gummies|chocolate|edible|chew|lozenge|drink|seltzer|soda)\b/i.test(n)) return 'Edible';
    if (/\b(rosin|resin|wax|shatter|badder|diamond|sauce|dab)\b/i.test(n)) return 'Concentrate';
    if (/\b(tincture|drops|oil)\b/i.test(n)) return 'Tincture';
    if (/\b(pre.?roll|joint|blunt)\b/i.test(n)) return 'Pre-Rolls';
  }

  return cat || 'Other';
}

const SKIP_CATS = new Set(['accessories', 'apparel', 'gear']);
function shouldSkip(cat) { return SKIP_CATS.has((cat || '').toLowerCase()); }

const NOISE_WORDS = new Set([
  'warning', 'high', 'thc', 'cbd', 'pre', 'pack', 'prepack', 'whole',
  'flower', 'premium', 'reserve', 'select', 'grind', 'mini', 'minis',
  'cartridge', 'cart', 'vape', 'disposable', 'pod', 'roll', 'rolls',
  'infused', 'gummy', 'gummies', 'edible', 'chocolate', 'chew', 'chews',
  'tincture', 'topical', 'concentrate', 'wax', 'shatter', 'rosin', 'resin',
  'live', 'cured', 'badder', 'budder', 'sugar', 'sauce', 'diamond', 'diamonds',
  'capsule', 'capsules', 'tablet', 'tablets', 'softgel', 'softgels',
  'rec', 'med', 'adult', 'use', 'only', 'medical',
  'indica', 'sativa', 'hybrid', 'balanced',
  'pk', 'ct', 'ea', 'pck', 'eighth', 'quarter', 'half', 'ounce', 'oz',
  'small', 'buds', 'ground', 'budz', 'smalls', 'mixed',
  'rich', 'total', 'pen', 'bar', 'leaf', 'series', 'legacy', 'flavor',
  'solventless', 'distillate', 'rechargeable',
  'ba', 'sp', 'lr', 'bho', 'mt', 'aio', 'rso', 'thca',
  'fatboy', 'shorties', 'single', 'collection', 'sun', 'grown', 'dark', 'heart',
  'syringe', 'dablicator', 'oil', 'rick', 'simpson',
]);

const KNOWN_BRANDS = [
  'rythm', 'good green', 'agl', 'advanced grow labs', 'affinity', 'affinity grow',
  'curaleaf', 'select', 'grassroots', 'theraplant', 'ctpharma', 'ct pharma',
  'prime wellness', 'matter', 'kind tree', 'verano', 'encore', 'incredibles',
  'wana', 'dogwalkers', 'mindy', 'cookies', 'tyson', 'all hours', 'all:hours',
  'back forty', 'comffy', 'brix', 'brix cannabis', 'earl baker', 'lucky break', 'soundview',
  'inc edibles', 'inc.edibles', 'happy confection', 'galaxeats', 'pulsar',
  'savvy', 'find.', 'find', 'loud', 'the goods', 'miss grass',
  'lil budz', "lil' budz", 'jams', 'awssom', 'awwsom', 'rodeo', 'rodeo cannabis',
  'lets burn', "let's burn", 'higher stitch', 'springtime', 'shaka', 'zone',
  'camino', 'airo', 'amigos', 'lighthouse', 'coast', 'beboe',
  'budr', 'naature',
];

function normalizeBrand(brand) {
  var b = (brand || '').toLowerCase().trim();
  b = b.replace(/^ct\s*-?\s*/i, '');
  b = b.replace(/\s*cannabis\s*(?:co\.?)?$/i, '');
  b = b.replace(/\s*co\.?$/i, '');
  b = b.replace(/\s*pharma$/i, '');
  var brandMap = {
    'ct pharma': 'ctpharma', 'ctpharma': 'ctpharma', 'ct - pharma': 'ctpharma',
    'advanced grow labs (agl)': 'agl', 'advanced grow labs': 'agl', 'agl': 'agl',
    'brix cannabis': 'brix', 'brix': 'brix',
    "lil' budz": 'lil budz', 'lil budz': 'lil budz',
    "let's burn": 'lets burn', 'lets burn': 'lets burn',
    'miss grass': 'miss grass',
    'inc edibles': 'inc edibles', 'inc.edibles': 'inc edibles', '(inc)edibles': 'inc edibles',
    'rodeo co': 'rodeo', 'rodeo co.': 'rodeo', 'rodeo cannabis co': 'rodeo', 'rodeo cannabis co.': 'rodeo',
    'affinity grow': 'affinity', 'affinity': 'affinity',
    'the happy confection': 'happy confection', 'happy confection™️': 'happy confection', 'happy confection': 'happy confection',
    'coast cannabis co': 'coast', 'coast cannabis co.': 'coast', 'coast': 'coast',
    'on the rocks': 'on the rocks',
    'asteroid galaxeats': 'asteroid', 'asteroid confections': 'asteroid', 'asteroid': 'asteroid',
    'soundview': 'soundview',
  };
  if (brandMap[b]) return brandMap[b];
  return b.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function extractStrainTokens(name, brand) {
  var s = (name || '').toLowerCase();
  var brandLower = (brand || '').toLowerCase();
  if (brandLower && s.includes(brandLower)) s = s.replace(brandLower, '');
  for (var kb of KNOWN_BRANDS) { if (s.includes(kb)) s = s.replace(new RegExp(kb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ''); }
  s = s.replace(/\bC\d{7,}/gi, '');
  s = s.replace(/\b\d{5,}/g, '');
  s = s.replace(/\b\d{4}\b/g, '');
  s = s.replace(/\b\d+\.?\d*\s*(?:g|mg|ml|oz|lb)\b/gi, '');
  s = s.replace(/\b1\/[248]\s*oz\b/gi, '');
  s = s.replace(/\b\d+\s*(?:pk|pack|ct|count)\b/gi, '');
  s = s.replace(/\b(?:total\s+)?(?:thc|cbd|cbn|cbg|cbc)\s*:?\s*\d+\.?\d*\s*%?/gi, '');
  s = s.replace(/\b[tcbdTCBD]+\s*\d+\.?\d*\s*%?/g, '');
  s = s.replace(/\d+\.?\d*\s*%/g, '');
  s = s.replace(/\([ISHC]\)/gi, '');
  s = s.replace(/\((?:indica|sativa|hybrid|cbd)\)/gi, '');
  s = s.replace(/warning[^|]*/gi, '');
  s = s.replace(/[|()[\]{}*<>{}]/g, ' ');
  s = s.replace(/[-_/]+/g, ' ');
  s = s.replace(/#\d+/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s.split(' ').filter(function(w) {
    return w.length > 1 && !NOISE_WORDS.has(w) && !/^\d+$/.test(w);
  });
}

function makeMatchKey(brand, name, category, weight) {
  var tokens = extractStrainTokens(name, brand);
  var brandKey = normalizeBrand(brand);
  var catKey = (category || '').toLowerCase().substring(0, 5);
  var weightKey = (weight || '').toLowerCase();
  tokens.sort();
  return brandKey + '|' + catKey + '|' + weightKey + '|' + tokens.join(' ');
}

function tokenSimilarity(a, b) {
  if (a.length === 0 || b.length === 0) return 0;
  var setA = new Set(a);
  var setB = new Set(b);
  var intersection = 0;
  setA.forEach(function(t) { if (setB.has(t)) intersection++; });
  var union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
}

async function main() {
  console.log('Building dashboard_data.json...\n');
  if (!existsSync(RESULTS_DIR)) { console.error('No results directory'); process.exit(1); }
  var files = (await readdir(RESULTS_DIR)).filter(f => f.endsWith('.json'));
  if (files.length === 0) { console.error('No result files'); process.exit(1); }

  // ═══ DEDUP: Skip old parent files + old-named remapped files + stale files ═══
  var STALE_SLUGS = new Set(['higher-collective-hartford']); // No longer in config, stale data
  var fileSet = new Set(files.map(f => f.replace('.json', '')));
  var skippedOld = [];
  files = files.filter(function(f) {
    var slug = f.replace('.json', '');
    // Rule 0: Skip explicitly stale files
    if (STALE_SLUGS.has(slug)) {
      skippedOld.push(slug + ' (stale)');
      return false;
    }
    // Rule 1: Skip parent files when rec/med split versions exist
    if (!slug.endsWith('-rec') && !slug.endsWith('-med')) {
      if (fileSet.has(slug + '-rec') || fileSet.has(slug + '-med')) {
        skippedOld.push(slug);
        return false;
      }
    }
    // Rule 2: Skip old-named files when remapped new-named files exist
    if (SLUG_REMAP[slug]) {
      var newSlug = SLUG_REMAP[slug];
      if (fileSet.has(newSlug)) {
        skippedOld.push(slug + ' → ' + newSlug);
        return false;
      }
    }
    return true;
  });
  if (skippedOld.length > 0) console.log('Skipped ' + skippedOld.length + ' old/duplicate files: ' + skippedOld.join(', '));

  console.log('Processing ' + files.length + ' dispensary files');

  var allDisps = {};
  var allRaw = [];
  var skippedNoPrice = 0;

  for (var file of files) {
    var slug = file.replace('.json', '');
    var info = getDispInfo(slug);
    var raw = JSON.parse(await readFile(RESULTS_DIR + '/' + file, 'utf-8'));
    if (!Array.isArray(raw) || raw.length === 0) continue;

    var filtered = raw.filter(function(p) { return !shouldSkip(p.category); });

    allDisps[info.name] = { city: info.city, product_count: filtered.length, daily_sales: 0 };

    for (var product of filtered) {
      var mappedCat = mapCategory(product.category, product.subcategory, product.name);
      var normWeight = normalizeWeight(product.weight_label, product.name);
      var price = product.price_cents ? product.price_cents / 100 : null;

      if (!price) {
        skippedNoPrice++;
        continue;
      }

      allRaw.push({
        ...product,
        _disp: info.name,
        _price: price,
        _origPrice: product.original_price_cents ? product.original_price_cents / 100 : null,
        _cat: mappedCat,
        _weight: normWeight,
      });
    }
  }

  console.log('Loaded ' + allRaw.length + ' products from ' + Object.keys(allDisps).length + ' dispensaries');
  if (skippedNoPrice > 0) console.log('Skipped (no price): ' + skippedNoPrice);

  var catDebug = {};
  allRaw.forEach(function(p) { catDebug[p._cat] = (catDebug[p._cat] || 0) + 1; });
  console.log('Mapped categories: ' + Object.entries(catDebug).map(e => e[0] + ': ' + e[1]).join(', '));

  var dispCatDebug = {};
  allRaw.forEach(function(p) {
    if (!dispCatDebug[p._disp]) dispCatDebug[p._disp] = {};
    dispCatDebug[p._disp][p._cat] = (dispCatDebug[p._disp][p._cat] || 0) + 1;
  });
  for (var [dname, cats] of Object.entries(dispCatDebug)) {
    var catStr = Object.entries(cats).map(e => e[0] + ': ' + e[1]).join(', ');
    console.log('  ' + dname + ': ' + catStr);
  }

  var exactGroups = {};
  for (var p of allRaw) {
    var key = makeMatchKey(p.brand, p.name, p._cat, p._weight);
    if (!exactGroups[key]) exactGroups[key] = [];
    exactGroups[key].push(p);
  }
  console.log('Exact match groups: ' + Object.keys(exactGroups).length);

  var groupKeys = Object.keys(exactGroups);
  var merged = {};
  var used = new Set();

  for (var i = 0; i < groupKeys.length; i++) {
    if (used.has(i)) continue;
    var baseGroup = exactGroups[groupKeys[i]];
    var baseBrand = normalizeBrand(baseGroup[0].brand);
    var baseCat = baseGroup[0]._cat;
    var baseWeight = baseGroup[0]._weight;
    var baseTokens = extractStrainTokens(baseGroup[0].name, baseGroup[0].brand);
    var mergedGroup = [...baseGroup];
    used.add(i);

    for (var j = i + 1; j < groupKeys.length; j++) {
      if (used.has(j)) continue;
      var candGroup = exactGroups[groupKeys[j]];
      var candBrand = normalizeBrand(candGroup[0].brand);
      var candCat = candGroup[0]._cat;
      var candWeight = candGroup[0]._weight;
      // Brand must match, OR one side has empty/unknown brand
      var brandMatch = (candBrand === baseBrand) || 
                       (candBrand === '' || baseBrand === '' || candBrand === 'unknown' || baseBrand === 'unknown');
      if (!brandMatch || candCat !== baseCat) continue;
      var weightMatch = (candWeight === baseWeight) ||
                        (candWeight === 'unknown' || baseWeight === 'unknown');
      if (!weightMatch) continue;
      var candTokens = extractStrainTokens(candGroup[0].name, candGroup[0].brand);
      var sim = tokenSimilarity(baseTokens, candTokens);
      // Product code matching: extract 4-5 digit codes and check overlap
      var baseCode = (baseGroup[0].name.match(/\b0(\d{4})\b/) || [])[1];
      var candCode = (candGroup[0].name.match(/\b0(\d{4})\b/) || [])[1];
      if (baseCode && candCode && baseCode === candCode && brandMatch) { sim = 1.0; }
      // Require higher similarity when one brand is empty (to avoid false merges)
      var threshold = (candBrand === baseBrand) ? 0.5 : 0.7;
      if (sim >= threshold) {
        mergedGroup = mergedGroup.concat(candGroup);
        used.add(j);
      }
    }
    merged[groupKeys[i]] = mergedGroup;
  }
  console.log('After fuzzy merge: ' + Object.keys(merged).length + ' product groups');

  var products = [];
  var comparable = 0;

  for (var [key, group] of Object.entries(merged)) {
    var bestName = group[0].name;
    for (var g of group) { if (g.name && g.name.length > bestName.length) bestName = g.name; }

    var product = {
      name: bestName,
      brand: group[0].brand || '',
      category: group[0]._cat,
      weight: group[0]._weight,
      dispensaries: {},
      promos: {},
    };

    for (var g of group) {
      var existing = product.dispensaries[g._disp];
      if (!existing || g._price < existing) product.dispensaries[g._disp] = g._price;
      if (g.on_sale && g._origPrice && g._price < g._origPrice) {
        product.promos[g._disp] = g._price;
        product.dispensaries[g._disp] = g._origPrice;
      }
    }
    if (Object.keys(product.dispensaries).length >= 2) comparable++;
    products.push(product);
  }
  console.log('Comparable products (2+ dispensaries): ' + comparable);

  var deals = [];
  for (var p of allRaw) {
    if (p.on_sale && p._origPrice && p._price && p._price < p._origPrice) {
      var pctOff = Math.round((1 - p._price / p._origPrice) * 100);
      if (pctOff > 0 && pctOff < 100) {
        deals.push({
          product: p.name, brand: p.brand || '', dispensary: p._disp,
          category: p._cat, pct_off: pctOff,
          discounted: Math.round(p._price * 100) / 100,
          original: Math.round(p._origPrice * 100) / 100,
        });
      }
    }
  }

  var dispensaryCounts = {};
  for (var [name, info] of Object.entries(allDisps)) dispensaryCounts[name] = info.product_count;

  // Count unique physical locations (group rec/med under same base name)
  var uniqueBases = new Set();
  Object.keys(allDisps).forEach(function(name) {
    var base = name.replace(/\s*\((?:Med|Rec)\)\s*$/, '').trim();
    uniqueBases.add(base);
  });

  var output = {
    scraped_at: new Date().toISOString(),
    stats: {
      total_active: allRaw.length,
      dispensary_count: Object.keys(allDisps).length,
      unique_locations: uniqueBases.size,
      comparable: comparable,
      deals: deals.length,
      dispensary_counts: dispensaryCounts,
    },
    products: products,
    dispensaries: allDisps,
    deals: deals,
    store_promos: [],
    velocity: [],
    stock_alerts: [],
  };

  // Load store-wide promotions if available
  try {
    var promosRaw = await readFile('./data/store_promos.json', 'utf-8');
    var promosAll = JSON.parse(promosRaw);
    // Filter out generic/useless deals
    output.store_promos = promosAll.filter(function(p) {
      var t = (p.title || '').trim();
      if (t.length < 5) return false;
      if (/^(Loyalty Program|rewards program|Sign Up|Newsletter)$/i.test(t)) return false;
      return true;
    });
    console.log('  Store promos: ' + output.store_promos.length + ' (filtered from ' + promosAll.length + ')');
  } catch(e) {
    // No promos file yet — that's fine
  }

  await writeFile(OUTPUT_FILE, JSON.stringify(output));
  console.log('\nWritten to ' + OUTPUT_FILE);
  console.log('  Products:     ' + products.length);
  console.log('  Comparable:   ' + comparable);
  console.log('  Deals:        ' + deals.length);
  console.log('  Dispensaries: ' + Object.keys(allDisps).length + ' entries (' + uniqueBases.size + ' physical locations)');
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
