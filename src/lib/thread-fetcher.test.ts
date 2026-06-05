import { describe, it, expect, vi } from 'vitest';
import { fetchThreadPosts } from './thread-fetcher';
import type { BlueskyClient } from '../api/bluesky-client';
import type { PostView, GetPostThreadResponse, GetQuotesResponse } from '../types';

function makePost(
  uri: string,
  text = 'hello',
  opts: { quoteCount?: number; replyCount?: number } = {}
): PostView {
  return {
    uri,
    cid: `cid-${uri}`,
    author: { did: 'did:plc:test', handle: 'test.bsky.social' },
    record: { text, createdAt: '2024-01-01T00:00:00Z' },
    indexedAt: '2024-01-01T00:00:00Z',
    quoteCount: opts.quoteCount ?? 0,
    replyCount: opts.replyCount ?? 0,
  };
}

function makeThreadResponse(posts: PostView[]): GetPostThreadResponse {
  const root = posts[0]!;
  return {
    thread: {
      post: root,
      replies: posts.slice(1).map((p) => ({ post: p, replies: [] })),
    },
  };
}

type MockBuildTree = {
  allPosts: PostView[];
  truncatedPosts: Array<{ uri: string; expectedReplies: number; actualReplies: number }>;
  post: PostView;
};

function makeMockBuilder(trees: Map<string, MockBuildTree>) {
  return {
    buildTree: vi.fn((thread) => {
      const root = (thread as { post: PostView }).post;
      const tree = trees.get(root.uri);
      if (tree) {
        return {
          ...tree,
          branches: [],
          restrictedPosts: [],
          getParent: () => null,
          getBranchAuthors: () => [],
          flattenPosts: () => tree.allPosts,
        };
      }
      return {
        post: root,
        branches: [],
        allPosts: [root],
        truncatedPosts: [],
        restrictedPosts: [],
        getParent: () => null,
        getBranchAuthors: () => [],
        flattenPosts: () => [root],
      };
    }),
  };
}

function mockClient(overrides: Partial<BlueskyClient> = {}): BlueskyClient {
  return {
    getPostThread: vi.fn().mockResolvedValue({ ok: false, error: new Error('not mocked') }),
    getQuotes: vi.fn().mockResolvedValue({ ok: true, value: { posts: [], uri: '' } }),
    ...overrides,
  } as unknown as BlueskyClient;
}

function simpleBuilder() {
  return {
    buildTree: vi.fn((thread) => {
      const root = thread as { post: PostView; replies?: Array<{ post: PostView }> };
      const allPosts = [root.post, ...(root.replies ?? []).map((r) => r.post)];
      return {
        post: root.post,
        branches: [],
        allPosts,
        truncatedPosts: [],
        restrictedPosts: [],
        getParent: () => null,
        getBranchAuthors: () => [],
        flattenPosts: () => allPosts,
      };
    }),
  };
}

describe('fetchThreadPosts', () => {
  it('returns empty result when thread fetch fails', async () => {
    const client = mockClient();
    const builder = simpleBuilder();

    const result = await fetchThreadPosts('at://did:plc:x/app.bsky.feed.post/abc', client, builder);

    expect(result.allPosts).toHaveLength(0);
    expect(result.rootPost).toBeNull();
  });

  it('returns thread posts on successful fetch', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'root post');
    const reply = makePost('at://did:plc:x/app.bsky.feed.post/reply1', 'reply');
    const threadResponse = makeThreadResponse([root, reply]);

    const client = mockClient({
      getPostThread: vi.fn().mockResolvedValue({ ok: true, value: threadResponse }),
    });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    expect(result.allPosts).toHaveLength(2);
    expect(result.rootPost).toEqual(root);
  });

  it('calls onPostsBatch with fetched posts', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const threadResponse = makeThreadResponse([root]);

    const client = mockClient({
      getPostThread: vi.fn().mockResolvedValue({ ok: true, value: threadResponse }),
    });
    const builder = simpleBuilder();
    const onPostsBatch = vi.fn();

    await fetchThreadPosts('at://did:plc:x/app.bsky.feed.post/root', client, builder, {
      onPostsBatch,
    });

    expect(onPostsBatch).toHaveBeenCalledWith([root]);
  });

  it('calls onProgress with all fetch stages', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const threadResponse = makeThreadResponse([root]);

    const client = mockClient({
      getPostThread: vi.fn().mockResolvedValue({ ok: true, value: threadResponse }),
    });
    const builder = simpleBuilder();
    const onProgress = vi.fn();

    await fetchThreadPosts('at://did:plc:x/app.bsky.feed.post/root', client, builder, {
      onProgress,
    });

    const stages = onProgress.mock.calls.map((c) => c[0].stage);
    expect(stages).toContain('thread');
    expect(stages).toContain('quotes');
    expect(stages).toContain('recursive');
  });

  it('fetches quote posts and adds them', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const quotePost = makePost('at://did:plc:y/app.bsky.feed.post/quote1', 'quoting');

    const getPostThread = vi
      .fn()
      // First call: main thread
      .mockResolvedValueOnce({ ok: true, value: makeThreadResponse([root]) })
      // Second call: quote thread
      .mockResolvedValue({ ok: true, value: makeThreadResponse([quotePost]) });

    const getQuotes = vi
      .fn()
      // First page: return the quote post
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [quotePost], uri: root.uri } satisfies GetQuotesResponse,
      })
      // No more quotes
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    expect(result.allPosts.length).toBeGreaterThanOrEqual(2);
    expect(result.allPosts.some((p) => p.uri === quotePost.uri)).toBe(true);
  });

  it('deduplicates posts across thread and quotes', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const reply = makePost('at://did:plc:x/app.bsky.feed.post/reply1');

    const client = mockClient({
      getPostThread: vi.fn().mockResolvedValue({
        ok: true,
        value: makeThreadResponse([root, reply]),
      }),
      getQuotes: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: { posts: [reply], uri: root.uri } satisfies GetQuotesResponse,
        })
        .mockResolvedValue({
          ok: true,
          value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
        }),
    });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    const replyOccurrences = result.allPosts.filter((p) => p.uri === reply.uri);
    expect(replyOccurrences).toHaveLength(1);
  });

  it('handles quote fetch failure gracefully', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');

    const client = mockClient({
      getPostThread: vi.fn().mockResolvedValue({
        ok: true,
        value: makeThreadResponse([root]),
      }),
      getQuotes: vi.fn().mockResolvedValue({
        ok: false,
        error: new Error('quotes failed'),
      }),
    });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // Should still return the root post
    expect(result.allPosts).toHaveLength(1);
    expect(result.rootPost).toEqual(root);
  });

  it('fetches truncated subtrees', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'root', { replyCount: 5 });
    const reply1 = makePost('at://did:plc:x/app.bsky.feed.post/r1');
    const truncatedChild = makePost('at://did:plc:x/app.bsky.feed.post/tc1');

    // Build tree map that returns truncation info for root
    const trees = new Map<string, MockBuildTree>();
    trees.set(root.uri, {
      post: root,
      allPosts: [root, reply1],
      truncatedPosts: [{ uri: root.uri, expectedReplies: 5, actualReplies: 1 }],
    });
    trees.set(truncatedChild.uri, {
      post: truncatedChild,
      // Include reply1 (already visited) to hit dedup branch in fetchTruncatedSubtree
      allPosts: [truncatedChild, reply1],
      truncatedPosts: [],
    });

    const getPostThread = vi
      .fn()
      // Main thread
      .mockResolvedValueOnce({
        ok: true,
        value: { thread: { post: root, replies: [{ post: reply1, replies: [] }] } },
      })
      // Truncated subtree fetch
      .mockResolvedValueOnce({
        ok: true,
        value: { thread: { post: truncatedChild, replies: [] } },
      })
      // Anything else
      .mockResolvedValue({ ok: false, error: new Error('done') });

    const builder = makeMockBuilder(trees);
    const client = mockClient({
      getPostThread,
      getQuotes: vi.fn().mockResolvedValue({
        ok: true,
        value: { posts: [], uri: root.uri },
      }),
    });

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // Should have root + reply1 + truncatedChild
    expect(result.allPosts.length).toBeGreaterThanOrEqual(2);
    expect(getPostThread).toHaveBeenCalledTimes(2);
  });

  it('performs recursive QT crawl for posts with high quoteCount', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    // A reply with enough quotes to trigger recursive QT crawl
    const highQtPost = makePost('at://did:plc:x/app.bsky.feed.post/hq', 'popular', {
      quoteCount: 5,
    });
    const nestedQt = makePost('at://did:plc:y/app.bsky.feed.post/nqt', 'nested QT');

    const getPostThread = vi
      .fn()
      // Main thread
      .mockResolvedValueOnce({
        ok: true,
        value: makeThreadResponse([root, highQtPost]),
      })
      // Thread for nestedQt
      .mockResolvedValue({ ok: true, value: makeThreadResponse([nestedQt]) });

    const getQuotes = vi
      .fn()
      // Root quotes — none
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
      })
      // QT crawl for highQtPost — return nestedQt
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [nestedQt], uri: highQtPost.uri } satisfies GetQuotesResponse,
      })
      // No more
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // Should find root, highQtPost, and nestedQt
    expect(result.allPosts.length).toBeGreaterThanOrEqual(3);
    expect(result.allPosts.some((p) => p.uri === nestedQt.uri)).toBe(true);
  });

  it('fetches reply threads for QT posts with replies', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const highQtPost = makePost('at://did:plc:x/app.bsky.feed.post/hq', 'popular', {
      quoteCount: 5,
    });
    // A QT that itself has replies
    const qtWithReplies = makePost('at://did:plc:y/app.bsky.feed.post/qtr', 'qt', {
      replyCount: 2,
    });
    const qtReply = makePost('at://did:plc:z/app.bsky.feed.post/qtr-reply', 'reply to qt');

    const getPostThread = vi
      .fn()
      // Main thread
      .mockResolvedValueOnce({
        ok: true,
        value: makeThreadResponse([root, highQtPost]),
      })
      // Thread for qtWithReplies (reply fetch)
      .mockResolvedValue({
        ok: true,
        value: makeThreadResponse([qtWithReplies, qtReply]),
      });

    const getQuotes = vi
      .fn()
      // Root quotes
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
      })
      // QT crawl for highQtPost
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [qtWithReplies], uri: highQtPost.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // Should have found the reply to the QT
    expect(result.allPosts.some((p) => p.uri === qtReply.uri)).toBe(true);
  });

  it('respects MAX_QT_DEPTH and stops crawling', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    // Create a chain of high-QT posts
    const qtChain: PostView[] = [];
    for (let i = 0; i < 15; i++) {
      qtChain.push(
        makePost(`at://did:plc:x/app.bsky.feed.post/qt${i}`, `qt${i}`, {
          quoteCount: 5,
        })
      );
    }

    const getPostThread = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: makeThreadResponse([root, ...qtChain]),
      })
      .mockResolvedValue({
        ok: true,
        value: makeThreadResponse([makePost('at://did:plc:x/app.bsky.feed.post/deep', 'deep')]),
      });

    const getQuotes = vi.fn().mockImplementation(() => {
      // Return empty to terminate quickly after some crawling
      return Promise.resolve({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });
    });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // Should have at least root + qtChain posts
    expect(result.allPosts.length).toBeGreaterThanOrEqual(1);
    // QT crawl should have been attempted for the chain posts
    expect(getQuotes).toHaveBeenCalled();
  });

  it('fetches reply threads for quote posts and adds new reply posts', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const quotePost = makePost('at://did:plc:y/app.bsky.feed.post/qt1', 'quoting');
    const quoteReply = makePost('at://did:plc:z/app.bsky.feed.post/qr1', 'reply to quote');

    const getPostThread = vi
      .fn()
      // Main thread
      .mockResolvedValueOnce({ ok: true, value: makeThreadResponse([root]) })
      // Quote's reply thread — returns quote + new reply
      .mockResolvedValue({ ok: true, value: makeThreadResponse([quotePost, quoteReply]) });

    const getQuotes = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [quotePost], uri: root.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();
    const onPostsBatch = vi.fn();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder,
      { onPostsBatch }
    );

    // Should include root, quotePost, and quoteReply
    expect(result.allPosts.some((p) => p.uri === quoteReply.uri)).toBe(true);
    // onPostsBatch should have been called with the new reply posts
    const allBatchedPosts = onPostsBatch.mock.calls.flatMap((c) => c[0]);
    expect(allBatchedPosts.some((p: PostView) => p.uri === quoteReply.uri)).toBe(true);
  });

  it('queues QTs of QTs for further crawling', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const highQtPost = makePost('at://did:plc:x/app.bsky.feed.post/hq', 'popular', {
      quoteCount: 5,
    });
    // A QT that itself has many quotes (should be queued for further crawling)
    const qtOfQt = makePost('at://did:plc:y/app.bsky.feed.post/qqt', 'nested qt', {
      quoteCount: 10,
    });
    const deepQt = makePost('at://did:plc:z/app.bsky.feed.post/deep', 'deep qt');

    const getPostThread = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: makeThreadResponse([root, highQtPost]),
      })
      .mockResolvedValue({
        ok: true,
        value: makeThreadResponse([qtOfQt]),
      });

    const getQuotes = vi
      .fn()
      // Root quotes
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
      })
      // QTs of highQtPost
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [qtOfQt], uri: highQtPost.uri } satisfies GetQuotesResponse,
      })
      // QTs of qtOfQt (the queued further crawl)
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [deepQt], uri: qtOfQt.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // qtOfQt should have been queued and deepQt found
    expect(result.allPosts.some((p) => p.uri === deepQt.uri)).toBe(true);
    // getQuotes should have been called for qtOfQt as well
    expect(getQuotes).toHaveBeenCalledTimes(3);
  });

  it('queues posts from QT reply threads that have high quoteCount', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const highQtPost = makePost('at://did:plc:x/app.bsky.feed.post/hq', 'popular', {
      quoteCount: 5,
    });
    // A QT with replies
    const qtWithReplies = makePost('at://did:plc:y/app.bsky.feed.post/qtr', 'qt', {
      replyCount: 2,
    });
    // A reply to that QT that itself has many quotes
    const replyWithHighQt = makePost('at://did:plc:z/app.bsky.feed.post/rhq', 'viral reply', {
      quoteCount: 8,
    });

    const getPostThread = vi
      .fn()
      // Main thread
      .mockResolvedValueOnce({
        ok: true,
        value: makeThreadResponse([root, highQtPost]),
      })
      // Reply thread of qtWithReplies → includes replyWithHighQt
      .mockResolvedValue({
        ok: true,
        value: makeThreadResponse([qtWithReplies, replyWithHighQt]),
      });

    const getQuotes = vi
      .fn()
      // Root quotes
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
      })
      // QTs of highQtPost
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [qtWithReplies], uri: highQtPost.uri } satisfies GetQuotesResponse,
      })
      // QTs of replyWithHighQt (queued from reply thread scan)
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [], uri: replyWithHighQt.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // replyWithHighQt should have been found and its QTs crawled
    expect(result.allPosts.some((p) => p.uri === replyWithHighQt.uri)).toBe(true);
    // getQuotes should have been called for replyWithHighQt too
    expect(getQuotes.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('returns empty when truncated subtree fetch fails', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'root', { replyCount: 5 });
    const reply1 = makePost('at://did:plc:x/app.bsky.feed.post/r1');

    const trees = new Map<string, MockBuildTree>();
    trees.set(root.uri, {
      post: root,
      allPosts: [root, reply1],
      truncatedPosts: [{ uri: root.uri, expectedReplies: 5, actualReplies: 1 }],
    });

    const getPostThread = vi
      .fn()
      // Main thread — success
      .mockResolvedValueOnce({
        ok: true,
        value: { thread: { post: root, replies: [{ post: reply1, replies: [] }] } },
      })
      // Truncated subtree fetch — fails
      .mockResolvedValueOnce({ ok: false, error: new Error('subtree failed') })
      .mockResolvedValue({ ok: false, error: new Error('done') });

    const builder = makeMockBuilder(trees);
    const client = mockClient({
      getPostThread,
      getQuotes: vi.fn().mockResolvedValue({ ok: true, value: { posts: [], uri: root.uri } }),
    });

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // Should still have root + reply1 from initial fetch, but no truncated subtree posts
    expect(result.allPosts.length).toBe(2);
    expect(getPostThread).toHaveBeenCalledTimes(2);
  });

  it('fetches nested truncated subtrees recursively', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'root', { replyCount: 10 });
    const reply1 = makePost('at://did:plc:x/app.bsky.feed.post/r1');
    const deepPost = makePost('at://did:plc:x/app.bsky.feed.post/deep');
    const deeperPost = makePost('at://did:plc:x/app.bsky.feed.post/deeper');

    const trees = new Map<string, MockBuildTree>();
    // Main tree has truncation
    trees.set(root.uri, {
      post: root,
      allPosts: [root, reply1],
      truncatedPosts: [{ uri: root.uri, expectedReplies: 10, actualReplies: 1 }],
    });
    // First subtree fetch ALSO has truncation (nested truncation)
    trees.set(deepPost.uri, {
      post: deepPost,
      allPosts: [deepPost],
      truncatedPosts: [{ uri: deepPost.uri, expectedReplies: 5, actualReplies: 0 }],
    });
    // Second (nested) subtree fetch — no more truncation
    trees.set(deeperPost.uri, {
      post: deeperPost,
      allPosts: [deeperPost],
      truncatedPosts: [],
    });

    const getPostThread = vi
      .fn()
      // Main thread
      .mockResolvedValueOnce({
        ok: true,
        value: { thread: { post: root, replies: [{ post: reply1, replies: [] }] } },
      })
      // First truncated subtree → returns deepPost
      .mockResolvedValueOnce({
        ok: true,
        value: { thread: { post: deepPost, replies: [] } },
      })
      // Second (nested) truncated subtree → returns deeperPost
      .mockResolvedValueOnce({
        ok: true,
        value: { thread: { post: deeperPost, replies: [] } },
      })
      .mockResolvedValue({ ok: false, error: new Error('done') });

    const builder = makeMockBuilder(trees);
    const client = mockClient({
      getPostThread,
      getQuotes: vi.fn().mockResolvedValue({ ok: true, value: { posts: [], uri: root.uri } }),
    });

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // Should have found deeperPost through nested truncation
    expect(result.allPosts.some((p) => p.uri === deeperPost.uri)).toBe(true);
    // 3 getPostThread calls: main + first truncated + nested truncated
    expect(getPostThread).toHaveBeenCalledTimes(3);
  });

  it('skips already-fetched items in QT queue', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    // Two posts that both qualify for QT crawl but share the same URI
    // (simulated by having root URI already in fetchedQtSources)
    const qtPost = makePost('at://did:plc:x/app.bsky.feed.post/qt', 'popular', {
      quoteCount: 5,
    });
    // The root post gets its QTs fetched in Stage 3, so its URI is already in fetchedQtSources.
    // qtPost is the only new one that should be fetched in Stage 4.
    const nestedQt = makePost('at://did:plc:y/app.bsky.feed.post/nqt', 'nested');

    const getPostThread = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: makeThreadResponse([root, qtPost]) })
      .mockResolvedValue({ ok: true, value: makeThreadResponse([nestedQt]) });

    const getQuotes = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [nestedQt], uri: qtPost.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    expect(result.allPosts.some((p) => p.uri === nestedQt.uri)).toBe(true);
  });

  it('handles getQuotes failure during recursive QT crawl', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const qtPost = makePost('at://did:plc:x/app.bsky.feed.post/qt', 'popular', {
      quoteCount: 5,
    });

    const getPostThread = vi
      .fn()
      .mockResolvedValue({ ok: true, value: makeThreadResponse([root, qtPost]) });

    const getQuotes = vi
      .fn()
      // Stage 3: root quotes
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
      })
      // Stage 4: QT crawl fails
      .mockResolvedValueOnce({
        ok: false,
        error: new Error('qt crawl failed'),
      })
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // Should still have root + qtPost from the main thread
    expect(result.allPosts.length).toBe(2);
  });

  it('deduplicates already-visited quotes in recursive QT crawl', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const reply = makePost('at://did:plc:x/app.bsky.feed.post/r1');
    const qtPost = makePost('at://did:plc:x/app.bsky.feed.post/qt', 'popular', {
      quoteCount: 5,
    });

    const getPostThread = vi
      .fn()
      .mockResolvedValue({ ok: true, value: makeThreadResponse([root, reply, qtPost]) });

    const getQuotes = vi
      .fn()
      // Stage 3: root quotes
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
      })
      // Stage 4: QT crawl returns a post already in the main thread (reply)
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [reply], uri: qtPost.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // reply should appear only once (dedup)
    const replyCount = result.allPosts.filter((p) => p.uri === reply.uri).length;
    expect(replyCount).toBe(1);
  });

  it('handles reply thread fetch failure in recursive QT crawl', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const qtPost = makePost('at://did:plc:x/app.bsky.feed.post/qt', 'popular', {
      quoteCount: 5,
    });
    // A QT with replies — reply thread fetch will fail
    const qtWithReplies = makePost('at://did:plc:y/app.bsky.feed.post/qtr', 'qt', {
      replyCount: 3,
    });

    const getPostThread = vi
      .fn()
      // Main thread
      .mockResolvedValueOnce({ ok: true, value: makeThreadResponse([root, qtPost]) })
      // Reply thread fetch for qtWithReplies — fails
      .mockResolvedValue({ ok: true, value: { thread: { post: qtWithReplies, replies: [] } } });

    // Override to fail the reply thread
    const callIndex = { n: 0 };
    getPostThread.mockImplementation(() => {
      callIndex.n++;
      if (callIndex.n === 1) {
        return Promise.resolve({ ok: true, value: makeThreadResponse([root, qtPost]) });
      }
      // Reply thread fetches return ok: false
      return Promise.resolve({ ok: false, error: new Error('reply failed') });
    });

    const getQuotes = vi
      .fn()
      // Stage 3: root quotes
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
      })
      // Stage 4: QT crawl returns qtWithReplies
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [qtWithReplies], uri: qtPost.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // Should still have root + qtPost + qtWithReplies despite reply fetch failure
    expect(result.allPosts.some((p) => p.uri === qtWithReplies.uri)).toBe(true);
  });

  it('handles empty QT batch when all items are already fetched', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    // Post with quoteCount but its URI matches the root (which is already in fetchedQtSources)
    // We can't make it the SAME uri as root because root is the DID-based uri...
    // Instead, ensure the qtQueue items get filtered by fetchedQtSources.has
    const qtPost1 = makePost('at://did:plc:x/app.bsky.feed.post/qt1', 'a', { quoteCount: 5 });
    const qtPost2 = makePost('at://did:plc:x/app.bsky.feed.post/qt2', 'b', { quoteCount: 5 });
    const nestedQt = makePost('at://did:plc:y/app.bsky.feed.post/nqt', 'nested');

    const getPostThread = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: makeThreadResponse([root, qtPost1, qtPost2]) })
      .mockResolvedValue({ ok: true, value: makeThreadResponse([nestedQt]) });

    const getQuotes = vi
      .fn()
      // Stage 3: root quotes
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
      })
      // QT crawl for qtPost1 — returns qtPost2 (which is in allPosts and visited, but may get queued again)
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [nestedQt], uri: qtPost1.uri } satisfies GetQuotesResponse,
      })
      // QT crawl for qtPost2
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [], uri: qtPost2.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    expect(result.allPosts.some((p) => p.uri === nestedQt.uri)).toBe(true);
  });

  it('skips queueing QTs whose URI is already in fetchedQtSources', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const qtPost1 = makePost('at://did:plc:x/app.bsky.feed.post/qt1', 'pop1', { quoteCount: 5 });
    const qtPost2 = makePost('at://did:plc:x/app.bsky.feed.post/qt2', 'pop2', { quoteCount: 5 });

    // This QT has high quoteCount but will be returned by BOTH qtPost1 and qtPost2.
    // The second time, fetchedQtSources should already contain its URI.
    const sharedQt = makePost('at://did:plc:y/app.bsky.feed.post/shared', 'shared qt', {
      quoteCount: 10,
    });
    // Another QT with undefined quoteCount (hits ?? fallback on line 308)
    const noCountQt: PostView = {
      ...makePost('at://did:plc:z/app.bsky.feed.post/nocount', 'no count'),
      quoteCount: undefined,
    };

    const getPostThread = vi
      .fn()
      .mockResolvedValue({ ok: true, value: makeThreadResponse([root, qtPost1, qtPost2]) });

    const getQuotes = vi.fn().mockImplementation((uri: string) => {
      if (uri === root.uri) {
        return Promise.resolve({ ok: true, value: { posts: [], uri: root.uri } });
      }
      if (uri === qtPost1.uri) {
        return Promise.resolve({
          ok: true,
          value: { posts: [sharedQt, noCountQt], uri: qtPost1.uri },
        });
      }
      if (uri === qtPost2.uri) {
        // Return sharedQt again — should be skipped by fetchedQtSources
        return Promise.resolve({
          ok: true,
          value: { posts: [sharedQt], uri: qtPost2.uri },
        });
      }
      // sharedQt's QT crawl
      return Promise.resolve({ ok: true, value: { posts: [], uri } });
    });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    expect(result.allPosts.some((p) => p.uri === sharedQt.uri)).toBe(true);
    // sharedQt should appear only once despite being returned twice
    const sharedCount = result.allPosts.filter((p) => p.uri === sharedQt.uri).length;
    expect(sharedCount).toBe(1);
  });

  it('handles mix of high and low quoteCount posts in QT reply threads', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const qtPost = makePost('at://did:plc:x/app.bsky.feed.post/qt', 'popular', {
      quoteCount: 5,
    });
    const qtWithReplies = makePost('at://did:plc:y/app.bsky.feed.post/qtr', 'qt', {
      replyCount: 3,
    });
    // Reply with undefined quoteCount (hits ?? fallback branch, won't be queued)
    const lowQtReply: PostView = {
      ...makePost('at://did:plc:z/app.bsky.feed.post/low', 'low'),
      quoteCount: undefined,
    };
    // Reply with high quoteCount (will be queued)
    const highQtReply = makePost('at://did:plc:w/app.bsky.feed.post/high', 'high', {
      quoteCount: 5,
    });

    const getPostThread = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: makeThreadResponse([root, qtPost]) })
      // Reply thread includes both low and high quoteCount replies
      .mockResolvedValue({
        ok: true,
        value: makeThreadResponse([qtWithReplies, lowQtReply, highQtReply]),
      });

    const getQuotes = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [qtWithReplies], uri: qtPost.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // Both replies should be found
    expect(result.allPosts.some((p) => p.uri === lowQtReply.uri)).toBe(true);
    expect(result.allPosts.some((p) => p.uri === highQtReply.uri)).toBe(true);
    // highQtReply should trigger a further QT crawl
    expect(getQuotes.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('handles getQuotes rejection (thrown error) in recursive QT crawl', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const qtPost = makePost('at://did:plc:x/app.bsky.feed.post/qt', 'popular', {
      quoteCount: 5,
    });

    const getPostThread = vi
      .fn()
      .mockResolvedValue({ ok: true, value: makeThreadResponse([root, qtPost]) });

    const getQuotes = vi
      .fn()
      // Stage 3: root quotes
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
      })
      // Stage 4: QT crawl — throws (rejected promise)
      .mockRejectedValueOnce(new Error('network crash'))
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // Should handle the rejection gracefully via Promise.allSettled
    expect(result.allPosts.length).toBe(2); // root + qtPost from main thread
  });

  it('handles getPostThread rejection for QT reply threads', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const qtPost = makePost('at://did:plc:x/app.bsky.feed.post/qt', 'popular', {
      quoteCount: 5,
    });
    const qtWithReplies = makePost('at://did:plc:y/app.bsky.feed.post/qtr', 'qt', {
      replyCount: 3,
    });

    const getPostThread = vi
      .fn()
      // Main thread
      .mockResolvedValueOnce({ ok: true, value: makeThreadResponse([root, qtPost]) })
      // Reply thread fetch for qtWithReplies — rejects
      .mockRejectedValue(new Error('thread fetch crash'));

    const getQuotes = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [qtWithReplies], uri: qtPost.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // Should handle rejection via Promise.allSettled
    expect(result.allPosts.some((p) => p.uri === qtWithReplies.uri)).toBe(true);
  });

  it('handles quote thread fetch failure in Stage 3', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const quotePost = makePost('at://did:plc:y/app.bsky.feed.post/qt1', 'quoting');

    const getPostThread = vi
      .fn()
      // Main thread
      .mockResolvedValueOnce({ ok: true, value: makeThreadResponse([root]) })
      // Quote thread fetch — fails
      .mockResolvedValue({ ok: false, error: new Error('quote thread failed') });

    const getQuotes = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [quotePost], uri: root.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // quotePost should still be in allPosts (added from getQuotes), but its reply thread was not fetched
    expect(result.allPosts.some((p) => p.uri === quotePost.uri)).toBe(true);
  });

  it('handles posts with undefined quoteCount in Stage 4 queue building', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    // Post with undefined quoteCount — should hit ?? fallback in queue building
    const postWithUndefinedQc: PostView = {
      ...makePost('at://did:plc:x/app.bsky.feed.post/undef', 'no qc'),
      quoteCount: undefined,
    };

    const getPostThread = vi.fn().mockResolvedValue({
      ok: true,
      value: makeThreadResponse([root, postWithUndefinedQc]),
    });

    const getQuotes = vi.fn().mockResolvedValue({
      ok: true,
      value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
    });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    expect(result.allPosts).toHaveLength(2);
  });

  it('handles QTs with undefined replyCount in recursive QT crawl', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const qtPost = makePost('at://did:plc:x/app.bsky.feed.post/qt', 'popular', {
      quoteCount: 5,
    });
    // QT with undefined replyCount — hits ?? fallback in reply filter
    const qtNoReplyCount: PostView = {
      ...makePost('at://did:plc:y/app.bsky.feed.post/norep', 'no reply count'),
      replyCount: undefined,
    };

    const getPostThread = vi.fn().mockResolvedValue({
      ok: true,
      value: makeThreadResponse([root, qtPost]),
    });

    const getQuotes = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [], uri: root.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [qtNoReplyCount], uri: qtPost.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // qtNoReplyCount should be added but no reply thread fetched for it
    expect(result.allPosts.some((p) => p.uri === qtNoReplyCount.uri)).toBe(true);
  });

  it('handles tree.post being null (line 113)', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');

    // Builder that returns a tree where post is null
    const builder = {
      buildTree: vi.fn(() => ({
        post: null,
        branches: [],
        allPosts: [root],
        truncatedPosts: [],
        restrictedPosts: [],
        getParent: () => null,
        getBranchAuthors: () => [],
        flattenPosts: () => [root],
      })),
    };

    const client = mockClient({
      getPostThread: vi.fn().mockResolvedValue({
        ok: true,
        value: makeThreadResponse([root]),
      }),
    });

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // rootPost should be null since tree.post was null
    expect(result.rootPost).toBeNull();
    expect(result.allPosts).toHaveLength(1);
  });

  it('skips already-fetched truncated subtree URIs in nested truncation', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root', 'root', { replyCount: 10 });
    const reply1 = makePost('at://did:plc:x/app.bsky.feed.post/r1');
    const subtreePost = makePost('at://did:plc:x/app.bsky.feed.post/sub');
    const nestedPost = makePost('at://did:plc:x/app.bsky.feed.post/nested');

    const nestedTruncUri = 'at://did:plc:x/app.bsky.feed.post/nestedtrunc';
    const trees = new Map<string, MockBuildTree>();
    trees.set(root.uri, {
      post: root,
      allPosts: [root, reply1],
      truncatedPosts: [{ uri: root.uri, expectedReplies: 10, actualReplies: 1 }],
    });
    // First subtree has TWO truncated posts with the SAME URI (nested truncation)
    // The second one should be skipped via visited.has(uri:fetched) check at line 60
    trees.set(subtreePost.uri, {
      post: subtreePost,
      allPosts: [subtreePost],
      truncatedPosts: [
        { uri: nestedTruncUri, expectedReplies: 5, actualReplies: 0 },
        { uri: nestedTruncUri, expectedReplies: 5, actualReplies: 0 },
      ],
    });
    trees.set(nestedPost.uri, {
      post: nestedPost,
      allPosts: [nestedPost],
      truncatedPosts: [],
    });

    const getPostThread = vi
      .fn()
      // Main thread
      .mockResolvedValueOnce({
        ok: true,
        value: { thread: { post: root, replies: [{ post: reply1, replies: [] }] } },
      })
      // Stage 2: first truncated subtree
      .mockResolvedValueOnce({
        ok: true,
        value: { thread: { post: subtreePost, replies: [] } },
      })
      // Nested: first nestedTruncUri fetch
      .mockResolvedValueOnce({
        ok: true,
        value: { thread: { post: nestedPost, replies: [] } },
      })
      // Second nestedTruncUri should be skipped (not called)
      .mockResolvedValue({ ok: false, error: new Error('should not be called') });

    const builder = makeMockBuilder(trees);
    const client = mockClient({
      getPostThread,
      getQuotes: vi.fn().mockResolvedValue({ ok: true, value: { posts: [], uri: root.uri } }),
    });

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    // 3 getPostThread calls: main + first truncated + nested (second nested skipped)
    expect(getPostThread).toHaveBeenCalledTimes(3);
    expect(result.allPosts.some((p) => p.uri === nestedPost.uri)).toBe(true);
  });

  it('handles pagination in quote fetches', async () => {
    const root = makePost('at://did:plc:x/app.bsky.feed.post/root');
    const qt1 = makePost('at://did:plc:y/app.bsky.feed.post/qt1', 'qt1');
    const qt2 = makePost('at://did:plc:y/app.bsky.feed.post/qt2', 'qt2');

    const getPostThread = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: makeThreadResponse([root]) })
      .mockResolvedValue({ ok: true, value: makeThreadResponse([qt1]) });

    const getQuotes = vi
      .fn()
      // First page with cursor
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [qt1], uri: root.uri, cursor: 'page2' } satisfies GetQuotesResponse,
      })
      // Second page
      .mockResolvedValueOnce({
        ok: true,
        value: { posts: [qt2], uri: root.uri } satisfies GetQuotesResponse,
      })
      .mockResolvedValue({
        ok: true,
        value: { posts: [], uri: '' } satisfies GetQuotesResponse,
      });

    const client = mockClient({ getPostThread, getQuotes });
    const builder = simpleBuilder();

    const result = await fetchThreadPosts(
      'at://did:plc:x/app.bsky.feed.post/root',
      client,
      builder
    );

    expect(result.allPosts.some((p) => p.uri === qt1.uri)).toBe(true);
    expect(result.allPosts.some((p) => p.uri === qt2.uri)).toBe(true);
    // page1 (with cursor), page2 (no cursor, stops pagination)
    expect(getQuotes).toHaveBeenCalledTimes(2);
  });
});
