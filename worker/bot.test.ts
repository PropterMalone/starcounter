import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runBot } from './bot';
import type { Env } from './types';

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockDb() {
  const run = vi.fn().mockResolvedValue({});
  const first = vi.fn().mockResolvedValue(null);
  const bind = vi.fn().mockReturnValue({ run, first });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { prepare, bind, first, run } as unknown as D1Database;
}

function makeEnv(db?: D1Database): Env {
  return {
    SHARED_RESULTS: db ?? mockDb(),
    BSKY_HANDLE: 'starcountr.bsky.social',
    BSKY_PASSWORD: 'app-password',
  };
}

// Mock session response for createSession
function mockCreateSession() {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        did: 'did:plc:bot',
        handle: 'starcountr.bsky.social',
        accessJwt: 'access-token',
        refreshJwt: 'refresh-token',
      }),
  };
}

// Mock listNotifications response
function mockListNotifications(notifications: unknown[] = [], cursor?: string) {
  return {
    ok: true,
    json: () => Promise.resolve({ notifications, cursor }),
  };
}

describe('runBot', () => {
  it('returns early on auth failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    const result = await runBot(makeEnv());

    expect(result).toEqual({ processed: 0, errors: 1 });
  });

  it('returns early on notification fetch failure', async () => {
    globalThis.fetch = vi
      .fn()
      // createSession succeeds
      .mockResolvedValueOnce(mockCreateSession())
      // listNotifications fails
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await runBot(makeEnv());

    expect(result).toEqual({ processed: 0, errors: 1 });
  });

  it('processes zero mentions gracefully', async () => {
    globalThis.fetch = vi
      .fn()
      // createSession
      .mockResolvedValueOnce(mockCreateSession())
      // listNotifications — no mentions
      .mockResolvedValueOnce(mockListNotifications([]));

    const result = await runBot(makeEnv());

    expect(result).toEqual({ processed: 0, errors: 0 });
  });

  it('updates cursor after processing', async () => {
    const db = mockDb();

    globalThis.fetch = vi
      .fn()
      // createSession
      .mockResolvedValueOnce(mockCreateSession())
      // listNotifications with cursor
      .mockResolvedValueOnce(mockListNotifications([], 'new-cursor'));

    await runBot(makeEnv(db));

    // Should have called setState with the new cursor
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO bot_state'));
  });

  it('filters out non-mention notifications', async () => {
    globalThis.fetch = vi
      .fn()
      // createSession
      .mockResolvedValueOnce(mockCreateSession())
      // listNotifications with likes/follows only
      .mockResolvedValueOnce(
        mockListNotifications([
          {
            uri: 'at://did:plc:x/app.bsky.feed.post/1',
            cid: 'cid-1',
            author: { did: 'did:plc:x', handle: 'x.bsky.social' },
            reason: 'like',
            record: { text: '' },
            indexedAt: '2024-01-01T00:00:00Z',
          },
        ])
      )
      // updateSeen
      .mockResolvedValueOnce({ ok: true });

    const result = await runBot(makeEnv());

    // No mentions to process
    expect(result).toEqual({ processed: 0, errors: 0 });
  });

  it('skips mentions from the bot itself', async () => {
    globalThis.fetch = vi
      .fn()
      // createSession
      .mockResolvedValueOnce(mockCreateSession())
      // listNotifications with self-mention
      .mockResolvedValueOnce(
        mockListNotifications([
          {
            uri: 'at://did:plc:bot/app.bsky.feed.post/1',
            cid: 'cid-1',
            author: { did: 'did:plc:bot', handle: 'starcountr.bsky.social' },
            reason: 'mention',
            record: { text: '@bot count this' },
            indexedAt: '2024-01-01T00:00:00Z',
          },
        ])
      )
      // updateSeen
      .mockResolvedValueOnce({ ok: true });

    const result = await runBot(makeEnv());

    expect(result).toEqual({ processed: 0, errors: 0 });
  });
});
