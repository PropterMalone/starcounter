#!/usr/bin/env node
/**
 * Diagnostic: Run two-phase pipeline on karaoke fixture and show results.
 * No gold labels needed — just inspect what the algorithm produces.
 *
 * Usage: node bench/run-karaoke-diagnostic.mjs
 */

import { readFileSync } from 'fs';
import { create as createTwoPhase } from './algorithms/two-phase.mjs';

const fixtureName = process.argv[2] || 'karaoke-songs';
const cachePath = `bench/fixtures/${fixtureName}-validation-cache.json`;
const fixturePath = `bench/fixtures/${fixtureName}.json`;

console.log(`Loading fixture: ${fixturePath}`);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
const posts = fixture.posts;
console.log(`  ${posts.length} posts`);

// Also load cache directly for analysis
const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
const validations = cache.validations;
const validatedCount = Object.values(validations).filter((v) => v.validated).length;
const totalCount = Object.keys(validations).length;
console.log(`  ${validatedCount}/${totalCount} candidates validated in cache`);

// Run two-phase
console.log('\n' + '='.repeat(80));
console.log('RUNNING TWO-PHASE PIPELINE');
console.log('='.repeat(80));

const run = createTwoPhase(cachePath);
const predictions = run(posts);

console.log(`\n  ${predictions.size} posts labeled (of ${posts.length - 1} non-root)`);

// Build mention counts from predictions
const mentionCounts = new Map();
for (const [, titles] of predictions) {
  for (const title of titles) {
    mentionCounts.set(title, (mentionCounts.get(title) || 0) + 1);
  }
}

// Sort by count
const sorted = [...mentionCounts.entries()].sort((a, b) => b[1] - a[1]);

console.log('\n' + '='.repeat(80));
console.log(`TOP RESULTS (${sorted.length} unique titles)`);
console.log('='.repeat(80));

for (const [title, count] of sorted.slice(0, 50)) {
  console.log(`  ${String(count).padStart(4)}  ${title}`);
}

if (sorted.length > 50) {
  console.log(`  ... and ${sorted.length - 50} more`);
}

// Show the long tail
console.log('\n' + '='.repeat(80));
console.log('LONG TAIL (count = 1)');
console.log('='.repeat(80));

const singletons = sorted.filter(([, c]) => c === 1);
console.log(`  ${singletons.length} titles with exactly 1 mention:`);
for (const [title] of singletons.slice(0, 40)) {
  console.log(`    ${title}`);
}
if (singletons.length > 40) {
  console.log(`    ... and ${singletons.length - 40} more`);
}

// Spot-check: show some sample predictions with post text
console.log('\n' + '='.repeat(80));
console.log('SAMPLE PREDICTIONS (every 50th labeled post)');
console.log('='.repeat(80));

const labeledPosts = posts.filter((p) => predictions.has(p.uri));
const indices = Array.from({ length: 20 }, (_, i) => i * 50).filter((i) => i < labeledPosts.length);
for (const i of indices) {
  const p = labeledPosts[i];
  const titles = predictions.get(p.uri);
  const text = (p.text || '').replace(/\n/g, ' ').slice(0, 80);
  console.log(`\n  @${(p.author?.handle || '?').slice(0, 25)}: ${text}`);
  console.log(`    → [${titles.join(', ')}]`);
}

// Show posts labeled via inheritance (no title text in post)
console.log('\n' + '='.repeat(80));
console.log('INHERITED LABELS (post text doesn\'t contain the title)');
console.log('='.repeat(80));

let inheritCount = 0;
const inheritExamples = [];
for (const p of posts) {
  const titles = predictions.get(p.uri);
  if (!titles) continue;
  const text = (p.text || '').toLowerCase();
  const allInherited = titles.every((t) => !text.includes(t.toLowerCase().slice(0, 6)));
  if (allInherited && text.length < 80) {
    inheritCount++;
    if (inheritExamples.length < 30) {
      const parent = posts.find((pp) => pp.uri === p.parentUri);
      inheritExamples.push({
        text: (p.text || '').replace(/\n/g, ' ').slice(0, 60),
        titles,
        parentText: parent ? (parent.text || '').replace(/\n/g, ' ').slice(0, 60) : '(no parent)',
      });
    }
  }
}

console.log(`  ${inheritCount} posts appear to be inherited labels`);
for (const ex of inheritExamples) {
  console.log(`\n  "${ex.text}"`);
  console.log(`    → [${ex.titles.join(', ')}]`);
  console.log(`    parent: "${ex.parentText}"`);
}

// Quality flags: suspicious patterns
console.log('\n' + '='.repeat(80));
console.log('QUALITY FLAGS');
console.log('='.repeat(80));

// Flag: titles that look like common phrases, not song names
const suspiciousShort = sorted.filter(([title]) => {
  const words = title.split(/\s+/);
  return words.length <= 2 && title.length <= 10;
});
console.log(`\n  Short titles (≤2 words, ≤10 chars): ${suspiciousShort.length}`);
for (const [title, count] of suspiciousShort.slice(0, 20)) {
  console.log(`    ${String(count).padStart(4)}  ${title}`);
}

// Flag: titles with very generic words
const genericWords = new Set(['the', 'this', 'that', 'it', 'my', 'love', 'good', 'one', 'time', 'right']);
const suspiciousGeneric = sorted.filter(([title]) => {
  const words = title.toLowerCase().split(/\s+/).filter((w) => !genericWords.has(w));
  return words.length === 0;
});
console.log(`\n  All-generic-word titles: ${suspiciousGeneric.length}`);
for (const [title, count] of suspiciousGeneric) {
  console.log(`    ${String(count).padStart(4)}  ${title}`);
}
