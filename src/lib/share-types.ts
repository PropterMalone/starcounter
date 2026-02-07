// pattern: Functional Core
// Types and conversion functions for D1-backed shared results

import type { PostView } from '../types';

/**
 * Compact post representation for D1 storage.
 * Short field names minimize JSON size.
 */
export type StoredPost = {
  readonly u: string; // uri
  readonly h: string; // author.handle
  readonly d?: string; // author.displayName
  readonly a?: string; // author.avatar
  readonly t: string; // record.text
  readonly c: string; // record.createdAt
};

/**
 * Full shared state stored in D1.
 * Contains everything needed to restore results with drill-downs and user tweaks.
 */
export type SharedData = {
  readonly mentionCounts: ReadonlyArray<{
    readonly mention: string;
    readonly count: number;
    readonly posts: readonly StoredPost[];
  }>;
  readonly uncategorizedPosts: readonly StoredPost[];
  readonly excludedCategories: readonly string[];
  readonly manualAssignments: Readonly<Record<string, string>>;
  readonly originalPost: StoredPost | null;
  readonly postCount: number;
  readonly timestamp: number;
};

/**
 * Convert a PostView to compact StoredPost for D1 storage.
 * Only preserves fields needed for drill-down display and post links.
 */
export function toStoredPost(post: PostView): StoredPost {
  const result: StoredPost = {
    u: post.uri,
    h: post.author.handle,
    t: post.record.text,
    c: post.record.createdAt,
    ...(post.author.displayName ? { d: post.author.displayName } : {}),
    ...(post.author.avatar ? { a: post.author.avatar } : {}),
  };
  return result;
}

/**
 * Convert a StoredPost back to PostView for display.
 * Fills in empty defaults for fields not stored (cid, did, indexedAt).
 */
export function fromStoredPost(stored: StoredPost): PostView {
  return {
    uri: stored.u,
    cid: '',
    author: {
      did: '',
      handle: stored.h,
      displayName: stored.d,
      avatar: stored.a,
    },
    record: {
      text: stored.t,
      createdAt: stored.c,
    },
    indexedAt: stored.c,
  };
}
