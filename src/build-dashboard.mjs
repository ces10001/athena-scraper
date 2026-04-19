#!/usr/bin/env node
import { readFile, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';

const RESULTS_DIR = './data/results';
const OUTPUT_FILE = './dashboard_data.json';

const DISP_INFO = {
  'high-profile-canton': { name: 'High Profile - Canton', city: 'Canton' },
  'high-profile-hamden': { name: 'High Profile - Hamden', city: 'Hamden' },
  'high-profile-stratford': { name: 'High Profile - Stratford', city: 'Stratford' },
  'shangri-la-norwalk-main-ave': { name: 'Shangri-La - Norwalk (Main Ave)', city: 'Norwalk' },
  'shangri-la-norwalk-ct-ave': { name: 'Shangri-La - Norwalk (CT Ave)', city: 'Norwalk' },
  'shangri-la-waterbury': { name: 'Shangri-La - Waterbury', city: 'Waterbury' },
  'shangri-la-plainville': { name: 'Shangri-La - Plainville', city: 'Plainville' },
  'sweetspot-stamford': { name: 'SweetSpot - Stamford', city: 'Stamford' },
  'sweetspot-west-hartford': { name: 'SweetSpot - West Hartford', city: 'West Hartford' },
  'nova-farms-new-britain': { name: 'Nova Farms - New Britain', city: 'New Britain' },
  'still-river-wellness': { name: 'Still River Wellness', city: 'Torrington' },
  'crisp-cannabis-trumbull': { name: 'Crisp Cannabis - Trumbull', city: 'Trumbull' },
  'crisp-cannabis-east-hartford': { name: 'Crisp Cannabis - East Hartford', city: 'East Hartford' },
  'crisp-cannabis-cromwell': { name: 'Crisp Cannabis - Cromwell', city: 'Cromwell' },
  'insa-new-haven': { name: 'INSA - New Haven', city: 'New Haven' },
  'insa-hartford': { name: 'INSA - Hartford', city: 'Hartford' },
  'trulieve-bristol': { name: 'Trulieve - Bristol', city: 'Bristol' },
  'zen-leaf-meriden': { name: 'Zen Leaf - Meriden', city: 'Meriden' },
  'willow-brook-wellness': { name: 'Zen Leaf - Meriden', city: 'Meriden' },
  'rejoice-meriden': { name: 'Rejoice - Meriden', city: 'Meriden' },
  'rejoice-seymour': { name: 'Rejoice - Seymour', city: 'Seymour' },
  'rejoice-norwich': { name: 'Rejoice - Norwich', city: 'Norwich' },
  'nightjar-hamden': { name: 'Nightjar - Hamden', city: 'Hamden' },
  'nightjar-east-lyme': { name: 'Nightjar - East Lyme', city: 'East Lyme' },
  'the-liv-newington': { name: 'The Liv - Newington', city: 'Newington' },
  'the-liv-putnam': { name: 'The Liv - Putnam', city: 'Putnam' },
  'lit-new-haven': { name: 'Lit New Haven', city: 'New Haven' },
  'rodeo-cannabis-rocky-hill': { name: 'Rodeo Cannabis - Rocky Hill', city: 'Rocky Hill' },
  'awwsom': { name: 'Awwsom', city: 'Naugatuck' },
  'octane': { name: 'Octane', city: 'Enfield' },
  'the-harvest-corner': { name: 'The Harvest Corner', city: 'Colchester' },
  'curaleaf-stamford': { name: 'Curaleaf - Stamford', city: 'Stamford' },
  'curaleaf-hartford': { name: 'Curaleaf - Hartford', city: 'Hartford' },
  'curaleaf-groton': { name: 'Curaleaf - Groton', city: 'Groton' },
  'curaleaf-manchester': { name: 'Curaleaf - Manchester', city: 'Manchester' },
  'higher-collective-bridgeport': { name: 'Higher Collective - Bridgeport', city: 'Bridgeport' },
  'higher-collective-killingly': { name: 'Higher Collective - Killingly', city: 'Killingly' },
  'higher-collective-new-london': { name: 'Higher Collective - New London', city: 'New London' },
  'higher-collective-torrington': { name: 'Higher Collective - Torrington', city: 'Torrington' },
  'higher-collective-hamden': { name: 'Higher Collective - Hamden', city: 'Hamden' },
  'zen-leaf-waterbury': { name: 'Zen Leaf - Waterbury', city: 'Waterbury' },
  'zen-leaf-naugatuck': { name: 'Zen Leaf - Naugatuck', city: 'Naugatuck' },
  'zen-leaf-norwich': { name: 'Zen Leaf - Norwich', city: 'Norwich' },
  'zen-leaf-ashford': { name: 'Zen Leaf - Ashford', city: 'Ashford' },
  'zen-leaf-enfield': { name: 'Zen Leaf - Enfield', city: 'Enfield' },
  'zen-leaf-newington': { name: 'Zen Leaf - Newington', city: 'Newington' },
  'fine-fettle-bristol': { name: 'Fine Fettle - Bristol', city: 'Bristol' },
  'fine-fettle-manchester': { name: 'Fine Fettle - Manchester', city: 'Manchester' },
  'fine-fettle-newington': { name: 'Fine Fettle - Newington', city: 'Newington' },
  'fine-fettle-norwalk': { name: 'Fine Fettle - Norwalk', city: 'Norwalk' },
  'fine-fettle-old-saybrook': { name: 'Fine Fettle - Old Saybrook', city: 'Old Saybrook' },
  'fine-fettle-stamford': { name: 'Fine Fettle - Stamford', city: 'Stamford' },
  'fine-fettle-waterbury': { name: 'Fine Fettle - Waterbury', city: 'Waterbury' },
  'fine-fettle-west-hartford': { name: 'Fine Fettle - West Hartford', city: 'West Hartford' },
  'fine-fettle-willimantic': { name: 'Fine Fettle - Willimantic', city: 'Willimantic' },
  'budr-danbury-mill-plain': { name: 'BUDR - Danbury (Mill Plain)', city: 'Danbury' },
  'budr-danbury-federal-rd': { name: 'BUDR - Danbury (Federal Rd)', city: 'Danbury' },
  'budr-montville': { name: 'BUDR - Montville', city: 'Montville' },
  'budr-vernon': { name: 'BUDR - Vernon', city: 'Vernon' },
  'budr-west-hartford': { name: 'BUDR - West Hartford', city: 'West Hartford' },
  'budr-stratford': { name: 'BUDR - Stratford', city: 'Stratford' },
  'budr-tolland': { name: 'BUDR - Tolland', city: 'Tolland' },
  'rise-branford': { name: 'Rise - Branford', city: 'Branford' },
  'rise-orange': { name: 'Rise - Orange', city: 'Orange' },
  'venu-flower-collective': { name: 'Venu Flower Collective', city: 'Middletown' },
  'affinity-dispensary': { name: 'Affinity Dispensary', city: 'Bridgeport' },
  'affinity-new-haven-med': { name: 'Affinity Dispensary - New Haven (Med)', city: 'New Haven' },
  'affinity-new-haven-rec': { name: 'Affinity Dispensary - New Haven (Rec)', city: 'New Haven' },
};

function getDispInfo(slug) {
  if (DISP_INFO[slug]) return DISP_INFO[slug];
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
