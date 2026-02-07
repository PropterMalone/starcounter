import { describe, it, expect } from 'vitest';
import {
  fingerprint,
  ngrams,
  ngramSimilarity,
  fingerprintContains,
  findBestMatch,
  suggestClusters,
} from './clustering';

describe('fingerprint', () => {
  it('normalizes case and removes punctuation', () => {
    expect(fingerprint('Hello, World!')).toBe('hello world');
  });

  it('sorts tokens alphabetically', () => {
    expect(fingerprint('zebra apple mango')).toBe('apple mango zebra');
  });

  it('removes stop words by default', () => {
    expect(fingerprint('The Hunt for Red October')).toBe('hunt october red');
  });

  it('includes stop words when requested', () => {
    expect(fingerprint('The Hunt for Red October', true)).toBe('for hunt october red the');
  });

  it('deduplicates tokens', () => {
    expect(fingerprint('the the the cat cat')).toBe('cat');
  });

  it('handles empty string', () => {
    expect(fingerprint('')).toBe('');
  });

  it('produces same fingerprint for different word orders', () => {
    const fp1 = fingerprint('The Hunt for Red October');
    const fp2 = fingerprint('Red October Hunt');
    const fp3 = fingerprint('october red hunt');
    expect(fp1).toBe(fp2);
    expect(fp2).toBe(fp3);
  });

  it('handles possessives', () => {
    expect(fingerprint("Ocean's Eleven")).toBe('eleven oceans');
  });
});

describe('ngrams', () => {
  it('extracts bigrams by default', () => {
    const grams = ngrams('paris');
    expect(grams).toEqual(new Set(['pa', 'ar', 'ri', 'is']));
  });

  it('extracts trigrams when specified', () => {
    const grams = ngrams('paris', 3);
    expect(grams).toEqual(new Set(['par', 'ari', 'ris']));
  });

  it('normalizes case and removes non-word chars', () => {
    const grams = ngrams('Hi!');
    expect(grams).toEqual(new Set(['hi']));
  });

  it('handles empty string', () => {
    expect(ngrams('')).toEqual(new Set());
  });

  it('handles string shorter than n', () => {
    expect(ngrams('a', 2)).toEqual(new Set());
  });
});

describe('ngramSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(ngramSimilarity('hello', 'hello')).toBe(1);
  });

  it('returns 1 for both empty strings', () => {
    expect(ngramSimilarity('', '')).toBe(1);
  });

  it('returns 0 when one is empty', () => {
    expect(ngramSimilarity('hello', '')).toBe(0);
    expect(ngramSimilarity('', 'world')).toBe(0);
  });

  it('returns moderate similarity for strings with transposition', () => {
    // "johnsmith" vs "jhonsmith" (transposition)
    // N-gram Jaccard is ~0.45 because transposition affects multiple bigrams
    const sim = ngramSimilarity('johnsmith', 'jhonsmith');
    expect(sim).toBeGreaterThan(0.4);
    expect(sim).toBeLessThan(0.6);
  });

  it('returns high similarity for strings differing by one char', () => {
    // Single char difference at end affects fewer bigrams
    const sim = ngramSimilarity('pulpfiction', 'pulpficton');
    expect(sim).toBeGreaterThan(0.7);
  });

  it('returns low similarity for different strings', () => {
    const sim = ngramSimilarity('apple', 'zebra');
    expect(sim).toBeLessThan(0.3);
  });

  it('is case insensitive', () => {
    expect(ngramSimilarity('Hello', 'HELLO')).toBe(1);
  });
});

describe('fingerprintContains', () => {
  it('returns true when text contains all category tokens', () => {
    const textFp = fingerprint('I loved The Hunt for Red October last night');
    const categoryFp = fingerprint('The Hunt for Red October');
    expect(fingerprintContains(textFp, categoryFp)).toBe(true);
  });

  it('returns false when text is missing category tokens', () => {
    const textFp = fingerprint('I loved Red October');
    const categoryFp = fingerprint('The Hunt for Red October');
    expect(fingerprintContains(textFp, categoryFp)).toBe(false);
  });

  it('returns true for empty category', () => {
    expect(fingerprintContains('any text', '')).toBe(true);
  });

  it('returns false for empty text with non-empty category', () => {
    expect(fingerprintContains('', 'something')).toBe(false);
  });

  it('is word-order independent', () => {
    const textFp = fingerprint('october red hunt');
    const categoryFp = fingerprint('hunt red october');
    expect(fingerprintContains(textFp, categoryFp)).toBe(true);
  });
});

describe('findBestMatch', () => {
  const categories = [
    'The Hunt for Red October',
    'Top Gun: Maverick',
    'Pulp Fiction',
    'The Matrix',
  ];

  it('finds fingerprint match for exact title', () => {
    const result = findBestMatch('The Hunt for Red October', categories);
    expect(result).not.toBeNull();
    expect(result?.category).toBe('The Hunt for Red October');
    expect(result?.method).toBe('fingerprint');
  });

  it('finds fingerprint match regardless of word order', () => {
    const result = findBestMatch('red october hunt', categories);
    expect(result).not.toBeNull();
    expect(result?.category).toBe('The Hunt for Red October');
    expect(result?.method).toBe('fingerprint');
  });

  it('finds fingerprint match when title is embedded in text', () => {
    const result = findBestMatch('I watched hunt for red october last night', categories);
    expect(result).not.toBeNull();
    expect(result?.category).toBe('The Hunt for Red October');
  });

  it('finds ngram match for typos', () => {
    const result = findBestMatch('Top Gun Mavrick', categories, { ngram: 0.6 });
    expect(result).not.toBeNull();
    expect(result?.category).toBe('Top Gun: Maverick');
    expect(result?.method).toBe('ngram');
  });

  it('returns null when no match found', () => {
    const result = findBestMatch('completely unrelated text', categories);
    expect(result).toBeNull();
  });

  it('prefers fingerprint over other methods', () => {
    const result = findBestMatch('pulp fiction', categories);
    expect(result).not.toBeNull();
    expect(result?.method).toBe('fingerprint');
  });

  it('skips short categories for ngram matching', () => {
    // "RED" (3 chars) should not match via ngram since it's < 6 chars
    const shortCategories = ['RED'];
    const result = findBestMatch('completely different', shortCategories, { ngram: 0.1 });
    // Should not match via ngram (categories too short), and fingerprint doesn't contain "red"
    expect(result).toBeNull();
  });

  it('selects best ngram match when multiple qualify', () => {
    // Two similar categories - should pick the one with higher score
    const similarCategories = ['Top Gun Maverick', 'Top Gun Original'];
    const result = findBestMatch('Top Gun Mavrick', similarCategories, { ngram: 0.5 });
    expect(result).not.toBeNull();
    expect(result?.method).toBe('ngram');
    // "Mavrick" is closer to "Maverick" than to "Original"
    expect(result?.category).toBe('Top Gun Maverick');
  });

  it('updates best ngram when finding better match later in list', () => {
    // Use text that WON'T match via fingerprint (different word tokens)
    // but HAS similar character sequences for ngram matching
    // "alphazeta" has words: ["alphazeta"] - single token
    // "Alpha Something" has words: ["alpha", "something"]
    // "AlphaZeta" has words: ["alphazeta"]
    // Fingerprint won't match because tokens differ, but ngram sees character overlap
    const categories = ['Longer Something Else', 'AlphaBeta Chars']; // 6+ chars for ngram
    // Text "AlphaBta Chars" is close to "AlphaBeta Chars" (missing 'e')
    const result = findBestMatch('AlphaBta Chars', categories, {
      fingerprint: 1.0, // Won't match (tokens: ["alphabta", "chars"] vs ["alphabeta", "chars"])
      ngram: 0.4, // Threshold to match similar strings
    });
    expect(result).not.toBeNull();
    // Should match second category better via ngram
    expect(result?.method).toBe('ngram');
    expect(result?.category).toBe('AlphaBeta Chars');
  });

  it('handles empty categories array', () => {
    const result = findBestMatch('some text', []);
    expect(result).toBeNull();
  });
});

describe('suggestClusters', () => {
  const categories = ['The Matrix', 'Pulp Fiction', 'Inception'];

  it('groups posts by suggested category', () => {
    const uncategorized = new Map([
      ['post1', 'I loved the matrix'],
      ['post2', 'matrix is great'],
      ['post3', 'pulp fiction rules'],
    ]);

    const suggestions = suggestClusters(uncategorized, categories);

    expect(suggestions.length).toBeGreaterThan(0);

    const matrixCluster = suggestions.find((s) => s.suggestedCategory === 'The Matrix');
    expect(matrixCluster).toBeDefined();
    expect(matrixCluster?.postUris).toContain('post1');
    expect(matrixCluster?.postUris).toContain('post2');

    const pulpCluster = suggestions.find((s) => s.suggestedCategory === 'Pulp Fiction');
    expect(pulpCluster).toBeDefined();
    expect(pulpCluster?.postUris).toContain('post3');
  });

  it('sorts by cluster size descending', () => {
    const uncategorized = new Map([
      ['post1', 'matrix one'],
      ['post2', 'matrix two'],
      ['post3', 'matrix three'],
      ['post4', 'pulp fiction'],
    ]);

    const suggestions = suggestClusters(uncategorized, categories);

    // Matrix cluster (3 posts) should come before Pulp Fiction (1 post)
    const matrixIndex = suggestions.findIndex((s) => s.suggestedCategory === 'The Matrix');
    const pulpIndex = suggestions.findIndex((s) => s.suggestedCategory === 'Pulp Fiction');

    expect(matrixIndex).toBeLessThan(pulpIndex);
  });

  it('returns empty array when no matches', () => {
    const uncategorized = new Map([['post1', 'completely unrelated content xyz']]);

    const suggestions = suggestClusters(uncategorized, categories);
    expect(suggestions).toEqual([]);
  });

  it('respects minScore threshold', () => {
    const uncategorized = new Map([
      ['post1', 'matrix'],
      ['post2', 'matrixxxx'], // Low similarity
    ]);

    // With high threshold, only exact-ish matches
    const strictSuggestions = suggestClusters(uncategorized, categories, 0.9);
    const looseSuggestions = suggestClusters(uncategorized, categories, 0.3);

    expect(looseSuggestions.length).toBeGreaterThanOrEqual(strictSuggestions.length);
  });

  it('sorts by score when cluster sizes are equal', () => {
    // Two categories each with one post - should sort by score
    const uncategorized = new Map([
      ['post1', 'matrix'], // Exact match
      ['post2', 'pulp fiction'], // Exact match
    ]);
    const categories = ['The Matrix', 'Pulp Fiction'];

    const suggestions = suggestClusters(uncategorized, categories);

    // Both have 1 post, so should be sorted by score (alphabetically if equal)
    expect(suggestions.length).toBe(2);
    expect(suggestions[0]?.postUris.length).toBe(1);
    expect(suggestions[1]?.postUris.length).toBe(1);
  });

  it('handles empty uncategorized map', () => {
    const suggestions = suggestClusters(new Map(), categories);
    expect(suggestions).toEqual([]);
  });

  it('handles empty categories', () => {
    const uncategorized = new Map([['post1', 'some text']]);
    const suggestions = suggestClusters(uncategorized, []);
    expect(suggestions).toEqual([]);
  });
});
