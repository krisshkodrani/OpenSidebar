import { SIDEPANEL_PATH, setWorkspacePanelVisibility } from "../side-panel-visibility";
import { workspaceManager } from "../workspaces/manager";

type WorkspaceRecord = {
  tabGroupId: number | null;
  tabIds: number[];
};

type WorkspacePort = {
  getWorkspaceById(workspaceId: string): Promise<WorkspaceRecord | null>;
  addTabToWorkspace(tabId: number, workspaceId: string): Promise<boolean>;
  getNextWorkspaceName(): Promise<string>;
  getNextColor(): chrome.tabGroups.ColorEnum;
  createWorkspace(
    name: string,
    color: chrome.tabGroups.ColorEnum,
    initialTabId: number,
    workspaceId: string,
  ): Promise<WorkspaceRecord>;
};

type TabsPort = Pick<typeof chrome.tabs, "get" | "group">;
type SidePanelPort = Pick<typeof chrome.sidePanel, "getOptions" | "setOptions">;

type IsolatedWorkspaceDeps = {
  manager: WorkspacePort;
  tabs: TabsPort;
  sidePanel: SidePanelPort;
};

/**
 * Bind an isolated remote tab to a real workspace and prove that Chrome kept
 * both the group membership and tab-scoped sidepanel configuration. Remote
 * execution must not start from a tracking-only or visually detached tab.
 */
export async function ensureIsolatedTaskWorkspace(
  workspaceId: string,
  tabId: number,
  deps: IsolatedWorkspaceDeps = {
    manager: workspaceManager,
    tabs: chrome.tabs,
    sidePanel: chrome.sidePanel,
  },
): Promise<void> {
  let workspace = await deps.manager.getWorkspaceById(workspaceId);
  if (!workspace) {
    workspace = await deps.manager.createWorkspace(
      await deps.manager.getNextWorkspaceName(),
      deps.manager.getNextColor(),
      tabId,
      workspaceId,
    );
  } else if (
    !workspace.tabIds.includes(tabId) &&
    !(await deps.manager.addTabToWorkspace(tabId, workspaceId))
  ) {
    throw new Error("Failed to attach the remote task tab to its workspace.");
  }

  if (workspace.tabGroupId === null) {
    throw new Error("The remote task workspace does not have a Chrome tab group.");
  }

  // Re-assert membership after the workspace record exists so Chrome events
  // cannot leave the task in the tracking-only state observed in acceptance.
  await deps.tabs.group({ tabIds: [tabId], groupId: workspace.tabGroupId });
  const tab = await deps.tabs.get(tabId);
  if (tab.groupId !== workspace.tabGroupId) {
    throw new Error("Chrome did not keep the remote task tab in its workspace group.");
  }

  await setWorkspacePanelVisibility(deps.sidePanel, tabId, true);
  const panel = await deps.sidePanel.getOptions({ tabId });
  if (!panel.enabled || panel.path !== SIDEPANEL_PATH) {
    throw new Error("The OpenSidebar panel is not enabled for the remote task tab.");
  }
}
