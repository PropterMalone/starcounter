# Starcounter: Bluesky Post Analyzer Implementation Plan - Phase 4

**Goal:** Count mentions intelligently with thread-awareness and agreement detection

**Architecture:** Smart counting algorithm with sentiment analysis, tracks mention novelty within branches, aggregates by agreement/disagreement

**Tech Stack:** TypeScript, Sentiment.js library with custom keywords, comparative scoring for classification

**Scope:** Phase 4 of 8 phases from original design

**Codebase verified:** 2026-02-04 (Phase 3 provides thread builder and mention extractor)

---

## Phase Overview

This phase implements intelligent mention counting that respects thread context. It uses sentiment analysis (Sentiment.js) to detect agreement vs. disagreement in replies, tracks novelty of mentions within conversation branches to avoid double-counting, and aggregates results based on whether a reply agrees with or disputes a previous mention.

**Counting rules:**
1. **Novel mention**: First occurrence in a branch → count +1
2. **Agreement reply**: Positive sentiment + mention exists in parent → count +1
3. **Disagreement reply**: Negative sentiment + mention exists in parent → count +0
4. **Same author re-mention**: Same DID mentions again in same branch → count +0
5. **Separate branches**: Independent counting across different conversation threads

**Sentiment thresholds:**
- Positive: comparative ≥ 0.05
- Neutral: -0.05 < comparative < 0.05
- Negative: comparative ≤ -0.05

**Testing:** Comprehensive scenarios for all counting rules, edge cases, 95% coverage target

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Write sentiment analyzer test (TDD)

**Files:**
- Create: `src/lib/sentiment-analyzer.test.ts`

**Step 1: Write failing test for sentiment analyzer**

```typescript
import { describe, it, expect } from 'vitest';
import { SentimentAnalyzer } from './sentiment-analyzer';

describe('SentimentAnalyzer', () => {
  const analyzer = new SentimentAnalyzer();

  describe('analyze', () => {
    it('should detect positive sentiment', () => {
      const result = analyzer.analyze('I totally agree! This is amazing.');

      expect(result.classification).toBe('Positive');
      expect(result.comparative).toBeGreaterThan(0.05);
    });

    it('should detect negative sentiment', () => {
      const result = analyzer.analyze('I completely disagree. This is terrible.');

      expect(result.classification).toBe('Negative');
      expect(result.comparative).toBeLessThan(-0.05);
    });

    it('should detect neutral sentiment', () => {
      const result = analyzer.analyze('The chair is in the room.');

      expect(result.classification).toBe('Neutral');
      expect(Math.abs(result.comparative)).toBeLessThan(0.05);
    });

    it('should detect agreement keywords', () => {
      const texts = [
        'I agree with that',
        'Exactly!',
        'Yes, absolutely',
        'You are correct',
        'Indeed, very true',
      ];

      texts.forEach((text) => {
        const result = analyzer.analyze(text);
        expect(result.classification).toBe('Positive');
      });
    });

    it('should detect disagreement keywords', () => {
      const texts = [
        'I disagree',
        'No, that is wrong',
        'Actually, you are incorrect',
        'Hard disagree',
        'Nope',
      ];

      texts.forEach((text) => {
        const result = analyzer.analyze(text);
        expect(result.classification).toBe('Negative');
      });
    });

    it('should return strength indicator', () => {
      const strongPositive = analyzer.analyze('Absolutely amazing! I love it!');
      const weakPositive = analyzer.analyze('I think it is nice');

      expect(strongPositive.strength).toBe('Strong');
      expect(weakPositive.strength).toBe('Moderate');
    });
  });

  describe('isAgreement', () => {
    it('should identify agreement', () => {
      expect(analyzer.isAgreement('I agree with that')).toBe(true);
      expect(analyzer.isAgreement('Exactly! So true.')).toBe(true);
    });

    it('should identify disagreement', () => {
      expect(analyzer.isAgreement('I disagree')).toBe(false);
      expect(analyzer.isAgreement('No, that is wrong')).toBe(false);
    });

    it('should treat neutral as non-agreement', () => {
      expect(analyzer.isAgreement('The sky is blue')).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test src/lib/sentiment-analyzer.test.ts`

Expected: Test fails with "Cannot find module './sentiment-analyzer'"

**Step 3: Commit**

```bash
git add src/lib/sentiment-analyzer.test.ts
git commit -m "test: add sentiment analyzer tests (TDD - failing)

- Positive/negative/neutral detection
- Agreement/disagreement keyword detection
- Strength classification (strong/moderate/weak)
- isAgreement helper for counting logic

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement sentiment analyzer

**Files:**
- Create: `src/lib/sentiment-analyzer.ts`

**Step 1: Write sentiment analyzer implementation**

```typescript
import Sentiment = require('sentiment');

export interface SentimentResult {
  score: number;
  comparative: number;
  classification: 'Positive' | 'Negative' | 'Neutral';
  strength: 'Strong' | 'Moderate' | 'Weak';
  positiveWords: string[];
  negativeWords: string[];
}

const CUSTOM_WORDS = {
  // Agreement keywords (positive)
  'agree': 3,
  'agreed': 3,
  'agreeing': 3,
  'exactly': 2,
  'absolutely': 3,
  'yes': 2,
  'correct': 2,
  'right': 2,
  'indeed': 2,
  'definitely': 2,
  'surely': 2,
  'true': 2,

  // Disagreement keywords (negative)
  'disagree': -3,
  'disagreed': -3,
  'disagreeing': -3,
  'no': -1,
  'nope': -2,
  'wrong': -2,
  'incorrect': -2,
  'actually': -1,
  'however': -1,
  'but': -1,
};

/**
 * Sentiment analyzer using Sentiment.js with custom agreement/disagreement keywords
 */
export class SentimentAnalyzer {
  private sentiment: Sentiment;

  constructor() {
    this.sentiment = new Sentiment();
  }

  /**
   * Analyze text for sentiment
   * Returns classification, score, and strength
   */
  analyze(text: string): SentimentResult {
    const result = this.sentiment.analyze(text, { extras: CUSTOM_WORDS });

    // Classify based on comparative score
    let classification: 'Positive' | 'Negative' | 'Neutral';
    if (result.comparative >= 0.05) {
      classification = 'Positive';
    } else if (result.comparative <= -0.05) {
      classification = 'Negative';
    } else {
      classification = 'Neutral';
    }

    // Determine strength
    const absComparative = Math.abs(result.comparative);
    let strength: 'Strong' | 'Moderate' | 'Weak';
    if (absComparative > 0.5) {
      strength = 'Strong';
    } else if (absComparative > 0.05) {
      strength = 'Moderate';
    } else {
      strength = 'Weak';
    }

    return {
      score: result.score,
      comparative: result.comparative,
      classification,
      strength,
      positiveWords: result.positive,
      negativeWords: result.negative,
    };
  }

  /**
   * Helper: Check if text expresses agreement
   * Returns true for positive sentiment, false for negative or neutral
   */
  isAgreement(text: string): boolean {
    const result = this.analyze(text);
    return result.classification === 'Positive';
  }
}
```

**Step 2: Run test to verify it passes**

Run: `npm test src/lib/sentiment-analyzer.test.ts`

Expected: All tests pass

**Step 3: Commit**

```bash
git add src/lib/sentiment-analyzer.ts
git commit -m "feat: implement sentiment analyzer with Sentiment.js

- Custom agreement/disagreement keywords
- Comparative score thresholds (±0.05)
- Strength classification (strong/moderate/weak)
- isAgreement helper for counting logic
- All tests passing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Verify sentiment analyzer coverage

**Files:**
- Verify: `src/lib/sentiment-analyzer.test.ts` and `src/lib/sentiment-analyzer.ts`

**Step 1: Run coverage check**

Run: `npm run test:coverage -- src/lib/sentiment-analyzer`

Expected: Coverage ≥95%

**Step 2: Add edge case tests if needed**

Common gaps:
- Empty string input
- Very long text
- Text with only neutral words
- Mixed sentiment (positive and negative words)

**Step 3: Commit if tests were added**

If needed:

```bash
git add src/lib/sentiment-analyzer.test.ts
git commit -m "test: increase sentiment analyzer coverage to 95%+

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) -->
<!-- START_TASK_4 -->
### Task 4: Write counter test (TDD)

**Files:**
- Create: `src/lib/counter.test.ts`

**Step 1: Write failing test for smart counter**

```typescript
import { describe, it, expect } from 'vitest';
import { MentionCounter } from './counter';
import type { PostView, ThreadTree } from '../types';
import type { MediaMention } from './mention-extractor';

describe('MentionCounter', () => {
  const counter = new MentionCounter();

  const createPost = (uri: string, author: string, text: string): PostView => ({
    uri,
    cid: `cid_${uri}`,
    author: { did: author, handle: `${author}.bsky.social` },
    record: { text, createdAt: new Date().toISOString() },
    indexedAt: new Date().toISOString(),
  });

  describe('countMentions', () => {
    it('should count novel mentions', () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [createPost('post1', 'user1', 'I watched The Matrix')];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: () => null,
        getBranchAuthors: () => ['user1'],
      };

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(1);
    });

    it('should count agreement replies', () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [
        createPost('post1', 'user1', 'I watched The Matrix'),
        createPost('post2', 'user2', 'I totally agree! The Matrix is amazing.'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: (uri) => (uri === 'post2' ? 'post1' : null),
        getBranchAuthors: (uri) => (uri === 'post2' ? ['user1', 'user2'] : ['user1']),
      };

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(2); // Original + agreement
    });

    it('should not count disagreement replies', () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [
        createPost('post1', 'user1', 'I watched The Matrix'),
        createPost('post2', 'user2', 'I disagree. The Matrix was not good.'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: (uri) => (uri === 'post2' ? 'post1' : null),
        getBranchAuthors: (uri) => (uri === 'post2' ? ['user1', 'user2'] : ['user1']),
      };

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(1); // Only original, disagreement not counted
    });

    it('should not count same author re-mentions in same branch', () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [
        createPost('post1', 'user1', 'I watched The Matrix'),
        createPost('post2', 'user1', 'The Matrix is still my favorite'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: (uri) => (uri === 'post2' ? 'post1' : null),
        getBranchAuthors: (uri) => ['user1'],
      };

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(1); // Same author, same branch
    });

    it('should count separately across different branches', () => {
      const mentions: MediaMention[] = [
        {
          title: 'The Matrix',
          normalizedTitle: 'matrix',
          mediaType: 'MOVIE',
          confidence: 'high',
        },
      ];

      const posts: PostView[] = [
        createPost('root', 'user1', 'What movie?'),
        createPost('branch1', 'user2', 'The Matrix'),
        createPost('branch2', 'user3', 'The Matrix'),
      ];

      const tree: Partial<ThreadTree> = {
        allPosts: posts,
        getParent: (uri) => (uri === 'branch1' || uri === 'branch2' ? 'root' : null),
        getBranchAuthors: (uri) => {
          if (uri === 'branch1') return ['user1', 'user2'];
          if (uri === 'branch2') return ['user1', 'user3'];
          return ['user1'];
        },
      };

      const counts = counter.countMentions(mentions, posts, tree as ThreadTree);

      expect(counts.get('matrix')).toBe(2); // Both branches count separately
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test src/lib/counter.test.ts`

Expected: Test fails with "Cannot find module './counter'"

**Step 3: Commit**

```bash
git add src/lib/counter.test.ts
git commit -m "test: add mention counter tests (TDD - failing)

- Novel mention counting
- Agreement reply counting (+1)
- Disagreement reply counting (+0)
- Same author re-mention prevention
- Separate branch independence

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Implement smart counter

**Files:**
- Create: `src/lib/counter.ts`

**Step 1: Write counter implementation**

```typescript
import type { PostView, ThreadTree, Did } from '../types';
import type { MediaMention } from './mention-extractor';
import { SentimentAnalyzer } from './sentiment-analyzer';

export interface MentionCount {
  title: string;
  count: number;
  posts: PostView[]; // Posts that contributed to count
}

/**
 * Smart mention counter with thread-awareness and sentiment analysis
 */
export class MentionCounter {
  private sentimentAnalyzer: SentimentAnalyzer;

  constructor() {
    this.sentimentAnalyzer = new SentimentAnalyzer();
  }

  /**
   * Count mentions across posts with smart rules:
   * - Novel mentions: +1
   * - Agreement replies with mention: +1
   * - Disagreement replies: +0
   * - Same author re-mention in branch: +0
   * - Separate branches: independent counting
   */
  countMentions(
    mentions: MediaMention[],
    posts: PostView[],
    tree: ThreadTree
  ): Map<string, number> {
    const counts = new Map<string, number>();

    // Track which authors have mentioned each title in each branch
    const branchMentions = new Map<string, Map<string, Set<Did>>>();

    for (const post of posts) {
      const postMentions = this.extractMentionsFromPost(post, mentions);

      for (const mention of postMentions) {
        const normalized = mention.normalizedTitle;

        // Get branch root (top-most ancestor)
        const branchRoot = this.getBranchRoot(post.uri, tree);

        // Initialize branch tracking
        if (!branchMentions.has(branchRoot)) {
          branchMentions.set(branchRoot, new Map());
        }
        const branchMap = branchMentions.get(branchRoot)!;

        if (!branchMap.has(normalized)) {
          branchMap.set(normalized, new Set());
        }
        const authorsWhoMentioned = branchMap.get(normalized)!;

        // Rule 1: Same author already mentioned in this branch → skip
        if (authorsWhoMentioned.has(post.author.did)) {
          continue;
        }

        // Rule 2: Check if this is a reply with sentiment
        const parent = tree.getParent(post.uri);
        if (parent) {
          // Get parent post
          const parentPost = tree.allPosts.find((p) => p.uri === parent);
          if (parentPost) {
            const parentMentions = this.extractMentionsFromPost(parentPost, mentions);
            const parentHasMention = parentMentions.some(
              (m) => m.normalizedTitle === normalized
            );

            if (parentHasMention) {
              // Parent mentioned it, check sentiment of current post
              const isAgreement = this.sentimentAnalyzer.isAgreement(post.record.text);

              if (!isAgreement) {
                // Disagreement → don't count
                continue;
              }
              // Agreement → count below
            }
          }
        }

        // Count this mention
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
        authorsWhoMentioned.add(post.author.did);
      }
    }

    return counts;
  }

  /**
   * Extract mentions from a single post
   */
  private extractMentionsFromPost(
    post: PostView,
    allMentions: MediaMention[]
  ): MediaMention[] {
    return allMentions.filter((mention) => {
      const text = post.record.text.toLowerCase();
      return text.includes(mention.normalizedTitle);
    });
  }

  /**
   * Get the branch root (top-most post in the branch)
   */
  private getBranchRoot(uri: string, tree: ThreadTree): string {
    let current = uri;
    let parent = tree.getParent(current);

    while (parent) {
      current = parent;
      parent = tree.getParent(current);
    }

    return current;
  }
}
```

**Step 2: Run test to verify it passes**

Run: `npm test src/lib/counter.test.ts`

Expected: All tests pass

**Step 3: Commit**

```bash
git add src/lib/counter.ts
git commit -m "feat: implement smart mention counter

- Novel mention detection (+1)
- Agreement reply counting with sentiment (+1)
- Disagreement reply filtering (+0)
- Same author prevention in branches
- Branch-aware tracking with normalized titles
- All tests passing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Verify counter coverage and update lib exports

**Files:**
- Verify: `src/lib/counter.test.ts` and `src/lib/counter.ts`
- Modify: `src/lib/index.ts`

**Step 1: Run coverage check**

Run: `npm run test:coverage -- src/lib/counter`

Expected: Coverage ≥95%

**Step 2: Update barrel exports**

Add to `src/lib/index.ts`:

```typescript
export { SentimentAnalyzer } from './sentiment-analyzer';
export type { SentimentResult } from './sentiment-analyzer';
export { MentionCounter } from './counter';
export type { MentionCount } from './counter';
```

**Step 3: Run full Phase 4 tests**

Run: `npm test src/lib/`

Expected: All lib tests pass (including new sentiment + counter tests)

**Step 4: Commit**

```bash
git add src/lib/index.ts
git commit -m "feat: add sentiment analyzer and counter to exports

- Export SentimentAnalyzer and SentimentResult
- Export MentionCounter and MentionCount
- Complete Phase 4 public API

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_B -->

---

## Phase 4 Complete

**Deliverables:**
- ✓ src/lib/sentiment-analyzer.ts with Sentiment.js integration and custom keywords
- ✓ src/lib/sentiment-analyzer.test.ts with agreement/disagreement tests (95%+ coverage)
- ✓ src/lib/counter.ts with smart counting algorithm
- ✓ src/lib/counter.test.ts with all counting rule scenarios (95%+ coverage)
- ✓ Updated src/lib/index.ts with new exports
- ✓ All tests passing
- ✓ 95%+ coverage achieved

**Verification:**
- `npm test src/lib/` passes all tests including sentiment and counter
- `npm run test:coverage -- src/lib/` shows ≥95% coverage
- `npm run validate` passes

**Next Phase:** Phase 5 will implement serverless validation function for fuzzy-matching mentions against TMDB and MusicBrainz APIs
