import { describe, expect, test } from "vitest";
import "../setup";
import {
  ACTION_TIER_LABEL,
  buildTrajectoryScorecard,
  buildTurnActionProfile,
  classifyActionTier,
} from "../../src/trace-viewer/analysis";
import type { TraceEntry, TraceSession } from "../../src/types/traces";

function session(overrides: Partial<TraceSession> = {}): TraceSession {
  return {
    sessionId: "session-1",
    startTime: 1,
    endTime: 10,
    query: "Submit the expense report",
    startUrl: "https://example.com",
    outcome: "completed",
    turnCount: 2,
    summary: "ok",
    metrics: { totalTokens: 1200, totalCost: 0.01 } as any,
    ...overrides,
  };
}

function tool(overrides: Record<string, unknown> = {}) {
  return {
    executionId: "session-1:turn:1:tool:tc-1",
    turnId: "session-1:turn:1",
    sessionId: "session-1",
    turnNumber: 1,
    toolCallId: "tc-1",
    toolName: "click",
    args: {},
    result: "ok",
    success: true,
    durationMs: 25,
    riskLevel: "medium",
    ...overrides,
  };
}

function entry(overrides: Partial<TraceEntry> = {}): TraceEntry {
  const turnNumber = overrides.turnNumber ?? 1;
  return {
    schemaVersion: "2026-02-19",
    traceKind: "agent.turn",
    recordedAt: "2026-04-28T00:00:00.000Z",
    producer: "background.agent.trace-recorder",
    turnId: `session-1:turn:${turnNumber}`,
    sessionId: "session-1",
    turnNumber,
    timestamp: turnNumber,
    workspaceId: null,
    snapshot: {
      url: "https://example.com",
      title: "Example",
      elementCount: 2,
      visibleContentLength: 20,
      scrollY: 0,
    },
    elements: [],
    llmRequest: {
      model: "openai/gpt-5.4-mini:nitro",
      messageCount: 2,
      toolCount: 1,
      compressionLevel: "none",
    },
    llmResponse: {
      content: null,
      toolCalls: [],
      finishReason: "stop",
      usage: null,
      durationMs: 100,
    },
    toolExecutions: [],
    events: [],
    progressState: { stagnantTurns: 0, signal: null },
    ...overrides,
  } as TraceEntry;
}

describe("action tier classification", () => {
  test("maps recorded risk level to tiers", () => {
    expect(classifyActionTier("read_page", "low")).toBe("T0");
    expect(classifyActionTier("click", "medium")).toBe("T1");
    expect(classifyActionTier("navigate", "high")).toBe("T2");
  });

  test("pins irreversible tools to T3 regardless of risk", () => {
    expect(classifyActionTier("execute_js", "high")).toBe("T3");
    expect(classifyActionTier("delete_cookie", "high")).toBe("T3");
  });

  test("defaults to T0 when risk is unknown", () => {
    expect(classifyActionTier("mystery", undefined)).toBe("T0");
    expect(ACTION_TIER_LABEL.T0).toBe("Observe");
  });
});

describe("turn action profile", () => {
  test("flags an ungated high-tier action", () => {
    const profile = buildTurnActionProfile(
      entry({
        turnNumber: 4,
        toolExecutions: [tool({ toolName: "navigate", riskLevel: "high" })],
      }),
    );
    expect(profile.maxTier).toBe("T2");
    expect(profile.escalated).toBe(false);
    expect(profile.unescalatedHighTier).toBe(true);
  });

  test("a high-tier action with an approval event is not flagged", () => {
    const profile = buildTurnActionProfile(
      entry({
        turnNumber: 5,
        toolExecutions: [tool({ toolName: "navigate", riskLevel: "high" })],
        events: [{ type: "approval_requested", timestamp: 5, data: {} }],
      }),
    );
    expect(profile.maxTier).toBe("T2");
    expect(profile.escalated).toBe(true);
    expect(profile.unescalatedHighTier).toBe(false);
  });
});

describe("trajectory scorecard", () => {
  test("a clean completed session passes", () => {
    const scorecard = buildTrajectoryScorecard({
      session: session(),
      entries: [
        entry({
          turnNumber: 1,
          toolExecutions: [tool({ toolName: "read_page", riskLevel: "low" })],
        }),
        entry({
          turnNumber: 2,
          toolExecutions: [tool({ toolName: "click", riskLevel: "medium" })],
        }),
      ],
    });
    expect(scorecard.verdict).toBe("pass");
    expect(scorecard.overallScore).toBe(5);
    expect(scorecard.highestActionTier).toBe("T1");
    expect(scorecard.unescalatedHighTierTurns).toEqual([]);
  });

  test("grades to the lowest dimension when a tool fails", () => {
    const scorecard = buildTrajectoryScorecard({
      session: session({ outcome: "error" }),
      entries: [
        entry({
          turnNumber: 1,
          toolExecutions: [
            tool({ success: false, result: "boom", error: "boom" }),
          ],
        }),
      ],
    });
    // task_completion (error -> 1) drags the overall down regardless of others.
    expect(scorecard.overallScore).toBeLessThanOrEqual(2);
    expect(scorecard.verdict).toBe("fail");
    const toolUse = scorecard.dimensions.find((d) => d.key === "tool_use");
    expect(toolUse?.score).toBeLessThan(5);
  });

  test("docks the safety dimension for ungated T3 actions", () => {
    const scorecard = buildTrajectoryScorecard({
      session: session(),
      entries: [
        entry({
          turnNumber: 1,
          toolExecutions: [tool({ toolName: "execute_js", riskLevel: "high" })],
        }),
      ],
    });
    expect(scorecard.highestActionTier).toBe("T3");
    expect(scorecard.unescalatedHighTierTurns).toEqual([1]);
    const safety = scorecard.dimensions.find((d) => d.key === "safety");
    expect(safety?.score).toBeLessThanOrEqual(3);
  });
});
