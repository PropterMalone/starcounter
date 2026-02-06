// pattern: Functional Core
// Text clustering algorithms inspired by OpenRefine
// Used for fuzzy matching posts to categories and clustering similar items

/**
 * Result of matching a text against categories
 */
export type MatchResult = {
  readonly category: string;
  readonly score: number;
  readonly method: 'fingerprint' | 'ngram' | 'levenshtein';
};

/**
 * Cluster suggestion for user review
 */
export type ClusterSuggestion = {
  readonly suggestedCategory: string;
  readonly postUris: readonly string[];
  readonly score: number;
  readonly method: 'fingerprint' | 'ngram' | 'levenshtein';
};

// Articles and common words to exclude from fingerprints
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'is',
  'it',
  'as',
]);

/**
 * Create a fingerprint from text.
 * Normalizes, tokenizes, removes stop words, sorts, and joins.
 *
 * Examples:
 * - "The Hunt for Red October" → "hunt october red"
 * - "hunt for red october" → "hunt october red"
 * - "Red October Hunt" → "hunt october red"
 *
 * @param text - Input text
 * @param includeStopWords - Include stop words in fingerprint (default: false)
 */
export function fingerprint(text: string, includeStopWords = false): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // remove punctuation
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .filter((w) => includeStopWords || !STOP_WORDS.has(w));

  // Dedupe and sort
  const unique = [...new Set(tokens)].sort();
  return unique.join(' ');
}

/**
 * Extract n-grams (character subsequences) from text.
 *
 * Example with n=2:
 * - "paris" → {"pa", "ar", "ri", "is"}
 *
 * @param text - Input text
 * @param n - N-gram size (default: 2)
 */
export function ngrams(text: string, n = 2): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\w]/g, '');
  const grams = new Set<string>();

  for (let i = 0; i <= normalized.length - n; i++) {
    grams.add(normalized.slice(i, i + n));
  }

  return grams;
}

/**
 * Compute Jaccard similarity between two n-gram sets.
 * Returns value between 0 (no overlap) and 1 (identical).
 *
 * @param a - First text
 * @param b - Second text
 * @param n - N-gram size (default: 2)
 */
export function ngramSimilarity(a: string, b: string, n = 2): number {
  const gramsA = ngrams(a, n);
  const gramsB = ngrams(b, n);

  if (gramsA.size === 0 && gramsB.size === 0) {
    return 1; // Both empty = identical
  }
  if (gramsA.size === 0 || gramsB.size === 0) {
    return 0; // One empty = no similarity
  }

  const intersection = new Set([...gramsA].filter((g) => gramsB.has(g)));
  const union = new Set([...gramsA, ...gramsB]);

  return intersection.size / union.size;
}

/**
 * Compute Levenshtein edit distance between two strings.
 * Returns the minimum number of single-character edits (insertions, deletions,
 * substitutions) needed to transform one string into the other.
 *
 * @param a - First string
 * @param b - Second string
 */
export function levenshtein(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  // Early exits
  if (aLower === bLower) return 0;
  if (aLower.length === 0) return bLower.length;
  if (bLower.length === 0) return aLower.length;

  // Use two rows instead of full matrix for memory efficiency
  let prevRow = Array.from({ length: bLower.length + 1 }, (_, i) => i);
  let currRow = new Array<number>(bLower.length + 1);

  for (let i = 1; i <= aLower.length; i++) {
    currRow[0] = i;

    for (let j = 1; j <= bLower.length; j++) {
      const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        (prevRow[j] ?? 0) + 1, // deletion
        (currRow[j - 1] ?? 0) + 1, // insertion
        (prevRow[j - 1] ?? 0) + cost // substitution
      );
    }

    // Swap rows
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[bLower.length] ?? 0;
}

/**
 * Compute normalized edit similarity (0-1) from Levenshtein distance.
 * 1 = identical, 0 = completely different.
 *
 * @param a - First string
 * @param b - Second string
 */
export function editSimilarity(a: string, b: string): number {
  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);

  if (maxLen === 0) return 1; // Both empty = identical

  return 1 - distance / maxLen;
}

/**
 * Check if a fingerprint contains another (order-independent substring match).
 *
 * @param textFp - Fingerprint of the full text
 * @param categoryFp - Fingerprint of the category to find
 */
export function fingerprintContains(textFp: string, categoryFp: string): boolean {
  if (categoryFp.length === 0) return true;
  if (textFp.length === 0) return false;

  const textTokens = new Set(textFp.split(' '));
  const categoryTokens = categoryFp.split(' ');

  // All category tokens must be in text
  return categoryTokens.every((token) => textTokens.has(token));
}

/**
 * Find the best matching category for a text using multiple methods.
 *
 * Strategy:
 * 1. Try fingerprint containment (highest confidence, catches word order variations)
 * 2. Try n-gram similarity (catches typos)
 * 3. Try edit distance (catches small differences)
 *
 * @param text - Text to match
 * @param categories - List of category names to match against
 * @param thresholds - Minimum scores for each method
 */
export function findBestMatch(
  text: string,
  categories: readonly string[],
  thresholds: {
    fingerprint?: number;
    ngram?: number;
    levenshtein?: number;
  } = {}
): MatchResult | null {
  const {
    fingerprint: fpThreshold = 1.0,
    ngram: ngThreshold = 0.5,
    levenshtein: levThreshold = 0.8,
  } = thresholds;

  const textFp = fingerprint(text);

  // Method 1: Fingerprint containment
  for (const category of categories) {
    const categoryFp = fingerprint(category);
    if (fingerprintContains(textFp, categoryFp)) {
      return { category, score: fpThreshold, method: 'fingerprint' };
    }
  }

  // Method 2: N-gram similarity (for longer category names)
  let bestNgram: MatchResult | null = null;
  for (const category of categories) {
    if (category.length < 6) continue; // Skip short categories for n-gram
    const score = ngramSimilarity(text, category);
    if (score >= ngThreshold && (!bestNgram || score > bestNgram.score)) {
      bestNgram = { category, score, method: 'ngram' };
    }
  }
  if (bestNgram) return bestNgram;

  // Method 3: Edit similarity (for short category names)
  let bestEdit: MatchResult | null = null;
  for (const category of categories) {
    const score = editSimilarity(text, category);
    if (score >= levThreshold && (!bestEdit || score > bestEdit.score)) {
      bestEdit = { category, score, method: 'levenshtein' };
    }
  }

  return bestEdit;
}

/**
 * Find all posts that might belong to a category (for clustering UI).
 * Groups uncategorized posts by their best matching category.
 *
 * @param uncategorizedTexts - Map of postUri → post text
 * @param categories - List of existing category names
 * @param minScore - Minimum similarity score to suggest
 */
export function suggestClusters(
  uncategorizedTexts: ReadonlyMap<string, string>,
  categories: readonly string[],
  minScore = 0.4
): ClusterSuggestion[] {
  // Group posts by suggested category
  const clusters = new Map<
    string,
    { uris: string[]; totalScore: number; method: MatchResult['method'] }
  >();

  for (const [uri, text] of uncategorizedTexts) {
    const match = findBestMatch(text, categories, {
      fingerprint: 1.0,
      ngram: minScore,
      levenshtein: minScore,
    });

    if (match) {
      const existing = clusters.get(match.category);
      if (existing) {
        existing.uris.push(uri);
        existing.totalScore += match.score;
      } else {
        clusters.set(match.category, {
          uris: [uri],
          totalScore: match.score,
          method: match.method,
        });
      }
    }
  }

  // Convert to array and compute average scores
  const suggestions: ClusterSuggestion[] = [];
  for (const [category, data] of clusters) {
    suggestions.push({
      suggestedCategory: category,
      postUris: data.uris,
      score: data.totalScore / data.uris.length,
      method: data.method,
    });
  }

  // Sort by cluster size (biggest first), then by score
  suggestions.sort((a, b) => {
    if (b.postUris.length !== a.postUris.length) {
      return b.postUris.length - a.postUris.length;
    }
    return b.score - a.score;
  });

  return suggestions;
}
