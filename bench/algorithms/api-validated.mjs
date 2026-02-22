/**
 * API-Validated algorithm: general-purpose candidate extraction + API validation cache.
 *
 * This is the "domain-agnostic" algorithm. It doesn't know about specific movies,
 * TV shows, or music. Instead it:
 *
 * 1. Extracts candidates using regex patterns (title case, quotes, ALL CAPS, alt text)
 * 2. Looks up each candidate in a pre-built validation cache (from TMDB/MusicBrainz/IGDB)
 * 3. Uses the API's canonical title (not the raw candidate text)
 * 4. Filters by confidence (medium+ required to avoid false positives)
 * 5. Applies context inheritance for reaction/agreement posts
 *
 * Usage:
 *   import { create } from './algorithms/api-validated.mjs';
 *   const run = create('bench/fixtures/letterboxd-validation-cache.json');
 *   const predictions = run(posts);
 */

import { readFileSync } from 'fs';

// ---------------------------------------------------------------------------
// 1. Candidate extraction (general-purpose, expanded from build-validation-cache)
// ---------------------------------------------------------------------------

// Title case: two+ capitalized words in sequence.
// Connector words expanded to catch titles like "Muppets from Space", "Dances with Wolves"
const TITLE_CASE_RE =
  /\b([A-Z][a-z']+(?:(?:\s+|:\s*|-\s*)(?:(?:for|from|with|the|and|of|a|an|in|on|at|to|is|or|not|no|it|its|my|his|her|as|so|but|by|&|vs\.?|v\.?)(?:\s+|:\s*|-\s*))*[A-Z][a-z']+)+)/g;

// Quoted text
const QUOTED_RE = /["""\u201c]([^"""\u201d]{2,60})["""\u201d]/g;

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

// Common non-title quoted fragments
const QUOTED_NOISE = new Set([
  'dad movie', 'dad movies', 'favorite movie', 'best movie',
  'movie', 'movies', 'film', 'films', 'this one', 'that one',
]);

function extractCandidates(text) {
  if (!text || text.trim().length === 0) return [];
  const candidates = new Set();

  // Quoted text (highest confidence)
  for (const match of text.matchAll(QUOTED_RE)) {
    const t = match[1].trim();
    if (t.length >= 2 && t.split(/\s+/).length <= 10) {
      const lower = t.toLowerCase();
      if (!QUOTED_NOISE.has(lower)) {
        // Skip sentence fragments
        if (!/^(my |your |i |we |he |she |it |this |that |if |but |when |where |what |why |how )/i.test(t)) {
          // Skip single words unless they're plausibly a title (capitalized)
          if (t.split(/\s+/).length >= 2 || /^[A-Z]/.test(t)) {
            candidates.add(t);
          }
        }
      }
    }
  }

  // Title case
  for (const match of text.matchAll(TITLE_CASE_RE)) {
    const t = match[1].trim();
    if (!NOISE.has(t) && t.length >= 3) {
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

  // Image alt text
  for (const match of text.matchAll(/\[image alt: ([^\]]+)\]/g)) {
    const alt = match[1].trim();
    if (alt.length <= 60 && alt.split(/\s+/).length <= 8) {
      candidates.add(alt);
    }
  }

  return [...candidates];
}

// ---------------------------------------------------------------------------
// 2. Reaction detection (for context inheritance)
// ---------------------------------------------------------------------------

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
  /^🎶/,
];

function isReaction(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 50) {
    return REACTION_PATTERNS.some((p) => p.test(trimmed));
  }
  if (trimmed.length <= 15 && !/[A-Z][a-z]{2,}/.test(trimmed)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 3. Factory: create(cachePath) -> run(posts)
// ---------------------------------------------------------------------------

/**
 * Create an api-validated algorithm instance for a specific validation cache.
 * @param {string} cachePath - Path to the validation cache JSON
 * @returns {function(Array): Map<string, string[]>} - run(posts) function
 */
export function create(cachePath) {
  let validations;
  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf-8'));
    validations = data.validations;
  } catch {
    return (posts) => {
      console.warn(`  ⚠ No validation cache at ${cachePath}`);
      return new Map();
    };
  }

  // Build lookup: lowercase candidate → { canonical, confidence }
  const lookup = new Map();
  for (const [candidate, result] of Object.entries(validations)) {
    if (result.validated) {
      lookup.set(candidate.toLowerCase(), {
        canonical: result.title,
        confidence: result.confidence,
      });
    }
  }

  // Build reverse-lookup: validated canonical titles for substring scanning.
  // Deduplicate by canonical title, keep best confidence, sort longest-first
  // so "The Muppet Christmas Carol" matches before "The Muppet".
  const reverseEntries = new Map(); // canonical → { patterns: Set<lowercase>, confidence }
  for (const [candidate, result] of Object.entries(validations)) {
    if (!result.validated || result.confidence === 'low') continue;
    const canonical = result.title;
    if (!reverseEntries.has(canonical)) {
      reverseEntries.set(canonical, { patterns: new Set(), confidence: result.confidence });
    }
    reverseEntries.get(canonical).patterns.add(candidate.toLowerCase());
  }
  // Sort by pattern length descending (match longest first to avoid partial matches)
  const reverseLookup = [...reverseEntries.entries()]
    .map(([canonical, { patterns, confidence }]) => ({
      canonical,
      patterns: [...patterns].sort((a, b) => b.length - a.length),
      confidence,
    }))
    .sort((a, b) => b.patterns[0].length - a.patterns[0].length);

  return function run(posts) {
    const postsByUri = new Map();
    for (const p of posts) postsByUri.set(p.uri, p);
    const rootUri = posts[0]?.uri;

    const predictions = new Map();

    // Pass 1: Extract candidates and validate against cache
    for (const post of posts) {
      if (post.uri === rootUri) continue; // Skip root prompt

      const ownText = post.fullText || post.text || '';
      let searchText = ownText;
      // Don't include quotedText for QTs of the root prompt (it's the prompt itself)
      if (post.quotedText && post.quotedUri !== rootUri) {
        searchText += '\n' + post.quotedText;
      }
      if (post.quotedAltText) {
        searchText += '\n' + post.quotedAltText.join('\n');
      }

      const candidates = extractCandidates(searchText);
      const validTitles = new Set();

      // Forward lookup: extracted candidate → cache
      for (const candidate of candidates) {
        const entry = lookup.get(candidate.toLowerCase());
        if (!entry) continue;
        if (entry.confidence !== 'low') {
          validTitles.add(entry.canonical);
        } else {
          // Accept low-confidence if the extracted candidate closely matches canonical
          // (e.g., "Emmet Otter's Jug-Band Christmas" exact match = real title despite low popularity)
          const normCandidate = candidate.toLowerCase().replace(/^the\s+/, '').trim();
          const normCanonical = entry.canonical.toLowerCase().replace(/^the\s+/, '').trim();
          if (normCandidate === normCanonical) {
            validTitles.add(entry.canonical);
          }
        }
      }

      // Reverse lookup: scan text for known validated titles (catches lowercase mentions)
      // Exclude patterns that appear in the root prompt to avoid false positives
      // (e.g., "muppet movie" in "what's your favorite muppet movie?")
      const rootText = (posts[0]?.text || '').toLowerCase();
      const lowerText = searchText.toLowerCase();
      for (const { canonical, patterns } of reverseLookup) {
        if (validTitles.has(canonical)) continue; // Already found
        for (const pattern of patterns) {
          // Skip if this pattern is a substring of the root prompt
          if (rootText.includes(pattern)) continue;
          if (lowerText.includes(pattern)) {
            validTitles.add(canonical);
            break;
          }
        }
      }

      if (validTitles.size > 0) {
        predictions.set(post.uri, [...validTitles]);
      }
    }

    // Pass 2: Context inheritance (depth-limited to 2)
    const MAX_DEPTH = 2;

    function getInheritedTitles(uri, depth) {
      if (depth > MAX_DEPTH) return null;
      if (predictions.has(uri)) return predictions.get(uri);
      const post = postsByUri.get(uri);
      if (!post || !post.parentUri) return null;
      return getInheritedTitles(post.parentUri, depth + 1);
    }

    for (const post of posts) {
      if (predictions.has(post.uri)) continue;
      if (post.uri === rootUri) continue;

      // Only inherit if this is a reaction/agreement/short post
      if (!isReaction(post.text) && (post.text || '').length >= 100) continue;

      // Try parent chain
      if (post.parentUri) {
        const inherited = getInheritedTitles(post.parentUri, 1);
        if (inherited && inherited.length > 0) {
          predictions.set(post.uri, inherited);
          continue;
        }
      }
    }

    return predictions;
  };
}
