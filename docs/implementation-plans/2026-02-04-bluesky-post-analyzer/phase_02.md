# Starcounter: Bluesky Post Analyzer Implementation Plan - Phase 2

**Goal:** Fetch thread data from Bluesky API with rate limiting

**Architecture:** Client-side API wrapper for AT Protocol public endpoints with token bucket rate limiter

**Tech Stack:** TypeScript, Bluesky AT Protocol public API (public.api.bsky.app), token bucket rate limiting

**Scope:** Phase 2 of 8 phases from original design

**Codebase verified:** 2026-02-04 (Phase 1 creates src/ directory)

---

## Phase Overview

This phase implements the Bluesky AT Protocol client for fetching thread and quote data from the public API. It includes a token bucket rate limiter (3000 requests per 5 minutes), TypeScript interfaces for API responses, and comprehensive error handling with exponential backoff. The implementation follows patterns from ergoblock (API request helpers) and bluesky-universe (rate limiter).

**Key endpoints:**
- `getPostThread` - Fetch thread with replies (recursive, up to depth 6)
- `getQuotes` - Fetch quote tweets with cursor-based pagination

**Rate limiting:** 3000 requests per 5 minutes (Bluesky public API limit), conservative buffer at 2500/5min, minimum 50ms delay between requests

**Testing:** Colocated tests with mocked fetch, 95% coverage target

---

<!-- START_TASK_1 -->
### Task 1: Create TypeScript type definitions

**Files:**
- Create: `src/types.ts`

**Step 1: Create src/types.ts with AT Protocol types**

```typescript
// AT Protocol and Bluesky API type definitions

/**
 * AT-URI format: at://did:plc:xxxxx/app.bsky.feed.post/xxxxx
 * or at://{handle}/app.bsky.feed.post/{post_id}
 */
export type AtUri = string;

/**
 * Content Identifier - cryptographic hash of content
 */
export type Cid = string;

/**
 * Decentralized Identifier
 */
export type Did = string;

/**
 * ISO 8601 datetime string
 */
export type IsoDateTime = string;

/**
 * Profile view with basic user information
 */
export interface ProfileViewBasic {
  did: Did;
  handle: string;
  displayName?: string;
  avatar?: string;
  associated?: {
    lists?: number;
    feedgens?: number;
    starterPacks?: number;
    labeler?: boolean;
    chat?: {
      allowIncoming: 'all' | 'none' | 'following';
    };
  };
  viewer?: {
    muted?: boolean;
    blockedBy?: boolean;
    blocking?: string;
    blockingByList?: {
      uri: string;
      cid: string;
      name: string;
      purpose: string;
    };
    following?: string;
    followedBy?: string;
  };
  labels?: Label[];
  createdAt?: IsoDateTime;
}

/**
 * Content label for moderation
 */
export interface Label {
  src: Did;
  uri: string;
  cid?: Cid;
  val: string;
  neg?: boolean;
  cts: IsoDateTime;
  exp?: IsoDateTime;
  sig?: Uint8Array;
}

/**
 * Post record content
 */
export interface PostRecord {
  text: string;
  createdAt: IsoDateTime;
  reply?: {
    root: { uri: AtUri; cid: Cid };
    parent: { uri: AtUri; cid: Cid };
  };
  embed?: unknown; // Simplified for now
  entities?: unknown;
  facets?: unknown;
  labels?: unknown;
  langs?: string[];
  tags?: string[];
}

/**
 * Post view with engagement metrics
 */
export interface PostView {
  uri: AtUri;
  cid: Cid;
  author: ProfileViewBasic;
  record: PostRecord;
  embed?: unknown;
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  indexedAt: IsoDateTime;
  viewer?: {
    repost?: string;
    like?: string;
    threadMuted?: boolean;
    replyDisabled?: boolean;
    embeddingDisabled?: boolean;
    pinned?: boolean;
  };
  labels?: Label[];
  threadgate?: unknown;
}

/**
 * Post not found (deleted, taken down, or never existed)
 */
export interface NotFoundPost {
  uri: AtUri;
  notFound: true;
}

/**
 * Post from blocked author
 */
export interface BlockedPost {
  uri: AtUri;
  blocked: true;
  author: {
    did: Did;
    viewer?: {
      blockedBy?: boolean;
      blocking?: string;
    };
  };
}

/**
 * Thread view post with parent and replies
 */
export interface ThreadViewPost {
  post: PostView;
  parent?: ThreadViewPost | NotFoundPost | BlockedPost;
  replies?: Array<ThreadViewPost | NotFoundPost | BlockedPost>;
}

/**
 * Response from getPostThread endpoint
 */
export interface GetPostThreadResponse {
  thread: ThreadViewPost | NotFoundPost | BlockedPost;
  threadgate?: unknown;
}

/**
 * Response from getQuotes endpoint
 */
export interface GetQuotesResponse {
  uri: AtUri;
  cid?: Cid;
  cursor?: string;
  posts: PostView[];
}

/**
 * Rate limit information from response headers
 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp
  policy: string; // Format: "limit;w=window"
}

/**
 * API error response
 */
export interface ApiError {
  error: string;
  message: string;
}

/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

**Step 2: Verify TypeScript compilation**

Run: `npm run type-check`

Expected: No type errors

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add AT Protocol type definitions

- AT-URI, CID, DID, and ISO datetime types
- ProfileViewBasic for user information
- PostView with engagement metrics
- ThreadViewPost with parent/replies structure
- GetPostThreadResponse and GetQuotesResponse
- Rate limit info and error types
- Result type for error handling

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-4) -->
<!-- START_TASK_2 -->
### Task 2: Write rate limiter test (TDD)

**Files:**
- Create: `src/api/rate-limiter.test.ts`

**Step 1: Create src/api directory**

Run: `mkdir -p src/api`

**Step 2: Write failing test for rate limiter**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('token bucket algorithm', () => {
    it('should allow requests up to the limit', async () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 });

      // Should allow 5 requests without waiting
      for (let i = 0; i < 5; i++) {
        await limiter.waitForSlot();
        limiter.recordRequest();
      }

      const stats = limiter.getStats();
      expect(stats.used).toBe(5);
      expect(stats.remaining).toBe(0);
    });

    it('should block when limit is reached', async () => {
      const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60000 });

      // Use all 3 slots
      for (let i = 0; i < 3; i++) {
        await limiter.waitForSlot();
        limiter.recordRequest();
      }

      // 4th request should wait
      const waitPromise = limiter.waitForSlot();

      // Should not resolve immediately
      let resolved = false;
      waitPromise.then(() => { resolved = true; });

      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(false);

      // After window expires, should resolve
      await vi.advanceTimersByTimeAsync(60000);
      expect(resolved).toBe(true);
    });

    it('should respect minimum delay between requests', async () => {
      const limiter = new RateLimiter({ maxRequests: 100, windowMs: 60000, minDelayMs: 50 });

      const start = Date.now();
      await limiter.waitForSlot();
      limiter.recordRequest();

      await limiter.waitForSlot();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(50);
    });

    it('should remove expired requests from window', async () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 });

      // Make 3 requests
      for (let i = 0; i < 3; i++) {
        await limiter.waitForSlot();
        limiter.recordRequest();
      }

      expect(limiter.getStats().used).toBe(3);

      // Advance time past window
      await vi.advanceTimersByTimeAsync(61000);

      // Old requests should be removed
      expect(limiter.getStats().used).toBe(0);
      expect(limiter.getStats().remaining).toBe(5);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', async () => {
      const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60000 });

      // Make 3 requests
      for (let i = 0; i < 3; i++) {
        await limiter.waitForSlot();
        limiter.recordRequest();
      }

      const stats = limiter.getStats();
      expect(stats.used).toBe(3);
      expect(stats.remaining).toBe(7);
      expect(stats.windowResetMs).toBeGreaterThan(0);
    });
  });

  describe('isNearLimit', () => {
    it('should detect when approaching limit', async () => {
      const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60000 });

      expect(limiter.isNearLimit(0.5)).toBe(false);

      // Use 6 of 10 slots (60%)
      for (let i = 0; i < 6; i++) {
        await limiter.waitForSlot();
        limiter.recordRequest();
      }

      expect(limiter.isNearLimit(0.5)).toBe(true);
      expect(limiter.isNearLimit(0.7)).toBe(false);
    });
  });

  describe('reset', () => {
    it('should clear all tracked requests', async () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 });

      // Use all slots
      for (let i = 0; i < 5; i++) {
        await limiter.waitForSlot();
        limiter.recordRequest();
      }

      expect(limiter.getStats().used).toBe(5);

      limiter.reset();

      expect(limiter.getStats().used).toBe(0);
      expect(limiter.getStats().remaining).toBe(5);
    });
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npm test src/api/rate-limiter.test.ts`

Expected: Test fails with "Cannot find module './rate-limiter'"

**Step 4: Commit**

```bash
git add src/api/rate-limiter.test.ts
git commit -m "test: add rate limiter tests (TDD - failing)

- Token bucket algorithm tests
- Sliding window expiration
- Minimum delay between requests
- Statistics and near-limit detection
- Reset functionality

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Implement rate limiter

**Files:**
- Create: `src/api/rate-limiter.ts`

**Step 1: Write rate limiter implementation**

```typescript
/**
 * Token bucket rate limiter for Bluesky API
 * Limits: 3000 requests per 5 minutes (conservative: 2500)
 * Minimum delay: 50ms between requests
 */

export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  minDelayMs?: number;
}

export interface RateLimiterStats {
  used: number;
  remaining: number;
  windowResetMs: number;
}

export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly minDelayMs: number;
  private requests: number[] = []; // Timestamps of requests
  private lastRequestTime = 0;

  constructor(options: RateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.minDelayMs = options.minDelayMs ?? 0;
  }

  /**
   * Wait until a slot is available for the next request
   * Respects both the rate limit window and minimum delay
   */
  async waitForSlot(): Promise<void> {
    // Remove expired requests from window
    this.cleanupExpiredRequests();

    // Calculate how long to wait
    let waitMs = 0;

    // Check minimum delay since last request
    if (this.minDelayMs > 0 && this.lastRequestTime > 0) {
      const timeSinceLastRequest = Date.now() - this.lastRequestTime;
      const minDelayWait = this.minDelayMs - timeSinceLastRequest;
      waitMs = Math.max(waitMs, minDelayWait);
    }

    // Check if at rate limit
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const windowWait = this.windowMs - (Date.now() - oldestRequest);
      waitMs = Math.max(waitMs, windowWait);
    }

    // Wait if needed
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));

      // After waiting, clean up again and recurse if still blocked
      this.cleanupExpiredRequests();
      if (this.requests.length >= this.maxRequests) {
        return this.waitForSlot();
      }
    }
  }

  /**
   * Record that a request was made
   * Call this after making the API request
   */
  recordRequest(): void {
    const now = Date.now();
    this.requests.push(now);
    this.lastRequestTime = now;
  }

  /**
   * Get current rate limiter statistics
   */
  getStats(): RateLimiterStats {
    this.cleanupExpiredRequests();

    const used = this.requests.length;
    const remaining = Math.max(0, this.maxRequests - used);

    // Calculate when the oldest request will expire
    let windowResetMs = 0;
    if (this.requests.length > 0) {
      const oldestRequest = this.requests[0];
      windowResetMs = this.windowMs - (Date.now() - oldestRequest);
    }

    return {
      used,
      remaining,
      windowResetMs: Math.max(0, windowResetMs),
    };
  }

  /**
   * Check if we're near the rate limit
   * @param threshold - Fraction of limit (0-1), e.g., 0.8 for 80%
   */
  isNearLimit(threshold: number): boolean {
    this.cleanupExpiredRequests();
    const usedFraction = this.requests.length / this.maxRequests;
    return usedFraction >= threshold;
  }

  /**
   * Reset all tracked requests
   */
  reset(): void {
    this.requests = [];
    this.lastRequestTime = 0;
  }

  /**
   * Remove requests older than the window
   */
  private cleanupExpiredRequests(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    this.requests = this.requests.filter((timestamp) => timestamp > cutoff);
  }
}

// Global rate limiter instance for Bluesky API
// Conservative: 2500 requests per 5 minutes (actual limit is 3000)
// Minimum 50ms delay between requests
let globalRateLimiter: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = new RateLimiter({
      maxRequests: 2500,
      windowMs: 5 * 60 * 1000, // 5 minutes
      minDelayMs: 50,
    });
  }
  return globalRateLimiter;
}

export function resetRateLimiter(): void {
  globalRateLimiter = null;
}
```

**Step 2: Run test to verify it passes**

Run: `npm test src/api/rate-limiter.test.ts`

Expected: All tests pass

**Step 3: Commit**

```bash
git add src/api/rate-limiter.ts
git commit -m "feat: implement token bucket rate limiter

- Sliding window with automatic cleanup
- Minimum delay enforcement (50ms)
- Conservative limit (2500/5min vs 3000/5min actual)
- Statistics and near-limit detection
- Global singleton pattern for app-wide limiting
- All tests passing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Verify rate limiter coverage

**Files:**
- Verify: `src/api/rate-limiter.test.ts` and `src/api/rate-limiter.ts`

**Step 1: Run coverage check**

Run: `npm run test:coverage -- src/api/rate-limiter`

Expected: Coverage ≥95% for rate-limiter.ts

**Step 2: Review uncovered lines**

Run: `npm run test:coverage -- src/api/rate-limiter --reporter=html`

Then open: `coverage/index.html` in browser

Expected: All critical paths covered (token bucket, cleanup, waiting logic)

**Step 3: If coverage <95%, add missing tests**

If coverage is below 95%, identify uncovered branches and add tests. Common gaps:
- Edge case: exactly at limit
- Edge case: window reset at boundary
- Concurrent requests (if applicable)

**Step 4: Commit if tests were added**

If additional tests were needed:

```bash
git add src/api/rate-limiter.test.ts
git commit -m "test: increase rate limiter coverage to 95%+

- Add edge case tests for boundary conditions
- Ensure all branches covered

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

Otherwise: No commit needed
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 5-7) -->
<!-- START_TASK_5 -->
### Task 5: Write Bluesky API client test (TDD)

**Files:**
- Create: `src/api/bluesky-client.test.ts`

**Step 1: Write failing test for Bluesky client**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BlueskyClient } from './bluesky-client';
import type {
  GetPostThreadResponse,
  GetQuotesResponse,
  ThreadViewPost,
  PostView,
} from '../types';

describe('BlueskyClient', () => {
  let client: BlueskyClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    client = new BlueskyClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getPostThread', () => {
    it('should fetch thread successfully', async () => {
      const mockResponse: GetPostThreadResponse = {
        thread: {
          post: {
            uri: 'at://did:plc:test/app.bsky.feed.post/123',
            cid: 'bafytest',
            author: {
              did: 'did:plc:test',
              handle: 'test.bsky.social',
            },
            record: {
              text: 'Test post',
              createdAt: '2026-02-04T10:00:00.000Z',
            },
            indexedAt: '2026-02-04T10:00:05.000Z',
          },
          replies: [],
        } as ThreadViewPost,
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'ratelimit-limit': '3000',
          'ratelimit-remaining': '2999',
          'ratelimit-reset': String(Math.floor(Date.now() / 1000) + 300),
        }),
        json: async () => mockResponse,
      });

      const result = await client.getPostThread('at://did:plc:test/app.bsky.feed.post/123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.thread).toEqual(mockResponse.thread);
      }

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/xrpc/app.bsky.feed.getPostThread'),
        expect.any(Object)
      );
    });

    it('should handle 404 not found', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: async () => ({
          error: 'NotFound',
          message: 'Post not found or has been deleted',
        }),
      });

      const result = await client.getPostThread('at://did:plc:test/app.bsky.feed.post/missing');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Post not found');
      }
    });

    it('should retry on 429 rate limit with exponential backoff', async () => {
      const resetTime = Math.floor(Date.now() / 1000) + 2;

      // First call: 429
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({
          'ratelimit-reset': String(resetTime),
          'retry-after': '2',
        }),
        json: async () => ({
          error: 'RateLimitExceeded',
          message: 'Too Many Requests',
        }),
      });

      // Second call: success
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'ratelimit-limit': '3000',
          'ratelimit-remaining': '2999',
          'ratelimit-reset': String(resetTime + 300),
        }),
        json: async () => ({
          thread: {
            post: {
              uri: 'at://did:plc:test/app.bsky.feed.post/123',
              cid: 'bafytest',
              author: { did: 'did:plc:test', handle: 'test.bsky.social' },
              record: { text: 'Test', createdAt: '2026-02-04T10:00:00.000Z' },
              indexedAt: '2026-02-04T10:00:05.000Z',
            },
            replies: [],
          },
        }),
      });

      vi.useFakeTimers();
      const resultPromise = client.getPostThread('at://did:plc:test/app.bsky.feed.post/123');

      // Advance timers to trigger retry
      await vi.advanceTimersByTimeAsync(2100);

      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should fail after max retries', async () => {
      const resetTime = Math.floor(Date.now() / 1000) + 1;

      // All calls return 429
      for (let i = 0; i < 4; i++) {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({
            'ratelimit-reset': String(resetTime),
          }),
          json: async () => ({
            error: 'RateLimitExceeded',
            message: 'Too Many Requests',
          }),
        });
      }

      vi.useFakeTimers();
      const resultPromise = client.getPostThread('at://did:plc:test/app.bsky.feed.post/123', {
        maxRetries: 3,
      });

      // Advance timers
      await vi.advanceTimersByTimeAsync(10000);

      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Rate limit exceeded');
      }

      vi.useRealTimers();
    });

    it('should pass depth parameter', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          thread: {
            post: {
              uri: 'at://did:plc:test/app.bsky.feed.post/123',
              cid: 'bafytest',
              author: { did: 'did:plc:test', handle: 'test.bsky.social' },
              record: { text: 'Test', createdAt: '2026-02-04T10:00:00.000Z' },
              indexedAt: '2026-02-04T10:00:05.000Z',
            },
            replies: [],
          },
        }),
      });

      await client.getPostThread('at://did:plc:test/app.bsky.feed.post/123', { depth: 10 });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('depth=10'),
        expect.any(Object)
      );
    });
  });

  describe('getQuotes', () => {
    it('should fetch quotes successfully', async () => {
      const mockResponse: GetQuotesResponse = {
        uri: 'at://did:plc:test/app.bsky.feed.post/123',
        cid: 'bafytest',
        posts: [
          {
            uri: 'at://did:plc:quote1/app.bsky.feed.post/456',
            cid: 'bafyquote1',
            author: { did: 'did:plc:quote1', handle: 'quote1.bsky.social' },
            record: { text: 'Quote post 1', createdAt: '2026-02-04T10:01:00.000Z' },
            indexedAt: '2026-02-04T10:01:05.000Z',
          } as PostView,
        ],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => mockResponse,
      });

      const result = await client.getQuotes('at://did:plc:test/app.bsky.feed.post/123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.posts).toHaveLength(1);
        expect(result.value.uri).toBe(mockResponse.uri);
      }
    });

    it('should handle pagination with cursor', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          uri: 'at://did:plc:test/app.bsky.feed.post/123',
          cursor: 'page2cursor',
          posts: [],
        }),
      });

      await client.getQuotes('at://did:plc:test/app.bsky.feed.post/123', {
        cursor: 'page1cursor',
        limit: 100,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('cursor=page1cursor'),
        expect.any(Object)
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('limit=100'),
        expect.any(Object)
      );
    });
  });

  describe('parseRateLimitHeaders', () => {
    it('should parse rate limit headers correctly', async () => {
      const headers = new Headers({
        'ratelimit-limit': '3000',
        'ratelimit-remaining': '2500',
        'ratelimit-reset': '1737633541',
        'ratelimit-policy': '3000;w=300',
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers,
        json: async () => ({
          thread: {
            post: {
              uri: 'at://did:plc:test/app.bsky.feed.post/123',
              cid: 'bafytest',
              author: { did: 'did:plc:test', handle: 'test.bsky.social' },
              record: { text: 'Test', createdAt: '2026-02-04T10:00:00.000Z' },
              indexedAt: '2026-02-04T10:00:05.000Z',
            },
            replies: [],
          },
        }),
      });

      const result = await client.getPostThread('at://did:plc:test/app.bsky.feed.post/123');

      expect(result.ok).toBe(true);

      const rateLimitInfo = client.getLastRateLimitInfo();
      expect(rateLimitInfo?.limit).toBe(3000);
      expect(rateLimitInfo?.remaining).toBe(2500);
      expect(rateLimitInfo?.reset).toBe(1737633541);
      expect(rateLimitInfo?.policy).toBe('3000;w=300');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test src/api/bluesky-client.test.ts`

Expected: Test fails with "Cannot find module './bluesky-client'"

**Step 3: Commit**

```bash
git add src/api/bluesky-client.test.ts
git commit -m "test: add Bluesky API client tests (TDD - failing)

- getPostThread with depth parameter
- getQuotes with pagination
- 429 rate limit retry with exponential backoff
- 404 error handling
- Rate limit header parsing
- Max retries enforcement

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Implement Bluesky API client

**Files:**
- Create: `src/api/bluesky-client.ts`

**Step 1: Write Bluesky client implementation**

```typescript
import type {
  AtUri,
  GetPostThreadResponse,
  GetQuotesResponse,
  RateLimitInfo,
  Result,
} from '../types';
import { getRateLimiter } from './rate-limiter';

const BASE_URL = 'https://public.api.bsky.app';

export interface GetPostThreadOptions {
  depth?: number;
  parentHeight?: number;
  maxRetries?: number;
}

export interface GetQuotesOptions {
  cursor?: string;
  limit?: number;
  maxRetries?: number;
}

/**
 * Client for Bluesky AT Protocol public API
 * Handles thread fetching, quote fetching, and rate limiting
 */
export class BlueskyClient {
  private lastRateLimitInfo: RateLimitInfo | null = null;
  private readonly rateLimiter = getRateLimiter();

  /**
   * Fetch a post thread with replies
   * @param uri - AT-URI of the post
   * @param options - Depth, parent height, and retry configuration
   */
  async getPostThread(
    uri: AtUri,
    options: GetPostThreadOptions = {}
  ): Promise<Result<GetPostThreadResponse>> {
    const { depth = 6, parentHeight = 80, maxRetries = 3 } = options;

    const params = new URLSearchParams({
      uri,
      depth: String(depth),
      parentHeight: String(parentHeight),
    });

    const url = `${BASE_URL}/xrpc/app.bsky.feed.getPostThread?${params}`;

    return this.fetchWithRetry<GetPostThreadResponse>(url, maxRetries);
  }

  /**
   * Fetch quote posts for a given post
   * @param uri - AT-URI of the post
   * @param options - Pagination cursor, limit, and retry configuration
   */
  async getQuotes(
    uri: AtUri,
    options: GetQuotesOptions = {}
  ): Promise<Result<GetQuotesResponse>> {
    const { cursor, limit = 50, maxRetries = 3 } = options;

    const params = new URLSearchParams({
      uri,
      limit: String(limit),
    });

    if (cursor) {
      params.set('cursor', cursor);
    }

    const url = `${BASE_URL}/xrpc/app.bsky.feed.getQuotes?${params}`;

    return this.fetchWithRetry<GetQuotesResponse>(url, maxRetries);
  }

  /**
   * Get rate limit information from the last API response
   */
  getLastRateLimitInfo(): RateLimitInfo | null {
    return this.lastRateLimitInfo;
  }

  /**
   * Fetch with automatic retry on 429 and exponential backoff
   */
  private async fetchWithRetry<T>(
    url: string,
    maxRetries: number,
    attempt = 0
  ): Promise<Result<T>> {
    // Wait for rate limiter slot
    await this.rateLimiter.waitForSlot();

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Record request with rate limiter
      this.rateLimiter.recordRequest();

      // Parse rate limit headers
      this.parseRateLimitHeaders(response.headers);

      // Handle rate limiting (429)
      if (response.status === 429) {
        if (attempt >= maxRetries) {
          return {
            ok: false,
            error: new Error(`Rate limit exceeded after ${maxRetries} retries`),
          };
        }

        // Calculate wait time from headers
        const resetTime = parseInt(response.headers.get('ratelimit-reset') || '0');
        const retryAfter = parseInt(response.headers.get('retry-after') || '0');

        const waitTime = resetTime
          ? Math.max(0, resetTime - Math.floor(Date.now() / 1000)) * 1000
          : retryAfter * 1000 || Math.pow(2, attempt) * 1000;

        // Wait and retry
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.fetchWithRetry<T>(url, maxRetries, attempt + 1);
      }

      // Handle other errors
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          ok: false,
          error: new Error(
            errorData.message || `HTTP ${response.status}: ${response.statusText}`
          ),
        };
      }

      // Success
      const data = await response.json();
      return { ok: true, value: data };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Parse rate limit information from response headers
   */
  private parseRateLimitHeaders(headers: Headers): void {
    const limit = headers.get('ratelimit-limit');
    const remaining = headers.get('ratelimit-remaining');
    const reset = headers.get('ratelimit-reset');
    const policy = headers.get('ratelimit-policy');

    if (limit && remaining && reset) {
      this.lastRateLimitInfo = {
        limit: parseInt(limit),
        remaining: parseInt(remaining),
        reset: parseInt(reset),
        policy: policy || '',
      };
    }
  }
}
```

**Step 2: Run test to verify it passes**

Run: `npm test src/api/bluesky-client.test.ts`

Expected: All tests pass

**Step 3: Commit**

```bash
git add src/api/bluesky-client.ts
git commit -m "feat: implement Bluesky AT Protocol client

- getPostThread with configurable depth and parent height
- getQuotes with cursor-based pagination
- Automatic 429 retry with exponential backoff
- Rate limit header parsing and tracking
- Integration with token bucket rate limiter
- All tests passing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Verify Bluesky client coverage

**Files:**
- Verify: `src/api/bluesky-client.test.ts` and `src/api/bluesky-client.ts`

**Step 1: Run coverage check**

Run: `npm run test:coverage -- src/api/bluesky-client`

Expected: Coverage ≥95% for bluesky-client.ts

**Step 2: Review uncovered lines**

Run: `npm run test:coverage -- src/api/bluesky-client --reporter=html`

Then open: `coverage/index.html` in browser

Expected: All critical paths covered (happy path, errors, retries, header parsing)

**Step 3: If coverage <95%, add missing tests**

Common gaps to cover:
- Network errors (fetch throws)
- Invalid JSON responses
- Missing rate limit headers (partial headers)
- Edge case: retry after exactly equals max retries

**Step 4: Commit if tests were added**

If additional tests were needed:

```bash
git add src/api/bluesky-client.test.ts
git commit -m "test: increase Bluesky client coverage to 95%+

- Add network error tests
- Add malformed response tests
- Ensure all branches covered

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

Otherwise: No commit needed
<!-- END_TASK_7 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_8 -->
### Task 8: Create API module index and verify phase

**Files:**
- Create: `src/api/index.ts`

**Step 1: Create barrel export for API module**

```typescript
export { BlueskyClient } from './bluesky-client';
export type { GetPostThreadOptions, GetQuotesOptions } from './bluesky-client';
export { RateLimiter, getRateLimiter, resetRateLimiter } from './rate-limiter';
export type { RateLimiterOptions, RateLimiterStats } from './rate-limiter';
```

**Step 2: Run full test suite for Phase 2**

Run: `npm test src/api/`

Expected: All API tests pass (rate limiter + Bluesky client)

**Step 3: Run coverage for entire API module**

Run: `npm run test:coverage -- src/api/`

Expected: Overall coverage ≥95%

**Step 4: Run type checking**

Run: `npm run type-check`

Expected: No type errors

**Step 5: Run linting**

Run: `npm run lint`

Expected: No linting errors

**Step 6: Commit**

```bash
git add src/api/index.ts
git commit -m "feat: add API module barrel exports

- Export BlueskyClient and types
- Export RateLimiter and helpers
- Clean public API surface

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
<!-- END_TASK_8 -->

---

## Phase 2 Complete

**Deliverables:**
- ✓ src/types.ts with AT Protocol type definitions
- ✓ src/api/rate-limiter.ts with token bucket algorithm (2500 req/5min, 50ms min delay)
- ✓ src/api/rate-limiter.test.ts with comprehensive tests (95%+ coverage)
- ✓ src/api/bluesky-client.ts with getPostThread and getQuotes methods
- ✓ src/api/bluesky-client.test.ts with retry and error handling tests (95%+ coverage)
- ✓ src/api/index.ts barrel exports
- ✓ All tests passing
- ✓ 95%+ coverage achieved

**Verification:**
- `npm test src/api/` passes all tests
- `npm run test:coverage -- src/api/` shows ≥95% coverage
- `npm run validate` passes (type-check, lint, format, tests)

**Next Phase:** Phase 3 will implement thread tree building and mention extraction from post text
