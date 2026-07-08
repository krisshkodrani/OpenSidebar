/**
 * Miscellaneous agent tool registrations (RFC LP-16 Phase 4): xray_page,
 * update_notes, get_profile_fields, create_window, update_plan. Verbatim
 * movement from tools/index.ts.
 */
import { ToolName } from "../../types";
import { logger } from "../../utils";
import { chromeWindowsPort } from "../environment/chrome";
import {
  resolveProfileFields,
  formatProfileFieldsForToolResult,
} from "../../utils/personal-profile";
import { ToolRegistry } from "./registry";
import {
  XRAY_PAGE_DEF,
  UPDATE_NOTES_DEF,
  GET_PROFILE_FIELDS_DEF,
  CREATE_WINDOW_DEF,
  UPDATE_PLAN_DEF,
} from "./definitions";

export function registerMiscAgentTools(toolRegistry: ToolRegistry): void {
    toolRegistry.register(
      ToolName.XRAY_PAGE,
      XRAY_PAGE_DEF,
      async (_args, tabId) => {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN" as any,
          func: () => {
            const existing = document.querySelector("style[data-osb-xray]");
            if (existing) {
              existing.remove();
              return "X-ray disabled. Hidden elements are hidden again.";
            }
            const s = document.createElement("style");
            s.setAttribute("data-osb-xray", "true");
            s.textContent = `
              * { visibility: visible !important; opacity: 1 !important; }
              [hidden], .hidden, [aria-hidden="true"] { display: block !important; }
            `;
            document.head.appendChild(s);
            return "X-ray enabled. All hidden elements are now visible. Call read_page to see them.";
          },
        });
        return results?.[0]?.result ?? "X-ray toggled.";
      },
    );
  
    // Working notes tool (intercepted by agent loop before executor runs)
    toolRegistry.register(
      ToolName.UPDATE_NOTES,
      UPDATE_NOTES_DEF,
      async (_args) => {
        // This executor is a fallback — the loop intercepts update_notes before reaching here
        return "Note saved.";
      },
    );
  
    toolRegistry.register(
      ToolName.GET_PROFILE_FIELDS,
      GET_PROFILE_FIELDS_DEF,
      async (args) => {
        const fields = Array.isArray(args.fields)
          ? args.fields
              .filter((field): field is string => typeof field === "string")
              .map((field) => field.trim())
              .filter(Boolean)
          : [];
  
        if (fields.length === 0) {
          return "Error: provide at least one profile field path.";
        }
  
        return formatProfileFieldsForToolResult(
          await resolveProfileFields(fields),
        );
      },
    );
  
    // Create window tool (intercepted by orchestrator before executor runs)
    toolRegistry.register(
      ToolName.CREATE_WINDOW,
      CREATE_WINDOW_DEF,
      async (args) => {
        // Fallback — normally intercepted by orchestrator
        const url = args.url as string | undefined;
        logger.info("tools", "create_window", { url });
        try {
          const win = await chromeWindowsPort.create(url ? { url } : {});
          return `Created new window (ID: ${win.id})`;
        } catch (e: any) {
          return `Error creating window: ${e.message}`;
        }
      },
    );
  
    // Update plan tool (intercepted by agent loop before executor runs)
    toolRegistry.register(ToolName.UPDATE_PLAN, UPDATE_PLAN_DEF, async (args) => {
      // Fallback — the loop intercepts update_plan before reaching here
      return `Plan updated: ${(args.summary as string) || "no summary"}`;
    });
  
    logger.info(
      "tools",
      `${toolRegistry.getDefinitions().length} tools registered`,
    );
}
