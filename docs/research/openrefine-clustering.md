# OpenRefine Clustering Research

**Date:** 2026-02-06
**Purpose:** Investigate OpenRefine's clustering approach for potential application to Starcounter's uncategorized post cleanup

## Problem Statement

Starcounter analyzes Bluesky threads and extracts media mentions. Posts that don't match any validated category end up as "Uncategorized." We need a way to help users:

1. Identify patterns in uncategorized posts that might be valid mentions
2. Recognize variations/typos of existing categories
3. Review and merge similar entries interactively

## OpenRefine Clustering Methods

OpenRefine uses two main categories of clustering algorithms:

### Key Collision Methods (Fast, Fewer False Positives)

| Method | How It Works | Best For |
|--------|--------------|----------|
| **Fingerprint** | Normalize whitespace, lowercase, remove punctuation, tokenize, sort, dedupe tokens | Basic normalization - "Tom Cruise" = "Cruise, Tom" |
| **N-Gram Fingerprint** | Extract all n-grams (default size 2), sort, dedupe | Catching typos - "johnsmith" clusters with "jhonsmith" |
| **Phonetic** | Transform to phonetic representation (Metaphone3, Cologne, etc.) | Names spelled differently but sound similar |

### Nearest Neighbor (kNN) Methods (More Thorough, Slower)

| Method | How It Works | Best For |
|--------|--------------|----------|
| **Levenshtein** | Count edit operations (insert, delete, substitute) | Short strings like usernames - catches 1-2 char differences |
| **PPM** | Compression-based similarity | Longer text strings |

### Performance Optimization: Blocking

For kNN methods, OpenRefine uses "blocking" to avoid O(n^2) comparisons:
- First pass: strings must share a 6-character substring
- Only then: compute expensive distance metrics

## OpenRefine UI Pattern

Their clustering dialog is interactive (not automatic):

1. **Shows suggested clusters** - groups of similar values
2. **User reviews each cluster** - checks "Merge?" boxes
3. **Pick canonical value** - most common, or type custom
4. **Actions:**
   - "Merge & Re-Cluster" - apply changes, find more
   - "Merge & Close" - apply and exit
   - "Close" - cancel without changes

Key insight: **OpenRefine suggests but doesn't auto-merge.** Human review prevents false positives.

## Relevant Algorithms for Starcounter

### For Uncategorized Posts

| Use Case | Suggested Method | Rationale |
|----------|-----------------|-----------|
| Case/whitespace variations | Fingerprint | Fast, zero false positives |
| Typos in movie/show titles | N-Gram (size 2) | Catches character swaps |
| Similar short titles | Levenshtein (radius 1-2) | "Alien" vs "Aliens" |

### For Mention Text vs Category Names

| Use Case | Suggested Method |
|----------|-----------------|
| Post says "hunt for red october" vs category "The Hunt for Red October" | Fingerprint normalization |
| Post says "Pulp Ficton" vs category "Pulp Fiction" | Levenshtein distance <= 1 |

## Proposed Implementation

### Phase 1: Fingerprint-Based Suggestions

1. When showing uncategorized posts, compute fingerprint for each post's text
2. Compute fingerprints for each existing category name
3. Suggest: "This post might be about [Category]" when fingerprints share tokens

### Phase 2: Fuzzy Matching

1. For uncategorized posts that don't match via fingerprint
2. Use Levenshtein with radius 2 against category names
3. Show suggestions with confidence scores

### Phase 3: Interactive Cluster Review (OpenRefine-style)

1. Group uncategorized posts by their text similarity
2. Show clusters in a modal: "These 5 posts seem similar"
3. Let user:
   - Assign entire cluster to existing category
   - Create new category from cluster
   - Dismiss cluster (leave as uncategorized)

## UI Design Notes

OpenRefine's dialog has:
- Histogram sliders to filter by cluster size / value length
- "Select All" / "Deselect All" for batch operations
- Export cluster data as JSON

For Starcounter, simpler approach:
- Show clusters sorted by size (biggest first = most impactful)
- One-click "Assign to [Category]" buttons
- Skip histogram filters initially

## Current Starcounter Architecture

### Why Posts Become Uncategorized

After reviewing [main.ts](../../../src/main.ts) and [mention-extractor.ts](../../../src/lib/mention-extractor.ts):

1. **Extraction failure** - Post doesn't match any pattern:
   - Quoted text: `"The Matrix"`
   - Title case: `The Hunt for Red October`
   - ALL CAPS: `TOP GUN: MAVERICK`
   - Rare words: `Ronin`, `Tenet`
   - Lowercase multi-word: `disco elysium`

2. **Validation rejection** - Mention extracted but TMDB/MusicBrainz says "not a real title"

3. **Matching failure** - Post text doesn't fuzzy-match any validated category's search terms

### Current Fuzzy Matching (main.ts)

```typescript
// Build search terms for each validated title
const allTitleSearchTerms = new Map<string, Set<string>>();
// ...includes normalizedTitle, original mentions, base title before colon

// For each post, find matching titles via word boundary regex
const textContainsTerm = (text: string, term: string): boolean => {
  const pattern = new RegExp(`\\b${term}\\b`, 'i');
  return pattern.test(text);
};
```

**Gap**: This misses typos, alternative spellings, and phonetic variants.

### Where Clustering Fits

**Input**: Uncategorized posts + existing validated categories

**Process**:
1. For each uncategorized post, compute similarity to each category name
2. Group posts by their best-matching category
3. Present clusters for user review: "These 5 posts might be about [Category]"

**Output**: User-approved assignments → update `manualAssignments` Map

### Integration Points

| Component | File | Integration |
|-----------|------|-------------|
| Uncategorized posts | [main.ts:497-500](../../../src/main.ts#L497-L500) | Source data |
| Manual assignments | [main.ts:61](../../../src/main.ts#L61) | Target for approved clusters |
| DrillDownModal | [components/](../../../src/components/) | Show cluster UI |
| Categories list | [main.ts:682-686](../../../src/main.ts#L682-L686) | `getAvailableCategories()` |

## Implementation Roadmap

### Phase 1: Fingerprint Matching (MVP)

New file: `src/lib/clustering.ts`

```typescript
// Fingerprint: normalize → tokenize → sort → join
function fingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')      // remove punctuation
    .split(/\s+/)                  // tokenize
    .filter(w => w.length > 0)
    .sort()
    .join(' ');
}

// Find best matching category for a post
function findBestMatch(
  postText: string,
  categories: string[]
): { category: string; confidence: number } | null {
  const postFp = fingerprint(postText);

  for (const category of categories) {
    const categoryFp = fingerprint(category);
    if (postFp.includes(categoryFp) || categoryFp.includes(postFp)) {
      return { category, confidence: 0.9 };
    }
  }
  return null;
}
```

### Phase 2: N-Gram Similarity

```typescript
// Extract n-grams from text
function ngrams(text: string, n: number = 2): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\w]/g, '');
  const grams = new Set<string>();
  for (let i = 0; i <= normalized.length - n; i++) {
    grams.add(normalized.slice(i, i + n));
  }
  return grams;
}

// Jaccard similarity between n-gram sets
function ngramSimilarity(a: string, b: string, n: number = 2): number {
  const gramsA = ngrams(a, n);
  const gramsB = ngrams(b, n);

  const intersection = new Set([...gramsA].filter(g => gramsB.has(g)));
  const union = new Set([...gramsA, ...gramsB]);

  return intersection.size / union.size;
}
```

### Phase 3: Edit Distance (Levenshtein)

```typescript
// Classic Levenshtein - good for short strings
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i-1][j] + 1,      // deletion
        matrix[i][j-1] + 1,      // insertion
        matrix[i-1][j-1] + cost  // substitution
      );
    }
  }

  return matrix[a.length][b.length];
}

// Normalized similarity (0-1)
function editSimilarity(a: string, b: string): number {
  const distance = levenshtein(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);
  return 1 - (distance / maxLen);
}
```

### Phase 4: Cluster UI Component

New component: `ClusterReviewModal`

```typescript
type ClusterSuggestion = {
  posts: PostView[];
  suggestedCategory: string;
  confidence: number;
  method: 'fingerprint' | 'ngram' | 'levenshtein';
};

// Show suggestions sorted by cluster size × confidence
// User can: Accept (assign all) | Review (see posts) | Dismiss
```

## Sources

- [OpenRefine Clustering Methods In-depth](https://openrefine.org/docs/technical-reference/clustering-in-depth)
- [OpenRefine Cell Editing Documentation](https://openrefine.org/docs/manual/cellediting)
- [Library Carpentry: OpenRefine Clustering](https://librarycarpentry.github.io/lc-open-refine/05-clustering.html)
- [OpenRefine Clustering Dialog Source](https://github.com/OpenRefine/OpenRefine/blob/master/main/webapp/modules/core/scripts/dialogs/clustering-dialog.js)
- [N-Gram Fingerprint JS Implementation](https://github.com/finnp/ngram-fingerprint)
