import { describe, expect, test } from "vitest";
import {
  buildProviderFailureReport,
  summarizeProviderFailures,
  type ProviderFailureTurn,
} from "../../evals/provider-failures";

describe("provider failure report", () => {
  test("summarizes empty-response failure turns", () => {
    const turns: ProviderFailureTurn[] = [
      {
        sessionId: "s1",
        recordedAt: "2026-03-13T08:00:00.000Z",
        startUrl: "http://127.0.0.1:5000/page",
        outcome: "error",
        failureCode: "empty_response",
        turnNumber: 1,
        actualModel: "openai/gpt-oss-120b",
        actualProviderId: "openrouter",
        finishReason: "stop",
        promptTokens: 5000,
        completionTokens: 120,
        totalTokens: 5120,
        durationMs: 6000,
        retryCount: 2,
        query: "do thing",
      },
      {
        sessionId: "s2",
        recordedAt: "2026-03-13T08:01:00.000Z",
        startUrl: "http://127.0.0.1:5000/page",
        outcome: "error",
        failureCode: "empty_response",
        turnNumber: 2,
        actualModel: "openai/gpt-oss-120b",
        actualProviderId: "openrouter",
        finishReason: "stop",
        promptTokens: 7000,
        completionTokens: 140,
        totalTokens: 7140,
        durationMs: 8000,
        retryCount: 2,
        query: "do thing",
      },
    ];

    const summary = summarizeProviderFailures(turns);
    expect(summary.totalSessions).toBe(2);
    expect(summary.totalFailureTurns).toBe(2);
    expect(summary.byFailureCode.empty_response).toBe(2);
    expect(summary.byModel["openai/gpt-oss-120b"]).toBe(2);
    expect(summary.avgPromptTokens).toBe(6000);
    expect(summary.avgRetryCount).toBe(2);

    const report = buildProviderFailureReport(summary, { onlyLocalhost: true, limit: 10 });
    expect(report).toContain("# Provider Failure Report");
    expect(report).toContain("empty_response");
    expect(report).toContain("openai/gpt-oss-120b");
    expect(report).toContain("finishReason");
  });
});
