#!/usr/bin/env node
/**
 * Fetches a Bluesky thread recursively and saves it as a local fixture.
 * Handles API truncation (200 reply cap) by re-fetching truncated subtrees.
 * Fetches all quote posts (QTs) and their reply threads.
 * Extracts post text, image alt text, author info, and tree structure.
 *
 * Usage: node bench/fetch-thread.mjs <bsky-url> <output-name>
 */

import { writeFileSync } from 'fs';

const API_BASE = 'https://public.api.bsky.app/xrpc';
const RATE_LIMIT_DELAY = 100; // ms between API calls

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolveHandle(handle) {
  const res = await fetch(`${API_BASE}/com.atproto.identity.resolveHandle?handle=${handle}`);
  if (!res.ok) throw new Error(`Failed to resolve handle ${handle}: ${res.status}`);
  const data = await res.json();
  return data.did;
}

function bskyUrlToAtUri(url, did) {
  const match = url.match(/\/profile\/[^/]+\/post\/([a-z0-9]+)/);
  if (!match) throw new Error(`Invalid Bluesky URL: ${url}`);
  return `at://${did}/app.bsky.feed.post/${match[1]}`;
}

function extractHandle(url) {
  const match = url.match(/\/profile\/([^/]+)\//);
  if (!match) throw new Error(`Cannot extract handle from URL: ${url}`);
  return match[1];
}

async function fetchThread(atUri, depth = 1000) {
  await sleep(RATE_LIMIT_DELAY);
  const url = `${API_BASE}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(atUri)}&depth=${depth}&parentHeight=0`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  API error ${res.status} for ${atUri}`);
    return null;
  }
  return res.json();
}

async function fetchQuotes(atUri, cursor) {
  await sleep(RATE_LIMIT_DELAY);
  let url = `${API_BASE}/app.bsky.feed.getQuotes?uri=${encodeURIComponent(atUri)}&limit=100`;
  if (cursor) url += `&cursor=${cursor}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  Quotes API error ${res.status}`);
    return null;
  }
  return res.json();
}

/** Extract all text content from a post, including alt text from images. */
function extractFullText(post) {
  const parts = [];
  const text = post.record?.text || '';
  if (text) parts.push(text);

  // Collect alt text from both record-level and view-level embeds
  const seen = new Set();
  for (const embed of [post.record?.embed, post.embed]) {
    if (!embed) continue;
    const imageSources = [embed.images, embed.media?.images].filter(Boolean);
    for (const images of imageSources) {
      for (const img of images) {
        const alt = img.alt;
        if (alt && !seen.has(alt)) {
          seen.add(alt);
          parts.push(`[image alt: ${alt}]`);
        }
      }
    }
  }

  return parts.join('\n');
}

/** Extract text from a quoted/embedded post */
function extractQuotedPostText(post) {
  const embed = post.embed;
  if (!embed) return null;
  if (embed.$type === 'app.bsky.embed.record#view' && embed.record?.value?.text) {
    return embed.record.value.text;
  }
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.record?.record?.value?.text) {
    return embed.record.record.value.text;
  }
  return null;
}

/** Extract URI of the quoted/embedded post */
function extractQuotedPostUri(post) {
  const embed = post.embed;
  if (!embed) return null;
  if (embed.$type === 'app.bsky.embed.record#view' && embed.record?.uri) {
    return embed.record.uri;
  }
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.record?.record?.uri) {
    return embed.record.record.uri;
  }
  return null;
}

/** Extract alt text from a quoted/embedded post's images */
function extractQuotedPostAltText(post) {
  const embed = post.embed;
  if (!embed) return null;

  // For recordWithMedia, the media is on the outer embed
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
    const alts = [];
    const images = embed.media.images || [];
    for (const img of images) {
      if (img.alt) alts.push(img.alt);
    }
    return alts.length > 0 ? alts : null;
  }

  // For record embeds, check if the quoted record has embeds with images
  const rec = embed.record;
  if (rec?.embeds) {
    const alts = [];
    for (const e of rec.embeds) {
      const images = e.images || e.media?.images || [];
      for (const img of images) {
        if (img.alt) alts.push(img.alt);
      }
    }
    return alts.length > 0 ? alts : null;
  }

  return null;
}

/** Simplify a raw API post into our fixture format */
function simplifyPost(post, parentUri, depth, source) {
  const fullText = extractFullText(post);
  return {
    uri: post.uri,
    cid: post.cid,
    parentUri: parentUri,
    depth: depth,
    source: source, // 'thread' | 'quote' | 'quote-reply'
    author: {
      did: post.author?.did,
      handle: post.author?.handle,
      displayName: post.author?.displayName,
    },
    text: post.record?.text || '',
    fullText: fullText,
    createdAt: post.record?.createdAt,
    likeCount: post.likeCount || 0,
    replyCount: post.replyCount || 0,
    repostCount: post.repostCount || 0,
    hasImages: !!(post.record?.embed?.images || post.record?.embed?.media?.images),
    hasQuote: !!(
      post.record?.embed?.record ||
      post.record?.embed?.$type === 'app.bsky.embed.record'
    ),
    embedType: post.record?.embed?.$type || null,
    quotedText: extractQuotedPostText(post),
    quotedUri: extractQuotedPostUri(post),
    quotedAltText: extractQuotedPostAltText(post),
  };
}

/** Find truncated nodes in a thread tree (where replyCount > actual replies returned) */
function findTruncated(node) {
  const truncated = [];
  if (!node?.post) return truncated;

  const expected = node.post.replyCount || 0;
  const actual = node.replies?.length || 0;
  if (expected > actual) {
    truncated.push({
      uri: node.post.uri,
      expected,
      actual,
      missing: expected - actual,
    });
  }

  for (const reply of node.replies || []) {
    truncated.push(...findTruncated(reply));
  }
  return truncated;
}

/** Flatten a raw thread tree, collecting simplified posts */
function flattenRawThread(node, parentUri, depth, source, visited) {
  const posts = [];
  if (
    !node ||
    node.$type === 'app.bsky.feed.defs#blockedPost' ||
    node.$type === 'app.bsky.feed.defs#notFoundPost'
  ) {
    return posts;
  }

  const post = node.post;
  if (post && !visited.has(post.uri)) {
    visited.add(post.uri);
    posts.push(simplifyPost(post, parentUri, depth, source));
  }

  for (const reply of node.replies || []) {
    posts.push(...flattenRawThread(reply, post?.uri, depth + 1, source, visited));
  }
  return posts;
}

async function main() {
  const bskyUrl = process.argv[2];
  const outputName = process.argv[3] || 'thread';

  if (!bskyUrl) {
    console.error('Usage: node bench/fetch-thread.mjs <bsky-url> [output-name]');
    process.exit(1);
  }

  console.log('Resolving handle...');
  const handle = extractHandle(bskyUrl);
  const did = await resolveHandle(handle);
  const atUri = bskyUrlToAtUri(bskyUrl, did);
  console.log(`AT URI: ${atUri}`);

  const visited = new Set();
  const allPosts = [];

  // === Phase 1: Fetch main thread ===
  console.log('\n=== Phase 1: Main thread ===');
  const threadData = await fetchThread(atUri);
  if (!threadData) throw new Error('Failed to fetch main thread');

  // Save raw API response
  writeFileSync(`bench/fixtures/${outputName}-raw.json`, JSON.stringify(threadData, null, 2));

  const mainPosts = flattenRawThread(threadData.thread, null, 0, 'thread', visited);
  allPosts.push(...mainPosts);
  console.log(`Main thread: ${mainPosts.length} posts`);

  // === Phase 2: Fetch truncated subtrees ===
  console.log('\n=== Phase 2: Truncated subtrees ===');
  const truncated = findTruncated(threadData.thread);
  console.log(`Found ${truncated.length} truncated nodes`);

  // We need to recursively fetch truncated subtrees, because each re-fetch
  // may itself be truncated
  const fetchedSubtrees = new Set();
  let subtreeQueue = [...truncated];
  let totalSubtreePosts = 0;

  while (subtreeQueue.length > 0) {
    const item = subtreeQueue.shift();
    if (fetchedSubtrees.has(item.uri)) continue;
    fetchedSubtrees.add(item.uri);

    console.log(`  Fetching subtree: ${item.uri.slice(-15)} (missing ~${item.missing} replies)`);
    const subtreeData = await fetchThread(item.uri);
    if (!subtreeData) continue;

    const subtreePosts = flattenRawThread(subtreeData.thread, null, 0, 'thread', visited);
    // Fix depths: look up actual parent depth from allPosts
    const parentPost = allPosts.find((p) => p.uri === item.uri);
    if (parentPost) {
      const baseDepth = parentPost.depth;
      for (const p of subtreePosts) {
        // The subtree root (depth 0) is already in allPosts, skip re-adjusting it
        // Children at depth N in the subtree should be at baseDepth + N in the full tree
        if (p.uri !== item.uri) {
          p.depth = baseDepth + p.depth;
        }
      }
    }

    allPosts.push(...subtreePosts);
    totalSubtreePosts += subtreePosts.length;

    // Check for further truncation in this subtree
    const moreTruncated = findTruncated(subtreeData.thread);
    for (const t of moreTruncated) {
      if (!fetchedSubtrees.has(t.uri)) {
        subtreeQueue.push(t);
      }
    }
  }
  console.log(`Subtrees added ${totalSubtreePosts} new posts`);

  // === Phase 3: Fetch all quote posts ===
  console.log('\n=== Phase 3: Quote posts ===');
  let cursor = undefined;
  let totalQuotes = 0;
  const quotePosts = [];

  do {
    const quotesData = await fetchQuotes(atUri, cursor);
    if (!quotesData) break;

    cursor = quotesData.cursor;
    const quotes = quotesData.posts || [];
    totalQuotes += quotes.length;
    console.log(`  Quotes page: ${quotes.length} posts (total: ${totalQuotes}, more: ${cursor ? 'yes' : 'no'})`);

    for (const quote of quotes) {
      if (!visited.has(quote.uri)) {
        visited.add(quote.uri);
        // QTs are depth 0 in their own context, but mark them as source=quote
        const simplified = simplifyPost(quote, null, 0, 'quote');
        quotePosts.push(simplified);
        allPosts.push(simplified);
      }
    }
  } while (cursor);

  console.log(`Total quote posts: ${quotePosts.length}`);

  // === Phase 4: Fetch reply threads for each quote post ===
  console.log('\n=== Phase 4: Quote post reply threads ===');
  let quoteReplyCount = 0;

  for (let i = 0; i < quotePosts.length; i++) {
    const qp = quotePosts[i];
    if (qp.replyCount === 0) continue;

    console.log(
      `  Fetching replies for QT ${i + 1}/${quotePosts.length}: @${qp.author.handle} (${qp.replyCount} replies)`
    );
    const qtThread = await fetchThread(qp.uri);
    if (!qtThread) continue;

    const qtReplies = flattenRawThread(qtThread.thread, null, 0, 'quote-reply', visited);
    quoteReplyCount += qtReplies.length;
    allPosts.push(...qtReplies);

    // Also check for truncation in QT threads
    const qtTruncated = findTruncated(qtThread.thread);
    for (const t of qtTruncated) {
      if (!fetchedSubtrees.has(t.uri)) {
        fetchedSubtrees.add(t.uri);
        const subData = await fetchThread(t.uri);
        if (subData) {
          const subPosts = flattenRawThread(subData.thread, null, 0, 'quote-reply', visited);
          quoteReplyCount += subPosts.length;
          allPosts.push(...subPosts);
        }
      }
    }
  }
  console.log(`Quote reply threads added ${quoteReplyCount} posts`);

  // === Phase 5: Recursive QT fetching ===
  // Fetch QTs of any post with 3+ reposts (QTs of QTs, QTs of replies, etc.)
  console.log('\n=== Phase 5: Recursive QT fetching (QTs of QTs, QTs of replies) ===');
  const MIN_REPOSTS_FOR_QT_FETCH = 3;
  const MAX_QT_DEPTH = 3; // Don't recurse more than 3 levels deep
  let recursiveQtCount = 0;
  const fetchedQtSources = new Set([atUri]); // Already fetched QTs for the root

  // Queue: posts with enough reposts to warrant QT fetching
  let qtQueue = allPosts
    .filter(
      (p) => p.repostCount >= MIN_REPOSTS_FOR_QT_FETCH && !fetchedQtSources.has(p.uri)
    )
    .map((p) => ({ uri: p.uri, depth: 1, repostCount: p.repostCount, handle: p.author?.handle }));

  console.log(`  Found ${qtQueue.length} posts with ${MIN_REPOSTS_FOR_QT_FETCH}+ reposts to check for QTs`);

  while (qtQueue.length > 0) {
    const item = qtQueue.shift();
    if (fetchedQtSources.has(item.uri) || item.depth > MAX_QT_DEPTH) continue;
    fetchedQtSources.add(item.uri);

    console.log(
      `  [depth=${item.depth}] Fetching QTs of @${item.handle || '?'} (${item.repostCount} reposts)`
    );

    // Paginate through all QTs of this post
    let qtCursor = undefined;
    const newQtsThisPost = [];
    do {
      const quotesData = await fetchQuotes(item.uri, qtCursor);
      if (!quotesData) break;
      qtCursor = quotesData.cursor;
      const quotes = quotesData.posts || [];

      for (const quote of quotes) {
        if (!visited.has(quote.uri)) {
          visited.add(quote.uri);
          const simplified = simplifyPost(quote, null, 0, 'recursive-quote');
          newQtsThisPost.push(simplified);
          allPosts.push(simplified);
          recursiveQtCount++;
        }
      }
    } while (qtCursor);

    if (newQtsThisPost.length > 0) {
      console.log(`    Found ${newQtsThisPost.length} new QTs`);
    }

    // Fetch reply threads for each new QT
    for (const qt of newQtsThisPost) {
      if (qt.replyCount > 0) {
        const qtThread = await fetchThread(qt.uri);
        if (qtThread) {
          const replies = flattenRawThread(qtThread.thread, null, 0, 'recursive-quote-reply', visited);
          recursiveQtCount += replies.length;
          allPosts.push(...replies);

          // Add replies with high reposts to the queue for further QT fetching
          for (const r of replies) {
            if (
              r.repostCount >= MIN_REPOSTS_FOR_QT_FETCH &&
              !fetchedQtSources.has(r.uri) &&
              item.depth + 1 <= MAX_QT_DEPTH
            ) {
              qtQueue.push({
                uri: r.uri,
                depth: item.depth + 1,
                repostCount: r.repostCount,
                handle: r.author?.handle,
              });
            }
          }
        }
      }

      // Also queue this QT itself for further QT fetching if it has reposts
      if (
        qt.repostCount >= MIN_REPOSTS_FOR_QT_FETCH &&
        !fetchedQtSources.has(qt.uri) &&
        item.depth + 1 <= MAX_QT_DEPTH
      ) {
        qtQueue.push({
          uri: qt.uri,
          depth: item.depth + 1,
          repostCount: qt.repostCount,
          handle: qt.author?.handle,
        });
      }
    }
  }
  console.log(`Recursive QT fetching added ${recursiveQtCount} posts`);

  // === Save fixture ===
  console.log('\n=== Saving ===');
  const fixture = {
    meta: {
      sourceUrl: bskyUrl,
      atUri: atUri,
      rootAuthor: allPosts[0]?.author,
      rootText: allPosts[0]?.text,
      fetchedAt: new Date().toISOString(),
      postCount: allPosts.length,
      threadPosts: mainPosts.length + totalSubtreePosts,
      quotePosts: quotePosts.length,
      quoteReplyPosts: quoteReplyCount,
      recursiveQtPosts: recursiveQtCount,
    },
    posts: allPosts,
  };

  const fixturePath = `bench/fixtures/${outputName}.json`;
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));

  // Summary
  const withImages = allPosts.filter((p) => p.hasImages).length;
  const withQuotedText = allPosts.filter((p) => p.quotedText).length;
  const uniqueAuthors = new Set(allPosts.map((p) => p.author?.did)).size;
  const maxDepth = Math.max(...allPosts.map((p) => p.depth));
  const bySource = {};
  for (const p of allPosts) {
    bySource[p.source] = (bySource[p.source] || 0) + 1;
  }

  console.log(`\nThread summary:`);
  console.log(`  Total posts: ${allPosts.length}`);
  console.log(`  By source: ${JSON.stringify(bySource)}`);
  console.log(`  Unique authors: ${uniqueAuthors}`);
  console.log(`  Max depth: ${maxDepth}`);
  console.log(`  Posts with images: ${withImages}`);
  console.log(`  Posts with quoted text: ${withQuotedText}`);
  console.log(`\nFixture saved to ${fixturePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
