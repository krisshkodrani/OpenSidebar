/**
 * SQLite database for the backend scheduler, durable task ledger, and memory store.
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

CREATE TABLE IF NOT EXISTS memory_entries (
  id              TEXT NOT NULL UNIQUE,
  workspace_id    TEXT,
  domain          TEXT,
  category        TEXT NOT NULL,
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  metadata_json   TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_accessed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_memory_entries_category_updated
  ON memory_entries(category, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_entries_domain_updated
  ON memory_entries(domain, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_entries_workspace_updated
  ON memory_entries(workspace_id, updated_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_entries_fts USING fts5(
  title,
  content,
  content='memory_entries',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memory_entries_ai AFTER INSERT ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(rowid, title, content)
  VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memory_entries_ad AFTER DELETE ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(memory_entries_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS memory_entries_au AFTER UPDATE ON memory_entries BEGIN
  INSERT INTO memory_entries_fts(memory_entries_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, old.content);
  INSERT INTO memory_entries_fts(rowid, title, content)
  VALUES (new.rowid, new.title, new.content);
END;

CREATE TABLE IF NOT EXISTS task_runs (
  id                     TEXT PRIMARY KEY,
  client_run_id          TEXT,
  workspace_id           TEXT NOT NULL,
  query                  TEXT NOT NULL,
  root_tab_id            INTEGER,
  root_tab_url           TEXT,
  turn_number            INTEGER,
  status                 TEXT NOT NULL,
  started_at             INTEGER,
  finished_at            INTEGER,
  termination_reason     TEXT,
  checkpoint_summary_json TEXT,
  session_metrics_json   TEXT,
  budget_json            TEXT,
  resume_state_version   INTEGER NOT NULL DEFAULT 1,
  node_counts_json       TEXT,
  resume_requested_at    INTEGER,
  resume_requested_reason TEXT,
  stop_requested_at      INTEGER,
  stop_requested_reason  TEXT,
  last_resume_source     TEXT,
  last_known_resume_safe INTEGER,
  last_resume_safety_checked_at INTEGER,
  last_known_resume_reason TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_runs_workspace_status_updated
  ON task_runs(workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_runs_updated
  ON task_runs(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_runs_control_pending
  ON task_runs(updated_at DESC, resume_requested_at DESC, stop_requested_at DESC);

CREATE TABLE IF NOT EXISTS task_run_nodes (
  run_id                   TEXT NOT NULL,
  node_id                  TEXT NOT NULL,
  description              TEXT NOT NULL,
  success_criteria         TEXT NOT NULL,
  selected_skill_id        TEXT,
  selected_skill_reason    TEXT,
  allowed_tools_json       TEXT NOT NULL,
  dependencies_json        TEXT NOT NULL,
  assumptions_json         TEXT NOT NULL,
  verification_gate_json   TEXT,
  handoff_artifacts_json   TEXT NOT NULL,
  reflexion_log_json       TEXT NOT NULL,
  handoff_depth            INTEGER NOT NULL DEFAULT 0,
  handoff_from_node_id     TEXT,
  trajectory_json          TEXT,
  status                   TEXT NOT NULL,
  retries                  INTEGER NOT NULL DEFAULT 0,
  result                   TEXT,
  error                    TEXT,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL,
  PRIMARY KEY (run_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_task_run_nodes_run_status
  ON task_run_nodes(run_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS task_run_progress (
  run_id        TEXT NOT NULL,
  key           TEXT NOT NULL,
  kind          TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (run_id, key)
);

CREATE INDEX IF NOT EXISTS idx_task_run_progress_run_kind
  ON task_run_progress(run_id, kind);

CREATE TABLE IF NOT EXISTS task_run_pending_interactions (
  run_id         TEXT PRIMARY KEY,
  node_id        TEXT,
  kind           TEXT NOT NULL,
  payload_json   TEXT NOT NULL,
  requested_at   INTEGER NOT NULL,
  timeout_at     INTEGER,
  status         TEXT NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_run_side_effects (
  id                    TEXT PRIMARY KEY,
  run_id                TEXT NOT NULL,
  node_id               TEXT,
  tool_name             TEXT NOT NULL,
  args_json             TEXT NOT NULL,
  result                TEXT NOT NULL,
  timestamp             INTEGER NOT NULL,
  snapshot_fingerprint  TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_run_side_effects_run_ts
  ON task_run_side_effects(run_id, timestamp DESC);
`;

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const existing = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  if (existing.some((entry) => entry.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureFts5Available(database: Database.Database): void {
  const enabled = database
    .prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5')")
    .pluck()
    .get();
  if (enabled !== 1) {
    throw new Error(
      "SQLite FTS5 support is required for native backend memory but is unavailable in this build.",
    );
  }
}

export function initDatabase(dbPath: string): Database.Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 3000");
  ensureFts5Available(db);

  // Run schema
  db.exec(SCHEMA);
  db.prepare("INSERT INTO memory_entries_fts(memory_entries_fts) VALUES ('rebuild')").run();
  ensureColumn(db, "memory_entries", "workspace_id", "TEXT");
  ensureColumn(db, "memory_entries", "domain", "TEXT");
  ensureColumn(db, "memory_entries", "metadata_json", "TEXT");
  ensureColumn(db, "memory_entries", "last_accessed_at", "INTEGER");
  ensureColumn(db, "task_runs", "node_counts_json", "TEXT");
  ensureColumn(db, "task_runs", "resume_requested_at", "INTEGER");
  ensureColumn(db, "task_runs", "resume_requested_reason", "TEXT");
  ensureColumn(db, "task_runs", "stop_requested_at", "INTEGER");
  ensureColumn(db, "task_runs", "stop_requested_reason", "TEXT");
  ensureColumn(db, "task_runs", "last_resume_source", "TEXT");
  ensureColumn(db, "task_runs", "last_known_resume_safe", "INTEGER");
  ensureColumn(db, "task_runs", "last_resume_safety_checked_at", "INTEGER");
  ensureColumn(db, "task_runs", "last_known_resume_reason", "TEXT");

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
