/**
 * Perception state holder (model-free).
 *
 * The perception seat was removed: the VL-capable executor does all perceiving
 * now (it receives the screenshot directly). This class only retains the last
 * screenshot so the agent loop's trace-recording and turn-preparation shapes
 * survive. getInterpretation() is always null and no perception model is ever
 * called.
 */

import type {
  TracePerceptionFreshnessReason,
  TracePerceptionMode,
  TracePerceptionScreenshotStatus,
  TracePerceptionSource,
} from "../../types";

export interface PerceptionTraceMeta {
  mode: TracePerceptionMode;
  source: TracePerceptionSource;
  freshnessReason: TracePerceptionFreshnessReason;
  screenshotStatus: TracePerceptionScreenshotStatus;
}

export interface PerceptionTraceStats {
  model: string;
  providerId?: string;
  durationMs: number;
  cached: boolean;
}

export class PerceptionScreenshotState {
  private lastScreenshotUrl: string | null = null;

  /** Always null — the executor does its own vision; there is no seat. */
  getInterpretation(): string | null {
    return null;
  }

  getLastScreenshot(): string | null {
    return this.lastScreenshotUrl;
  }

  getLastTraceMeta(): PerceptionTraceMeta {
    return {
      mode: "element_only",
      source: "fallback",
      freshnessReason: "dom_fallback",
      screenshotStatus: "not_requested",
    };
  }

  getLastTraceStats(): PerceptionTraceStats {
    return { model: "none", durationMs: 0, cached: false };
  }

  setScreenshotUrl(url: string | null): void {
    this.lastScreenshotUrl = url;
  }

  /** No interpretation cache remains; kept for call-site compatibility. */
  invalidateCache(): void {}

  reset(): void {
    this.lastScreenshotUrl = null;
  }
}
