import type { ToolName } from "../../types";

/** Cache entry classification — controls invalidation strategy */
export type CacheType = "dom" | "static";

export interface CacheEntry {
  result: string;
  timestamp: number;
  fingerprint: string;
  cacheType: CacheType;
}

export interface CacheStats {
  hits: number;
  misses: number;
  invalidations: number;
  evictions: number;
}

/**
 * Content-addressed tool result cache for the agent loop.
 *
 * Keys are `toolName:serializedArgs`. Each entry has a `cacheType` that
 * controls when it is invalidated:
 *   - "dom"    → invalidated when the DOM snapshot fingerprint changes
 *   - "static" → never invalidated within a session
 *
 * Error results (starting with "Error:") are never cached.
 * FIFO eviction when capacity is reached.
 */
export class ToolResultCache {
  private cache = new Map<string, CacheEntry>();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    invalidations: 0,
    evictions: 0,
  };

  constructor(private readonly maxSize: number = 64) {}

  /** Build a cache key from tool name and serialized args */
  static key(tool: ToolName | string, args: Record<string, unknown>): string {
    return `${tool}:${JSON.stringify(args)}`;
  }

  /** Look up a cached result. DOM entries miss if fingerprint changed. */
  get(key: string, currentFingerprint: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    // DOM entries must match the current snapshot fingerprint
    if (entry.cacheType === "dom" && entry.fingerprint !== currentFingerprint) {
      this.stats.misses++;
      return null;
    }
    this.stats.hits++;
    return entry.result;
  }

  /** Store a result in the cache. Skips error results. FIFO eviction at capacity. */
  set(
    key: string,
    result: string,
    fingerprint: string,
    cacheType: CacheType,
  ): void {
    // Never cache error results
    if (result.startsWith("Error:")) return;

    // If key already exists, update in-place (no eviction needed)
    if (this.cache.has(key)) {
      this.cache.set(key, {
        result,
        timestamp: Date.now(),
        fingerprint,
        cacheType,
      });
      return;
    }

    // FIFO eviction: delete the oldest entry when at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
        this.stats.evictions++;
      }
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      fingerprint,
      cacheType,
    });
  }

  /** Invalidate all DOM-type entries (called after DOM-modifying tool execution) */
  invalidateDom(): void {
    let count = 0;
    for (const [key, entry] of this.cache) {
      if (entry.cacheType === "dom") {
        this.cache.delete(key);
        count++;
      }
    }
    this.stats.invalidations += count;
  }

  /** Full reset — clears all entries and resets stats */
  clear(): void {
    const count = this.cache.size;
    this.cache.clear();
    this.stats.invalidations += count;
  }

  /** Return current cache statistics */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /** Current number of cached entries */
  get size(): number {
    return this.cache.size;
  }
}
