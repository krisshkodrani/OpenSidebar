import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { indexTracesToSqlite } from "../../../../scripts/trace-sqlite-index";
import {
  applyTraceDeleteOldPlan,
  buildTraceDeleteOldPlan,
} from "../../../../scripts/trace-delete-old";

function writeJsonl(path: string, records: unknown[]) {
  writeFileSync(
    path,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
}

describe("trace delete old", () => {
  let root: string;
  let dbPath: string;
  const nowMs = Date.UTC(2026, 4, 12);
  const oldMs = Date.UTC(2026, 4, 1);
  const newMs = Date.UTC(2026, 4, 11);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "opensidebar-trace-delete-"));
    dbPath = join(root, ".artifacts", "trace-index.sqlite");
    const traces = join(root, "traces");
    const runs = join(traces, "runs");
    const screenshots = join(traces, "screenshots");
    const logs = join(root, "logs");
    for (const dir of [traces, runs, screenshots, logs]) {
      mkdirSync(dir, { recursive: true });
    }
    writeJsonl(join(traces, "index.jsonl"), [
      {
        sessionId: "old-session",
        runId: "old-run",
        startTime: oldMs,
        startUrl: "https://old.example",
        outcome: "completed",
      },
      {
        sessionId: "new-session",
        runId: "new-run",
        startTime: newMs,
        startUrl: "https://new.example",
        outcome: "completed",
      },
    ]);
    writeJsonl(join(traces, "old-session.jsonl"), [
      { sessionId: "old-session", runId: "old-run", turnNumber: 1 },
    ]);
    writeJsonl(join(traces, "new-session.jsonl"), [
      { sessionId: "new-session", runId: "new-run", turnNumber: 1 },
    ]);
    writeJsonl(join(runs, "index.jsonl"), [
      { runId: "old-run" },
      { runId: "new-run" },
    ]);
    writeJsonl(join(runs, "old-run.jsonl"), [
      { runId: "old-run", type: "node.completed" },
    ]);
    writeJsonl(join(runs, "new-run.jsonl"), [
      { runId: "new-run", type: "node.completed" },
    ]);
    writeFileSync(join(screenshots, "old-session-T1.jpg"), "old-shot");
    writeFileSync(join(logs, "session-old-session.jsonl"), "{}\n");

    indexTracesToSqlite({ projectRoot: root, dbPath });
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  test("plans and applies safe deletion for raw files older than retention", () => {
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    const plan = buildTraceDeleteOldPlan({
      projectRoot: root,
      dbPath,
      hotDays: 7,
      apply: false,
    });

    expect(plan.sessionIds.has("old-session")).toBe(true);
    expect(plan.runIds.has("old-run")).toBe(true);
    expect(plan.files.some((file) => file.endsWith("old-session.jsonl"))).toBe(
      true,
    );

    applyTraceDeleteOldPlan(
      { projectRoot: root, dbPath, hotDays: 7, apply: true },
      plan,
    );

    expect(existsSync(join(root, "traces", "old-session.jsonl"))).toBe(false);
    expect(existsSync(join(root, "traces", "new-session.jsonl"))).toBe(true);
    expect(existsSync(join(root, "traces", "runs", "old-run.jsonl"))).toBe(
      false,
    );
    expect(existsSync(join(root, "traces", "runs", "new-run.jsonl"))).toBe(
      true,
    );

    const db = new Database(dbPath, { readonly: true });
    expect(
      db
        .prepare("SELECT COUNT(*) AS count FROM trace_turns WHERE session_id = ?")
        .get("old-session"),
    ).toMatchObject({ count: 1 });
    db.close();
  });
});
