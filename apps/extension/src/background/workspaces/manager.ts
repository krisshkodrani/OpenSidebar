import { Workspace } from "../../types";
import { logger } from "../../utils";
import { isContentScript } from "../../utils/context";

// Storage keys
const STORAGE_KEY_WORKSPACES = "opensidebar:workspaces";
const STORAGE_KEY_NEXT_NUM = "opensidebar:nextWorkspaceNum";

// Static tab-group color for all workspaces
const GROUP_COLOR: chrome.tabGroups.ColorEnum = "blue";

type WorkspaceManagerDeps = {
  isContentScript?: () => boolean;
  storageLocal?: Pick<chrome.storage.StorageArea, "get" | "set">;
};

type RecentlyRemovedWorkspace = {
  workspace: Workspace;
  removedAt: number;
};

export function parseWorkspaceGroupNumber(
  title: string | undefined,
): number | null {
  const match = title?.match(/^(?:OpenSidebar|OS) (\d+)$/);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

export function isWorkspaceGroupTitle(title: string | undefined): boolean {
  return parseWorkspaceGroupNumber(title) !== null;
}

/**
 * A tab the page opened (target=_blank link, window.open) from inside a
 * workspace tab, auto-adopted into that workspace. Queued per workspace so the
 * agent loop can tell the model its click actually opened a tab — without
 * this, the effect tracker scores the click as a no-op and the model is left
 * blind to tabs its own actions created.
 */
export type SpawnedTabRecord = {
  tabId: number;
  openerTabId: number;
  workspaceId: string;
  url: string;
  createdAt: number;
};

/** Cap per-workspace spawned-tab queues so an untended queue can't grow unbounded. */
const MAX_SPAWNED_QUEUE = 20;

export class WorkspaceManager {
  private workspaces: Workspace[] = [];
  private nextWorkspaceNum = 1;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();
  private listenersSetup = false;
  private deps: Required<WorkspaceManagerDeps>;
  private recentlyRemovedWorkspaces: RecentlyRemovedWorkspace[] = [];

  /** Page-opened tabs adopted per workspace, awaiting pickup by the agent loop. */
  private spawnedTabQueues = new Map<string, SpawnedTabRecord[]>();

  constructor(deps: WorkspaceManagerDeps = {}) {
    const defaultStorageLocal: Pick<chrome.storage.StorageArea, "get" | "set"> =
      typeof chrome !== "undefined" && chrome.storage?.local
        ? chrome.storage.local
        : {
            get: async () => ({}),
            set: async () => undefined,
          };
    this.deps = {
      isContentScript: deps.isContentScript ?? isContentScript,
      storageLocal: deps.storageLocal ?? defaultStorageLocal,
    };
    void this.ensureInitialized().catch(() => {
      // Public calls retry initialization and surface failures to their caller.
    });
  }

  private ensureInitialized(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initializeWithRetries().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async initializeWithRetries(): Promise<void> {
    if (this.deps.isContentScript()) {
      logger.debug(
        "workspace",
        "Skipping WorkspaceManager init in content script",
      );
      this.initialized = true;
      return;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const stored = await this.deps.storageLocal.get([
        STORAGE_KEY_WORKSPACES,
        STORAGE_KEY_NEXT_NUM,
      ]);
      this.workspaces = stored[STORAGE_KEY_WORKSPACES] || [];
        const highestStoredNumber = this.workspaces.reduce((highest, ws) => {
          const value =
            parseWorkspaceGroupNumber(ws.baseName) ??
            parseWorkspaceGroupNumber(ws.name);
          return value === null ? highest : Math.max(highest, value);
        }, 0);
        this.nextWorkspaceNum = Math.max(
          stored[STORAGE_KEY_NEXT_NUM] || 1,
          highestStoredNumber + 1,
        );
      this.initialized = true;
      this.setupListeners();
      logger.info("workspace", "WorkspaceManager initialized", {
        count: this.workspaces.length,
      });
        return;
    } catch (error) {
        lastError = error;
      logger.error("workspace", "Failed to initialize WorkspaceManager", {
        error,
          attempt: attempt + 1,
      });
        if (attempt < 3) {
          const delay = 1000 * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private runChromeEvent(label: string, operation: () => Promise<void>): void {
    void this.ensureInitialized()
      .then(() => this.withMutationLock(operation))
      .catch((error) => {
        logger.warn("workspace", `Failed to handle ${label}`, { error });
      });
  }

  private setupListeners() {
    if (this.listenersSetup) return;

    if (this.deps.isContentScript()) {
      logger.debug("workspace", "Skipping listener setup in content script");
      return;
    }

    if (typeof chrome === "undefined" || !chrome.tabs?.onRemoved) {
      logger.debug(
        "workspace",
        "Skipping listener setup - chrome.tabs not available",
      );
      return;
    }

    chrome.tabs.onRemoved.addListener((tabId) => {
      this.runChromeEvent("tab removal", () => this.handleTabRemoved(tabId));
    });

    if (chrome.tabGroups?.onRemoved) {
      chrome.tabGroups.onRemoved.addListener((group) => {
        this.runChromeEvent("group removal", () =>
          this.handleGroupRemoved(group),
      );
      });
    }

    if (chrome.tabGroups?.onCreated) {
      chrome.tabGroups.onCreated.addListener((group) => {
        this.runChromeEvent("group creation", () =>
          this.handleGroupCreated(group),
        );
      });
    }

    if (chrome.tabGroups?.onUpdated) {
      chrome.tabGroups.onUpdated.addListener((group) => {
        this.runChromeEvent("group update", () =>
          this.handleGroupUpdated(group),
        );
      });
  }

    if (chrome.tabs?.onUpdated) {
      chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        this.runChromeEvent("tab group change", () =>
          this.handleTabGroupChanged(tabId, changeInfo, tab),
        );
          });
    }

    if (chrome.webNavigation?.onCreatedNavigationTarget) {
      chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
        this.runChromeEvent("page-created navigation target", () =>
          this.handlePageCreatedNavigationTarget(details),
        );
        });
    }

    this.listenersSetup = true;
  }

  /**
   * Treat Chrome group membership as explicit user intent. Moving a tab into
   * an OpenSidebar group adopts it; moving it out detaches it.
   */
  private async handleTabGroupChanged(
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    _tab: chrome.tabs.Tab,
  ) {
    if (changeInfo.groupId === undefined) return;

    const currentWorkspace = this.getWorkspaceByTabId(tabId);
    const destinationWorkspace =
      changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
        ? null
        : (this.workspaces.find(
            (workspace) => workspace.tabGroupId === changeInfo.groupId,
          ) ?? null);

    if (currentWorkspace?.id === destinationWorkspace?.id) return;

    if (currentWorkspace) {
      this.removeTabFromWorkspaceRecord(tabId, currentWorkspace);
    }
    if (destinationWorkspace && !destinationWorkspace.tabIds.includes(tabId)) {
      destinationWorkspace.tabIds.push(tabId);
    }

    if (!currentWorkspace && !destinationWorkspace) return;

    await this.save();
    logger.info("workspace", "Applied user tab-group membership change", {
        tabId,
      fromWorkspaceId: currentWorkspace?.id ?? null,
      toWorkspaceId: destinationWorkspace?.id ?? null,
      groupId: changeInfo.groupId,
      });
        }

  private async handleGroupUpdated(group: chrome.tabGroups.TabGroup) {
    const workspace = this.workspaces.find(
      (item) => item.tabGroupId === group.id,
    );
    if (!workspace) return;

    let changed = false;
    const title = group.title ?? "";
    if (title !== workspace.name) {
      workspace.name = title;
      workspace.baseName = title;
      changed = true;
      }
    if (group.color && group.color !== workspace.color) {
      workspace.color = group.color;
      changed = true;
    }
    if (changed) await this.save();
  }

  private getWorkspaceByTabId(tabId: number): Workspace | null {
    return this.workspaces.find((ws) => ws.tabIds.includes(tabId)) || null;
  }

  /**
   * Adopt tabs the page opened from inside a workspace tab (target=_blank,
   * window.open). Only tabs with an openerTabId that belongs to a workspace
   * qualify — tabs created by the create_tab tool or orchestrator lane setup
   * have no openerTabId and take their existing explicit-attach paths.
   */
  private async handlePageCreatedNavigationTarget(
    details: chrome.webNavigation.WebNavigationSourceCallbackDetails,
  ) {
    const workspace = this.getWorkspaceByTabId(details.sourceTabId);
    if (!workspace || workspace.tabIds.includes(details.tabId)) return;

    const record: SpawnedTabRecord = {
      tabId: details.tabId,
      openerTabId: details.sourceTabId,
      workspaceId: workspace.id,
      url: details.url,
      createdAt: Date.now(),
    };
    logger.info("workspace", "Adopting page-opened tab into workspace", {
      tabId: details.tabId,
      openerTabId: details.sourceTabId,
      workspace: workspace.name,
      url: record.url,
    });
    const added = await this.addTabToWorkspaceUnlocked(
      details.tabId,
      workspace.id,
    );
    if (!added) {
      logger.warn("workspace", "Could not adopt page-opened tab", {
        tabId: details.tabId,
        workspaceId: workspace.id,
      });
      return;
    }

    const queue = this.spawnedTabQueues.get(workspace.id) ?? [];
    queue.push(record);
    if (queue.length > MAX_SPAWNED_QUEUE) queue.shift();
    this.spawnedTabQueues.set(workspace.id, queue);
  }

  /**
   * Return and clear the page-opened tabs adopted into a workspace since the
   * last drain. The agent loop calls this after each tool batch to surface
   * "your click opened a new tab" to the model.
   */
  public drainSpawnedTabs(workspaceId: string): SpawnedTabRecord[] {
    const queue = this.spawnedTabQueues.get(workspaceId);
    if (!queue || queue.length === 0) return [];
    this.spawnedTabQueues.delete(workspaceId);
    return queue;
  }

  private removeWorkspaceRecord(workspaceId: string): boolean {
    const previousLength = this.workspaces.length;
    this.workspaces = this.workspaces.filter(
      (workspace) => workspace.id !== workspaceId,
    );
    this.spawnedTabQueues.delete(workspaceId);
    return this.workspaces.length !== previousLength;
  }

  private removeTabFromWorkspaceRecord(
    tabId: number,
    workspace: Workspace,
  ): boolean {
    const index = workspace.tabIds.indexOf(tabId);
    if (index === -1) return false;
    workspace.tabIds.splice(index, 1);
    if (workspace.tabIds.length === 0) {
      this.removeWorkspaceRecord(workspace.id);
    }
    return true;
  }

  private async handleTabRemoved(tabId: number) {
    let changed = false;

    for (const workspace of [...this.workspaces]) {
      if (this.removeTabFromWorkspaceRecord(tabId, workspace)) {
        changed = true;
        if (workspace.tabIds.length === 0) {
          logger.info("workspace", "Auto-deleted empty workspace", {
            name: workspace.name,
          });
        }
      }
    }

    if (changed) await this.save();
  }

  private async handleGroupRemoved(group: chrome.tabGroups.TabGroup) {
    const ws = this.workspaces.find((w) => w.tabGroupId === group.id);
    if (ws) {
      logger.info("workspace", "Tab Group removed externally", {
        name: ws.name,
      });
      this.recentlyRemovedWorkspaces =
        this.recentlyRemovedWorkspaces.filter(
          (candidate) => candidate.workspace.id !== ws.id,
        );
      this.recentlyRemovedWorkspaces.push({
        workspace: { ...ws, tabIds: [...ws.tabIds] },
        removedAt: Date.now(),
      });
      this.removeWorkspaceRecord(ws.id);
      await this.save();
    }
  }

  /**
   * Chrome assigns a new group ID when a whole group is moved to another
   * window. Reconnect that group by matching its surviving tab IDs and exact
   * appearance, regardless of whether onCreated or onRemoved arrives first.
   */
  private async handleGroupCreated(group: chrome.tabGroups.TabGroup) {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    const tabIds = tabs.flatMap((tab) => (tab.id === undefined ? [] : [tab.id]));
    if (tabIds.length === 0) return;

    const tabIdSet = new Set(tabIds);
    const now = Date.now();
    this.recentlyRemovedWorkspaces = this.recentlyRemovedWorkspaces.filter(
      (candidate) => now - candidate.removedAt < 10_000,
    );

    const activeMatch = this.workspaces.find(
      (workspace) =>
        workspace.tabGroupId !== group.id &&
        workspace.name === group.title &&
        workspace.color === group.color &&
        workspace.tabIds.some((tabId) => tabIdSet.has(tabId)),
    );
    const removedMatch = this.recentlyRemovedWorkspaces.find(
      (candidate) =>
        candidate.workspace.name === group.title &&
        candidate.workspace.color === group.color &&
        candidate.workspace.tabIds.some((tabId) => tabIdSet.has(tabId)),
    );
    const workspace = activeMatch ?? removedMatch?.workspace;
    if (!workspace) return;

    workspace.tabGroupId = group.id;
    workspace.tabIds = tabIds;
    workspace.name = group.title || workspace.name;
    workspace.color = group.color;

    if (!activeMatch) {
      this.workspaces.push(workspace);
    }
    this.recentlyRemovedWorkspaces = this.recentlyRemovedWorkspaces.filter(
      (candidate) => candidate.workspace.id !== workspace.id,
    );
    await this.save();
    logger.info("workspace", "Reconnected workspace group after window move", {
      workspaceId: workspace.id,
      groupId: group.id,
      windowId: group.windowId,
      tabCount: tabIds.length,
    });
  }

  // --- CRUD ---

  /**
   * Apply title and color to a tab group with retries.
   * Chrome can silently drop title updates on freshly-created groups.
   * Returns true if the title was confirmed applied.
   */
  private async applyGroupTitle(
    groupId: number,
    title: string,
    color: chrome.tabGroups.ColorEnum,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt)));
        }
        await chrome.tabGroups.update(groupId, { title, color });
        const verify = await chrome.tabGroups.get(groupId);
        if (verify.title === title) return true;
        logger.warn("workspace", "Title not applied, retrying", {
          groupId,
          attempt: attempt + 1,
          expected: title,
          actual: verify.title,
        });
      } catch (e) {
        logger.warn("workspace", "tabGroups.update threw, retrying", {
          groupId,
          attempt: attempt + 1,
          error: e,
        });
      }
    }
    return false;
  }

  public async createWorkspace(
    name: string,
    color: chrome.tabGroups.ColorEnum = GROUP_COLOR,
    initialTabId?: number,
  ): Promise<Workspace> {
    await this.ensureInitialized();
    return this.withMutationLock(async () => {
      if (initialTabId === undefined) {
        throw new Error("Cannot create a grouped workspace without a tab");
      }

    logger.info("workspace", "Creating workspace started", {
      name,
      initialTabId,
    });
      await chrome.tabs.get(initialTabId);
      const groupId = await chrome.tabs.group({ tabIds: [initialTabId] });
        const titled = await this.applyGroupTitle(groupId, name, color);
        if (!titled) {
        await chrome.tabs.ungroup(initialTabId).catch(() => undefined);
        throw new Error(`Failed to apply title to workspace group ${groupId}`);
    }

    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name,
      baseName: name,
      color,
      tabGroupId: groupId,
        tabIds: [initialTabId],
    };
      const previousNextWorkspaceNum = this.nextWorkspaceNum;
    this.workspaces.push(workspace);
    this.nextWorkspaceNum++;
      try {
    await this.save();
      } catch (error) {
        this.removeWorkspaceRecord(workspace.id);
        this.nextWorkspaceNum = previousNextWorkspaceNum;
        await chrome.tabs.ungroup(initialTabId).catch(() => undefined);
        throw error;
      }

    logger.info("workspace", "Workspace created", {
      name: workspace.name,
      id: workspace.id,
      groupId: workspace.tabGroupId,
      tabCount: workspace.tabIds.length,
    });
      return { ...workspace, tabIds: [...workspace.tabIds] };
    });
  }

  /**
   * Update workspace name and/or color, syncing to the Chrome tab group.
   */
  public async updateWorkspace(
    id: string,
    updates: {
      name?: string;
      baseName?: string;
      color?: chrome.tabGroups.ColorEnum;
    },
  ): Promise<void> {
    await this.ensureInitialized();
    await this.withMutationLock(async () => {
    const ws = this.workspaces.find((w) => w.id === id);
    if (!ws) return;
      const previous = { ...ws, tabIds: [...ws.tabIds] };

        const groupUpdates: chrome.tabGroups.UpdateProperties = {};
        if (updates.name !== undefined) groupUpdates.title = updates.name;
        if (updates.color !== undefined) groupUpdates.color = updates.color;
      if (ws.tabGroupId !== null && Object.keys(groupUpdates).length > 0) {
        await chrome.tabGroups.update(ws.tabGroupId, groupUpdates);
    }

      if (updates.name !== undefined) ws.name = updates.name;
      if (updates.baseName !== undefined) ws.baseName = updates.baseName;
      if (updates.color !== undefined) ws.color = updates.color;
      try {
    await this.save();
      } catch (error) {
        Object.assign(ws, previous);
        if (ws.tabGroupId !== null && Object.keys(groupUpdates).length > 0) {
          await chrome.tabGroups
            .update(ws.tabGroupId, {
              ...(updates.name !== undefined ? { title: previous.name } : {}),
              ...(updates.color !== undefined ? { color: previous.color } : {}),
            })
            .catch(() => undefined);
        }
        throw error;
      }
    });
  }

  /**
   * Remove a tab from its workspace. Auto-deletes the workspace if it becomes empty.
   */
  public async removeTabFromWorkspace(
    tabId: number,
    workspaceId?: string,
  ): Promise<void> {
    await this.ensureInitialized();
    await this.withMutationLock(async () => {
    const ws = workspaceId
      ? this.workspaces.find((w) => w.id === workspaceId)
      : this.getWorkspaceByTabId(tabId);
      if (!ws || !this.removeTabFromWorkspaceRecord(tabId, ws)) return;
      await this.save();
    });
  }

  public async getNextWorkspaceName(): Promise<string> {
    await this.ensureInitialized();
    await this.mutationTail;
    return `OS ${this.nextWorkspaceNum}`;
  }

  public getNextColor(): chrome.tabGroups.ColorEnum {
    return GROUP_COLOR;
  }

  public async getWorkspaceForTab(tabId: number): Promise<Workspace | null> {
    await this.ensureInitialized();
    await this.mutationTail;
    const workspace =
      this.workspaces.find((ws) => ws.tabIds.includes(tabId)) || null;
    return workspace ? { ...workspace, tabIds: [...workspace.tabIds] } : null;
  }

  public async getWorkspaceByGroupId(
    groupId: number,
  ): Promise<Workspace | null> {
    await this.ensureInitialized();
    await this.mutationTail;
    const workspace =
      this.workspaces.find((ws) => ws.tabGroupId === groupId) || null;
    return workspace ? { ...workspace, tabIds: [...workspace.tabIds] } : null;
  }

  /**
   * Restore workspace from existing tab group (browser restart scenario)
   */
  public async restoreWorkspaceFromGroup(
    group: chrome.tabGroups.TabGroup,
  ): Promise<Workspace | null> {
    await this.ensureInitialized();
    return this.withMutationLock(async () => {
      const existing = this.workspaces.find(
        (workspace) => workspace.tabGroupId === group.id,
      );
    if (existing) {
      const tabs = await chrome.tabs.query({ groupId: group.id });
        existing.tabIds = tabs.flatMap((tab) =>
          tab.id === undefined ? [] : [tab.id],
        );
      await this.save();
        return { ...existing, tabIds: [...existing.tabIds] };
    }

      const workspaceNumber = parseWorkspaceGroupNumber(group.title);
      if (workspaceNumber === null) return null;
    const tabs = await chrome.tabs.query({ groupId: group.id });
      const tabIds = tabs.flatMap((tab) =>
        tab.id === undefined ? [] : [tab.id],
      );
      if (tabIds.length === 0) return null;

      const baseName = `OS ${workspaceNumber}`;
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: group.title || baseName,
      baseName,
        color: group.color || GROUP_COLOR,
      tabGroupId: group.id,
      tabIds,
    };
    this.workspaces.push(workspace);
      this.nextWorkspaceNum = Math.max(
        this.nextWorkspaceNum,
        workspaceNumber + 1,
      );
    await this.save();
    logger.info("workspace", "Workspace restored from tab group", {
      name: workspace.name,
      tabCount: tabIds.length,
    });
      return { ...workspace, tabIds: [...workspace.tabIds] };
    });
  }

  /**
   * Validate stored workspaces against actual Chrome state.
   * Removes stale workspaces whose groups no longer exist and
   * reconciles tabIds with what Chrome reports.
   */
  public async validateWorkspaces(): Promise<void> {
    await this.ensureInitialized();
    await this.withMutationLock(async () => {
    let changed = false;
      const toDelete = new Set<string>();

    for (const ws of this.workspaces) {
        if (ws.tabGroupId === null) {
          const liveTabIds: number[] = [];
          for (const tabId of ws.tabIds) {
            try {
              const tab = await chrome.tabs.get(tabId);
              if (tab.id !== undefined) liveTabIds.push(tab.id);
            } catch {
              // Closed tracking-only tab.
            }
          }
          if (liveTabIds.length === 0) {
            toDelete.add(ws.id);
          } else if (
            liveTabIds.length !== ws.tabIds.length ||
            !liveTabIds.every((id) => ws.tabIds.includes(id))
          ) {
            ws.tabIds = liveTabIds;
            changed = true;
          }
          continue;
        }

      try {
        const group = await chrome.tabGroups.get(ws.tabGroupId);
        const tabs = await chrome.tabs.query({ groupId: group.id });
          const liveTabIds = tabs.flatMap((tab) =>
            tab.id === undefined ? [] : [tab.id],
          );
          if (liveTabIds.length === 0) {
            toDelete.add(ws.id);
            continue;
          }
        if (
          liveTabIds.length !== ws.tabIds.length ||
          !liveTabIds.every((id) => ws.tabIds.includes(id))
        ) {
          ws.tabIds = liveTabIds;
          changed = true;
        }
        if (group.title && group.title !== ws.name) {
          ws.name = group.title;
            ws.baseName = group.title;
          changed = true;
          } else if (!group.title && ws.name) {
            await chrome.tabGroups.update(group.id, {
              title: ws.name,
              color: ws.color,
            });
        }
        if (group.color && group.color !== ws.color) {
          ws.color = group.color;
          changed = true;
        }
      } catch {
          toDelete.add(ws.id);
      }
    }

    for (const id of toDelete) {
        changed = this.removeWorkspaceRecord(id) || changed;
    }

    if (changed) {
      await this.save();
      logger.info("workspace", "Workspace validation complete", {
          deleted: toDelete.size,
        remaining: this.workspaces.length,
      });
    }
    });
  }

  public async addTabToWorkspace(
    tabId: number,
    workspaceId: string,
  ): Promise<boolean> {
    await this.ensureInitialized();
    return this.withMutationLock(() =>
      this.addTabToWorkspaceUnlocked(tabId, workspaceId),
    );
  }

  private async addTabToWorkspaceUnlocked(
    tabId: number,
    workspaceId: string,
  ): Promise<boolean> {
    const ws = this.workspaces.find((w) => w.id === workspaceId);
    if (!ws) {
      logger.warn(
        "workspace",
        "Attempted to add tab to non-existent workspace",
        { workspaceId, tabId },
      );
      return false;
    }
    const previousOwner = this.getWorkspaceByTabId(tabId);

    if (ws.tabGroupId !== null) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab || tab.id === undefined) return false;

      try {
        const group = await chrome.tabGroups.get(ws.tabGroupId);
        if (tab.windowId !== group.windowId) {
          logger.warn("workspace", "Refused cross-window tab grouping", {
            tabId,
            tabWindowId: tab.windowId,
            groupWindowId: group.windowId,
            workspaceId,
          });
          return false;
        }
        await chrome.tabs.group({
          tabIds: [tabId],
          groupId: ws.tabGroupId,
        });
      } catch (groupError) {
        const groupStillExists = await chrome.tabGroups
          .get(ws.tabGroupId)
          .then(() => true)
          .catch(() => false);
        if (groupStillExists) {
          logger.warn("workspace", "Failed to add tab to existing group", {
            tabId,
            workspaceId,
            error: groupError,
          });
          return false;
        }

        logger.warn("workspace", "Group stale, recreating", {
          staleGroupId: ws.tabGroupId,
          error: groupError,
        });
        try {
          const candidateIds = [...new Set([...ws.tabIds, tabId])];
          const candidateTabs = await Promise.all(
            candidateIds.map((candidateId) =>
              chrome.tabs.get(candidateId).catch(() => null),
            ),
          );
          const liveTabIds = candidateTabs.flatMap((candidate) =>
            candidate?.id !== undefined && candidate.windowId === tab.windowId
              ? [candidate.id]
              : [],
          );
          if (!liveTabIds.includes(tabId)) return false;
          const newGroupId = await chrome.tabs.group({
            tabIds: liveTabIds,
            createProperties: { windowId: tab.windowId },
          });
          const titled = await this.applyGroupTitle(
            newGroupId,
            ws.name,
            ws.color,
          );
          if (!titled) {
            await chrome.tabs.ungroup(liveTabIds).catch(() => undefined);
            return false;
          }
          ws.tabGroupId = newGroupId;
          ws.tabIds = liveTabIds;
        } catch (recreateError) {
          logger.warn("workspace", "Failed to recreate group", {
            error: recreateError,
          });
          return false;
        }
      }
    }

    if (previousOwner && previousOwner.id !== ws.id) {
      this.removeTabFromWorkspaceRecord(tabId, previousOwner);
    }
    if (!ws.tabIds.includes(tabId)) {
      ws.tabIds.push(tabId);
    }
    await this.save();
    return true;
  }

  /**
   * Ensure a workspace record exists for an agent run whose workspaceId was
   * minted OUTSIDE the side-panel flow (e2e harness, headless integrations).
   * Side-panel runs always have a real workspace; synthetic ids ("e2e-…")
   * previously had none, which silently disabled every tab-ownership feature:
   * page-opened-tab adoption, the Open Tabs prompt section, and
   * workspace-scoped list_tabs. Tracking-only — no Chrome tab group is
   * created; the record just anchors which tabs belong to the run.
   */
  public async ensureTrackingWorkspace(
    workspaceId: string,
    initialTabId: number,
  ): Promise<void> {
    await this.ensureInitialized();
    if (!workspaceId || workspaceId === "default") return;

    await this.withMutationLock(async () => {
    const existing = this.workspaces.find((w) => w.id === workspaceId);
    if (existing) {
      if (!existing.tabIds.includes(initialTabId)) {
          if (existing.tabGroupId !== null) {
            await this.addTabToWorkspaceUnlocked(initialTabId, workspaceId);
          } else {
        existing.tabIds.push(initialTabId);
        await this.save();
      }
        }
      return;
    }

    const owner = this.getWorkspaceByTabId(initialTabId);
    if (owner) {
        logger.warn("workspace", "Tracking workspace skipped - tab has owner", {
        workspaceId,
        initialTabId,
        ownerWorkspaceId: owner.id,
      });
      return;
    }

    this.workspaces.push({
      id: workspaceId,
      name: workspaceId,
      color: GROUP_COLOR,
      tabGroupId: null,
      tabIds: [initialTabId],
    });
    await this.save();
    logger.info("workspace", "Created tracking workspace for agent run", {
      workspaceId,
      initialTabId,
    });
    });
  }

  public async getWorkspaceById(id: string): Promise<Workspace | null> {
    await this.ensureInitialized();
    await this.mutationTail;
    const workspace = this.workspaces.find((ws) => ws.id === id) || null;
    return workspace ? { ...workspace, tabIds: [...workspace.tabIds] } : null;
  }

  public async getWorkspaces(): Promise<Workspace[]> {
    await this.ensureInitialized();
    await this.mutationTail;
    return this.workspaces.map((workspace) => ({
      ...workspace,
      tabIds: [...workspace.tabIds],
    }));
  }

  public async deleteWorkspace(id: string): Promise<void> {
    await this.ensureInitialized();
    await this.withMutationLock(async () => {
    const ws = this.workspaces.find((w) => w.id === id);
    if (!ws) return;

      const workspaceIndex = this.workspaces.indexOf(ws);
      const groupedTabIds =
        ws.tabGroupId === null
          ? []
          : (
              await chrome.tabs
                .query({ groupId: ws.tabGroupId })
                .catch(() => [])
            ).flatMap((tab) => (tab.id === undefined ? [] : [tab.id]));

      this.removeWorkspaceRecord(id);
      try {
        await this.save();
      } catch (error) {
        this.workspaces.splice(workspaceIndex, 0, ws);
        throw error;
      }

      if (groupedTabIds.length > 0) {
      try {
          await chrome.tabs.ungroup(groupedTabIds);
        } catch (error) {
          const groupStillExists =
            ws.tabGroupId !== null &&
            (await chrome.tabGroups
              .get(ws.tabGroupId)
              .then(() => true)
              .catch(() => false));
          if (groupStillExists) {
            this.workspaces.splice(workspaceIndex, 0, ws);
            await this.save();
            throw error;
        }
      }
    }

    logger.info("workspace", "Workspace deleted", { name: ws.name, id });
    });
  }

  private async save() {
    await this.deps.storageLocal.set({
      [STORAGE_KEY_WORKSPACES]: this.workspaces,
      [STORAGE_KEY_NEXT_NUM]: this.nextWorkspaceNum,
    });
  }

  public async getActiveWorkspace(): Promise<Workspace | null> {
    await this.ensureInitialized();

    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!activeTab?.id) return null;

    return this.getWorkspaceForTab(activeTab.id);
  }

  public async isTabInActiveWorkspace(tabId: number): Promise<boolean> {
    await this.ensureInitialized();
    const activeWorkspace = await this.getActiveWorkspace();
    if (!activeWorkspace) return false;
    return activeWorkspace.tabIds.includes(tabId);
  }
}

export const workspaceManager = new WorkspaceManager();
