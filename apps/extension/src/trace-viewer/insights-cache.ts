/**
 * Module-level cache for /api/trace-insights responses.
 *
 * Solves two problems:
 *  1. InsightsTab and MetricsTab both call fetchTraceInsights with identical
 *     filters — the second call is a pure duplicate.
 *  2. Every tab-switch re-mounts the component and fires a fresh fetch, so
 *     navigating Insights → Metrics → Insights costs three round trips.
 *
 * Strategy:
 *  - One cache slot keyed by JSON.stringify(filters).
 *  - In-flight dedup: a second consumer with the same key gets the existing
 *    Promise instead of starting a new fetch.
 *  - Cache hit: if the key matches a completed result, resolve instantly.
 *  - Stale-while-revalidate: callers receive stale data immediately and a
 *    background refresh promise; they re-render once the fresh data arrives.
 *  - Invalidation: any filter change produces a new key, evicting the slot.
 *
 * AbortSignal note: we do NOT thread the caller's AbortSignal into the shared
 * promise — aborting one consumer must not cancel work for another. Each
 * component still uses its own `cancelled` flag and clearTimeout on unmount.
 */

import {
  fetchTraceInsights,
  type TraceInsightsQuery,
  type TraceInsightsResponse,
} from "./api";

interface CacheSlot {
  key: string;
  /** Settled result once the fetch has completed successfully. */
  result: TraceInsightsResponse | null;
  /** In-flight promise (present while fetching, null after settle). */
  promise: Promise<TraceInsightsResponse> | null;
  /** Timestamp of the last successful fetch (ms). */
  fetchedAt: number;
}

/** How long a completed result is considered fresh (ms). */
const TTL_MS = 60_000;

let slot: CacheSlot | null = null;

export function insightsCacheKey(filters: TraceInsightsQuery): string {
  // Stable serialisation: sort keys so insertion order doesn't create false misses.
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(filters)
        .filter(([, v]) => v !== undefined && v !== "" && v !== "all")
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

function isFresh(s: CacheSlot): boolean {
  return s.result !== null && Date.now() - s.fetchedAt < TTL_MS;
}

export interface InsightsCacheResult {
  /** Immediately available data (may be stale). Null only on the very first load. */
  data: TraceInsightsResponse | null;
  /** Promise that resolves to the up-to-date response. */
  fresh: Promise<TraceInsightsResponse>;
}

/**
 * Return cached insights data for `filters`, starting a fetch only if needed.
 *
 * Returns `{ data, fresh }`:
 *  - `data`  — a previously-cached result (or null) for instant render
 *  - `fresh` — a promise that resolves to the authoritative response
 *
 * Both fields refer to the same value once the fetch completes; the caller
 * can `await fresh` to update state, or skip the await if `data` is already
 * sufficient (cache hit + still fresh).
 */
export function getInsights(
  filters: TraceInsightsQuery,
): InsightsCacheResult {
  const key = insightsCacheKey(filters);

  // ── Cache hit (fresh) ───────────────────────────────────────────
  if (slot && slot.key === key && isFresh(slot)) {
    return {
      data: slot.result,
      fresh: Promise.resolve(slot.result!),
    };
  }

  // ── In-flight dedup (same key already being fetched) ───────────
  if (slot && slot.key === key && slot.promise) {
    return {
      data: slot.result, // stale data or null
      fresh: slot.promise,
    };
  }

  // ── New fetch (different key, or TTL expired, or no slot) ───────
  // Preserve stale data from the *same* key for instant render.
  const staleData = slot?.key === key ? slot.result : null;

  const promise = fetchTraceInsights(filters).then((result) => {
    // Only commit if this key is still current (user may have changed filters).
    if (slot?.key === key) {
      slot.result = result;
      slot.promise = null;
      slot.fetchedAt = Date.now();
    }
    return result;
  }).catch((err) => {
    if (slot?.key === key) {
      slot.promise = null;
    }
    throw err;
  });

  slot = { key, result: staleData, promise, fetchedAt: 0 };

  return { data: staleData, fresh: promise };
}

/** Force-evict the cache (e.g. after a manual refresh action). */
export function invalidateInsightsCache(): void {
  slot = null;
}
