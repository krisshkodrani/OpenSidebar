/** Prefer parity-verified spine rows while preserving unmigrated history. */
export function preferSpineSessions<T extends { sessionId?: string }>(
  spine: T[],
  legacy: T[],
): T[] {
  if (spine.length === 0) return legacy;
  const ids = new Set(spine.map((session) => session.sessionId));
  return [...spine, ...legacy.filter((session) => !ids.has(session.sessionId))];
}

/** Parallel turn writes can leave legacy JSONL lines out of turn order. */
export function orderTraceEntries<T extends { turnNumber?: unknown }>(entries: T[]): T[] {
  const turn = (entry: T) =>
    typeof entry.turnNumber === "number" && Number.isFinite(entry.turnNumber)
      ? entry.turnNumber : Number.POSITIVE_INFINITY;
  return [...entries].sort((a, b) => turn(a) - turn(b));
}
