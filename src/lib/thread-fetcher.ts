// pattern: Imperative Shell
// Recursively fetches all posts in a Bluesky thread: direct replies,
// truncated subtrees, quote posts, and quote-of-quote chains.
//
// Extracted from StarcounterApp.fetchAllPostsRecursively() so it can
// be used headlessly from both the web app and the Cloudflare Worker bot.

import type { BlueskyClient } from '../api/bluesky-client';
import type { ThreadBuilder } from './thread-builder';
import type { PostView } from '../types';

export type FetchProgress = {
  readonly fetched: number;
  readonly stage: 'thread' | 'truncated' | 'quotes' | 'recursive';
};

export type ThreadFetchOptions = {
  /** Called with each batch of new posts as they arrive. */
  readonly onPostsBatch?: (posts: readonly PostView[]) => void;
  /** Progress callback for UI updates. */
  readonly onProgress?: (progress: FetchProgress) => void;
};

export type ThreadFetchResult = {
  readonly allPosts: PostView[];
  readonly rootPost: PostView | null;
};

/**
 * Fetch a subtree for a truncated post (where API didn't return all replies).
 * Only returns posts not already in visited set.
 */
async function fetchTruncatedSubtree(
  uri: string,
  visited: Set<string>,
  client: BlueskyClient,
  threadBuilder: ThreadBuilder
): Promise<PostView[]> {
  const threadResult = await client.getPostThread(uri, {
    depth: 1000,
    parentHeight: 0,
  });
  if (!threadResult.ok) {
    return [];
  }

  const tree = threadBuilder.buildTree(threadResult.value.thread);

  const newPosts: PostView[] = [];
  for (const post of tree.allPosts) {
    if (!visited.has(post.uri)) {
      newPosts.push(post);
      visited.add(post.uri);
    }
  }

  // Check for further truncation in this subtree
  if (tree.truncatedPosts.length > 0) {
    for (const truncated of tree.truncatedPosts) {
      if (!visited.has(`${truncated.uri}:fetched`)) {
        visited.add(`${truncated.uri}:fetched`);
        const morePosts = await fetchTruncatedSubtree(
          truncated.uri,
          visited,
          client,
          threadBuilder
        );
        newPosts.push(...morePosts);
      }
    }
  }

  return newPosts;
}

/**
 * Recursively fetch all posts in a thread: replies, quotes, and QT chains.
 *
 * @param uri - AT-URI of the root post (handle-based or DID-based)
 * @param client - Bluesky API client
 * @param threadBuilder - Thread tree builder
 * @param options - Callbacks for progress and incremental processing
 */
export async function fetchThreadPosts(
  uri: string,
  client: BlueskyClient,
  threadBuilder: ThreadBuilder,
  options: ThreadFetchOptions = {}
): Promise<ThreadFetchResult> {
  const { onPostsBatch, onProgress } = options;
  const visited = new Set<string>();
  const allPosts: PostView[] = [];
  let rootPost: PostView | null = null;

  visited.add(uri);
  onProgress?.({ fetched: 0, stage: 'thread' });

  let didBasedUri = uri;

  // --- Stage 1: Fetch main thread ---
  const threadResult = await client.getPostThread(uri, {
    depth: 1000,
    parentHeight: 1000,
  });

  if (threadResult.ok) {
    const tree = threadBuilder.buildTree(threadResult.value.thread);
    allPosts.push(...tree.allPosts);
    onPostsBatch?.(tree.allPosts);
    onProgress?.({ fetched: allPosts.length, stage: 'thread' });

    // Resolve DID-based URI from root post (getQuotes requires DID-based URIs)
    if (tree.post?.uri) {
      didBasedUri = tree.post.uri;
      rootPost = tree.post;
    }

    // Mark all thread posts as visited
    for (const post of tree.allPosts) {
      visited.add(post.uri);
    }

    // --- Stage 2: Fetch truncated subtrees ---
    if (tree.truncatedPosts.length > 0) {
      onProgress?.({ fetched: allPosts.length, stage: 'truncated' });

      const TRUNCATED_BATCH_SIZE = 10;
      for (let i = 0; i < tree.truncatedPosts.length; i += TRUNCATED_BATCH_SIZE) {
        const batch = tree.truncatedPosts.slice(i, i + TRUNCATED_BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map((truncated) =>
            fetchTruncatedSubtree(truncated.uri, visited, client, threadBuilder)
          )
        );
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value.length > 0) {
            allPosts.push(...result.value);
            onPostsBatch?.(result.value);
          }
        }
        onProgress?.({ fetched: allPosts.length, stage: 'truncated' });
      }
    }
  }

  // --- Stage 3: Fetch quote posts (paginated) ---
  onProgress?.({ fetched: allPosts.length, stage: 'quotes' });
  let cursor: string | undefined;

  do {
    const quotesResult = await client.getQuotes(didBasedUri, { cursor, limit: 100 });
    if (!quotesResult.ok) break;

    const quotes = quotesResult.value.posts;
    cursor = quotesResult.value.cursor;

    const unvisitedQuotes = quotes.filter((quote) => !visited.has(quote.uri));

    for (const quote of unvisitedQuotes) {
      allPosts.push(quote);
      visited.add(quote.uri);
    }
    if (unvisitedQuotes.length > 0) {
      onPostsBatch?.(unvisitedQuotes);
    }

    onProgress?.({ fetched: allPosts.length, stage: 'quotes' });

    // Fetch reply threads for quote posts in parallel batches
    const QUOTE_BATCH_SIZE = 10;
    for (let i = 0; i < unvisitedQuotes.length; i += QUOTE_BATCH_SIZE) {
      const batch = unvisitedQuotes.slice(i, i + QUOTE_BATCH_SIZE);

      const threadResults = await Promise.allSettled(
        batch.map((quote) => client.getPostThread(quote.uri, { depth: 1000, parentHeight: 0 }))
      );

      for (const result of threadResults) {
        if (result.status === 'fulfilled' && result.value.ok) {
          const quoteTree = threadBuilder.buildTree(result.value.value.thread);
          const newPosts: PostView[] = [];

          for (const post of quoteTree.allPosts) {
            if (!visited.has(post.uri)) {
              allPosts.push(post);
              visited.add(post.uri);
              newPosts.push(post);
            }
          }

          if (newPosts.length > 0) {
            onPostsBatch?.(newPosts);
          }
        }
      }

      onProgress?.({ fetched: allPosts.length, stage: 'quotes' });
    }
  } while (cursor);

  // --- Stage 4: Recursive QT crawl (QTs of replies, QTs of QTs) ---
  onProgress?.({ fetched: allPosts.length, stage: 'recursive' });
  const MIN_REPOSTS_FOR_QT_FETCH = 3;
  const MAX_QT_DEPTH = 10;
  const fetchedQtSources = new Set([didBasedUri]);

  type QueueItem = { uri: string; depth: number; quoteCount: number };
  const qtQueue: QueueItem[] = [];
  for (const p of allPosts) {
    const qc = p.quoteCount ?? 0;
    if (qc >= MIN_REPOSTS_FOR_QT_FETCH && !fetchedQtSources.has(p.uri)) {
      qtQueue.push({ uri: p.uri, depth: 1, quoteCount: qc });
    }
  }

  const QT_CRAWL_BATCH_SIZE = 5;
  while (qtQueue.length > 0) {
    const batch: QueueItem[] = [];
    while (batch.length < QT_CRAWL_BATCH_SIZE && qtQueue.length > 0) {
      const item = qtQueue.shift()!;
      if (fetchedQtSources.has(item.uri)) continue;
      if (item.depth > MAX_QT_DEPTH) continue;
      fetchedQtSources.add(item.uri);
      batch.push(item);
    }
    if (batch.length === 0) continue;

    // Fetch QTs for batch items in parallel (each may paginate)
    const batchQtResults = await Promise.allSettled(
      batch.map(async (item) => {
        const newQts: PostView[] = [];
        let qtCursor: string | undefined;
        do {
          const quotesResult = await client.getQuotes(item.uri, {
            cursor: qtCursor,
            limit: 100,
          });
          if (!quotesResult.ok) break;
          qtCursor = quotesResult.value.cursor;
          for (const quote of quotesResult.value.posts) {
            if (!visited.has(quote.uri)) {
              visited.add(quote.uri);
              newQts.push(quote);
            }
          }
        } while (qtCursor);
        return { item, newQts };
      })
    );

    // Collect new QTs
    const allNewQts: { item: QueueItem; qts: PostView[] }[] = [];
    for (const result of batchQtResults) {
      if (result.status === 'fulfilled') {
        const { item, newQts } = result.value;
        allPosts.push(...newQts);
        onPostsBatch?.(newQts);
        allNewQts.push({ item, qts: newQts });
      }
    }

    // Fetch reply threads for new QTs in parallel batches
    const REPLY_BATCH_SIZE = 10;
    const allQtPosts = allNewQts.flatMap(({ item, qts }) =>
      qts.map((qt) => ({ qt, depth: item.depth }))
    );

    for (let i = 0; i < allQtPosts.length; i += REPLY_BATCH_SIZE) {
      const replyBatch = allQtPosts.slice(i, i + REPLY_BATCH_SIZE);
      const replyResults = await Promise.allSettled(
        replyBatch
          .filter(({ qt }) => (qt.replyCount ?? 0) > 0)
          .map(({ qt }) => client.getPostThread(qt.uri, { depth: 1000, parentHeight: 0 }))
      );

      for (const result of replyResults) {
        if (result.status === 'fulfilled' && result.value.ok) {
          const tree = threadBuilder.buildTree(result.value.value.thread);
          const newPosts: PostView[] = [];
          for (const post of tree.allPosts) {
            if (!visited.has(post.uri)) {
              allPosts.push(post);
              visited.add(post.uri);
              newPosts.push(post);

              const postQc = post.quoteCount ?? 0;
              if (postQc >= MIN_REPOSTS_FOR_QT_FETCH && !fetchedQtSources.has(post.uri)) {
                qtQueue.push({
                  uri: post.uri,
                  depth: replyBatch[0]!.depth + 1,
                  quoteCount: postQc,
                });
              }
            }
          }
          if (newPosts.length > 0) {
            onPostsBatch?.(newPosts);
          }
        }
      }
    }

    // Queue QTs themselves for further QT fetching
    for (const { item, qts } of allNewQts) {
      for (const qt of qts) {
        const qtQc = qt.quoteCount ?? 0;
        if (qtQc >= MIN_REPOSTS_FOR_QT_FETCH && !fetchedQtSources.has(qt.uri)) {
          qtQueue.push({
            uri: qt.uri,
            depth: item.depth + 1,
            quoteCount: qtQc,
          });
        }
      }
    }

    onProgress?.({ fetched: allPosts.length, stage: 'recursive' });
  }

  return { allPosts, rootPost };
}
