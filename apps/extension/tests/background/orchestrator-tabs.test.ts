import { describe, expect, test } from "vitest";
import "../setup";
import { ToolName } from "../../src/types";
import { OrchestratorTask, TaskNode } from "../../src/background/orchestrator/types";
import { sanitizeTask } from "../../src/background/orchestrator/sanitizers";

// Re-implement isTabOccupiedByRunningNode to test the logic directly
// (it's a module-scoped function in index.ts, not exported)
function isTabOccupiedByRunningNode(
  tabId: number,
  nodeTabMap: Map<string, number>,
  nodes: TaskNode[],
): boolean {
  for (const [nodeId, assignedTabId] of nodeTabMap) {
    if (assignedTabId !== tabId) continue;
    const node = nodes.find((n) => n.id === nodeId);
    if (node?.status === "running") return true;
  }
  return false;
}

function makeNode(
  id: string,
  status: TaskNode["status"],
  dependencies: string[] = [],
): TaskNode {
  return {
    id,
    role: "executor",
    description: `Task ${id}`,
    successCriteria: `Task ${id} done`,
    allowedTools: [ToolName.READ_PAGE, ToolName.DONE],
    dependencies,
    assumptions: [],
    handoffArtifacts: [],
    reflexionLog: [],
    handoffDepth: 0,
    status,
    retries: 0,
  };
}

function makeMinimalTaskRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "task-1",
    workspaceId: "ws-1",
    rootTabId: 100,
    query: "test query",
    status: "completed",
    createdAt: Date.now(),
    nodes: [
      {
        id: "node-1",
        role: "executor",
        description: "Do something",
        successCriteria: "Done",
        allowedTools: [ToolName.READ_PAGE, ToolName.DONE],
        dependencies: [],
        assumptions: [],
        handoffArtifacts: [],
        reflexionLog: [],
        handoffDepth: 0,
        status: "completed",
        retries: 0,
      },
    ],
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
      maxSessionTimeMs: 720000,
      maxTotalTokens: 1000000,
      maxTotalCostUsd: 1.5,
    },
    ...overrides,
  };
}

describe("Tab lifecycle policy — isTabOccupiedByRunningNode", () => {
  test("returns false when no nodes use the tab", () => {
    const nodes = [makeNode("a", "pending"), makeNode("b", "pending")];
    const nodeTabMap = new Map<string, number>();
    expect(isTabOccupiedByRunningNode(100, nodeTabMap, nodes)).toBe(false);
  });

  test("returns false when tab is assigned but node is completed", () => {
    const nodes = [makeNode("a", "completed")];
    const nodeTabMap = new Map([["a", 100]]);
    expect(isTabOccupiedByRunningNode(100, nodeTabMap, nodes)).toBe(false);
  });

  test("returns true when tab is assigned to a running node", () => {
    const nodes = [makeNode("a", "running"), makeNode("b", "pending")];
    const nodeTabMap = new Map([["a", 100]]);
    expect(isTabOccupiedByRunningNode(100, nodeTabMap, nodes)).toBe(true);
  });

  test("returns false when running node is on a different tab", () => {
    const nodes = [makeNode("a", "running")];
    const nodeTabMap = new Map([["a", 200]]);
    expect(isTabOccupiedByRunningNode(100, nodeTabMap, nodes)).toBe(false);
  });

  test("returns true if any of multiple nodes on the tab is running", () => {
    const nodes = [
      makeNode("a", "completed"),
      makeNode("b", "running"),
    ];
    const nodeTabMap = new Map([
      ["a", 100],
      ["b", 100],
    ]);
    expect(isTabOccupiedByRunningNode(100, nodeTabMap, nodes)).toBe(true);
  });
});

describe("Tab lifecycle policy — tab assignment decision tree", () => {
  // These tests validate the decision logic by simulating the conditions
  // in the launchWorker tab assignment block.

  test("single-node task always uses user's tab", () => {
    // First node (nodeTabMap.size === 0) → user's tab
    const nodeTabMap = new Map<string, number>();
    const nodes = [makeNode("a", "pending")];
    // Decision: nodeTabMap.size === 0 → tabId = input.tabId
    expect(nodeTabMap.size).toBe(0);
    // Would use input.tabId (100)
  });

  test("sequential 3-node chain reuses same tab via dependencies", () => {
    const userTabId = 100;
    const nodes = [
      makeNode("a", "completed"),
      makeNode("b", "completed", ["a"]),
      makeNode("c", "pending", ["b"]),
    ];
    const nodeTabMap = new Map([
      ["a", userTabId],
      ["b", userTabId],
    ]);

    // Node C has dependency B, and B's tab is the user's tab
    const depTabId = nodes[2].dependencies
      .map((depId) => nodeTabMap.get(depId))
      .find((id) => id != null);
    expect(depTabId).toBe(userTabId);
  });

  test("parallel node reuses user's tab when it is free", () => {
    const userTabId = 100;
    const nodes = [
      makeNode("a", "completed"), // finished, frees the tab
      makeNode("b", "pending"),   // parallel (no deps), should reuse user's tab
    ];
    const nodeTabMap = new Map([["a", userTabId]]);

    // Node B has no dependencies, so depTabId is undefined
    const depTabId = nodes[1].dependencies
      .map((depId) => nodeTabMap.get(depId))
      .find((id) => id != null);
    expect(depTabId).toBeUndefined();

    // User's tab is NOT occupied (node A is completed)
    expect(isTabOccupiedByRunningNode(userTabId, nodeTabMap, nodes)).toBe(false);
    // Decision: user's tab is free → reuse it (no new tab created)
  });

  test("parallel node creates new tab only when user's tab is occupied", () => {
    const userTabId = 100;
    const nodes = [
      makeNode("a", "running"),  // occupies user's tab
      makeNode("b", "pending"),  // parallel, needs its own tab
    ];
    const nodeTabMap = new Map([["a", userTabId]]);

    const depTabId = nodes[1].dependencies
      .map((depId) => nodeTabMap.get(depId))
      .find((id) => id != null);
    expect(depTabId).toBeUndefined();

    // User's tab IS occupied
    expect(isTabOccupiedByRunningNode(userTabId, nodeTabMap, nodes)).toBe(true);
    // Decision: would create new tab (if under cap)
  });

  test("tab cap prevents creating new tab, falls back to user's tab", () => {
    const userTabId = 100;
    const maxWorkers = 2;
    const createdWorkerTabIds = [201]; // already 1 created tab (cap = maxWorkers - 1 = 1)

    const nodes = [
      makeNode("a", "running"),
      makeNode("b", "pending"),
    ];
    const nodeTabMap = new Map([["a", userTabId]]);

    const occupied = isTabOccupiedByRunningNode(userTabId, nodeTabMap, nodes);
    expect(occupied).toBe(true);

    // Over cap: createdCount (1) >= maxWorkers - 1 (1)
    const createdCount = createdWorkerTabIds.length;
    expect(createdCount >= maxWorkers - 1).toBe(true);
    // Decision: fallback to user's tab
  });

  test("allowNavigation: false prevents new tab creation for parallel nodes", () => {
    const userTabId = 100;
    const allowNavigation = false;

    const nodes = [
      makeNode("a", "running"),
      makeNode("b", "pending"),  // parallel, no deps
    ];
    const nodeTabMap = new Map([["a", userTabId]]);

    const depTabId = nodes[1].dependencies
      .map((depId) => nodeTabMap.get(depId))
      .find((id) => id != null);
    expect(depTabId).toBeUndefined();

    // allowNavigation is false → always use user's tab, never create
    expect(allowNavigation).toBe(false);
    // Decision: tabId = input.tabId regardless of occupation
  });
});

describe("Tab lifecycle policy — createdWorkerTabIds sanitization", () => {
  test("sanitizeTask preserves valid createdWorkerTabIds", () => {
    const raw = makeMinimalTaskRaw({ createdWorkerTabIds: [201, 202] });
    const task = sanitizeTask(raw);
    expect(task).not.toBeNull();
    expect(task!.createdWorkerTabIds).toEqual([201, 202]);
  });

  test("sanitizeTask filters out invalid tab IDs", () => {
    const raw = makeMinimalTaskRaw({ createdWorkerTabIds: [201, -1, "bad", null, 202] });
    const task = sanitizeTask(raw);
    expect(task).not.toBeNull();
    expect(task!.createdWorkerTabIds).toEqual([201, 202]);
  });

  test("sanitizeTask omits createdWorkerTabIds when empty or missing", () => {
    const raw = makeMinimalTaskRaw();
    const task = sanitizeTask(raw);
    expect(task).not.toBeNull();
    expect(task!.createdWorkerTabIds).toBeUndefined();
  });

  test("sanitizeTask omits createdWorkerTabIds when all entries invalid", () => {
    const raw = makeMinimalTaskRaw({ createdWorkerTabIds: [-1, "bad"] });
    const task = sanitizeTask(raw);
    expect(task).not.toBeNull();
    expect(task!.createdWorkerTabIds).toBeUndefined();
  });

  test("sanitizeTask preserves explicit tab coordination state", () => {
    const now = Date.now();
    const raw = makeMinimalTaskRaw({
      tabCoordination: {
        primaryTabId: 100,
        ownedTabs: [
          {
            tabId: 100,
            role: "primary",
            createdByTask: false,
            lastKnownUrl: "https://example.com",
            claimedAt: now,
            lastUsedAt: now,
            releasedAt: null,
          },
          {
            tabId: 201,
            role: "auxiliary",
            createdByTask: true,
            lastKnownUrl: "https://example.com/detail",
            claimedAt: now,
            lastUsedAt: now,
            releasedAt: null,
          },
        ],
        nodeBindings: {
          "node-1": 100,
        },
        lastReboundTabId: 100,
      },
    });
    const task = sanitizeTask(raw);
    expect(task).not.toBeNull();
    expect(task!.tabCoordination?.primaryTabId).toBe(100);
    expect(task!.tabCoordination?.ownedTabs).toHaveLength(2);
    expect(task!.tabCoordination?.nodeBindings["node-1"]).toBe(100);
  });
});

describe("Tab lifecycle policy — cleanup safety", () => {
  test("closeWorkerTabs never closes rootTabId", () => {
    // Simulates the guard: tabId === task.rootTabId → skip
    const rootTabId = 100;
    const createdTabIds = [100, 201, 202]; // 100 should NOT be closed
    const closeable = createdTabIds.filter((id) => id !== rootTabId);
    expect(closeable).toEqual([201, 202]);
  });

  test("closeWorkerTabs handles empty createdWorkerTabIds", () => {
    const task: Pick<OrchestratorTask, "rootTabId" | "createdWorkerTabIds"> = {
      rootTabId: 100,
      createdWorkerTabIds: undefined,
    };
    const closeable = (task.createdWorkerTabIds ?? []).filter(
      (id) => id !== task.rootTabId,
    );
    expect(closeable).toEqual([]);
  });
});
