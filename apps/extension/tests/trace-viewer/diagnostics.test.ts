import { describe, expect, test } from "vitest";
import "../setup";
import { computeSessionDiagnostics } from "../../src/trace-viewer/diagnostics";

describe("trace-viewer diagnostics", () => {
  test("computes productive turns, loops, failovers, escalations, and context pressure", () => {
    const session = {
      sessionId: "session-1",
      startTime: 1,
      endTime: 10,
      query: "Objective: verify diagnostics",
      startUrl: "https://example.com",
      outcome: "completed",
      turnCount: 2,
      summary: "done",
      metrics: null,
    } as any;

    const diagnostics = computeSessionDiagnostics(session, [
      {
        sessionId: "session-1",
        turnNumber: 1,
        timestamp: 1,
        snapshot: {
          url: "https://example.com",
          title: "Example",
          elementCount: 1,
          visibleContentLength: 1,
          scrollY: 0,
        },
        elements: [],
        llmRequest: {
          model: "openai/gpt-5.4-mini:nitro",
          modelTier: "planner",
          messageCount: 1,
          toolCount: 1,
          compressionLevel: "none",
          contextMetrics: {
            systemTokens: 1,
            historyTokens: 1,
            totalTokens: 90,
            maxTokens: 100,
            utilization: 0.9,
            droppedMessageCount: 1,
            compressionLevel: "none",
            cachedPrefixLength: 0,
          },
        },
        llmResponse: {
          content: null,
          toolCalls: [],
          finishReason: "stop",
          usage: null,
          durationMs: 250,
          actualModel: "openai/gpt-5.4",
        },
        toolExecutions: [
          {
            toolCallId: "tc-1",
            toolName: "click",
            args: {},
            result: "fail",
            success: false,
            durationMs: 25,
            riskLevel: "low",
            error: "blocked",
          },
        ],
        events: [
          {
            type: "escalation",
            timestamp: 1,
            data: { reason: "stuck", voluntary: false },
          },
        ],
        progressState: { stagnantTurns: 2, signal: "stuck" },
        perception: {
          interpretation: "Page Interpretation",
          model: "vision-model",
          durationMs: 40,
          cached: true,
          mode: "structured",
          source: "cached",
          freshnessReason: "fingerprint_cache_hit",
          screenshotStatus: "cached",
        },
      },
      {
        sessionId: "session-1",
        turnNumber: 2,
        timestamp: 2,
        snapshot: {
          url: "https://example.com",
          title: "Example",
          elementCount: 1,
          visibleContentLength: 1,
          scrollY: 0,
        },
        elements: [],
        llmRequest: {
          model: "openai/gpt-5.4-mini:nitro",
          modelTier: "executor",
          messageCount: 1,
          toolCount: 0,
          compressionLevel: "none",
        },
        llmResponse: {
          content: null,
          toolCalls: [],
          finishReason: "stop",
          usage: null,
          durationMs: 150,
        },
        toolExecutions: [
          {
            toolCallId: "tc-2",
            toolName: "click",
            args: {},
            result: "fail again",
            success: false,
            durationMs: 20,
            riskLevel: "low",
            error: "blocked",
          },
        ],
        events: [
          {
            type: "stuck_signal",
            timestamp: 2,
            data: { type: "escalate", stagnantTurns: 3 },
          },
        ],
        progressState: { stagnantTurns: 3, signal: "stuck" },
      },
      {
        sessionId: "session-1",
        turnNumber: 3,
        timestamp: 3,
        snapshot: {
          url: "https://example.com/done",
          title: "Done",
          elementCount: 1,
          visibleContentLength: 1,
          scrollY: 0,
        },
        elements: [],
        llmRequest: {
          model: "openai/gpt-5.4-mini:nitro",
          modelTier: "executor",
          messageCount: 1,
          toolCount: 0,
          compressionLevel: "none",
        },
        llmResponse: {
          content: "Done",
          toolCalls: [],
          finishReason: "stop",
          usage: null,
          durationMs: 100,
        },
        toolExecutions: [],
        events: [],
        progressState: { stagnantTurns: 0, signal: null },
      },
    ] as any);

    expect(diagnostics).toMatchObject({
      productiveTurns: 1,
      wastedTurns: 2,
      loopTurns: 2,
      escalations: 2,
      failovers: 1,
      perceptionCalls: 1,
      perceptionCacheHits: 1,
      structuredPerceptionTurns: 1,
      vlScreenshotTurns: 0,
      elementOnlyTurns: 0,
      degradedPerceptionTurns: 0,
      contextHotTurns: 1,
      toolFailureTurns: 2,
      perceptionSources: {
        cached: 1,
      },
      perceptionFreshness: {
        fingerprint_cache_hit: 1,
      },
      perceptionScreenshots: {
        cached: 1,
      },
    });
  });

  test("tracks degraded perception fallbacks and screenshot failures", () => {
    const session = {
      sessionId: "session-2",
      startTime: 1,
      endTime: 2,
      query: "Objective: inspect fallbacks",
      startUrl: "https://example.com",
      outcome: "completed",
      turnCount: 1,
      summary: "done",
      metrics: null,
    } as any;

    const diagnostics = computeSessionDiagnostics(session, [
      {
        sessionId: "session-2",
        turnNumber: 1,
        timestamp: 1,
        snapshot: {
          url: "https://example.com",
          title: "Example",
          elementCount: 1,
          visibleContentLength: 1,
          scrollY: 0,
        },
        elements: [],
        llmRequest: {
          model: "openai/gpt-5.4-mini:nitro",
          modelTier: "executor",
          messageCount: 1,
          toolCount: 0,
          compressionLevel: "none",
        },
        llmResponse: {
          content: "Fallback",
          toolCalls: [],
          finishReason: "stop",
          usage: null,
          durationMs: 100,
        },
        toolExecutions: [],
        events: [],
        progressState: { stagnantTurns: 0, signal: null },
        perception: {
          interpretation: "[No API key - visual perception unavailable.]",
          model: "vision-model",
          durationMs: 5,
          cached: false,
          mode: "element_only",
          source: "fallback",
          freshnessReason: "dom_fallback",
          fallbackReason: "no_api_key",
          screenshotStatus: "capture_failed",
        },
      },
    ] as any);

    expect(diagnostics).toMatchObject({
      perceptionCalls: 1,
      elementOnlyTurns: 1,
      degradedPerceptionTurns: 1,
      perceptionSources: {
        fallback: 1,
      },
      perceptionFreshness: {
        dom_fallback: 1,
      },
      perceptionFallbacks: {
        no_api_key: 1,
      },
      perceptionScreenshots: {
        capture_failed: 1,
      },
    });
  });
});
