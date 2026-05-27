import React from "react";
import { act } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import FleetOverview from "../../src/trace-viewer/components/traces/FleetOverview";
import { useStore } from "../../src/trace-viewer/store";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

describe("FleetOverview", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  test("renders compact summary stats and clears filters", async () => {
    useStore.setState({
      sessions: [
        {
          sessionId: "s1",
          startTime: Date.UTC(2026, 3, 15),
          endTime: 300,
          query: "Objective: one",
          startUrl: "https://app.example.com/a",
          outcome: "completed",
          turnCount: 2,
          summary: "done",
          metrics: { totalCost: 0.1 },
        },
        {
          sessionId: "s2",
          startTime: Date.UTC(2026, 3, 15),
          endTime: 700,
          query: "Objective: two",
          startUrl: "https://app.example.com/b",
          outcome: "error",
          turnCount: 4,
          summary: "failed",
          metrics: { totalCost: 0.3 },
        },
      ],
      runGroups: [
        {
          runId: "run-1",
          shortId: "run-1",
          sessions: [],
          totalTurns: 6,
          totalCost: 0.4,
          earliestStart: 100,
          latestEnd: 700,
          overallOutcome: "error",
          query: "Objective: one",
          expanded: false,
        },
      ],
    } as any);
    useStore.getState().setFilter("outcome", "error");

    const onFiltersChanged = vi.fn();
    await act(async () => {
      root.render(<FleetOverview onFiltersChanged={onFiltersChanged} />);
    });

    expect(container.textContent).toContain("Summary");
    expect(container.textContent).toContain("Traces:");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("Runs:");
    expect(container.textContent).toContain("Success:");
    expect(container.textContent).toContain("50%");
    expect(container.textContent).toContain("Avg turns:");
    expect(container.textContent).toContain("3.0");
    expect(container.textContent).toContain("$0.400");

    const clearButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Clear filters"),
    );
    expect(clearButton).toBeTruthy();

    await act(async () => {
      clearButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useStore.getState().filters.outcome).toBe("all");
    expect(onFiltersChanged).toHaveBeenCalled();
  });
});
