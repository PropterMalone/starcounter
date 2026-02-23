// Standalone daemon entry point for running the Starcounter bot on Malone.
// Uses local SQLite for bot state and HTTP POST to Pages Function for shares.

import { SqliteAdapter } from './sqlite-adapter';
import { MIGRATIONS } from './state';
import { runBot } from './bot';
import type { Env } from './types';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const POLL_INTERVAL_MS = 60_000;

const SHARED_RESULTS_MIGRATION = `CREATE TABLE IF NOT EXISTS shared_results (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`;

function loadEnv(): { handle: string; password: string; dbPath: string } {
  const handle = process.env['BSKY_HANDLE'];
  const password = process.env['BSKY_PASSWORD'];
  const dbPath = process.env['BOT_DB_PATH'] ?? './data/bot.db';

  if (!handle || !password) {
    console.error('BSKY_HANDLE and BSKY_PASSWORD are required');
    process.exit(1);
  }

  return { handle, password, dbPath };
}

function initDatabase(dbPath: string): SqliteAdapter {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new SqliteAdapter(dbPath);

  // Run bot state migrations
  for (const sql of MIGRATIONS) {
    db.prepare(sql).bind().run();
  }
  // Shared results table (needed for the D1 interface even though we POST via HTTP —
  // the table exists in case we ever want local fallback)
  db.prepare(SHARED_RESULTS_MIGRATION).bind().run();

  console.log(`database initialized at ${dbPath}`);
  return db;
}

async function main(): Promise<void> {
  const { handle, password, dbPath } = loadEnv();
  const db = initDatabase(dbPath);

  // The SqliteAdapter implements the D1Database subset the bot uses
  const env: Env = {
    SHARED_RESULTS: db as unknown as D1Database,
    BSKY_HANDLE: handle,
    BSKY_PASSWORD: password,
  };

  let running = true;

  const shutdown = () => {
    console.log('shutting down...');
    running = false;
    db.close();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log(`starcounter bot daemon started (poll every ${POLL_INTERVAL_MS / 1000}s)`);

  while (running) {
    try {
      const result = await runBot(env, false, { useHttpShares: true });
      console.log(
        `[${new Date().toISOString()}] processed=${result.processed} errors=${result.errors}`
      );
    } catch (err) {
      console.error(`[${new Date().toISOString()}] runBot crashed:`, err);
    }

    // Sleep with interruptibility
    if (running) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, POLL_INTERVAL_MS);
        // Allow SIGTERM to break out of sleep
        const onShutdown = () => {
          clearTimeout(timer);
          resolve();
        };
        process.once('SIGTERM', onShutdown);
        process.once('SIGINT', onShutdown);
      });
    }
  }

  console.log('bot daemon stopped');
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
