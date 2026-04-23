import type {
  OrchestratorTask,
  TaskOwnedTab,
  TaskTabCoordination,
  TaskTabRole,
} from "./types";

type TabLike = {
  id?: number | null;
  url?: string | null;
};

type TaskTabCandidate = Pick<
  OrchestratorTask,
  "rootTabId" | "rootTabUrl" | "tabCoordination"
>;

export type ResumeTabSelection =
  | {
      status: "safe";
      tabId: number;
      reason: string;
    }
  | {
      status: "unsafe";
      reason: string;
    };

function normalizeTabUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function upsertOwnedTab(
  ownedTabs: TaskOwnedTab[],
  next: TaskOwnedTab,
): TaskOwnedTab[] {
  const existingIndex = ownedTabs.findIndex((entry) => entry.tabId === next.tabId);
  if (existingIndex === -1) return [...ownedTabs, next];
  const existing = ownedTabs[existingIndex];
  const merged: TaskOwnedTab = {
    ...existing,
    ...next,
    createdByTask: existing.createdByTask || next.createdByTask,
    lastKnownUrl:
      next.lastKnownUrl !== undefined ? next.lastKnownUrl : existing.lastKnownUrl,
    releasedAt:
      next.releasedAt === undefined ? existing.releasedAt : next.releasedAt,
  };
  return ownedTabs.map((entry, index) => (index === existingIndex ? merged : entry));
}

export function createTaskTabCoordination(
  primaryTabId: number,
  options: {
    primaryTabUrl?: string | null;
    claimedAt?: number;
    lastReboundTabId?: number | null;
  } = {},
): TaskTabCoordination {
  const claimedAt = options.claimedAt ?? Date.now();
  return {
    primaryTabId,
    ownedTabs: [
      {
        tabId: primaryTabId,
        role: "primary",
        createdByTask: false,
        lastKnownUrl: options.primaryTabUrl ?? null,
        claimedAt,
        lastUsedAt: claimedAt,
        releasedAt: null,
      },
    ],
    nodeBindings: {},
    lastReboundTabId: options.lastReboundTabId ?? null,
  };
}

export function ensureTaskTabCoordination(
  task: OrchestratorTask,
  options: {
    primaryTabId?: number;
    primaryTabUrl?: string | null;
    claimedAt?: number;
  } = {},
): TaskTabCoordination {
  const primaryTabId = options.primaryTabId ?? task.rootTabId;
  if (!task.tabCoordination) {
    task.tabCoordination = createTaskTabCoordination(primaryTabId, {
      primaryTabUrl: options.primaryTabUrl ?? task.rootTabUrl ?? null,
      claimedAt: options.claimedAt,
    });
    return task.tabCoordination;
  }

  task.tabCoordination.primaryTabId = primaryTabId;
  task.tabCoordination.ownedTabs = upsertOwnedTab(task.tabCoordination.ownedTabs, {
    tabId: primaryTabId,
    role: "primary",
    createdByTask: false,
    lastKnownUrl:
      options.primaryTabUrl !== undefined
        ? options.primaryTabUrl
        : task.rootTabUrl ?? null,
    claimedAt: options.claimedAt ?? Date.now(),
    lastUsedAt: Date.now(),
    releasedAt: null,
  }).map((entry) =>
    entry.tabId === primaryTabId
      ? { ...entry, role: "primary", releasedAt: null }
      : entry.role === "primary"
        ? { ...entry, role: "auxiliary" }
        : entry,
  );
  return task.tabCoordination;
}

export function claimTaskTab(
  task: OrchestratorTask,
  params: {
    tabId: number;
    role: TaskTabRole;
    createdByTask: boolean;
    url?: string | null;
    claimedAt?: number;
  },
): TaskTabCoordination {
  const coordination = ensureTaskTabCoordination(task);
  const claimedAt = params.claimedAt ?? Date.now();
  if (params.role === "primary") {
    coordination.primaryTabId = params.tabId;
    coordination.lastReboundTabId = params.tabId;
    task.rootTabId = params.tabId;
    if (params.url !== undefined) {
      task.rootTabUrl = params.url;
    }
  }
  coordination.ownedTabs = upsertOwnedTab(coordination.ownedTabs, {
    tabId: params.tabId,
    role: params.role,
    createdByTask: params.createdByTask,
    lastKnownUrl: params.url,
    claimedAt,
    lastUsedAt: claimedAt,
    releasedAt: null,
  }).map((entry) =>
    params.role === "primary" && entry.tabId !== params.tabId && entry.role === "primary"
      ? { ...entry, role: "auxiliary" }
      : entry,
  );
  return coordination;
}

export function touchTaskTab(
  task: OrchestratorTask,
  tabId: number,
  url?: string | null,
): void {
  const coordination = ensureTaskTabCoordination(task);
  coordination.ownedTabs = coordination.ownedTabs.map((entry) =>
    entry.tabId === tabId
      ? {
          ...entry,
          lastKnownUrl: url !== undefined ? url : entry.lastKnownUrl,
          lastUsedAt: Date.now(),
          releasedAt: null,
        }
      : entry,
  );
  if (coordination.primaryTabId === tabId && url !== undefined) {
    task.rootTabUrl = url;
  }
}

export function bindNodeToTaskTab(
  task: OrchestratorTask,
  nodeId: string,
  params: {
    tabId: number;
    role?: TaskTabRole;
    createdByTask?: boolean;
    url?: string | null;
  },
): void {
  const coordination = claimTaskTab(task, {
    tabId: params.tabId,
    role:
      params.role ??
      (params.tabId === (task.tabCoordination?.primaryTabId ?? task.rootTabId)
        ? "primary"
        : "auxiliary"),
    createdByTask: params.createdByTask ?? false,
    url: params.url,
  });
  coordination.nodeBindings[nodeId] = params.tabId;
}

export function getNodeBoundTabId(
  task: OrchestratorTask,
  nodeId: string,
): number | null {
  return task.tabCoordination?.nodeBindings[nodeId] ?? null;
}

export function releaseTaskTab(task: OrchestratorTask, tabId: number): void {
  const coordination = task.tabCoordination;
  if (!coordination || coordination.primaryTabId === tabId) return;
  const releasedAt = Date.now();
  coordination.ownedTabs = coordination.ownedTabs.map((entry) =>
    entry.tabId === tabId ? { ...entry, releasedAt } : entry,
  );
  for (const [nodeId, boundTabId] of Object.entries(coordination.nodeBindings)) {
    if (boundTabId === tabId) {
      delete coordination.nodeBindings[nodeId];
    }
  }
}

export function countOpenOwnedAuxiliaryTabs(task: OrchestratorTask): number {
  return (
    task.tabCoordination?.ownedTabs.filter(
      (entry) =>
        entry.role !== "primary" &&
        entry.createdByTask &&
        entry.releasedAt == null,
    ).length ?? 0
  );
}

export function getOwnedCreatedTabIds(task: OrchestratorTask): number[] {
  return (
    task.tabCoordination?.ownedTabs
      .filter((entry) => entry.createdByTask && entry.releasedAt == null)
      .map((entry) => entry.tabId) ?? task.createdWorkerTabIds ?? []
  );
}

export function selectResumeOwnedTab(
  task: TaskTabCandidate,
  liveTabs: TabLike[],
  preferredTabId: number,
): ResumeTabSelection {
  const liveById = new Map<number, TabLike>();
  for (const tab of liveTabs) {
    if (typeof tab.id === "number") {
      liveById.set(tab.id, tab);
    }
  }
  const liveIds = new Set(liveById.keys());
  if (liveIds.size === 0) {
    return {
      status: "unsafe",
      reason: "No live workspace tab available for rebinding.",
    };
  }
  const targetUrl = normalizeTabUrl(task.rootTabUrl ?? null);
  const ownedTabs = (task.tabCoordination?.ownedTabs ?? [])
    .filter((entry) => entry.releasedAt == null)
    .sort((a, b) => {
      if (a.role === "primary" && b.role !== "primary") return -1;
      if (a.role !== "primary" && b.role === "primary") return 1;
      return b.lastUsedAt - a.lastUsedAt;
    });

  const ownedLiveCandidates = ownedTabs.filter((entry) => liveIds.has(entry.tabId));
  const preferredLive = liveIds.has(preferredTabId) ? preferredTabId : null;
  const reboundLive =
    task.tabCoordination?.lastReboundTabId != null &&
    liveIds.has(task.tabCoordination.lastReboundTabId)
      ? task.tabCoordination.lastReboundTabId
      : null;
  const primaryLive = liveIds.has(task.rootTabId) ? task.rootTabId : null;

  const exactUrlMatches = (tabIds: number[]): number[] =>
    targetUrl == null
      ? []
      : tabIds.filter((tabId) => {
          const currentUrl = normalizeTabUrl(liveById.get(tabId)?.url ?? null);
          return currentUrl === targetUrl;
        });

  if (targetUrl) {
    const ownedExact = exactUrlMatches(ownedLiveCandidates.map((entry) => entry.tabId));
    if (ownedExact.length === 1) {
      return {
        status: "safe",
        tabId: ownedExact[0],
        reason: "Recovered onto the single owned tab whose live URL matches the durable root URL.",
      };
    }
    if (ownedExact.length > 1) {
      return {
        status: "unsafe",
        reason:
          "Multiple task-owned tabs match the durable root URL; rebinding is ambiguous.",
      };
    }

    const workspaceExact = exactUrlMatches([...liveIds]);
    if (workspaceExact.length === 1) {
      return {
        status: "safe",
        tabId: workspaceExact[0],
        reason:
          "Recovered onto the only live workspace tab whose URL matches the durable root URL.",
      };
    }
    if (workspaceExact.length > 1) {
      return {
        status: "unsafe",
        reason:
          "Multiple live workspace tabs match the durable root URL; rebinding is ambiguous.",
      };
    }
  }

  if (ownedLiveCandidates.length === 1) {
    return {
      status: "safe",
      tabId: ownedLiveCandidates[0].tabId,
      reason: "Recovered onto the only live task-owned tab.",
    };
  }
  if (ownedLiveCandidates.length > 1) {
    if (
      reboundLive != null &&
      ownedLiveCandidates.some((entry) => entry.tabId === reboundLive)
    ) {
      return {
        status: "safe",
        tabId: reboundLive,
        reason: "Recovered onto the last successfully rebound task-owned tab.",
      };
    }
    if (
      primaryLive != null &&
      ownedLiveCandidates.some((entry) => entry.tabId === primaryLive)
    ) {
      return {
        status: "safe",
        tabId: primaryLive,
        reason: "Recovered onto the task primary tab because no stronger owned-tab match existed.",
      };
    }
    return {
      status: "unsafe",
      reason:
        "Multiple live task-owned tabs are available without a unique root-URL match; rebinding is ambiguous.",
    };
  }

  if (
    preferredLive != null &&
    (reboundLive === preferredLive || primaryLive === preferredLive)
  ) {
    return {
      status: "safe",
      tabId: preferredLive,
      reason: "Recovered onto the previously preferred task tab.",
    };
  }

  return {
    status: "unsafe",
    reason: "No safe owned tab available for rebinding.",
  };
}
