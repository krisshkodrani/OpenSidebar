/**
 * Idempotent span backfill (RFC LP-7, Stage B1). Re-projects historical traces
 * into the span spine — entries, sessions, and run events (all three read
 * lenses) — using the same deterministic mappers the live dual-write uses, so
 * running it twice produces identical output. Reads through the same store the
 * MCP/HTTP layers use.
 *
 * Usage: pnpm run obs:backfill-spans -- [--limit 200] [--missing-only]
 *        pnpm run obs:backfill-spans -- --manifests-only --missing-only
 */

import { existsSync } from "fs";
import { join } from "path";
import { createDiskStore, PROJECT_ROOT } from "./core";
import {
  RUN_DIR,
  SPAN_DIR,
  writeEntryRecord,
  writeRunManifestRecord,
  writeRunEvents,
  writeSessionRecord,
} from "./span-store";
import type { TraceEntry } from "../../apps/extension/src/types/traces";
import { listLegacyRunIds } from "./legacy-run-ids";
import { readLegacyRunManifests } from "./legacy-run-manifests";

function flag(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main(): void {
  const missingOnly = process.argv.includes("--missing-only");
  const manifestsOnly = process.argv.includes("--manifests-only");
  const limit = flag("--limit") ? Number(flag("--limit")) : Infinity;
  let manifests = 0;
  if (manifestsOnly || !Number.isFinite(limit)) {
    for (const [runId, manifest] of readLegacyRunManifests(
      join(PROJECT_ROOT, "traces", "runs"))) {
      if (missingOnly && existsSync(join(RUN_DIR, `${runId}.manifest.json`)))
        continue;
      writeRunManifestRecord(manifest);
      manifests += 1;
    }
  }
  if (manifestsOnly) {
    console.log(`[obs] backfilled ${manifests} run manifest(s)`);
    return;
  }
  const store = missingOnly
    ? createDiskStore(PROJECT_ROOT, { spineReads: false })
    : createDiskStore();
  const runsOnly = process.argv.includes("--runs-only");
  const sessions = store.loadSessions()
    .filter((session) => !missingOnly || !session.sessionId ||
      !existsSync(join(SPAN_DIR, session.sessionId, "session.json")))
    .slice(0, limit);

  let turns = 0;
  const sessionRunIds = new Set<string>();
  for (const session of sessions) {
    if (!session.sessionId) continue;
    if (!runsOnly) {
      writeSessionRecord(session as unknown as Record<string, unknown>);
      for (const entry of store.loadEntries(session.sessionId)) {
        writeEntryRecord(entry as unknown as TraceEntry);
        turns += 1;
        if (typeof entry.runId === "string" && entry.runId)
          sessionRunIds.add(entry.runId);
      }
    }
    if (typeof session.runId === "string" && session.runId) {
      sessionRunIds.add(session.runId);
    }
  }
  const runIds = listLegacyRunIds(store.projectRoot, sessionRunIds);
  const selectedRunIds = missingOnly
    ? [...runIds].filter((runId) => !existsSync(join(RUN_DIR, `${runId}.jsonl`)))
    : [...runIds];
  for (const runId of selectedRunIds) {
    writeRunEvents(
      runId,
      store.loadRunEvents(runId) as unknown as Record<string, unknown>[],
    );
  }

  console.log(
    `[obs] backfilled ${runsOnly ? 0 : sessions.length} session(s), ${turns} turn(s), ${selectedRunIds.length} run(s), ${manifests} manifest(s)`,
  );
}

main();
