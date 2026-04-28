import { describe, expect, test } from "vitest";
import "../setup";
import {
  analyzeTraceSession,
  analyzeTraceFleet,
  buildTraceEvidenceTimeline,
  buildTraceInvestigationReport,
  compareTraceSessions,
  compareTraceTimelines,
} from "../../src/trace-viewer/analysis";
import {
  validateTraceBundle,
  validateTraceRecord,
} from "../../src/trace-viewer/analysis";
import { redactTracePayload } from "../../src/utils/trace-protection";
import type { TraceEntry, TraceSession } from "../../src/types/traces";

function session(overrides: Partial<TraceSession> = {}): TraceSession {
  return {
    sessionId: "session-1",
    startTime: 1,
    endTime: 10,
    query: "Find the invoice total",
    startUrl: "https://example.com",
    outcome: "error",
    turnCount: 3,
    summary: "failed",
    metrics: {
      totalTokens: 1200,
      totalCost: 0.01,
    } as any,
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
  };
}

describe("trace investigation analysis", () => {
  test("identifies the first failed tool as the primary diagnosis", () => {
    const investigation = analyzeTraceSession({
      session: session(),
      entries: [
        entry({
          turnNumber: 1,
          toolExecutions: [
            {
              executionId: "session-1:turn:1:tool:tc-1",
              turnId: "session-1:turn:1",
              sessionId: "session-1",
              turnNumber: 1,
              toolCallId: "tc-1",
              toolName: "click",
              args: { elementId: 7 },
              result: "element detached",
              success: false,
              durationMs: 25,
              riskLevel: "low",
              error: "element detached",
            },
          ],
        }),
        entry({
          turnNumber: 2,
          progressState: { stagnantTurns: 3, signal: "same_action" },
        }),
      ],
    });

    expect(investigation).toMatchObject({
      likelyFailureClass: "tool_execution",
      firstBadTurn: 1,
      metrics: {
        turnCount: 2,
        toolFailureTurns: 1,
      },
    });
    expect(investigation.findings[0]).toMatchObject({
      id: "tool-failure-t1",
      severity: "error",
    });
  });

  test("surfaces verifier and completion rejection evidence", () => {
    const investigation = analyzeTraceSession({
      session: session({ outcome: "max_turns", failureDetail: "turn budget" }),
      entries: [
        entry({
          turnNumber: 1,
          events: [
            {
              eventId: "session-1:turn:1:event:0",
              turnId: "session-1:turn:1",
              sessionId: "session-1",
              turnNumber: 1,
              type: "done_rejected",
              timestamp: 1,
              data: {
                rejections: 1,
                reason: "missing evidence",
                advancedTo: 1,
              },
            },
          ],
        }),
      ],
      runEvents: [
        {
          runId: "run-1",
          ts: "2026-04-28T00:00:00.000Z",
          type: "verifier_rejected",
          role: "verifier",
          data: { reason: "missing proof" },
        },
      ],
    });

    expect(investigation.findings.map((finding) => finding.category)).toContain(
      "verification",
    );
    expect(investigation.metrics.doneRejectionCount).toBe(1);
    expect(investigation.metrics.replanCount).toBe(0);
  });
});

describe("trace validation", () => {
  test("warns when a turn lacks a stable turn id", () => {
    const result = validateTraceRecord({
      schemaVersion: "2026-02-19",
      traceKind: "agent.turn",
      recordedAt: "2026-04-28T00:00:00.000Z",
      sessionId: "session-1",
      turnNumber: 1,
      timestamp: 1,
      snapshot: {},
      llmRequest: {},
      llmResponse: {},
      toolExecutions: [],
      events: [],
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_turn_id" }),
      ]),
    );
  });

  test("detects duplicate turns and orphan screenshots", () => {
    const issues = validateTraceBundle({
      sessions: [session({ outcome: "completed", failureCode: "none" })],
      entriesBySession: new Map([
        [
          "session-1",
          [
            entry({ turnNumber: 1 }),
            entry({
              turnNumber: 1,
              perception: {
                interpretation: "page",
                model: "vision",
                durationMs: 1,
                cached: false,
                screenshotStatus: "captured",
              },
            }),
          ],
        ],
      ]),
      screenshotFiles: new Set(["orphan-T1.jpg"]),
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate_turn" }),
        expect.objectContaining({ code: "missing_screenshot" }),
        expect.objectContaining({ code: "orphan_screenshot" }),
      ]),
    );
  });
});

describe("trace redaction", () => {
  test("redacts secrets while preserving diagnostic text", () => {
    const redacted = redactTracePayload({
      authorization: "Bearer abcdef",
      content: "Contact dev@example.com with sk-secretsecretsecretsecret",
      toolName: "click",
    });

    expect(redacted.authorization).toBe("[REDACTED]");
    expect(redacted.toolName).toBe("click");
    expect(redacted.content).toContain("Contact");
    expect(redacted.content).toContain("sk-[REDACTED]");
  });

  test("export mode removes email addresses and image payloads", () => {
    const redacted = redactTracePayload(
      {
        content: "Contact dev@example.com",
        screenshotDataUrl: "data:image/jpeg;base64,abc",
      },
      { mode: "export" },
    );

    expect(redacted.content).toBe("Contact [REDACTED_EMAIL]");
    expect(redacted.screenshotDataUrl).toBe("[REDACTED_IMAGE_DATA_URL]");
  });
});

describe("trace investigation report", () => {
  test("builds redacted agent-ready context around evidence turns", () => {
    const report = buildTraceInvestigationReport(
      {
        session: session({ runId: "run-1" }),
        entries: [
          entry({
            turnNumber: 1,
            llmResponse: {
              content: "Need to click the button for dev@example.com",
              toolCalls: [
                {
                  id: "tc-1",
                  type: "function",
                  function: {
                    name: "click",
                    arguments: JSON.stringify({
                      apiKey: "sk-secretsecretsecretsecret",
                    }),
                  },
                },
              ],
              finishReason: "tool_calls",
              usage: null,
              durationMs: 100,
            },
            toolExecutions: [
              {
                toolCallId: "tc-1",
                toolName: "click",
                args: { apiKey: "sk-secretsecretsecretsecret" },
                result: "element detached",
                success: false,
                durationMs: 25,
                riskLevel: "low",
                error: "element detached",
              },
            ],
          }),
        ],
        runEvents: [
          {
            runId: "run-1",
            ts: "2026-04-28T00:00:00.000Z",
            type: "verifier_rejected",
            role: "verifier",
            turn: 1,
            data: { reason: "missing proof" },
          },
        ],
      },
      { maxTurns: 1 },
    );

    expect(report).toContain("# Trace Investigation Context");
    expect(report).toContain("Likely class: tool_execution");
    expect(report).toContain("### Turn 1");
    expect(report).toContain("[REDACTED_EMAIL]");
    expect(report).toContain("sk-[REDACTED]");
    expect(report).toContain("verifier_rejected");
  });
});

describe("trace evidence timeline", () => {
  test("correlates tool, perception, context, verifier, and log evidence by turn", () => {
    const timeline = buildTraceEvidenceTimeline({
      session: session({ runId: "run-1" }),
      entries: [
        entry({
          turnNumber: 1,
          toolExecutions: [
            {
              toolCallId: "tc-1",
              toolName: "click",
              args: {},
              result: "element detached",
              success: false,
              durationMs: 25,
              riskLevel: "low",
              error: "element detached",
            },
          ],
          perception: {
            interpretation: "fallback only",
            model: "vision",
            durationMs: 1,
            cached: false,
            mode: "element_only",
            source: "fallback",
            fallbackReason: "no_api_key",
            screenshotStatus: "missing",
          },
          llmRequest: {
            model: "openai/gpt-5.4-mini:nitro",
            messageCount: 2,
            toolCount: 1,
            compressionLevel: "compressed",
            contextMetrics: {
              systemTokens: 1,
              historyTokens: 90,
              totalTokens: 91,
              maxTokens: 100,
              utilization: 0.91,
              droppedMessageCount: 2,
              compressionLevel: "compressed",
              cachedPrefixLength: 0,
            },
          },
        }),
      ],
      runEvents: [
        {
          runId: "run-1",
          ts: "2026-04-28T00:00:00.000Z",
          type: "verifier_rejected",
          role: "verifier",
          turn: 1,
          data: { reason: "missing evidence" },
        },
      ],
      logs: [
        {
          ts: "2026-04-28T00:00:00.000Z",
          lvl: "error",
          src: "agent",
          cat: "tool",
          msg: "Tool bridge failed",
          sid: "session-1",
          data: { turnNumber: 1 },
        },
      ],
    });

    expect(timeline).toHaveLength(1);
    expect(timeline[0].severity).toBe("error");
    expect(timeline[0].signals.map((signal) => signal.category)).toEqual(
      expect.arrayContaining([
        "tool_execution",
        "perception",
        "context",
        "verification",
        "trace_integrity",
      ]),
    );
    expect(timeline[0].signals.map((signal) => signal.target)).toEqual(
      expect.arrayContaining(["turns", "perception", "logs"]),
    );
  });
});

describe("trace fleet analysis", () => {
  test("clusters failed sessions by failure, domain, model, and skill", () => {
    const analysis = analyzeTraceFleet(
      [
        session({
          sessionId: "s1",
          startUrl: "https://shop.example.com/a",
          outcome: "error",
          failureCode: "tool_click_failed",
          models: ["model-a"],
          skillToolMetrics: {
            skillId: "checkout",
            rankingApplications: 1,
            totalSelections: 1,
            preferredSelections: 1,
            neutralSelections: 0,
            discouragedSelections: 0,
            preferredSelectionRate: 1,
            discouragedSelectionRate: 0,
          },
        }),
        session({
          sessionId: "s2",
          startUrl: "https://shop.example.com/b",
          outcome: "max_turns",
          failureCategory: "loop",
          models: ["model-a"],
          turnCount: 9,
          metrics: { totalCost: 0.2 } as any,
          skillToolMetrics: {
            skillId: "checkout",
            rankingApplications: 1,
            totalSelections: 1,
            preferredSelections: 0,
            neutralSelections: 1,
            discouragedSelections: 0,
            preferredSelectionRate: 0,
            discouragedSelectionRate: 0,
          },
        }),
        session({
          sessionId: "s3",
          startUrl: "https://docs.example.com",
          outcome: "completed",
          models: ["model-b"],
        }),
      ],
      3,
    );

    expect(analysis).toMatchObject({
      totalSessions: 3,
      failedSessions: 2,
    });
    expect(Math.round(analysis.successRate * 100)).toBe(33);
    expect(analysis.topFailureClusters.map((cluster) => cluster.label)).toEqual(
      expect.arrayContaining(["tool_click_failed", "loop"]),
    );
    expect(analysis.topDomainClusters[0]).toMatchObject({
      label: "shop.example.com",
      failedCount: 2,
      count: 2,
    });
    expect(analysis.topModelClusters[0]).toMatchObject({
      label: "model-a",
      failedCount: 2,
    });
    expect(analysis.topSkillClusters[0]).toMatchObject({
      label: "checkout",
      failedCount: 2,
    });
  });
});

describe("trace session comparison", () => {
  test("ranks same-run and related failure sessions for investigation", () => {
    const base = session({
      sessionId: "base",
      runId: "run-1",
      startUrl: "https://shop.example.com/cart",
      failureCode: "tool_click_failed",
      turnCount: 4,
      metrics: { totalCost: 0.1 } as any,
      models: ["model-a"],
      skillToolMetrics: {
        skillId: "checkout",
        rankingApplications: 1,
        totalSelections: 1,
        preferredSelections: 1,
        neutralSelections: 0,
        discouragedSelections: 0,
        preferredSelectionRate: 1,
        discouragedSelectionRate: 0,
      },
    });

    const result = compareTraceSessions(base, [
      base,
      session({
        sessionId: "same-run",
        runId: "run-1",
        query: "Objective: Buy a replacement charger",
        outcome: "completed",
        failureCode: "none",
        startUrl: "https://shop.example.com/checkout",
        turnCount: 5,
        metrics: { totalCost: 0.12 } as any,
        models: ["model-a"],
      }),
      session({
        sessionId: "same-failure",
        query: "Objective: Finish checkout",
        startUrl: "https://shop.example.com/payment",
        failureCode: "tool_click_failed",
        turnCount: 8,
        metrics: { totalCost: 0.2 } as any,
        models: ["model-b"],
      }),
      session({
        sessionId: "same-skill",
        query: "Use checkout flow",
        startUrl: "https://another.example.com",
        failureCode: "none",
        turnCount: 2,
        metrics: { totalCost: 0.04 } as any,
        skillToolMetrics: {
          skillId: "checkout",
          rankingApplications: 1,
          totalSelections: 1,
          preferredSelections: 1,
          neutralSelections: 0,
          discouragedSelections: 0,
          preferredSelectionRate: 1,
          discouragedSelectionRate: 0,
        },
      }),
      session({
        sessionId: "same-model",
        query: "Read docs",
        startUrl: "https://docs.example.com",
        outcome: "completed",
        failureCode: "none",
        models: ["model-a"],
      }),
      session({
        sessionId: "unrelated",
        query: "Unrelated run",
        startUrl: "https://docs.example.com",
        outcome: "completed",
        failureCode: "none",
        models: ["model-c"],
      }),
    ]);

    expect(result.baseSessionId).toBe("base");
    expect(
      result.comparisons.map((comparison) => comparison.sessionId),
    ).toEqual(["same-run", "same-failure", "same-skill", "same-model"]);
    expect(result.comparisons[0]).toMatchObject({
      relation: "same_run",
      label: "same run",
      turnDelta: 1,
    });
    expect(result.comparisons[1]).toMatchObject({
      relation: "same_failure",
      failureLabel: "tool_click_failed",
      domain: "shop.example.com",
      turnDelta: 4,
    });
    expect(result.comparisons[2]).toMatchObject({
      relation: "same_skill",
      sharedSkills: ["checkout"],
    });
    expect(result.comparisons[2].costDelta).toBeCloseTo(-0.06);
  });
});

describe("trace timeline diff", () => {
  test("identifies the first changed tool result between related sessions", () => {
    const baseSession = session({ sessionId: "base" });
    const candidateSession = session({
      sessionId: "candidate",
      outcome: "completed",
      failureCode: "none",
    });

    const result = compareTraceTimelines({
      baseSession,
      candidateSession,
      baseEntries: [
        entry({
          sessionId: "base",
          turnNumber: 1,
          snapshot: {
            url: "https://shop.example.com/cart",
            title: "Cart",
            elementCount: 2,
            visibleContentLength: 20,
            scrollY: 0,
          },
          llmResponse: {
            content: null,
            toolCalls: [
              {
                id: "tc-1",
                type: "function",
                function: { name: "click", arguments: "{}" },
              },
            ],
            finishReason: "tool_calls",
            usage: null,
            durationMs: 100,
          },
          toolExecutions: [
            {
              toolCallId: "tc-1",
              toolName: "click",
              args: {},
              result: "element detached",
              success: false,
              durationMs: 25,
              riskLevel: "low",
              error: "element detached",
            },
          ],
        }),
      ],
      candidateEntries: [
        entry({
          sessionId: "candidate",
          turnNumber: 1,
          snapshot: {
            url: "https://shop.example.com/cart",
            title: "Cart",
            elementCount: 2,
            visibleContentLength: 20,
            scrollY: 0,
          },
          llmResponse: {
            content: null,
            toolCalls: [
              {
                id: "tc-1",
                type: "function",
                function: { name: "click", arguments: "{}" },
              },
            ],
            finishReason: "tool_calls",
            usage: null,
            durationMs: 100,
          },
          toolExecutions: [
            {
              toolCallId: "tc-1",
              toolName: "click",
              args: {},
              result: "clicked",
              success: true,
              durationMs: 25,
              riskLevel: "low",
            },
          ],
        }),
      ],
    });

    expect(result.firstDivergenceTurn).toBe(1);
    expect(result.headline).toContain("First divergence at T1");
    expect(result.diffs[0]).toMatchObject({
      severity: "error",
      summary: "Tool result changed",
    });
    expect(result.diffs[0].signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "tool_execution",
          label: "Tool result changed",
          changed: true,
        }),
      ]),
    );
  });

  test("keeps shared failures as evidence without marking divergence", () => {
    const baseSession = session({ sessionId: "base" });
    const candidateSession = session({ sessionId: "candidate" });
    const failedTurn = {
      llmResponse: {
        content: null,
        toolCalls: [
          {
            id: "tc-1",
            type: "function",
            function: { name: "click", arguments: "{}" },
          },
        ],
        finishReason: "tool_calls",
        usage: null,
        durationMs: 100,
      },
      toolExecutions: [
        {
          toolCallId: "tc-1",
          toolName: "click" as const,
          args: {},
          result: "element detached",
          success: false,
          durationMs: 25,
          riskLevel: "low" as const,
          error: "element detached",
        },
      ],
    };

    const result = compareTraceTimelines({
      baseSession,
      candidateSession,
      baseEntries: [entry({ sessionId: "base", ...failedTurn })],
      candidateEntries: [entry({ sessionId: "candidate", ...failedTurn })],
    });

    expect(result.firstDivergenceTurn).toBeNull();
    expect(result.headline).toContain("No divergence found");
    expect(result.diffs[0].signals[0]).toMatchObject({
      label: "Shared tool failure",
      changed: false,
    });
  });
});
