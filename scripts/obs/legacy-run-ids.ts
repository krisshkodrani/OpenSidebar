import Database from "better-sqlite3";
import { existsSync, readdirSync } from "fs";
import { join } from "path";

/** Include run events with no linked agent session during a spine backfill. */
export function listLegacyRunIds(
  projectRoot: string,
  sessionRunIds: Iterable<string>,
): Set<string> {
  const ids = new Set([...sessionRunIds].filter(Boolean));
  const runDir = join(projectRoot, "traces", "runs");
  if (existsSync(runDir)) {
    for (const file of readdirSync(runDir)) {
      if (file.endsWith(".jsonl")) ids.add(file.slice(0, -6));
    }
  }
  const dbFile = join(projectRoot, ".artifacts", "trace-index.sqlite");
  if (existsSync(dbFile)) {
    const db = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      const hasRunEvents = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'trace_run_events'",
      ).get();
      if (hasRunEvents) {
        for (const row of db.prepare("SELECT DISTINCT run_id FROM trace_run_events").all() as Array<{ run_id: string }>) {
          if (row.run_id) ids.add(row.run_id);
        }
      }
    } finally {
      db.close();
    }
  }
  return ids;
}
