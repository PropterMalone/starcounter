// D1-backed state management for bot cursor and processed threads.

export type BotState = {
  readonly key: string;
  readonly value: string;
  readonly updatedAt: number;
};

export type ProcessedThread = {
  readonly threadUri: string;
  readonly shareId: string;
  readonly processedAt: number;
  readonly mentionCount: number;
  readonly postCount: number;
};

/** Get a bot state value by key. */
export async function getState(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM bot_state WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

/** Set a bot state value. Upserts. */
export async function setState(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO bot_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    )
    .bind(key, value, Date.now())
    .run();
}

/** Check if a thread has already been processed. Returns share ID if found. */
export async function getProcessedThread(
  db: D1Database,
  threadUri: string
): Promise<ProcessedThread | null> {
  const row = await db
    .prepare(
      'SELECT thread_uri, share_id, processed_at, mention_count, post_count FROM bot_processed_threads WHERE thread_uri = ?'
    )
    .bind(threadUri)
    .first<{
      thread_uri: string;
      share_id: string;
      processed_at: number;
      mention_count: number;
      post_count: number;
    }>();

  if (!row) return null;

  return {
    threadUri: row.thread_uri,
    shareId: row.share_id,
    processedAt: row.processed_at,
    mentionCount: row.mention_count,
    postCount: row.post_count,
  };
}

/** Record a processed thread. */
export async function saveProcessedThread(db: D1Database, thread: ProcessedThread): Promise<void> {
  await db
    .prepare(
      'INSERT INTO bot_processed_threads (thread_uri, share_id, processed_at, mention_count, post_count) VALUES (?, ?, ?, ?, ?) ON CONFLICT(thread_uri) DO UPDATE SET share_id = excluded.share_id, processed_at = excluded.processed_at, mention_count = excluded.mention_count, post_count = excluded.post_count'
    )
    .bind(
      thread.threadUri,
      thread.shareId,
      thread.processedAt,
      thread.mentionCount,
      thread.postCount
    )
    .run();
}

/** Check if a mention has already been replied to. */
export async function hasRepliedToMention(db: D1Database, mentionUri: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM bot_replied_mentions WHERE mention_uri = ?')
    .bind(mentionUri)
    .first();
  return row !== null;
}

/** Record that we replied to a mention. */
export async function saveRepliedMention(
  db: D1Database,
  mentionUri: string,
  threadUri: string,
  repliedAt: number
): Promise<void> {
  await db
    .prepare(
      'INSERT OR IGNORE INTO bot_replied_mentions (mention_uri, thread_uri, replied_at) VALUES (?, ?, ?)'
    )
    .bind(mentionUri, threadUri, repliedAt)
    .run();
}

/** SQL to create bot tables. Run via wrangler d1 execute. */
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS bot_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS bot_processed_threads (
    thread_uri TEXT PRIMARY KEY,
    share_id TEXT NOT NULL,
    processed_at INTEGER NOT NULL,
    mention_count INTEGER NOT NULL DEFAULT 0,
    post_count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS bot_replied_mentions (
    mention_uri TEXT PRIMARY KEY,
    thread_uri TEXT NOT NULL,
    replied_at INTEGER NOT NULL
  )`,
];
