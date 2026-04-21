import React from "react";
import { act } from "react";
import { beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import TraceDetailHeader from "../../src/trace-viewer/components/traces/TraceDetailHeader";
import { useStore } from "../../src/trace-viewer/store";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

describe("TraceDetailHeader", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  test("renders per-session skill policy metrics when present", async () => {
    useStore.setState({
      currentEntries: [],
    } as any);

    await act(async () => {
      root.render(
        <TraceDetailHeader
          session={
            {
              sessionId: "session-1",
              query: "Objective: clear overlays",
              startUrl: "https://example.com",
              outcome: "completed",
              startTime: 100,
              endTime: 300,
              turnCount: 2,
              summary: "done",
              metrics: { totalCost: 0.1 },
              skillToolMetrics: {
                skillId: "modal-overlay-recovery",
                rankingApplications: 2,
                totalSelections: 5,
                preferredSelections: 2,
                neutralSelections: 1,
                discouragedSelections: 2,
                preferredSelectionRate: 0.4,
                discouragedSelectionRate: 0.4,
              },
            } as any
          }
        />,
      );
    });

    expect(container.textContent).toContain("Skill Policy");
    expect(container.textContent).toContain("modal-overlay-recovery");
    expect(container.textContent).toContain("2 rankings");
    expect(container.textContent).toContain("5 picks");
    expect(container.textContent).toContain("Preferred");
    expect(container.textContent).toContain("40%");
    expect(container.textContent).toContain("Discouraged");
    expect(container.textContent).toContain("middle-path picks");
  });
});
