import { Workspace } from "../../types";
import { logger } from "../../utils";
import { isContentScript } from "../../utils/context";

// Storage keys
const STORAGE_KEY_WORKSPACES = "opensidebar:workspaces";
const STORAGE_KEY_NEXT_NUM = "opensidebar:nextWorkspaceNum";

// Color rotation for workspaces
const WORKSPACE_COLORS: chrome.tabGroups.ColorEnum[] = [
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];

type WorkspaceManagerDeps = {
  isContentScript?: () => boolean;
  storageLocal?: Pick<chrome.storage.StorageArea, "get" | "set">;
};

export class WorkspaceManager {
  private workspaces: Workspace[] = [];
  private nextWorkspaceNum = 1;
  private initialized = false;
  private deps: Required<WorkspaceManagerDeps>;

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

      // Re-sync listeners
      this.setupListeners();
      logger.info("workspace", "WorkspaceManager initialized", {
        count: this.workspaces.length,
      });
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
    // Skip in content scripts - APIs not available
    if (this.deps.isContentScript()) {
      logger.debug("workspace", "Skipping listener setup in content script");
      return;
    }

    // Defensive: skip if chrome APIs not available (e.g., in test environment)
    if (typeof chrome === "undefined" || !chrome.tabs?.onRemoved) {
      logger.debug(
        "workspace",
        "Skipping listener setup - chrome.tabs not available",
      );
      return;
    }

    // Listen for tab removal to update workspace tab lists and auto-delete empty workspaces
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));

    // Listen for tab group removal to clean up workspaces
    if (chrome.tabGroups?.onRemoved) {
      chrome.tabGroups.onRemoved.addListener(
        this.handleGroupRemoved.bind(this),
      );
    }

    // Listen for tabs being ungrouped (manual drag out) - RE-ADD them to lock workspace
    if (chrome.tabs?.onUpdated) {
      chrome.tabs.onUpdated.addListener(this.handleTabUngrouped.bind(this));
    }
  }

  /**
   * Handle tabs being manually ungrouped - re-add them to preserve workspace integrity
   * This enforces the "locked workspace" behavior
   */
  private async handleTabUngrouped(
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    _tab: chrome.tabs.Tab,
  ) {
    // Check if tab was ungrouped (groupId changed to -1)
    if (changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      // Find if this tab should be in a workspace
      const workspace = this.getWorkspaceByTabId(tabId);
      if (workspace && workspace.tabGroupId !== null) {
        logger.debug(
          "workspace",
          "Tab manually ungrouped, re-adding to workspace",
          {
            tabId,
            workspace: workspace.name,
          },
        );

        try {
          // Re-add tab to the workspace group
          await chrome.tabs.group({
            tabIds: [tabId],
            groupId: workspace.tabGroupId,
          });
        } catch (e) {
          logger.warn("workspace", "Failed to re-add tab to workspace", {
            tabId,
            workspace: workspace.name,
            error: e,
          });
        }
      }
    }
  }

  /**
   * Get workspace by tab ID (synchronous lookup)
   */
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

        // Auto-delete workspace if empty
        if (ws.tabIds.length === 0) {
          logger.info("workspace", "Auto-deleting empty workspace", {
            name: ws.name,
          });
          await this.deleteWorkspace(ws.id);
          return; // Workspace deleted, no need to save
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
      ws.tabGroupId = null;
      ws.tabIds = [];
      // Auto-delete workspace when group is removed
      await this.deleteWorkspace(ws.id);
    }
  }

  public async createWorkspace(
    name: string,
    color: chrome.tabGroups.ColorEnum = "blue",
    initialTabId?: number,
  ): Promise<Workspace> {
    logger.info("workspace", "Creating workspace started", {
      name,
      initialTabId,
    });
    await this.init();

    let groupId: number | null = null;
    const tabIds: number[] = [];

    // Use provided tabId or fall back to querying active tab
    const tabId = initialTabId;

    if (tabId) {
      logger.info("workspace", "Attempting to group tab", { tabId });
      try {
        // First check if tab exists and get its info
        const tabInfo = await chrome.tabs.get(tabId);
        logger.info("workspace", "Tab info retrieved", {
          tabId,
          url: tabInfo.url,
          currentGroupId: tabInfo.groupId,
        });

        groupId = await chrome.tabs.group({ tabIds: [tabId] });
        logger.info("workspace", "Tab grouped successfully", {
          groupId,
          tabId,
        });

        await chrome.tabGroups.update(groupId, { title: name, color });
        logger.info("workspace", "Group updated with name and color", {
          groupId,
          name,
          color,
        });

        tabIds.push(tabId);
      } catch (e) {
        logger.error("workspace", "Failed to create group with tab", {
          tabId,
          error: e,
          errorMessage: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      logger.warn("workspace", "No tabId provided for workspace creation");
    }

    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name,
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
   * Get the next sequential workspace name ("OS 1", "OS 2", etc.)
   */
  public getNextWorkspaceName(): string {
    return `OS ${this.nextWorkspaceNum}`;
  }

  /**
   * Get the next color in the rotation
   */
  public getNextColor(): chrome.tabGroups.ColorEnum {
    return WORKSPACE_COLORS[this.workspaces.length % WORKSPACE_COLORS.length];
  }

  /**
   * Get workspace that contains a specific tab
   */
  public async getWorkspaceForTab(tabId: number): Promise<Workspace | null> {
    await this.init();
    return this.workspaces.find((ws) => ws.tabIds.includes(tabId)) || null;
  }

  /**
   * Get workspace that owns a specific tab group
   */
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
      return existing;
    }

    // Get tabs in the group
    const tabs = await chrome.tabs.query({ groupId: group.id });
    const tabIds = tabs.map((t) => t.id!).filter(Boolean);

    // Parse workspace number from title if possible (supports legacy "OpenSidebar N" and new "OS N")
    const match = group.title?.match(/(?:OpenSidebar|OS) (\d+)/);
    const num = match ? parseInt(match[1]) : this.nextWorkspaceNum;

    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: group.title || `OS ${num}`,
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
   * Add a tab to a workspace
   */
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
        {
          workspaceId,
          tabId,
        },
      );
      return;
    }

    // Add tab to Chrome group
    if (ws.tabGroupId !== null) {
      try {
        await chrome.tabs.group({
          tabIds: [tabId],
          groupId: ws.tabGroupId,
        });
      } catch (e) {
        logger.warn("workspace", "Failed to add tab to group", { error: e });
      }
    }

    // Track in workspace
    if (!ws.tabIds.includes(tabId)) {
      ws.tabIds.push(tabId);
      await this.save();
    }
  }

  /**
   * Look up a workspace by its ID
   */
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

    // Ungroup tabs if group exists
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

  /**
   * Get the active workspace for sidebar interactions
   * Returns the workspace associated with the currently active tab
   */
  public async getActiveWorkspace(): Promise<Workspace | null> {
    await this.init();

    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!activeTab?.id) return null;

    return this.getWorkspaceForTab(activeTab.id);
  }

  /**
   * Check if a tab is in the currently active workspace
   */
  public async isTabInActiveWorkspace(tabId: number): Promise<boolean> {
    await this.init();
    const activeWorkspace = await this.getActiveWorkspace();
    if (!activeWorkspace) return false;
    return activeWorkspace.tabIds.includes(tabId);
  }
}

export const workspaceManager = new WorkspaceManager();
