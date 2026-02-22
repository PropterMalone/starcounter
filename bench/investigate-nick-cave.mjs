#!/usr/bin/env node
/**
 * Investigate why "Nick Cave" appears in 1031 posts.
 */

import { readFileSync } from 'fs';

const fixture = JSON.parse(readFileSync('bench/fixtures/karaoke-songs.json', 'utf-8'));
const posts = fixture.posts;

// Count posts whose text contains "nick cave" (case-insensitive)
let textMatches = 0;
let fullTextMatches = 0;
let quotedTextMatches = 0;
let altTextMatches = 0;
const examples = [];

for (const post of posts) {
  const text = (post.text || '').toLowerCase();
  const fullText = (post.fullText || '').toLowerCase();
  const quoted = (post.quotedText || '').toLowerCase();
  const alt = (post.quotedAltText || []).join(' ').toLowerCase();

  const inText = text.includes('nick cave');
  const inFullText = fullText.includes('nick cave');
  const inQuoted = quoted.includes('nick cave');
  const inAlt = alt.includes('nick cave');

  if (inText) textMatches++;
  if (inFullText) fullTextMatches++;
  if (inQuoted) quotedTextMatches++;
  if (inAlt) altTextMatches++;

  if ((inText || inFullText || inQuoted) && examples.length < 5) {
    examples.push({
      text: text.slice(0, 100),
      fullText: fullText.slice(0, 100),
      quoted: quoted.slice(0, 100),
      handle: post.author?.handle,
    });
  }
}

console.log('Posts containing "nick cave":');
console.log(`  in .text:         ${textMatches}`);
console.log(`  in .fullText:     ${fullTextMatches}`);
console.log(`  in .quotedText:   ${quotedTextMatches}`);
console.log(`  in .quotedAltText: ${altTextMatches}`);
console.log(`\nTotal posts: ${posts.length}`);

console.log('\nSample matches:');
for (const ex of examples) {
  console.log(`\n  @${ex.handle}:`);
  console.log(`    text: "${ex.text}"`);
  if (ex.fullText !== ex.text) console.log(`    fullText: "${ex.fullText}"`);
  if (ex.quoted) console.log(`    quoted: "${ex.quoted}"`);
}

// Now check: how many posts have Title Case "Nick Cave" extracted by regex?
const TITLE_CASE_RE = /\b([A-Z][a-z']+(?:(?:\s+|:\s*|-\s*)(?:(?:for|from|with|the|and|of|a|an|in|on|at|to|is|or|not|no|it|its|my|his|her|as|so|but|by|&|vs\.?|v\.?)(?:\s+|:\s*|-\s*))*[A-Z][a-z']+)+)/g;

let regexMatches = 0;
const regexExamples = [];

for (const post of posts) {
  const searchText = (post.fullText || post.text || '') +
    (post.quotedText && post.quotedUri !== posts[0]?.uri ? '\n' + post.quotedText : '') +
    (post.quotedAltText ? '\n' + post.quotedAltText.join('\n') : '');

  TITLE_CASE_RE.lastIndex = 0;
  const allMatches = [...searchText.matchAll(TITLE_CASE_RE)].map(m => m[1]);
  const nickCaveMatches = allMatches.filter(m => m.includes('Nick Cave') || m.includes('nick cave'));

  if (nickCaveMatches.length > 0) {
    regexMatches++;
    if (regexExamples.length < 10) {
      regexExamples.push({
        handle: post.author?.handle,
        text: (post.text || '').slice(0, 80),
        matches: nickCaveMatches,
        allTitleCase: allMatches.slice(0, 5),
      });
    }
  }
}

console.log(`\nPosts where Title Case regex matches "Nick Cave": ${regexMatches}`);
for (const ex of regexExamples) {
  console.log(`\n  @${ex.handle}: ${ex.text}`);
  console.log(`    regex matched: ${JSON.stringify(ex.matches)}`);
}

// Check if "Nick Cave" is in the validation cache
const cache = JSON.parse(readFileSync('bench/fixtures/karaoke-songs-validation-cache.json', 'utf-8'));
const nickCaveEntries = Object.entries(cache.validations).filter(([k]) => k.toLowerCase().includes('nick cave'));
console.log('\nValidation cache entries matching "Nick Cave":');
for (const [k, v] of nickCaveEntries) {
  console.log(`  "${k}" → ${JSON.stringify(v)}`);
}

// Check for "cave" as a substring match
const caveEntries = Object.entries(cache.validations).filter(([k]) => k.toLowerCase().includes('cave') && !k.toLowerCase().includes('nick cave'));
console.log('\nOther cache entries with "cave":');
for (const [k, v] of caveEntries) {
  console.log(`  "${k}" → validated: ${v.validated}, title: "${v.title}"`);
}
