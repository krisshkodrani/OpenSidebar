/**
 * Interaction tool registrations (RFC LP-16 Phase 4). Registers the
 * content-script interaction tools (click/type/scroll/read/hover/find/select/
 * press/drag/hide/dismiss), including the main-world click+type bridges and the
 * ServiceNow reference finalize hook. Verbatim movement from tools/index.ts.
 */
import { ToolName, MessageSource } from "../../types";
import { logger } from "../../utils";
import { ToolRegistry } from "./registry";
import {
  CLICK_DEF,
  TYPE_TEXT_DEF,
  SCROLL_PAGE_DEF,
  READ_PAGE_DEF,
  HOVER_ELEMENT_DEF,
  FIND_ELEMENT_DEF,
  SELECT_OPTION_DEF,
  PRESS_KEY_DEF,
  DRAG_AND_DROP_DEF,
  HIDE_ELEMENT_DEF,
  DISMISS_OVERLAYS_DEF,
} from "./definitions";
import { executeContentTool } from "./bridge";
import {
  clickElementInMainWorld,
  mirrorTextInputInMainWorld,
} from "./main-world-bridge";
import { finalizeServiceNowReferenceOnType } from "./servicenow/tool-hooks";

export function registerInteractionTools(toolRegistry: ToolRegistry): void {
    toolRegistry.register(
      ToolName.CLICK_ELEMENT,
      CLICK_DEF,
      async (args, tabId) => {
        const result = await executeContentTool(
          ToolName.CLICK_ELEMENT,
          args,
          tabId,
        );
        // Main-world click bridge is a fallback only. A successful content-script
        // click already activates React/Vue handlers on normal pages; mirroring it
        // here would double-submit buttons and double-advance pagination.
        const resultText = String(result);
        if (resultText.startsWith("Click intercepted!")) {
          const bridged = await clickElementInMainWorld(tabId, args);
          if (bridged) {
            return `Clicked [${String(args.id)}] via main-world event bridge after content-script interception.`;
          }
        }
        return result;
      },
    );
    toolRegistry.register(
      ToolName.TYPE_TEXT,
      TYPE_TEXT_DEF,
      async (args, tabId) => {
        const result = await executeContentTool(ToolName.TYPE_TEXT, args, tabId);
        // Main-world text bridge: controlled inputs in frameworks such as React can
        // ignore input events created in the extension's isolated world. Mirror the
        // final value and input/change events in MAIN so framework state matches the
        // visible DOM before later clicks submit the value.
        if (!String(result).startsWith("Error:")) {
          const bridgeStatus = await mirrorTextInputInMainWorld(tabId, args);
          return await finalizeServiceNowReferenceOnType({
            tabId,
            args,
            result,
            bridgeStatus,
          });
        }
        return result;
      },
    );
    toolRegistry.register(ToolName.SCROLL_PAGE, SCROLL_PAGE_DEF, (args, tabId) =>
      executeContentTool(ToolName.SCROLL_PAGE, args, tabId),
    );
    toolRegistry.register(ToolName.READ_PAGE, READ_PAGE_DEF, (args, tabId) =>
      executeContentTool(ToolName.READ_PAGE, args, tabId),
    );
  
    // Content Script Tools (already implemented in content/actions.ts)
    toolRegistry.register(
      ToolName.HOVER_ELEMENT,
      HOVER_ELEMENT_DEF,
      (args, tabId) => executeContentTool(ToolName.HOVER_ELEMENT, args, tabId),
    );
    toolRegistry.register(
      ToolName.FIND_ELEMENT,
      FIND_ELEMENT_DEF,
      (args, tabId) => executeContentTool(ToolName.FIND_ELEMENT, args, tabId),
    );
    toolRegistry.register(
      ToolName.SELECT_OPTION,
      SELECT_OPTION_DEF,
      (args, tabId) => executeContentTool(ToolName.SELECT_OPTION, args, tabId),
    );
    toolRegistry.register(ToolName.PRESS_KEY, PRESS_KEY_DEF, (args, tabId) =>
      executeContentTool(ToolName.PRESS_KEY, args, tabId),
    );
    toolRegistry.register(
      ToolName.DRAG_AND_DROP,
      DRAG_AND_DROP_DEF,
      async (args, tabId) => {
        const sourceId = args.sourceId as number;
        const targetId = args.targetId as number;
  
        // Pre-validation: request a fresh snapshot and check both IDs exist
        try {
          const snapResponse = await chrome.tabs.sendMessage(tabId, {
            type: "DOM_SNAPSHOT_REQUEST",
            requestId: crypto.randomUUID(),
            source: MessageSource.BACKGROUND,
            payload: { refresh: true },
          });
          const elements = snapResponse?.payload?.snapshot?.elements;
          if (elements && Array.isArray(elements)) {
            const sourceExists = elements.some((el: any) => el.tag === sourceId);
            const targetExists = elements.some((el: any) => el.tag === targetId);
  
            if (!sourceExists || !targetExists) {
              const missing = [];
              if (!sourceExists) missing.push(`sourceId [${sourceId}]`);
              if (!targetExists) missing.push(`targetId [${targetId}]`);
  
              // Find similar elements to suggest
              const draggables = elements
                .filter(
                  (el: any) =>
                    el.attributes?.draggable === "true" || el.tagName === "li",
                )
                .slice(0, 8);
              const suggestions =
                draggables.length > 0
                  ? `\nAvailable draggable/list elements: ${draggables.map((el: any) => `[${el.tag}] ${el.tagName} "${(el.text || "").slice(0, 30)}"`).join(", ")}`
                  : "";
  
              return `Error: Stale element IDs — ${missing.join(" and ")} no longer exist on the page.${suggestions}\nCall read_page to get fresh element IDs before retrying.`;
            }
          }
        } catch {
          // Pre-validation failed (non-critical) — proceed with execution anyway
        }
  
        return executeContentTool(ToolName.DRAG_AND_DROP, args, tabId);
      },
    );
    toolRegistry.register(
      ToolName.HIDE_ELEMENT,
      HIDE_ELEMENT_DEF,
      (args, tabId) => executeContentTool(ToolName.HIDE_ELEMENT, args, tabId),
    );
  
    toolRegistry.register(
      ToolName.DISMISS_OVERLAYS,
      DISMISS_OVERLAYS_DEF,
      async (_args, tabId) => {
        logger.info("tools", "dismiss_overlays", { tabId });
        try {
          const response = await chrome.tabs.sendMessage(tabId, {
            type: "DISMISS_MODALS",
            requestId: crypto.randomUUID(),
            source: MessageSource.BACKGROUND,
            payload: {},
          });
          const { dismissed, remainingOverlay } = response.payload;
          let msg =
            dismissed > 0
              ? `Dismissed ${dismissed} overlay(s).`
              : "No overlays found.";
          if (remainingOverlay) {
            msg += ` Warning: overlay [${remainingOverlay.tagId}] still covers ${remainingOverlay.coveragePercent}% of viewport. Use hide_element to remove it.`;
          }
          return msg;
        } catch (e: any) {
          return `Error dismissing overlays: ${e.message}`;
        }
      },
    );
}
