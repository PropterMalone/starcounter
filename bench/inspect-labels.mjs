#!/usr/bin/env node
import { readFileSync } from 'fs';

const gold = JSON.parse(readFileSync('bench/labels/dad-movies-gold.json', 'utf-8'));
const fixture = JSON.parse(readFileSync('bench/fixtures/dad-movies.json', 'utf-8'));

const posts = fixture.posts;
const labels = gold.labels;

console.log('=== SAMPLE ON-TOPIC LABELS ===');
const onTopic = posts.filter((p) => labels[p.uri]?.onTopic && labels[p.uri]?.topics?.length > 0);
const indices = [0, 5, 20, 50, 100, 200, 500, 800, 1000, 1200];
for (const i of indices) {
  const p = onTopic[i];
  if (!p) continue;
  const label = labels[p.uri];
  const text = (p.text || '').replace(/\n/g, ' ').slice(0, 70);
  console.log(`  @${(p.author?.handle || '?').slice(0, 25)}: ${text}`);
  console.log(`    Topics: ${label.topics.join(', ')} (${label.confidence})`);
  console.log();
}

console.log('=== SAMPLE OFF-TOPIC LABELS ===');
const offTopic = posts.filter((p) => labels[p.uri] && labels[p.uri].onTopic === false);
for (const p of offTopic.slice(0, 5)) {
  const label = labels[p.uri];
  const text = (p.text || '').replace(/\n/g, ' ').slice(0, 70);
  console.log(`  @${(p.author?.handle || '?').slice(0, 25)}: ${text}`);
  console.log(`    onTopic: false, note: ${label.note || ''}`);
  console.log();
}

console.log('=== CONTEXT-INHERITANCE EXAMPLES (reply posts with inherited titles) ===');
const inherited = posts.filter((p) => {
  const label = labels[p.uri];
  if (!label?.onTopic || !label.topics?.length) return false;
  // Check if this post's text doesn't explicitly mention the title
  const text = (p.text || '').toLowerCase();
  return label.topics.some((t) => !text.includes(t.toLowerCase().slice(0, 8)));
});
for (const p of inherited.slice(0, 10)) {
  const label = labels[p.uri];
  const text = (p.text || '').replace(/\n/g, ' ').slice(0, 60);
  const parent = posts.find((pp) => pp.uri === p.parentUri);
  const parentText = parent
    ? (parent.text || '').replace(/\n/g, ' ').slice(0, 50)
    : '(no parent)';
  console.log(`  @${(p.author?.handle || '?').slice(0, 20)}: ${text}`);
  console.log(`    Labeled: ${label.topics.join(', ')}`);
  console.log(`    Parent: ${parentText}`);
  console.log();
}
