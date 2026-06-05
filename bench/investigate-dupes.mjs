#!/usr/bin/env node
/**
 * Investigate why certain titles appear as multiple canonical forms.
 */

import { readFileSync } from 'fs';

const cache = JSON.parse(readFileSync('bench/fixtures/karaoke-songs-validation-cache.json', 'utf-8'));
const v = cache.validations;

// Check all "Coming Back" variants
console.log('=== "Coming Back to Me" variants ===');
for (const [k, val] of Object.entries(v)) {
  if (k.toLowerCase().includes('coming back')) {
    console.log(`  "${k}" → ${val.validated ? val.title : 'NOT VALIDATED'} (${val.confidence})`);
  }
}

// Check "End of the World" variants
console.log('\n=== "End of the World" variants ===');
for (const [k, val] of Object.entries(v)) {
  if (k.toLowerCase().includes('end of the world')) {
    console.log(`  "${k}" → ${val.validated ? val.title : 'NOT VALIDATED'} (${val.confidence})`);
  }
}

// Check "Paradise" variants
console.log('\n=== "Paradise by the Dashboard" variants ===');
for (const [k, val] of Object.entries(v)) {
  if (k.toLowerCase().includes('paradise')) {
    console.log(`  "${k}" → ${val.validated ? val.title : 'NOT VALIDATED'} (${val.confidence})`);
  }
}

// Check "Thing Called Love" variants
console.log('\n=== "Thing Called Love" variants ===');
for (const [k, val] of Object.entries(v)) {
  if (k.toLowerCase().includes('thing called love')) {
    console.log(`  "${k}" → ${val.validated ? val.title : 'NOT VALIDATED'} (${val.confidence})`);
  }
}

// Check "Good One", "Hook", "Feel Fine"
console.log('\n=== Suspicious common phrases ===');
for (const key of ['Good One', 'Hook', 'Feel Fine', 'Brilliant', 'At the Disco', 'Good one', 'hook']) {
  const val = v[key];
  if (val) {
    console.log(`  "${key}" → ${val.validated ? val.title : 'NOT VALIDATED'} (${val.confidence})`);
  } else {
    console.log(`  "${key}" → NOT IN CACHE`);
  }
}

// Check "Stop Me Now"
console.log('\n=== "Stop Me Now" ===');
for (const [k, val] of Object.entries(v)) {
  if (k.toLowerCase().includes('stop me now') || k.toLowerCase().includes("don't stop")) {
    console.log(`  "${k}" → ${val.validated ? val.title : 'NOT VALIDATED'} (${val.confidence})`);
  }
}
