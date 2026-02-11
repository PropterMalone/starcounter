import { describe, it, expect, vi } from 'vitest';
import { buildSharedData, createShare, createShareFromResult } from './share-creator';
import type { AnalysisResult } from '../src/lib/analyze';
import type { PostView } from '../src/types';

function makePost(uri: string, text: string, handle = 'user.bsky.social'): PostView {
  return {
    uri,
    cid: `cid-${uri.split('/').pop()}`,
    author: { did: 'did:plc:user', handle, displayName: 'User' },
    record: { text, createdAt: '2024-01-01T00:00:00Z' },
    indexedAt: '2024-01-01T00:00:00Z',
  };
}

function makeResult(): AnalysisResult {
  return {
    mentionCounts: [
      {
        mention: 'The Shawshank Redemption',
        count: 47,
        posts: [makePost('at://did:plc:a/app.bsky.feed.post/1', 'Shawshank Redemption')],
      },
      {
        mention: 'Goodfellas',
        count: 38,
        posts: [makePost('at://did:plc:b/app.bsky.feed.post/2', 'Goodfellas')],
      },
    ],
    uncategorizedPosts: [makePost('at://did:plc:c/app.bsky.feed.post/3', 'idk')],
    postCount: 412,
    rootPost: makePost('at://did:plc:op/app.bsky.feed.post/root', 'What is your fav movie?'),
  };
}

function mockDb() {
  const run = vi.fn().mockResolvedValue({});
  const bind = vi.fn().mockReturnValue({ run });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { prepare, bind, run } as unknown as D1Database & {
    bind: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
  };
}

describe('buildSharedData', () => {
  it('converts AnalysisResult to SharedData with stored posts', () => {
    const result = makeResult();
    const shared = buildSharedData(result);

    expect(shared.mentionCounts).toHaveLength(2);
    expect(shared.mentionCounts[0]!.mention).toBe('The Shawshank Redemption');
    expect(shared.mentionCounts[0]!.count).toBe(47);
    // StoredPost uses compact field names
    expect(shared.mentionCounts[0]!.posts[0]!.h).toBe('user.bsky.social');
    expect(shared.mentionCounts[0]!.posts[0]!.t).toBe('Shawshank Redemption');
  });

  it('converts uncategorized posts', () => {
    const result = makeResult();
    const shared = buildSharedData(result);

    expect(shared.uncategorizedPosts).toHaveLength(1);
    expect(shared.uncategorizedPosts[0]!.t).toBe('idk');
  });

  it('converts original post', () => {
    const result = makeResult();
    const shared = buildSharedData(result);

    expect(shared.originalPost).not.toBeNull();
    expect(shared.originalPost!.t).toBe('What is your fav movie?');
  });

  it('sets correct postCount and defaults', () => {
    const result = makeResult();
    const shared = buildSharedData(result);

    expect(shared.postCount).toBe(412);
    expect(shared.excludedCategories).toEqual([]);
    expect(shared.manualAssignments).toEqual({});
    expect(shared.timestamp).toBeGreaterThan(0);
  });
});

describe('createShare', () => {
  it('inserts into shared_results and returns 8-char ID', async () => {
    const db = mockDb();
    const shared = buildSharedData(makeResult());

    const id = await createShare(db, shared);

    expect(id).toHaveLength(8);
    expect(id).toMatch(/^[A-Za-z0-9]+$/);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO shared_results'));
  });

  it('binds id, JSON data, and timestamp', async () => {
    const db = mockDb();
    const shared = buildSharedData(makeResult());

    await createShare(db, shared);

    const bindCall = (db.prepare('').bind as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    // First arg: id (string), second: JSON, third: timestamp
    expect(typeof bindCall[0]).toBe('string');
    expect(typeof bindCall[1]).toBe('string');
    JSON.parse(bindCall[1] as string); // Should be valid JSON
    expect(typeof bindCall[2]).toBe('number');
  });
});

describe('createShareFromResult', () => {
  it('builds shared data and creates share in one call', async () => {
    const db = mockDb();
    const result = makeResult();

    const id = await createShareFromResult(db, result);

    expect(id).toHaveLength(8);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO shared_results'));
  });
});
