import { describe, it, expect, vi } from 'vitest';
import {
  getState,
  setState,
  getProcessedThread,
  saveProcessedThread,
  hasRepliedToMention,
  saveRepliedMention,
} from './state';

function mockDb() {
  const bind = vi.fn().mockReturnThis();
  const first = vi.fn().mockResolvedValue(null);
  const run = vi.fn().mockResolvedValue({});
  const prepare = vi.fn().mockReturnValue({ bind, first, run });
  return { prepare, bind, first, run } as unknown as D1Database & {
    bind: ReturnType<typeof vi.fn>;
    first: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
  };
}

describe('getState', () => {
  it('returns null when key not found', async () => {
    const db = mockDb();
    const result = await getState(db, 'notification_cursor');
    expect(result).toBeNull();
  });

  it('returns value when key exists', async () => {
    const db = mockDb();
    (db as unknown as { first: ReturnType<typeof vi.fn> }).first = vi
      .fn()
      .mockResolvedValue({ value: 'cursor-abc' });
    // Re-wire prepare to use the updated first
    db.prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ value: 'cursor-abc' }),
      }),
    });

    const result = await getState(db, 'notification_cursor');
    expect(result).toBe('cursor-abc');
  });
});

describe('setState', () => {
  it('calls prepare with upsert SQL', async () => {
    const db = mockDb();
    db.prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({}),
      }),
    });

    await setState(db, 'notification_cursor', 'new-cursor');

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO bot_state'));
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'));
  });
});

describe('getProcessedThread', () => {
  it('returns null when thread not found', async () => {
    const db = mockDb();
    db.prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(null),
      }),
    });

    const result = await getProcessedThread(db, 'at://did:plc:x/app.bsky.feed.post/abc');
    expect(result).toBeNull();
  });

  it('returns processed thread when found', async () => {
    const db = mockDb();
    db.prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({
          thread_uri: 'at://did:plc:x/app.bsky.feed.post/abc',
          share_id: 'share123',
          processed_at: 1700000000,
          mention_count: 42,
          post_count: 500,
        }),
      }),
    });

    const result = await getProcessedThread(db, 'at://did:plc:x/app.bsky.feed.post/abc');

    expect(result).not.toBeNull();
    expect(result!.threadUri).toBe('at://did:plc:x/app.bsky.feed.post/abc');
    expect(result!.shareId).toBe('share123');
    expect(result!.mentionCount).toBe(42);
    expect(result!.postCount).toBe(500);
  });
});

describe('saveProcessedThread', () => {
  it('calls prepare with upsert SQL and correct bindings', async () => {
    const bindMock = vi.fn().mockReturnValue({ run: vi.fn().mockResolvedValue({}) });
    const db = mockDb();
    db.prepare = vi.fn().mockReturnValue({ bind: bindMock });

    await saveProcessedThread(db, {
      threadUri: 'at://did:plc:x/app.bsky.feed.post/abc',
      shareId: 'share123',
      processedAt: 1700000000,
      mentionCount: 42,
      postCount: 500,
    });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO bot_processed_threads')
    );
    expect(bindMock).toHaveBeenCalledWith(
      'at://did:plc:x/app.bsky.feed.post/abc',
      'share123',
      1700000000,
      42,
      500
    );
  });
});

describe('hasRepliedToMention', () => {
  it('returns false when mention not found', async () => {
    const db = mockDb();
    db.prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(null),
      }),
    });

    const result = await hasRepliedToMention(db, 'at://did:plc:x/app.bsky.feed.post/mention1');
    expect(result).toBe(false);
  });

  it('returns true when mention already replied to', async () => {
    const db = mockDb();
    db.prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue({ 1: 1 }),
      }),
    });

    const result = await hasRepliedToMention(db, 'at://did:plc:x/app.bsky.feed.post/mention1');
    expect(result).toBe(true);
  });
});

describe('saveRepliedMention', () => {
  it('calls prepare with INSERT OR IGNORE SQL', async () => {
    const bindMock = vi.fn().mockReturnValue({ run: vi.fn().mockResolvedValue({}) });
    const db = mockDb();
    db.prepare = vi.fn().mockReturnValue({ bind: bindMock });

    await saveRepliedMention(
      db,
      'at://did:plc:x/app.bsky.feed.post/mention1',
      'at://did:plc:x/app.bsky.feed.post/root1',
      1700000000
    );

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR IGNORE INTO bot_replied_mentions')
    );
    expect(bindMock).toHaveBeenCalledWith(
      'at://did:plc:x/app.bsky.feed.post/mention1',
      'at://did:plc:x/app.bsky.feed.post/root1',
      1700000000
    );
  });
});
