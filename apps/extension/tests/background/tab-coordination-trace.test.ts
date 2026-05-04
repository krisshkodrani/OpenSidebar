import { describe, expect, test } from "vitest";
import type { OrchestratorTask } from "../../src/background/orchestrator/types";
import { buildTabCoordinationTraceData } from "../../src/background/orchestrator/tab-coordination-trace";

function makeTask(overrides: Partial<OrchestratorTask> = {}): OrchestratorTask {
  return {
    id: "task-1",
    workspaceId: "ws-1",
    rootTabId: 100,
    rootTabUrl: "https://example.com/list",
    query: "test",
    status: "running",
    createdAt: 1,
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
    ...overrides,
  };
}

describe("tab coordination trace data", () => {
  test("emits replay-friendly tab refs while preserving Chrome debug handles", () => {
    const traceData = buildTabCoordinationTraceData(
      makeTask({
        tabCoordination: {
          primaryTabId: 100,
          ownedTabs: [
            {
              tabId: 100,
              role: "primary",
              createdByTask: false,
              lastKnownUrl: "https://example.com/list",
              claimedAt: 1,
              lastUsedAt: 1,
              releasedAt: null,
            },
            {
              tabId: 201,
              role: "auxiliary",
              createdByTask: true,
              lastKnownUrl: "https://example.com/detail",
              claimedAt: 2,
              lastUsedAt: 3,
              releasedAt: null,
            },
          ],
          nodeBindings: { "node-1": 201 },
          lastReboundTabId: 201,
        },
      }),
      { action: "test" },
    );

    expect(traceData).toMatchObject({
      environment: "chrome-extension",
      tabRefSchemaVersion: 1,
      rootTabId: 100,
      primaryTabId: 100,
      lastReboundTabId: 201,
      ownedTabCount: 2,
      nodeBindingCount: 1,
      action: "test",
      chromeDebug: {
        rootTabId: 100,
        primaryTabId: 100,
        lastReboundTabId: 201,
      },
      tabRefs: {
        root: {
          source: "root",
          role: "primary",
          url: "https://example.com/list",
          debug: { chromeTabId: 100 },
        },
        primary: {
          source: "primary",
          role: "primary",
          url: "https://example.com/list",
          debug: { chromeTabId: 100 },
        },
        lastRebound: {
          source: "lastRebound",
          role: "auxiliary",
          url: "https://example.com/detail",
          debug: { chromeTabId: 201 },
        },
      },
      ownedTabs: [
        {
          tabId: 100,
          role: "primary",
          tabRef: {
            source: "owned",
            role: "primary",
            url: "https://example.com/list",
            ownedIndex: 0,
            debug: { chromeTabId: 100 },
          },
        },
        {
          tabId: 201,
          role: "auxiliary",
          tabRef: {
            source: "owned",
            role: "auxiliary",
            url: "https://example.com/detail",
            ownedIndex: 1,
            debug: { chromeTabId: 201 },
          },
        },
      ],
    });
  });

  test("keeps enough role and URL data for replay consumers to ignore raw tab ids", () => {
    const traceData = buildTabCoordinationTraceData(
      makeTask({
        rootTabId: 900,
        tabCoordination: {
          primaryTabId: 901,
          ownedTabs: [
            {
              tabId: 901,
              role: "primary",
              createdByTask: false,
              lastKnownUrl: "https://example.com/dashboard",
              claimedAt: 1,
              lastUsedAt: 2,
              releasedAt: null,
            },
          ],
          nodeBindings: {},
          lastReboundTabId: null,
        },
      }),
    );

    const tabRefs = traceData.tabRefs as {
      primary: { role: string; url: string | null; debug?: unknown };
      lastRebound: unknown;
      owned: Array<{ role: string; url: string | null; debug?: unknown }>;
    };
    const replayHints = {
      primary: {
        role: tabRefs.primary.role,
        url: tabRefs.primary.url,
      },
      owned: tabRefs.owned.map((entry) => ({
        role: entry.role,
        url: entry.url,
      })),
    };

    expect(replayHints).toEqual({
      primary: {
        role: "primary",
        url: "https://example.com/dashboard",
      },
      owned: [
        {
          role: "primary",
          url: "https://example.com/dashboard",
        },
      ],
    });
    expect(tabRefs.lastRebound).toBeNull();
  });

  test("filters released tabs from portable refs and legacy owned tab counts", () => {
    const traceData = buildTabCoordinationTraceData(
      makeTask({
        tabCoordination: {
          primaryTabId: 100,
          ownedTabs: [
            {
              tabId: 100,
              role: "primary",
              createdByTask: false,
              lastKnownUrl: "https://example.com/list",
              claimedAt: 1,
              lastUsedAt: 1,
              releasedAt: null,
            },
            {
              tabId: 201,
              role: "auxiliary",
              createdByTask: true,
              lastKnownUrl: "https://example.com/closed",
              claimedAt: 2,
              lastUsedAt: 3,
              releasedAt: 4,
            },
          ],
          nodeBindings: {},
          lastReboundTabId: 201,
        },
      }),
    );

    const tabRefs = traceData.tabRefs as {
      lastRebound: unknown;
      owned: unknown[];
    };

    expect(traceData.ownedTabCount).toBe(1);
    expect(tabRefs.owned).toHaveLength(1);
    expect(tabRefs.lastRebound).toEqual(
      expect.objectContaining({
        source: "lastRebound",
        role: "auxiliary",
        url: "https://example.com/closed",
        debug: { chromeTabId: 201 },
      }),
    );
    expect(traceData.ownedTabs).toEqual([
      expect.objectContaining({
        tabId: 100,
        tabRef: expect.objectContaining({
          role: "primary",
          url: "https://example.com/list",
        }),
      }),
    ]);
  });
});
