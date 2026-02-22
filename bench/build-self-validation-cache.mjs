#!/usr/bin/env node
/**
 * Builds a self-validation cache for open-ended threads (no API).
 * Extracts candidates, applies self-validation heuristics, saves in
 * the same cache format as build-validation-cache.mjs.
 *
 * Usage: node bench/build-self-validation-cache.mjs [fixture-name]
 */

import { readFileSync, writeFileSync } from 'fs';

const fixtureName = process.argv[2] || 'rivers';
const fixturePath = `bench/fixtures/${fixtureName}.json`;
const cachePath = `bench/fixtures/${fixtureName}-validation-cache.json`;

// ---------------------------------------------------------------------------
// Candidate extraction (same as build-validation-cache.mjs)
// ---------------------------------------------------------------------------

const TITLE_CASE_RE =
  /\b([A-Z][a-z']+(?:(?:\s+|:\s*|-\s*)(?:(?:for|from|with|the|and|of|a|an|in|on|at|to|is|or|not|no|it|its|my|his|her|as|so|but|by|&|vs\.?|v\.?)(?:\s+|:\s*|-\s*))*[A-Z][a-z']+)+)/g;
const QUOTED_RE = /["""\u201c]([^"""\u201d]{2,60})["""\u201d]/g;
const ALL_CAPS_RE = /\b([A-Z]{2,}(?:\s+[A-Z]{2,})+)\b/g;

const NOISE = new Set([
  'I Am', 'I Was', 'I Think', 'I Love', 'I Just', 'I Mean', 'I Also',
  'Oh My', 'My Dad', 'My Father', 'Not Sure', 'Also My', 'So Good',
  'Pretty Good', 'Just Watched', 'Looking At', 'Hard Mode',
  'Dad Movie', 'Dad Movies', 'Good Movie', 'Great Movie', 'Best Movie',
  'Any Movie', 'Favorite Movie', 'This Movie', 'That Movie',
  'Fun Fact', 'Pro Tip', 'Hot Take', 'Great Answer', 'Good Call',
  'Same Here', 'Me Too', 'My Mom', 'My Kids', 'My Wife', 'My Husband',
  'Honorable Mention', 'Love That Movie',
]);

const QUOTED_NOISE = new Set([
  'dad movie', 'dad movies', 'favorite movie', 'best movie',
  'movie', 'movies', 'film', 'films', 'this one', 'that one',
]);

function extractCandidates(text) {
  if (!text || text.trim().length === 0) return [];
  const candidates = new Set();

  for (const match of text.matchAll(TITLE_CASE_RE)) {
    const m = match[1].trim();
    if (!NOISE.has(m)) candidates.add(m);
  }

  for (const match of text.matchAll(QUOTED_RE)) {
    const q = match[1].trim();
    if (!QUOTED_NOISE.has(q.toLowerCase())) candidates.add(q);
  }

  for (const match of text.matchAll(ALL_CAPS_RE)) {
    candidates.add(match[1].trim());
  }

  for (const match of text.matchAll(/\[image alt: ([^\]]+)\]/g)) {
    const alt = match[1].trim();
    if (alt.length <= 60 && alt.split(/\s+/).length <= 8) candidates.add(alt);
  }

  return [...candidates];
}

// ---------------------------------------------------------------------------
// Self-validation (ported from src/lib/self-validation.ts)
// ---------------------------------------------------------------------------

const PROMPT_PATTERN =
  /\byour\s+(?:(?:home|favorite|fav|go-to|all-time|top|first|best|worst|least\s+favorite|most\s+hated|childhood|guilty\s+pleasure)\s+)*(\w+(?:\s+\w+){0,4})/i;

const ADJECTIVES = new Set([
  'home', 'favorite', 'fav', 'go-to', 'all-time', 'top', 'first', 'best',
  'worst', 'childhood', 'guilty', 'pleasure', 'least', 'most', 'hated',
]);

const FUNCTION_WORDS = new Set([
  'so', 'and', 'or', 'but', 'for', 'from', 'with', 'the', 'a', 'an',
  'in', 'on', 'at', 'to', 'of', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'must', 'that',
  'which', 'who', 'this', 'these', 'those', 'my', 'your', 'his', 'her',
  'its', 'our', 'their', 'mine', 'yours', 'it', 'they', 'we', 'he', 'she',
  'me', 'him', 'us', 'them', 'i', 'you', 'not', 'no', 'if', 'when',
  'where', 'how', 'what', 'why', 'because', 'since', 'although', 'though',
  'while', 'until', 'after', 'before', 'during', 'about', 'into', 'through',
]);

const STOP_WORDS = new Set([
  // Adverbs & discourse markers
  'here', 'there', 'then', 'now', 'just', 'also', 'too', 'oh', 'well',
  'very', 'really', 'still', 'even', 'always', 'never', 'today',
  'absolutely', 'definitely', 'literally', 'basically', 'obviously',
  'actually', 'honestly', 'seriously', 'technically',
  // Quantifiers & determiners
  'much', 'many', 'some', 'any', 'all', 'both', 'each', 'every', 'other',
  'another', 'such', 'more', 'most', 'less', 'few', 'only', 'own', 'same',
  'than', 'like',
  // Common adjectives
  'right', 'good', 'new', 'old', 'big', 'long', 'little', 'great',
  'beautiful', 'pretty', 'amazing', 'awesome', 'gorgeous', 'incredible',
  'lovely', 'wonderful', 'terrible', 'horrible', 'perfect', 'cool', 'nice',
  'fun', 'wild', 'weird', 'funny',
  'grand', 'main', 'broad', 'flat', 'narrow', 'wide', 'deep', 'swift',
  'dark', 'bright', 'dry', 'warm', 'cold', 'rough', 'smooth', 'sharp',
  'clear', 'full', 'empty', 'open', 'straight', 'round', 'short', 'small',
  'tall', 'tiny', 'huge', 'giant', 'thick', 'thin', 'soft', 'hard',
  'heavy', 'light', 'rich', 'poor', 'clean', 'dirty', 'quiet', 'loud',
  'slow', 'fast',
  // Reactions & social media
  'yes', 'no', 'lol', 'nope', 'yep', 'yeah', 'mine', 'ours',
  // Common verbs (past tense, used in discussion)
  'love', 'grew', 'lived', 'born', 'moved', 'spent', 'miss', 'remember',
  // Directions
  'north', 'south', 'east', 'west',
  // Demonyms/nationalities
  'american', 'native', 'english', 'french', 'german', 'spanish', 'dutch',
  'irish', 'scottish', 'italian',
  // Common nouns too generic as standalone answers
  'rock', 'bay', 'pea', 'sun', 'mud', 'tar', 'salt', 'sand', 'ash',
]);

function extractCategoryWords(rootText) {
  const match = rootText.match(PROMPT_PATTERN);
  if (!match?.[1]) return [];
  const words = match[1].toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/)
    .filter(w => w && !ADJECTIVES.has(w));
  const result = [];
  for (const w of words) {
    if (FUNCTION_WORDS.has(w)) break;
    result.push(w);
    if (result.length >= 3) break;
  }
  return result;
}

function stripArticle(s) { return s.replace(/^(the|a|an)\s+/i, '').trim(); }

function selfNormalize(s) {
  let n = s.toLowerCase().trim();
  n = stripArticle(n);
  return n.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function toTitleCase(s) {
  return s.split(/\s+/).map(w => w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ');
}

function buildSelfValidatedCache(candidates, rootText) {
  const categoryWords = extractCategoryWords(rootText);
  const MAX_WORDS = 5;
  const MIN_NORM_KEY_LENGTH = 3;

  const categoryWordSet = new Set();
  for (const w of categoryWords) {
    categoryWordSet.add(w);
    categoryWordSet.add(w + 's');
    categoryWordSet.add(w + 'es');
    if (w.endsWith('y')) categoryWordSet.add(w.slice(0, -1) + 'ies');
  }

  // Group candidates by normalization key
  const groups = new Map();
  for (const candidate of candidates) {
    if (candidate.split(/\s+/).length > MAX_WORDS) continue;
    const normKey = selfNormalize(candidate);
    if (normKey.length < MIN_NORM_KEY_LENGTH) continue;
    if (categoryWordSet.has(normKey)) continue;

    const normWords = normKey.split(/\s+/);
    if (normWords.every(w => STOP_WORDS.has(w) || FUNCTION_WORDS.has(w) || ADJECTIVES.has(w) || categoryWordSet.has(w))) continue;

    const group = groups.get(normKey) ?? [];
    group.push(candidate);
    groups.set(normKey, group);
  }

  // Build cache entries
  const cache = {};
  let validated = 0;

  for (const [normKey, members] of groups) {
    // Pick canonical: most common surface form (title-cased, article stripped)
    const formCounts = new Map();
    for (const m of members) {
      const form = toTitleCase(stripArticle(m.toLowerCase()).trim());
      formCounts.set(form, (formCounts.get(form) ?? 0) + 1);
    }
    let canonical = '';
    let bestCount = 0;
    for (const [form, count] of formCounts) {
      if (count > bestCount || (count === bestCount && (canonical === '' || form.length < canonical.length))) {
        canonical = form;
        bestCount = count;
      }
    }
    if (!canonical) canonical = toTitleCase(normKey);

    // Add each member to cache
    for (const m of members) {
      cache[m] = {
        title: canonical,
        normalizedTitle: normKey,
        validated: true,
        confidence: 'high',
        mediaType: 'OTHER',
      };
      validated++;
    }
  }

  // Also mark non-validated candidates
  for (const c of candidates) {
    if (!cache[c]) {
      cache[c] = { validated: false };
    }
  }

  return { cache, validated, categoryWords };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`Loading fixture: ${fixturePath}`);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
const posts = fixture.posts;
console.log(`  ${posts.length} posts`);

const rootText = posts[0]?.text || '';
console.log(`  Root: "${rootText.slice(0, 80)}"`);

// Extract candidates
console.log('\nExtracting candidates...');
const allCandidates = new Set();
const rootUri = posts[0]?.uri;
for (const post of posts) {
  if (post.uri === rootUri) continue;
  let searchText = post.fullText || post.text || '';
  if (post.quotedText) searchText += '\n' + post.quotedText;
  if (post.quotedAltText) searchText += '\n' + post.quotedAltText.join('\n');
  const candidates = extractCandidates(searchText);
  for (const c of candidates) allCandidates.add(c);

  const ownText = (post.text || '').trim();
  if (ownText.length > 0 && ownText.length <= 80) {
    const cleaned = ownText
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
      .replace(/[#@]\S+/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[^\w\s'':\-&]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length >= 2 && cleaned.split(/\s+/).length <= 8) {
      allCandidates.add(cleaned);
    }
  }
}
console.log(`  ${allCandidates.size} unique candidates`);

// Self-validate
console.log('\nSelf-validating...');
const { cache, validated, categoryWords } = buildSelfValidatedCache(allCandidates, rootText);
console.log(`  Category words: [${categoryWords.join(', ')}]`);
console.log(`  ${validated} validated, ${allCandidates.size - validated} filtered`);

// Save
const output = {
  meta: {
    fixture: fixtureName,
    generatedAt: new Date().toISOString(),
    mode: 'self-validation',
    categoryWords,
    candidateCount: allCandidates.size,
    validatedCount: validated,
  },
  validations: cache,
};
writeFileSync(cachePath, JSON.stringify(output, null, 2));
console.log(`\nCache saved to ${cachePath}`);

// Show top validated entries
const validEntries = Object.entries(cache)
  .filter(([, v]) => v.validated)
  .sort((a, b) => a[1].title.localeCompare(b[1].title));
const uniqueTitles = [...new Set(validEntries.map(([, v]) => v.title))].sort();
console.log(`\n${uniqueTitles.length} unique canonical titles. Top 30:`);
for (const t of uniqueTitles.slice(0, 30)) {
  console.log(`  ${t}`);
}
if (uniqueTitles.length > 30) {
  console.log(`  ... and ${uniqueTitles.length - 30} more`);
}
