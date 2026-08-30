/**
 * Revision-bound VL screenshot capture.
 *
 * Screenshot bytes are accepted only when a post-capture page probe matches
 * the DOM observation they augment. One inconsistent bundle is retried after a
 * fresh DOM snapshot; a second mismatch falls back without sending stale pixels
 * to the executor.
 */
import type { DomSnapshot, PageDocumentState } from "../../types";
import { extractPerceptionPageSignals } from "../../utils/perception-mode";
import { chromeBrowserPagePort } from "../environment";
import { waitForDomReady } from "../infrastructure/tab-ready";
import { transformScreenshot } from "../perception/screenshot-transform";
import { withPresenceSuspended } from "./capture-guard";
import { getSnapshotFingerprint } from "./loop-helpers";
import {
  PageStateCoordinator,
  sha256DataUrl,
  type PageImageObservation,
  type PerceptionScreenshotTrace,
} from "./page-state";
import { setCachedScreenshot } from "./screenshot-cache";

export interface VLScreenshotHost {
  context: {
    getSnapshot(): DomSnapshot | null;
    getScreenshotDetailForExecutor(): "low" | "high";
    setScreenshotForExecutor(dataUrl: string | null): void;
    setPageInterpretation(value: string | null): void;
  };
  perception: PageStateCoordinator;
  readonly enforcePageStateConsistency: boolean;
  traceRecorder: {
    recordEvent(type: string, data?: Record<string, unknown>): void;
    recordPerception(entry: Record<string, unknown>, screenshot?: string): void;
  } | null;
  log: {
    warn(
      category: string,
      message: string,
      data?: Record<string, unknown>,
    ): void;
  };
  imagePromptBudgetAllows(count: number): boolean;
  recordImagePromptBudgetExhausted(count: number, source: string): void;
  captureVisibleTabWithRetry(
    windowId: number | undefined,
    options: { format: "jpeg" | "png"; quality?: number },
  ): Promise<string>;
  refreshSnapshot(tabId: number): Promise<number>;
  probeDocumentState?(tabId: number): Promise<PageDocumentState | undefined>;
}

export interface VLScreenshotState {
  lastFingerprint: string | null;
  lastImage: PageImageObservation | null;
  lastDocumentState: PageDocumentState | null;
}

export function createVLScreenshotState(): VLScreenshotState {
  return {
    lastFingerprint: null,
    lastImage: null,
    lastDocumentState: null,
  };
}

function documentStateFromCurrent(
  coordinator: PageStateCoordinator,
): PageDocumentState | undefined {
  const observation = coordinator.getCurrentObservation();
  if (!observation) return undefined;
  return {
    documentInstanceId: observation.basis.documentInstanceId,
    mutationEpoch: observation.basis.mutationEpoch,
    url: observation.basis.url,
    viewport: { ...observation.basis.viewport },
    scroll: { ...observation.basis.scroll },
  };
}

function documentStateEqual(
  left: PageDocumentState | null,
  right: PageDocumentState | undefined,
): boolean {
  return Boolean(
    left &&
      right &&
      left.documentInstanceId === right.documentInstanceId &&
      left.mutationEpoch === right.mutationEpoch &&
      left.url === right.url &&
      left.viewport.width === right.viewport.width &&
      left.viewport.height === right.viewport.height &&
      left.scroll.x === right.scroll.x &&
      left.scroll.y === right.scroll.y,
  );
}

function applyScreenshotProjection(
  host: VLScreenshotHost,
  image: PageImageObservation,
  trace: PerceptionScreenshotTrace,
): void {
  host.context.setScreenshotForExecutor(image.dataUrl);
  host.context.setPageInterpretation(null);
  host.perception.setScreenshotTrace(trace);
}

async function probeDocumentState(
  host: VLScreenshotHost,
  tabId: number,
): Promise<PageDocumentState | undefined> {
  if (host.probeDocumentState) return host.probeDocumentState(tabId);
  return (
    await waitForDomReady(tabId, {
      timeoutMs: 50,
      waitForElements: false,
    })
  ).documentState;
}

function clearScreenshotProjection(host: VLScreenshotHost): void {
  host.context.setScreenshotForExecutor(null);
  host.context.setPageInterpretation(null);
}

/** Capture (or safely reuse) the screenshot for VL executor injection. */
export async function captureVLExecutorScreenshot(
  host: VLScreenshotHost,
  tabId: number,
  state: VLScreenshotState,
  attempt = 0,
): Promise<void> {
  const snapshot = host.context.getSnapshot();
  const base = host.perception.getCurrentObservation();
  if (!snapshot || !base) {
    clearScreenshotProjection(host);
    return;
  }
  if (!host.imagePromptBudgetAllows(1)) {
    host.recordImagePromptBudgetExhausted(1, "vl_executor_screenshot");
    clearScreenshotProjection(host);
    host.perception.setScreenshotTrace({
      meta: {
        mode: "element_only",
        source: "fallback",
        freshnessReason: "dom_fallback",
        screenshotStatus: "not_requested",
      },
      stats: { model: "none (image budget)", durationMs: 0, cached: false },
    });
    host.traceRecorder?.recordPerception({
      interpretation:
        "[VL mode] Screenshot omitted because the image prompt budget is exhausted.",
      model: "none (image budget)",
      durationMs: 0,
      cached: false,
      mode: "element_only",
      source: "fallback",
      freshnessReason: "dom_fallback",
      fallbackReason: "image_budget_exhausted",
      screenshotStatus: "not_requested",
    });
    return;
  }

  const fingerprint = getSnapshotFingerprint(snapshot);
  const currentDocumentState = documentStateFromCurrent(host.perception);
  const canReuse =
    state.lastImage &&
    state.lastFingerprint === fingerprint &&
    documentStateEqual(state.lastDocumentState, currentDocumentState) &&
    !extractPerceptionPageSignals(snapshot).hasCanvas;

  if (canReuse && state.lastImage) {
    const postCaptureState =
      (await probeDocumentState(host, tabId)) ?? currentDocumentState;
    const image: PageImageObservation = {
      ...state.lastImage,
      detail: host.context.getScreenshotDetailForExecutor(),
      source: "reused",
    };
    const accepted = host.perception.acceptImageObservation({
      baseRevision: base.basis.observationRevision,
      image,
      postCaptureState: postCaptureState!,
    });
    if (accepted.consistent) {
      applyScreenshotProjection(host, image, {
        meta: {
          mode: "vl_screenshot_only",
          source: "cached",
          freshnessReason: "fingerprint_cache_hit",
          screenshotStatus: "cached",
        },
        stats: { model: "none (unified VL)", durationMs: 0, cached: true },
      });
      host.traceRecorder?.recordEvent("vl_screenshot_reused", {
        observationRevision: accepted.observation.basis.observationRevision,
      });
      return;
    }
    if (!host.enforcePageStateConsistency) {
      state.lastFingerprint = fingerprint;
      state.lastImage = image;
      state.lastDocumentState = currentDocumentState ?? null;
      applyScreenshotProjection(host, image, {
        meta: {
          mode: "vl_screenshot_only",
          source: "cached",
          freshnessReason: "fingerprint_cache_hit",
          screenshotStatus: "cached",
        },
        stats: { model: "none (unified VL)", durationMs: 0, cached: true },
      });
      host.traceRecorder?.recordEvent("page_observation_shadow_mismatch", {
        source: "reused_screenshot",
        reason: accepted.observation.consistencyReason,
      });
      return;
    }
    clearScreenshotProjection(host);
    host.traceRecorder?.recordEvent("page_observation_consistency_retry", {
      attempt: attempt + 1,
      reason: accepted.observation.consistencyReason,
      source: "reused_screenshot",
    });
    if (attempt === 0 && (await host.refreshSnapshot(tabId)) >= 0) {
      await captureVLExecutorScreenshot(host, tabId, state, attempt + 1);
    }
    return;
  }

  try {
    const tab = await chromeBrowserPagePort.getTab(tabId);
    if (!tab.active) {
      try {
        await chromeBrowserPagePort.updateTab(tabId, { active: true });
      } catch {
        /* tab may be closed */
      }
    }
    const captured = await withPresenceSuspended(tabId, () =>
      host.captureVisibleTabWithRetry(tab.windowId, {
        format: "jpeg",
        quality: 90,
      }),
    );
    const transformed = await transformScreenshot(captured);
    const sha256 = await sha256DataUrl(transformed.dataUrl);
    const image: PageImageObservation = {
      artifactId: `sha256:${sha256}`,
      sha256,
      width: transformed.width,
      height: transformed.height,
      scaleFactor: transformed.scaleFactor,
      detail: host.context.getScreenshotDetailForExecutor(),
      source: "fresh",
      capturedAt: Date.now(),
      dataUrl: transformed.dataUrl,
    };
    host.traceRecorder?.recordEvent("screenshot_transform", {
      scaleFactor: transformed.scaleFactor,
      width: transformed.width,
      height: transformed.height,
      path: "vl_executor",
    });
    setCachedScreenshot(tabId, image.dataUrl, {
      scaleFactor: image.scaleFactor,
      width: image.width,
      height: image.height,
    });

    const postCaptureState =
      (await probeDocumentState(host, tabId)) ?? currentDocumentState;
    const accepted = host.perception.acceptImageObservation({
      baseRevision: base.basis.observationRevision,
      image,
      postCaptureState: postCaptureState!,
    });
    if (!accepted.consistent) {
      if (!host.enforcePageStateConsistency) {
        state.lastFingerprint = fingerprint;
        state.lastImage = image;
        state.lastDocumentState = currentDocumentState ?? null;
        applyScreenshotProjection(host, image, {
          meta: {
            mode: "vl_screenshot_only",
            source: "fresh",
            freshnessReason: "vl_screenshot",
            screenshotStatus: "captured",
          },
          stats: {
            model: "none (unified VL)",
            durationMs: 0,
            cached: false,
          },
        });
        host.traceRecorder?.recordEvent("page_observation_shadow_mismatch", {
          source: "fresh_screenshot",
          reason: accepted.observation.consistencyReason,
        });
        return;
      }
      host.traceRecorder?.recordEvent("page_observation_consistency_retry", {
        attempt: attempt + 1,
        reason: accepted.observation.consistencyReason,
      });
      clearScreenshotProjection(host);
      if (attempt === 0 && (await host.refreshSnapshot(tabId)) >= 0) {
        await captureVLExecutorScreenshot(host, tabId, state, attempt + 1);
      }
      return;
    }

    state.lastFingerprint = fingerprint;
    state.lastImage = image;
    state.lastDocumentState = currentDocumentState ?? null;
    applyScreenshotProjection(host, image, {
      meta: {
        mode: "vl_screenshot_only",
        source: "fresh",
        freshnessReason: "vl_screenshot",
        screenshotStatus: "captured",
      },
      stats: { model: "none (unified VL)", durationMs: 0, cached: false },
    });
    host.traceRecorder?.recordPerception(
      {
        interpretation:
          "[VL mode] Screenshot sent directly to executor — no separate perception call.",
        model: "none (unified VL)",
        durationMs: 0,
        cached: false,
        mode: "vl_screenshot_only",
        source: "fresh",
        freshnessReason: "vl_screenshot",
        screenshotStatus: "captured",
      },
      image.dataUrl,
    );
  } catch (error: unknown) {
    state.lastFingerprint = null;
    state.lastImage = null;
    state.lastDocumentState = null;
    host.log.warn("agent", "VL screenshot capture failed, using DOM fallback", {
      error: (error as { message?: string })?.message,
    });
    clearScreenshotProjection(host);
    host.perception.setScreenshotTrace({
      meta: {
        mode: "element_only",
        source: "fallback",
        freshnessReason: "dom_fallback",
        screenshotStatus: "capture_failed",
      },
      stats: { model: "none (capture failed)", durationMs: 0, cached: false },
    });
  }
}
