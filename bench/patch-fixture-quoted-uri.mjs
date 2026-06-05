#!/usr/bin/env node
/**
 * Patch existing fixtures to add quotedUri field.
 * Matches quotedText content against known post texts to find the quoted post's URI.
 *
 * Usage: node bench/patch-fixture-quoted-uri.mjs [fixture-name]
 */

import { readFileSync, writeFileSync } from 'fs';

const fixtureName = process.argv[2] || 'karaoke-songs';
const fixturePath = `bench/fixtures/${fixtureName}.json`;

console.log(`Patching: ${fixturePath}`);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
const posts = fixture.posts;

// Build text → URI map (use exact text match)
const textToUri = new Map();
for (const post of posts) {
  const text = post.text || '';
  if (text) {
    // Store first post with this text (root post wins for common text)
    if (!textToUri.has(text)) {
      textToUri.set(text, post.uri);
    }
  }
}

let patched = 0;
let alreadySet = 0;
let noMatch = 0;

for (const post of posts) {
  if (!post.quotedText) continue;
  if (post.quotedUri) {
    alreadySet++;
    continue;
  }

  // Try to match quotedText to a known post's text
  const matchedUri = textToUri.get(post.quotedText);
  if (matchedUri) {
    post.quotedUri = matchedUri;
    patched++;
  } else {
    noMatch++;
  }
}

console.log(`  ${patched} posts patched with quotedUri`);
console.log(`  ${alreadySet} already had quotedUri`);
console.log(`  ${noMatch} could not find matching post`);

writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
console.log(`  Saved to ${fixturePath}`);
