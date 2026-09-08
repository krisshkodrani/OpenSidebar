/**
 * Perception Warmup — Proactive page interpretation
 *
 * Runs perception (screenshot + vision model) as soon as the side panel opens,
 * before the user types anything. When the user finally sends a message,
 * the cached result is consumed and the first agent turn starts instantly
 * (skipping the 1-2s vision API call).
 *
 * Event-driven: waits for CONTENT_SCRIPT_READY signal instead of sleeping.
 * Cache is keyed by (tabId, fingerprint) with a 30s staleness guard.
 */

import {
  DomSnapshot,
  MessageSource,
  type PageDocumentState,
} from "../../types";
import { logger } from "../../utils";
import { isTabReady, ensureContentScript } from "../infrastructure/tab-ready";
import { transformScreenshot } from "./screenshot-transform";
import { computeSnapshotFingerprint } from "../agent/stagnation";

/** Maximum age (ms) before a warmup entry is considered stale. */
const WARMUP_STALE_MS = 30_000;
const CAPTURE_VISIBLE_TAB_RETRY_DELAY_MS = 300;

async function captureVisibleTabWithRetry(
  windowId: number,
  options: { format?: "jpeg" | "png"; quality?: number },
): Promise<string> {
  try {
    return (await chrome.tabs.captureVisibleTab(
      windowId,
      options as chrome.tabs.CaptureVisibleTabOptions,
    )) as unknown as string;
  } catch (error: any) {
    const message = String(error?.message || "");
    const isQuotaError =
      /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(message) ||
      /\bquota\b/i.test(message);
    if (!isQuotaError) throw error;

    await new Promise((resolve) =>
      setTimeout(resolve, CAPTURE_VISIBLE_TAB_RETRY_DELAY_MS),
    );
    return (await chrome.tabs.captureVisibleTab(
      windowId,
      options as chrome.tabs.CaptureVisibleTabOptions,
    )) as unknown as string;
  }
}

export interface WarmupEntry {
  tabId: number;
  snapshot: DomSnapshot;
  /**
   * Always null — warmup no longer runs a separate perception model. Kept for
   * the loop's warmup fast path shape; the executor does its own vision.
   */
  perception: null;
  screenshotUrl: string | null;
  documentState: PageDocumentState;
  postCaptureDocumentState: PageDocumentState;
  screenshotMeta: {
    width: number;
    height: number;
    scaleFactor: number;
    capturedAt: number;
  };
  fingerprint: string;
  timestamp: number;
}

class PerceptionWarmup {
  private cache = new Map<number, WarmupEntry>();
  private pending = new Map<number, Promise<WarmupEntry | null>>();

  /**
   * Start warmup for a tab. Event-driven: waits for CONTENT_SCRIPT_READY,
   * then takes snapshot + screenshot. Fire-and-forget.
   */
  async warmup(tabId: number): Promise<void> {
    // Already warming up this tab — skip
    if (this.pending.has(tabId)) return;

    const promise = this.runWarmup(tabId);
    this.pending.set(tabId, promise);

    try {
      await promise;
    } finally {
      // Only delete if this is still our promise (not replaced by a newer warmup)
      if (this.pending.get(tabId) === promise) {
        this.pending.delete(tabId);
      }
    }
  }

  /** Get cached perception if still fresh. Returns null if stale or missing. */
  get(tabId: number): WarmupEntry | null {
    const entry = this.cache.get(tabId);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > WARMUP_STALE_MS) {
      this.cache.delete(tabId);
      return null;
    }
    return entry;
  }

  /** Consume and remove cache entry (one-shot). */
  consume(tabId: number): WarmupEntry | null {
    const entry = this.get(tabId);
    if (entry) this.cache.delete(tabId);
    return entry;
  }

  /** Invalidate cache for a tab (on navigation, tab close). */
  invalidate(tabId: number): void {
    this.cache.delete(tabId);
    // Don't cancel pending — it will just produce a stale result that won't match
  }

  /** Get pending promise if warmup is in progress (allows awaiting). */
  getPending(tabId: number): Promise<WarmupEntry | null> | undefined {
    return this.pending.get(tabId);
  }

  private async runWarmup(tabId: number): Promise<WarmupEntry | null> {
    try {
      logger.info("warmup", "Perception warmup started", { tabId });

      // 1. Ensure content script is injected and ready (handles SW restart)
      if (!isTabReady(tabId)) {
        const ready = await ensureContentScript(tabId, 5000);
        if (!ready) {
          logger.warn(
            "warmup",
            "Content script not ready after injection attempt",
            { tabId },
          );
          return null;
        }
      }

      // 2. Request snapshot from content script
      const snapResponse = await chrome.tabs.sendMessage(tabId, {
        type: "DOM_SNAPSHOT_REQUEST",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: { refresh: true },
      });

      const snapshot: DomSnapshot | undefined = snapResponse?.payload?.snapshot;
      if (!snapshot || !snapshot.elements) {
        logger.warn("warmup", "No snapshot from content script", { tabId });
        return null;
      }

      const fingerprint = computeSnapshotFingerprint(snapshot);

      const documentState = snapResponse?.payload?.documentState as
        | PageDocumentState
        | undefined;
      if (!documentState) {
        logger.info("warmup", "Snapshot lacks page-state identity", { tabId });
        return null;
      }

      // 3. Capture the current viewport without moving it. DOM and pixels must
      // describe the same geometry, and warmup must not alter the user's scroll.
      let screenshotUrl: string | null = null;
      let screenshotMeta: WarmupEntry["screenshotMeta"] | null = null;
      let postCaptureDocumentState: PageDocumentState | undefined;
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.active) {
          // LP-9: same owned pipeline as refreshPerception — q90 capture,
          // then transform (resolution/format/scale) before anything
          // downstream (perceive or the loop's warmup fast path) sees it.
          const captured = await captureVisibleTabWithRetry(tab.windowId, {
            format: "jpeg",
            quality: 90,
          });
          const transformed = await transformScreenshot(captured);
          screenshotUrl = transformed.dataUrl;
          screenshotMeta = {
            width: transformed.width,
            height: transformed.height,
            scaleFactor: transformed.scaleFactor,
            capturedAt: Date.now(),
          };
          postCaptureDocumentState = (
            await chrome.tabs.sendMessage(tabId, {
              type: "DOM_READY_PROBE",
              requestId: crypto.randomUUID(),
              source: MessageSource.BACKGROUND,
              payload: { timeoutMs: 50, waitForElements: false },
            })
          )?.payload?.documentState;
        }
      } catch (e: any) {
        logger.warn("warmup", "Screenshot capture failed (non-fatal)", {
          tabId,
          error: e?.message,
        });
      }

      // 4. Warmup pre-captures the screenshot only — the VL executor does its
      //    own vision, so there is no separate perception model call here.
      if (!screenshotUrl || !screenshotMeta || !postCaptureDocumentState) {
        logger.info("warmup", "No screenshot — nothing to warm", { tabId });
        return null;
      }

      const entry: WarmupEntry = {
        tabId,
        snapshot,
        perception: null,
        screenshotUrl,
        documentState,
        postCaptureDocumentState,
        screenshotMeta,
        fingerprint,
        timestamp: Date.now(),
      };

      this.cache.set(tabId, entry);
      logger.info("warmup", "Screenshot warmup cached", {
        tabId,
        url: snapshot.url,
        elementCount: snapshot.elements.length,
      });

      return entry;
    } catch (e: any) {
      logger.warn("warmup", "Perception warmup failed (non-fatal)", {
        tabId,
        error: e?.message,
      });
      return null;
    }
  }
}

/** Singleton instance */
export const perceptionWarmup = new PerceptionWarmup();
