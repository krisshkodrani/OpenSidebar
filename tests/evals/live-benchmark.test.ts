import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildLiveBenchmarkReport,
  collectLiveBenchmarkSessions,
  summarizeLiveBenchmarkSessions,
  type LiveBenchmarkSession,
} from "../../evals/live-benchmark";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("live benchmark summarization", () => {
  test("computes success, turns, host counts, and failure categories", () => {
    const sessions: LiveBenchmarkSession[] = [
      {
        sessionId: "s1",
        recordedAt: "2026-03-13T10:00:00.000Z",
        query: "complete localhost fixture",
        startUrl: "http://127.0.0.1:65518/navigation-challenge.html",
        outcome: "completed",
        failureCategory: "none",
        turnCount: 10,
        metrics: {
          totalCostEstimated: 0.002,
          totalSessionTimeMs: 12000,
          totalLlmTimeMs: 9000,
          llmCallCount: 10,
        },
        controller: {
          avgToolCount: 9,
          avgExecutedToolsPerTurn: 1,
          toolProfileAppliedTurns: 4,
          toolProfileAvgFilteredCount: 5,
          groundingMismatchCount: 1,
          invalidIdRecoveryHintCount: 1,
          blockedByPolicyCount: 1,
          safetyBlockedCount: 0,
          stagnationSignalCount: 0,
          sameUrlEscalationCount: 0,
          strategyPivotCount: 1,
          deadEndPivotCount: 0,
          zeroEffectWarningCount: 1,
          redundantActionNudgeCount: 0,
        },
      },
      {
        sessionId: "s2",
        recordedAt: "2026-03-13T11:00:00.000Z",
        query: "complete prod task",
        startUrl: "https://example.com/task",
        outcome: "stopped",
        failureCategory: "stagnation",
        turnCount: 20,
        metrics: {
          totalCostEstimated: 0.004,
          totalSessionTimeMs: 22000,
          totalLlmTimeMs: 15000,
          llmCallCount: 18,
        },
        controller: {
          avgToolCount: 14,
          avgExecutedToolsPerTurn: 1.2,
          toolProfileAppliedTurns: 0,
          toolProfileAvgFilteredCount: 0,
          groundingMismatchCount: 2,
          invalidIdRecoveryHintCount: 2,
          blockedByPolicyCount: 2,
          safetyBlockedCount: 1,
          stagnationSignalCount: 3,
          sameUrlEscalationCount: 1,
          strategyPivotCount: 2,
          deadEndPivotCount: 1,
          zeroEffectWarningCount: 2,
          redundantActionNudgeCount: 1,
        },
      },
    ];

    const summary = summarizeLiveBenchmarkSessions(sessions);

    expect(summary.totalSessions).toBe(2);
    expect(summary.completedSessions).toBe(1);
    expect(summary.successRate).toBe(0.5);
    expect(summary.providerFailureSessions).toBe(0);
    expect(summary.nonProviderSessions).toBe(2);
    expect(summary.nonProviderSuccessRate).toBe(0.5);
    expect(summary.avgTurns).toBe(15);
    expect(summary.medianTurns).toBe(15);
    expect(summary.hostCounts["127.0.0.1:65518"]).toBe(1);
    expect(summary.hostCounts["example.com"]).toBe(1);
    expect(summary.failureCategoryCounts.stagnation).toBe(1);
    expect(summary.controller.avgRequestedToolCount).toBe(11.5);
    expect(summary.controller.totalToolProfileAppliedTurns).toBe(4);
    expect(summary.controller.groundingMismatchCount).toBe(3);
    expect(summary.controller.invalidIdRecoveryHintCount).toBe(3);
    expect(summary.controller.sameUrlEscalationCount).toBe(1);
    expect(Array.isArray(summary.pendingSessions)).toBe(true);

    const report = buildLiveBenchmarkReport(summary, { onlyLocalhost: true, limit: 2 });
    expect(report).toContain("# Live Benchmark Report");
    expect(report).toContain("Success rate | 50.0% (1/2)");
    expect(report).toContain("127.0.0.1:65518");
    expect(report).toContain("stagnation");
    expect(report).toContain("Controller Metrics");
    expect(report).toContain("Tool-profile-applied turns: 4");
    expect(report).toContain("Grounding mismatches: 3");
    expect(report).toContain("Invalid-ID recovery hints: 3");
    expect(report).toContain("Success rate (excluding provider failures) | 50.0% (1/2)");
    expect(report).toContain("traces/index.jsonl` + raw `traces/*.jsonl` fallback");
    expect(report).toContain("Unfinalized session logs |");
  });

  test("collect merges indexed and raw trace sessions without duplicates", async () => {
    const indexed = [
      {
        sessionId: "s1",
        recordedAt: "2026-03-13T10:00:00.000Z",
        query: "indexed session",
        outcome: "completed",
      },
    ];
    const raw = [
      {
        sessionId: "s1",
        recordedAt: "2026-03-13T09:00:00.000Z",
        query: "older duplicate",
        outcome: "error",
      },
      {
        sessionId: "s2",
        recordedAt: "2026-03-13T11:00:00.000Z",
        query: "raw only session",
        outcome: "completed",
      },
    ];

    const utils = await import("../../evals/utils");
    vi.spyOn(utils, "readSessionIndex").mockReturnValue(indexed);
    vi.spyOn(utils, "readSessionFiles").mockReturnValue(raw);

    const sessions = collectLiveBenchmarkSessions();

    expect(sessions).toHaveLength(2);
    expect(sessions.map((session) => session.sessionId)).toEqual(["s2", "s1"]);
    expect(sessions.find((session) => session.sessionId === "s1")?.query).toBe("indexed session");
  });
});
