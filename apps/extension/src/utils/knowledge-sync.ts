/**
 * Knowledge sync engine (RFC LP-8, M3 "Shared Memory").
 *
 * Last-writer-wins reconciliation between the extension's local cache and
 * OpenClaw's canonical knowledge store (profile, website skills). This module is
 * pure, transport- and store-agnostic logic so it is fully unit-testable; the
 * real `KnowledgeStore` (OpenClaw over the M2 bridge) and the live wiring of
 * `personal-profile.ts` / `website-skills.ts` as read-through caches are M3
 * Stage 2.
 *
 * Design (per the locked decisions): OpenClaw is canonical; the extension keeps
 * a read-through cache so it still works offline. Each item carries an
 * `updatedAt` LWW clock and an optional tombstone, so edits made in the browser
 * and via OpenClaw reconcile deterministically.
 */

export interface SyncedItem<T = unknown> {
  value: T;
  /** Epoch ms — the last-writer-wins clock. */
  updatedAt: number;
  /** Tombstone: the item was deleted at `updatedAt`. */
  deleted?: boolean;
}

export type SyncMap<T = unknown> = Record<string, SyncedItem<T>>;

/**
 * Canonical knowledge store (implemented over the OpenClaw bridge in Stage 2).
 * A namespace separates profile items from website skills, etc.
 */
export interface KnowledgeStore {
  getAll(namespace: string): Promise<SyncMap>;
  putItems(namespace: string, items: SyncMap): Promise<void>;
}

export interface ReconcileResult<T = unknown> {
  /** The reconciled map (winning item per key, tombstones retained). */
  merged: SyncMap<T>;
  /** Keys where the local copy is authoritative → write to the canonical store. */
  push: string[];
  /** Keys where the canonical copy is authoritative → write to the local cache. */
  pull: string[];
}

/**
 * Reconcile a local and a remote (canonical) map by last-writer-wins. Equal
 * timestamps are treated as already in sync (no transfer). Tombstones
 * participate like any other item — a newer delete wins over an older value and
 * vice-versa.
 */
export function reconcile<T = unknown>(
  local: SyncMap<T>,
  remote: SyncMap<T>,
): ReconcileResult<T> {
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  const merged: SyncMap<T> = {};
  const push: string[] = [];
  const pull: string[] = [];

  for (const key of keys) {
    const l = local[key];
    const r = remote[key];
    const lt = l ? l.updatedAt : Number.NEGATIVE_INFINITY;
    const rt = r ? r.updatedAt : Number.NEGATIVE_INFINITY;

    if (lt > rt) {
      merged[key] = l;
      push.push(key);
    } else if (rt > lt) {
      merged[key] = r;
      pull.push(key);
    } else {
      // Equal clocks (or both present and identical) → already in sync.
      merged[key] = (l ?? r) as SyncedItem<T>;
    }
  }

  return { merged, push, pull };
}

/** Effective live view of a sync map: non-deleted values keyed by id. */
export function liveValues<T = unknown>(map: SyncMap<T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, item] of Object.entries(map)) {
    if (!item.deleted) out[key] = item.value;
  }
  return out;
}

/** Wrap a plain value into a `SyncedItem` stamped now (or at `clock`). */
export function stamp<T>(value: T, clock: number = Date.now()): SyncedItem<T> {
  return { value, updatedAt: clock };
}

/** A tombstone stamped now (or at `clock`). */
export function tombstone(clock: number = Date.now()): SyncedItem<never> {
  return { value: undefined as never, updatedAt: clock, deleted: true };
}
