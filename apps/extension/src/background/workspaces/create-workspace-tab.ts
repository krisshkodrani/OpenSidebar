import type { WorkspaceManager } from "./manager";
import { workspaceManager } from "./manager";

type WorkspaceTabManager = Pick<WorkspaceManager, "addTabToWorkspace">;

export async function createWorkspaceTab(options: {
  sourceTabId: number;
  url: string;
  workspaceId?: string | null;
  manager?: WorkspaceTabManager;
  adoptionMode?: "managed" | "live_group";
}): Promise<chrome.tabs.Tab & { id: number }> {
  const sourceTab = await chrome.tabs.get(options.sourceTabId);
  const tab = await chrome.tabs.create({
    url: options.url,
    active: false,
    windowId: sourceTab.windowId,
  });
  if (tab.id === undefined) {
    throw new Error("Chrome did not return a new tab ID");
  }

  if (options.workspaceId && options.workspaceId !== "default") {
    const manager = options.manager ?? workspaceManager;
    if (options.adoptionMode === "live_group") {
      if (
        sourceTab.groupId === undefined ||
        sourceTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
      ) {
        await chrome.tabs.remove(tab.id).catch(() => undefined);
        throw new Error("The source workspace tab is not in a live Chrome group");
      }
      try {
        await chrome.tabs.group({
          tabIds: [tab.id],
          groupId: sourceTab.groupId,
        });
        const grouped = await chrome.tabs.get(tab.id);
        if (grouped.groupId !== sourceTab.groupId)
          throw new Error("Chrome did not retain the requested workspace group");
      } catch (error) {
        await chrome.tabs.remove(tab.id).catch(() => undefined);
        throw error;
      }
      // Chrome is the placement authority. Persist the manager projection in
      // the background; its mutation queue must not delay visible grouping.
      void manager
        .addTabToWorkspace(tab.id, options.workspaceId)
        .catch(() => undefined);
      return tab as chrome.tabs.Tab & { id: number };
    }
    const added = await manager.addTabToWorkspace(tab.id, options.workspaceId);
    if (!added) {
      await chrome.tabs.remove(tab.id).catch(() => undefined);
      throw new Error(
        `Could not add new tab ${tab.id} to workspace ${options.workspaceId}`,
      );
    }
  }

  return tab as chrome.tabs.Tab & { id: number };
}
