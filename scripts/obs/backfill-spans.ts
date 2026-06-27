/**
 * Idempotent span backfill (RFC LP-7, Stage B1). Re-projects historical traces
 * into the span spine — entries, sessions, and run events (all three read
 * lenses) — using the same deterministic mappers the live dual-write uses, so
 * running it twice produces identical output. Reads through the same store the
 * MCP/HTTP layers use.
 *
 * Usage: pnpm run obs:backfill-spans -- [--limit 200]
 */

import { createDiskStore } from "./core";
import {
  writeEntryRecord,
  writeRunEvents,
  writeSessionRecord,
} from "./span-store";
import type { TraceEntry } from "../../apps/extension/src/types/traces";

function flag(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main(): void {
  const store = createDiskStore();
  const limit = flag("--limit") ? Number(flag("--limit")) : Infinity;
  const sessions = store.loadSessions().slice(0, limit);

  let turns = 0;
  const runIds = new Set<string>();
  for (const session of sessions) {
    if (!session.sessionId) continue;
    writeSessionRecord(session as unknown as Record<string, unknown>);
    for (const entry of store.loadEntries(session.sessionId)) {
      writeEntryRecord(entry as unknown as TraceEntry);
      turns += 1;
    }
    if (typeof session.runId === "string" && session.runId) {
      runIds.add(session.runId);
    }
  }
  for (const runId of runIds) {
    writeRunEvents(
      runId,
      store.loadRunEvents(runId) as unknown as Record<string, unknown>[],
    );
  }

  console.log(
    `[obs] backfilled ${sessions.length} session(s), ${turns} turn(s), ${runIds.size} run(s)`,
  );
}

main();
