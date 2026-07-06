import type { DomSnapshot } from "../../types";
import type { logger } from "../../utils";
import { perceptionWarmup } from "../perception-warmup";
import type { WarmupEntry } from "../perception/warmup";
import { ensureContentScript } from "../tab-ready";

type InitialSnapshotLogger = Pick<typeof logger, "info" | "warn">;

type InitialSnapshotWarmupCache = {
  getPending(tabId: number): Promise<WarmupEntry | null> | null | undefined;
  get(tabId: number): WarmupEntry | null;
  consume(tabId: number): void;
};

export type InitialSnapshotResolution = {
  snapshot?: DomSnapshot;
  warmupScreenshot: string | null;
};

export type ResolveInitialSnapshotDeps = {
  tabId: number;
  initialSnapshot?: DomSnapshot;
  log: InitialSnapshotLogger;
  refreshSnapshot: (tabId: number) => Promise<number>;
  getSnapshot: () => DomSnapshot | null | undefined;
  warmupCache?: InitialSnapshotWarmupCache;
  ensureContentScript?: (
    tabId: number,
    timeoutMs?: number,
  ) => Promise<unknown>;
};

export async function resolveInitialSnapshot({
  tabId,
  initialSnapshot,
  log,
  refreshSnapshot,
  getSnapshot,
  warmupCache = perceptionWarmup,
  ensureContentScript: ensureScript = ensureContentScript,
}: ResolveInitialSnapshotDeps): Promise<InitialSnapshotResolution> {
  let snapshot = initialSnapshot;
  let warmupScreenshot: string | null = null;

  try {
    if (!snapshot) {
      log.warn("agent", "No initial snapshot from orchestrator, checking warmup", {
        tabId,
      });

      const pending = warmupCache.getPending(tabId);
      if (pending) {
        log.info("agent", "Awaiting perception warmup", { tabId });
        const entry = await pending;
        if (entry) {
          snapshot = entry.snapshot;
          warmupScreenshot = entry.screenshotUrl;
          log.info("agent", "Using warmup snapshot + screenshot", {
            tabId,
            elementCount: snapshot.elements.length,
          });
        }
      } else {
        const cached = warmupCache.get(tabId);
        if (cached) {
          snapshot = cached.snapshot;
          warmupScreenshot = cached.screenshotUrl;
          log.info("agent", "Using cached warmup snapshot + screenshot", {
            tabId,
            elementCount: snapshot.elements.length,
            ageMs: Date.now() - cached.timestamp,
          });
        }
      }

      if (!snapshot) {
        log.warn(
          "agent",
          "No warmup available, ensuring content script and fetching snapshot",
          { tabId },
        );
        await ensureScript(tabId, 5000);
        const count = await refreshSnapshot(tabId);
        if (count >= 0) {
          snapshot = getSnapshot() ?? undefined;
          log.info("agent", "Fetched snapshot fallback", {
            elementCount: count,
          });
        }
      }
    }

    return {
      snapshot,
      warmupScreenshot,
    };
  } finally {
    warmupCache.consume(tabId);
  }
}
