/**
 * Dual-read parity check (RFC LP-7, Stage B1). For every session that has spine
 * records, asserts the spine-derived entries are order-independently equal to
 * what the existing store returns. This is the gate that must pass before the
 * remaining legacy reads and writes can be retired. Run after a backfill:
 * pnpm run obs:verify-parity
 */

import Database from "better-sqlite3";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { createDiskStore, PROJECT_ROOT } from "./core";
import { readSessionEntries, readSpineRunEvents, readSpineRunManifest,
  readSpineSessionsAsync, RUN_DIR } from "./span-store";
import { summarizeParityCoverage } from "./parity-coverage";
import { listLegacyRunIds } from "./legacy-run-ids";
import { readLegacyRunManifests } from "./legacy-run-manifests";
import { orderTraceEntries } from "./session-read-policy";

/** Stable, key-order-independent serialization for deep comparison. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const record = val as Record<string, unknown>;
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = record[key];
          return acc;
        }, {});
    }
    return val;
  });
}

async function main(): Promise<void> {
  // Compare against the independent legacy lens. The default store is
  // spine-first and would otherwise compare spine records with themselves.
  const store = createDiskStore(PROJECT_ROOT, { spineReads: false });
  const dbFile = join(PROJECT_ROOT, ".artifacts", "trace-index.sqlite");
  const db = existsSync(dbFile) ? new Database(dbFile, { readonly: true }) : null;
  const turnRows = db?.prepare(
    "SELECT raw_json FROM trace_turns WHERE session_id = ? ORDER BY turn_number",
  );
  const runRows = db?.prepare(
    "SELECT raw_json FROM trace_run_events WHERE run_id = ? ORDER BY ordinal",
  );
  const legacyRows = (statement: Database.Statement | undefined, id: string) =>
    statement?.all(id).map((row) => JSON.parse((row as { raw_json: string }).raw_json)) ?? [];
  const sessions = store.loadSessions();
  const spineSessions = await readSpineSessionsAsync();
  const coverage = summarizeParityCoverage(
    sessions.map((session) => session.sessionId).filter((id): id is string => Boolean(id)),
    spineSessions.map((session) => session.sessionId).filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const storeOnly = new Set(coverage.storeOnly);
  let checked = 0;
  let mismatches = coverage.storeOnly.length + coverage.spineOnly.length;

  for (const session of sessions) {
    if (!session.sessionId) continue;
    if (storeOnly.has(session.sessionId)) continue;
    const spine = readSessionEntries(session.sessionId);
    const indexed = legacyRows(turnRows, session.sessionId);
    const existing = indexed.length > 0 ? indexed : store.loadEntries(session.sessionId);
    if (spine.length === 0 && existing.length === 0) continue;
    checked += 1;
    if (stable(orderTraceEntries(spine)) !== stable(orderTraceEntries(existing))) {
      mismatches += 1;
      console.error(
        `  MISMATCH ${session.sessionId}: spine ${spine.length} vs store ${existing.length} entries`,
      );
    }
    if (checked % 1000 === 0)
      console.log(`[obs] checked ${checked} session entries`);
  }

  // Sessions lens: every spine session must equal the store's session record.
  const storeById = new Map<string, unknown>();
  for (const session of sessions) {
    if (typeof session.sessionId === "string") {
      storeById.set(session.sessionId, session);
    }
  }
  let sessionsChecked = 0;
  for (const spineSession of spineSessions) {
    const sessionId =
      typeof spineSession.sessionId === "string" ? spineSession.sessionId : "";
    const existing = storeById.get(sessionId);
    if (!existing) continue;
    sessionsChecked += 1;
    if (stable(spineSession) !== stable(existing)) {
      mismatches += 1;
      console.error(`  SESSION MISMATCH ${sessionId}`);
    }
  }

  const legacyRunIds = listLegacyRunIds(
    store.projectRoot,
    sessions.map((session) => session.runId).filter((id): id is string => Boolean(id)),
  );
  const spineRunIds = existsSync(RUN_DIR)
    ? readdirSync(RUN_DIR).filter((file) => file.endsWith(".jsonl")).map((file) => file.slice(0, -6))
    : [];
  const runCoverage = summarizeParityCoverage(legacyRunIds, spineRunIds);
  mismatches += runCoverage.storeOnly.length + runCoverage.spineOnly.length;
  let runsChecked = 0;
  const spineRunSet = new Set(spineRunIds);
  for (const runId of legacyRunIds) {
    if (!spineRunSet.has(runId)) continue;
    runsChecked += 1;
    const indexed = legacyRows(runRows, runId);
    const existing = indexed.length > 0 ? indexed : store.loadRunEvents(runId);
    if (stable(existing) !== stable(readSpineRunEvents(runId))) {
      mismatches += 1;
      console.error(`  RUN MISMATCH ${runId}`);
    }
  }

  const legacyManifests = readLegacyRunManifests(join(PROJECT_ROOT, "traces", "runs"));
  const spineManifestIds = existsSync(RUN_DIR)
    ? readdirSync(RUN_DIR).filter((file) => file.endsWith(".manifest.json"))
      .map((file) => file.slice(0, -14))
    : [];
  const manifestCoverage = summarizeParityCoverage(
    [...legacyManifests.keys()], spineManifestIds);
  mismatches += manifestCoverage.storeOnly.length + manifestCoverage.spineOnly.length;
  let manifestsChecked = 0;
  const spineManifestSet = new Set(spineManifestIds);
  for (const [runId, manifest] of legacyManifests) {
    if (!spineManifestSet.has(runId)) continue;
    manifestsChecked += 1;
    if (stable(manifest) !== stable(readSpineRunManifest(runId))) {
      mismatches += 1;
      console.error(`  RUN MANIFEST MISMATCH ${runId}`);
    }
  }

  console.log(
    `[obs] dual-read parity: entries ${checked} session(s), sessions ${sessionsChecked} record(s), runs ${runsChecked} checked, manifests ${manifestsChecked} checked; ${coverage.storeOnly.length} store-only and ${coverage.spineOnly.length} spine-only session(s), ${runCoverage.storeOnly.length} store-only and ${runCoverage.spineOnly.length} spine-only run(s), ${manifestCoverage.storeOnly.length} store-only and ${manifestCoverage.spineOnly.length} spine-only manifest(s), ${mismatches} mismatch(es)`,
  );
  db?.close();
  if (mismatches > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
