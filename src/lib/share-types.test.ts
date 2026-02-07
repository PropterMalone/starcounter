import { describe, it, expect } from 'vitest';
import { toStoredPost, fromStoredPost } from './share-types';
import type { PostView } from '../types';

function makePost(overrides: Partial<PostView> = {}): PostView {
  return {
    uri: 'at://did:plc:abc/app.bsky.feed.post/xyz',
    cid: 'bafyrei123',
    author: {
      did: 'did:plc:abc',
      handle: 'alice.bsky.social',
      displayName: 'Alice',
      avatar: 'https://cdn.bsky.app/avatar.jpg',
    },
    record: {
      text: 'The Nile is my home river',
      createdAt: '2026-02-07T12:00:00.000Z',
    },
    indexedAt: '2026-02-07T12:00:01.000Z',
    likeCount: 5,
    repostCount: 2,
    quoteCount: 1,
    ...overrides,
  };
}

describe('toStoredPost', () => {
  it('stores uri, handle, text, and createdAt', () => {
    const post = makePost();
    const stored = toStoredPost(post);

    expect(stored.u).toBe('at://did:plc:abc/app.bsky.feed.post/xyz');
    expect(stored.h).toBe('alice.bsky.social');
    expect(stored.t).toBe('The Nile is my home river');
    expect(stored.c).toBe('2026-02-07T12:00:00.000Z');
  });

  it('includes displayName when present', () => {
    const post = makePost();
    const stored = toStoredPost(post);
    expect(stored.d).toBe('Alice');
  });

  it('omits displayName when missing', () => {
    const post = makePost({
      author: { did: 'did:plc:abc', handle: 'bob.bsky.social' },
    });
    const stored = toStoredPost(post);
    expect(stored.d).toBeUndefined();
  });

  it('includes avatar when present', () => {
    const post = makePost();
    const stored = toStoredPost(post);
    expect(stored.a).toBe('https://cdn.bsky.app/avatar.jpg');
  });

  it('omits avatar when missing', () => {
    const post = makePost({
      author: { did: 'did:plc:abc', handle: 'bob.bsky.social', displayName: 'Bob' },
    });
    const stored = toStoredPost(post);
    expect(stored.a).toBeUndefined();
  });

  it('drops fields not needed for display (cid, did, likeCount, etc.)', () => {
    const post = makePost();
    const stored = toStoredPost(post);
    const keys = Object.keys(stored);

    // Only these keys should exist
    expect(keys).toEqual(expect.arrayContaining(['u', 'h', 't', 'c']));
    // Should not have more than 6 keys (u, h, t, c, d, a)
    expect(keys.length).toBeLessThanOrEqual(6);
  });
});

describe('fromStoredPost', () => {
  it('restores uri, handle, text, and createdAt', () => {
    const stored = {
      u: 'at://did:plc:abc/post/xyz',
      h: 'alice.bsky.social',
      t: 'Hello',
      c: '2026-01-01T00:00:00Z',
    };
    const post = fromStoredPost(stored);

    expect(post.uri).toBe('at://did:plc:abc/post/xyz');
    expect(post.author.handle).toBe('alice.bsky.social');
    expect(post.record.text).toBe('Hello');
    expect(post.record.createdAt).toBe('2026-01-01T00:00:00Z');
  });

  it('restores displayName when present', () => {
    const stored = { u: '', h: 'alice.bsky.social', d: 'Alice', t: '', c: '' };
    const post = fromStoredPost(stored);
    expect(post.author.displayName).toBe('Alice');
  });

  it('restores avatar when present', () => {
    const stored = { u: '', h: 'alice.bsky.social', a: 'https://img.png', t: '', c: '' };
    const post = fromStoredPost(stored);
    expect(post.author.avatar).toBe('https://img.png');
  });

  it('fills defaults for fields not stored', () => {
    const stored = { u: 'at://x', h: 'x.bsky', t: 'text', c: '2026-01-01T00:00:00Z' };
    const post = fromStoredPost(stored);

    expect(post.cid).toBe('');
    expect(post.author.did).toBe('');
    expect(post.indexedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('leaves displayName undefined when not stored', () => {
    const stored = { u: '', h: 'x.bsky', t: '', c: '' };
    const post = fromStoredPost(stored);
    expect(post.author.displayName).toBeUndefined();
  });
});

describe('roundtrip', () => {
  it('preserves all display-relevant data through toStoredPost → fromStoredPost', () => {
    const original = makePost();
    const restored = fromStoredPost(toStoredPost(original));

    expect(restored.uri).toBe(original.uri);
    expect(restored.author.handle).toBe(original.author.handle);
    expect(restored.author.displayName).toBe(original.author.displayName);
    expect(restored.author.avatar).toBe(original.author.avatar);
    expect(restored.record.text).toBe(original.record.text);
    expect(restored.record.createdAt).toBe(original.record.createdAt);
  });

  it('handles post without optional author fields', () => {
    const original = makePost({
      author: { did: 'did:plc:abc', handle: 'plain.bsky.social' },
    });
    const restored = fromStoredPost(toStoredPost(original));

    expect(restored.author.handle).toBe('plain.bsky.social');
    expect(restored.author.displayName).toBeUndefined();
    expect(restored.author.avatar).toBeUndefined();
  });
});
