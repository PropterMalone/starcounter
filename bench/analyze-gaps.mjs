#!/usr/bin/env node
/**
 * Analyze gaps between gold labels and current best algorithm.
 */
import { readFileSync } from 'fs';
import { run as runTitleDict } from './algorithms/title-dictionary.mjs';
import { run as runHybrid } from './algorithms/hybrid.mjs';
import { normalizeTitle, titlesMatch } from './scorer.mjs';

const fixture = JSON.parse(readFileSync('bench/fixtures/dad-movies.json', 'utf-8'));
const gold = JSON.parse(readFileSync('bench/labels/dad-movies-gold.json', 'utf-8'));
const posts = fixture.posts;
const goldLabels = new Map(Object.entries(gold.labels));

// Title distribution
const titleCounts = {};
for (const label of Object.values(gold.labels)) {
  if (!label.onTopic) continue;
  for (const t of label.topics) {
    titleCounts[t] = (titleCounts[t] || 0) + 1;
  }
}
const sorted = Object.entries(titleCounts).sort((a, b) => b[1] - a[1]);
console.log('Top 40 titles by gold label count:');
sorted.slice(0, 40).forEach(([t, c], i) =>
  console.log('  ' + String(i + 1).padStart(3) + '. ' + t.padEnd(55) + String(c).padStart(4))
);
console.log('\nTotal unique titles:', sorted.length);
console.log('Titles with 1 mention:', sorted.filter(([, c]) => c === 1).length);
console.log('Titles with 2-5:', sorted.filter(([, c]) => c >= 2 && c <= 5).length);
console.log('Titles with 6+:', sorted.filter(([, c]) => c >= 6).length);

// Run title dictionary and find what it misses
const dictPredictions = runTitleDict(posts);

// Per-title recall for title dictionary
console.log('\n\nTITLE DICTIONARY - TITLES WITH WORST RECALL (6+ gold mentions):');
console.log('Title'.padEnd(55) + 'Gold  Found  Recall');
console.log('-'.repeat(80));

const titleRecall = {};
for (const [uri, label] of goldLabels) {
  if (!label.onTopic) continue;
  const pred = dictPredictions.get(uri) || [];
  for (const gt of label.topics) {
    if (!titleRecall[gt]) titleRecall[gt] = { gold: 0, found: 0 };
    titleRecall[gt].gold++;
    if (pred.some((p) => titlesMatch(p, gt))) {
      titleRecall[gt].found++;
    }
  }
}

const worstRecall = Object.entries(titleRecall)
  .filter(([, v]) => v.gold >= 6)
  .map(([t, v]) => ({ title: t, ...v, recall: v.found / v.gold }))
  .sort((a, b) => a.recall - b.recall);

for (const item of worstRecall) {
  console.log(
    item.title.padEnd(55) +
      String(item.gold).padStart(4) +
      String(item.found).padStart(6) +
      '  ' +
      (item.recall * 100).toFixed(0).padStart(5) + '%'
  );
}

// Sample missed posts for titles with 0% recall
console.log('\n\nSAMPLE MISSED POSTS (0% recall titles):');
const zeroRecall = worstRecall.filter((t) => t.recall === 0);
for (const item of zeroRecall.slice(0, 5)) {
  console.log(`\n  === ${item.title} (${item.gold} gold mentions) ===`);
  let shown = 0;
  for (const post of posts) {
    const label = goldLabels.get(post.uri);
    if (!label || !label.topics.includes(item.title)) continue;
    if (shown >= 3) break;
    shown++;
    const text = (post.text || '').replace(/\n/g, ' ').slice(0, 100);
    console.log(`    @${post.author?.handle}: ${text}`);
    if (label.note) console.log(`      Note: ${label.note}`);
  }
}

// Analyze what context inheritance could catch
console.log('\n\nCONTEXT INHERITANCE POTENTIAL:');
const postsByUri = new Map();
for (const p of posts) postsByUri.set(p.uri, p);

let couldInherit = 0;
let totalMissed = 0;
for (const [uri, label] of goldLabels) {
  if (!label.onTopic || label.topics.length === 0) continue;
  const pred = dictPredictions.get(uri) || [];
  const allFound = label.topics.every((gt) => pred.some((p) => titlesMatch(p, gt)));
  if (allFound) continue;
  totalMissed++;

  // Check if parent has correct predictions
  const post = postsByUri.get(uri);
  if (post && post.parentUri) {
    const parentPred = dictPredictions.get(post.parentUri) || [];
    const parentMatches = label.topics.some((gt) => parentPred.some((p) => titlesMatch(p, gt)));
    if (parentMatches) couldInherit++;
  }
}
console.log(`  Missed posts: ${totalMissed}`);
console.log(`  Could inherit from parent: ${couldInherit} (${((couldInherit / totalMissed) * 100).toFixed(1)}%)`);
