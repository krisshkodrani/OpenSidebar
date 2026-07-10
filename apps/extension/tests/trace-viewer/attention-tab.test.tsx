import React, { act } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";

// The ratchet fetch is a network call — stub it so the queue logic is isolated.
vi.mock("../../src/trace-viewer/api", () => ({
  fetchHarnessRatchet: vi.fn(async () => []),
}));

import AttentionTab from "../../src/trace-viewer/components/traces/AttentionTab";
import { useStore } from "../../src/trace-viewer/store";
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
  };
}

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
    root.render(<AttentionTab onSelectSession={() => {}} />);
  });
}

describe("AttentionTab queue", () => {
  test("queues unreviewed failed/partial runs and excludes completed ones", () => {
    useStore.setState({
      sessions: [
        sess({ sessionId: "ok", outcome: "completed", query: "Objective: succeeded run" }),
        sess({ sessionId: "err", outcome: "error", query: "Objective: broken run" }),
        sess({ sessionId: "cap", outcome: "max_turns", query: "Objective: ran out of turns" }),
      ],
    });
    render();
    const text = container.textContent ?? "";
    expect(text).toContain("2 queued");
    expect(text).toContain("broken run");
    expect(text).toContain("ran out of turns");
    expect(text).not.toContain("succeeded run");
  });

  test("adjudicated runs drop out of the queue", () => {
    const annotation: RunAnnotation = {
      id: "a1",
      sessionId: "err",
      annotatedAt: "2026-07-10T10:00:00Z",
      verdict: "disagree",
    };
    useStore.setState({
      sessions: [sess({ sessionId: "err", outcome: "error", query: "Objective: broken run" })],
      annotations: { "session:err": annotation },
    });
    render();
    const text = container.textContent ?? "";
    expect(text).toContain("0 queued");
    expect(text).toContain("All caught up");
  });
});
