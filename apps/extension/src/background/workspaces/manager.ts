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

export class WorkspaceManager {
  private workspaces: Workspace[] = [];
  private nextWorkspaceNum = 1;
  private initialized = false;
  private listenersSetup = false;
  private deps: Required<WorkspaceManagerDeps>;

  /**
   * Tab IDs currently being ungrouped by the agent.
   * The handleTabGroupChanged listener skips re-adding these tabs so the
   * agent doesn't fight with the "locked workspace" behavior.
   */
  private _bypassRegroup = new Set<number>();

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
    this.init();
  }

  private async init(retryCount = 0): Promise<void> {
    if (this.initialized) return;

    if (this.deps.isContentScript()) {
      logger.debug(
        "workspace",
        "Skipping WorkspaceManager init in content script",
      );
      return;
    }

    try {
      const stored = await this.deps.storageLocal.get([
        STORAGE_KEY_WORKSPACES,
        STORAGE_KEY_NEXT_NUM,
      ]);
      this.workspaces = stored[STORAGE_KEY_WORKSPACES] || [];
      this.nextWorkspaceNum = stored[STORAGE_KEY_NEXT_NUM] || 1;
      this.initialized = true;

      this.setupListeners();
      logger.info("workspace", "WorkspaceManager initialized", {
        count: this.workspaces.length,
      });

      // Re-apply title + color to every persisted tab group so they survive
      // browser / service-worker restarts.
      this.reconcileTabGroups();
    } catch (error) {
      logger.error("workspace", "Failed to initialize WorkspaceManager", {
        error,
        attempt: retryCount + 1,
      });
      if (retryCount < 3) {
        const delay = 1000 * Math.pow(2, retryCount);
        await new Promise((r) => setTimeout(r, delay));
        return this.init(retryCount + 1);
      }
    }
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

    // Bind once and store references to avoid duplicate registrations
    const boundTabRemoved = this.handleTabRemoved.bind(this);
    const boundGroupChanged = this.handleTabGroupChanged.bind(this);

    chrome.tabs.onRemoved.addListener(boundTabRemoved);

    if (chrome.tabGroups?.onRemoved) {
      chrome.tabGroups.onRemoved.addListener(
        this.handleGroupRemoved.bind(this),
      );
    }

    if (chrome.tabs?.onUpdated) {
      chrome.tabs.onUpdated.addListener(boundGroupChanged);
    }

    this.listenersSetup = true;
  }

  /**
   * Re-apply title + color to every persisted tab group.
   * Chrome tab groups survive browser restarts but the extension may not have
   * called tabGroups.update since the last SW wake-up.  Fire-and-forget.
   */
  private reconcileTabGroups(): void {
    for (const ws of this.workspaces) {
      if (ws.tabGroupId === null) continue;
      chrome.tabGroups
        .update(ws.tabGroupId, { title: ws.name, color: ws.color })
        .then(() => {
          logger.debug("workspace", "Reconciled tab group title", {
            groupId: ws.tabGroupId,
            title: ws.name,
          });
        })
        .catch((e) => {
          logger.warn("workspace", "Failed to reconcile tab group", {
            groupId: ws.tabGroupId,
            name: ws.name,
            error: e,
          });
        });
    }
  }

  /**
   * Handle tabs whose Chrome group changed (ungrouped OR moved to a different group).
   * Enforces "locked workspace" behavior: if a workspace tab is moved out of its
   * group, re-add it. On failure, clean up the stale reference.
   */
  private async handleTabGroupChanged(
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    _tab: chrome.tabs.Tab,
  ) {
    // Only care about group changes
    if (changeInfo.groupId === undefined) return;

    // Skip agent-initiated ungroups
    if (this._bypassRegroup.has(tabId)) return;

    const workspace = this.getWorkspaceByTabId(tabId);
    if (!workspace || workspace.tabGroupId === null) return;

    const isUngrouped =
      changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE;
    const isMovedToOtherGroup =
      !isUngrouped && changeInfo.groupId !== workspace.tabGroupId;

    if (!isUngrouped && !isMovedToOtherGroup) return;

    logger.debug(
      "workspace",
      isUngrouped
        ? "Tab manually ungrouped, re-adding to workspace"
        : "Tab moved to different group, re-adding to workspace",
      { tabId, workspace: workspace.name, newGroupId: changeInfo.groupId },
    );

    try {
      await chrome.tabs.group({
        tabIds: [tabId],
        groupId: workspace.tabGroupId,
      });
    } catch (e) {
      // Re-group failed (group might be gone). Remove stale tab reference.
      logger.warn("workspace", "Failed to re-add tab to workspace, removing", {
        tabId,
        workspace: workspace.name,
        error: e,
      });
      const idx = workspace.tabIds.indexOf(tabId);
      if (idx !== -1) {
        workspace.tabIds.splice(idx, 1);
        if (workspace.tabIds.length === 0) {
          await this.deleteWorkspace(workspace.id);
        } else {
          await this.save();
        }
      }
    }
  }

  private getWorkspaceByTabId(tabId: number): Workspace | null {
    return this.workspaces.find((ws) => ws.tabIds.includes(tabId)) || null;
  }

  private async handleTabRemoved(tabId: number) {
    let changed = false;

    for (const ws of this.workspaces) {
      const idx = ws.tabIds.indexOf(tabId);
      if (idx !== -1) {
        ws.tabIds.splice(idx, 1);
        changed = true;

        if (ws.tabIds.length === 0) {
          logger.info("workspace", "Auto-deleting empty workspace", {
            name: ws.name,
          });
          await this.deleteWorkspace(ws.id);
          return;
        }
      }
    }

    if (changed) {
      await this.save();
    }
  }

  private async handleGroupRemoved(group: chrome.tabGroups.TabGroup) {
    const ws = this.workspaces.find((w) => w.tabGroupId === group.id);
    if (ws) {
      logger.info("workspace", "Tab Group removed externally", {
        name: ws.name,
      });
      // deleteWorkspace handles ungrouping and cleanup
      await this.deleteWorkspace(ws.id);
    }
  }

  // --- Bypass API for agent-initiated group changes ---

  /**
   * Mark tab IDs as being intentionally ungrouped/moved by the agent.
   * The locked-workspace listener will skip these tabs.
   */
  public bypassRegroup(tabIds: number[]) {
    for (const id of tabIds) this._bypassRegroup.add(id);
  }

  /**
   * Clear the bypass flag after the agent operation completes.
   */
  public clearBypassRegroup(tabIds: number[]) {
    for (const id of tabIds) this._bypassRegroup.delete(id);
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
    logger.info("workspace", "Creating workspace started", {
      name,
      initialTabId,
    });
    await this.init();

    let groupId: number | null = null;
    const tabIds: number[] = [];
    const tabId = initialTabId;

    if (tabId) {
      logger.info("workspace", "Attempting to group tab", { tabId });
      try {
        const tabInfo = await chrome.tabs.get(tabId);
        logger.info("workspace", "Tab info retrieved", {
          tabId,
          url: tabInfo.url,
          currentGroupId: tabInfo.groupId,
        });

        groupId = await chrome.tabs.group({ tabIds: [tabId] });
        // Track the tab immediately — even if titling fails, the tab IS
        // in this Chrome group.  Without this, getWorkspaceForTab() can't
        // find the workspace and subsequent opens create duplicate groups.
        tabIds.push(tabId);
        logger.info("workspace", "Tab grouped successfully", {
          groupId,
          tabId,
        });

        const titled = await this.applyGroupTitle(groupId, name, color);
        if (!titled) {
          // Title refused to stick after retries — ungroup to avoid
          // leaving an orphaned untitled group in the tab strip.
          logger.error(
            "workspace",
            "Failed to apply title after retries, ungrouping",
            { groupId, name },
          );
          try {
            await chrome.tabs.ungroup(tabId);
          } catch {
            /* ignore */
          }
          groupId = null;
          tabIds.length = 0;
        } else {
          logger.info("workspace", "Group updated with name and color", {
            groupId,
            name,
            color,
          });
        }
      } catch (e) {
        logger.error("workspace", "Failed to create group with tab", {
          tabId,
          error: e,
          errorMessage: e instanceof Error ? e.message : String(e),
        });
        // If group was created but something else threw, try to recover
        // the title so we don't leave an untitled group.
        if (groupId !== null) {
          try {
            await chrome.tabGroups.update(groupId, { title: name, color });
          } catch {
            // Can't title it — ungroup to prevent orphaned untitled group
            try {
              await chrome.tabs.ungroup(tabId!);
            } catch {
              /* ignore */
            }
            groupId = null;
            tabIds.length = 0;
          }
        }
      }
    } else {
      logger.warn("workspace", "No tabId provided for workspace creation");
    }

    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name,
      baseName: name,
      color,
      tabGroupId: groupId,
      tabIds,
    };

    this.workspaces.push(workspace);
    this.nextWorkspaceNum++;
    await this.save();

    logger.info("workspace", "Workspace created", {
      name: workspace.name,
      id: workspace.id,
      groupId: workspace.tabGroupId,
      tabCount: workspace.tabIds.length,
    });

    return workspace;
  }

  /**
   * Update workspace name and/or color, syncing to the Chrome tab group.
   */
  public async updateWorkspace(
    id: string,
    updates: { name?: string; color?: chrome.tabGroups.ColorEnum },
  ): Promise<void> {
    await this.init();
    const ws = this.workspaces.find((w) => w.id === id);
    if (!ws) return;

    if (updates.name !== undefined) ws.name = updates.name;
    if (updates.color !== undefined) ws.color = updates.color;

    // Sync to Chrome tab group
    if (ws.tabGroupId !== null) {
      try {
        const groupUpdates: chrome.tabGroups.UpdateProperties = {};
        if (updates.name !== undefined) groupUpdates.title = updates.name;
        if (updates.color !== undefined) groupUpdates.color = updates.color;
        await chrome.tabGroups.update(ws.tabGroupId, groupUpdates);
      } catch (e) {
        logger.warn("workspace", "Failed to sync group update to Chrome", {
          id,
          error: e,
        });
      }
    }

    await this.save();
  }

  /**
   * Remove a tab from its workspace. Auto-deletes the workspace if it becomes empty.
   */
  public async removeTabFromWorkspace(
    tabId: number,
    workspaceId?: string,
  ): Promise<void> {
    await this.init();
    const ws = workspaceId
      ? this.workspaces.find((w) => w.id === workspaceId)
      : this.getWorkspaceByTabId(tabId);
    if (!ws) return;

    const idx = ws.tabIds.indexOf(tabId);
    if (idx === -1) return;

    ws.tabIds.splice(idx, 1);
    if (ws.tabIds.length === 0) {
      await this.deleteWorkspace(ws.id);
    } else {
      await this.save();
    }
  }

  public getNextWorkspaceName(): string {
    return `OS ${this.nextWorkspaceNum}`;
  }

  public getNextColor(): chrome.tabGroups.ColorEnum {
    return GROUP_COLOR;
  }

  public async getWorkspaceForTab(tabId: number): Promise<Workspace | null> {
    await this.init();
    return this.workspaces.find((ws) => ws.tabIds.includes(tabId)) || null;
  }

  public async getWorkspaceByGroupId(
    groupId: number,
  ): Promise<Workspace | null> {
    await this.init();
    return this.workspaces.find((ws) => ws.tabGroupId === groupId) || null;
  }

  /**
   * Restore workspace from existing tab group (browser restart scenario)
   */
  public async restoreWorkspaceFromGroup(
    group: chrome.tabGroups.TabGroup,
  ): Promise<Workspace | null> {
    await this.init();

    // Check if workspace already exists for this group
    const existing = await this.getWorkspaceByGroupId(group.id);
    if (existing) {
      // Sync tabIds from Chrome (they may have changed during restart)
      const tabs = await chrome.tabs.query({ groupId: group.id });
      existing.tabIds = tabs.map((t) => t.id!).filter(Boolean);
      await this.save();
      return existing;
    }

    // Get tabs in the group
    const tabs = await chrome.tabs.query({ groupId: group.id });
    const tabIds = tabs.map((t) => t.id!).filter(Boolean);

    // Parse workspace number from title if possible
    const match = group.title?.match(/(?:OpenSidebar|OS) (\d+)/);
    const num = match ? parseInt(match[1]) : this.nextWorkspaceNum;

    const baseName = `OS ${num}`;
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: group.title || baseName,
      baseName,
      color: group.color || "blue",
      tabGroupId: group.id,
      tabIds,
    };

    this.workspaces.push(workspace);
    this.nextWorkspaceNum = Math.max(this.nextWorkspaceNum, num + 1);
    await this.save();

    logger.info("workspace", "Workspace restored from tab group", {
      name: workspace.name,
      tabCount: tabIds.length,
    });

    return workspace;
  }

  /**
   * Validate stored workspaces against actual Chrome state.
   * Removes stale workspaces whose groups no longer exist and
   * reconciles tabIds with what Chrome reports.
   */
  public async validateWorkspaces(): Promise<void> {
    await this.init();
    let changed = false;
    const toDelete: string[] = [];

    for (const ws of this.workspaces) {
      if (ws.tabGroupId === null) continue;

      try {
        // Check if the Chrome group still exists
        const group = await chrome.tabGroups.get(ws.tabGroupId);
        // Group exists — reconcile tabIds
        const tabs = await chrome.tabs.query({ groupId: group.id });
        const liveTabIds = tabs.map((t) => t.id!).filter(Boolean);
        if (
          liveTabIds.length !== ws.tabIds.length ||
          !liveTabIds.every((id) => ws.tabIds.includes(id))
        ) {
          ws.tabIds = liveTabIds;
          changed = true;
        }
        // Sync title/color from Chrome → workspace (user may have renamed)
        if (group.title && group.title !== ws.name) {
          ws.name = group.title;
          changed = true;
        }
        if (group.color && group.color !== ws.color) {
          ws.color = group.color;
          changed = true;
        }
      } catch {
        // Group no longer exists — mark for deletion
        toDelete.push(ws.id);
      }
    }

    for (const id of toDelete) {
      this.workspaces = this.workspaces.filter((w) => w.id !== id);
      changed = true;
    }

    if (changed) {
      await this.save();
      logger.info("workspace", "Workspace validation complete", {
        deleted: toDelete.length,
        remaining: this.workspaces.length,
      });
    }
  }

  public async addTabToWorkspace(
    tabId: number,
    workspaceId: string,
  ): Promise<void> {
    await this.init();

    const ws = this.workspaces.find((w) => w.id === workspaceId);
    if (!ws) {
      logger.warn(
        "workspace",
        "Attempted to add tab to non-existent workspace",
        { workspaceId, tabId },
      );
      return;
    }

    if (ws.tabGroupId !== null) {
      try {
        await chrome.tabs.group({
          tabIds: [tabId],
          groupId: ws.tabGroupId,
        });
      } catch (e) {
        // Group is likely stale — recreate with all tracked tabs + the new one
        logger.warn("workspace", "Group stale, recreating", {
          staleGroupId: ws.tabGroupId,
          error: e,
        });
        try {
          const allTabIds = ws.tabIds.includes(tabId)
            ? ws.tabIds
            : [...ws.tabIds, tabId];
          const newGroupId = await chrome.tabs.group({ tabIds: allTabIds });
          ws.tabGroupId = newGroupId;
          await this.applyGroupTitle(newGroupId, ws.name, ws.color);
        } catch (e2) {
          logger.warn("workspace", "Failed to recreate group", { error: e2 });
        }
      }
    }

    if (!ws.tabIds.includes(tabId)) {
      ws.tabIds.push(tabId);
      await this.save();
    }
  }

  public async getWorkspaceById(id: string): Promise<Workspace | null> {
    await this.init();
    return this.workspaces.find((ws) => ws.id === id) || null;
  }

  public async getWorkspaces(): Promise<Workspace[]> {
    await this.init();
    return this.workspaces;
  }

  public async deleteWorkspace(id: string) {
    await this.init();
    const ws = this.workspaces.find((w) => w.id === id);
    if (!ws) return;

    // Bypass the locked-workspace listener for tabs we're about to ungroup
    this.bypassRegroup(ws.tabIds);

    if (ws.tabGroupId !== null) {
      try {
        const tabs = await chrome.tabs.query({ groupId: ws.tabGroupId });
        if (tabs.length > 0) {
          await chrome.tabs.ungroup(tabs.map((t) => t.id!));
        }
      } catch (_e) {
        // Group might be gone
      }
    }

    this.clearBypassRegroup(ws.tabIds);
    this.workspaces = this.workspaces.filter((w) => w.id !== id);
    await this.save();

    logger.info("workspace", "Workspace deleted", { name: ws.name, id });
  }

  private async save() {
    await this.deps.storageLocal.set({
      [STORAGE_KEY_WORKSPACES]: this.workspaces,
      [STORAGE_KEY_NEXT_NUM]: this.nextWorkspaceNum,
    });
  }

  public async getActiveWorkspace(): Promise<Workspace | null> {
    await this.init();

    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!activeTab?.id) return null;

    return this.getWorkspaceForTab(activeTab.id);
  }

  public async isTabInActiveWorkspace(tabId: number): Promise<boolean> {
    await this.init();
    const activeWorkspace = await this.getActiveWorkspace();
    if (!activeWorkspace) return false;
    return activeWorkspace.tabIds.includes(tabId);
  }
}

export const workspaceManager = new WorkspaceManager();
