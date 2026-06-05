// Create D1 share entries for bot-analyzed threads.
// Mirrors functions/api/share.ts POST logic but uses D1 binding directly.

import type { SharedData, StoredPost } from '../src/lib/share-types';
import type { AnalysisResult } from '../src/lib/analyze';
import { toStoredPost } from '../src/lib/share-types';

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 8;

function generateShareId(): string {
  const bytes = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) {
    id += ID_CHARS[byte % 62];
  }
  return id;
}

/** Convert AnalysisResult to SharedData for D1 storage. */
export function buildSharedData(result: AnalysisResult): SharedData {
  return {
    mentionCounts: result.mentionCounts.map((mc) => ({
      mention: mc.mention,
      count: mc.count,
      posts: mc.posts.map(toStoredPost),
    })),
    uncategorizedPosts: result.uncategorizedPosts.map(toStoredPost),
    excludedCategories: [],
    manualAssignments: {},
    originalPost: toStoredPost(result.rootPost),
    postCount: result.postCount,
    timestamp: Date.now(),
  };
}

/** Insert shared results into D1 and return the share ID. */
export async function createShare(db: D1Database, data: SharedData): Promise<string> {
  const id = generateShareId();
  const json = JSON.stringify(data);

  await db
    .prepare('INSERT INTO shared_results (id, data, created_at) VALUES (?, ?, ?)')
    .bind(id, json, Date.now())
    .run();

  return id;
}

/** Build SharedData from analysis result and insert into D1. Returns share ID. */
export async function createShareFromResult(
  db: D1Database,
  result: AnalysisResult
): Promise<string> {
  const data = buildSharedData(result);
  return createShare(db, data);
}

const SHARE_API_URL = 'https://starcounter.pages.dev/api/share';

/** Create share via HTTP POST to the Pages Function (for daemon deploys where D1 isn't available). */
export async function createShareViaHttp(data: SharedData): Promise<string> {
  const json = JSON.stringify(data);
  const res = await fetch(SHARE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: json,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`share API failed: ${res.status} ${body}`);
  }

  const result = (await res.json()) as { id: string };
  return result.id;
}

/** Build SharedData from analysis result and POST to Pages Function. Returns share ID. */
export async function createShareFromResultViaHttp(result: AnalysisResult): Promise<string> {
  const data = buildSharedData(result);
  return createShareViaHttp(data);
}

export type { SharedData, StoredPost };
