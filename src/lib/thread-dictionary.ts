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
};

/** Lookup entry built from validation results. */
export type ValidationLookupEntry = {
  readonly canonical: string;
  readonly confidence: 'high' | 'medium' | 'low';
};

export type DiscoverDictionaryOptions = {
  readonly minConfidentForShortTitle?: number; // default: 2
};

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
    return cleaned;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reaction detection (for context inheritance)
// ---------------------------------------------------------------------------

const REACTION_PATTERNS: RegExp[] = [
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

  // --- Disambiguation & filtering ---
  const dictionary = new Map<string, DictionaryEntry>();

  for (const [canonical, info] of titleInfo) {
    const confidentCount = info.confidentPostUris.size;

    // Rule 1: Require at least 1 confident mention
    if (confidentCount === 0) continue;

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

  return { entries: dictionary };
}
