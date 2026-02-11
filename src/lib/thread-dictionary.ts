// pattern: Functional Core
// Phase 1: Discover the set of titles being discussed in a thread.
//
// Broadly extract candidates from ALL posts, validate against API cache,
// aggregate by canonical title, disambiguate using frequency + context.
// Result: a curated set of titles actually being discussed.

import type { PostView } from '../types';
import type { PostTextContent } from './text-extractor';
import type { ValidatedMention } from './validation-client';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DictionaryEntry = {
  readonly canonical: string;
  readonly aliases: ReadonlySet<string>;
  readonly frequency: number;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly confidentCount: number;
  readonly incidentalCount: number;
  readonly postUris: ReadonlySet<string>;
};

export type ThreadDictionary = {
  readonly entries: ReadonlyMap<string, DictionaryEntry>;
  /** Lookup with merged canonicals redirected. Use this for labeling instead of the original. */
  readonly patchedLookup?: ReadonlyMap<string, ValidationLookupEntry>;
};

/** Lookup entry built from validation results. */
export type ValidationLookupEntry = {
  readonly canonical: string;
  readonly confidence: 'high' | 'medium' | 'low';
};

export type EmbedTitleEntry = {
  /** The canonical title (e.g., "Celebration - Kool & The Gang") */
  readonly canonical: string;
  /** The song name alone for pattern matching (e.g., "Celebration") */
  readonly song: string;
};

export type DiscoverDictionaryOptions = {
  readonly minConfidentForShortTitle?: number; // default: 2
  readonly minConfidentOverall?: number; // default: 1
  /** Pre-resolved embed titles: postUri → parsed embed title */
  readonly embedTitles?: ReadonlyMap<string, EmbedTitleEntry>;
};

// Common single-word English words that are also song/album titles.
// Used to filter Strategy B reverse-matching for embed titles — these words are
// too frequent in normal conversation to be useful as text-match patterns.
// Strategy A (direct link assignment) still works for these.
const EMBED_STOP_WORDS = new Set([
  // Articles, prepositions, conjunctions
  'just',
  'stay',
  'love',
  'home',
  'fire',
  'gold',
  'time',
  'help',
  'hero',
  'money',
  'hurt',
  'crazy',
  'happy',
  'fame',
  'free',
  'human',
  'lean',
  'high',
  'lost',
  'glow',
  'feel',
  'real',
  'dreams',
  'closer',
  'issues',
  'rush',
  'alive',
  'torn',
  'blow',
  'wish',
  'burn',
  'closer',
  'hello',
  'sorry',
  'driver',
  'cool',
  'mine',
  'safe',
  'angel',
  'perfect',
  'thunder',
  'poison',
  'believe',
  'alone',
  'again',
  'falling',
  'rescue',
  'trouble',
  'reason',
  'changes',
  'forget',
  'promises',
  'question',
  'enough',
  'forever',
  'never',
  'always',
  'waiting',
  'amazing',
  'broken',
  'remember',
  'somebody',
  'nothing',
  'everything',
  'anywhere',
  'stronger',
  'beautiful',
  'dangerous',
  'incredible',
  'delicate',
  'anyway',
  'anymore',
  'breathe',
  'stand',
  'hold',
  'down',
  'want',
  'need',
  'take',
  'come',
  'give',
  'move',
  'rise',
  'pray',
  'word',
  'talk',
  'walk',
  'rain',
  'dark',
  'blue',
  'ring',
  'hope',
  'born',
  'wild',
  'gone',
  'true',
  'good',
  'best',
  'last',
  'next',
  'only',
  'deep',
  'loud',
  'fast',
  'slow',
  'hard',
  'easy',
  'sure',
  'same',
  'back',
  'away',
  'over',
  'under',
  'inside',
  'outside',
  'together',
]);

// ---------------------------------------------------------------------------
// Candidate extraction (broad, high-recall)
// ---------------------------------------------------------------------------

// Title case with expanded connector words
const TITLE_CASE_RE =
  /\b([A-Z][a-z']+(?:(?:\s+|:\s*|-\s*)(?:(?:for|from|with|the|and|of|a|an|in|on|at|to|is|or|not|no|it|its|my|his|her|as|so|but|by|&|vs\.?|v\.?)(?:\s+|:\s*|-\s*))*[A-Z][a-z']+)+)/g;

const QUOTED_RE = /["""\u201c]([^"""\u201d]{2,60})["""\u201d]/g;
const ALL_CAPS_RE = /\b([A-Z]{2,}(?:\s+[A-Z]{2,})+)\b/g;
const IMAGE_ALT_RE = /\[image alt: ([^\]]+)\]/g;

const NOISE = new Set([
  'I Am',
  'I Was',
  'I Think',
  'I Love',
  'I Just',
  'I Mean',
  'I Also',
  'Oh My',
  'My Dad',
  "My Dad's",
  'My Father',
  'Not Sure',
  'Also My',
  'So Good',
  'Pretty Good',
  'Just Watched',
  'Looking At',
  'Hard Mode',
  'Dad Movie',
  'Dad Movies',
  'Good Movie',
  'Great Movie',
  'Best Movie',
  'Any Movie',
  'Favorite Movie',
  'This Movie',
  'That Movie',
  'Fun Fact',
  'Pro Tip',
  'Hot Take',
  'Great Answer',
  'Good Call',
  'Same Here',
  'Me Too',
  'My Mom',
  'My Kids',
  'My Wife',
  'My Husband',
  'Honorable Mention',
  'Love That Movie',
]);

const QUOTED_NOISE = new Set([
  'dad movie',
  'dad movies',
  'favorite movie',
  'best movie',
  'movie',
  'movies',
  'film',
  'films',
  'this one',
  'that one',
]);

const CAPS_NOISE_RE = /^(WTAF|OMFG|LMAO|LMBO|OMG|LOL|WTF|IMO|IMHO|IIRC|TIL|PSA|FYI|RIP|AMA)$/;

const QUOTED_PREFIX_RE =
  /^(my |your |i |we |he |she |it |this |that |if |but |when |where |what |why |how )/i;

// Sentence-starter prefixes that disqualify a line from being a standalone answer
const LINE_SENTENCE_PREFIX_RE =
  /^(i |my |we |he |she |it |they |you |this is|that is|if |but |when |where |what |why |how |there |here |also |just |not |can |could |would |should |do |does |did |have |has |had |was |were |the question|growing up|used to|i've |i'm |it's |that's |there's |in the |in my |in a |in order|in chronological|for the |for my |for a )/i;

/** Extract candidate title strings from text using multiple strategies. */
export function extractCandidates(text: string): string[] {
  if (!text || text.trim().length === 0) return [];
  const candidates = new Set<string>();

  // Quoted phrases (works on full text — quotes don't span lines)
  for (const match of text.matchAll(QUOTED_RE)) {
    const t = (match[1] ?? '').trim();
    if (t.length >= 2 && t.split(/\s+/).length <= 10) {
      const lower = t.toLowerCase();
      if (!QUOTED_NOISE.has(lower) && !QUOTED_PREFIX_RE.test(t)) {
        if (t.split(/\s+/).length >= 2 || /^[A-Z]/.test(t)) {
          candidates.add(t);
        }
      }
    }
  }

  // Split into lines for Title Case and per-line extraction
  // This prevents cross-line matches like "Mersey\nDee" → "Mersey Dee"
  const lines = text.split(/\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) continue;

    // Title case phrases — per line
    for (const match of trimmedLine.matchAll(TITLE_CASE_RE)) {
      const t = (match[1] ?? '').trim();
      if (!NOISE.has(t) && t.length >= 3) {
        candidates.add(t);
      }
    }

    // ALL CAPS phrases — per line
    for (const match of trimmedLine.matchAll(ALL_CAPS_RE)) {
      const raw = (match[1] ?? '').trim();
      if (raw.length >= 4 && !CAPS_NOISE_RE.test(raw)) {
        const title = raw
          .split(/\s+/)
          .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
          .join(' ');
        candidates.add(title);
      }
    }

    // Per-line standalone candidate: short lines (1-5 words) that look like
    // a standalone answer rather than a sentence fragment
    if (trimmedLine.length >= 2 && trimmedLine.length <= 60) {
      const cleaned = trimmedLine.replace(/[.!?,;:]+$/, '').trim();
      const wordCount = cleaned.split(/\s+/).length;
      if (
        wordCount >= 1 &&
        wordCount <= 5 &&
        cleaned.length >= 2 &&
        /^[A-Z]/.test(cleaned) &&
        !LINE_SENTENCE_PREFIX_RE.test(cleaned) &&
        !NOISE.has(cleaned) &&
        !REACTION_STOPWORDS.has(cleaned.toLowerCase()) &&
        !CAPS_NOISE_RE.test(cleaned) &&
        !/^[A-Z]+$/.test(cleaned) // Skip all-caps single words (acronyms/reactions)
      ) {
        candidates.add(cleaned);
      }
    }
  }

  // Image alt text (works on full text)
  for (const match of text.matchAll(IMAGE_ALT_RE)) {
    const alt = (match[1] ?? '').trim();
    if (alt.length <= 60 && alt.split(/\s+/).length <= 8) {
      candidates.add(alt);
    }
  }

  return [...candidates];
}

// Reaction/agreement words that are also movie titles in TMDB
const REACTION_STOPWORDS = new Set([
  'yes',
  'no',
  'yep',
  'nope',
  'same',
  'agreed',
  'exactly',
  'absolutely',
  'lol',
  'lmao',
  'omg',
  'okay',
  'ok',
  'right',
  'correct',
  'true',
  'nice',
  'cool',
  'great',
  'amazing',
  'perfect',
  'classic',
]);

/** Extract a candidate from short posts (≤80 chars) that are likely just a title. */
export function extractShortTextCandidate(text: string): string | null {
  if (!text || text.trim().length === 0) return null;

  // For multi-line posts, only consider the first non-empty line.
  // Other lines are handled by extractCandidates' per-line extraction.
  let effectiveText = text;
  if (text.includes('\n')) {
    const firstLine = text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (!firstLine) return null;
    effectiveText = firstLine;
  }

  if (effectiveText.length > 80) return null;
  const cleaned = effectiveText
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[#@]\S+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w\s'':\-&]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length >= 2 && cleaned.split(/\s+/).length <= 8) {
    if (REACTION_STOPWORDS.has(cleaned.toLowerCase())) return null;
    if (LINE_SENTENCE_PREFIX_RE.test(cleaned)) return null;
    return cleaned;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reaction detection (for candidate extraction — broad)
// ---------------------------------------------------------------------------

const REACTION_PATTERNS: RegExp[] = [
  /^(yes|yep|yeah|yup|agreed|exactly|absolutely|definitely|this|same|correct|100%|💯)/i,
  /^(so good|great|amazing|incredible|love (it|this)|hell yeah|oh hell yeah)/i,
  /^(came here to say this|this is (it|the one|mine)|good (call|choice|pick|answer))/i,
  /^(underrated|overrated|classic|banger|legendary|goat|peak)/i,
  // Music-specific reaction patterns
  /^(bop|tune|anthem|jam|slaps|bangs|certified|vibes?|mood)/i,
  /^oh (hell|fuck) yes/i,
  /^(yesss+|yasss+)/i,
  /^this is the (answer|one|way)/i,
  /^[^\w]*$/,
  /^(lol|lmao|lmbo|omg|omfg|ha+|😂|🤣|👏|👍|🔥|💯|❤️|🎯|🎶|🎵)+$/i,
  /^me too/i,
  /^right\??!*$/i,
  /^well,?\s*yes/i,
];

/** Broad reaction detection: don't try to extract titles from these posts. */
export function isReaction(text: string): boolean {
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 50) {
    if (REACTION_PATTERNS.some((p) => p.test(trimmed))) return true;
  }
  if (trimmed.length <= 15 && !/[A-Z][a-z]{2,}/.test(trimmed)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Agreement detection (for context inheritance — strict)
// ---------------------------------------------------------------------------

// Only explicit agreement/endorsement patterns. Excludes surprise ("whoa"),
// amusement ("lol"), and generic short text that isReaction catches.
const AGREEMENT_PATTERNS: RegExp[] = [
  /^(yes|yep|yeah|yup|agreed|exactly|absolutely|definitely|this|same|correct|100%|💯)/i,
  /^(so good|great|amazing|incredible|love (it|this)|hell yeah|oh hell yeah)/i,
  /^(came here to say this|this is (it|the one|mine)|good (call|choice|pick|answer))/i,
  /^(underrated|overrated|classic|banger|legendary|goat|peak)/i,
  // Music-specific endorsement patterns
  /^(bop|tune|anthem|jam|slaps|bangs|certified|vibes?|mood)/i,
  /^oh (hell|fuck) yes/i,
  /^(yesss+|yasss+)/i,
  /^this is the (answer|one|way)/i,
  /^me too/i,
  /^right\??!*$/i,
  /^well,?\s*yes/i,
  /^(👏|👍|💯|🎯|🤝|✅|🙌|🎶|🎵)+$/,
];

/** Strict agreement detection: post endorses parent's content, suitable for inheritance. */
export function isAgreement(text: string): boolean {
  const trimmed = (text || '').trim();
  if (trimmed.length === 0) return false; // Empty posts don't agree
  if (trimmed.length < 50) {
    if (AGREEMENT_PATTERNS.some((p) => p.test(trimmed))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Validation lookup builder
// ---------------------------------------------------------------------------

/** Build a lookup map from validated mentions: lowercase candidate → {canonical, confidence}. */
export function buildValidationLookup(
  validatedMentions: ValidatedMention[]
): Map<string, ValidationLookupEntry> {
  const lookup = new Map<string, ValidationLookupEntry>();
  for (const m of validatedMentions) {
    if (m.validated && m.validatedTitle && m.validationConfidence) {
      lookup.set(m.title.toLowerCase(), {
        canonical: m.validatedTitle,
        confidence: m.validationConfidence,
      });
    }
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Phase 1: Dictionary Discovery
// ---------------------------------------------------------------------------

// Articles/connectors for alias-canonical alignment check
const ARTICLES = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'in',
  'on',
  'at',
  'to',
  'for',
  'from',
  'with',
  'by',
  'or',
  'is',
  'it',
  'its',
  'as',
  'so',
  'but',
  'not',
  'no',
]);

type TitleInfo = {
  aliases: Set<string>;
  confidentPostUris: Set<string>;
  incidentalPostUris: Set<string>;
  bestConfidence: 'high' | 'medium' | 'low';
};

/**
 * Discover the set of titles being discussed in this thread.
 *
 * @param posts All posts in the thread (index 0 = root post)
 * @param postTexts Pre-extracted text content per post URI
 * @param lookup Validation lookup map (lowercase candidate → canonical)
 * @param rootUri URI of the root post
 * @param rootText Lowercase text of the root post
 * @param options Optional configuration (e.g. relax short-title threshold)
 */
export function discoverDictionary(
  posts: readonly PostView[],
  postTexts: ReadonlyMap<string, PostTextContent>,
  lookup: ReadonlyMap<string, ValidationLookupEntry>,
  rootUri: string,
  rootText: string,
  options?: DiscoverDictionaryOptions
): ThreadDictionary {
  const titleInfo = new Map<string, TitleInfo>();

  function ensureTitle(canonical: string, confidence: 'high' | 'medium' | 'low'): TitleInfo {
    let info = titleInfo.get(canonical);
    if (!info) {
      info = {
        aliases: new Set(),
        confidentPostUris: new Set(),
        incidentalPostUris: new Set(),
        bestConfidence: confidence,
      };
      titleInfo.set(canonical, info);
    }
    if (confidence === 'high' || (confidence === 'medium' && info.bestConfidence === 'low')) {
      info.bestConfidence = confidence;
    }
    return info;
  }

  function recordConfident(
    canonical: string,
    alias: string,
    postUri: string,
    confidence: 'high' | 'medium' | 'low'
  ): void {
    const info = ensureTitle(canonical, confidence);
    info.aliases.add(alias.toLowerCase());
    info.confidentPostUris.add(postUri);
    info.incidentalPostUris.delete(postUri);
  }

  function recordIncidental(
    canonical: string,
    alias: string,
    postUri: string,
    confidence: 'high' | 'medium' | 'low'
  ): void {
    const info = ensureTitle(canonical, confidence);
    info.aliases.add(alias.toLowerCase());
    if (!info.confidentPostUris.has(postUri)) {
      info.incidentalPostUris.add(postUri);
    }
  }

  const lowerRootText = rootText.toLowerCase();

  // Scan all non-root posts
  for (const post of posts) {
    if (post.uri === rootUri) continue;

    const textContent = postTexts.get(post.uri);
    if (!textContent) continue;

    // Build search text, excluding quoted text from root post
    let searchText = textContent.ownText;
    if (textContent.quotedText && textContent.quotedUri !== rootUri) {
      searchText += '\n' + textContent.quotedText;
    }
    if (textContent.quotedAltText) {
      searchText += '\n' + textContent.quotedAltText.join('\n');
    }

    // --- Confident extraction: regex-based, longest match wins ---
    const candidates = extractCandidates(searchText);
    const shortCandidate = extractShortTextCandidate(post.record.text);
    if (shortCandidate) candidates.push(shortCandidate);

    // Sort longest first so longer phrases consume shorter substrings
    candidates.sort((a, b) => b.length - a.length);
    const consumedSpans: string[] = [];

    for (const candidate of candidates) {
      const entry = lookup.get(candidate.toLowerCase());
      if (!entry) continue;

      const candidateLower = candidate.toLowerCase();
      const consumed = consumedSpans.some((span) => span.includes(candidateLower));
      if (consumed) continue;

      recordConfident(entry.canonical, candidate, post.uri, entry.confidence);
      consumedSpans.push(candidateLower);
    }

    // --- Incidental: reverse substring scan ---
    const lowerText = searchText.toLowerCase();
    for (const [candidate, entry] of lookup) {
      if (entry.confidence === 'low') continue;
      const pattern = candidate.toLowerCase();
      if (lowerRootText.includes(pattern)) continue;
      if (pattern.length < 12 && pattern.split(/\s+/).length < 3) continue;
      if (lowerText.includes(pattern)) {
        recordIncidental(entry.canonical, candidate, post.uri, entry.confidence);
      }
    }
  }

  // --- Embed title seeding: pre-resolved titles from URL embeds ---
  // Strategy A: Posts with embed links get their parsed song as a confident mention.
  // Strategy B: Song names become dictionary patterns for reverse text matching.
  const embedTitles = options?.embedTitles;
  if (embedTitles && embedTitles.size > 0) {
    for (const [postUri, entry] of embedTitles) {
      if (postUri === rootUri) continue;
      // Strategy A: direct assignment — high confidence, no regex needed
      recordConfident(entry.canonical, entry.song, postUri, 'high');
      // Also add canonical as an alias for reverse matching
      recordConfident(entry.canonical, entry.canonical, postUri, 'high');
    }

    // Strategy B: scan all non-root posts for mentions of embed-derived song names.
    // This catches posts that mention a song by name without including a link.
    const embedMatchers: Array<{ canonical: string; pattern: string }> = [];
    for (const [, entry] of embedTitles) {
      const pattern = entry.song.toLowerCase();
      if (pattern.length >= 4 && !lowerRootText.includes(pattern)) {
        // Single-word patterns that are common English words produce massive
        // false positives (e.g., "Just" by Radiohead matches every post with "just").
        // Skip them for Strategy B — they still get Strategy A direct assignment.
        if (!pattern.includes(' ') && EMBED_STOP_WORDS.has(pattern)) continue;
        embedMatchers.push({ canonical: entry.canonical, pattern });
      }
    }
    // Dedup matchers by pattern
    const seenPatterns = new Set<string>();
    const dedupedMatchers = embedMatchers.filter((m) => {
      if (seenPatterns.has(m.pattern)) return false;
      seenPatterns.add(m.pattern);
      return true;
    });
    // Sort longest first
    dedupedMatchers.sort((a, b) => b.pattern.length - a.pattern.length);

    for (const post of posts) {
      if (post.uri === rootUri) continue;
      if (embedTitles.has(post.uri)) continue; // Already assigned via Strategy A
      const textContent = postTexts.get(post.uri);
      if (!textContent) continue;
      const text = textContent.ownText.toLowerCase();

      for (const { canonical, pattern } of dedupedMatchers) {
        const idx = text.indexOf(pattern);
        if (idx === -1) continue;
        // Word boundary check for short patterns
        if (pattern.length < 8) {
          const before = idx > 0 ? text[idx - 1] : ' ';
          const after = idx + pattern.length < text.length ? text[idx + pattern.length] : ' ';
          if (/[a-z0-9]/.test(before!) || /[a-z0-9]/.test(after!)) continue;
        }
        recordIncidental(canonical, pattern, post.uri, 'high');
      }
    }
  }

  // --- Disambiguation & filtering ---
  const dictionary = new Map<string, DictionaryEntry>();

  for (const [canonical, info] of titleInfo) {
    const confidentCount = info.confidentPostUris.size;

    // Rule 1: Require minimum confident mentions (default 1, higher for self-validated)
    const minOverall = options?.minConfidentOverall ?? 1;
    if (confidentCount < minOverall) continue;

    // Rule 2: Require medium+ API confidence
    if (info.bestConfidence === 'low') {
      const hasExactMultiWord =
        canonical.split(/\s+/).length >= 3 &&
        [...info.aliases].some((alias) => {
          const na = alias.replace(/^the\s+/i, '').trim();
          const nc = canonical
            .toLowerCase()
            .replace(/^the\s+/, '')
            .trim();
          return na === nc;
        });
      if (!hasExactMultiWord) continue;
    }

    // Rule 3: Short titles (1-2 words) need ≥N confident mentions (default 2)
    const minConfident = options?.minConfidentForShortTitle ?? 2;
    const wordCount = canonical.split(/\s+/).length;
    if (wordCount <= 2 && confidentCount < minConfident) continue;

    // Rule 4: Alias must share ≥60% of canonical's significant words
    const hasCloseMatch = [...info.aliases].some((alias) => {
      const aliasWords = alias
        .toLowerCase()
        .split(/[\s:,]+/)
        .filter((w) => w && !ARTICLES.has(w));
      const canonWords = canonical
        .toLowerCase()
        .split(/[\s:,]+/)
        .filter((w) => w && !ARTICLES.has(w));
      if (canonWords.length === 0) return false;
      const matched = canonWords.filter((w) => aliasWords.includes(w)).length;
      return matched / canonWords.length >= 0.6;
    });
    if (!hasCloseMatch) continue;

    const allPostUris = new Set([...info.confidentPostUris, ...info.incidentalPostUris]);
    const incidentalCount = info.incidentalPostUris.size;

    dictionary.set(canonical, {
      canonical,
      aliases: info.aliases,
      frequency: allPostUris.size,
      confidence: info.bestConfidence,
      confidentCount,
      incidentalCount,
      postUris: allPostUris,
    });
  }

  // --- Deduplication: remove fragment titles ---
  const canonicals = [...dictionary.keys()];

  function titlesOverlap(shortTitle: string, longTitle: string): boolean {
    const shortEntry = dictionary.get(shortTitle);
    const longEntry = dictionary.get(longTitle);
    if (!shortEntry || !longEntry) return false;

    const shortNorm = shortTitle.toLowerCase().replace(/^the\s+/, '');
    const longNorm = longTitle.toLowerCase().replace(/^the\s+/, '');
    if (longNorm.includes(shortNorm) && longNorm.length > shortNorm.length) return true;

    for (const sa of shortEntry.aliases) {
      for (const la of longEntry.aliases) {
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

      const shortInfo = dictionary.get(short)!;
      const longInfo = dictionary.get(long)!;

      let independentMentions = 0;
      for (const uri of shortInfo.postUris) {
        if (!longInfo.postUris.has(uri)) independentMentions++;
      }

      if (independentMentions === 0) {
        dictionary.delete(short);
        break;
      }
    }
  }

  // --- Quality filter: conversational phrases & embedded fragments ---
  // Short titles that are common English phrases (e.g., "Good One") or that always
  // appear inside a longer phrase (e.g., "Stop Me Now" inside "Don't Stop Me Now").
  filterFragmentTitles(dictionary, postTexts, rootUri);

  // --- Canonicalization merge: same song, different API canonical forms ---
  // MusicBrainz returns different canonical forms for the same song
  // (e.g., "It's All Coming Back to Me Now" vs "All Coming Back to Me Now").
  // Merge entries whose normalized forms match or have very high word overlap.
  // Returns a redirect map so the lookup can be patched.
  const redirects = mergeDuplicateCanonicals(dictionary);

  // Patch the lookup: redirect merged canonicals to the winner.
  // Build a new lookup with redirects applied.
  const patchedLookup = new Map(lookup);
  for (const [candidate, entry] of patchedLookup) {
    const redirect = redirects.get(entry.canonical);
    if (redirect) {
      patchedLookup.set(candidate, { ...entry, canonical: redirect });
    }
  }

  return { entries: dictionary, patchedLookup };
}

/** Words that commonly precede titles without indicating fragmentation. */
const PREFIX_SKIP_WORDS = new Set([
  'the',
  'a',
  'an', // articles
  'by',
  'of',
  'from',
  'in',
  'on',
  'for',
  'with',
  'at',
  'to',
  'about', // prepositions
  'my',
  'your',
  'his',
  'her',
  'its',
  'our',
  'their', // possessives
  'and',
  'or',
  'but', // conjunctions
]);

/**
 * Consistent-prefix detection: if a short title always appears preceded by the
 * same word, it's a fragment of a longer phrase (e.g., "Stop Me Now" → "Don't
 * Stop Me Now").
 */
function filterFragmentTitles(
  dictionary: Map<string, DictionaryEntry>,
  postTexts: ReadonlyMap<string, PostTextContent>,
  rootUri: string
): void {
  const toRemove: string[] = [];

  for (const [canonical, info] of dictionary) {
    const words = canonical.split(/\s+/);
    if (words.length > 3) continue; // only check short titles

    const lowerCanonical = canonical.toLowerCase();
    const prefixCounts = new Map<string, number>();
    let matchedPosts = 0;

    for (const uri of info.postUris) {
      if (uri === rootUri) continue;
      const textContent = postTexts.get(uri);
      if (!textContent) continue;
      const text = textContent.ownText;
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

    // Need enough posts containing the title for reliable detection
    if (matchedPosts < 3) continue;

    // If one specific word appears before the title in >70% of text occurrences,
    // it's a fragment of a longer phrase.
    // E.g., "Stop Me Now" preceded by "don't" in 80% of posts → "Don't Stop Me Now".
    // But "Apollo 13" preceded by "watch"/"love"/"saw" (different each time) → NOT a fragment.
    for (const [, count] of prefixCounts) {
      if (count / matchedPosts > 0.7) {
        toRemove.push(canonical);
        break;
      }
    }
  }

  for (const canonical of toRemove) {
    dictionary.delete(canonical);
  }
}

/** Normalize a canonical title for dedup comparison. */
export function normalizeForMerge(title: string): string {
  return title
    .replace(/[\u2018\u2019\u2032]/g, "'") // curly/prime quotes → straight
    .toLowerCase()
    .replace(/^(it's|it is|don't|i)\s+/i, '') // strip leading contractions
    .replace(/^(the|a|an)\s+/i, '') // strip leading articles (chained after contractions)
    .replace(/[.,!?'"]+$/, '')
    .replace(/s$/, '') // strip trailing plural
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract significant words (skip articles/prepositions/contractions). */
function significantWords(title: string): string[] {
  const stop = new Set([
    'the',
    'a',
    'an',
    'of',
    'and',
    'in',
    'on',
    'at',
    'to',
    'for',
    'from',
    'with',
    'by',
    'or',
    'is',
    'it',
    'its',
    'as',
    'so',
    'but',
    'not',
    'no',
    "it's",
    "i'm",
    "don't",
    "won't",
    "can't",
    "didn't",
    "wasn't",
    "isn't",
    "aren't",
    "couldn't",
    "wouldn't",
    "shouldn't",
    "hasn't",
    "haven't",
    "ain't",
    "let's",
    "that's",
    "what's",
    "who's",
    "he's",
    "she's",
    "we're",
    "they're",
    "you're",
    "i'll",
    "you'll",
    "we'll",
    "they'll",
  ]);
  return title
    .toLowerCase()
    .split(/[\s:,]+/)
    .filter((w) => w && !stop.has(w));
}

/**
 * Merge dictionary entries that are clearly the same song with different
 * canonical forms from the validation API.
 */
function mergeDuplicateCanonicals(dictionary: Map<string, DictionaryEntry>): Map<string, string> {
  const redirects = new Map<string, string>();
  const entries = [...dictionary.entries()];

  // Group by normalized form (catches exact matches after normalization)
  const groups = new Map<string, string[]>();
  for (const [canonical] of entries) {
    const norm = normalizeForMerge(canonical);
    const group = groups.get(norm) ?? [];
    group.push(canonical);
    groups.set(norm, group);
  }

  // Merge exact-normalized groups
  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    mergeGroup(dictionary, group, redirects);
  }

  // Second pass: word-set overlap for remaining entries that didn't normalize identically
  // (catches "Paradise by the Dashboard Light" vs "Paradise by the Dashboard Lights")
  const remaining = [...dictionary.keys()];
  const merged = new Set<string>();

  for (let i = 0; i < remaining.length; i++) {
    if (merged.has(remaining[i]!)) continue;
    const a = remaining[i]!;
    const aWords = significantWords(a);
    if (aWords.length < 2) continue; // skip 1-word titles — too ambiguous

    const group = [a];
    for (let j = i + 1; j < remaining.length; j++) {
      if (merged.has(remaining[j]!)) continue;
      const b = remaining[j]!;
      const bWords = significantWords(b);
      if (bWords.length < 2) continue;

      // Check bidirectional overlap: both must share ≥85% of each other's words
      const aInB = aWords.filter((w) => bWords.includes(w)).length;
      const bInA = bWords.filter((w) => aWords.includes(w)).length;
      const overlapA = aInB / aWords.length;
      const overlapB = bInA / bWords.length;

      if (overlapA >= 0.85 && overlapB >= 0.85) {
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

/** Merge a group of dictionary entries into one, keeping the best canonical. */
function mergeGroup(
  dictionary: Map<string, DictionaryEntry>,
  group: string[],
  redirects: Map<string, string>
): void {
  // Pick the canonical with the most confident mentions; on tie, longest name
  // (longer names are more specific and informative)
  const sorted = group
    .map((c) => ({ canonical: c, entry: dictionary.get(c)! }))
    .filter((x) => x.entry)
    .sort((a, b) => {
      const confDiff = b.entry.confidentCount - a.entry.confidentCount;
      if (confDiff !== 0) return confDiff;
      return b.canonical.length - a.canonical.length;
    });

  if (sorted.length <= 1) return;

  const winner = sorted[0]!;
  const combinedAliases = new Set(winner.entry.aliases);
  const combinedPostUris = new Set(winner.entry.postUris);
  let combinedConfident = winner.entry.confidentCount;
  let combinedIncidental = winner.entry.incidentalCount;

  for (const other of sorted.slice(1)) {
    for (const alias of other.entry.aliases) combinedAliases.add(alias);
    for (const uri of other.entry.postUris) combinedPostUris.add(uri);
    // Don't just add counts — recalculate from combined URIs below
    dictionary.delete(other.canonical);
    redirects.set(other.canonical, winner.canonical);
  }

  // Add all canonicals as aliases too (so reverse lookup finds them)
  for (const { canonical } of sorted) {
    combinedAliases.add(canonical.toLowerCase());
  }

  // Recalculate confident/incidental from merged data
  // We can't perfectly separate them, so use the winner's ratio scaled up
  const totalPrev = winner.entry.confidentCount + winner.entry.incidentalCount;
  if (totalPrev > 0) {
    const confRatio = winner.entry.confidentCount / totalPrev;
    combinedConfident = Math.round(combinedPostUris.size * confRatio);
    combinedIncidental = combinedPostUris.size - combinedConfident;
  }

  dictionary.set(winner.canonical, {
    canonical: winner.canonical,
    aliases: combinedAliases,
    frequency: combinedPostUris.size,
    confidence: winner.entry.confidence,
    confidentCount: combinedConfident,
    incidentalCount: combinedIncidental,
    postUris: combinedPostUris,
  });
}
