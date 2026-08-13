export const SIDEPANEL_PATH = "src/sidepanel/index.html";

type SidePanelOptionsPort = Pick<typeof chrome.sidePanel, "setOptions">;

type WorkspaceMembership = {
  tabGroupId: number | null;
} | null;

export function belongsToVisibleWorkspace(
  chromeGroupId: number | undefined,
  workspace: WorkspaceMembership,
): boolean {
  if (!workspace) return false;
  if (
    chromeGroupId === undefined ||
    chromeGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE
  ) {
    return workspace.tabGroupId === null;
  }
  return workspace.tabGroupId === chromeGroupId;
}

/** Disable manifest-global inheritance at the earliest new-tab event. */
export function hidePanelForNewUngroupedTab(
  sidePanel: SidePanelOptionsPort,
  tab: Pick<chrome.tabs.Tab, "id" | "groupId">,
): Promise<void> | undefined {
  if (
    tab.id === undefined ||
    (tab.groupId !== undefined &&
      tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)
  ) {
    return undefined;
  }
  return setWorkspacePanelVisibility(sidePanel, tab.id, false);
}

export function installUngroupedTabPanelGuards(
  sidePanel: SidePanelOptionsPort,
  tabs: Pick<typeof chrome.tabs, "onCreated" | "onUpdated">,
  onError: (event: "created" | "ungrouped", tabId: number | undefined, error: unknown) => void,
): void {
  tabs.onCreated.addListener((tab) => {
    void hidePanelForNewUngroupedTab(sidePanel, tab)?.catch((error) =>
      onError("created", tab.id, error),
    );
  });
  tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return;
    void setWorkspacePanelVisibility(sidePanel, tabId, false).catch((error) =>
      onError("ungrouped", tabId, error),
    );
  });
}

/**
 * Apply the tab-scoped workspace visibility rule.
 *
 * Disabling a tab is intentional: Chrome hides the panel while that tab is
 * active and restores the previously open panel when the user returns to an
 * enabled tab. Mission execution remains owned by the background worker.
 */
export async function setWorkspacePanelVisibility(
  sidePanel: SidePanelOptionsPort,
  tabId: number,
  visible: boolean,
): Promise<void> {
  await sidePanel.setOptions(
    visible
      ? { tabId, path: SIDEPANEL_PATH, enabled: true }
      : { tabId, enabled: false },
  );
}
