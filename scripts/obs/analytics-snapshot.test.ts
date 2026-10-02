import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { expect, test } from "vitest";
import { currentAnalyticsSnapshot } from "./analytics-snapshot";

test("uses a sealed v5 snapshot only while the spine source is unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "opensidebar-analytics-current-"));
  assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}`));
  try {
    const spanDir = join(root, "spans");
    const sessionDir = join(spanDir, "s1");
    const source = join(sessionDir, "session.json");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(source, "{}");
    const startedAtMs = Date.now() - 1_000;
    const oldTime = new Date(startedAtMs - 2_000);
    for (const path of [source, sessionDir, spanDir])
      utimesSync(path, oldTime, oldTime);
    const snapshot = join(root, ".artifacts", "obs", "parquet", "snapshot-1");
    mkdirSync(snapshot, { recursive: true });
    writeFileSync(join(snapshot, "snapshot.json"), JSON.stringify({
      formatVersion: 5, startedAtMs, verifiedAtMs: startedAtMs + 1,
      sessions: 1, turnEntries: 0, turnSpans: 0,
      runEvents: 0, toolCalls: 0, turnUsage: 0,
    }));
    expect(currentAnalyticsSnapshot(root, spanDir)).toEqual({
      dir: snapshot, startedAtMs,
    });
    expect(currentAnalyticsSnapshot(root, spanDir, snapshot)).toEqual({
      dir: snapshot, startedAtMs,
    });
    writeFileSync(source, "{\"changed\":true}");
    expect(currentAnalyticsSnapshot(root, spanDir)).toBeNull();
    utimesSync(source, oldTime, oldTime);
    rmSync(source);
    expect(currentAnalyticsSnapshot(root, spanDir)).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
