import {
  chromeSearchPort,
} from "../environment/chrome";
import { toolRegistry } from "./registry";
import { ToolName } from "../../types";
import { logger } from "../../utils";
import { registerInteractionTools } from "./register-interaction";
import { registerAgentControlTools } from "./register-agent-control";
import { registerCookieTools } from "./register-cookies";
import { registerHistoryTools } from "./register-history";
import { registerInspectionTools } from "./register-inspection";
import { registerTabTools } from "./register-tabs";
import { registerCoreActionTools } from "./register-core-actions";
import { registerScriptingDownloadTools } from "./register-scripting-download";
import { registerMiscAgentTools } from "./register-agent-tools";
import {
  getAllowedNavigationOrigins,
  normalizeOrigin,
  navigationBoundaryError,
} from "./tab-navigation-helpers";
import { sanitizeUrl } from "../security";
import {
  clearTabReady,
  waitForContentScriptReady,
} from "../tab-ready";
import { NAVIGATE_DEF } from "./definitions";
import {
  waitForNavigation,
} from "./bridge";
import { registerKnowledgeBaseTool } from "./register-knowledge-base";
import { registerCatalogTools } from "./register-catalog";
import { registerListActionTools } from "./register-list-actions";

// Re-export submodules for barrel compatibility
export * from "./registry";
export * from "./definitions";
export * from "./bridge";

export function registerTools() {
  registerInteractionTools(toolRegistry);

  // Escalation tool (intercepted by agent loop before executor runs)
  registerAgentControlTools(toolRegistry);

  // Service Worker Tools (chrome.* APIs)
  toolRegistry.register(
    ToolName.NAVIGATE,
    NAVIGATE_DEF,
    async (args, tabId) => {
      const url = args.url as string | undefined;
      const query = args.query as string | undefined;

      if (url && query) return "Error: provide url OR query, not both.";
      if (!url && !query) return "Error: provide either url or query.";

      const target = url ? url : `search: "${query}"`;
      logger.info("tools", "navigate", { tabId, url, query, target });

      const allowedOrigins = await getAllowedNavigationOrigins();
      if (allowedOrigins.length > 0) {
        if (query) {
          return (
            `Error: External web search is blocked for this task. Allowed origin` +
            `${allowedOrigins.length === 1 ? "" : "s"}: ${allowedOrigins.join(", ")}. ` +
            "Use the current application's own navigation or search controls instead."
          );
        }
        const targetOrigin = normalizeOrigin(url!);
        const normalizedAllowed = allowedOrigins
          .map(normalizeOrigin)
          .filter((origin): origin is string => Boolean(origin));
        if (!targetOrigin || !normalizedAllowed.includes(targetOrigin)) {
          return navigationBoundaryError(
            url!,
            normalizedAllowed.length > 0 ? normalizedAllowed : allowedOrigins,
          );
        }
      }

      clearTabReady(tabId);
      if (url) {
        const urlResult = sanitizeUrl(url);
        if (!urlResult.ok) return `Error: ${urlResult.error}`;
        await chrome.tabs.update(tabId, { url: urlResult.value });
      } else {
        await chromeSearchPort.query({ text: query!, disposition: "CURRENT_TAB" });
      }

      await waitForNavigation(tabId);
      await waitForContentScriptReady(tabId, 2000);
      return `Navigated to ${target}. Page has loaded. Fresh page snapshot is available.`;
    },
  );

  registerKnowledgeBaseTool(toolRegistry);

  registerTabTools(toolRegistry);

  registerCoreActionTools(toolRegistry);

  registerScriptingDownloadTools(toolRegistry);

  // --- Chrome API Tools ---

  registerCookieTools(toolRegistry);

  registerHistoryTools(toolRegistry);

  registerInspectionTools(toolRegistry);

  registerListActionTools(toolRegistry);
  registerCatalogTools(toolRegistry);

  // Page Assist Tools (xray_page)
  registerMiscAgentTools(toolRegistry);
}
