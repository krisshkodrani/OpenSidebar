import type { RemoteMissionTargetBindingV1 } from "@shared-types/remote-missions";

import { SIDEPANEL_PATH, setWorkspacePanelVisibility } from "../side-panel-visibility";
import { workspaceManager } from "../workspaces/manager";

type WorkspaceRecord = {
  name: string;
  tabGroupId: number | null;
  tabIds: number[];
};

type WorkspacePort = {
  getWorkspaceForTab(tabId: number): Promise<WorkspaceRecord | null>;
  peekWorkspaceByGroupId?(groupId: number): WorkspaceRecord | null;
};

type IsolatedWorkspaceDeps = {
  manager: WorkspacePort;
  tabs: Pick<typeof chrome.tabs, "get" | "group" | "query">;
  tabGroups: Pick<typeof chrome.tabGroups, "get">;
  sidePanel: Pick<typeof chrome.sidePanel, "getOptions" | "setOptions">;
};

/**
 * Verify that a remote tab belongs to an existing OpenSidebar workspace and
 * return bounded, identifier-free evidence for the remote supervisor.
 */
export async function verifyIsolatedTaskWorkspace(
  tabId: number,
  expectedUrl?: string,
  createdForMission = true,
  deps: IsolatedWorkspaceDeps = {
    manager: workspaceManager,
    tabs: chrome.tabs,
    tabGroups: chrome.tabGroups,
    sidePanel: chrome.sidePanel,
  },
): Promise<RemoteMissionTargetBindingV1> {
  const initialTab = await deps.tabs.get(tabId);
  const workspace =
    (initialTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
      ? deps.manager.peekWorkspaceByGroupId?.(initialTab.groupId)
      : null) ??
    await deps.manager.getWorkspaceForTab(tabId);
  if (!workspace || workspace.tabGroupId === null) {
    throw new Error(
      "The remote task tab is not attached to an existing OpenSidebar workspace.",
    );
  }

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

  const allTabs = await deps.tabs.query({});
  const windowIds = [...new Set(allTabs.map((candidate) => candidate.windowId))]
    .sort((a, b) => a - b);
  const groupTitle = await deps.tabGroups
    .get(workspace.tabGroupId)
    .then((group) => group.title?.trim())
    .catch(() => undefined);
  const pageOrigin = (() => {
    try {
      return tab.url ? new URL(tab.url).origin : undefined;
    } catch {
      return undefined;
    }
  })();
  const expectedUrlMatched = expectedUrl
    ? (() => {
        try {
          return Boolean(tab.url && new URL(tab.url).href === new URL(expectedUrl).href);
        } catch {
          return false;
        }
      })()
    : undefined;

  return {
    context: "isolated_tab",
    ...(pageOrigin && pageOrigin !== "null" ? { pageOrigin } : {}),
    ...(tab.title?.trim() ? { pageTitle: tab.title.trim().slice(0, 160) } : {}),
    ...(expectedUrlMatched === undefined ? {} : { expectedUrlMatched }),
    windowLabel: `Window ${windowIds.indexOf(tab.windowId) + 1}`,
    workspaceTitle: (groupTitle || workspace.name).slice(0, 80),
    inWorkspace: true,
    sidePanelEnabled: true,
    createdForMission,
  };
}
