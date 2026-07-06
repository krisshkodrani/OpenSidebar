/**
 * Map-backed fake PersistencePort for unit tests (RFC LP-15, Phase 3).
 *
 * Satisfies the full PersistenceStorageArea contract including onChanged, and
 * fires change notifications on set/remove the way chrome.storage does. Seeds
 * the Phase 5 fake-environment kit.
 */

import type {
  PersistencePort,
  PersistenceStorageArea,
  PersistenceStorageChange,
  PersistenceStorageKeys,
} from "../../src/background/environment/types";

export interface FakeStorageArea extends PersistenceStorageArea {
  /** Direct access to the backing map, for assertions. */
  readonly store: Map<string, unknown>;
}

function normalizeKeys(keys: PersistenceStorageKeys): string[] | null {
  if (keys === undefined || keys === null) return null; // all keys
  if (typeof keys === "string") return [keys];
  if (Array.isArray(keys)) return keys;
  return Object.keys(keys);
}

export function createFakeStorageArea(): FakeStorageArea {
  const store = new Map<string, unknown>();
  const listeners = new Set<
    (changes: Record<string, PersistenceStorageChange>) => void
  >();

  function emit(changes: Record<string, PersistenceStorageChange>): void {
    if (Object.keys(changes).length === 0) return;
    for (const listener of listeners) listener(changes);
  }

  return {
    store,
    async get(keys) {
      const wanted = normalizeKeys(keys);
      const out: Record<string, unknown> = {};
      if (wanted === null) {
        for (const [k, v] of store) out[k] = v;
      } else {
        for (const k of wanted) if (store.has(k)) out[k] = store.get(k);
      }
      return out;
    },
    async set(items) {
      const changes: Record<string, PersistenceStorageChange> = {};
      for (const [k, v] of Object.entries(items)) {
        const oldValue = store.get(k);
        store.set(k, v);
        changes[k] = { oldValue, newValue: v };
      }
      emit(changes);
    },
    async remove(keys) {
      const changes: Record<string, PersistenceStorageChange> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (store.has(k)) {
          changes[k] = { oldValue: store.get(k), newValue: undefined };
          store.delete(k);
        }
      }
      emit(changes);
    },
    onChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createFakePersistencePort(): {
  port: PersistencePort;
  local: FakeStorageArea;
  sync: FakeStorageArea;
  session: FakeStorageArea;
} {
  const local = createFakeStorageArea();
  const sync = createFakeStorageArea();
  const session = createFakeStorageArea();
  return { port: { local, sync, session }, local, sync, session };
}
