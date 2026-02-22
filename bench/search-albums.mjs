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
    text: (p.record?.text || '').slice(0, 140),
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
  'favorite album of all time',
  'drop your top albums',
  'album recommendations',
  'what album changed your life',
  'desert island albums',
  'perfect album front to back',
  'album you never get tired of',
  'unpopular opinion album',
  'most played album',
  'favorite rap album',
  'favorite rock album',
  'favorite hip hop album',
  'drop your favorite band',
  'what band are you obsessed with',
  'name an album',
  'top 5 albums',
  'album that defined your youth',
  'favorite debut album',
  'best concept album',
  'vinyl collection',
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

console.log(`=== Albums/Artists/Music deep search (top 25, ${all.length} total found) ===`);
for (const r of all.slice(0, 25)) {
  console.log(
    `${r.total} total (${r.replies}r + ${r.quotes}qt) | ${r.likes} likes | @${r.handle}`
  );
  console.log(`  ${r.text.replace(/\n/g, ' ')}`);
  console.log(`  ${r.url}`);
  console.log();
}
