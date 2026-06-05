// D1Database-compatible wrapper around better-sqlite3.
// Implements only the subset used by state.ts and share-creator.ts:
// db.prepare(sql).bind(...args).first<T>() and .run()

import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';

class BoundStatement {
  private readonly stmt: BetterSqlite3.Statement;
  private readonly args: unknown[];

  constructor(stmt: BetterSqlite3.Statement, args: unknown[]) {
    this.stmt = stmt;
    this.args = args;
  }

  first<T = Record<string, unknown>>(): T | null {
    const row = this.stmt.get(...this.args) as T | undefined;
    return row ?? null;
  }

  run(): void {
    this.stmt.run(...this.args);
  }
}

class PreparedStatement {
  private readonly stmt: BetterSqlite3.Statement;

  constructor(stmt: BetterSqlite3.Statement) {
    this.stmt = stmt;
  }

  bind(...args: unknown[]): BoundStatement {
    return new BoundStatement(this.stmt, args);
  }
}

/** Wraps a better-sqlite3 Database to match the D1Database interface used by the bot. */
export class SqliteAdapter {
  private readonly db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
  }

  prepare(sql: string): PreparedStatement {
    return new PreparedStatement(this.db.prepare(sql));
  }

  close(): void {
    this.db.close();
  }
}
