import React, { act } from "react";
import { beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";

import RunsTableView from "../../src/trace-viewer/components/traces/RunsTableView";
import { useStore } from "../../src/trace-viewer/store";
import { sessionNeedsReview } from "../../src/trace-viewer/utils";
import type { TraceSession } from "../../src/types/traces";
import type { RunAnnotation } from "../../src/trace-viewer/store/types";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

function sess(overrides: Partial<TraceSession>): TraceSession {
  return {
    sessionId: "s",
    startTime: 1,
    endTime: 2,
    query: "Objective: do a thing",
    startUrl: "https://x",
    outcome: "completed",
    turnCount: 1,
    summary: "",
    metrics: null,
    ...overrides,
  } as TraceSession;
}

const annotation: RunAnnotation = {
  id: "a1",
  sessionId: "err",
  annotatedAt: "2026-07-10T10:00:00Z",
  verdict: "disagree",
};

// The former Attention-inbox queue semantics, now a predicate + a Runs filter.
describe("sessionNeedsReview", () => {
  test("flags unreviewed failed/partial sessions, not completed ones", () => {
    expect(sessionNeedsReview(sess({ outcome: "error" }), {})).toBe(true);
    expect(sessionNeedsReview(sess({ outcome: "max_turns" }), {})).toBe(true);
    expect(sessionNeedsReview(sess({ outcome: "stopped" }), {})).toBe(true);
    expect(
      sessionNeedsReview(
        sess({ outcome: "completed", partialHandoff: {} as never }),
        {},
      ),
    ).toBe(true);
    expect(sessionNeedsReview(sess({ outcome: "completed" }), {})).toBe(false);
  });

  test("adjudicated sessions drop out of the queue", () => {
    const failed = sess({ sessionId: "err", outcome: "error" });
    expect(sessionNeedsReview(failed, { "session:err": annotation })).toBe(
      false,
    );
    const inRun = sess({ sessionId: "err", runId: "run-1", outcome: "error" });
    expect(sessionNeedsReview(inRun, { "run:run-1": annotation })).toBe(false);
    expect(sessionNeedsReview(inRun, {})).toBe(true);
  });
});

describe("RunsTableView needs-review chip filter", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  function render() {
    act(() => {
      root.render(<RunsTableView onSelectSession={() => {}} />);
    });
  }

  function seedSessions() {
    useStore.getState().setSessions([
      sess({
        sessionId: "ok",
        outcome: "completed",
        query: "Objective: succeeded run",
        startTime: 10,
      }),
      sess({
        sessionId: "err",
        outcome: "error",
        query: "Objective: broken run",
        startTime: 20,
      }),
      sess({
        sessionId: "cap",
        runId: "run-1",
        outcome: "max_turns",
        query: "Objective: ran out of turns",
        startTime: 30,
      }),
    ] as TraceSession[]);
  }

  test("chip off shows every run and standalone trace", () => {
    seedSessions();
    render();
    const text = container.textContent ?? "";
    expect(text).toContain("succeeded run");
    expect(text).toContain("broken run");
    expect(text).toContain("ran out of turns");
  });

  test("chip on narrows to the unreviewed failed/partial queue", () => {
    seedSessions();
    useStore.getState().setFilter("needsReview", "on");
    render();
    const text = container.textContent ?? "";
    expect(text).toContain("broken run");
    expect(text).toContain("ran out of turns");
    expect(text).not.toContain("succeeded run");
  });

  test("adjudicating a run drops it from the chip-filtered queue", () => {
    seedSessions();
    useStore.getState().setFilter("needsReview", "on");
    useStore.setState({
      annotations: { "run:run-1": annotation },
    });
    render();
    const text = container.textContent ?? "";
    expect(text).toContain("broken run");
    expect(text).not.toContain("ran out of turns");
  });

  test("all reviewed shows the caught-up empty state", () => {
    useStore.getState().setSessions([
      sess({
        sessionId: "err",
        outcome: "error",
        query: "Objective: broken run",
      }),
    ] as TraceSession[]);
    useStore.getState().setFilter("needsReview", "on");
    useStore.setState({
      annotations: { "session:err": annotation },
    });
    render();
    expect(container.textContent).toContain("All caught up");
  });
});
