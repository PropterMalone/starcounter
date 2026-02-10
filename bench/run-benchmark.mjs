#!/usr/bin/env node
/**
 * Benchmark runner: loads fixture + gold labels, runs all algorithms,
 * scores them, and prints a comparison report.
 *
 * Usage: node bench/run-benchmark.mjs [fixture-name]
 *   fixture-name defaults to "dad-movies"
 */

import { readFileSync } from 'fs';
import { score, printComparison } from './scorer.mjs';

// Import algorithms
import { run as runBaseline } from './algorithms/baseline-extractor.mjs';
import { run as runContextInheritance } from './algorithms/context-inheritance.mjs';
import { run as runTitleDictionary } from './algorithms/title-dictionary.mjs';
import { run as runHybrid } from './algorithms/hybrid.mjs';
import { create as createApiValidated } from './algorithms/api-validated.mjs';
import { create as createTwoPhase } from './algorithms/two-phase.mjs';
import { create as createMusicExtractor } from './algorithms/music-extractor.mjs';

const fixtureName = process.argv[2] || 'dad-movies';
const cachePath = `bench/fixtures/${fixtureName}-validation-cache.json`;
const urlTitleCachePath = `bench/fixtures/${fixtureName}-url-titles.json`;
const fixturePath = `bench/fixtures/${fixtureName}.json`;
const labelsPath = `bench/labels/${fixtureName}-gold.json`;

console.log(`Loading fixture: ${fixturePath}`);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
const posts = fixture.posts;
console.log(`  ${posts.length} posts loaded`);

console.log(`Loading gold labels: ${labelsPath}`);
const goldData = JSON.parse(readFileSync(labelsPath, 'utf-8'));
const goldLabels = new Map();
for (const [uri, label] of Object.entries(goldData.labels)) {
  goldLabels.set(uri, label);
}
console.log(`  ${goldLabels.size} labels loaded`);
console.log(`  ${[...goldLabels.values()].filter((l) => l.onTopic).length} on-topic posts`);
console.log(`  ${goldData.meta?.uniqueTitles || '?'} unique titles`);

// Run each algorithm
const algorithms = [
  { name: 'Baseline (pattern extract)', run: runBaseline },
  { name: 'Title Dictionary', run: runTitleDictionary },
  { name: 'Context Inheritance', run: runContextInheritance },
  { name: 'Hybrid (dict+pattern+ctx)', run: runHybrid },
  { name: 'Music Extractor (URL+ctx)', run: createMusicExtractor(urlTitleCachePath) },
  { name: 'API-Validated (general)', run: createApiValidated(cachePath) },
  { name: 'Two-Phase (dict→label)', run: createTwoPhase(cachePath) },
];

const scores = [];

for (const algo of algorithms) {
  console.log(`\nRunning: ${algo.name}...`);
  const start = performance.now();
  const predictions = algo.run(posts);
  const elapsed = Math.round(performance.now() - start);
  console.log(`  ${predictions.size} posts with predictions (${elapsed}ms)`);

  const result = score(predictions, goldLabels, algo.name);
  scores.push(result);
}

// Print comparison
printComparison(scores);

// Print some diagnostic examples
console.log('\n' + '='.repeat(80));
console.log('DIAGNOSTIC EXAMPLES');
console.log('='.repeat(80));

// Find posts where the best algorithm fails
const best = scores.reduce((a, b) => (a.f1 > b.f1 ? a : b));
const bestPredictions = algorithms.find((a) => a.name === best.algorithm).run(posts);

let missExamples = 0;
let fpExamples = 0;

for (const [uri, gold] of goldLabels) {
  if (!gold.onTopic) continue;
  const pred = bestPredictions.get(uri) || [];
  const post = posts.find((p) => p.uri === uri);
  if (!post) continue;

  // Missed: gold has titles, algorithm found nothing
  if (gold.topics.length > 0 && pred.length === 0 && missExamples < 10) {
    missExamples++;
    const text = (post.text || '').replace(/\n/g, ' ').slice(0, 80);
    console.log(`\n  MISSED [${gold.topics.join(', ')}]:`);
    console.log(`    @${post.author?.handle}: ${text}`);
    if (post.parentUri) {
      const parent = posts.find((p) => p.uri === post.parentUri);
      if (parent) {
        console.log(`    (reply to: ${parent.text?.slice(0, 60)}...)`);
      }
    }
  }

  // False positive: algorithm found titles not in gold
  if (pred.length > 0 && gold.topics.length === 0 && fpExamples < 5) {
    fpExamples++;
    const text = (post.text || '').replace(/\n/g, ' ').slice(0, 80);
    console.log(`\n  FALSE POS [algo said: ${pred.join(', ')}]:`);
    console.log(`    @${post.author?.handle}: ${text}`);
  }
}

// Coverage stats
const totalOnTopic = [...goldLabels.values()].filter((l) => l.onTopic).length;
const totalWithTitles = [...goldLabels.values()].filter((l) => l.topics.length > 0).length;
const totalPosts = posts.length;

console.log('\n' + '='.repeat(80));
console.log('COVERAGE SUMMARY');
console.log('='.repeat(80));
console.log(`  Total posts in fixture:  ${totalPosts}`);
console.log(`  Gold-labeled posts:      ${goldLabels.size} (${Math.round((goldLabels.size / totalPosts) * 100)}%)`);
console.log(`  On-topic posts:          ${totalOnTopic}`);
console.log(`  Posts with movie titles:  ${totalWithTitles}`);
console.log(`  Unlabeled posts:         ${totalPosts - goldLabels.size}`);
