import type { WarmupEntry } from "../../perception/warmup";
import type { ContextManager } from "../context";
import type { TraceRecorder } from "../trace";
import { PageStateCoordinator, sha256DataUrl } from "./coordinator";

export interface WarmupAdoptionHost {
  readonly context: ContextManager;
  readonly perception: PageStateCoordinator;
  readonly traceRecorder: TraceRecorder | null;
  readonly useVLExecutor: boolean;
  readonly enforcePageStateConsistency: boolean;
  readonly log: {
    info(category: string, message: string, data?: Record<string, unknown>): void;
  };
  imagePromptBudgetAllows(count: number): boolean;
  recordImagePromptBudgetExhausted(count: number, source: string): void;
  recordCachedVisionUsage(): void;
}

/** Project a revision-consistent warmup frame, or ask the caller to recapture. */
export async function adoptWarmupScreenshot(
  host: WarmupAdoptionHost,
  input: { screenshot: string | null; entry: WarmupEntry | null },
): Promise<"handled" | "rejected" | "unavailable"> {
  if (!host.useVLExecutor || !input.screenshot) return "unavailable";
  if (!host.imagePromptBudgetAllows(1)) {
    host.recordImagePromptBudgetExhausted(1, "vl_warmup_screenshot");
    host.context.setScreenshotForExecutor(null);
    host.context.setPageInterpretation(null);
    host.perception.setScreenshotTrace({
      meta: {
        mode: "element_only",
        source: "fallback",
        freshnessReason: "dom_fallback",
        screenshotStatus: "not_requested",
      },
      stats: { model: "none (image budget)", durationMs: 0, cached: false },
    });
    return "handled";
  }
  const current = host.perception.getCurrentObservation();
  if (!input.entry || !current) return "unavailable";

  const sha256 = await sha256DataUrl(input.screenshot);
  const accepted = host.perception.acceptImageObservation({
    baseRevision: current.basis.observationRevision,
    image: {
      artifactId: `sha256:${sha256}`,
      sha256,
      ...input.entry.screenshotMeta,
      detail: host.context.getScreenshotDetailForExecutor(),
      source: "reused",
      dataUrl: input.screenshot,
    },
    postCaptureState: input.entry.postCaptureDocumentState,
  });
  if (!accepted.consistent && host.enforcePageStateConsistency) {
    host.traceRecorder?.recordEvent("warmup_observation_rejected", {
      reason: accepted.observation.consistencyReason,
    });
    return "rejected";
  }

  host.context.setScreenshotForExecutor(input.screenshot);
  host.context.setPageInterpretation(null);
  host.perception.setScreenshotTrace({
    meta: {
      mode: "vl_screenshot_only",
      source: "warmup",
      freshnessReason: "warmup_cache",
      screenshotStatus: "cached",
    },
    stats: {
      model: "none (unified VL, warmup)",
      durationMs: 0,
      cached: true,
    },
  });
  host.recordCachedVisionUsage();
  host.traceRecorder?.recordPerception(
    {
      interpretation: "[VL mode] Screenshot from warmup cache — no perception call.",
      model: "none (unified VL, warmup)",
      durationMs: 0,
      cached: true,
      mode: "vl_screenshot_only",
      source: "warmup",
      freshnessReason: "warmup_cache",
      screenshotStatus: "cached",
    },
    input.screenshot,
  );
  host.log.info(
    "agent",
    accepted.consistent
      ? "VL mode: using consistent warmup screenshot"
      : "VL mode: using warmup screenshot in shadow mode",
    { observationRevision: accepted.observation.basis.observationRevision },
  );
  return "handled";
}
