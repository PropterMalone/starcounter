#!/usr/bin/env node
/**
 * Audit context inheritance: show all posts that would inherit
 * a title from their parent via the reaction detection mechanism.
 *
 * Usage: node bench/inheritance-audit.mjs [fixture-name]
 */

import { readFileSync } from 'fs';

const fixtureName = process.argv[2] || 'karaoke-songs';
const fixturePath = `bench/fixtures/${fixtureName}.json`;

// --- Reaction detection (copied from thread-dictionary.ts) ---
const REACTION_PATTERNS = [
  /^(yes|yep|yeah|yup|agreed|exactly|absolutely|definitely|this|same|correct|100%|💯)/i,
  /^(so good|great|amazing|incredible|love (it|this)|hell yeah|oh hell yeah)/i,
  /^(came here to say this|this is (it|the one|mine)|good (call|choice|pick|answer))/i,
  /^(underrated|overrated|classic|banger|legendary|goat|peak)/i,
  /^[^\w]*$/,
  /^(lol|lmao|lmbo|omg|omfg|ha+|😂|🤣|👏|👍|🔥|💯|❤️|🎯)+$/i,
  /^me too/i,
  /^right\??!*$/i,
  /^well,?\s*yes/i,
];

function isReaction(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 50) {
    if (REACTION_PATTERNS.some((p) => p.test(trimmed))) return true;
  }
  if (trimmed.length <= 15 && !/[A-Z][a-z]{2,}/.test(trimmed)) return true;
  return false;
}

// --- Title Case extraction (to detect if parent has a title) ---
const TITLE_CASE_RE =
  /\b([A-Z][a-z']+(?:(?:\s+|:\s*|-\s*)(?:(?:for|from|with|the|and|of|a|an|in|on|at|to|is|or|not|no|it|its|my|his|her|as|so|but|by|&|vs\.?|v\.?)(?:\s+|:\s*|-\s*))*[A-Z][a-z']+)+)/g;
const QUOTED_RE = /["""\u201c]([^"""\u201d]{2,60})["""\u201d]/g;

function hasLikelyTitle(text) {
  if (!text) return false;
  // Check for quoted text
  if (QUOTED_RE.test(text)) return true;
  QUOTED_RE.lastIndex = 0;
  // Check for title case
  if (TITLE_CASE_RE.test(text)) return true;
  TITLE_CASE_RE.lastIndex = 0;
  // Short post (likely just a title)
  const trimmed = text.trim();
  if (trimmed.length <= 60 && trimmed.split(/\s+/).length <= 5 && /^[A-Z]/.test(trimmed)) return true;
  return false;
}

// --- Main ---
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
const posts = fixture.posts;
const postByUri = new Map(posts.map((p) => [p.uri, p]));

const rootUri = posts[0]?.uri;
let reactions = 0;
let reactionsWithTitleParent = 0;
let examples = [];

for (const post of posts) {
  if (post.uri === rootUri) continue;
  const text = (post.text || '').trim();
  if (!isReaction(text)) continue;
  reactions++;

  // Find parent
  const parent = postByUri.get(post.parentUri);
  if (!parent) continue;

  const parentText = (parent.text || '').trim();
  if (hasLikelyTitle(parentText)) {
    reactionsWithTitleParent++;
    examples.push({
      reaction: text.slice(0, 50),
      parentText: parentText.slice(0, 120),
      parentAuthor: parent.author?.handle,
    });
  }
}

console.log(`Total posts: ${posts.length}`);
console.log(`Reaction posts: ${reactions}`);
console.log(`Reactions to title-containing posts: ${reactionsWithTitleParent}`);
console.log(`\n--- Sample reactions that would inherit (first 40) ---\n`);

for (const ex of examples.slice(0, 40)) {
  console.log(`  "${ex.reaction}" → @${ex.parentAuthor}:`);
  console.log(`    "${ex.parentText}"`);
  console.log();
}
