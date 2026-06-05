#!/usr/bin/env node
/**
 * Finds engagement hotspots in the captured data — posts with high reposts
 * or replies that likely have unfetched QTs and reply trees we're missing.
 */

import { readFileSync } from 'fs';

const fixture = JSON.parse(readFileSync('bench/fixtures/dad-movies.json', 'utf-8'));
const posts = fixture.posts;
const rootUri = fixture.meta.atUri;

// Find posts with high repost counts (likely have QTs we're not capturing)
// Exclude the root post since we already fetch its QTs
const hotspots = posts
  .filter((p) => p.uri !== rootUri)
  .filter((p) => p.repostCount > 2 || p.replyCount > 10)
  .sort((a, b) => b.repostCount + b.replyCount - (a.repostCount + a.replyCount))
  .slice(0, 30);

console.log('ENGAGEMENT HOTSPOTS (likely have unfetched QTs)');
console.log('='.repeat(100));
console.log(
  'Reposts  Replies  Likes  Source         Post text'
);
console.log('-'.repeat(100));
for (const p of hotspots) {
  const text = p.text.replace(/\n/g, ' ').slice(0, 55);
  console.log(
    String(p.repostCount).padStart(7) +
      '  ' +
      String(p.replyCount).padStart(7) +
      '  ' +
      String(p.likeCount).padStart(5) +
      '  ' +
      p.source.padEnd(13) +
      '  @' +
      p.author.handle.slice(0, 22).padEnd(22) +
      ' ' +
      text
  );
}

// Break down by source type
console.log('\n--- By source ---');
for (const src of ['thread', 'quote', 'quote-reply']) {
  const srcPosts = posts.filter((p) => p.source === src && p.uri !== rootUri);
  const withReposts = srcPosts.filter((p) => p.repostCount >= 3);
  const totalReposts = srcPosts.reduce((s, p) => s + p.repostCount, 0);
  console.log(
    `  ${src.padEnd(15)} ${srcPosts.length} posts, ${totalReposts} total reposts, ${withReposts.length} with 3+ reposts`
  );
}

// Estimate the gap
const nonRootWithReposts = posts.filter((p) => p.uri !== rootUri && p.repostCount >= 1);
const estimatedMissing = nonRootWithReposts.reduce((s, p) => s + p.repostCount, 0);

console.log('\n--- Estimated gap ---');
console.log(`  Non-root posts with 1+ reposts: ${nonRootWithReposts.length}`);
console.log(`  Sum of their repost counts: ${estimatedMissing}`);
console.log(`  (Each repost could be a QT with its own reply tree)`);

// Show the biggest fish - posts that are likely QT'd by big accounts
const bigFish = posts
  .filter((p) => p.uri !== rootUri && p.repostCount >= 5)
  .sort((a, b) => b.repostCount - a.repostCount);

if (bigFish.length > 0) {
  console.log(`\n--- Biggest missed QT targets (5+ reposts) ---`);
  for (const p of bigFish) {
    const text = p.text.replace(/\n/g, ' ').slice(0, 70);
    console.log(`  ${p.repostCount} reposts | @${p.author.handle}: ${text}`);
    console.log(`    URI: ${p.uri}`);
  }
}
