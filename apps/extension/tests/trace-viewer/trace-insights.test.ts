import { describe, expect, test } from "vitest";
import "../setup";
import { buildTraceInsights } from "../../../../scripts/trace-insights";

describe("trace insights", () => {
  test("aggregates tool, skill, run, model, failure, and event stats", () => {
    const sessions = [
      {
        sessionId: "s1",
        runId: "run-1",
        startTime: Date.UTC(2026, 3, 15, 9, 0, 0),
        endTime: Date.UTC(2026, 3, 15, 9, 1, 0),
        query: "Objective: checkout",
        startUrl: "https://shop.example/cart",
        outcome: "completed",
        turnCount: 2,
        metrics: {
          totalCost: 0.1,
          modelBreakdown: { "openai/gpt-5.4-mini": { calls: 2 } },
        },
        skillToolMetrics: { skillId: "checkout" },
      },
      {
        sessionId: "s2",
        runId: "run-1",
        startTime: Date.UTC(2026, 3, 15, 9, 2, 0),
        endTime: Date.UTC(2026, 3, 15, 9, 3, 0),
        query: "Objective: checkout",
        startUrl: "https://shop.example/cart",
        outcome: "error",
        turnCount: 3,
        failureCategory: "tool_execution",
        metrics: {
          totalCost: 0.2,
          modelBreakdown: { "openai/gpt-5.4-mini": { calls: 3 } },
        },
        planDecomposition: {
          steps: [{ selectedSkillId: "checkout" }],
        },
      },
    ];

    const entriesBySession = new Map<string, any[]>([
      [
        "s1",
        [
          {
            llmRequest: { model: "openai/gpt-5.4-mini" },
            llmResponse: {
              durationMs: 1200,
              usage: {
                prompt_tokens: 100,
                completion_tokens: 20,
                total_tokens: 120,
                cost: 0.01,
              },
            },
            toolExecutions: [
              {
                toolName: "click",
                success: true,
                durationMs: 100,
              },
            ],
            events: [{ type: "plan_monitor" }],
          },
        ],
      ],
      [
        "s2",
        [
          {
            llmRequest: { model: "openai/gpt-5.4-mini" },
            llmResponse: {
              durationMs: 1800,
              usage: {
                input_tokens: 200,
                output_tokens: 50,
                cost: 0.02,
              },
            },
            toolExecutions: [
              {
                toolName: "click",
                success: false,
                error: "Element not found",
                durationMs: 300,
              },
            ],
            events: [{ type: "circuit_breaker" }],
          },
        ],
      ],
    ]);
    const runEventsByRun = new Map<string, any[]>([
      ["run-1", [{ type: "orchestrator.node.completed" }]],
    ]);

    const result = buildTraceInsights({
      sessions,
      entriesBySession,
      runEventsByRun,
      filters: { runId: "run-1" },
    });

    expect(result.summary).toMatchObject({
      totalSessions: 2,
      totalRuns: 1,
      completedSessions: 1,
      failedSessions: 1,
      totalTurns: 5,
      toolCalls: 2,
      toolFailures: 1,
      llmRequests: 2,
      promptTokens: 300,
      completionTokens: 70,
      totalTokens: 370,
      requestCost: 0.03,
      totalLlmDurationMs: 3000,
    });
    expect(result.tools[0]).toMatchObject({
      id: "click",
      calls: 2,
      failures: 1,
      sessions: 2,
      runs: 1,
      sampleError: "Element not found",
    });
    expect(result.skills[0]).toMatchObject({
      id: "checkout",
      sessions: 2,
      failures: 1,
    });
    expect(result.models[0]).toMatchObject({
      id: "openai/gpt-5.4-mini",
      sessions: 2,
      requests: 2,
    });
    expect(result.failures[0]).toMatchObject({
      id: "tool_execution",
      sessions: 1,
    });
    expect(result.events.map((row) => row.id).sort()).toEqual([
      "circuit_breaker",
      "orchestrator.node.completed",
      "plan_monitor",
    ]);
    expect(result.runs[0]).toMatchObject({
      runId: "run-1",
      sessions: 2,
      failedSessions: 1,
      totalTurns: 5,
      topTools: ["click"],
      topSkills: ["checkout"],
    });
  });

  test("aggregates estimated input, cached input, and output cost drivers", () => {
    const sessions = [
      {
        sessionId: "s1",
        runId: "run-1",
        startTime: Date.UTC(2026, 4, 18, 9, 0, 0),
        endTime: Date.UTC(2026, 4, 18, 9, 1, 0),
        query: "Objective: cost split",
        startUrl: "https://example.com",
        outcome: "completed",
        turnCount: 1,
        metrics: { totalCost: 0.001152, modelBreakdown: {} },
      },
    ];
    const entriesBySession = new Map<string, any[]>([
      [
        "s1",
        [
          {
            llmRequest: {
              model: "accounts/fireworks/routers/kimi-k2p6-turbo",
            },
            llmResponse: {
              actualProviderId: "fireworks",
              durationMs: 100,
              usage: {
                prompt_tokens: 1000,
                cached_tokens: 400,
                completion_tokens: 100,
                total_tokens: 1100,
              },
            },
            toolExecutions: [],
          },
        ],
      ],
    ]);

    const result = buildTraceInsights({ sessions, entriesBySession });

    expect(result.summary).toMatchObject({
      promptTokens: 1000,
      cachedTokens: 400,
      nonCachedInputTokens: 600,
      completionTokens: 100,
      outputTokenShare: 100 / 1100,
      unpricedRequests: 0,
    });
    expect(result.summary.estimatedInputCost).toBeCloseTo(0.0012, 8);
    expect(result.summary.estimatedCachedInputCost).toBeCloseTo(0.00012, 8);
    expect(result.summary.estimatedOutputCost).toBeCloseTo(0.0008, 8);
    expect(result.summary.estimatedRequestCost).toBeCloseTo(0.00212, 8);
    expect(result.summary.outputCostShare).toBeCloseTo(0.0008 / 0.00212, 8);
    expect(result.models[0]).toMatchObject({
      id: "accounts/fireworks/routers/kimi-k2p6-turbo",
      requests: 1,
      promptTokens: 1000,
      cachedTokens: 400,
      completionTokens: 100,
    });
    expect(result.models[0].estimatedRequestCost).toBeCloseTo(0.00212, 8);
  });

  test("filters by failed tool", () => {
    const sessions = [
      {
        sessionId: "s1",
        startTime: Date.UTC(2026, 3, 15),
        endTime: Date.UTC(2026, 3, 15, 0, 1),
        query: "Objective: test",
        startUrl: "https://example.com",
        outcome: "completed",
        turnCount: 1,
        metrics: null,
      },
      {
        sessionId: "s2",
        startTime: Date.UTC(2026, 3, 15),
        endTime: Date.UTC(2026, 3, 15, 0, 1),
        query: "Objective: test",
        startUrl: "https://example.com",
        outcome: "error",
        turnCount: 1,
        metrics: null,
      },
    ];
    const entriesBySession = new Map<string, any[]>([
      ["s1", [{ toolExecutions: [{ toolName: "click", success: true }] }]],
      ["s2", [{ toolExecutions: [{ toolName: "click", success: false }] }]],
    ]);

    const result = buildTraceInsights({
      sessions,
      entriesBySession,
      filters: { tool: "click", toolStatus: "failure" },
    });

    expect(result.summary.totalSessions).toBe(1);
    expect(result.summary.failedSessions).toBe(1);
    expect(result.facets.sessions).toEqual(["s2"]);
  });

  test("bounds heavy run rows while preserving aggregate counts", () => {
    const sessions = Array.from({ length: 250 }, (_, index) => ({
      sessionId: `s${index}`,
      runId: `run-${index}`,
      startTime: Date.UTC(2026, 3, 15, 9, index, 0),
      endTime: Date.UTC(2026, 3, 15, 9, index + 1, 0),
      query: `Objective: ${"x".repeat(800)}`,
      startUrl: "https://example.com",
      outcome: "completed",
      turnCount: 1,
      metrics: null,
    }));

    const result = buildTraceInsights({
      sessions,
      entriesBySession: new Map(),
    });

    expect(result.summary.totalRuns).toBe(250);
    expect(result.runs).toHaveLength(200);
    expect(result.runs[0].query).toHaveLength(500);
    expect(result.runs[0].query.endsWith("...")).toBe(true);
    expect(result.facets.runs).toHaveLength(250);
    expect(result.facets.sessions).toHaveLength(250);
  });
});
