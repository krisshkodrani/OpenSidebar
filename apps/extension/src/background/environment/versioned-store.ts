/**
 * Versioned key/value store over a PersistenceStorageArea (RFC LP-15, Phase 3).
 *
 * Wraps a single storage key with an explicit schema version and an optional
 * migration hook, so callers stop hand-rolling `{get, parse, bump-version}`
 * boilerplate and stale data upgrades in one place. Backed by any
 * PersistenceStorageArea, so it is trivially faked in tests (the in-memory
 * fake seeded in Phase 2 satisfies the same interface).
 */

import type {
  PersistenceStorageArea,
  PersistenceStorageChange,
} from "./types";

interface VersionedEnvelope<T> {
  __version: number;
  value: T;
}

export interface VersionedStoreOptions<T> {
  /** Current schema version. Stored data at a lower version runs `migrate`. */
  version: number;
  /**
   * Upgrade raw stored data to the current shape. Receives the raw stored
   * `value` (unwrapped from the envelope, or the whole legacy blob if it was
   * written without an envelope) and the version it was stored at (undefined
   * for un-versioned legacy data). Return the migrated value, or undefined to
   * treat it as absent.
   */
  migrate?: (rawValue: unknown, fromVersion: number | undefined) => T | undefined;
}

export interface VersionedStore<T> {
  /** Load and migrate the current value, or undefined if absent. */
  load(): Promise<T | undefined>;
  /** Persist a value at the current version. */
  save(value: T): Promise<void>;
  /** Read-modify-write; the mutator receives the current value (or undefined). */
  update(mutator: (current: T | undefined) => T): Promise<T>;
  /** Delete the key entirely. */
  remove(): Promise<void>;
  /** Subscribe to external changes to this key. */
  onChanged(listener: (value: T | undefined) => void): () => void;
}

function isEnvelope<T>(raw: unknown): raw is VersionedEnvelope<T> {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "__version" in raw &&
    typeof (raw as { __version: unknown }).__version === "number"
  );
}

export function createVersionedStore<T>(
  area: PersistenceStorageArea,
  key: string,
  options: VersionedStoreOptions<T>,
): VersionedStore<T> {
  const { version, migrate } = options;

  function decode(raw: unknown): T | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (isEnvelope<T>(raw)) {
      if (raw.__version === version) return raw.value;
      return migrate ? migrate(raw.value, raw.__version) : undefined;
    }
    // Legacy value written without an envelope (un-versioned).
    return migrate ? migrate(raw, undefined) : undefined;
  }

  async function load(): Promise<T | undefined> {
    const stored = await area.get(key);
    return decode(stored?.[key]);
  }

  async function save(value: T): Promise<void> {
    const envelope: VersionedEnvelope<T> = { __version: version, value };
    await area.set({ [key]: envelope });
  }

  async function update(mutator: (current: T | undefined) => T): Promise<T> {
    const next = mutator(await load());
    await save(next);
    return next;
  }

  async function remove(): Promise<void> {
    await area.remove(key);
  }

  function onChanged(listener: (value: T | undefined) => void): () => void {
    return area.onChanged((changes: Record<string, PersistenceStorageChange>) => {
      if (!(key in changes)) return;
      listener(decode(changes[key]?.newValue));
    });
  }

  return { load, save, update, remove, onChanged };
}
