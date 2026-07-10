import { describe, expect, test } from "vitest";
import "../setup";
import { buildRunStory } from "../../src/trace-viewer/analysis";
import type { RunTraceEvent } from "../../src/utils/run-trace";
import type { TraceEntry, TraceSession } from "../../src/types/traces";

// ── Fixtures ────────────────────────────────────────────────────

let seq = 0;
function ev(
  type: string,
  data: Record<string, unknown> = {},
  ts?: string,
): RunTraceEvent {
  seq += 1;
  return {
    runId: "run-1",
    ts: ts ?? new Date(Date.UTC(2026, 6, 10, 12, 0, seq)).toISOString(),
    type,
    data,
  };
}

function entry(turnNumber: number, timestamp: number): TraceEntry {
  return {
    sessionId: "s-1",
    turnNumber,
    timestamp,
    snapshot: { url: "x", title: "x", elementCount: 0, visibleContentLength: 0, scrollY: 0 },
    elements: [],
    llmRequest: { model: "m", messageCount: 1, toolCount: 0, compressionLevel: "none" },
    llmResponse: { content: null, toolCalls: [], finishReason: "stop", usage: null, durationMs: 1 },
    toolExecutions: [],
    events: [],
    progressState: { stagnantTurns: 0, signal: null },
  } as TraceEntry;
}

function session(overrides: Partial<TraceSession> = {}): TraceSession {
  return {
    sessionId: "s-1",
    startTime: 0,
    endTime: 100,
    query: "Order a developer laptop and confirm the request",
    startUrl: "https://example.com",
    outcome: "completed",
    turnCount: 3,
    summary: "done",
    metrics: null,
    ...overrides,
  };
}

// A run with a two-node plan, a judge accept on node-1 and a judge reroute on
// node-2 that reroutes to node-3, plus some system + unknown events.
function multiNodeEvents(): RunTraceEvent[] {
  seq = 0;
  return [
    ev("task_started"),
    ev("plan_decomposed", {
      nodeCount: 2,
      structured: true,
      difficulty: "moderate",
      graph: {
        nodes: [
          { nodeId: "node-1", index: 0, dependencies: [] },
          { nodeId: "node-2", index: 1, dependencies: ["node-1"] },
        ],
      },
    }),
    ev("plan_confirmation", { decision: "approve", hasFeedback: false }),
    ev("worker_created", { workerId: "w1" }),
    ev("node_started", { nodeId: "node-1" }),
    ev("node_completed", { nodeId: "node-1", outcome: "completed", summary: "Opened catalog", durationMs: 4200 }),
    ev("node_verified", { nodeId: "node-1", decision: "accept", confidence: 0.9 }),
    ev("judge_call", {
      nodeId: "node-1",
      decision: "accept",
      judged: true,
      verdictSource: "judge",
      model: "gpt-oss-120b",
      providerId: "fireworks",
      confidence: 0.95,
      criteria: [{ id: "c1", description: "Catalog opened", required: true }],
      perCriterion: [{ id: "c1", pass: true, rationale: "evidence shows catalog" }],
      entailment: [],
      usage: { promptTokens: 400, completionTokens: 60, totalTokens: 460, costUsd: 0.0004 },
    }),
    ev("node_started", { nodeId: "node-2" }),
    ev("escalation_requested", { reason: "ambiguous option" }),
    ev("judge_call", {
      nodeId: "node-2",
      decision: "reroute",
      judged: true,
      verdictSource: "judge",
      model: "gpt-oss-120b",
      confidence: 0.7,
      criteria: [{ id: "c1", description: "Request submitted", required: true }],
      perCriterion: [{ id: "c1", pass: false, rationale: "no REQ number found" }],
      entailment: [{ claimKey: "fact:x", label: "contradicted" }],
      usage: { promptTokens: 500, completionTokens: 80, totalTokens: 580 },
    }),
    ev("node_started", { nodeId: "node-3" }),
    ev("node_completed", { nodeId: "node-3", outcome: "completed", summary: "Submitted request REQ0012345" }),
    ev("mystery_event", { foo: 1 }),
    ev("task_completed", { outcome: "completed" }),
  ];
}

// ── Tests ───────────────────────────────────────────────────────

describe("buildRunStory", () => {
  test("builds plan summary + node segments in plan order with judge calls", () => {
    const story = buildRunStory(multiNodeEvents(), [], session());
    expect(story.hasRunEvents).toBe(true);
    expect(story.plan.present).toBe(true);
    expect(story.plan.nodeCount).toBe(2);
    expect(story.plan.confirmed).toBe(true);
    expect(story.plan.difficulty).toBe("moderate");

    expect(story.segments.map((s) => s.nodeId)).toEqual([
      "node-1",
      "node-2",
      "node-3",
    ]);
    // Titles come from the session decomposition index; here they fall back to
    // node id since no planDecomposition was supplied.
    const n1 = story.segments[0];
    expect(n1.status).toBe("completed");
    expect(n1.summary).toBe("Opened catalog");
    expect(n1.durationMs).toBe(4200);
    expect(n1.verification?.decision).toBe("accept");
    expect(n1.judgeCalls).toHaveLength(1);
    expect(n1.judgeCalls[0].decision).toBe("accept");
    expect(n1.judgeCalls[0].usage?.costUsd).toBe(0.0004);
  });

  test("marks a judge reroute and wires the successor node", () => {
    const story = buildRunStory(multiNodeEvents(), [], session());
    const n2 = story.segments.find((s) => s.nodeId === "node-2")!;
    expect(n2.status).toBe("rerouted");
    expect(n2.reroutedTo).toBe("node-3");
    expect(n2.judgeCalls[0].perCriterion[0].pass).toBe(false);
    expect(n2.judgeCalls[0].entailment[0].label).toBe("contradicted");
  });

  test("routes escalation to its segment, worker events to system, unknowns to a bucket", () => {
    const story = buildRunStory(multiNodeEvents(), [], session());
    const n2 = story.segments.find((s) => s.nodeId === "node-2")!;
    expect(n2.markers.some((m) => m.kind === "escalation_requested")).toBe(true);
    expect(story.systemEvents.some((m) => m.kind === "worker_created")).toBe(true);
    expect(story.unknownEvents).toContainEqual({ type: "mystery_event", count: 1 });
    expect(story.completion.markers.some((m) => m.kind === "task_completed")).toBe(true);
  });

  test("uses session plan decomposition for segment titles", () => {
    const s = session({
      planDecomposition: {
        subtasks: ["Open the catalog", "Submit the request"],
        steps: [
          { objective: "Open the developer laptop catalog", successCriteria: "catalog visible", dependencies: [], assumptions: [] },
          { objective: "Configure and submit the request", successCriteria: "REQ created", dependencies: [0], assumptions: [] },
        ],
      },
    });
    const story = buildRunStory(multiNodeEvents(), [], s);
    expect(story.segments[0].title).toBe("Open the developer laptop catalog");
    expect(story.segments[1].title).toBe("Configure and submit the request");
  });

  test("assigns turns to segments by timestamp interval", () => {
    // Entry timestamps share the event ts scale (epoch ms). node-1 spans
    // [.100, .200]; node-2 starts at .300 (open-ended). Turn 1 falls inside
    // node-1, turn 2 after node-2 started.
    const t = (ms: number) => Date.UTC(2026, 6, 10, 0, 0, 0, ms);
    const events: RunTraceEvent[] = [
      ev("node_started", { nodeId: "node-1" }, new Date(t(100)).toISOString()),
      ev("node_completed", { nodeId: "node-1", outcome: "completed" }, new Date(t(200)).toISOString()),
      ev("node_started", { nodeId: "node-2" }, new Date(t(300)).toISOString()),
    ];
    const entries = [entry(1, t(150)), entry(2, t(350))];
    const story = buildRunStory(events, entries, session());
    const n1 = story.segments.find((s) => s.nodeId === "node-1")!;
    const n2 = story.segments.find((s) => s.nodeId === "node-2")!;
    expect(n1.turns.map((t) => t.turnNumber)).toEqual([1]);
    expect(n2.turns.map((t) => t.turnNumber)).toEqual([2]);
  });

  test("no-plan run with turns → one synthetic root segment covering all turns", () => {
    const story = buildRunStory([], [entry(1, 10), entry(2, 20)], session({ outcome: "error" }));
    expect(story.hasRunEvents).toBe(false);
    expect(story.segments).toHaveLength(1);
    expect(story.segments[0].synthetic).toBe(true);
    expect(story.segments[0].status).toBe("failed");
    expect(story.segments[0].turns.map((t) => t.turnNumber)).toEqual([1, 2]);
  });

  test("zero events and zero turns → empty story, no crash", () => {
    const story = buildRunStory([], [], session());
    expect(story.segments).toHaveLength(0);
    expect(story.looseTurns).toHaveLength(0);
    expect(story.hasRunEvents).toBe(false);
  });

  test("tolerates unordered timestamps (sorts chronologically)", () => {
    const events: RunTraceEvent[] = [
      ev("node_completed", { nodeId: "node-1", outcome: "completed" }, "2026-07-10T00:00:02.000Z"),
      ev("node_started", { nodeId: "node-1" }, "2026-07-10T00:00:01.000Z"),
    ];
    const story = buildRunStory(events, [], session());
    const n1 = story.segments[0];
    expect(n1.startedAt).toBe("2026-07-10T00:00:01.000Z");
    expect(n1.completedAt).toBe("2026-07-10T00:00:02.000Z");
    expect(n1.status).toBe("completed");
  });

  test("judge_call with no started node is not dropped (attaches or preludes)", () => {
    const story = buildRunStory(
      [ev("judge_call", { decision: "accept", criteria: [], perCriterion: [], entailment: [] })],
      [],
      session(),
    );
    // No segment exists → surfaced as a prelude marker rather than lost.
    expect(story.preludeMarkers.some((m) => m.kind === "judge_call")).toBe(true);
  });
});
