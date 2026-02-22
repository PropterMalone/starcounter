#!/usr/bin/env node
/**
 * Dictionary diagnostic: shows where false entries sit in the frequency table.
 * Answers: "are the false entries way down on the frequency table?"
 *
 * Usage: node bench/dictionary-diagnostic.mjs [fixture-name]
 */

import { readFileSync } from 'fs';
import { normalizeTitle, titlesMatch } from './scorer.mjs';
import { create as createTwoPhase } from './algorithms/two-phase.mjs';

const fixtureName = process.argv[2] || 'dad-movies';
const cachePath = `bench/fixtures/${fixtureName}-validation-cache.json`;
const fixturePath = `bench/fixtures/${fixtureName}.json`;
const labelsPath = `bench/labels/${fixtureName}-gold.json`;

const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
const posts = fixture.posts;

const goldData = JSON.parse(readFileSync(labelsPath, 'utf-8'));
const goldTitles = new Set();
for (const label of Object.values(goldData.labels)) {
  for (const t of label.topics || []) goldTitles.add(t);
}

// Run two-phase to get dictionary (we need to expose it)
// Hack: re-implement the dictionary discovery call directly
const cacheData = JSON.parse(readFileSync(cachePath, 'utf-8'));

// We'll capture the dictionary by monkey-patching console.log
// Actually let's just run the algorithm and capture dictionary from the log.
// Better: import the internal function. But it's not exported.
// Simplest: duplicate the create logic here to get the dictionary.

// Actually, let's just run it and parse the output — the algorithm already prints
// the top 15. But we want ALL entries. Let me just import and call it, then
// compare the predictions against gold to infer the dictionary.

// OK simplest approach: the run function prints dictionary info. Let's capture it.
// Even simpler: create a modified version that exports the dictionary.

// Fine. Let's just build the comparison from predictions.
// Aggregate: for each title in predictions, count how many posts mention it.
const run = createTwoPhase(cachePath);
const predictions = run(posts);

// Build frequency table from predictions
const titleFreq = new Map();
for (const [, titles] of predictions) {
  for (const t of titles) {
    titleFreq.set(t, (titleFreq.get(t) || 0) + 1);
  }
}

// Check each predicted title against gold
const sorted = [...titleFreq.entries()].sort((a, b) => b[1] - a[1]);

function isInGold(predTitle) {
  for (const gt of goldTitles) {
    if (titlesMatch(predTitle, gt)) return true;
  }
  return false;
}

console.log('\n' + '='.repeat(90));
console.log('DICTIONARY FREQUENCY TABLE — predicted titles ranked by post count');
console.log('='.repeat(90));
console.log(`${'Rank'.padStart(4)}  ${'Freq'.padStart(4)}  ${'Gold?'.padEnd(6)}  Title`);
console.log('-'.repeat(90));

let trueCount = 0;
let falseCount = 0;
let falseInTop10 = 0;
let falseInTop25 = 0;
let falseInTop50 = 0;

for (let i = 0; i < sorted.length; i++) {
  const [title, freq] = sorted[i];
  const inGold = isInGold(title);
  const marker = inGold ? '  ✓' : '  ✗';
  if (inGold) trueCount++;
  else {
    falseCount++;
    if (i < 10) falseInTop10++;
    if (i < 25) falseInTop25++;
    if (i < 50) falseInTop50++;
  }
  console.log(`${String(i + 1).padStart(4)}  ${String(freq).padStart(4)}  ${marker.padEnd(6)}  ${title}`);
}

console.log('\n' + '-'.repeat(90));
console.log('SUMMARY');
console.log('-'.repeat(90));
console.log(`  Total in dictionary:     ${sorted.length}`);
console.log(`  True positives:          ${trueCount} (in gold)`);
console.log(`  False positives:         ${falseCount} (not in gold)`);
console.log(`  False in top 10:         ${falseInTop10}`);
console.log(`  False in top 25:         ${falseInTop25}`);
console.log(`  False in top 50:         ${falseInTop50}`);

// Gold titles NOT found in dictionary
const goldMissing = [];
for (const gt of goldTitles) {
  const found = sorted.some(([t]) => titlesMatch(t, gt));
  if (!found) goldMissing.push(gt);
}
console.log(`\n  Gold titles missing:     ${goldMissing.length}`);
if (goldMissing.length > 0) {
  for (const t of goldMissing.slice(0, 20)) {
    console.log(`    - ${t}`);
  }
  if (goldMissing.length > 20) console.log(`    ... and ${goldMissing.length - 20} more`);
}
