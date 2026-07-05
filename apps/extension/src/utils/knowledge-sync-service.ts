/**
 * Knowledge sync service (RFC LP-8, M3 — assembly layer).
 *
 * Wires the local cache (`ChromeStorageLocalSnapshot`) to the optional OpenClaw
 * canonical store (`HttpKnowledgeStore`, resolved from the configured gateway
 * URL) through the `ReadThroughCache`. Default-off: with no gateway URL it is a
 * purely local cache, so the extension keeps working standalone. Features
 * (`personal-profile`, `website-skills`) call `sync`/`put`/`remove` per namespace
 * — the final live-wiring step is a couple of call sites in those files.
 */

import {
  ChromeStorageLocalSnapshot,
  type MinimalStorage,
} from "./knowledge-local-snapshot";
import {
  ReadThroughCache,
  liveValues,
  stamp,
  tombstone,
} from "./knowledge-sync";
import { HttpKnowledgeStore } from "./openclaw-client";

export const OPENCLAW_GATEWAY_URL_KEY = "opensidebar:openClawGatewayUrl";

export interface KnowledgeSyncServiceOptions {
  storage?: MinimalStorage;
  fetchImpl?: typeof fetch;
  /** Override the gateway URL. `undefined` → resolve from storage; `null` → force local-only. */
  gatewayUrl?: string | null;
}

export class KnowledgeSyncService {
  private cachePromise: Promise<ReadThroughCache> | undefined;

  constructor(private readonly opts: KnowledgeSyncServiceOptions = {}) {}

  private async resolveGatewayUrl(): Promise<string | null> {
    if (this.opts.gatewayUrl !== undefined) return this.opts.gatewayUrl;
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        const stored = await chrome.storage.local.get(OPENCLAW_GATEWAY_URL_KEY);
        const value = stored[OPENCLAW_GATEWAY_URL_KEY];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    } catch {
      // No storage access → local-only.
    }
    return null;
  }

  private getCache(): Promise<ReadThroughCache> {
    if (!this.cachePromise) {
      this.cachePromise = (async () => {
        const local = new ChromeStorageLocalSnapshot(this.opts.storage);
        const url = await this.resolveGatewayUrl();
        const store = url
          ? new HttpKnowledgeStore({ baseUrl: url, fetchImpl: this.opts.fetchImpl })
          : null;
        return new ReadThroughCache(local, store);
      })();
    }
    return this.cachePromise;
  }

  /** Reconcile a namespace with the canonical store and return live values. */
  async sync<T = unknown>(namespace: string): Promise<Record<string, T>> {
    const cache = await this.getCache();
    return liveValues(await cache.sync(namespace)) as Record<string, T>;
  }

  /** Write-through a value: local always, canonical store when connected. */
  async put(namespace: string, key: string, value: unknown): Promise<void> {
    const cache = await this.getCache();
    await cache.put(namespace, key, stamp(value));
  }

  /** Tombstone a key (last-writer-wins delete). */
  async remove(namespace: string, key: string): Promise<void> {
    const cache = await this.getCache();
    await cache.put(namespace, key, tombstone());
  }
}
