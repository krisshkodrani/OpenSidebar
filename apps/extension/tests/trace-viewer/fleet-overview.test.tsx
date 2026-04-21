import React from "react";
import { act } from "react";
import { beforeEach, describe, expect, test } from "vitest";
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

  test("renders rollups and applies an operational lens", async () => {
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
          metrics: { totalCost: 0.1, modelBreakdown: { "openai/gpt-5.4-mini:nitro": { calls: 2 } } },
          skillToolMetrics: {
            skillId: "structured-form-fill",
            rankingApplications: 2,
            totalSelections: 5,
            preferredSelections: 5,
            neutralSelections: 0,
            discouragedSelections: 0,
            preferredSelectionRate: 1,
            discouragedSelectionRate: 0,
          },
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
          metrics: { totalCost: 0.3, modelBreakdown: { "openai/gpt-5.4": { calls: 4 } } },
          skillToolMetrics: {
            skillId: "modal-overlay-recovery",
            rankingApplications: 1,
            totalSelections: 5,
            preferredSelections: 1,
            neutralSelections: 0,
            discouragedSelections: 4,
            preferredSelectionRate: 0.2,
            discouragedSelectionRate: 0.8,
          },
        },
        {
          sessionId: "s3",
          startTime: Date.UTC(2026, 3, 16),
          endTime: 900,
          query: "Objective: three",
          startUrl: "https://app.example.com/c",
          outcome: "completed",
          turnCount: 3,
          summary: "done",
          metrics: { totalCost: 0.2, modelBreakdown: { "openai/gpt-5.4-mini:nitro": { calls: 3 } } },
          skillToolMetrics: {
            skillId: "modal-overlay-recovery",
            rankingApplications: 1,
            totalSelections: 5,
            preferredSelections: 1,
            neutralSelections: 0,
            discouragedSelections: 4,
            preferredSelectionRate: 0.2,
            discouragedSelectionRate: 0.8,
          },
        },
        {
          sessionId: "s0",
          startTime: Date.UTC(2026, 3, 2),
          endTime: 280,
          query: "Objective: zero",
          startUrl: "https://app.example.com/z",
          outcome: "completed",
          turnCount: 2,
          summary: "done",
          metrics: { totalCost: 0.1, modelBreakdown: { "openai/gpt-5.4": { calls: 2 } } },
          skillToolMetrics: {
            skillId: "modal-overlay-recovery",
            rankingApplications: 1,
            totalSelections: 5,
            preferredSelections: 4,
            neutralSelections: 0,
            discouragedSelections: 1,
            preferredSelectionRate: 0.8,
            discouragedSelectionRate: 0.2,
          },
        },
        {
          sessionId: "s00",
          startTime: Date.UTC(2026, 3, 3),
          endTime: 260,
          query: "Objective: zero-zero",
          startUrl: "https://app.example.com/y",
          outcome: "completed",
          turnCount: 2,
          summary: "done",
          metrics: { totalCost: 0.1, modelBreakdown: { "openai/gpt-5.4": { calls: 2 } } },
          skillToolMetrics: {
            skillId: "modal-overlay-recovery",
            rankingApplications: 1,
            totalSelections: 5,
            preferredSelections: 4,
            neutralSelections: 0,
            discouragedSelections: 1,
            preferredSelectionRate: 0.8,
            discouragedSelectionRate: 0.2,
          },
        },
        {
          sessionId: "s-old-low",
          startTime: Date.UTC(2026, 3, 4),
          endTime: 250,
          query: "Objective: old low",
          startUrl: "https://app.example.com/low-old",
          outcome: "completed",
          turnCount: 1,
          summary: "done",
          metrics: { totalCost: 0.05, modelBreakdown: { "openai/gpt-5.4": { calls: 1 } } },
          skillToolMetrics: {
            skillId: "hover-reveal-navigation",
            rankingApplications: 1,
            totalSelections: 2,
            preferredSelections: 2,
            neutralSelections: 0,
            discouragedSelections: 0,
            preferredSelectionRate: 1,
            discouragedSelectionRate: 0,
          },
        },
        {
          sessionId: "s-new-low",
          startTime: Date.UTC(2026, 3, 16),
          endTime: 350,
          query: "Objective: new low",
          startUrl: "https://app.example.com/low-new",
          outcome: "completed",
          turnCount: 1,
          summary: "done",
          metrics: { totalCost: 0.05, modelBreakdown: { "openai/gpt-5.4-mini:nitro": { calls: 1 } } },
          skillToolMetrics: {
            skillId: "hover-reveal-navigation",
            rankingApplications: 1,
            totalSelections: 2,
            preferredSelections: 1,
            neutralSelections: 0,
            discouragedSelections: 1,
            preferredSelectionRate: 0.5,
            discouragedSelectionRate: 0.5,
          },
        },
      ],
      runGroups: [{ runId: "run-1", shortId: "run-1", sessions: [], totalTurns: 15, totalCost: 0.9, earliestStart: 100, latestEnd: 900, overallOutcome: "error", query: "Objective: one", expanded: false }],
    } as any);

    const onFiltersChanged = () => {};
    await act(async () => {
      root.render(<FleetOverview onFiltersChanged={onFiltersChanged} />);
    });

    expect(container.textContent).toContain("Success Rate");
    expect(container.textContent).toContain("50%");
    expect(container.textContent).toContain("Failure Hotspots");
    expect(container.textContent).toContain("app.example.com");
    expect(container.textContent).toContain("Skill Policy");
    expect(container.textContent).toContain("Guided sessions");
    expect(container.textContent).toContain("7");
    expect(container.textContent).toContain("Preferred picks");
    expect(container.textContent).toContain("62%");
    expect(container.textContent).toContain("Discouraged picks");
    expect(container.textContent).toContain("38%");
    expect(container.textContent).toContain("Watchlist");
    expect(container.textContent).toContain("critical");
    expect(container.textContent).toContain("modal-overlay-recovery");
    expect(container.textContent).toContain("High discouraged-tool selection rate");
    expect(container.textContent).toContain("Vs Prev 7d");
    expect(container.textContent).toContain("worse");
    expect(container.textContent).toContain("low-signal");
    expect(container.textContent).toContain("new");
    expect(container.textContent).toContain("Last 7d preferred 20%");
    expect(container.textContent).toContain("Prev 7d preferred 80%");
    expect(container.textContent).toContain("Active only in Last 7d");
    expect(container.textContent).toContain("Low signal.");
    expect(container.textContent).toContain("Regression Watch");
    expect(container.textContent).toContain("Last 7d");

    const failuresButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Failures"),
    );
    expect(failuresButton).toBeTruthy();

    await act(async () => {
      failuresButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useStore.getState().filters.outcome).toBe("error");
    expect(useStore.getState().filters.mode).toBe("all");
    expect(useStore.getState().filters.tier).toBe("all");
  });
});
