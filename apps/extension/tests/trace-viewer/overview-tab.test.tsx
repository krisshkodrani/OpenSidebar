import React, { act } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";

// Isolate the Plan Progress logic from the heavier diagnostic panels.
vi.mock("../../src/trace-viewer/components/traces/InvestigationSummary", () => ({
  default: () => <div>InvestigationSummary</div>,
}));
vi.mock("../../src/trace-viewer/components/traces/EvidenceTimeline", () => ({
  default: () => <div>EvidenceTimeline</div>,
}));
vi.mock(
  "../../src/trace-viewer/components/traces/SessionComparisonPanel",
  () => ({ default: () => <div>SessionComparisonPanel</div> }),
);
vi.mock("../../src/trace-viewer/components/traces/TimelineDiffPanel", () => ({
  default: () => <div>TimelineDiffPanel</div>,
}));

import OverviewTab from "../../src/trace-viewer/components/traces/OverviewTab";
import { useStore } from "../../src/trace-viewer/store";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

function planMonitor(stepIndex: number, alignment: string) {
  return { type: "plan_monitor", data: { stepIndex, alignment } };
}

const threeStepPlan = {
  steps: [
    { objective: "Open the dashboard", dependencies: [] },
    { objective: "Filter by region", dependencies: [0] },
    { objective: "Export the report", dependencies: [1] },
  ],
  subtasks: [],
};

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "s1",
    startTime: 1000,
    endTime: 5000,
    query: "Objective: export the regional report",
    startUrl: "https://app.example.com",
    outcome: "completed",
    turnCount: 6,
    summary: "done",
    metrics: { totalCost: 0.01, totalTokens: 1200 },
    planDecomposition: threeStepPlan,
    ...overrides,
  } as any;
}

describe("OverviewTab Plan Progress", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  async function render(session: any) {
    await act(async () => {
      root.render(<OverviewTab session={session} />);
    });
  }

  test("derives completion from plan_monitor events, not dependency order", async () => {
    useStore.setState({
      currentEntries: [
        { turnNumber: 1, events: [planMonitor(0, "aligned")] },
        { turnNumber: 2, events: [planMonitor(1, "progressing")] },
      ],
    } as any);

    await render(baseSession());

    // Step 0 aligned -> completed, step 1 progressing -> in-progress, step 2 pending.
    expect(container.textContent).toContain("1/3 steps");
    // The listed steps are the same ones the count is derived from (#3).
    expect(container.textContent).toContain("Open the dashboard");
    expect(container.textContent).toContain("Filter by region");
    expect(container.textContent).toContain("Export the report");
  });

  test("does not report a full bar for a stalled trace with no progress events", async () => {
    // Regression: the old dependency-ordering heuristic marked nearly every step
    // "completed", so a max_turns trace showed ~100% directly under a red badge.
    useStore.setState({ currentEntries: [] } as any);

    await render(baseSession({ outcome: "max_turns" }));

    expect(container.textContent).toContain("0/3 steps");
    expect(container.textContent).not.toContain("3/3 steps");
  });

  test("renders $0 rather than a blank gap for a zero-cost trace", async () => {
    useStore.setState({ currentEntries: [] } as any);

    await render(baseSession({ metrics: { totalCost: 0, totalTokens: 0 } }));

    expect(container.textContent).toContain("$0");
  });
});
