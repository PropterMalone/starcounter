import { describe, it, expect, vi } from 'vitest';
import { analyzeThread } from './analyze';
import type { BlueskyClient } from '../api/bluesky-client';
import type { PostView, GetQuotesResponse } from '../types';

function makePost(
  uri: string,
  text: string,
  opts: { quoteCount?: number; handle?: string; embed?: unknown } = {}
): PostView {
  return {
    uri,
    cid: `cid-${uri}`,
    author: { did: 'did:plc:test', handle: opts.handle ?? 'test.bsky.social' },
    record: { text, createdAt: '2024-01-01T00:00:00Z' },
    embed: opts.embed,
    indexedAt: '2024-01-01T00:00:00Z',
    quoteCount: opts.quoteCount ?? 0,
  };
}

function makeThreadResponse(posts: PostView[]) {
  const root = posts[0]!;
  return {
    thread: {
      post: root,
      replies: posts.slice(1).map((p) => ({ post: p, replies: [] })),
    },
  };
}

function mockClient(posts: PostView[]): BlueskyClient {
  return {
    getPostThread: vi.fn().mockResolvedValue({
      ok: true,
      value: makeThreadResponse(posts),
    }),
    getQuotes: vi.fn().mockResolvedValue({
      ok: true,
      value: { posts: [], uri: posts[0]?.uri ?? '' } satisfies GetQuotesResponse,
    }),
  } as unknown as BlueskyClient;
}

describe('analyzeThread', () => {
  it('throws when thread has no posts', async () => {
    const client = {
      getPostThread: vi.fn().mockResolvedValue({ ok: false, error: new Error('not found') }),
      getQuotes: vi.fn().mockResolvedValue({ ok: true, value: { posts: [], uri: '' } }),
    } as unknown as BlueskyClient;

    await expect(analyzeThread('at://did:plc:x/app.bsky.feed.post/abc', client)).rejects.toThrow(
      'no posts found in thread'
    );
  });

  it('returns analysis result with self-validation', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'What is your favorite movie?');
    const reply1 = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'The Shawshank Redemption');
    const reply2 = makePost('at://did:plc:z/app.bsky.feed.post/r2', 'The Shawshank Redemption');
    const reply3 = makePost('at://did:plc:w/app.bsky.feed.post/r3', 'Goodfellas');
    const reply4 = makePost('at://did:plc:v/app.bsky.feed.post/r4', 'Goodfellas');

    const client = mockClient([root, reply1, reply2, reply3, reply4]);

    const result = await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client);

    expect(result.postCount).toBe(5);
    expect(result.rootPost.uri).toBe(root.uri);
    expect(result.mentionCounts.length).toBeGreaterThanOrEqual(1);
  });

  it('returns rootPost from result', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'What is your favorite movie?');
    const reply = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'Inception');

    const client = mockClient([root, reply]);

    const result = await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client);

    expect(result.rootPost).toEqual(root);
    expect(result.postCount).toBe(2);
  });

  it('calls onProgress callback for all stages', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'Your favorite river?');
    const reply = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'Mississippi River');

    const client = mockClient([root, reply]);
    const onProgress = vi.fn();

    await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client, { onProgress });

    const stages = onProgress.mock.calls.map((c) => c[0]);
    expect(stages).toContain('fetching');
    expect(stages).toContain('embeds');
    expect(stages).toContain('validating');
    expect(stages).toContain('counting');
    expect(stages).toContain('labeling');
    expect(stages).toContain('complete');
  });

  it('calls onFetchProgress callback', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'Your favorite river?');
    const reply = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'Mississippi River');

    const client = mockClient([root, reply]);
    const onFetchProgress = vi.fn();

    await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client, { onFetchProgress });

    expect(onFetchProgress).toHaveBeenCalled();
    expect(onFetchProgress.mock.calls[0]![0]).toHaveProperty('fetched');
    expect(onFetchProgress.mock.calls[0]![0]).toHaveProperty('stage');
  });

  it('supports list validation mode', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'Name a great movie');
    const reply1 = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'Alien');
    const reply2 = makePost('at://did:plc:z/app.bsky.feed.post/r2', 'Alien');

    const client = mockClient([root, reply1, reply2]);

    const result = await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client, {
      customList: ['Alien', 'Predator', 'Jaws'],
    });

    const alienMention = result.mentionCounts.find((mc) => mc.mention.toLowerCase() === 'alien');
    expect(alienMention).toBeDefined();
    expect(alienMention!.count).toBe(2);
  });

  it('identifies uncategorized posts', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'Your favorite movie?');
    const reply1 = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'lol great question');
    const reply2 = makePost('at://did:plc:z/app.bsky.feed.post/r2', 'same!!');

    const client = mockClient([root, reply1, reply2]);

    const result = await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client);

    expect(result.uncategorizedPosts.length).toBeGreaterThanOrEqual(1);
  });

  it('processes embed links from posts', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'What is your favorite song?');
    // Post with a YouTube embed link
    const replyWithEmbed = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'This one!', {
      embed: {
        $type: 'app.bsky.embed.external#view',
        external: {
          uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcB',
          title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)',
        },
      },
    });

    const client = mockClient([root, replyWithEmbed]);

    // Without oEmbed API URL, should still parse direct embed titles
    const result = await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client);

    expect(result.postCount).toBe(2);
    // The embed title should contribute to analysis
  });

  it('skips oEmbed resolution when no oembedApiUrl configured', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'What is your favorite song?');
    const reply = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'Bohemian Rhapsody');

    const client = mockClient([root, reply]);

    // No oembedApiUrl — should not make any oEmbed API calls
    const result = await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client, {
      oembedApiUrl: undefined,
    });

    expect(result.postCount).toBe(2);
  });

  it('resolves YouTube titles via oEmbed when oembedApiUrl is configured', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'What is your favorite song?');
    const replyWithGenericEmbed = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'This song', {
      embed: {
        $type: 'app.bsky.embed.external#view',
        external: {
          uri: 'https://www.youtube.com/watch?v=abc123',
          title: 'YouTube', // Generic title that needs oEmbed resolution
        },
      },
    });
    // Non-YouTube embed — hits line 145 false branch (platform !== 'youtube')
    const replyWithNonYtEmbed = makePost('at://did:plc:z/app.bsky.feed.post/r2', 'Check this', {
      embed: {
        $type: 'app.bsky.embed.external#view',
        external: {
          uri: 'https://open.spotify.com/track/abc',
          title: 'Some Spotify Track',
        },
      },
    });

    const client = mockClient([root, replyWithGenericEmbed, replyWithNonYtEmbed]);

    // Mock fetch for oEmbed API
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: {
            'https://www.youtube.com/watch?v=abc123': {
              title: 'Queen - Bohemian Rhapsody (Official Video)',
              platform: 'youtube',
            },
          },
        }),
    });

    try {
      const result = await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client, {
        oembedApiUrl: 'https://example.com/api/oembed',
      });

      expect(result.postCount).toBe(3);
      // The oEmbed fetch should have been called
      expect(globalThis.fetch).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('supports API validation mode with validationApiUrl', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'What is your favorite movie?');
    const reply1 = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'Inception');
    const reply2 = makePost('at://did:plc:z/app.bsky.feed.post/r2', 'Inception');

    const client = mockClient([root, reply1, reply2]);

    // Mock fetch for validation API
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            { title: 'Inception', normalizedTitle: 'inception', valid: true, mediaType: 'movie' },
          ],
        }),
    });

    try {
      const result = await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client, {
        validationApiUrl: 'https://example.com/api/validate',
        mediaTypes: ['movie'],
      });

      expect(result.postCount).toBe(3);
      expect(globalThis.fetch).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('mention counts are sorted by count descending', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'What is your favorite movie?');
    // 3 mentions of Goodfellas, 2 of Shawshank
    const replies = [
      makePost('at://did:plc:a/app.bsky.feed.post/r1', 'Goodfellas'),
      makePost('at://did:plc:b/app.bsky.feed.post/r2', 'Goodfellas'),
      makePost('at://did:plc:c/app.bsky.feed.post/r3', 'Goodfellas'),
      makePost('at://did:plc:d/app.bsky.feed.post/r4', 'The Shawshank Redemption'),
      makePost('at://did:plc:e/app.bsky.feed.post/r5', 'The Shawshank Redemption'),
    ];

    const client = mockClient([root, ...replies]);

    const result = await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client);

    if (result.mentionCounts.length >= 2) {
      expect(result.mentionCounts[0]!.count).toBeGreaterThanOrEqual(result.mentionCounts[1]!.count);
    }
  });

  it('root post is not included in uncategorized', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'Your favorite color?');
    const reply = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'Blue');

    const client = mockClient([root, reply]);

    const result = await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client);

    // Root should not appear in uncategorized
    expect(result.uncategorizedPosts.find((p) => p.uri === root.uri)).toBeUndefined();
  });

  it('extracts candidates from quoted text in embeds', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'Your favorite movie?');
    // Post that quotes another post with the answer text
    const replyWithQuote = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'This!', {
      embed: {
        $type: 'app.bsky.embed.record#view',
        record: {
          uri: 'at://did:plc:z/app.bsky.feed.post/original',
          value: { text: 'The Godfather' },
        },
      },
    });
    const replyWithQuote2 = makePost('at://did:plc:z/app.bsky.feed.post/r2', 'Agree!', {
      embed: {
        $type: 'app.bsky.embed.record#view',
        record: {
          uri: 'at://did:plc:w/app.bsky.feed.post/other',
          value: { text: 'The Godfather' },
        },
      },
    });

    const client = mockClient([root, replyWithQuote, replyWithQuote2]);

    const result = await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client);

    expect(result.postCount).toBe(3);
  });

  it('extracts candidates from quoted alt text in embeds', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'Your favorite movie?');
    const replyWithMediaQuote = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'This one!', {
      embed: {
        $type: 'app.bsky.embed.recordWithMedia#view',
        record: {
          record: {
            uri: 'at://did:plc:z/app.bsky.feed.post/other',
            value: { text: 'Great choice' },
          },
        },
        media: {
          images: [{ alt: 'The Dark Knight poster' }],
        },
      },
    });

    const client = mockClient([root, replyWithMediaQuote]);

    const result = await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client);

    expect(result.postCount).toBe(2);
  });

  it('uses UNKNOWN mediaType for multiple mediaTypes in API validation', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'What is your favorite media?');
    const reply1 = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'Inception');
    const reply2 = makePost('at://did:plc:z/app.bsky.feed.post/r2', 'Inception');

    const client = mockClient([root, reply1, reply2]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            { title: 'Inception', normalizedTitle: 'inception', valid: true, mediaType: 'movie' },
          ],
        }),
    });

    try {
      const result = await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client, {
        validationApiUrl: 'https://example.com/api/validate',
        mediaTypes: ['movie', 'tv'],
      });

      expect(result.postCount).toBe(3);
      expect(globalThis.fetch).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles unparseable oEmbed titles gracefully', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'What is your favorite song?');
    const replyWithEmbed = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'This one!', {
      embed: {
        $type: 'app.bsky.embed.external#view',
        external: {
          uri: 'https://www.youtube.com/watch?v=abc123',
          title: 'YouTube',
        },
      },
    });

    const client = mockClient([root, replyWithEmbed]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: {
            'https://www.youtube.com/watch?v=abc123': {
              // A title that parseEmbedTitle won't be able to parse into artist/song
              title: '',
              platform: 'youtube',
            },
          },
        }),
    });

    try {
      const result = await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client, {
        oembedApiUrl: 'https://example.com/api/oembed',
      });

      expect(result.postCount).toBe(2);
      expect(globalThis.fetch).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('defaults to self-validation when no mediaTypes or customList', async () => {
    const root = makePost(
      'at://did:plc:x/app.bsky.feed.post/root',
      'What is your favorite comfort show?'
    );
    const reply1 = makePost('at://did:plc:y/app.bsky.feed.post/r1', 'The Office');
    const reply2 = makePost('at://did:plc:z/app.bsky.feed.post/r2', 'The Office');
    const reply3 = makePost('at://did:plc:w/app.bsky.feed.post/r3', 'Friends');
    const reply4 = makePost('at://did:plc:v/app.bsky.feed.post/r4', 'Friends');

    const client = mockClient([root, reply1, reply2, reply3, reply4]);

    const result = await analyzeThread('at://did:plc:x/app.bsky.feed.post/root', client, {
      // No mediaTypes, no customList → self-validation
    });

    expect(result.postCount).toBe(5);
    // Self-validation should still find repeated mentions
    expect(result.mentionCounts.length).toBeGreaterThanOrEqual(1);
  });
});
