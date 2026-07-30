/**
 * Tab-management tool registrations (RFC LP-16 Phase 4). create_tab /
 * close_tab / switch_tab, coordinated with the workspace manager. Verbatim
 * movement from tools/index.ts.
 */
import { ToolName } from "../../types";
import { logger } from "../../utils";
import { sanitizeUrl } from "../security";
import { isUsableTabUrl } from "../infrastructure/tab-resolution";
import { createWorkspaceTab } from "../workspaces/create-workspace-tab";
import { workspaceManager } from "../workspaces/manager";
import { ToolRegistry } from "./registry";
import { getTabUrl } from "./helpers";
import {
  getAllowedNavigationOrigins,
  isNavigationTargetAllowed,
  navigationBoundaryError,
  normalizeOrigin,
} from "./tab-navigation-helpers";
import { CREATE_TAB_DEF, CLOSE_TAB_DEF, SWITCH_TAB_DEF } from "./definitions";

export function registerTabTools(toolRegistry: ToolRegistry): void {
  toolRegistry.register(
    ToolName.CREATE_TAB,
    CREATE_TAB_DEF,
    async (args, sourceTabId) => {
      const allowedOrigins = await getAllowedNavigationOrigins(sourceTabId);
      if (allowedOrigins.length > 0) {
        const result = await isNavigationTargetAllowed(
          sourceTabId,
          args.url as string,
        );
        if (!result.allowed) {
          return navigationBoundaryError(args.url as string, result.boundary);
        }
      }
      const urlResult = sanitizeUrl(args.url as string);
      if (!urlResult.ok) return `Error: ${urlResult.error}`;
      const sourceWorkspace =
        await workspaceManager.getWorkspaceForTab(sourceTabId);
      logger.info("tools", "create_tab", { url: urlResult.value });
      const tab = await createWorkspaceTab({
        sourceTabId,
        url: urlResult.value,
        workspaceId: sourceWorkspace?.id,
      });
      logger.info("tools", "create_tab created", {
        tabId: tab.id,
        url: urlResult.value,
      });

      if (sourceWorkspace && tab.id) {
        logger.info("tools", "create_tab grouped", {
          tabId: tab.id,
          workspace: sourceWorkspace.name,
        });
        return `Created new tab (ID: ${tab.id}) with URL: ${urlResult.value} (added to ${sourceWorkspace.name})`;
      }

      return `Created new tab (ID: ${tab.id}) with URL: ${urlResult.value}`;
    },
  );

  toolRegistry.register(
    ToolName.CLOSE_TAB,
    CLOSE_TAB_DEF,
    async (args, tabId) => {
      const targetTabId = (args.tabId as number) || tabId;
      logger.info("tools", "close_tab", {
        targetTabId,
        requestedTabId: args.tabId,
        currentTabId: tabId,
      });
      try {
        await chrome.tabs.remove(targetTabId);
        return `Closed tab ${targetTabId}`;
      } catch (e: any) {
        return `Error closing tab ${targetTabId}: ${e.message}`;
      }
    },
  );

  toolRegistry.register(ToolName.SWITCH_TAB, SWITCH_TAB_DEF, async (args) => {
    const targetTabId = args.tabId as number;
    logger.info("tools", "switch_tab", { targetTabId });
    try {
      const targetTab = await chrome.tabs.get(targetTabId);
      const targetUrl = getTabUrl(targetTab);
      if (!isUsableTabUrl(targetUrl)) {
        return (
          `Error: Cannot switch to tab ${targetTabId} (${targetUrl || "about:blank"}) for this web task. ` +
          "Browser, extension, blank, and internal pages cannot run page tools. Use a controllable web tab from list_tabs or navigate the current page instead."
        );
      }
      await chrome.tabs.update(targetTabId, { active: true });
      return `Switched to tab ${targetTabId}. Fresh page snapshot is available.`;
    } catch (e: any) {
      return `Error switching to tab ${targetTabId}: ${e.message}`;
    }
  });
}
