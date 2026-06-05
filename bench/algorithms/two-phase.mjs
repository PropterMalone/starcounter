/**
 * Two-Phase algorithm: discover thread dictionary, then label posts.
 *
 * Phase 1 — Dictionary Discovery:
 *   Broadly extract candidates from ALL posts, validate against API cache,
 *   aggregate by canonical title, disambiguate using frequency + context.
 *   Result: a curated set of titles actually being discussed in this thread.
 *
 * Phase 2 — Post Labeling:
 *   Match each post against the known dictionary. Much higher precision
 *   because we're matching against confirmed titles, not raw regex output.
 *   Context inheritance for reaction/agreement posts.
 *
 * The dictionary is what gets shown to the user for tweaking (kick out
 * false positives, add missing titles). This benchmark measures the
 * automatic Phase 1 + Phase 2 without user tweaks.
 */

import { readFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Candidate extraction (broad, high-recall)
// ---------------------------------------------------------------------------

// Title case with expanded connector words
const TITLE_CASE_RE =
  /\b([A-Z][a-z']+(?:(?:\s+|:\s*|-\s*)(?:(?:for|from|with|the|and|of|a|an|in|on|at|to|is|or|not|no|it|its|my|his|her|as|so|but|by|&|vs\.?|v\.?)(?:\s+|:\s*|-\s*))*[A-Z][a-z']+)+)/g;

const QUOTED_RE = /["""\u201c]([^"""\u201d]{2,60})["""\u201d]/g;
const ALL_CAPS_RE = /\b([A-Z]{2,}(?:\s+[A-Z]{2,})+)\b/g;

const NOISE = new Set([
  'I Am', 'I Was', 'I Think', 'I Love', 'I Just', 'I Mean', 'I Also',
  'Oh My', 'My Dad', "My Dad's", 'My Father', 'Not Sure', 'Also My', 'So Good',
  'Pretty Good', 'Just Watched', 'Looking At', 'Hard Mode',
  'Dad Movie', 'Dad Movies', 'Good Movie', 'Great Movie', 'Best Movie',
  'Any Movie', 'Favorite Movie', 'This Movie', 'That Movie',
  'Fun Fact', 'Pro Tip', 'Hot Take', 'Great Answer', 'Good Call',
  'Same Here', 'Me Too', 'My Mom', 'My Kids', 'My Wife', 'My Husband',
  // Meta-discussion phrases that happen to be real TMDB titles
  'Honorable Mention', 'Love That Movie',
]);

const QUOTED_NOISE = new Set([
  'dad movie', 'dad movies', 'favorite movie', 'best movie',
  'movie', 'movies', 'film', 'films', 'this one', 'that one',
]);

function extractCandidates(text) {
  if (!text || text.trim().length === 0) return [];
  const candidates = new Set();

  for (const match of text.matchAll(QUOTED_RE)) {
    const t = match[1].trim();
    if (t.length >= 2 && t.split(/\s+/).length <= 10) {
      const lower = t.toLowerCase();
      if (!QUOTED_NOISE.has(lower)) {
        if (!/^(my |your |i |we |he |she |it |this |that |if |but |when |where |what |why |how )/i.test(t)) {
          if (t.split(/\s+/).length >= 2 || /^[A-Z]/.test(t)) {
            candidates.add(t);
          }
        }
      }
    }
  }

  for (const match of text.matchAll(TITLE_CASE_RE)) {
    const t = match[1].trim();
    if (!NOISE.has(t) && t.length >= 3) {
      candidates.add(t);
    }
  }

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

  for (const match of text.matchAll(/\[image alt: ([^\]]+)\]/g)) {
    const alt = match[1].trim();
    if (alt.length <= 60 && alt.split(/\s+/).length <= 8) {
      candidates.add(alt);
    }
  }

  return [...candidates];
}

// Reaction/agreement words that also happen to be movie titles in TMDB.
// These should never be treated as title candidates from short-text extraction.
const REACTION_STOPWORDS = new Set([
  'yes', 'no', 'yep', 'nope', 'same', 'agreed', 'exactly', 'absolutely',
  'lol', 'lmao', 'omg', 'okay', 'ok', 'right', 'correct', 'true',
  'nice', 'cool', 'great', 'amazing', 'perfect', 'classic',
]);

// Short-text extraction: clean post text and use as candidate
function extractShortTextCandidate(text) {
  if (!text || text.trim().length === 0 || text.length > 80) return null;
  const cleaned = text
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[#@]\S+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w\s'':\-&]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length >= 2 && cleaned.split(/\s+/).length <= 8) {
    // Skip reaction/agreement words that happen to be movie titles
    if (REACTION_STOPWORDS.has(cleaned.toLowerCase())) return null;
    return cleaned;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reaction detection
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

// Strict agreement detection — only for context inheritance
const AGREEMENT_PATTERNS = [
  /^(yes|yep|yeah|yup|agreed|exactly|absolutely|definitely|this|same|correct|100%|💯)/i,
  /^(so good|great|amazing|incredible|love (it|this)|hell yeah|oh hell yeah)/i,
  /^(came here to say this|this is (it|the one|mine)|good (call|choice|pick|answer))/i,
  /^(underrated|overrated|classic|banger|legendary|goat|peak)/i,
  /^me too/i,
  /^right\??!*$/i,
  /^well,?\s*yes/i,
  /^(👏|👍|💯|🎯|🤝|✅|🙌)+$/,
];

function isAgreement(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length < 50) {
    return AGREEMENT_PATTERNS.some((p) => p.test(trimmed));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Phase 1: Dictionary Discovery
// ---------------------------------------------------------------------------

/**
 * Discover the set of titles being discussed in this thread.
 *
 * @param {Array} posts
 * @param {Object} validations - cache.validations
 * @returns {Map<string, {aliases: Set<string>, frequency: number, postUris: Set<string>}>}
 */
function discoverDictionary(posts, validations, minConfidentOverall = 1) {
  const rootUri = posts[0]?.uri;
  const rootText = (posts[0]?.text || '').toLowerCase();

  // Build cache lookup
  const lookup = new Map(); // lowercase candidate → { canonical, confidence }
  for (const [candidate, result] of Object.entries(validations)) {
    if (result.validated) {
      lookup.set(candidate.toLowerCase(), {
        canonical: result.title,
        confidence: result.confidence,
      });
    }
  }

  // Aggregate: for each canonical title, track confident vs incidental mentions.
  //
  // "Confident" = extracted by regex (title case, quotes, ALL CAPS, short-text).
  //   The poster intentionally formatted something as a title.
  // "Incidental" = found by reverse substring scan of lowercase text.
  //   Might just be a common word appearing naturally.
  //
  // This distinction is key for disambiguation:
  //   "Heat" has many confident mentions (people write "Heat", "HEAT", etc.)
  //   "Red" has almost zero confident mentions — just "red" appearing in text
  const titleInfo = new Map();

  function ensureTitle(canonical, confidence) {
    if (!titleInfo.has(canonical)) {
      titleInfo.set(canonical, {
        aliases: new Set(),
        confidentPostUris: new Set(),   // posts with regex-extracted mentions
        incidentalPostUris: new Set(),  // posts with only reverse-lookup mentions
        bestConfidence: confidence,
      });
    }
    const info = titleInfo.get(canonical);
    if (confidence === 'high' || (confidence === 'medium' && info.bestConfidence === 'low')) {
      info.bestConfidence = confidence;
    }
    return info;
  }

  function recordConfident(canonical, alias, postUri, confidence) {
    const info = ensureTitle(canonical, confidence);
    info.aliases.add(alias.toLowerCase());
    info.confidentPostUris.add(postUri);
    // If it was previously only incidental in this post, upgrade
    info.incidentalPostUris.delete(postUri);
  }

  function recordIncidental(canonical, alias, postUri, confidence) {
    const info = ensureTitle(canonical, confidence);
    info.aliases.add(alias.toLowerCase());
    // Only mark as incidental if not already confident for this post
    if (!info.confidentPostUris.has(postUri)) {
      info.incidentalPostUris.add(postUri);
    }
  }

  // Scan all posts
  for (const post of posts) {
    if (post.uri === rootUri) continue;

    const ownText = post.fullText || post.text || '';
    let searchText = ownText;
    if (post.quotedText && post.quotedUri !== rootUri) {
      searchText += '\n' + post.quotedText;
    }
    if (post.quotedAltText) {
      searchText += '\n' + post.quotedAltText.join('\n');
    }

    // --- Confident extraction: regex-based, longest match wins ---
    const candidates = extractCandidates(searchText);
    const shortCandidate = extractShortTextCandidate(post.text);
    if (shortCandidate) candidates.push(shortCandidate);

    // Sort longest first. A single phrase in a post maps to at most one title,
    // so "The Good the Bad and the Ugly" consumes "The Good" — the shorter
    // candidate should not also count as a separate title.
    candidates.sort((a, b) => b.length - a.length);
    const consumedSpans = []; // [{lower, start, end}] - tracks claimed text regions

    for (const candidate of candidates) {
      const entry = lookup.get(candidate.toLowerCase());
      if (!entry) continue;

      // Check if this candidate's text is already consumed by a longer match
      const candidateLower = candidate.toLowerCase();
      const consumed = consumedSpans.some((span) =>
        span.lower.includes(candidateLower)
      );
      if (consumed) continue;

      recordConfident(entry.canonical, candidate, post.uri, entry.confidence);
      consumedSpans.push({ lower: candidateLower });
    }

    // --- Incidental: reverse substring scan ---
    // Only for patterns that are 3+ words or ≥ 12 chars (skip short common words)
    const lowerText = searchText.toLowerCase();
    for (const [candidate, result] of Object.entries(validations)) {
      if (!result.validated || result.confidence === 'low') continue;
      const pattern = candidate.toLowerCase();
      if (rootText.includes(pattern)) continue;
      // Skip short patterns in reverse lookup — too many false substring matches
      if (pattern.length < 12 && pattern.split(/\s+/).length < 3) continue;
      if (lowerText.includes(pattern)) {
        recordIncidental(result.title, candidate, post.uri, result.confidence);
      }
    }
  }

  // --- Disambiguation & filtering ---
  //
  // The core insight: a title is real if posters INTENTIONALLY name it.
  // Confident mentions (regex-extracted) prove intent.
  // Incidental mentions (substring matches) are noise until proven otherwise.

  const dictionary = new Map();

  for (const [canonical, info] of titleInfo) {
    const confidentCount = info.confidentPostUris.size;
    const incidentalCount = info.incidentalPostUris.size;
    const totalCount = confidentCount + incidentalCount;

    // Rule 1: Require minimum confident mentions (default 1, higher for self-validated).
    // If a title was NEVER extracted by regex — only by substring scan —
    // it's probably just a common word. (e.g., "Red" only matched via reverse lookup)
    if (confidentCount < minConfidentOverall) continue;

    // Rule 2: Require medium+ API confidence.
    // Low-confidence means TMDB barely recognizes it — almost always a wrong match
    // (e.g., "The Good" → "The Good Boy", "My Dad's" → "My Dad's Lessons").
    // Only exception: exact multi-word alias match (the poster wrote the full title).
    if (info.bestConfidence === 'low') {
      const hasExactMultiWord = canonical.split(/\s+/).length >= 3 && [...info.aliases].some((alias) => {
        const na = alias.replace(/^the\s+/i, '').trim();
        const nc = canonical.toLowerCase().replace(/^the\s+/, '').trim();
        return na === nc;
      });
      if (!hasExactMultiWord) continue;
    }

    // Rule 3: For short titles (1-2 words), require stronger evidence.
    // "Heat" (1 word) needs multiple confident mentions to distinguish from generic usage.
    // "The Fugitive" (2 words) is less ambiguous.
    const wordCount = canonical.split(/\s+/).length;
    if (wordCount <= 2 && confidentCount < 2) continue;

    // Rule 4: Skip if the canonical title is very different from what was extracted.
    // (e.g., "Fat Kaz" → "My Big Fat Greek Wedding 2" — wrong API match)
    // (e.g., "The Good" → "The Good Boy" — partial match to wrong movie)
    // The alias must share most significant words with the canonical title.
    const articles = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'at', 'to', 'for', 'from', 'with', 'by', 'or', 'is', 'it', 'its', 'as', 'so', 'but', 'not', 'no']);
    const hasCloseMatch = [...info.aliases].some((alias) => {
      const aliasWords = alias.toLowerCase().split(/[\s:,]+/).filter(w => w && !articles.has(w));
      const canonWords = canonical.toLowerCase().split(/[\s:,]+/).filter(w => w && !articles.has(w));
      if (canonWords.length === 0) return false;
      // Count how many canonical words appear in the alias
      const matched = canonWords.filter(w => aliasWords.includes(w)).length;
      // Require alias to cover at least 60% of canonical's significant words
      return matched / canonWords.length >= 0.6;
    });
    if (!hasCloseMatch) continue;

    // All posts where this title was mentioned (confident or incidental)
    const allPostUris = new Set([...info.confidentPostUris, ...info.incidentalPostUris]);

    dictionary.set(canonical, {
      aliases: info.aliases,
      frequency: allPostUris.size,
      confidentCount,
      incidentalCount,
      postUris: allPostUris,
    });
  }

  // Deduplication: remove fragment titles that only appear as part of a longer title.
  // E.g., "Christmas Carol" is always part of "The Muppet Christmas Carol" in this thread → remove.
  // But "Hollow Knight" can exist independently alongside "Hollow Knight: Silksong" → keep both.
  //
  // Rule: remove shorter title only if it has NO independent mentions —
  // i.e., every post containing the shorter title's aliases also contains a longer title's alias.
  //
  // We check both canonical-title substrings AND alias substrings. This catches cases like
  // "Red October" (alias of "End of Red October") being a substring of "The Hunt for Red October"
  // (alias of "The Hunt for Red October") — different canonical titles but the same text fragment.
  const canonicals = [...dictionary.keys()];

  function titlesOverlap(shortTitle, longTitle) {
    // Check canonical title substring
    const shortNorm = shortTitle.toLowerCase().replace(/^the\s+/, '');
    const longNorm = longTitle.toLowerCase().replace(/^the\s+/, '');
    if (longNorm.includes(shortNorm) && longNorm.length > shortNorm.length) return true;

    // Check alias substring: does any alias of shortTitle appear inside any alias of longTitle?
    const shortAliases = dictionary.get(shortTitle).aliases;
    const longAliases = dictionary.get(longTitle).aliases;
    for (const sa of shortAliases) {
      for (const la of longAliases) {
        if (la.length > sa.length && la.includes(sa)) return true;
      }
    }
    return false;
  }

  for (const short of canonicals) {
    if (!dictionary.has(short)) continue;

    for (const long of canonicals) {
      if (short === long || !dictionary.has(long)) continue;
      if (!titlesOverlap(short, long)) continue;

      // Found a longer title that contains the shorter one.
      // Check if the shorter title has any independent mentions.
      const shortInfo = dictionary.get(short);
      const longInfo = dictionary.get(long);
      const longPostUris = longInfo.postUris;

      // Count posts where the short title appears but the long title doesn't
      let independentMentions = 0;
      for (const uri of shortInfo.postUris) {
        if (!longPostUris.has(uri)) independentMentions++;
      }

      if (independentMentions === 0) {
        // Every mention of the short title co-occurs with the long title → fragment, remove
        dictionary.delete(short);
        break;
      }
      // Otherwise keep both — the short title has independent usage
    }
  }

  // --- Quality filter: conversational phrases & embedded fragments ---
  filterFragmentTitles(dictionary, posts, rootUri);

  // --- Canonicalization merge: same song, different API canonical forms ---
  const redirects = mergeDuplicateCanonicals(dictionary);

  // Patch the lookup: redirect merged canonicals to the winner
  for (const [candidate, entry] of lookup) {
    const redirect = redirects.get(entry.canonical);
    if (redirect) {
      lookup.set(candidate, { ...entry, canonical: redirect });
    }
  }

  return { dictionary, redirects };
}

const PREFIX_SKIP_WORDS = new Set([
  'the', 'a', 'an', // articles
  'by', 'of', 'from', 'in', 'on', 'for', 'with', 'at', 'to', 'about', // prepositions
  'my', 'your', 'his', 'her', 'its', 'our', 'their', // possessives
  'and', 'or', 'but', // conjunctions
]);

function filterFragmentTitles(dictionary, posts, rootUri) {
  const postsByUri = new Map();
  for (const p of posts) postsByUri.set(p.uri, p);

  const toRemove = [];

  for (const [canonical, info] of dictionary) {
    const words = canonical.split(/\s+/);
    if (words.length > 3) continue;

    const lowerCanonical = canonical.toLowerCase();
    const prefixCounts = new Map();
    let matchedPosts = 0;

    for (const uri of info.postUris) {
      if (uri === rootUri) continue;
      const post = postsByUri.get(uri);
      if (!post) continue;
      const text = post.fullText || post.text || '';
      if (!text) continue;

      const lowerText = text.toLowerCase();
      const idx = lowerText.indexOf(lowerCanonical);
      if (idx === -1) continue;
      matchedPosts++;

      // Track the word immediately before the match (skip articles/attribution)
      if (idx > 1) {
        const beforeChunk = text.substring(Math.max(0, idx - 20), idx).trimEnd();
        const lastWord = beforeChunk.split(/\s+/).pop()?.toLowerCase();
        if (lastWord && /^[a-z']+$/.test(lastWord) && !PREFIX_SKIP_WORDS.has(lastWord)) {
          prefixCounts.set(lastWord, (prefixCounts.get(lastWord) ?? 0) + 1);
        }
      }
    }

    if (matchedPosts < 3) continue;

    for (const [, count] of prefixCounts) {
      if (count / matchedPosts > 0.7) {
        toRemove.push(canonical);
        break;
      }
    }
  }

  if (toRemove.length > 0) {
    console.log(`  Filtered ${toRemove.length} fragment titles:`);
    for (const c of toRemove.slice(0, 20)) console.log(`    - ${c}`);
    if (toRemove.length > 20) console.log(`    ... and ${toRemove.length - 20} more`);
  }
  for (const canonical of toRemove) {
    dictionary.delete(canonical);
  }
}

function normalizeForMerge(title) {
  return title
    .replace(/[\u2018\u2019\u2032]/g, "'") // curly/prime quotes → straight
    .toLowerCase()
    .replace(/^(it's|it is|don't|i)\s+/i, '') // strip leading contractions
    .replace(/^(the|a|an)\s+/i, '') // strip leading articles (chained)
    .replace(/[.,!?'"]+$/, '')
    .replace(/s$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantWords(title) {
  const stop = new Set(['the','a','an','of','and','in','on','at','to','for','from','with','by','or','is','it','its','as','so','but','not','no',
    "it's","i'm","don't","won't","can't","didn't","wasn't","isn't","aren't","couldn't","wouldn't","shouldn't",
    "hasn't","haven't","ain't","let's","that's","what's","who's","he's","she's","we're","they're","you're","i'll","you'll","we'll","they'll"]);
  return title.toLowerCase().split(/[\s:,]+/).filter(w => w && !stop.has(w));
}

function mergeDuplicateCanonicals(dictionary) {
  const redirects = new Map();
  const entries = [...dictionary.entries()];

  // Group by normalized form
  const groups = new Map();
  for (const [canonical] of entries) {
    const norm = normalizeForMerge(canonical);
    const group = groups.get(norm) ?? [];
    group.push(canonical);
    groups.set(norm, group);
  }

  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    mergeGroup(dictionary, group, redirects);
  }

  // Second pass: word-set overlap
  const remaining = [...dictionary.keys()];
  const merged = new Set();

  for (let i = 0; i < remaining.length; i++) {
    if (merged.has(remaining[i])) continue;
    const a = remaining[i];
    const aWords = significantWords(a);
    if (aWords.length < 2) continue;

    const group = [a];
    for (let j = i + 1; j < remaining.length; j++) {
      if (merged.has(remaining[j])) continue;
      const b = remaining[j];
      const bWords = significantWords(b);
      if (bWords.length < 2) continue;

      const aInB = aWords.filter(w => bWords.includes(w)).length;
      const bInA = bWords.filter(w => aWords.includes(w)).length;
      if (aInB / aWords.length >= 0.85 && bInA / bWords.length >= 0.85) {
        group.push(b);
        merged.add(b);
      }
    }

    if (group.length > 1) {
      merged.add(a);
      mergeGroup(dictionary, group, redirects);
    }
  }

  return redirects;
}

function mergeGroup(dictionary, group, redirects) {
  const sorted = group
    .map(c => ({ canonical: c, entry: dictionary.get(c) }))
    .filter(x => x.entry)
    .sort((a, b) => {
      const confDiff = b.entry.confidentCount - a.entry.confidentCount;
      if (confDiff !== 0) return confDiff;
      return b.canonical.length - a.canonical.length;
    });

  if (sorted.length <= 1) return;

  const winner = sorted[0];
  const combinedAliases = new Set(winner.entry.aliases);
  const combinedPostUris = new Set(winner.entry.postUris);

  for (const other of sorted.slice(1)) {
    for (const alias of other.entry.aliases) combinedAliases.add(alias);
    for (const uri of other.entry.postUris) combinedPostUris.add(uri);
    dictionary.delete(other.canonical);
    redirects.set(other.canonical, winner.canonical);
  }

  for (const { canonical } of sorted) {
    combinedAliases.add(canonical.toLowerCase());
  }

  const totalPrev = winner.entry.confidentCount + winner.entry.incidentalCount;
  let combinedConfident = winner.entry.confidentCount;
  let combinedIncidental = winner.entry.incidentalCount;
  if (totalPrev > 0) {
    const confRatio = winner.entry.confidentCount / totalPrev;
    combinedConfident = Math.round(combinedPostUris.size * confRatio);
    combinedIncidental = combinedPostUris.size - combinedConfident;
  }

  dictionary.set(winner.canonical, {
    aliases: combinedAliases,
    frequency: combinedPostUris.size,
    confidentCount: combinedConfident,
    incidentalCount: combinedIncidental,
    postUris: combinedPostUris,
  });
}

// ---------------------------------------------------------------------------
// Phase 2: Post Labeling
// ---------------------------------------------------------------------------

function labelPosts(posts, dictionary, validations, redirects) {
  const rootUri = posts[0]?.uri;
  const rootText = (posts[0]?.text || '').toLowerCase();
  const postsByUri = new Map();
  for (const p of posts) postsByUri.set(p.uri, p);

  // Build efficient matching structures from dictionary
  // Sort by alias length descending (match longest first)
  const matchers = [];
  for (const [canonical, info] of dictionary) {
    const patterns = [...info.aliases].sort((a, b) => b.length - a.length);
    matchers.push({ canonical, patterns });
  }
  matchers.sort((a, b) => b.patterns[0].length - a.patterns[0].length);

  // Also build forward lookup from cache for extracted candidates
  const lookup = new Map();
  for (const [candidate, result] of Object.entries(validations)) {
    if (result.validated) {
      lookup.set(candidate.toLowerCase(), {
        canonical: result.title,
        confidence: result.confidence,
      });
    }
  }

  // Apply merge redirects to the lookup
  if (redirects) {
    for (const [candidate, entry] of lookup) {
      const redirect = redirects.get(entry.canonical);
      if (redirect) {
        lookup.set(candidate, { ...entry, canonical: redirect });
      }
    }
  }

  const predictions = new Map();

  // Pass 1: Direct matching
  for (const post of posts) {
    if (post.uri === rootUri) continue;

    const ownText = post.fullText || post.text || '';
    let searchText = ownText;
    if (post.quotedText && post.quotedUri !== rootUri) {
      searchText += '\n' + post.quotedText;
    }
    if (post.quotedAltText) {
      searchText += '\n' + post.quotedAltText.join('\n');
    }

    const validTitles = new Set();

    // Strategy A: Forward lookup with longest-match-wins
    const candidates = extractCandidates(searchText);
    const shortCandidate = extractShortTextCandidate(post.text);
    if (shortCandidate) candidates.push(shortCandidate);

    // Sort longest first — a phrase maps to at most one title
    candidates.sort((a, b) => b.length - a.length);
    const consumedCandidates = []; // lowercase strings of accepted candidates

    for (const candidate of candidates) {
      const candidateLower = candidate.toLowerCase();

      // Skip if this candidate's text is already consumed by a longer match
      if (consumedCandidates.some((longer) => longer.includes(candidateLower))) continue;

      const entry = lookup.get(candidateLower);
      if (entry && dictionary.has(entry.canonical)) {
        validTitles.add(entry.canonical);
        consumedCandidates.push(candidateLower);
      }
    }

    // Strategy B: Reverse lookup with longest-match-wins
    // matchers are already sorted longest-first
    const lowerText = searchText.toLowerCase();
    const consumedRanges = []; // [{start, end}] — character spans already claimed

    for (const { canonical, patterns } of matchers) {
      if (validTitles.has(canonical)) continue;
      for (const pattern of patterns) {
        if (rootText.includes(pattern)) continue;
        const idx = lowerText.indexOf(pattern);
        if (idx === -1) continue;

        // Check if this span overlaps with an already-claimed range
        const start = idx;
        const end = idx + pattern.length;
        const overlaps = consumedRanges.some(
          (r) => start < r.end && end > r.start
        );
        if (overlaps) continue;

        validTitles.add(canonical);
        consumedRanges.push({ start, end });
        break;
      }
    }

    if (validTitles.size > 0) {
      predictions.set(post.uri, [...validTitles]);
    }
  }

  // Pass 2: Context inheritance (depth-limited)
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
    if (!isAgreement(post.text)) continue;

    if (post.parentUri) {
      const inherited = getInheritedTitles(post.parentUri, 1);
      if (inherited && inherited.length > 0) {
        predictions.set(post.uri, inherited);
      }
    }
  }

  return predictions;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function create(cachePath) {
  let validations;
  let isSelfValidated = false;
  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf-8'));
    validations = data.validations;
    isSelfValidated = data.meta?.mode === 'self-validation';
  } catch {
    return (posts) => {
      console.warn(`  No validation cache at ${cachePath}`);
      return new Map();
    };
  }

  // Self-validated threads require 2+ confident mentions to reduce noise
  const minConfidentOverall = isSelfValidated ? 2 : 1;

  return function run(posts) {
    const { dictionary, redirects } = discoverDictionary(posts, validations, minConfidentOverall);
    console.log(`  Dictionary: ${dictionary.size} titles discovered`);
    for (const [title, info] of [...dictionary.entries()].sort((a, b) => b[1].frequency - a[1].frequency).slice(0, 15)) {
      console.log(`    ${title.padEnd(45)} ${String(info.confidentCount).padStart(3)} confident, ${String(info.incidentalCount).padStart(3)} incidental`);
    }
    return labelPosts(posts, dictionary, validations, redirects);
  };
}
