// pattern: Functional Core
// Self-validation and list-validation for open-ended threads.
//
// When no external API checkboxes are selected, the pipeline needs an
// alternative way to build the ValidationLookupEntry map that
// discoverDictionary and labelPosts expect.
//
// Two modes:
//   1. List-validated — user pastes a list of canonical answers
//   2. Self-validated — structural heuristics, trust the thread

import type { ValidationLookupEntry } from './thread-dictionary';

// ---------------------------------------------------------------------------
// Category word extraction
// ---------------------------------------------------------------------------

// Matches "your (adjectives)* WORDS" — captures everything after adjectives
const PROMPT_PATTERN =
  /\byour\s+(?:(?:home|favorite|fav|go-to|all-time|top|first|best|worst|least\s+favorite|most\s+hated|childhood|guilty\s+pleasure)\s+)*(\w+(?:\s+\w+){0,4})/i;

const ADJECTIVES = new Set([
  'home',
  'favorite',
  'fav',
  'go-to',
  'all-time',
  'top',
  'first',
  'best',
  'worst',
  'childhood',
  'guilty',
  'pleasure',
  'least',
  'most',
  'hated',
]);

// Function words that end the noun phrase — if we hit one, stop collecting
const FUNCTION_WORDS = new Set([
  'so',
  'and',
  'or',
  'but',
  'for',
  'from',
  'with',
  'the',
  'a',
  'an',
  'in',
  'on',
  'at',
  'to',
  'of',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'must',
  'that',
  'which',
  'who',
  'this',
  'these',
  'those',
  'my',
  'your',
  'his',
  'her',
  'its',
  'our',
  'their',
  'mine',
  'yours',
  'it',
  'they',
  'we',
  'he',
  'she',
  'me',
  'him',
  'us',
  'them',
  'i',
  'you',
  'not',
  'no',
  'if',
  'when',
  'where',
  'how',
  'what',
  'why',
  'because',
  'since',
  'although',
  'though',
  'while',
  'until',
  'after',
  'before',
  'during',
  'about',
  'into',
  'through',
]);

/**
 * Extract category words from a root post prompt.
 *
 * Examples:
 *   "what is your home river?" → ["river"]
 *   "share your favorite board game" → ["board", "game"]
 *   "what's your go-to comfort food?" → ["comfort", "food"]
 *   "your home river, so reskeet..." → ["river"]
 *   "hello world" → [] (no match)
 */
export function extractCategoryWords(rootText: string): string[] {
  const match = rootText.match(PROMPT_PATTERN);
  if (!match || !match[1]) return [];

  const words = match[1]
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w && !ADJECTIVES.has(w));

  // Take words until we hit a function word — the noun phrase ends there
  const result: string[] = [];
  for (const w of words) {
    if (FUNCTION_WORDS.has(w)) break;
    result.push(w);
    if (result.length >= 3) break;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

const LEADING_ARTICLE_RE = /^(the|a|an)\s+/i;

function stripArticle(s: string): string {
  return s.replace(LEADING_ARTICLE_RE, '').trim();
}

function normalize(s: string): string {
  let n = s.toLowerCase().trim();
  n = stripArticle(n);
  n = n
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return n;
}

function toTitleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Self-validated lookup
// ---------------------------------------------------------------------------

// Common English words that are never valid open-ended answers
const SELF_VALIDATION_STOP_WORDS = new Set([
  'here',
  'there',
  'what',
  'when',
  'where',
  'how',
  'why',
  'then',
  'now',
  'just',
  'also',
  'not',
  'too',
  'oh',
  'well',
  'so',
  'very',
  'really',
  'still',
  'even',
  'much',
  'many',
  'some',
  'any',
  'all',
  'both',
  'each',
  'every',
  'other',
  'another',
  'such',
  'more',
  'most',
  'less',
  'few',
  'only',
  'own',
  'same',
  'than',
  'like',
  'right',
  'good',
  'new',
  'old',
  'big',
  'long',
  'little',
  'great',
  'always',
  'never',
  'today',
  'yes',
  'no',
  'beautiful',
  'pretty',
  'amazing',
  'awesome',
  'gorgeous',
  'incredible',
  'lovely',
  'wonderful',
  'terrible',
  'horrible',
  'perfect',
  'cool',
  'nice',
  'fun',
  'wild',
  'love',
  'grew',
  'lived',
  'born',
  'moved',
  'spent',
  'miss',
  'remember',
  'weird',
  'funny',
  'mine',
  'ours',
  'lol',
  'nope',
  'yep',
  'yeah',
  'absolutely',
  'definitely',
  'literally',
  'basically',
  'obviously',
  'actually',
  'honestly',
  'seriously',
  'technically',
]);

const MIN_NORM_KEY_LENGTH = 3;

/**
 * Build a validation lookup without any external source.
 *
 * Groups candidates by normalized form, picks the most common surface form
 * as canonical (on tie, shortest), and builds a lookup map.
 */
export function buildSelfValidatedLookup(
  candidates: ReadonlySet<string>,
  rootText: string
): Map<string, ValidationLookupEntry> {
  const categoryWords = extractCategoryWords(rootText);
  const MAX_WORDS = 5;

  // Build category word set (with plurals) for filtering
  const categoryWordSet = new Set<string>();
  for (const w of categoryWords) {
    categoryWordSet.add(w);
    categoryWordSet.add(w + 's');
    categoryWordSet.add(w + 'es');
    if (w.endsWith('y')) {
      categoryWordSet.add(w.slice(0, -1) + 'ies');
    }
  }

  // Group candidates by normalization key
  const groups = new Map<string, string[]>();

  for (const candidate of candidates) {
    if (candidate.split(/\s+/).length > MAX_WORDS) continue;

    const normKey = normalize(candidate);
    if (normKey.length < MIN_NORM_KEY_LENGTH) continue;

    // Skip if normKey is just a category word
    if (categoryWordSet.has(normKey)) continue;

    // Skip if every word in normKey is a stop/function/adjective word (catches "my home", "not sure")
    const normWords = normKey.split(/\s+/);
    if (
      normWords.every(
        (w) =>
          SELF_VALIDATION_STOP_WORDS.has(w) ||
          FUNCTION_WORDS.has(w) ||
          ADJECTIVES.has(w) ||
          categoryWordSet.has(w)
      )
    )
      continue;

    const group = groups.get(normKey);
    if (group) {
      group.push(candidate);
    } else {
      groups.set(normKey, [candidate]);
    }
  }

  // For each group, pick canonical = most common surface form (title-cased, article stripped)
  const lookup = new Map<string, ValidationLookupEntry>();

  for (const [normKey, members] of groups) {
    // Count surface forms (after article stripping + title-casing)
    const formCounts = new Map<string, number>();
    for (const m of members) {
      const form = toTitleCase(stripArticle(m.toLowerCase()).trim());
      formCounts.set(form, (formCounts.get(form) ?? 0) + 1);
    }

    // Pick: highest count, then shortest
    let canonical = '';
    let bestCount = 0;
    for (const [form, count] of formCounts) {
      if (
        count > bestCount ||
        (count === bestCount && (canonical === '' || form.length < canonical.length))
      ) {
        canonical = form;
        bestCount = count;
      }
    }

    if (!canonical) {
      canonical = toTitleCase(normKey);
    }

    // Map every member (lowercased) to the canonical
    for (const m of members) {
      lookup.set(m.toLowerCase(), { canonical, confidence: 'high' });
    }
  }

  return lookup;
}

// ---------------------------------------------------------------------------
// List-validated lookup
// ---------------------------------------------------------------------------

/**
 * Build a validation lookup from a user-provided list of canonical answers.
 *
 * For each candidate, fuzzy-match against the list:
 *   - Normalize both sides: lowercase, strip leading "The"/"A", strip trailing punctuation
 *   - Match if normalized candidate equals or is contained within a normalized list item (or vice versa)
 *   - Matched candidates get the list item as canonical with high confidence
 */
export function buildListValidatedLookup(
  candidates: ReadonlySet<string>,
  listItems: readonly string[]
): Map<string, ValidationLookupEntry> {
  const lookup = new Map<string, ValidationLookupEntry>();

  // Pre-normalize list items
  const normalizedList = listItems.map((item) => ({
    original: item,
    normalized: stripArticle(
      item
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .trim()
    ),
  }));

  for (const candidate of candidates) {
    const normCandidate = stripArticle(
      candidate
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .trim()
    );
    if (normCandidate.length === 0) continue;

    for (const listItem of normalizedList) {
      if (listItem.normalized.length === 0) continue;

      // Exact match or containment in either direction
      if (
        normCandidate === listItem.normalized ||
        listItem.normalized.includes(normCandidate) ||
        normCandidate.includes(listItem.normalized)
      ) {
        lookup.set(candidate.toLowerCase(), {
          canonical: listItem.original,
          confidence: 'high',
        });
        break;
      }
    }
  }

  return lookup;
}
