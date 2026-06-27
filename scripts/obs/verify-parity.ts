/**
 * Dual-read parity check (RFC LP-7, Stage B1). For every session that has spine
 * records, asserts the spine-derived entries are order-independently equal to
 * what the existing store returns. This is the gate that must pass before the
 * read cutover (OBS_SPINE_READS) can be made the default and the old store
 * retired. Run after a backfill: pnpm run obs:verify-parity
 */

import { createDiskStore } from "./core";
import { readSessionEntries, readSpineSessions } from "./span-store";

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

function main(): void {
  const store = createDiskStore();
  let checked = 0;
  let mismatches = 0;

  for (const session of store.loadSessions()) {
    if (!session.sessionId) continue;
    const spine = readSessionEntries(session.sessionId);
    if (spine.length === 0) continue; // no spine record for this session yet
    checked += 1;
    const existing = store.loadEntries(session.sessionId);
    if (stable(spine) !== stable(existing)) {
      mismatches += 1;
      console.error(
        `  MISMATCH ${session.sessionId}: spine ${spine.length} vs store ${existing.length} entries`,
      );
    }
  }

  // Sessions lens: every spine session must equal the store's session record.
  const storeById = new Map<string, unknown>();
  for (const session of store.loadSessions()) {
    if (typeof session.sessionId === "string") {
      storeById.set(session.sessionId, session);
    }
  }
  let sessionsChecked = 0;
  for (const spineSession of readSpineSessions()) {
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

  console.log(
    `[obs] dual-read parity: entries ${checked} session(s), sessions ${sessionsChecked} record(s) checked, ${mismatches} mismatch(es)`,
  );
  if (mismatches > 0) process.exit(1);
}

main();
