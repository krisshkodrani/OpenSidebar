import { describe, expect, test } from "vitest";
import "../setup";
import { summarizeSessionComparison } from "../../src/trace-viewer/compare";

describe("trace-viewer compare", () => {
  test("summarizes diagnostics and first divergence turn", () => {
    const leftSession = {
      sessionId: "left",
      startTime: 0,
      endTime: 4000,
      query: "Objective: left",
      startUrl: "https://example.com",
      outcome: "completed",
      turnCount: 2,
      summary: "done",
      metrics: { modelBreakdown: { "openai/gpt-5.4-mini:nitro": { calls: 2 } } },
    } as any;
    const rightSession = {
      sessionId: "right",
      startTime: 0,
      endTime: 5000,
      query: "Objective: right",
      startUrl: "https://example.com",
      outcome: "error",
      turnCount: 2,
      summary: "failed",
      metrics: { modelBreakdown: { "openai/gpt-5.4": { calls: 2 } } },
    } as any;

    const summary = summarizeSessionComparison(
      leftSession,
      rightSession,
      [
        {
          turnNumber: 1,
          sessionId: "left",
          timestamp: 1,
          snapshot: { url: "https://example.com/a", title: "A", elementCount: 1, visibleContentLength: 1, scrollY: 0 },
          elements: [],
          llmRequest: { model: "openai/gpt-5.4-mini:nitro", messageCount: 1, toolCount: 1, compressionLevel: "none" },
          llmResponse: { content: null, toolCalls: [], finishReason: "stop", usage: null, durationMs: 100 },
          toolExecutions: [{ toolCallId: "1", toolName: "click", args: {}, result: "ok", success: true, durationMs: 10, riskLevel: "low" }],
          events: [],
          progressState: { stagnantTurns: 0, signal: null },
        },
        {
          turnNumber: 2,
          sessionId: "left",
          timestamp: 2,
          snapshot: { url: "https://example.com/b", title: "B", elementCount: 1, visibleContentLength: 1, scrollY: 0 },
          elements: [],
          llmRequest: { model: "openai/gpt-5.4-mini:nitro", messageCount: 1, toolCount: 1, compressionLevel: "none" },
          llmResponse: { content: null, toolCalls: [], finishReason: "stop", usage: null, durationMs: 100 },
          toolExecutions: [{ toolCallId: "2", toolName: "type", args: {}, result: "ok", success: true, durationMs: 10, riskLevel: "low" }],
          events: [],
          progressState: { stagnantTurns: 0, signal: null },
        },
      ] as any,
      [
        {
          turnNumber: 1,
          sessionId: "right",
          timestamp: 1,
          snapshot: { url: "https://example.com/a", title: "A", elementCount: 1, visibleContentLength: 1, scrollY: 0 },
          elements: [],
          llmRequest: { model: "openai/gpt-5.4", messageCount: 1, toolCount: 1, compressionLevel: "none" },
          llmResponse: { content: null, toolCalls: [], finishReason: "stop", usage: null, durationMs: 100 },
          toolExecutions: [{ toolCallId: "3", toolName: "click", args: {}, result: "ok", success: true, durationMs: 10, riskLevel: "low" }],
          events: [],
          progressState: { stagnantTurns: 0, signal: null },
        },
        {
          turnNumber: 2,
          sessionId: "right",
          timestamp: 2,
          snapshot: { url: "https://example.com/c", title: "C", elementCount: 1, visibleContentLength: 1, scrollY: 0 },
          elements: [],
          llmRequest: { model: "openai/gpt-5.4", messageCount: 1, toolCount: 1, compressionLevel: "none" },
          llmResponse: { content: null, toolCalls: [], finishReason: "stop", usage: null, durationMs: 100 },
          toolExecutions: [{ toolCallId: "4", toolName: "scroll", args: {}, result: "ok", success: true, durationMs: 10, riskLevel: "low" }],
          events: [],
          progressState: { stagnantTurns: 0, signal: null },
        },
      ] as any,
    );

    expect(summary.sharedToolPrefixTurns).toBe(0);
    expect(summary.divergenceTurn).toBe(1);
    expect(summary.leftModels).toEqual(["openai/gpt-5.4-mini:nitro"]);
    expect(summary.rightModels).toEqual(["openai/gpt-5.4"]);
  });
});
