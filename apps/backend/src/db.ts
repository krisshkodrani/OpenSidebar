/**
 * SQLite database for the task scheduler.
 * Memory is handled by GBrain — this is tasks-only.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  description  TEXT NOT NULL,
  query        TEXT NOT NULL,
  tab_url      TEXT,
  workspace_id TEXT,
  schedule     TEXT,
  run_at       INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending',
  last_run_at  INTEGER,
  result       TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_pending
  ON tasks(run_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_tasks_status
  ON tasks(status);
`;

export function initDatabase(dbPath: string): Database.Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 3000");

  // Run schema
  db.exec(SCHEMA);

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error("Database not initialized — call initDatabase() first");
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
