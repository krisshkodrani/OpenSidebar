import { describe, expect, test } from "vitest";
import {
  canSpendImagePromptBudget,
  emptySessionMetrics,
  estimateImagePromptUsage,
  imagePromptUsageForCount,
  recordCachedVisionTelemetryUse,
  recordImagePromptUsage,
  recordPerceptionModeDecision,
  recordPerceptionTurnMode,
  recordStaleReinterpretOutcome,
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
      imagePrompt: imagePromptUsageForCount(1),
    });
    recordCachedVisionTelemetryUse(metrics);

    expect(metrics.visionCallCount).toBe(1);
    expect(metrics.cachedVisionCallCount).toBe(1);
    expect(metrics.llmCallCount).toBe(1);
    expect(metrics.imagePromptCount).toBe(1);
    expect(metrics.totalImagePromptTokenEstimate).toBe(765);
    expect(metrics.totalTokens).toBe(120);
  });

  test("estimates image prompt tokens from LLM image parts", () => {
    const usage = estimateImagePromptUsage([
      {
        role: "user",
        content: [
          { type: "text", text: "Look at this page." },
          {
            type: "image_url",
            image_url: {
              url: "data:image/jpeg;base64,AAA",
              detail: "low",
            },
          },
          {
            type: "image_url",
            image_url: {
              url: "data:image/jpeg;base64,BBB",
              detail: "high",
            },
          },
        ],
      },
    ]);

    expect(usage).toEqual({
      imageCount: 2,
      lowDetailCount: 1,
      highDetailCount: 1,
      autoDetailCount: 0,
      estimatedTokens: 850,
    });
  });

  test("records estimated image prompt tokens separately from provider totals", () => {
    const metrics = emptySessionMetrics();

    recordImagePromptUsage(metrics, imagePromptUsageForCount(2));

    expect(metrics.imagePromptCount).toBe(2);
    expect(metrics.totalImagePromptTokenEstimate).toBe(1530);
    expect(metrics.totalTokens).toBe(0);
  });

  test("records perception mode decisions defensively", () => {
    const metrics = emptySessionMetrics();

    recordPerceptionModeDecision(metrics, {
      mode: "unified_vl",
      reason: "visual_task_text",
      signals: ["visual_task_text"],
    });

    expect(metrics.perceptionModeDecision).toEqual({
      mode: "unified_vl",
      reason: "visual_task_text",
      signals: ["visual_task_text"],
    });
  });

  test("tallies which perception path served each turn", () => {
    const metrics = emptySessionMetrics();

    recordPerceptionTurnMode(metrics, "structured");
    recordPerceptionTurnMode(metrics, "unified_vl");
    recordPerceptionTurnMode(metrics, "unified_vl");

    expect(metrics.structuredTurnCount).toBe(1);
    expect(metrics.unifiedVlTurnCount).toBe(2);
  });

  test("turn-mode tally tolerates legacy metrics without the counters", () => {
    const metrics = emptySessionMetrics();
    delete metrics.structuredTurnCount;
    delete metrics.unifiedVlTurnCount;

    recordPerceptionTurnMode(metrics, "structured");
    recordPerceptionTurnMode(metrics, "unified_vl");

    expect(metrics.structuredTurnCount).toBe(1);
    expect(metrics.unifiedVlTurnCount).toBe(1);
  });

  test("tallies stale re-interprets and how many revealed hidden changes", () => {
    const metrics = emptySessionMetrics();

    recordStaleReinterpretOutcome(metrics, true);
    recordStaleReinterpretOutcome(metrics, false);
    recordStaleReinterpretOutcome(metrics, true);

    expect(metrics.staleReinterpretCount).toBe(3);
    expect(metrics.staleReinterpretRevealedCount).toBe(2);
  });

  test("checks image prompt budget against estimated prompt tokens", () => {
    const metrics = emptySessionMetrics();
    recordImagePromptUsage(metrics, imagePromptUsageForCount(2));

    expect(
      canSpendImagePromptBudget(metrics, imagePromptUsageForCount(1), 2_500),
    ).toBe(true);
    expect(
      canSpendImagePromptBudget(metrics, imagePromptUsageForCount(2), 2_500),
    ).toBe(false);
  });
});
