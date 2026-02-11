import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchNotifications,
  extractMentionTargets,
  updateSeenNotifications,
  type Notification,
} from './notification-poller';

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeNotification(overrides: Partial<Notification> & { reason: string }): Notification {
  return {
    uri: 'at://did:plc:author/app.bsky.feed.post/abc',
    cid: 'cid-abc',
    author: { did: 'did:plc:author', handle: 'author.bsky.social' },
    record: { text: '@starcountr count this' },
    indexedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('fetchNotifications', () => {
  it('returns notifications on success', async () => {
    const mockNotifications = [makeNotification({ reason: 'mention' })];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ notifications: mockNotifications }),
    });

    const result = await fetchNotifications('access-jwt', 'https://bsky.social');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.notifications).toHaveLength(1);
    }
  });

  it('passes cursor as query parameter', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ notifications: [] }),
    });

    await fetchNotifications('jwt', 'https://bsky.social', 'my-cursor');

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toContain('cursor=my-cursor');
  });

  it('sends authorization header', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ notifications: [] }),
    });

    await fetchNotifications('my-jwt-token', 'https://bsky.social');

    const calledOptions = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]![1] as RequestInit;
    expect(calledOptions.headers).toEqual({ Authorization: 'Bearer my-jwt-token' });
  });

  it('returns error on failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    const result = await fetchNotifications('bad-jwt', 'https://bsky.social');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('401');
    }
  });
});

describe('extractMentionTargets', () => {
  const botDid = 'did:plc:bot';

  it('extracts root URI from reply mentions', () => {
    const notifications: Notification[] = [
      makeNotification({
        reason: 'mention',
        record: {
          text: '@starcountr count this',
          reply: {
            root: { uri: 'at://did:plc:x/app.bsky.feed.post/root', cid: 'root-cid' },
            parent: { uri: 'at://did:plc:x/app.bsky.feed.post/parent', cid: 'parent-cid' },
          },
        },
      }),
    ];

    const targets = extractMentionTargets(notifications, botDid);

    expect(targets).toHaveLength(1);
    expect(targets[0]!.rootUri).toBe('at://did:plc:x/app.bsky.feed.post/root');
  });

  it('uses notification URI when no reply (mention IS the root)', () => {
    const notifications: Notification[] = [
      makeNotification({
        reason: 'mention',
        uri: 'at://did:plc:author/app.bsky.feed.post/thepost',
        record: { text: '@starcountr count this' },
      }),
    ];

    const targets = extractMentionTargets(notifications, botDid);

    expect(targets).toHaveLength(1);
    expect(targets[0]!.rootUri).toBe('at://did:plc:author/app.bsky.feed.post/thepost');
  });

  it('deduplicates by root URI', () => {
    const rootUri = 'at://did:plc:x/app.bsky.feed.post/root';
    const notifications: Notification[] = [
      makeNotification({
        reason: 'mention',
        uri: 'at://did:plc:a/app.bsky.feed.post/m1',
        cid: 'cid-m1',
        record: {
          text: '@starcountr',
          reply: {
            root: { uri: rootUri, cid: 'root-cid' },
            parent: { uri: rootUri, cid: 'root-cid' },
          },
        },
      }),
      makeNotification({
        reason: 'mention',
        uri: 'at://did:plc:b/app.bsky.feed.post/m2',
        cid: 'cid-m2',
        record: {
          text: '@starcountr',
          reply: {
            root: { uri: rootUri, cid: 'root-cid' },
            parent: { uri: rootUri, cid: 'root-cid' },
          },
        },
      }),
    ];

    const targets = extractMentionTargets(notifications, botDid);

    expect(targets).toHaveLength(1);
    expect(targets[0]!.mentionUri).toBe('at://did:plc:a/app.bsky.feed.post/m1');
  });

  it('ignores non-mention notifications', () => {
    const notifications: Notification[] = [
      makeNotification({ reason: 'like' }),
      makeNotification({ reason: 'repost' }),
      makeNotification({ reason: 'follow' }),
      makeNotification({ reason: 'mention' }),
    ];

    const targets = extractMentionTargets(notifications, botDid);
    expect(targets).toHaveLength(1);
  });

  it('ignores mentions from the bot itself', () => {
    const notifications: Notification[] = [
      makeNotification({
        reason: 'mention',
        author: { did: botDid, handle: 'starcountr.bsky.social' },
      }),
    ];

    const targets = extractMentionTargets(notifications, botDid);
    expect(targets).toHaveLength(0);
  });

  it('returns empty array for empty notifications', () => {
    const targets = extractMentionTargets([], 'did:plc:bot');
    expect(targets).toHaveLength(0);
  });
});

describe('updateSeenNotifications', () => {
  it('sends POST with seenAt timestamp', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    const result = await updateSeenNotifications(
      'my-jwt',
      'https://bsky.social',
      '2024-01-01T12:00:00Z'
    );

    expect(result.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://bsky.social/xrpc/app.bsky.notification.updateSeen',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ seenAt: '2024-01-01T12:00:00Z' }),
      })
    );
  });

  it('returns ok: false on failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const result = await updateSeenNotifications('jwt', 'https://bsky.social', '2024-01-01');

    expect(result.ok).toBe(false);
  });
});
