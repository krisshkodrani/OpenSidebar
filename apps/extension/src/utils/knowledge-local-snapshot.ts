/**
 * chrome.storage.local-backed LocalSnapshot (RFC LP-8, M3 Stage 2b — local half).
 *
 * The concrete local cache the `ReadThroughCache` reads/writes. One storage key
 * per knowledge namespace (profile, website-skills, …). Needs neither the
 * OpenClaw daemon nor any orchestrator code — it is the offline-capable side of
 * the cache, so it is buildable and testable on its own. Wiring this into
 * `personal-profile.ts` / `website-skills.ts` (replacing their bespoke storage)
 * is the remaining live-edit step.
 */

import type { LocalSnapshot, SyncMap } from "./knowledge-sync";

export const KNOWLEDGE_STORAGE_PREFIX = "opensidebar:knowledge:";

interface MinimalStorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
export interface MinimalStorage {
  local: MinimalStorageArea;
}

function defaultStorage(): MinimalStorage {
  return chrome.storage as unknown as MinimalStorage;
}

function isSyncMap(value: unknown): value is SyncMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ChromeStorageLocalSnapshot implements LocalSnapshot {
  constructor(private readonly storage: MinimalStorage = defaultStorage()) {}

  private key(namespace: string): string {
    return `${KNOWLEDGE_STORAGE_PREFIX}${namespace}`;
  }

  async read(namespace: string): Promise<SyncMap> {
    const key = this.key(namespace);
    const stored = await this.storage.local.get(key);
    const value = stored[key];
    return isSyncMap(value) ? value : {};
  }

  async write(namespace: string, map: SyncMap): Promise<void> {
    await this.storage.local.set({ [this.key(namespace)]: map });
  }
}
