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

    const runOne = useStore
      .getState()
      .runGroups.find((g) => g.runId === "run-1");
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

  test("trace list mode defaults to sessions and can be toggled", () => {
    expect(useStore.getState().traceListMode).toBe("sessions");

    useStore.getState().setTraceListMode("runs");
    expect(useStore.getState().traceListMode).toBe("runs");
  });

  test("top-level viewer mode defaults to sessions and can switch to insights", () => {
    expect(useStore.getState().activeTopLevelView).toBe("sessions");

    useStore.getState().setActiveTopLevelView("insights");
    expect(useStore.getState().activeTopLevelView).toBe("insights");
  });

  test("setSessions falls back to sessions when selected run view has no groups", () => {
    useStore.getState().setTraceListMode("runs");
    useStore.getState().setSessions([
      {
        sessionId: "s1",
        startTime: 100,
        endTime: 160,
        query: "Standalone query",
        startUrl: "https://example.com/a",
        outcome: "completed",
        turnCount: 3,
        summary: "done",
        metrics: null,
      },
    ] as any);

    expect(useStore.getState().runGroups).toHaveLength(0);
    expect(useStore.getState().traceListMode).toBe("sessions");
  });
});
