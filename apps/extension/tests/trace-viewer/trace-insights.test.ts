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
});
