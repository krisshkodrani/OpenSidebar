/** Read-only Stage B1 acceptance against the local trace corpus and HTTP API. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PROJECT_ROOT } from "./paths";
import { currentAnalyticsSnapshot } from "./analytics-snapshot";
import { readSessionEntries, readSpineRunEvents, readSpineRunManifest,
  readSpineSessionRecord, RUN_DIR, SPAN_DIR } from "./span-store";

function normalizeFloatingPoint(value: unknown): unknown {
  if (typeof value === "number" && !Number.isInteger(value))
    return Number(value.toFixed(10));
  if (Array.isArray(value)) return value.map(normalizeFloatingPoint);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, normalizeFloatingPoint(item)]));
  return value;
}

function readLongJson(url: string): Promise<{ status: number; body: string; source: string; timing: string }> {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf-8"),
        source: String(response.headers["x-opensidebar-insights-source"] ?? ""),
        timing: String(response.headers["server-timing"] ?? ""),
      }));
      response.on("error", reject);
    });
    request.setTimeout(600_000, () => request.destroy(new Error("insights request timed out")));
    request.on("error", reject);
  });
}

async function availablePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => reservation.close((error) =>
    error ? reject(error) : resolve()));
  return address.port;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  child.kill();
  await exited;
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function checkMode(
  mode: "spine" | "legacy" | "duckdb",
  ids: string[],
  runIds: string[],
): Promise<{ entries: unknown[][]; search: unknown[]; runs: unknown[][]; insights: unknown }> {
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [
    join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
    join(PROJECT_ROOT, "scripts", "log-server.ts"),
  ], { cwd: PROJECT_ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LOG_SERVER_PORT: String(port),
      LOG_SERVER_SKIP_TRACE_WARMUP: "1",
      OBS_DISABLE_SPINE_READS: mode === "legacy" ? "1" : "0",
      OBS_SPINE_READS: mode === "spine" ? "1" : "0",
      OBS_ANALYTICS: mode === "duckdb" ? "duckdb" : "0",
      OBS_ANALYTICS_SNAPSHOT: mode === "duckdb"
        ? currentAnalyticsSnapshot(PROJECT_ROOT, SPAN_DIR)?.dir : undefined } });
  let errors = "";
  child.stdout?.resume();
  child.stderr?.on("data", (chunk: Buffer) => {
    errors = (errors + chunk.toString()).slice(-2_000);
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
        ready = response.ok;
        if (ready) break;
      } catch { /* wait for startup */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, `${mode} server did not start: ${errors}`);
    const entries: unknown[][] = [];
    const search: unknown[] = [];
    const runs: unknown[][] = [];
    if (!process.argv.includes("--insights-only") &&
        !process.argv.includes("--duckdb-only")) {
    for (const id of ids) {
      const response = await fetch(`${base}/api/traces/${id}`,
        { signal: AbortSignal.timeout(15_000) });
      assert.equal(response.status, 200);
      const actual = await response.json() as unknown[];
      const expected = readSessionEntries(id);
      const mismatch = actual.findIndex((entry, index) =>
        !isDeepStrictEqual(entry, expected[index]));
      assert.equal(actual.length, expected.length,
        `${mode} session ${id}: different turn count`);
      assert.equal(mismatch, -1,
        `${mode} session ${id}: turn ${mismatch + 1} differs from spine`);
      entries.push(actual);

      const raw = await fetch(`${base}/api/traces/${id}/raw-jsonl`,
        { signal: AbortSignal.timeout(15_000) });
      assert.equal(raw.status, 200);
      const rawEntries = (await raw.text()).trim().split("\n")
        .map((line) => JSON.parse(line) as unknown);
      const header = readSpineSessionRecord(id);
      const expectedRaw = [...(header ? [header] : []), ...actual];
      assert.equal(rawEntries.length, expectedRaw.length,
        `${mode} session ${id}: raw turn count differs`);
      const rawMismatch = rawEntries.findIndex((entry, index) =>
        !isDeepStrictEqual(entry, expectedRaw[index]));
      assert.equal(rawMismatch, -1,
        `${mode} session ${id}: raw turn ${rawMismatch + 1} differs`);

      const found = await fetch(`${base}/api/traces/search?sessionIdPrefix=${id}&meta=1&limit=2`,
        { signal: AbortSignal.timeout(120_000) });
      assert.equal(found.status, 200);
      const result = await found.json() as { items: Array<{ sessionId?: string }> };
      assert.ok(result.items.some((item) => item.sessionId === id));
      search.push(result);
    }
    for (const runId of runIds) {
      const response = await fetch(`${base}/api/run-traces/${runId}`,
        { signal: AbortSignal.timeout(15_000) });
      assert.equal(response.status, 200);
      const events = await response.json() as Record<string, unknown>[];
      const expected = readSpineRunEvents(runId).sort((a, b) =>
        String(a.ts ?? a.recordedAt ?? "").localeCompare(
          String(b.ts ?? b.recordedAt ?? "")));
      assert.deepStrictEqual(events, expected);
      runs.push(events);

      const raw = await fetch(`${base}/api/run-traces/${runId}/raw-jsonl`,
        { signal: AbortSignal.timeout(15_000) });
      assert.equal(raw.status, 200);
      const manifest = readSpineRunManifest(runId);
      const rawEvents = (await raw.text()).trim().split("\n")
        .map((line) => JSON.parse(line) as unknown);
      assert.deepStrictEqual(rawEvents,
        [...(manifest ? [manifest] : []), ...readSpineRunEvents(runId)]);
    }
    }
    const insightsStart = Date.now();
    const insightsQuery = process.argv.includes("--all-insights")
      ? ""
      : `?sessionId=${encodeURIComponent(ids[0])}`;
    const insightsResponse = await readLongJson(
      `${base}/api/trace-insights${insightsQuery}`,
    ).catch((error: unknown) => {
      throw new Error(`${mode} insights transport failed (server exit ${child.exitCode}, signal ${child.signalCode}): ${errors}`, { cause: error });
    });
    if (insightsResponse.status !== 200) {
      throw new Error(`${mode} insights failed: ${insightsResponse.body}`);
    }
    assert.equal(insightsResponse.source,
      mode === "legacy" ? "sqlite" : mode,
      `${mode} insights used an unexpected source`);
    const insights = JSON.parse(insightsResponse.body) as unknown;
    console.log(`[obs] ${mode} insights HTTP: ${Date.now() - insightsStart}ms`);
    if (insightsResponse.timing) console.log(`[obs] ${mode} server timing: ${insightsResponse.timing}`);
    return { entries, search, runs, insights };
  } finally {
    await stop(child);
  }
}

async function main(): Promise<void> {
  assert.ok(existsSync(SPAN_DIR), "Run the span backfill before HTTP acceptance.");
  const sessionDirs = readdirSync(SPAN_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "runs" &&
      existsSync(join(SPAN_DIR, entry.name, "session.json")));
  const withTurns = sessionDirs.filter((entry) =>
    readdirSync(join(SPAN_DIR, entry.name)).some((file) => /^T\d+\.json$/.test(file)))
    .slice(0, 3).map((entry) => entry.name);
  const withoutTurns = sessionDirs.find((entry) =>
    !readdirSync(join(SPAN_DIR, entry.name)).some((file) => /^T\d+\.json$/.test(file)))?.name;
  assert.equal(withTurns.length, 3, "Need three backfilled sessions with turns.");
  assert.ok(withoutTurns, "Need a backfilled session without turns.");
  const ids = [...withTurns, withoutTurns];
  const withEvents = readdirSync(RUN_DIR)
    .filter((file) => file.endsWith(".jsonl") &&
      statSync(join(RUN_DIR, file)).size > 0 &&
      existsSync(join(RUN_DIR, `${file.slice(0, -6)}.manifest.json`)))
    .slice(0, 2).map((file) => file.slice(0, -6));
  const withoutEvents = readdirSync(RUN_DIR)
    .filter((file) => file.endsWith(".manifest.json"))
    .map((file) => file.slice(0, -14))
    .find((id) => !existsSync(join(RUN_DIR, `${id}.jsonl`)) ||
      statSync(join(RUN_DIR, `${id}.jsonl`)).size === 0);
  assert.equal(withEvents.length, 2, "Need two backfilled runs with events and manifests.");
  assert.ok(withoutEvents, "Need a backfilled run manifest without events.");
  const runIds = [...withEvents, withoutEvents];
  if (process.argv.includes("--duckdb-only")) {
    assert.ok(currentAnalyticsSnapshot(PROJECT_ROOT, SPAN_DIR),
      "Build a current verified v5 snapshot before DuckDB HTTP acceptance.");
    await checkMode("duckdb", ids, runIds);
    console.log("[obs] DuckDB insights HTTP acceptance passed.");
    return;
  }
  const legacy = await checkMode("legacy", ids, runIds);
  const { insights: legacyInsights, ...legacyReads } = legacy;
  if (!process.argv.includes("--insights-only")) {
    const spine = await checkMode("spine", ids, runIds);
    const { insights: spineInsights, ...spineReads } = spine;
    assert.deepStrictEqual(legacyReads, spineReads);
    if (!isDeepStrictEqual(normalizeFloatingPoint(legacyInsights),
      normalizeFloatingPoint(spineInsights))) {
      const artifacts = join(PROJECT_ROOT, ".artifacts", "obs-insights-acceptance");
      mkdirSync(artifacts, { recursive: true });
      writeFileSync(join(artifacts, "spine.json"), JSON.stringify(spineInsights));
      writeFileSync(join(artifacts, "sqlite.json"), JSON.stringify(legacyInsights));
      throw new Error(`Insights parity failed; local responses saved under ${artifacts}`);
    }
  }
  if (process.argv.includes("--duckdb")) {
    assert.ok(currentAnalyticsSnapshot(PROJECT_ROOT, SPAN_DIR),
      "Build a current verified v5 snapshot before DuckDB HTTP acceptance.");
    const duckdb = await checkMode("duckdb", ids, runIds);
    const { insights: duckdbInsights, ...duckdbReads } = duckdb;
    assert.deepStrictEqual(duckdbReads, legacyReads);
    assert.deepStrictEqual(normalizeFloatingPoint(duckdbInsights),
      normalizeFloatingPoint(legacyInsights));
  }
  console.log(`[obs] HTTP read acceptance passed for ${ids.length} sessions, ${runIds.length} runs, and ${process.argv.includes("--all-insights") ? "unfiltered" : "session-filtered"} insights${process.argv.includes("--duckdb") ? " with DuckDB" : ""} (insights floats compared to 10 decimal places).`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
