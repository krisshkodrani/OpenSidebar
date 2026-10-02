import type { OrchestratorTask, TaskNode } from "./types";
import { isTabOccupiedByRunningNode } from "./plan-state";
import {
  bindNodeToTaskTab,
  countOpenOwnedAuxiliaryTabs,
  ensureTaskTabCoordination,
  getNodeBoundTabId,
  touchTaskTab,
} from "./tab-coordination";

export async function assignWorkerTab(input: {
  task: OrchestratorTask;
  node: TaskNode;
  nodeTabMap: Map<string, number>;
  fallbackTabId: number;
  initialTabUrl: string;
  allowNavigation: boolean;
  resolveRunnableTabId: (tabId: number) => Promise<number | null>;
  createWorkerTab: (url: string) => Promise<number>;
  getTab: (tabId: number) => Promise<{ url?: string }>;
  emitNodeBound: (details: {
    nodeId: string;
    tabId: number;
    role: "primary" | "auxiliary";
  }) => void;
}): Promise<number> {
  const {
    task, node, nodeTabMap, fallbackTabId, initialTabUrl,
    allowNavigation, resolveRunnableTabId, createWorkerTab, getTab,
    emitNodeBound,
  } = input;
  ensureTaskTabCoordination(task, {
    primaryTabId: task.rootTabId,
    primaryTabUrl: task.rootTabUrl ?? null,
  });
  const previousTabId =
    getNodeBoundTabId(task, node.id) ?? nodeTabMap.get(node.id);
  let tabId: number;
  if (previousTabId != null) {
    // Retry: reuse the previous tab only if it still has a usable page.
    tabId = (await resolveRunnableTabId(previousTabId)) ?? fallbackTabId;
  } else if (nodeTabMap.size === 0) {
    // First node: use the user's original tab.
    tabId = (await resolveRunnableTabId(fallbackTabId)) ?? fallbackTabId;
  } else {
    // Sequential dependency: reuse the predecessor's tab.
    const depTabId = node.dependencies
      .map((depId) => nodeTabMap.get(depId))
      .find((id) => id != null);
    if (depTabId != null) {
      tabId =
        (await resolveRunnableTabId(depTabId)) ??
        (await resolveRunnableTabId(fallbackTabId)) ??
        fallbackTabId;
    } else if (!allowNavigation) {
      tabId = (await resolveRunnableTabId(fallbackTabId)) ?? fallbackTabId;
    } else if (
      isTabOccupiedByRunningNode(fallbackTabId, nodeTabMap, task.nodes)
    ) {
      const createdCount = countOpenOwnedAuxiliaryTabs(task);
      if (createdCount < task.maxWorkers - 1) {
        tabId = await createWorkerTab(initialTabUrl);
        if (!task.createdWorkerTabIds) task.createdWorkerTabIds = [];
        if (!task.createdWorkerTabIds.includes(tabId)) {
          task.createdWorkerTabIds.push(tabId);
        }
      } else {
        tabId = (await resolveRunnableTabId(fallbackTabId)) ?? fallbackTabId;
      }
    } else {
      tabId = (await resolveRunnableTabId(fallbackTabId)) ?? fallbackTabId;
    }
  }
  nodeTabMap.set(node.id, tabId);
  try {
    const assignedTab = await getTab(tabId);
    bindNodeToTaskTab(task, node.id, {
      tabId,
      role: tabId === task.rootTabId ? "primary" : "auxiliary",
      createdByTask: tabId !== task.rootTabId,
      url: assignedTab.url ?? null,
    });
    touchTaskTab(task, tabId, assignedTab.url ?? null);
  } catch {
    bindNodeToTaskTab(task, node.id, {
      tabId,
      role: tabId === task.rootTabId ? "primary" : "auxiliary",
      createdByTask: tabId !== task.rootTabId,
    });
  }
  emitNodeBound({
    nodeId: node.id,
    tabId,
    role: tabId === task.rootTabId ? "primary" : "auxiliary",
  });
  return tabId;
}
