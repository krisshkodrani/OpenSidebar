import React, { act } from "react";
import { beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";

import StoryTab from "../../src/trace-viewer/components/traces/story/StoryTab";
import { useStore } from "../../src/trace-viewer/store";
import type { RunTraceEvent } from "../../src/utils/run-trace";
import type { TraceEntry, TraceSession } from "../../src/types/traces";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

function session(overrides: Partial<TraceSession> = {}): TraceSession {
  return {
    sessionId: "s1",
    startTime: 0,
    endTime: 100,
    query: "Order a laptop",
    startUrl: "https://x",
    outcome: "completed",
    turnCount: 1,
    summary: "ok",
    metrics: null,
    ...overrides,
  };
}

let n = 0;
function ev(type: string, data: Record<string, unknown> = {}): RunTraceEvent {
  n += 1;
  return {
    runId: "r1",
    ts: new Date(Date.UTC(2026, 6, 10, 0, 0, n)).toISOString(),
    type,
    data,
  };
}

function entry(turnNumber: number): TraceEntry {
  return {
    sessionId: "s1",
    turnNumber,
    timestamp: Date.UTC(2026, 6, 10, 0, 0, 30),
    snapshot: { url: "x", title: "x", elementCount: 0, visibleContentLength: 0, scrollY: 0 },
    pageState: {
      preDecision: {
        url: "x",
        title: "x",
        elementCount: 0,
        scrollY: 0,
        screenshots: [{ kind: "viewport", dataUrl: "data:image/png;base64,AAAA" }],
      },
    },
    elements: [],
    llmRequest: { model: "m", messageCount: 1, toolCount: 0, compressionLevel: "none" },
    llmResponse: { content: null, toolCalls: [], finishReason: "stop", usage: null, durationMs: 1 },
    toolExecutions: [],
    events: [],
    progressState: { stagnantTurns: 0, signal: null },
  } as TraceEntry;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  n = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

function render(s: TraceSession) {
  act(() => {
    root.render(<StoryTab session={s} />);
  });
}

describe("StoryTab", () => {
  test("renders plan, node segments, and a judge ruling from run events", () => {
    useStore.setState({
      currentEntries: [entry(1)],
      currentRunEvents: [
        ev("plan_decomposed", { nodeCount: 1, structured: true }),
        ev("node_started", { nodeId: "node-1" }),
        ev("node_completed", { nodeId: "node-1", outcome: "completed", summary: "Opened catalog" }),
        ev("judge_call", {
          nodeId: "node-1",
          decision: "accept",
          judged: true,
          verdictSource: "judge",
          model: "gpt-oss-120b",
          confidence: 0.95,
          criteria: [{ id: "c1", description: "Catalog opened", required: true }],
          perCriterion: [{ id: "c1", pass: true, rationale: "catalog visible" }],
          entailment: [],
          usage: { promptTokens: 400, completionTokens: 60, totalTokens: 460, costUsd: 0.0004 },
        }),
        ev("task_completed", { outcome: "completed" }),
      ],
    });
    render(session());
    const text = container.textContent ?? "";
    expect(text).toContain("Plan");
    expect(text).toContain("Opened catalog");
    expect(text).toContain("Judge");
    expect(text).toContain("gpt-oss-120b");
    expect(text).toContain("Catalog opened"); // criterion description joined
    expect(text).toContain("catalog visible"); // rationale
  });

  test("degrades to a turns-only story with no run events (no crash)", () => {
    useStore.setState({
      currentEntries: [entry(1)],
      currentRunEvents: [],
    });
    render(session());
    const text = container.textContent ?? "";
    expect(text).toContain("No orchestrator run events");
  });

  test("hides worker events behind the system drawer until expanded", () => {
    useStore.setState({
      currentEntries: [],
      currentRunEvents: [
        ev("node_started", { nodeId: "node-1" }),
        ev("worker_created", { workerId: "w" }),
      ],
    });
    render(session());
    const text = container.textContent ?? "";
    expect(text).toContain("System events");
    // Collapsed by default — the worker row is not shown yet.
    expect(text).not.toContain("worker created");
  });
});
