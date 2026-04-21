import { beforeEach, describe, expect, test } from "vitest";
import "../setup";
import { useStore } from "../../src/trace-viewer/store";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

describe("trace-viewer store", () => {
  beforeEach(() => {
    resetStore();
  });

  test("setSessions computes run groups with aggregate totals and worst outcome", () => {
    useStore.getState().setSessions([
      {
        sessionId: "s1",
        runId: "run-1",
        startTime: 100,
        endTime: 160,
        query: "First query",
        startUrl: "https://example.com/a",
        outcome: "completed",
        turnCount: 3,
        summary: "done",
        metrics: { totalCost: 0.1 },
      },
      {
        sessionId: "s2",
        runId: "run-1",
        startTime: 170,
        endTime: 260,
        query: "Second query",
        startUrl: "https://example.com/b",
        outcome: "error",
        turnCount: 5,
        summary: "failed",
        metrics: { totalCost: 0.2 },
      },
      {
        sessionId: "s3",
        runId: "run-2",
        startTime: 300,
        endTime: 320,
        query: "Third query",
        startUrl: "https://example.com/c",
        outcome: "completed",
        turnCount: 1,
        summary: "done",
        metrics: { totalCost: 0.05 },
      },
    ] as any);

    const runGroups = useStore.getState().runGroups;
    expect(runGroups).toHaveLength(2);
    expect(runGroups[0]).toMatchObject({
      runId: "run-2",
      totalTurns: 1,
      totalCost: 0.05,
      overallOutcome: "completed",
      query: "Third query",
    });
    expect(runGroups[1]).toMatchObject({
      runId: "run-1",
      totalTurns: 8,
      totalCost: 0.30000000000000004,
      overallOutcome: "error",
      earliestStart: 100,
      latestEnd: 260,
      query: "First query",
    });
  });

  test("setSessions preserves expanded state for existing run groups", () => {
    useStore.getState().setSessions([
      {
        sessionId: "s1",
        runId: "run-1",
        startTime: 100,
        endTime: 160,
        query: "First query",
        startUrl: "https://example.com/a",
        outcome: "completed",
        turnCount: 3,
        summary: "done",
        metrics: null,
      },
      {
        sessionId: "s2",
        runId: "run-1",
        startTime: 170,
        endTime: 260,
        query: "Second query",
        startUrl: "https://example.com/b",
        outcome: "completed",
        turnCount: 5,
        summary: "done",
        metrics: null,
      },
    ] as any);

    useStore.getState().toggleRunGroup("run-1");
    expect(useStore.getState().runGroups[0].expanded).toBe(true);

    useStore.getState().setSessions([
      {
        sessionId: "s1",
        runId: "run-1",
        startTime: 100,
        endTime: 160,
        query: "First query",
        startUrl: "https://example.com/a",
        outcome: "completed",
        turnCount: 3,
        summary: "done",
        metrics: null,
      },
      {
        sessionId: "s2",
        runId: "run-1",
        startTime: 170,
        endTime: 260,
        query: "Second query",
        startUrl: "https://example.com/b",
        outcome: "completed",
        turnCount: 5,
        summary: "done",
        metrics: null,
      },
      {
        sessionId: "s3",
        runId: "run-2",
        startTime: 300,
        endTime: 320,
        query: "Third query",
        startUrl: "https://example.com/c",
        outcome: "completed",
        turnCount: 1,
        summary: "done",
        metrics: null,
      },
    ] as any);

    const runOne = useStore.getState().runGroups.find((g) => g.runId === "run-1");
    expect(runOne?.expanded).toBe(true);
  });

  test("navigateToTurn and navigateToPerception switch subviews and focus turn", () => {
    useStore.getState().navigateToTurn(7);
    expect(useStore.getState().activeSubview).toBe("turns");
    expect(useStore.getState().focusTurnNumber).toBe(7);

    useStore.getState().navigateToPerception(4);
    expect(useStore.getState().activeSubview).toBe("perception");
    expect(useStore.getState().focusTurnNumber).toBe(4);
  });

  test("trace list mode defaults to runs and can be toggled", () => {
    expect(useStore.getState().traceListMode).toBe("runs");

    useStore.getState().setTraceListMode("sessions");
    expect(useStore.getState().traceListMode).toBe("sessions");
  });

  test("compare selection is capped at two sessions and drives compare mode", () => {
    useStore.getState().toggleCompareSession("s1");
    useStore.getState().toggleCompareSession("s2");
    expect(useStore.getState().compareSessionIds).toEqual(["s1", "s2"]);

    useStore.getState().setCompareViewActive(true);
    expect(useStore.getState().compareViewActive).toBe(true);

    useStore.getState().toggleCompareSession("s3");
    expect(useStore.getState().compareSessionIds).toEqual(["s2", "s3"]);
    expect(useStore.getState().compareViewActive).toBe(false);

    useStore.getState().clearCompareSessions();
    expect(useStore.getState().compareSessionIds).toEqual([]);
    expect(useStore.getState().compareViewActive).toBe(false);
  });

  test("saved views can be created, applied, and deleted", () => {
    useStore.getState().setFilter("outcome", "error");
    useStore.getState().setFilter("tier", "planner");
    useStore.getState().saveCurrentView();

    expect(useStore.getState().savedViews).toHaveLength(1);
    expect(useStore.getState().savedViews[0].name).toContain("Error");

    useStore.getState().setFilter("outcome", "all");
    useStore.getState().setFilter("tier", "all");
    useStore.getState().applySavedView(useStore.getState().savedViews[0].id);
    expect(useStore.getState().filters.outcome).toBe("error");
    expect(useStore.getState().filters.tier).toBe("planner");

    useStore.getState().deleteSavedView(useStore.getState().savedViews[0].id);
    expect(useStore.getState().savedViews).toHaveLength(0);
  });
});
