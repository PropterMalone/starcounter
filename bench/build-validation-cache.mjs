#!/usr/bin/env node
/**
 * Builds a validation cache by extracting candidates from a fixture,
 * then validating each unique candidate against the deployed Starcounter API.
 *
 * Usage: node bench/build-validation-cache.mjs [fixture-name] [api-url] [media-type]
 *   fixture-name defaults to "dad-movies"
 *   api-url defaults to the latest deployment
 *   media-type overrides auto-detection (MOVIE, TV_SHOW, MUSIC, SONG, VIDEO_GAME)
 */

import { readFileSync, writeFileSync } from 'fs';

const API_URL =
  process.argv[3] || 'https://f206ccf0.starcounter.pages.dev/api/validate';
const fixtureName = process.argv[2] || 'dad-movies';
const fixturePath = `bench/fixtures/${fixtureName}.json`;
const cachePath = `bench/fixtures/${fixtureName}-validation-cache.json`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1. Candidate extraction (general-purpose)
// ---------------------------------------------------------------------------

// Title case: two+ capitalized words in sequence
// Connector words include common title prepositions (from, with, by, etc.)
const TITLE_CASE_RE =
  /\b([A-Z][a-z']+(?:(?:\s+|:\s*|-\s*)(?:(?:for|from|with|the|and|of|a|an|in|on|at|to|is|or|not|no|it|its|my|his|her|as|so|but|by|&|vs\.?|v\.?)(?:\s+|:\s*|-\s*))*[A-Z][a-z']+)+)/g;

// Quoted text
const QUOTED_RE = /[""\u201c]([^""\u201d]{2,60})[""\u201d]/g;

// ALL CAPS (2+ words)
const ALL_CAPS_RE = /\b([A-Z]{2,}(?:\s+[A-Z]{2,})+)\b/g;

// Noise: common phrases that aren't titles
const NOISE = new Set([
  'I Am', 'I Was', 'I Think', 'I Love', 'I Just', 'I Mean', 'I Also',
  'Oh My', 'My Dad', 'My Father', 'Not Sure', 'Also My', 'So Good',
  'Pretty Good', 'Just Watched', 'Looking At', 'Hard Mode',
  'Dad Movie', 'Dad Movies', 'Good Movie', 'Great Movie', 'Best Movie',
  'Any Movie', 'Favorite Movie', 'This Movie', 'That Movie',
  'Fun Fact', 'Pro Tip', 'Hot Take', 'Great Answer', 'Good Call',
  'Same Here', 'Me Too', 'My Mom', 'My Kids', 'My Wife', 'My Husband',
]);

// Actor names to filter
const ACTORS = new Set([
  'Sean Connery', 'Kevin Costner', 'Clint Eastwood', 'Tom Hanks',
  'Harrison Ford', 'Russell Crowe', 'Steve Martin', 'Gene Hackman',
  'Robert Redford', 'Jeff Bridges', 'Dean Martin', 'Danny Glover',
  'Jeff Goldblum', 'Jimmy Stewart', 'Rutger Hauer', 'Matthew Broderick',
  'Michael Caine', 'Robert Duvall', 'Tommy Lee Jones', 'Al Pacino',
  'George Clooney', 'John Wayne', 'Kenneth Branagh', 'Robin Williams',
  'Eddie Murphy', 'Jim Carrey', 'Bill Murray', 'Dan Aykroyd',
  'Denzel Washington', 'Samuel L Jackson', 'Morgan Freeman',
  'Bruce Willis', 'Arnold Schwarzenegger', 'Sylvester Stallone',
  'Mel Gibson', 'Nicolas Cage', 'Tom Cruise', 'Brad Pitt',
  'Leonardo DiCaprio', 'Keanu Reeves', 'Will Smith', 'Chris Pratt',
  'Jason Statham', 'Dwayne Johnson', 'Vin Diesel', 'Liam Neeson',
  'Matt Damon', 'Ben Affleck', 'Ryan Gosling', 'Ryan Reynolds',
  'Charles Grodin', 'Peter Falk', 'Miss Piggy', 'Kermit',
  'Jim Henson', 'Frank Oz', 'James Frawley', 'Brian Henson',
]);

function extractCandidates(text) {
  if (!text || text.trim().length === 0) return [];
  const candidates = new Set();

  // Quoted text (highest confidence)
  for (const match of text.matchAll(QUOTED_RE)) {
    const t = match[1].trim();
    if (t.length >= 2 && t.split(/\s+/).length <= 10) {
      // Skip obvious non-titles
      if (!/^(my |your |i |we |he |she |it |this |that |if |but |dad )/i.test(t)) {
        candidates.add(t);
      }
    }
  }

  // Title case
  for (const match of text.matchAll(TITLE_CASE_RE)) {
    const t = match[1].trim();
    if (!NOISE.has(t) && !ACTORS.has(t) && t.length >= 3) {
      candidates.add(t);
    }
  }

  // ALL CAPS
  for (const match of text.matchAll(ALL_CAPS_RE)) {
    const raw = match[1].trim();
    if (raw.length >= 4 && !/^(WTAF|OMFG|LMAO|LMBO|OMG|LOL|WTF|IMO|IMHO|IIRC|TIL|PSA|FYI|RIP|AMA)$/.test(raw)) {
      const title = raw
        .split(/\s+/)
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(' ');
      candidates.add(title);
    }
  }

  // Image alt text (high confidence)
  for (const match of text.matchAll(/\[image alt: ([^\]]+)\]/g)) {
    const alt = match[1].trim();
    // Alt text is often descriptive, not a title. Only take short ones.
    if (alt.length <= 60 && alt.split(/\s+/).length <= 8) {
      candidates.add(alt);
    }
  }

  return [...candidates];
}

// ---------------------------------------------------------------------------
// 2. Domain detection from root post
// ---------------------------------------------------------------------------

function detectDomain(rootText) {
  const lower = (rootText || '').toLowerCase();
  if (/\b(movie|film|cinema)\b/.test(lower)) return 'MOVIE';
  if (/\b(show|series|tv)\b/.test(lower)) return 'TV_SHOW';
  if (/\b(song|album|music|band|artist|karaoke|sing)\b/.test(lower)) return 'MUSIC';
  if (/\b(game|video game|gaming)\b/.test(lower)) return 'VIDEO_GAME';
  return 'MOVIE'; // Default
}

// ---------------------------------------------------------------------------
// 3. API validation with rate limiting
// ---------------------------------------------------------------------------

async function validateTitle(title, mediaType) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, mediaType }),
    });
    if (!res.ok) return { validated: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (err) {
    return { validated: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// 4. Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Loading fixture: ${fixturePath}`);
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
  const posts = fixture.posts;
  console.log(`  ${posts.length} posts`);

  const rootText = posts[0]?.text || '';
  const mediaTypeOverride = process.argv[4];
  const mediaType = mediaTypeOverride || detectDomain(rootText);
  console.log(`  Domain: ${mediaType}${mediaTypeOverride ? ' (override)' : ` (detected from: "${rootText.slice(0, 60)}")`}`);

  // Extract all unique candidates
  console.log('\nExtracting candidates...');
  const allCandidates = new Set();
  const rootUri = posts[0]?.uri;
  for (const post of posts) {
    if (post.uri === rootUri) continue; // Skip root prompt
    let searchText = post.fullText || post.text || '';
    if (post.quotedText) searchText += '\n' + post.quotedText;
    if (post.quotedAltText) searchText += '\n' + post.quotedAltText.join('\n');
    const candidates = extractCandidates(searchText);
    for (const c of candidates) allCandidates.add(c);

    // Short-text extraction: for short posts (likely just a title answer),
    // strip emoji/punctuation and try the cleaned text as a candidate.
    // This catches all-lowercase titles like "muppets from space".
    const ownText = (post.text || '').trim();
    if (ownText.length > 0 && ownText.length <= 80) {
      const cleaned = ownText
        .replace(/[\u{1F000}-\u{1FFFF}]/gu, '') // strip emoji
        .replace(/[#@]\S+/g, '')                  // strip hashtags/mentions
        .replace(/https?:\/\/\S+/g, '')           // strip URLs
        .replace(/[^\w\s'':\-&]/g, '')            // strip most punctuation
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned.length >= 2 && cleaned.split(/\s+/).length <= 8) {
        allCandidates.add(cleaned);
      }
    }
  }
  console.log(`  ${allCandidates.size} unique candidates`);

  // Validate each candidate
  console.log(`\nValidating against ${API_URL}...`);
  const cache = {};
  let validated = 0;
  let failed = 0;
  const candidateList = [...allCandidates];

  for (let i = 0; i < candidateList.length; i++) {
    const title = candidateList[i];
    const result = await validateTitle(title, mediaType);
    cache[title] = result;

    if (result.validated) {
      validated++;
      console.log(
        `  [${i + 1}/${candidateList.length}] ✓ "${title}" → ${result.title || title} (${result.confidence})`
      );
    } else {
      failed++;
      if ((i + 1) % 20 === 0) {
        console.log(`  [${i + 1}/${candidateList.length}] ... (${validated} validated, ${failed} failed)`);
      }
    }

    // Rate limit: 100ms between requests
    await sleep(100);
  }

  console.log(`\nResults: ${validated} validated, ${failed} failed`);

  // Save cache
  const output = {
    meta: {
      fixture: fixtureName,
      mediaType,
      apiUrl: API_URL,
      generatedAt: new Date().toISOString(),
      totalCandidates: candidateList.length,
      totalValidated: validated,
    },
    validations: cache,
  };

  writeFileSync(cachePath, JSON.stringify(output, null, 2));
  console.log(`Cache written to ${cachePath}`);
}

main().catch(console.error);
