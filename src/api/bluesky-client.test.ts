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
