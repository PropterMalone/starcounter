#!/usr/bin/env node
/**
 * Searches Bluesky for high-engagement threads suitable for benchmarking.
 * Requires BSKY_HANDLE and BSKY_APP_PASSWORD environment variables.
 */

const API = 'https://bsky.social/xrpc';

async function auth(handle, password) {
  const res = await fetch(`${API}/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password }),
  });
  if (!res.ok) {
    console.error('Auth failed:', res.status, await res.text());
    process.exit(1);
  }
  return (await res.json()).accessJwt;
}

async function search(token, query) {
  const url = `${API}/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=25&sort=top`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error('Search failed for', query, ':', res.status);
    return [];
  }
  const data = await res.json();
  return (data.posts || []).map((p) => ({
    text: (p.record?.text || '').slice(0, 120),
    handle: p.author?.handle,
    replies: p.replyCount || 0,
    quotes: p.quoteCount || 0,
    likes: p.likeCount || 0,
    reposts: p.repostCount || 0,
    total: (p.replyCount || 0) + (p.quoteCount || 0),
    uri: p.uri,
    url: `https://bsky.app/profile/${p.author?.handle}/post/${p.uri?.split('/').pop()}`,
  }));
}

const handle = process.env.BSKY_HANDLE;
const password = process.env.BSKY_APP_PASSWORD;

if (!handle || !password) {
  console.error('Set BSKY_HANDLE and BSKY_APP_PASSWORD environment variables');
  process.exit(1);
}

const token = await auth(handle, password);
console.log('Authenticated successfully.\n');

const queries = {
  'TV Shows': [
    'favorite tv show',
    'best tv series',
    'what show are you watching',
    'drop your top shows',
    'top 10 tv shows',
  ],
  'Albums/Artists': [
    'favorite album',
    'best album of all time',
    'favorite artist or band',
    'top 10 albums',
    'drop your favorite albums',
  ],
  Books: [
    'favorite book',
    'best book you have read',
    'book recommendations',
    'top 10 books',
    'what are you reading',
  ],
};

for (const [category, qs] of Object.entries(queries)) {
  const seen = new Set();
  const all = [];
  for (const q of qs) {
    const results = await search(token, q);
    for (const r of results) {
      if (!seen.has(r.uri)) {
        seen.add(r.uri);
        all.push(r);
      }
    }
  }
  all.sort((a, b) => b.total - a.total);
  console.log(`=== ${category} (top 10 by replies+QTs) ===`);
  for (const r of all.slice(0, 10)) {
    console.log(`${r.total} total (${r.replies} replies + ${r.quotes} QTs) | ${r.likes} likes | @${r.handle}`);
    console.log(`  ${r.text.replace(/\n/g, ' ')}`);
    console.log(`  ${r.url}`);
    console.log();
  }
}
