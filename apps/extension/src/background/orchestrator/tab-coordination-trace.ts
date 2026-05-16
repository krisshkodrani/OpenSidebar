import type { OrchestratorTask, TaskOwnedTab, TaskTabRole } from "./types";

export type TraceTabEnvironment = "chrome-extension";

export type TraceTabRefSource = "root" | "primary" | "previous" | "owned";

export interface TraceTabRef {
  source: TraceTabRefSource;
  role: TaskTabRole;
  url: string | null;
  ownedIndex?: number;
  debug?: {
    chromeTabId: number;
  };
}

function buildTraceTabRef(params: {
  source: TraceTabRefSource;
  role: TaskTabRole;
  url: string | null;
  tabId?: number | null;
  ownedIndex?: number;
}): TraceTabRef {
  return {
    source: params.source,
    role: params.role,
    url: params.url,
    ...(params.ownedIndex === undefined
      ? {}
      : { ownedIndex: params.ownedIndex }),
    ...(typeof params.tabId === "number"
      ? { debug: { chromeTabId: params.tabId } }
      : {}),
  };
}

function findOwnedTab(
  ownedTabs: TaskOwnedTab[],
  tabId: number | null | undefined,
): TaskOwnedTab | null {
  if (typeof tabId !== "number") return null;
  return ownedTabs.find((entry) => entry.tabId === tabId) ?? null;
}

function fallbackRoleForTab(tabId: number, primaryTabId: number): TaskTabRole {
  return tabId === primaryTabId ? "primary" : "auxiliary";
}

function fallbackUrlForTab(
  task: OrchestratorTask,
  tabId: number,
): string | null {
  return tabId === task.rootTabId ? (task.rootTabUrl ?? null) : null;
}

export function buildTabCoordinationTraceData(
  task: OrchestratorTask,
  detail: Record<string, unknown> = {},
): Record<string, unknown> {
  const coordination = task.tabCoordination;
  const ownedTabs = coordination?.ownedTabs ?? [];
  const activeOwnedTabs = ownedTabs.filter((entry) => entry.releasedAt == null);
  const primaryTabId = coordination?.primaryTabId ?? task.rootTabId;
  const lastReboundTabId = coordination?.lastReboundTabId ?? null;
  const primaryOwnedTab = findOwnedTab(activeOwnedTabs, primaryTabId);
  const lastReboundOwnedTab = findOwnedTab(ownedTabs, lastReboundTabId);
  const ownedTabRefs = activeOwnedTabs.map((entry, index) =>
    buildTraceTabRef({
      source: "owned",
      role: entry.role,
      url: entry.lastKnownUrl ?? null,
      tabId: entry.tabId,
      ownedIndex: index,
    }),
  );

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
    environment: "chrome-extension" satisfies TraceTabEnvironment,
    tabRefSchemaVersion: 1,
    tabRefs: {
      root: buildTraceTabRef({
        source: "root",
        role: "primary",
        url: task.rootTabUrl ?? null,
        tabId: task.rootTabId,
      }),
      primary: buildTraceTabRef({
        source: "primary",
        role: primaryOwnedTab?.role ?? "primary",
        url: primaryOwnedTab?.lastKnownUrl ?? task.rootTabUrl ?? null,
        tabId: primaryTabId,
      }),
      previous:
        lastReboundTabId == null
          ? null
          : buildTraceTabRef({
              source: "previous",
              role:
                lastReboundOwnedTab?.role ??
                fallbackRoleForTab(lastReboundTabId, primaryTabId),
              url:
                lastReboundOwnedTab?.lastKnownUrl ??
                fallbackUrlForTab(task, lastReboundTabId),
              tabId: lastReboundTabId,
            }),
      owned: ownedTabRefs,
    },
    rootTabId: task.rootTabId,
    rootTabUrl: task.rootTabUrl ?? null,
    primaryTabId,
    lastReboundTabId,
    ownedTabCount: activeOwnedTabs.length,
    nodeBindingCount: coordination
      ? Object.keys(coordination.nodeBindings).length
      : 0,
    ownedTabs: activeOwnedTabs.map((entry, index) => ({
      tabId: entry.tabId,
      role: entry.role,
      createdByTask: entry.createdByTask,
      lastKnownUrl: entry.lastKnownUrl ?? null,
      tabRef: ownedTabRefs[index],
    })),
    chromeDebug: {
      rootTabId: task.rootTabId,
      primaryTabId,
      lastReboundTabId,
    },
    diagnostics: {
      chrome: {
        rootTabId: task.rootTabId,
        primaryTabId,
        lastReboundTabId,
      },
    },
    ...detail,
  };
}
