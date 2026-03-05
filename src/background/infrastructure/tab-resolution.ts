import { logger } from "../../utils";

/** Returns true if the tab exists and has a usable (http/https) URL. */
export async function isUsableTab(tabId: number): Promise<boolean> {
  if (!tabId || tabId <= 0) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url ?? "";
    if (!url || url === "about:blank" || url === "about:newtab") return false;
    if (url.startsWith("chrome://") || url.startsWith("chrome-extension://"))
      return false;
    return true;
  } catch {
    return false;
  }
}

interface TabResolver {
  getWorkspaceById(
    id: string,
  ): Promise<{ tabIds: number[] } | null>;
}

/**
 * Validates the tabId from the side panel. If invalid (0, nonexistent,
 * about:blank, chrome://), attempts fallbacks:
 *  1. Workspace's stored tabIds
 *  2. Re-query active tab in last-focused window
 * Returns valid tabId or null.
 */
export async function resolveValidTabId(
  tabId: number,
  workspaceId: string,
  wsManager: TabResolver,
): Promise<number | null> {
  if (await isUsableTab(tabId)) return tabId;

  logger.warn("agent", "Provided tabId is invalid, re-resolving", {
    tabId,
    workspaceId,
  });

  // Fallback 1: workspace tabs
  if (workspaceId && workspaceId !== "default") {
    const ws = await wsManager.getWorkspaceById(workspaceId);
    if (ws) {
      for (const wsTabId of ws.tabIds) {
        if (await isUsableTab(wsTabId)) {
          logger.info("agent", "Resolved tabId from workspace", {
            original: tabId,
            resolved: wsTabId,
          });
          return wsTabId;
        }
      }
    }
  }

  // Fallback 2: re-query active tab
  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (activeTab?.id && (await isUsableTab(activeTab.id))) {
      logger.info("agent", "Resolved tabId from active tab query", {
        original: tabId,
        resolved: activeTab.id,
      });
      return activeTab.id;
    }
  } catch {
    /* fall through */
  }

  return null;
}
