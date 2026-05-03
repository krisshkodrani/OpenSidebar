import { describe, expect, test } from "vitest";
import {
  emptySessionMetrics,
  recordCachedVisionTelemetryUse,
  recordVisionTelemetryUsage,
} from "../../src/background/agent/agent-telemetry";

describe("agent telemetry", () => {
  test("counts vision model calls separately from cached vision observations", () => {
    const metrics = emptySessionMetrics();

    recordVisionTelemetryUsage({
      metrics,
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
      },
      llmMs: 250,
      model: "accounts/fireworks/routers/kimi-k2p5-turbo",
      providerId: "fireworks",
    });
    recordCachedVisionTelemetryUse(metrics);

    expect(metrics.visionCallCount).toBe(1);
    expect(metrics.cachedVisionCallCount).toBe(1);
    expect(metrics.llmCallCount).toBe(1);
    expect(metrics.totalTokens).toBe(120);
  });
});
