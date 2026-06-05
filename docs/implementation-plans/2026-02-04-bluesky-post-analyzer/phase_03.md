# Starcounter: Bluesky Post Analyzer Implementation Plan - Phase 3

**Goal:** Parse thread structure and extract media mentions from text

**Architecture:** Thread tree builder with parent/child relationships, regex-based mention extractor with context classification, auto-detecting prompt type from root post

**Tech Stack:** TypeScript, regex patterns for quoted text and title case, context-based media type classification

**Scope:** Phase 3 of 8 phases from original design

**Codebase verified:** 2026-02-04 (Phase 2 provides types.ts and API client)

---

## Phase Overview

This phase implements thread tree construction from flat post lists and media mention extraction from natural language. The thread builder creates parent/child relationships and identifies conversation branches. The mention extractor uses regex patterns (quoted text + title case) combined with context keywords to extract movies, TV shows, and music mentions. The prompt detector auto-identifies the type of media being discussed based on the root post text.

**Extraction approach:**
1. **Quoted text** (high confidence): `"The Matrix"` format
2. **Title case** (medium confidence): Multi-word proper nouns
3. **Context classification**: Keywords like "watched", "listening", "episode"

**Testing:** Property-based tests for extraction edge cases, comprehensive unit tests, 95% coverage target

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Write thread builder test (TDD)

**Files:**
- Create: `src/lib/thread-builder.test.ts`

**Step 1: Create src/lib directory**

Run: `mkdir -p src/lib`

**Step 2: Write failing test for thread builder**

```typescript
import { describe, it, expect } from 'vitest';
import { ThreadBuilder } from './thread-builder';
import type { ThreadViewPost, PostView, NotFoundPost } from '../types';

describe('ThreadBuilder', () => {
  const createMockPost = (uri: string, text: string, replyTo?: string): PostView => ({
    uri,
    cid: `cid_${uri}`,
    author: {
      did: 'did:plc:test',
      handle: 'test.bsky.social',
    },
    record: {
      text,
      createdAt: new Date().toISOString(),
      ...(replyTo && {
        reply: {
          root: { uri: 'root_uri', cid: 'root_cid' },
          parent: { uri: replyTo, cid: `cid_${replyTo}` },
        },
      }),
    },
    indexedAt: new Date().toISOString(),
  });

  describe('buildTree', () => {
    it('should handle single post with no replies', () => {
      const rootPost: ThreadViewPost = {
        post: createMockPost('post1', 'Root post'),
      };

      const builder = new ThreadBuilder();
      const tree = builder.buildTree(rootPost);

      expect(tree.post.uri).toBe('post1');
      expect(tree.branches).toHaveLength(0);
      expect(tree.allPosts).toHaveLength(1);
    });

    it('should build tree with direct replies', () => {
      const rootPost: ThreadViewPost = {
        post: createMockPost('post1', 'Root post'),
        replies: [
          {
            post: createMockPost('post2', 'Reply 1', 'post1'),
          },
          {
            post: createMockPost('post3', 'Reply 2', 'post1'),
          },
        ],
      };

      const builder = new ThreadBuilder();
      const tree = builder.buildTree(rootPost);

      expect(tree.post.uri).toBe('post1');
      expect(tree.branches).toHaveLength(2);
      expect(tree.allPosts).toHaveLength(3);
      expect(tree.branches[0].post.uri).toBe('post2');
      expect(tree.branches[1].post.uri).toBe('post3');
    });

    it('should build tree with nested replies', () => {
      const rootPost: ThreadViewPost = {
        post: createMockPost('post1', 'Root post'),
        replies: [
          {
            post: createMockPost('post2', 'Reply 1', 'post1'),
            replies: [
              {
                post: createMockPost('post3', 'Nested reply', 'post2'),
              },
            ],
          },
        ],
      };

      const builder = new ThreadBuilder();
      const tree = builder.buildTree(rootPost);

      expect(tree.allPosts).toHaveLength(3);
      expect(tree.branches).toHaveLength(1);
      expect(tree.branches[0].branches).toHaveLength(1);
      expect(tree.branches[0].branches[0].post.uri).toBe('post3');
    });

    it('should handle NotFoundPost nodes', () => {
      const notFound: NotFoundPost = {
        uri: 'deleted_post',
        notFound: true,
      };

      const rootPost: ThreadViewPost = {
        post: createMockPost('post1', 'Root post'),
        replies: [notFound],
      };

      const builder = new ThreadBuilder();
      const tree = builder.buildTree(rootPost);

      expect(tree.allPosts).toHaveLength(1); // Only root, not NotFound
      expect(tree.branches).toHaveLength(0);
    });

    it('should track parent-child relationships', () => {
      const rootPost: ThreadViewPost = {
        post: createMockPost('post1', 'Root'),
        replies: [
          {
            post: createMockPost('post2', 'Reply', 'post1'),
          },
        ],
      };

      const builder = new ThreadBuilder();
      const tree = builder.buildTree(rootPost);

      expect(tree.getParent('post2')).toBe('post1');
      expect(tree.getParent('post1')).toBeNull();
    });

    it('should identify branch authors', () => {
      const rootPost: ThreadViewPost = {
        post: {
          ...createMockPost('post1', 'Root'),
          author: { did: 'did:user1', handle: 'user1.bsky.social' },
        },
        replies: [
          {
            post: {
              ...createMockPost('post2', 'Reply', 'post1'),
              author: { did: 'did:user2', handle: 'user2.bsky.social' },
            },
          },
        ],
      };

      const builder = new ThreadBuilder();
      const tree = builder.buildTree(rootPost);

      const authors = tree.getBranchAuthors('post2');
      expect(authors).toContain('did:user1');
      expect(authors).toContain('did:user2');
    });
  });

  describe('flattenPosts', () => {
    it('should flatten nested tree to post list', () => {
      const rootPost: ThreadViewPost = {
        post: createMockPost('post1', 'Root'),
        replies: [
          {
            post: createMockPost('post2', 'Reply', 'post1'),
            replies: [
              {
                post: createMockPost('post3', 'Nested', 'post2'),
              },
            ],
          },
        ],
      };

      const builder = new ThreadBuilder();
      const tree = builder.buildTree(rootPost);
      const flattened = tree.flattenPosts();

      expect(flattened).toHaveLength(3);
      expect(flattened.map((p) => p.uri)).toEqual(['post1', 'post2', 'post3']);
    });
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npm test src/lib/thread-builder.test.ts`

Expected: Test fails with "Cannot find module './thread-builder'"

**Step 4: Commit**

```bash
git add src/lib/thread-builder.test.ts
git commit -m "test: add thread builder tests (TDD - failing)

- Build tree from ThreadViewPost structure
- Handle direct and nested replies
- Track parent-child relationships
- Identify branch authors
- Filter NotFoundPost nodes
- Flatten tree to post list

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement thread builder

**Files:**
- Create: `src/lib/thread-builder.ts`

**Step 1: Write thread builder implementation**

```typescript
import type { ThreadViewPost, PostView, NotFoundPost, BlockedPost, Did } from '../types';

/**
 * Check if node is a valid post (not NotFound or Blocked)
 */
function isPostView(
  node: ThreadViewPost | NotFoundPost | BlockedPost
): node is ThreadViewPost {
  return 'post' in node && !('notFound' in node) && !('blocked' in node);
}

/**
 * Thread tree structure with parent/child relationships
 */
export interface ThreadTree {
  post: PostView;
  branches: ThreadTree[];
  allPosts: PostView[];
  getParent(uri: string): string | null;
  getBranchAuthors(uri: string): Did[];
  flattenPosts(): PostView[];
}

/**
 * Builds thread tree structure from flat post list
 * Identifies branches and parent/child relationships
 */
export class ThreadBuilder {
  private parentMap: Map<string, string> = new Map();
  private allPostsList: PostView[] = [];

  /**
   * Build tree from ThreadViewPost response
   * Filters out NotFoundPost and BlockedPost nodes
   */
  buildTree(root: ThreadViewPost | NotFoundPost | BlockedPost): ThreadTree {
    this.parentMap = new Map();
    this.allPostsList = [];

    // Handle NotFound/Blocked root
    if (!isPostView(root)) {
      throw new Error('Root post is not available (deleted or blocked)');
    }

    const tree = this.buildTreeRecursive(root);

    return {
      ...tree,
      allPosts: this.allPostsList,
      getParent: (uri: string) => this.parentMap.get(uri) ?? null,
      getBranchAuthors: (uri: string) => this.collectBranchAuthors(uri),
      flattenPosts: () => this.flattenPostsRecursive(tree),
    };
  }

  /**
   * Recursive tree builder
   */
  private buildTreeRecursive(node: ThreadViewPost): { post: PostView; branches: ThreadTree[] } {
    const post = node.post;

    // Add to flat list
    this.allPostsList.push(post);

    // Track parent relationship
    if (post.record.reply?.parent) {
      this.parentMap.set(post.uri, post.record.reply.parent.uri);
    }

    // Build child branches
    const branches: ThreadTree[] = [];

    if (node.replies) {
      for (const reply of node.replies) {
        // Skip NotFound and Blocked posts
        if (!isPostView(reply)) {
          continue;
        }

        const childTree = this.buildTreeRecursive(reply);
        branches.push({
          ...childTree,
          allPosts: this.allPostsList,
          getParent: (uri: string) => this.parentMap.get(uri) ?? null,
          getBranchAuthors: (uri: string) => this.collectBranchAuthors(uri),
          flattenPosts: () => this.flattenPostsRecursive(childTree),
        });
      }
    }

    return { post, branches };
  }

  /**
   * Collect all author DIDs in a branch (from post up to root)
   */
  private collectBranchAuthors(uri: string): Did[] {
    const authors: Did[] = [];
    const seen = new Set<Did>();

    // Walk up to root
    let currentUri: string | null = uri;
    while (currentUri) {
      const post = this.allPostsList.find((p) => p.uri === currentUri);
      if (post && !seen.has(post.author.did)) {
        authors.push(post.author.did);
        seen.add(post.author.did);
      }
      currentUri = this.parentMap.get(currentUri) ?? null;
    }

    return authors;
  }

  /**
   * Flatten tree to post list (depth-first)
   */
  private flattenPostsRecursive(tree: { post: PostView; branches: ThreadTree[] }): PostView[] {
    const posts: PostView[] = [tree.post];

    for (const branch of tree.branches) {
      posts.push(...this.flattenPostsRecursive(branch));
    }

    return posts;
  }
}
```

**Step 2: Run test to verify it passes**

Run: `npm test src/lib/thread-builder.test.ts`

Expected: All tests pass

**Step 3: Commit**

```bash
git add src/lib/thread-builder.ts
git commit -m "feat: implement thread tree builder

- Recursive tree construction from ThreadViewPost
- Parent-child relationship tracking via Map
- Branch author collection (all DIDs in thread path)
- Filters NotFoundPost and BlockedPost nodes
- Flatten tree to post list for iteration
- All tests passing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Verify thread builder coverage

**Files:**
- Verify: `src/lib/thread-builder.test.ts` and `src/lib/thread-builder.ts`

**Step 1: Run coverage check**

Run: `npm run test:coverage -- src/lib/thread-builder`

Expected: Coverage ≥95% for thread-builder.ts

**Step 2: Add edge case tests if needed**

Common gaps to cover:
- Empty replies array
- Very deep nesting (10+ levels)
- Multiple authors in same branch
- Circular references (shouldn't happen but test robustness)

**Step 3: Commit if tests were added**

If additional tests were needed:

```bash
git add src/lib/thread-builder.test.ts
git commit -m "test: increase thread builder coverage to 95%+

- Add edge case tests
- Ensure all branches covered

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

Otherwise: No commit needed
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) -->
<!-- START_TASK_4 -->
### Task 4: Write mention extractor test (TDD)

**Files:**
- Create: `src/lib/mention-extractor.test.ts`

**Step 1: Write failing test for mention extractor**

```typescript
import { describe, it, expect } from 'vitest';
import { MentionExtractor, MediaType } from './mention-extractor';

describe('MentionExtractor', () => {
  const extractor = new MentionExtractor();

  describe('extractMentions', () => {
    describe('quoted text extraction', () => {
      it('should extract quoted movie titles', () => {
        const text = 'I watched "The Matrix" last night';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(1);
        expect(mentions[0].title).toBe('The Matrix');
        expect(mentions[0].mediaType).toBe(MediaType.MOVIE);
        expect(mentions[0].confidence).toBe('high');
      });

      it('should extract multiple quoted titles', () => {
        const text = 'I loved "The Matrix" and "Inception"';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(2);
        expect(mentions.map((m) => m.title)).toContain('The Matrix');
        expect(mentions.map((m) => m.title)).toContain('Inception');
      });

      it('should handle escaped quotes', () => {
        const text = 'The movie "O Brother, Where Art Thou?" was great';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(1);
        expect(mentions[0].title).toBe('O Brother, Where Art Thou?');
      });
    });

    describe('title case extraction', () => {
      it('should extract title case movie titles', () => {
        const text = 'I watched The Dark Knight yesterday';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(1);
        expect(mentions[0].title).toBe('The Dark Knight');
        expect(mentions[0].confidence).toBe('medium');
      });

      it('should handle single-word titles', () => {
        const text = 'Have you seen Inception?';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(1);
        expect(mentions[0].title).toBe('Inception');
      });

      it('should not extract common phrases', () => {
        const text = 'I said Hello World to my friend';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(0);
      });
    });

    describe('context-based classification', () => {
      it('should detect movie context', () => {
        const text = 'I watched The Matrix last night';
        const mentions = extractor.extractMentions(text);

        expect(mentions[0].mediaType).toBe(MediaType.MOVIE);
      });

      it('should detect TV show context', () => {
        const text = 'Watching Breaking Bad episode 5';
        const mentions = extractor.extractMentions(text);

        expect(mentions[0].mediaType).toBe(MediaType.TV_SHOW);
      });

      it('should detect music context', () => {
        const text = 'Listening to Bohemian Rhapsody by Queen';
        const mentions = extractor.extractMentions(text);

        expect(mentions[0].mediaType).toBe(MediaType.MUSIC);
      });

      it('should default to provided media type when context unclear', () => {
        const text = 'The Matrix is great';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions[0].mediaType).toBe(MediaType.MOVIE);
      });
    });

    describe('edge cases', () => {
      it('should handle possessives', () => {
        const text = '"The Matrix"\'s ending was mind-blowing';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions[0].title).toBe('The Matrix');
      });

      it('should handle punctuation in titles', () => {
        const text = '"Don\'t Look Now" is a classic';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions[0].title).toBe("Don't Look Now");
      });

      it('should normalize leading articles', () => {
        const mention1 = extractor.extractMentions('"The Matrix"', MediaType.MOVIE)[0];
        const mention2 = extractor.extractMentions('"Matrix"', MediaType.MOVIE)[0];

        expect(mention1.normalizedTitle).toBe(mention2.normalizedTitle);
      });

      it('should filter very short titles', () => {
        const text = 'I said "Hi" to them';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions).toHaveLength(0);
      });

      it('should handle numbers in titles', () => {
        const text = '"2001: A Space Odyssey" is brilliant';
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        expect(mentions[0].title).toBe('2001: A Space Odyssey');
      });
    });

    describe('music-specific patterns', () => {
      it('should extract song with artist', () => {
        const text = 'Listening to "Bohemian Rhapsody" by Queen';
        const mentions = extractor.extractMentions(text, MediaType.MUSIC);

        expect(mentions[0].title).toBe('Bohemian Rhapsody');
        expect(mentions[0].artist).toBe('Queen');
      });

      it('should handle featured artists', () => {
        const text = '"Song Name" by Artist feat. Featured Artist';
        const mentions = extractor.extractMentions(text, MediaType.MUSIC);

        expect(mentions[0].artist).toBe('Artist feat. Featured Artist');
      });
    });
  });

  describe('normalization', () => {
    it('should normalize titles for matching', () => {
      expect(extractor.normalizeTitle('The Matrix')).toBe('matrix');
      expect(extractor.normalizeTitle('A Star Is Born')).toBe('star is born');
      expect(extractor.normalizeTitle('An Unexpected Journey')).toBe('unexpected journey');
    });

    it('should handle titles without articles', () => {
      expect(extractor.normalizeTitle('Inception')).toBe('inception');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test src/lib/mention-extractor.test.ts`

Expected: Test fails with "Cannot find module './mention-extractor'"

**Step 3: Commit**

```bash
git add src/lib/mention-extractor.test.ts
git commit -m "test: add mention extractor tests (TDD - failing)

- Quoted text extraction (high confidence)
- Title case extraction (medium confidence)
- Context-based media type classification
- Edge cases: possessives, punctuation, articles
- Music-specific artist extraction
- Title normalization for matching

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Implement mention extractor

**Files:**
- Create: `src/lib/mention-extractor.ts`

**Step 1: Write mention extractor implementation**

```typescript
export enum MediaType {
  MOVIE = 'MOVIE',
  TV_SHOW = 'TV_SHOW',
  MUSIC = 'MUSIC',
  UNKNOWN = 'UNKNOWN',
}

export interface MediaMention {
  title: string;
  normalizedTitle: string;
  mediaType: MediaType;
  confidence: 'high' | 'medium' | 'low';
  artist?: string; // For music
  context?: string; // Surrounding text for debugging
}

const MOVIE_KEYWORDS = ['watched', 'saw', 'film', 'cinema', 'theater', 'theatre', 'movie'];
const TV_KEYWORDS = [
  'watching',
  'episode',
  'season',
  'series',
  'binge',
  'show',
  'tv',
];
const MUSIC_KEYWORDS = [
  'listening',
  'heard',
  'song',
  'album',
  'artist',
  'track',
  'music',
  'playing',
];

const NOISE_WORDS = new Set([
  'yes',
  'no',
  'okay',
  'ok',
  'hello',
  'hi',
  'hey',
  'thanks',
  'thank you',
  'please',
]);

/**
 * Extracts media mentions from natural language text
 * Uses regex patterns + context keywords for classification
 */
export class MentionExtractor {
  /**
   * Extract media mentions from text
   * @param text - Post text to analyze
   * @param defaultMediaType - Media type to use when context is unclear
   */
  extractMentions(text: string, defaultMediaType?: MediaType): MediaMention[] {
    const mentions: MediaMention[] = [];

    // Strategy 1: Quoted text (high confidence)
    const quotedMentions = this.extractQuoted(text, defaultMediaType);
    mentions.push(...quotedMentions);

    // Strategy 2: Title case (medium confidence)
    const titleCaseMentions = this.extractTitleCase(text, defaultMediaType);
    mentions.push(...titleCaseMentions);

    // Deduplicate by normalized title
    const seen = new Set<string>();
    return mentions.filter((mention) => {
      if (seen.has(mention.normalizedTitle)) {
        return false;
      }
      seen.add(mention.normalizedTitle);
      return true;
    });
  }

  /**
   * Normalize title for matching (remove leading articles, lowercase)
   */
  normalizeTitle(title: string): string {
    const articles = ['the', 'a', 'an'];
    const words = title.toLowerCase().split(/\s+/);

    if (words.length > 1 && articles.includes(words[0])) {
      return words.slice(1).join(' ');
    }

    return title.toLowerCase();
  }

  /**
   * Extract quoted text (high confidence)
   */
  private extractQuoted(text: string, defaultMediaType?: MediaType): MediaMention[] {
    const mentions: MediaMention[] = [];

    // Regex: quoted text with optional trailing possessive
    const quotedPattern = /"((?:\\.|[^"\\])*)"/g;
    let match;

    while ((match = quotedPattern.exec(text)) !== null) {
      const title = match[1].trim();

      // Validate title
      if (!this.isValidTitle(title)) {
        continue;
      }

      // Get context around the quote
      const contextStart = Math.max(0, match.index - 50);
      const contextEnd = Math.min(text.length, match.index + match[0].length + 50);
      const context = text.slice(contextStart, contextEnd);

      // Classify media type from context
      const mediaType = defaultMediaType ?? this.classifyFromContext(context);

      // Extract artist for music
      const artist = mediaType === MediaType.MUSIC ? this.extractArtist(text, match.index) : undefined;

      mentions.push({
        title,
        normalizedTitle: this.normalizeTitle(title),
        mediaType,
        confidence: 'high',
        artist,
        context,
      });
    }

    return mentions;
  }

  /**
   * Extract title case text (medium confidence)
   */
  private extractTitleCase(text: string, defaultMediaType?: MediaType): MediaMention[] {
    const mentions: MediaMention[] = [];

    // Regex: 2+ consecutive capitalized words (with numbers allowed)
    const titleCasePattern = /\b(?:[A-Z][a-z]+|\d+)(?:\s+(?:[A-Z][a-z]+|\d+))+/g;
    let match;

    while ((match = titleCasePattern.exec(text)) !== null) {
      const title = match[0].trim();

      // Validate title
      if (!this.isValidTitle(title)) {
        continue;
      }

      // Get context
      const contextStart = Math.max(0, match.index - 50);
      const contextEnd = Math.min(text.length, match.index + match[0].length + 50);
      const context = text.slice(contextStart, contextEnd);

      // Classify media type
      const mediaType = defaultMediaType ?? this.classifyFromContext(context);

      mentions.push({
        title,
        normalizedTitle: this.normalizeTitle(title),
        mediaType,
        confidence: 'medium',
        context,
      });
    }

    return mentions;
  }

  /**
   * Classify media type based on context keywords
   */
  private classifyFromContext(context: string): MediaType {
    const contextLower = context.toLowerCase();

    // Count keyword occurrences
    const movieCount = MOVIE_KEYWORDS.filter((kw) => contextLower.includes(kw)).length;
    const tvCount = TV_KEYWORDS.filter((kw) => contextLower.includes(kw)).length;
    const musicCount = MUSIC_KEYWORDS.filter((kw) => contextLower.includes(kw)).length;

    // Return type with most matches
    const max = Math.max(movieCount, tvCount, musicCount);

    if (max === 0) {
      return MediaType.UNKNOWN;
    }

    if (movieCount === max) return MediaType.MOVIE;
    if (tvCount === max) return MediaType.TV_SHOW;
    if (musicCount === max) return MediaType.MUSIC;

    return MediaType.UNKNOWN;
  }

  /**
   * Extract artist name for music mentions
   */
  private extractArtist(text: string, titlePosition: number): string | undefined {
    // Look for " by Artist" pattern after the title
    const afterTitle = text.slice(titlePosition);
    const artistPattern = /by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+(?:feat\.|featuring|ft\.|with)\s+.+)?)/;
    const match = artistPattern.exec(afterTitle);

    return match ? match[1].trim() : undefined;
  }

  /**
   * Validate if a title is valid (not noise, not too short)
   */
  private isValidTitle(title: string): boolean {
    // Too short
    if (title.length < 2) {
      return false;
    }

    // Single very short word
    if (title.split(/\s+/).length === 1 && title.length < 3) {
      return false;
    }

    // Noise words
    if (NOISE_WORDS.has(title.toLowerCase())) {
      return false;
    }

    return true;
  }
}
```

**Step 2: Run test to verify it passes**

Run: `npm test src/lib/mention-extractor.test.ts`

Expected: All tests pass

**Step 3: Commit**

```bash
git add src/lib/mention-extractor.ts
git commit -m "feat: implement media mention extractor

- Quoted text extraction with regex
- Title case extraction for proper nouns
- Context-based media type classification
- Artist extraction for music mentions
- Title normalization (remove articles, lowercase)
- Noise filtering and validation
- All tests passing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Add property-based tests for mention extractor

**Files:**
- Modify: `src/lib/mention-extractor.test.ts`

**Step 1: Install fast-check for property-based testing**

Run: `npm install -D fast-check`

**Step 2: Add property-based tests**

Add to existing test file:

```typescript
import { fc } from 'fast-check';

describe('MentionExtractor - Property-Based Tests', () => {
  const extractor = new MentionExtractor();

  it('should handle arbitrary quoted strings', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 3, maxLength: 50 }).filter((s) => !s.includes('"')),
        (title) => {
          const text = `I watched "${title}" yesterday`;
          const mentions = extractor.extractMentions(text, MediaType.MOVIE);

          // Should extract the title (if valid)
          if (extractor.normalizeTitle(title).length >= 2) {
            expect(mentions.length).toBeGreaterThanOrEqual(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should produce consistent normalized titles', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 3, maxLength: 30 }), (title) => {
        const normalized1 = extractor.normalizeTitle(title);
        const normalized2 = extractor.normalizeTitle(title);

        // Normalization is idempotent
        expect(normalized1).toBe(normalized2);
      }),
      { numRuns: 100 }
    );
  });

  it('should normalize titles with articles consistently', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('The', 'A', 'An'),
        fc.string({ minLength: 3, maxLength: 30 }),
        (article, title) => {
          const withArticle = `${article} ${title}`;
          const normalized1 = extractor.normalizeTitle(withArticle);
          const normalized2 = extractor.normalizeTitle(title);

          // With or without article should normalize to same value
          expect(normalized1).toBe(normalized2.toLowerCase());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should never extract empty titles', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100 }), (text) => {
        const mentions = extractor.extractMentions(text, MediaType.MOVIE);

        // All extracted titles must be non-empty
        mentions.forEach((mention) => {
          expect(mention.title.length).toBeGreaterThan(0);
          expect(mention.normalizedTitle.length).toBeGreaterThan(0);
        });
      }),
      { numRuns: 100 }
    );
  });
});
```

**Step 3: Run property-based tests**

Run: `npm test src/lib/mention-extractor.test.ts`

Expected: All tests pass including property-based tests

**Step 4: Commit**

```bash
git add src/lib/mention-extractor.test.ts package.json package-lock.json
git commit -m "test: add property-based tests for mention extractor

- Test arbitrary quoted strings
- Test normalization idempotence
- Test article handling consistency
- Test no empty titles extracted
- Uses fast-check library

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 7-9) -->
<!-- START_TASK_7 -->
### Task 7: Write prompt detector test (TDD)

**Files:**
- Create: `src/lib/prompt-detector.test.ts`

**Step 1: Write failing test for prompt detector**

```typescript
import { describe, it, expect } from 'vitest';
import { PromptDetector, MediaType } from './prompt-detector';

describe('PromptDetector', () => {
  const detector = new PromptDetector();

  describe('detectPromptType', () => {
    it('should detect movie prompts', () => {
      const prompts = [
        'What movie have you watched recently?',
        'Favorite film?',
        'Drop your top 5 movies',
        'Name a movie that changed your life',
      ];

      prompts.forEach((prompt) => {
        const detected = detector.detectPromptType(prompt);
        expect(detected).toBe(MediaType.MOVIE);
      });
    });

    it('should detect TV show prompts', () => {
      const prompts = [
        'What TV show are you watching?',
        'Best series you have seen?',
        'Favorite show?',
        'What are you binging?',
      ];

      prompts.forEach((prompt) => {
        const detected = detector.detectPromptType(prompt);
        expect(detected).toBe(MediaType.TV_SHOW);
      });
    });

    it('should detect music prompts', () => {
      const prompts = [
        'What song are you listening to?',
        'Favorite artist?',
        'Best album of all time?',
        'Drop your top 5 songs',
      ];

      prompts.forEach((prompt) => {
        const detected = detector.detectPromptType(prompt);
        expect(detected).toBe(MediaType.MUSIC);
      });
    });

    it('should return UNKNOWN for ambiguous prompts', () => {
      const prompts = [
        'What are you doing?',
        'How are you?',
        'Tell me something interesting',
      ];

      prompts.forEach((prompt) => {
        const detected = detector.detectPromptType(prompt);
        expect(detected).toBe(MediaType.UNKNOWN);
      });
    });

    it('should handle case insensitivity', () => {
      expect(detector.detectPromptType('FAVORITE MOVIE?')).toBe(MediaType.MOVIE);
      expect(detector.detectPromptType('favorite movie?')).toBe(MediaType.MOVIE);
      expect(detector.detectPromptType('FaVoRiTe MoViE?')).toBe(MediaType.MOVIE);
    });

    it('should handle prompts with emojis', () => {
      expect(detector.detectPromptType('🎬 Favorite movie?')).toBe(MediaType.MOVIE);
      expect(detector.detectPromptType('🎵 What song?')).toBe(MediaType.MUSIC);
    });
  });

  describe('getConfidence', () => {
    it('should return high confidence for strong keywords', () => {
      const confidence = detector.getConfidence(
        'What is your favorite movie?',
        MediaType.MOVIE
      );

      expect(confidence).toBe('high');
    });

    it('should return medium confidence for weaker matches', () => {
      const confidence = detector.getConfidence(
        'What are you watching?',
        MediaType.TV_SHOW
      );

      expect(confidence).toBe('medium');
    });

    it('should return low confidence for ambiguous text', () => {
      const confidence = detector.getConfidence(
        'Tell me about it',
        MediaType.MOVIE
      );

      expect(confidence).toBe('low');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test src/lib/prompt-detector.test.ts`

Expected: Test fails with "Cannot find module './prompt-detector'"

**Step 3: Commit**

```bash
git add src/lib/prompt-detector.test.ts
git commit -m "test: add prompt detector tests (TDD - failing)

- Detect movie, TV show, and music prompts
- Handle case insensitivity
- Handle emojis in prompts
- Return confidence levels
- Handle ambiguous prompts

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Implement prompt detector

**Files:**
- Create: `src/lib/prompt-detector.ts`

**Step 1: Write prompt detector implementation**

```typescript
export { MediaType } from './mention-extractor';
export type { MediaMention } from './mention-extractor';

const MOVIE_KEYWORDS = {
  strong: ['movie', 'film', 'cinema'],
  weak: ['watched', 'saw', 'favorite', 'best', 'top'],
};

const TV_KEYWORDS = {
  strong: ['show', 'series', 'episode', 'season', 'tv', 'television'],
  weak: ['watching', 'binge', 'binging', 'favorite', 'best'],
};

const MUSIC_KEYWORDS = {
  strong: ['song', 'music', 'album', 'artist', 'track'],
  weak: ['listening', 'heard', 'favorite', 'best', 'top'],
};

/**
 * Detects prompt type from root post text
 * Auto-identifies whether thread is asking about movies, TV, or music
 */
export class PromptDetector {
  /**
   * Detect media type from prompt text
   * Returns UNKNOWN if ambiguous
   */
  detectPromptType(text: string): MediaType {
    const textLower = text.toLowerCase();

    // Score each media type
    const movieScore = this.scoreKeywords(textLower, MOVIE_KEYWORDS);
    const tvScore = this.scoreKeywords(textLower, TV_KEYWORDS);
    const musicScore = this.scoreKeywords(textLower, MUSIC_KEYWORDS);

    // Find max score
    const maxScore = Math.max(movieScore, tvScore, musicScore);

    // Require minimum score (at least one strong keyword)
    if (maxScore < 10) {
      return MediaType.UNKNOWN;
    }

    // Return type with highest score
    if (movieScore === maxScore) return MediaType.MOVIE;
    if (tvScore === maxScore) return MediaType.TV_SHOW;
    if (musicScore === maxScore) return MediaType.MUSIC;

    return MediaType.UNKNOWN;
  }

  /**
   * Get confidence level for a detected type
   */
  getConfidence(
    text: string,
    detectedType: MediaType
  ): 'high' | 'medium' | 'low' {
    const textLower = text.toLowerCase();

    const keywords =
      detectedType === MediaType.MOVIE
        ? MOVIE_KEYWORDS
        : detectedType === MediaType.TV_SHOW
          ? TV_KEYWORDS
          : detectedType === MediaType.MUSIC
            ? MUSIC_KEYWORDS
            : { strong: [], weak: [] };

    const score = this.scoreKeywords(textLower, keywords);

    if (score >= 15) return 'high'; // Multiple strong keywords
    if (score >= 10) return 'medium'; // At least one strong keyword
    return 'low'; // Only weak keywords or none
  }

  /**
   * Score text based on keyword matches
   */
  private scoreKeywords(
    text: string,
    keywords: { strong: string[]; weak: string[] }
  ): number {
    let score = 0;

    // Strong keywords: 10 points each
    for (const keyword of keywords.strong) {
      if (text.includes(keyword)) {
        score += 10;
      }
    }

    // Weak keywords: 5 points each
    for (const keyword of keywords.weak) {
      if (text.includes(keyword)) {
        score += 5;
      }
    }

    return score;
  }
}
```

**Step 2: Run test to verify it passes**

Run: `npm test src/lib/prompt-detector.test.ts`

Expected: All tests pass

**Step 3: Commit**

```bash
git add src/lib/prompt-detector.ts
git commit -m "feat: implement prompt type detector

- Keyword-based scoring (strong + weak keywords)
- Detects movies, TV shows, and music prompts
- Returns UNKNOWN for ambiguous prompts
- Confidence levels (high/medium/low)
- Case-insensitive matching
- All tests passing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: Verify Phase 3 coverage and create barrel export

**Files:**
- Verify: All Phase 3 test files
- Create: `src/lib/index.ts`

**Step 1: Run coverage for entire lib module**

Run: `npm run test:coverage -- src/lib/`

Expected: Overall coverage ≥95%

**Step 2: Create barrel export**

```typescript
export { ThreadBuilder } from './thread-builder';
export type { ThreadTree } from './thread-builder';
export { MentionExtractor, MediaType } from './mention-extractor';
export type { MediaMention } from './mention-extractor';
export { PromptDetector } from './prompt-detector';
```

**Step 3: Run full test suite for Phase 3**

Run: `npm test src/lib/`

Expected: All lib tests pass (thread-builder + mention-extractor + prompt-detector)

**Step 4: Run type checking and linting**

Run: `npm run type-check && npm run lint`

Expected: No errors

**Step 5: Commit**

```bash
git add src/lib/index.ts
git commit -m "feat: add lib module barrel exports

- Export ThreadBuilder and ThreadTree
- Export MentionExtractor, MediaType, MediaMention
- Export PromptDetector
- Clean public API surface

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_9 -->
<!-- END_SUBCOMPONENT_C -->

---

## Phase 3 Complete

**Deliverables:**
- ✓ src/lib/thread-builder.ts with recursive tree construction and parent tracking
- ✓ src/lib/thread-builder.test.ts with comprehensive tests (95%+ coverage)
- ✓ src/lib/mention-extractor.ts with regex + context classification
- ✓ src/lib/mention-extractor.test.ts with unit and property-based tests (95%+ coverage)
- ✓ src/lib/prompt-detector.ts with keyword-based type detection
- ✓ src/lib/prompt-detector.test.ts with prompt classification tests (95%+ coverage)
- ✓ src/lib/index.ts barrel exports
- ✓ All tests passing
- ✓ 95%+ coverage achieved

**Verification:**
- `npm test src/lib/` passes all tests
- `npm run test:coverage -- src/lib/` shows ≥95% coverage
- `npm run validate` passes (type-check, lint, format, tests)

**Next Phase:** Phase 4 will implement smart counting logic with sentiment analysis to determine agreement vs. disagreement in replies
