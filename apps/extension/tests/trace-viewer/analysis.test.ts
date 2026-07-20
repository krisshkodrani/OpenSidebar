import { describe, expect, test } from "vitest";
import "../setup";
import {
  analyzeTraceSession,
  buildFrozenTraceBundle,
  buildTraceEvidenceTimeline,
  buildTraceInvestigationReport,
  compareTraceSessions,
  compareTraceTimelines,
  resolveEvidencePointer,
} from "../../src/trace-viewer/analysis";
import {
  validateFrozenTraceBundle,
  validateTraceBundle,
  validateTraceRecord,
} from "../../src/trace-viewer/analysis";
import { redactTracePayload } from "../../src/utils/trace-protection";
import type { TraceEntry, TraceSession } from "../../src/types/traces";
import type { RunTraceEvent } from "../../src/utils/run-trace";

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

function runEvent(
  type: string,
  data: Record<string, unknown> = {},
  index = 0,
): RunTraceEvent {
  return {
    schemaVersion: "2026-02-19",
    traceKind: "orchestrator.run.event",
    recordedAt: `2026-04-28T00:00:0${index}.000Z`,
    producer: "background.orchestrator.run-trace-writer",
    correlationId: "run-1",
    runId: "run-1",
    ts: `2026-04-28T00:00:0${index}.000Z`,
    type,
    role: "system",
    data,
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
      source: "deterministic",
      derivation: expect.stringContaining("success flag"),
    });
    expect(investigation.findings[0].evidence[0]).toMatchObject({
      resolved: true,
      resolutionStatus: "resolved",
    });
  });

  test("marks dangling evidence pointers instead of dropping them", () => {
    const pointer = resolveEvidencePointer(
      {
        kind: "tool",
        sessionId: "session-1",
        turnNumber: 99,
        toolCallId: "missing-tool",
        label: "Missing tool",
      },
      {
        session: session(),
        entries: [entry({ turnNumber: 1 })],
      },
    );

    expect(pointer).toMatchObject({
      resolved: false,
      resolutionStatus: "unresolved",
      resolutionDetail: expect.stringContaining("Turn 99"),
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

  test("attributes completion rejection to the authoritative completion_decision", () => {
    const investigation = analyzeTraceSession({
      session: session({ outcome: "max_turns" }),
      entries: [
        entry({
          turnNumber: 2,
          events: [
            {
              eventId: "session-1:turn:2:event:0",
              turnId: "session-1:turn:2",
              sessionId: "session-1",
              turnNumber: 2,
              type: "completion_decision",
              timestamp: 1,
              data: {
                turn: 2,
                status: "rejected",
                source: "model_done",
                reason: "form not submitted",
                contractKind: "form_submission",
                evidenceKeys: [],
              },
            },
            {
              eventId: "session-1:turn:2:event:1",
              turnId: "session-1:turn:2",
              sessionId: "session-1",
              turnNumber: 2,
              type: "done_rejected",
              timestamp: 2,
              data: { rejections: 1, reason: "form not submitted", advancedTo: 2 },
            },
          ],
        }),
      ],
    });

    const finding = investigation.findings.find(
      (candidate) => candidate.id === "done-rejection-loop",
    );
    expect(finding?.title).toBe(
      "Completion rejected by the form_submission contract",
    );
    expect(finding?.derivation).toContain("contractKind=form_submission");
    expect(finding?.derivation).toContain("source=model_done");
  });

  test("reports the accepting contract as an info finding", () => {
    const investigation = analyzeTraceSession({
      session: session({ outcome: "completed" }),
      entries: [
        entry({
          turnNumber: 3,
          events: [
            {
              eventId: "session-1:turn:3:event:0",
              turnId: "session-1:turn:3",
              sessionId: "session-1",
              turnNumber: 3,
              type: "completion_decision",
              timestamp: 1,
              data: {
                turn: 3,
                status: "accepted",
                source: "trusted_tool",
                reason: "navigation contract satisfied",
                contractKind: "navigation",
                evidenceKeys: ["navigation_reached:example.com"],
              },
            },
          ],
        }),
      ],
    });

    const finding = investigation.findings.find(
      (candidate) => candidate.id === "completion-accepted-attribution",
    );
    expect(finding?.severity).toBe("info");
    expect(finding?.title).toBe("Completion accepted via the navigation contract");
    expect(finding?.derivation).toContain("source=trusted_tool");
  });

  test("detects near-repeat tool loops within a five-turn window", () => {
    const investigation = analyzeTraceSession({
      session: session({ outcome: "max_turns" }),
      entries: [
        entry({
          turnNumber: 1,
          toolExecutions: [
            {
              toolCallId: "tc-1",
              toolName: "click_element",
              args: { id: 101 },
              result: "clicked",
              success: true,
              durationMs: 20,
              riskLevel: "low",
            },
          ],
        }),
        entry({
          turnNumber: 2,
          toolExecutions: [
            {
              toolCallId: "tc-2",
              toolName: "read_page",
              args: {},
              result: "same page",
              success: true,
              durationMs: 20,
              riskLevel: "low",
            },
          ],
        }),
        entry({
          turnNumber: 3,
          toolExecutions: [
            {
              toolCallId: "tc-3",
              toolName: "click_element",
              args: { id: 202 },
              result: "clicked",
              success: true,
              durationMs: 20,
              riskLevel: "low",
            },
          ],
        }),
      ],
    });

    expect(investigation.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "repeat-loop-t3",
          title: "Near repeated action loop",
          firstTurn: 3,
        }),
      ]),
    );
  });

  test("does not treat changed numeric non-id arguments as near repeats", () => {
    const investigation = analyzeTraceSession({
      session: session({ outcome: "max_turns" }),
      entries: [
        entry({
          turnNumber: 1,
          toolExecutions: [
            {
              toolCallId: "tc-1",
              toolName: "type_text",
              args: { id: 101, text: "100" },
              result: "typed",
              success: true,
              durationMs: 20,
              riskLevel: "low",
            },
          ],
        }),
        entry({
          turnNumber: 2,
          toolExecutions: [
            {
              toolCallId: "tc-2",
              toolName: "type_text",
              args: { id: 202, text: "200" },
              result: "typed",
              success: true,
              durationMs: 20,
              riskLevel: "low",
            },
          ],
        }),
      ],
    });

    expect(
      investigation.findings.some(
        (finding) => finding.id === "repeat-loop-t2",
      ),
    ).toBe(false);
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

  test("detects missing and out-of-order turn continuity issues", () => {
    const issues = validateTraceBundle({
      sessions: [session({ outcome: "completed", failureCode: "none" })],
      entriesBySession: new Map([
        [
          "session-1",
          [
            entry({ turnNumber: 1 }),
            entry({ turnNumber: 3 }),
            entry({ turnNumber: 2 }),
          ],
        ],
      ]),
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_turn_gap", turnNumber: 3 }),
        expect.objectContaining({ code: "out_of_order_turn", turnNumber: 2 }),
      ]),
    );
  });

  test("validates frozen trace bundle wrapper fields and core trace contents", () => {
    const issues = validateFrozenTraceBundle({
      schemaVersion: "2026-05-30",
      traceKind: "trace.viewer.frozen_bundle",
      frozenAt: "2026-05-30T12:00:00.000Z",
      session: session({ outcome: "completed", failureCode: "none" }),
      entries: [
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
      screenshots: [
        {
          sessionId: "session-1",
          turnNumber: 1,
          fileName: "session-1-T1.jpg",
          sha256: "abc",
        },
      ],
    });

    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  test("builds a frozen bundle with report, logs, run events, and screenshot references", () => {
    const bundle = buildFrozenTraceBundle({
      session: session({ outcome: "completed", failureCode: "none" }),
      entries: [
        entry({
          turnNumber: 1,
          perception: {
            interpretation: "page",
            model: "vision",
            durationMs: 1,
            cached: false,
            screenshotStatus: "captured",
            screenshotDataUrl: "data:image/jpeg;base64,abc",
          },
        }),
      ],
      runEvents: [runEvent("verifier_result", { status: "passed" }, 1)],
      logs: [
        {
          ts: "2026-04-28T00:00:00.000Z",
          lvl: "info",
          src: "agent",
          cat: "trace",
          msg: "loaded",
          sid: "session-1",
        },
      ],
    });

    expect(bundle).toMatchObject({
      schemaVersion: "2026-05-30",
      traceKind: "trace.viewer.frozen_bundle",
      session: expect.objectContaining({ sessionId: "session-1" }),
      entries: [expect.objectContaining({ turnNumber: 1 })],
      runEvents: [expect.objectContaining({ type: "verifier_result" })],
      logs: [expect.objectContaining({ msg: "loaded" })],
      screenshots: [
        expect.objectContaining({
          sessionId: "session-1",
          turnNumber: 1,
          fileName: "session-1-T1.jpg",
        }),
      ],
      report: expect.stringContaining("# Trace Investigation Context"),
    });
    expect(validateFrozenTraceBundle(bundle)).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ severity: "error" }),
      ]),
    );
  });

  test("detects parallel worker lifecycle and dependency integrity issues", () => {
    const issues = validateTraceBundle({
      sessions: [],
      entriesBySession: new Map(),
      runEventsByRun: new Map([
        [
          "run-1",
          [
            runEvent(
              "plan_decomposed",
              {
                graph: {
                  nodes: [
                    {
                      nodeId: "n1",
                      dependencies: [],
                    },
                    {
                      nodeId: "n2",
                      dependencies: ["n1"],
                    },
                    {
                      nodeId: "n3",
                      dependencies: [],
                    },
                  ],
                },
              },
              1,
            ),
            runEvent(
              "worker_started",
              {
                nodeId: "n2",
                workerId: "w2",
                assignedResources: [
                  { kind: "form", key: "checkout", access: "write" },
                ],
                activeWorkerCount: 1,
                resourceLocks: [
                  {
                    nodeId: "n2",
                    resources: [
                      { kind: "form", key: "checkout", access: "write" },
                    ],
                  },
                ],
              },
              2,
            ),
            runEvent(
              "worker_started",
              {
                nodeId: "n3",
                workerId: "w3",
                assignedResources: [
                  { kind: "url", key: "alpha", access: "read" },
                ],
                activeWorkerCount: 2,
                resourceLocks: [
                  {
                    nodeId: "n2",
                    resources: [
                      { kind: "form", key: "checkout", access: "write" },
                    ],
                  },
                  {
                    nodeId: "n3",
                    resources: [
                      { kind: "url", key: "alpha", access: "read" },
                    ],
                  },
                ],
              },
              3,
            ),
            runEvent(
              "node_completed",
              {
                nodeId: "n1",
                outcome: "completed",
                activeWorkerCount: 2,
                resourceLocks: [],
              },
              4,
            ),
            runEvent(
              "worker_released_resource",
              {
                nodeId: "n2",
                workerId: "w2",
                resources: [
                  { kind: "form", key: "checkout", access: "write" },
                ],
                activeWorkerCount: 1,
                resourceLocks: [
                  {
                    nodeId: "n3",
                    resources: [
                      { kind: "url", key: "alpha", access: "read" },
                    ],
                  },
                ],
              },
              5,
            ),
          ],
        ],
      ]),
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "dependency_started_before_complete",
        }),
        expect.objectContaining({ code: "missing_worker_finish" }),
        expect.objectContaining({ code: "orphan_resource_lock" }),
      ]),
    );
  });

  test("accepts balanced parallel worker lifecycle events", () => {
    const issues = validateTraceBundle({
      sessions: [],
      entriesBySession: new Map(),
      runEventsByRun: new Map([
        [
          "run-1",
          [
            runEvent(
              "plan_decomposed",
              {
                graph: {
                  nodes: [
                    { nodeId: "n1", dependencies: [] },
                    { nodeId: "n2", dependencies: ["n1"] },
                  ],
                },
              },
              1,
            ),
            runEvent(
              "worker_started",
              {
                nodeId: "n1",
                workerId: "w1",
                assignedResources: [
                  { kind: "url", key: "alpha", access: "read" },
                ],
                activeWorkerCount: 1,
                resourceLocks: [
                  {
                    nodeId: "n1",
                    resources: [
                      { kind: "url", key: "alpha", access: "read" },
                    ],
                  },
                ],
              },
              2,
            ),
            runEvent(
              "node_completed",
              {
                nodeId: "n1",
                outcome: "completed",
                activeWorkerCount: 0,
                resourceLocks: [],
              },
              3,
            ),
            runEvent(
              "worker_released_resource",
              {
                nodeId: "n1",
                workerId: "w1",
                resources: [
                  { kind: "url", key: "alpha", access: "read" },
                ],
                activeWorkerCount: 0,
                resourceLocks: [],
              },
              4,
            ),
            runEvent(
              "worker_started",
              {
                nodeId: "n2",
                workerId: "w2",
                assignedResources: [
                  { kind: "url", key: "beta", access: "read" },
                ],
                activeWorkerCount: 1,
                resourceLocks: [
                  {
                    nodeId: "n2",
                    resources: [
                      { kind: "url", key: "beta", access: "read" },
                    ],
                  },
                ],
              },
              5,
            ),
            runEvent(
              "worker_cancelled",
              {
                nodeId: "n2",
                workerId: "w2",
                activeWorkerCount: 1,
                resourceLocks: [
                  {
                    nodeId: "n2",
                    resources: [
                      { kind: "url", key: "beta", access: "read" },
                    ],
                  },
                ],
              },
              6,
            ),
            runEvent(
              "worker_released_resource",
              {
                nodeId: "n2",
                workerId: "w2",
                resources: [
                  { kind: "url", key: "beta", access: "read" },
                ],
                activeWorkerCount: 0,
                resourceLocks: [],
              },
              7,
            ),
          ],
        ],
      ]),
    });

    expect(
      issues.filter((issue) =>
        [
          "dependency_started_before_complete",
          "missing_worker_finish",
          "orphan_resource_lock",
          "worker_finish_without_start",
        ].includes(issue.code),
      ),
    ).toEqual([]);
  });

  test("warns when worker events omit parallel state snapshots", () => {
    const issues = validateTraceBundle({
      sessions: [],
      entriesBySession: new Map(),
      runEventsByRun: new Map([
        ["run-1", [runEvent("worker_queued", { nodeId: "n1" }, 1)]],
      ]),
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_parallel_active_worker_count",
        }),
        expect.objectContaining({ code: "missing_parallel_resource_locks" }),
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
        pageState: {
          preDecision: {
            screenshots: [{ kind: "viewport", dataUrl: "data:image/jpeg;base64,def" }],
          },
        },
      },
      { mode: "export" },
    );

    expect(redacted.content).toBe("Contact [REDACTED_EMAIL]");
    expect(redacted.screenshotDataUrl).toBe("[REDACTED_IMAGE_DATA_URL]");
    expect(redacted.pageState.preDecision.screenshots[0].dataUrl).toBe(
      "[REDACTED_IMAGE_DATA_URL]",
    );
  });
});

describe("trace investigation report", () => {
  const enrichedQuery = [
    "Objective: Complete the workflow for the original request:",
    "RECENT WORKSPACE CONVERSATION:",
    "- Assistant: long previous answer",
    "PROFILE DIGEST CONTEXT:",
    "- Fact: Email = jordan.rivera@example.com",
    "CURRENT REQUEST:",
    "Fill the profile",
    "Planner assumptions:",
    "- No explicit assumptions from planner.",
  ].join("\n");

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

  test("uses compact task labels in generated investigation context", () => {
    const report = buildTraceInvestigationReport({
      session: session({ query: enrichedQuery }),
      entries: [],
    });

    expect(report).toContain("Task: Fill the profile");
    expect(report).not.toContain("RECENT WORKSPACE CONVERSATION");
    expect(report).not.toContain("PROFILE DIGEST CONTEXT");
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

describe("trace session comparison", () => {
  const enrichedQuery = [
    "Objective: Complete the workflow for the original request:",
    "RECENT WORKSPACE CONVERSATION:",
    "- Assistant: long previous answer",
    "PROFILE DIGEST CONTEXT:",
    "- Fact: Email = jordan.rivera@example.com",
    "CURRENT REQUEST:",
    "Fill the profile",
    "Planner assumptions:",
    "- No explicit assumptions from planner.",
  ].join("\n");

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

  test("compacts enriched planner context in related trace titles", () => {
    const base = session({ sessionId: "base", runId: "run-1" });

    const result = compareTraceSessions(base, [
      base,
      session({
        sessionId: "same-run",
        runId: "run-1",
        query: enrichedQuery,
      }),
    ]);

    expect(result.comparisons[0]).toMatchObject({
      sessionId: "same-run",
      queryTitle: "Fill the profile",
    });
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
