import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expect, it } from "vitest";
import { listLegacyRunIds } from "./legacy-run-ids";

it("includes run-only JSONL and SQLite events during backfill", () => {
  const root = mkdtempSync(join(tmpdir(), "obs-run-ids-"));
  try {
    mkdirSync(join(root, "traces", "runs"), { recursive: true });
    mkdirSync(join(root, ".artifacts"), { recursive: true });
    writeFileSync(join(root, "traces", "runs", "file-only.jsonl"), "");
    const db = new Database(join(root, ".artifacts", "trace-index.sqlite"));
    db.exec("CREATE TABLE trace_run_events (run_id TEXT)");
    db.prepare("INSERT INTO trace_run_events (run_id) VALUES (?)").run("db-only");
    db.close();

    expect([...listLegacyRunIds(root, ["session-run"])].sort()).toEqual([
      "db-only",
      "file-only",
      "session-run",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("uses run files when an older index has no run-event table", () => {
  const root = mkdtempSync(join(tmpdir(), "obs-run-ids-"));
  try {
    mkdirSync(join(root, "traces", "runs"), { recursive: true });
    mkdirSync(join(root, ".artifacts"), { recursive: true });
    writeFileSync(join(root, "traces", "runs", "file-only.jsonl"), "");
    new Database(join(root, ".artifacts", "trace-index.sqlite")).close();
    expect([...listLegacyRunIds(root, [])]).toEqual(["file-only"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
