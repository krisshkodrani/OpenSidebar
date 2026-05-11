import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import "../setup";
import {
  applyTraceArchivePlan,
  buildTraceArchivePlan,
} from "../../../../scripts/trace-archive";

function writeJsonl(path: string, records: unknown[]) {
  writeFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

describe("trace archive", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "opensidebar-trace-archive-"));
    const traces = join(root, "traces");
    const runs = join(traces, "runs");
    const screenshots = join(traces, "screenshots");
    const logs = join(root, "logs");
    rmSync(root, { recursive: true, force: true });
    for (const dir of [traces, runs, screenshots, logs]) {
      mkdirSync(dir, { recursive: true });
    }
    const now = Date.UTC(2026, 4, 11);
    writeJsonl(join(traces, "index.jsonl"), [
      {
        sessionId: "old-session",
        runId: "old-run",
        startTime: now - 8 * 24 * 60 * 60 * 1000,
      },
      {
        sessionId: "hot-session",
        runId: "hot-run",
        startTime: now - 2 * 24 * 60 * 60 * 1000,
      },
    ]);
    writeJsonl(join(runs, "index.jsonl"), [
      { runId: "old-run", startedAt: "2026-05-03T00:00:00.000Z" },
      { runId: "hot-run", startedAt: "2026-05-09T00:00:00.000Z" },
    ]);
    writeJsonl(join(traces, "old-session.jsonl"), [{ turnNumber: 1 }]);
    writeJsonl(join(traces, "hot-session.jsonl"), [{ turnNumber: 1 }]);
    writeJsonl(join(runs, "old-run.jsonl"), [{ type: "old" }]);
    writeJsonl(join(runs, "hot-run.jsonl"), [{ type: "hot" }]);
    writeFileSync(join(screenshots, "old-session-T1.jpg"), "old-shot");
    writeFileSync(join(screenshots, "hot-session-T1.jpg"), "hot-shot");
    writeJsonl(join(logs, "session-old-session.jsonl"), [{ msg: "old-log" }]);
    writeJsonl(join(logs, "session-hot-session.jsonl"), [{ msg: "hot-log" }]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("plans only sessions older than the hot window", () => {
    const plan = buildTraceArchivePlan({
      projectRoot: root,
      nowMs: Date.UTC(2026, 4, 11),
      hotDays: 7,
    });

    expect(plan.sessionIds).toEqual(["old-session"]);
    expect(plan.runIds).toEqual(["old-run"]);
    expect(plan.moves.map((move) => move.kind)).toEqual(
      expect.arrayContaining([
        "session",
        "run",
        "screenshot",
        "session_log",
        "session_index",
        "run_index",
      ]),
    );
  });

  test("moves old artifacts and rewrites hot indexes on apply", () => {
    const plan = buildTraceArchivePlan({
      projectRoot: root,
      nowMs: Date.UTC(2026, 4, 11),
      hotDays: 7,
    });

    applyTraceArchivePlan(plan);

    expect(existsSync(join(root, "traces", "old-session.jsonl"))).toBe(false);
    expect(existsSync(join(root, "traces", "hot-session.jsonl"))).toBe(true);
    expect(
      existsSync(
        join(root, ".artifacts", "trace-archive", "2026-05", "traces", "old-session.jsonl"),
      ),
    ).toBe(true);
    expect(readFileSync(join(root, "traces", "index.jsonl"), "utf-8")).toContain(
      "hot-session",
    );
    expect(readFileSync(join(root, "traces", "index.jsonl"), "utf-8")).not.toContain(
      "old-session",
    );
    expect(
      readFileSync(
        join(root, ".artifacts", "trace-archive", "indexes", "sessions.jsonl"),
        "utf-8",
      ),
    ).toContain("old-session");
  });
});
