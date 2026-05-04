import { describe, expect, test } from "vitest";
import type { OrchestratorTask } from "../../src/background/orchestrator/types";
import {
  bindNodeToTaskTab,
  claimTaskTab,
  countOpenOwnedAuxiliaryTabs,
  createTaskTabCoordination,
  releaseTaskTab,
  selectResumeOwnedTab,
  touchTaskTab,
} from "../../src/background/orchestrator/tab-coordination";

function makeTask(overrides: Partial<OrchestratorTask> = {}): OrchestratorTask {
  return {
    id: "task-1",
    workspaceId: "ws-1",
    rootTabId: 100,
    rootTabUrl: "https://example.com/list",
    query: "test",
    status: "running",
    createdAt: Date.now(),
    nodes: [],
    plannerReflexionLog: [],
    maxWorkers: 3,
    maxReplans: 3,
    replansUsed: 0,
    horizonExpansions: 0,
    currentIndex: 0,
    sessionMetrics: {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      totalCostActual: 0,
      totalCostEstimated: 0,
      costMode: "none",
      totalLlmTimeMs: 0,
      totalSessionTimeMs: 0,
      llmCallCount: 0,
      totalCachedTokens: 0,
      modelBreakdown: {},
    },
    budget: {
      maxSessionTimeMs: 1,
      maxTotalTokens: 1,
      maxTotalCostUsd: 1,
    },
    tabCoordination: createTaskTabCoordination(100, {
      primaryTabUrl: "https://example.com/list",
    }),
    ...overrides,
  };
}

describe("tab coordination", () => {
  test("bindNodeToTaskTab tracks explicit auxiliary ownership", () => {
    const task = makeTask();
    bindNodeToTaskTab(task, "node-1", {
      tabId: 201,
      role: "auxiliary",
      createdByTask: true,
      url: "https://example.com/detail",
    });

    expect(task.tabCoordination?.nodeBindings["node-1"]).toBe(201);
    expect(task.tabCoordination?.ownedTabs.find((entry) => entry.tabId === 201)?.role).toBe(
      "auxiliary",
    );
    expect(countOpenOwnedAuxiliaryTabs(task)).toBe(1);
  });

  test("releaseTaskTab removes closed auxiliary tabs from active ownership", () => {
    const task = makeTask();
    bindNodeToTaskTab(task, "node-1", {
      tabId: 201,
      role: "auxiliary",
      createdByTask: true,
    });
    releaseTaskTab(task, 201);

    expect(countOpenOwnedAuxiliaryTabs(task)).toBe(0);
    expect(task.tabCoordination?.nodeBindings["node-1"]).toBeUndefined();
  });

  test("touchTaskTab preserves the durable root URL when the primary tab goes blank", () => {
    const task = makeTask();

    touchTaskTab(task, 100, "about:blank");

    expect(task.rootTabUrl).toBe("https://example.com/list");
    expect(task.tabCoordination?.ownedTabs.find((entry) => entry.tabId === 100)?.lastKnownUrl).toBe(
      "https://example.com/list",
    );
  });

  test("claimTaskTab preserves the durable root URL when a primary rebound sees chrome internal state", () => {
    const task = makeTask();

    claimTaskTab(task, {
      tabId: 100,
      role: "primary",
      createdByTask: false,
      url: "chrome://newtab",
    });

    expect(task.rootTabUrl).toBe("https://example.com/list");
    expect(task.tabCoordination?.ownedTabs.find((entry) => entry.tabId === 100)?.lastKnownUrl).toBe(
      "https://example.com/list",
    );
  });

  test("selectResumeOwnedTab prefers exact root URL matches over arbitrary live tabs", () => {
    const selected = selectResumeOwnedTab(
      {
        rootTabId: 100,
        rootTabUrl: "https://example.com/list",
        tabCoordination: undefined,
      },
      [
        { id: 777, url: "https://example.com/other" },
        { id: 333, url: "https://example.com/list" },
      ],
      777,
    );

    expect(selected).toEqual({
      status: "safe",
      tabId: 333,
      reason:
        "Recovered onto the only live workspace tab whose URL matches the durable root URL.",
    });
  });

  test("selectResumeOwnedTab prefers live owned tabs before unrelated workspace tabs", () => {
    const task = makeTask({
      tabCoordination: {
        primaryTabId: 100,
        ownedTabs: [
          {
            tabId: 100,
            role: "primary",
            createdByTask: false,
            lastKnownUrl: "https://example.com/list",
            claimedAt: Date.now(),
            lastUsedAt: Date.now(),
            releasedAt: null,
          },
          {
            tabId: 201,
            role: "auxiliary",
            createdByTask: true,
            lastKnownUrl: "https://example.com/detail",
            claimedAt: Date.now(),
            lastUsedAt: Date.now() + 1,
            releasedAt: null,
          },
        ],
        nodeBindings: {},
        lastReboundTabId: 201,
      },
    });

    const selected = selectResumeOwnedTab(
      task,
      [
        { id: 201, url: "https://example.com/detail" },
        { id: 999, url: "https://example.com/other" },
      ],
      999,
    );

    expect(selected).toEqual({
      status: "safe",
      tabId: 201,
      reason: "Recovered onto the only live task-owned tab.",
    });
  });

  test("selectResumeOwnedTab accepts the durable root tab when it is the preferred live tab", () => {
    const selected = selectResumeOwnedTab(
      {
        rootTabId: 100,
        rootTabUrl: null,
        tabCoordination: undefined,
      },
      [{ id: 100, url: "https://example.com/list" }],
      100,
    );

    expect(selected).toEqual({
      status: "safe",
      tabId: 100,
      reason: "Recovered onto the previously preferred task tab.",
    });
  });

  test("selectResumeOwnedTab rejects ambiguous exact URL matches", () => {
    const selected = selectResumeOwnedTab(
      {
        rootTabId: 100,
        rootTabUrl: "https://example.com/list",
        tabCoordination: undefined,
      },
      [
        { id: 333, url: "https://example.com/list" },
        { id: 444, url: "https://example.com/list" },
      ],
      333,
    );

    expect(selected).toEqual({
      status: "unsafe",
      reason:
        "Multiple live workspace tabs match the durable root URL; rebinding is ambiguous.",
    });
  });

  test("selectResumeOwnedTab rejects non-owned fallback when no safe owned tab exists", () => {
    const selected = selectResumeOwnedTab(
      {
        rootTabId: 100,
        rootTabUrl: null,
        tabCoordination: undefined,
      },
      [{ id: 999, url: "https://example.com/other" }],
      999,
    );

    expect(selected).toEqual({
      status: "unsafe",
      reason: "No safe owned tab available for rebinding.",
    });
  });

  test("selectResumeOwnedTab rejects unusable live tabs even when owned", () => {
    const task = makeTask();

    const selected = selectResumeOwnedTab(
      task,
      [{ id: 100, url: "about:blank" }],
      100,
    );

    expect(selected).toEqual({
      status: "unsafe",
      reason: "No usable live workspace tab available for rebinding.",
    });
  });
});
