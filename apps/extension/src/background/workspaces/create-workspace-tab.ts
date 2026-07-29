import type { WorkspaceManager } from "./manager";
import { workspaceManager } from "./manager";

type WorkspaceTabManager = Pick<WorkspaceManager, "addTabToWorkspace">;

export async function createWorkspaceTab(options: {
  sourceTabId: number;
  url: string;
  workspaceId?: string | null;
  manager?: WorkspaceTabManager;
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
