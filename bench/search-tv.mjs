#!/usr/bin/env node
const API = 'https://bsky.social/xrpc';

async function auth(h, p) {
  const r = await fetch(`${API}/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: h, password: p }),
  });
  return (await r.json()).accessJwt;
}

async function search(token, q) {
  const r = await fetch(
    `${API}/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=25&sort=top`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) return [];
  const d = await r.json();
  return (d.posts || []).map((p) => ({
    text: (p.record?.text || '').slice(0, 120),
    handle: p.author?.handle,
    replies: p.replyCount || 0,
    quotes: p.quoteCount || 0,
    total: (p.replyCount || 0) + (p.quoteCount || 0),
    likes: p.likeCount || 0,
    url: `https://bsky.app/profile/${p.author?.handle}/post/${p.uri?.split('/').pop()}`,
    uri: p.uri,
  }));
}

const token = await auth(process.env.BSKY_HANDLE, process.env.BSKY_APP_PASSWORD);

const qs = [
  'what are you binging',
  'binge watching',
  'name a tv show',
  'underrated tv series',
  'comfort show',
  'guilty pleasure show',
  'tv show recommendations',
  'what should I watch next',
  'favorite series of all time',
  'drop your favorite show',
  'best show on television',
  'what series are you watching',
];

const seen = new Set();
const all = [];
for (const q of qs) {
  for (const r of await search(token, q)) {
    if (!seen.has(r.uri)) {
      seen.add(r.uri);
      all.push(r);
    }
  }
}
all.sort((a, b) => b.total - a.total);

console.log('=== TV Shows expanded search (top 20) ===');
for (const r of all.slice(0, 20)) {
  console.log(
    `${r.total} total (${r.replies} replies + ${r.quotes} QTs) | ${r.likes} likes | @${r.handle}`
  );
  console.log(`  ${r.text.replace(/\n/g, ' ')}`);
  console.log(`  ${r.url}`);
  console.log();
}
