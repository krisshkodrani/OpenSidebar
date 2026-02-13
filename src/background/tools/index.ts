import { toolRegistry } from "./registry";
import {
  ToolName,
  ToolDefinition,
  MessageSource,
  UserSettings,
} from "../../types";
import { logger } from "../../utils";
import { sendMessageToMemory } from "../memory/bridge";
import { sanitizeUrl } from "../security";
import { workspaceManager } from "../workspaces/manager";
import { takeScreenshotWithTags } from "./screenshot";
import { describeScreenshot } from "../vision";
import { TokenUsage } from "../llm/types";

// Export registry and types
export * from "./registry";

/** Callback for reporting vision usage to the agent loop. Set by AgentLoop before starting. */
let visionUsageCallback: ((usage: TokenUsage, durationMs: number, model: string) => void) | null = null;

export function setVisionUsageCallback(cb: ((usage: TokenUsage, durationMs: number, model: string) => void) | null): void {
  visionUsageCallback = cb;
}

/** Callback for passing screenshot thumbnails to the agent loop. Set by AgentLoop before starting. */
let screenshotCaptureCallback: ((thumbnailDataUrl: string) => void) | null = null;

export function setScreenshotCaptureCallback(cb: ((thumbnailDataUrl: string) => void) | null): void {
  screenshotCaptureCallback = cb;
}

/** Downsize a full-res screenshot data URL to a ~320px wide JPEG thumbnail. */
async function createThumbnail(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);

  const MAX_WIDTH = 320;
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const thumbBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.5 });
  const arrayBuf = await thumbBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

// --- Tool Definitions ---

const CLICK_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.CLICK_ELEMENT,
    description: "Click an element.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Element tag ID (integer from Visible Elements list).",
        },
      },
      required: ["id"],
    },
  },
};

const TYPE_TEXT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.TYPE_TEXT,
    description: "Type into an input. Auto-focuses. pressEnter submits.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Element tag ID (integer from Visible Elements list).",
        },
        text: { type: "string", description: "Text to type." },
        pressEnter: {
          type: "boolean",
          description: "Press Enter after typing.",
        },
      },
      required: ["id", "text"],
    },
  },
};

const SCROLL_PAGE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.SCROLL_PAGE,
    description: "Scroll the page or a container.",
    parameters: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["up", "down", "top", "bottom"],
          description: "Direction.",
        },
        id: {
          type: "integer",
          description: "Container element tag ID (integer). Omit for window scroll.",
        },
      },
      required: ["direction"],
    },
  },
};

const READ_PAGE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.READ_PAGE,
    description: "Re-scan page for fresh elements and text. Use after find_element fails, after page state changes, or when unsure which elements are available.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const MEMORY_ADD_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.MEMORY_ADD,
    description: "Save info to long-term memory.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Text to remember.",
        },
        category: {
          type: "string",
          description: "Category tag.",
        },
      },
      required: ["content"],
    },
  },
};

const MEMORY_SEARCH_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.MEMORY_SEARCH,
    description: "Search long-term memory.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
      },
      required: ["query"],
    },
  },
};

const NAVIGATE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.NAVIGATE,
    description:
      "Navigate to a URL or search query. Provide url OR query, not both.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full URL (https://).",
        },
        query: {
          type: "string",
          description: "Search query (uses default search engine).",
        },
      },
    },
  },
};

const CREATE_TAB_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.CREATE_TAB,
    description: "Open a new tab.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open." },
      },
      required: ["url"],
    },
  },
};

const CLOSE_TAB_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.CLOSE_TAB,
    description: "Close a tab.",
    parameters: {
      type: "object",
      properties: {
        tabId: {
          type: "integer",
          description: "Tab ID. Omit for current.",
        },
      },
      required: [],
    },
  },
};

const SWITCH_TAB_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.SWITCH_TAB,
    description: "Switch to another tab.",
    parameters: {
      type: "object",
      properties: {
        tabId: { type: "integer", description: "Tab ID." },
      },
      required: ["tabId"],
    },
  },
};

const WAIT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.WAIT,
    description: "Wait for content to load.",
    parameters: {
      type: "object",
      properties: {
        ms: { type: "integer", description: "Milliseconds (max 5000)." },
      },
      required: ["ms"],
    },
  },
};

const DONE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.DONE,
    description: "Signal task completion or answer the user's question with a summary.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "What was accomplished, or your answer to the user's question.",
        },
      },
      required: ["summary"],
    },
  },
};

const TAKE_SCREENSHOT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.TAKE_SCREENSHOT,
    description: "Capture and describe the visual layout. Use when stuck, when text-based tools give unexpected results, or to understand spatial relationships.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const HOVER_ELEMENT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.HOVER_ELEMENT,
    description: "Hover to reveal menus/tooltips.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Element tag ID (integer from Visible Elements list).",
        },
      },
      required: ["id"],
    },
  },
};

const FIND_ELEMENT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.FIND_ELEMENT,
    description: "Find text on the page, scroll to it, and return its tag ID for interaction.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to search for.",
        },
      },
      required: ["text"],
    },
  },
};

const SELECT_OPTION_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.SELECT_OPTION,
    description: "Select a dropdown option by text or value.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Element tag ID (integer from Visible Elements list).",
        },
        value: {
          type: "string",
          description: "Option text or value.",
        },
      },
      required: ["id", "value"],
    },
  },
};

const PRESS_KEY_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.PRESS_KEY,
    description: "Press a keyboard key.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: 'Key value (e.g. "Enter", "ArrowDown").',
        },
        modifiers: {
          type: "array",
          items: {
            type: "string",
            enum: ["ctrl", "shift", "alt", "meta"],
          },
          description: "Modifier keys.",
        },
      },
      required: ["key"],
    },
  },
};

const DRAG_AND_DROP_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.DRAG_AND_DROP,
    description: "Drag and drop between elements.",
    parameters: {
      type: "object",
      properties: {
        sourceId: {
          type: "integer",
          description: "Element to drag (integer).",
        },
        targetId: {
          type: "integer",
          description: "Drop target element (integer).",
        },
      },
      required: ["sourceId", "targetId"],
    },
  },
};

const DRAW_STROKE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.DRAW_STROKE,
    description: "Draw a stroke on a canvas.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Canvas element tag ID (integer).",
        },
        startX: { type: "number", description: "Start X offset." },
        startY: { type: "number", description: "Start Y offset." },
        endX: { type: "number", description: "End X offset." },
        endY: { type: "number", description: "End Y offset." },
      },
      required: ["id", "startX", "startY", "endX", "endY"],
    },
  },
};

const HIDE_ELEMENT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.HIDE_ELEMENT,
    description: "Hide an overlay or modal blocking interaction (display:none). Only works on overlays (fixed/absolute position, high z-index, dialog roles). Rejects non-overlay elements.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Element tag ID (integer from Visible Elements list).",
        },
      },
      required: ["id"],
    },
  },
};

const ESCALATE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.ESCALATE,
    description: "Switch to a smarter, slower model for complex reasoning. Use when stuck on riddles, puzzles, math, or multi-step logic.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Why the current model can't handle this.",
        },
      },
      required: ["reason"],
    },
  },
};

const UPDATE_PLAN_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.UPDATE_PLAN,
    description: "Report task progress or REVISE the plan if the current one is failing. Call after each subtask.",
    parameters: {
      type: "object",
      properties: {
        subtasks: {
          type: "array",
          items: { type: "string" },
          description: "Ordered list of subtask descriptions. You may overwrite the future steps if the current plan is stuck.",
        },
        currentIndex: {
          type: "integer",
          description: "0-based index of the NEXT subtask to execute (after the one you just completed).",
        },
        lastResult: {
          type: "string",
          description: "Brief result of the last completed subtask.",
        },
        rationale: {
          type: "string",
          description: "Required if changing the plan: Explain WHY you are modifying the subtasks (e.g., 'Current approach failed because...').",
        },
      },
      required: ["subtasks", "currentIndex"],
    },
  },
};

const READ_ELEMENT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.READ_ELEMENT,
    description: "Read text content or a specific attribute of an element.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Element tag ID (integer from Visible Elements list).",
        },
        attribute: {
          type: "string",
          description: 'Attribute to read (e.g. "href", "src", "value"). Omit for text content.',
        },
      },
      required: ["id"],
    },
  },
};

const EXECUTE_JS_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.EXECUTE_JS,
    description: "Run JavaScript in the page context. Returns the result as a string.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript code to evaluate.",
        },
      },
      required: ["code"],
    },
  },
};

const UPLOAD_FILE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.UPLOAD_FILE,
    description: "Upload a file to an <input type=\"file\"> element by URL.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "File input element tag ID (integer).",
        },
        url: {
          type: "string",
          description: "URL of the file to upload.",
        },
      },
      required: ["id", "url"],
    },
  },
};

const GO_BACK_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.GO_BACK,
    description: "Go back in browser history.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const GO_FORWARD_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.GO_FORWARD,
    description: "Go forward in browser history.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const LIST_TABS_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.LIST_TABS,
    description: "List all open tabs with their IDs, titles, and URLs.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const RIGHT_CLICK_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.RIGHT_CLICK,
    description: "Right-click (context menu) on an element.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Element tag ID (integer from Visible Elements list).",
        },
      },
      required: ["id"],
    },
  },
};

const SET_CHECKBOX_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.SET_CHECKBOX,
    description: "Set a checkbox or radio input to checked or unchecked.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Checkbox/radio element tag ID (integer).",
        },
        checked: {
          type: "boolean",
          description: "Whether the input should be checked.",
        },
      },
      required: ["id", "checked"],
    },
  },
};

const DOWNLOAD_FILE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.DOWNLOAD_FILE,
    description: "Download a file from a URL to the user's downloads folder.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL of the file to download.",
        },
        filename: {
          type: "string",
          description: "Optional filename for the downloaded file.",
        },
      },
      required: ["url"],
    },
  },
};

// --- Execution Bridge ---

async function executeContentTool(
  startName: ToolName,
  args: any,
  tabId: number,
): Promise<string> {
  if (tabId === chrome.tabs.TAB_ID_NONE) {
    return "Error: No active tab to execute tool on.";
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "TOOL_EXECUTE",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: {
        toolName: startName,
        args,
        toolCallId: "internal", // We don't need this for the bridge here
      },
    });

    // Response payload from content script: { result: string, success: boolean }
    return response.payload.result;
  } catch (e: any) {
    logger.error("tools", "Bridge execution failed", { error: e.message });
    return `Error: Could not communicate with content script. Is the tab active? (${e.message})`;
  }
}

/** Wait for a tab navigation to complete (webNavigation.onCompleted or timeout). */
function waitForNavigation(tabId: number, timeoutMs = 5000): Promise<void> {
  return new Promise<void>((resolve) => {
    let resolved = false;

    const done = () => {
      if (resolved) return;
      resolved = true;
      chrome.webNavigation?.onCompleted.removeListener(onCompleted);
      chrome.webNavigation?.onErrorOccurred.removeListener(onError);
      clearTimeout(timer);
      resolve();
    };

    const onCompleted = (details: { tabId: number; frameId: number }) => {
      if (details.tabId === tabId && details.frameId === 0) done();
    };
    const onError = (details: { tabId: number; frameId: number }) => {
      if (details.tabId === tabId && details.frameId === 0) done();
    };

    chrome.webNavigation?.onCompleted.addListener(onCompleted);
    chrome.webNavigation?.onErrorOccurred.addListener(onError);
    const timer = setTimeout(done, timeoutMs);
  });
}

// --- Registration ---

export function registerTools() {
  toolRegistry.register(
    ToolName.CLICK_ELEMENT,
    CLICK_DEF,
    async (args, tabId) => {
      const result = await executeContentTool(
        ToolName.CLICK_ELEMENT,
        args,
        tabId,
      );

      // Screenshot-on-failure: capture debug screenshot when element not found
      if (result.includes("No element with tag")) {
        try {
          const stored = await chrome.storage.sync.get("userSettings");
          const settings = stored.userSettings as UserSettings | undefined;
          if (settings?.showElementTags) {
            const screenshot = await takeScreenshotWithTags(tabId, {
              format: "jpeg",
              quality: 80,
              includeTags: true,
            });

            if (screenshot.success) {
              await chrome.runtime.sendMessage({
                type: "SCREENSHOT_CAPTURED",
                requestId: crypto.randomUUID(),
                source: MessageSource.BACKGROUND,
                payload: {
                  dataUrl: screenshot.dataUrl,
                  context: `Failed to find element [${args.id}]`,
                  timestamp: Date.now(),
                },
              });
            }
          }
        } catch (e) {
          // Screenshot is best-effort, don't fail the tool call
          logger.warn("tools", "Screenshot-on-failure failed", { error: e });
        }
      }

      return result;
    },
  );
  toolRegistry.register(ToolName.TYPE_TEXT, TYPE_TEXT_DEF, (args, tabId) =>
    executeContentTool(ToolName.TYPE_TEXT, args, tabId),
  );
  toolRegistry.register(ToolName.SCROLL_PAGE, SCROLL_PAGE_DEF, (args, tabId) =>
    executeContentTool(ToolName.SCROLL_PAGE, args, tabId),
  );
  toolRegistry.register(ToolName.READ_PAGE, READ_PAGE_DEF, (args, tabId) =>
    executeContentTool(ToolName.READ_PAGE, args, tabId),
  );

  // Memory Tools
  toolRegistry.register(
    ToolName.MEMORY_ADD,
    MEMORY_ADD_DEF,
    async (args, tabId) => {
      // Get the actual URL from the current tab
      let sourceUrl = "unknown";
      try {
        if (tabId && tabId !== chrome.tabs.TAB_ID_NONE) {
          const tab = await chrome.tabs.get(tabId);
          sourceUrl = tab.url || "unknown";
        }
      } catch (_e) {
        // If we can't get the URL (e.g., tab closed), use "unknown"
        sourceUrl = "unknown";
      }

      const res = await sendMessageToMemory({
        action: "add",
        content: args.content as string,
        category: (args.category as string) || "general",
        sourceUrl: sourceUrl,
      });

      if (res.action === "add") {
        return res.success
          ? `Memory saved (ID: ${res.id}) from ${sourceUrl}`
          : `Failed to save memory: ${res.error}`;
      }
      return "Error: Unexpected response from memory worker.";
    },
  );

  toolRegistry.register(
    ToolName.MEMORY_SEARCH,
    MEMORY_SEARCH_DEF,
    async (args) => {
      const res = await sendMessageToMemory({
        action: "search",
        query: args.query as string,
        limit: 5, // Default limit
      });

      if (res.action === "search") {
        if (!res.results || res.results.length === 0)
          return "No relevant memories found.";
        return (
          "Found memories:\n" +
          res.results
            .map(
              (r: any) =>
                `- [${r.entry.category}] ${r.entry.content} (Score: ${r.score.toFixed(2)})`,
            )
            .join("\n")
        );
      }
      return "Error: Unexpected response from memory worker.";
    },
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
  toolRegistry.register(
    ToolName.PRESS_KEY,
    PRESS_KEY_DEF,
    (args, tabId) => executeContentTool(ToolName.PRESS_KEY, args, tabId),
  );
  toolRegistry.register(
    ToolName.DRAG_AND_DROP,
    DRAG_AND_DROP_DEF,
    (args, tabId) => executeContentTool(ToolName.DRAG_AND_DROP, args, tabId),
  );
  toolRegistry.register(
    ToolName.DRAW_STROKE,
    DRAW_STROKE_DEF,
    (args, tabId) => executeContentTool(ToolName.DRAW_STROKE, args, tabId),
  );
  toolRegistry.register(
    ToolName.HIDE_ELEMENT,
    HIDE_ELEMENT_DEF,
    (args, tabId) => executeContentTool(ToolName.HIDE_ELEMENT, args, tabId),
  );

  // Escalation tool (intercepted by agent loop before executor runs)
  toolRegistry.register(
    ToolName.ESCALATE,
    ESCALATE_DEF,
    async (args) => {
      // This executor is a fallback — the loop intercepts escalate before reaching here
      return `Escalation requested: ${(args.reason as string) || "no reason given"}`;
    },
  );

  // Plan progress tool (intercepted by agent loop before executor runs)
  toolRegistry.register(
    ToolName.UPDATE_PLAN,
    UPDATE_PLAN_DEF,
    async (args) => {
      const subtasks = args.subtasks as string[];
      return `Plan updated: ${subtasks.length} subtasks, current: ${args.currentIndex}`;
    },
  );

  // Service Worker Tools (chrome.* APIs)
  toolRegistry.register(
    ToolName.NAVIGATE,
    NAVIGATE_DEF,
    async (args, tabId) => {
      const url = args.url as string | undefined;
      const query = args.query as string | undefined;

      if (url && query) return "Error: provide url OR query, not both.";
      if (!url && !query) return "Error: provide either url or query.";

      if (url) {
        const urlResult = sanitizeUrl(url);
        if (!urlResult.ok) return `Error: ${urlResult.error}`;
        await chrome.tabs.update(tabId, { url: urlResult.value });
      } else {
        await chrome.search.query({ text: query!, disposition: "CURRENT_TAB" });
      }

      await waitForNavigation(tabId);
      // Brief wait for content script initialization
      await new Promise((resolve) => setTimeout(resolve, 100));
      const target = url ? url : `search: "${query}"`;
      return `Navigated to ${target}. Page has loaded. Fresh page snapshot is available.`;
    },
  );

  toolRegistry.register(ToolName.CREATE_TAB, CREATE_TAB_DEF, async (args) => {
    const urlResult = sanitizeUrl(args.url as string);
    if (!urlResult.ok) return `Error: ${urlResult.error}`;
    const tab = await chrome.tabs.create({ url: urlResult.value });

    // Auto-add to active workspace if exists
    const activeWorkspace = await workspaceManager.getActiveWorkspace();
    if (activeWorkspace && tab.id) {
      try {
        await workspaceManager.addTabToWorkspace(tab.id, activeWorkspace.id);
        return `Created new tab (ID: ${tab.id}) with URL: ${urlResult.value} (added to ${activeWorkspace.name})`;
      } catch (e) {
        logger.warn("tools", "Failed to auto-group tab to workspace", {
          error: e,
        });
      }
    }

    return `Created new tab (ID: ${tab.id}) with URL: ${urlResult.value}`;
  });

  toolRegistry.register(
    ToolName.CLOSE_TAB,
    CLOSE_TAB_DEF,
    async (args, tabId) => {
      const targetTabId = (args.tabId as number) || tabId;
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
    try {
      await chrome.tabs.update(targetTabId, { active: true });
      return `Switched to tab ${targetTabId}. Fresh page snapshot is available.`;
    } catch (e: any) {
      return `Error switching to tab ${targetTabId}: ${e.message}`;
    }
  });

  toolRegistry.register(ToolName.WAIT, WAIT_DEF, async (args) => {
    const ms = Math.min(Math.max((args.ms as number) || 2000, 0), 5000);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return `Waited ${ms}ms`;
  });

  toolRegistry.register(
    ToolName.TAKE_SCREENSHOT,
    TAKE_SCREENSHOT_DEF,
    async (_args, tabId, signal) => {
      try {
        const tab = await chrome.tabs.get(tabId);
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "jpeg",
          quality: 40,
        });

        // Generate thumbnail and fire callback (before vision LLM call)
        if (screenshotCaptureCallback) {
          try {
            const thumbnailUrl = await createThumbnail(dataUrl);
            screenshotCaptureCallback(thumbnailUrl);
          } catch (e) {
            logger.warn("tools", "Thumbnail generation failed", { error: e });
          }
        }

        const result = await describeScreenshot(dataUrl, signal);
        // Report vision usage to the agent loop if callback is registered
        if (result.usage && result.model && result.durationMs != null && visionUsageCallback) {
          visionUsageCallback(result.usage, result.durationMs, result.model);
        }
        return result.description;
      } catch (e: any) {
        return `Error capturing screenshot: ${e.message}`;
      }
    },
  );

  // Control Flow Tool
  toolRegistry.register(ToolName.DONE, DONE_DEF, async (args) => {
    return (args.summary as string) || "Task completed.";
  });

  // --- New Tools ---

  toolRegistry.register(
    ToolName.READ_ELEMENT,
    READ_ELEMENT_DEF,
    (args, tabId) => executeContentTool(ToolName.READ_ELEMENT, args, tabId),
  );

  toolRegistry.register(
    ToolName.RIGHT_CLICK,
    RIGHT_CLICK_DEF,
    (args, tabId) => executeContentTool(ToolName.RIGHT_CLICK, args, tabId),
  );

  toolRegistry.register(
    ToolName.SET_CHECKBOX,
    SET_CHECKBOX_DEF,
    (args, tabId) => executeContentTool(ToolName.SET_CHECKBOX, args, tabId),
  );

  toolRegistry.register(
    ToolName.UPLOAD_FILE,
    UPLOAD_FILE_DEF,
    async (args, tabId) => {
      const url = args.url as string;
      const urlResult = sanitizeUrl(url);
      if (!urlResult.ok) return `Error: ${urlResult.error}`;

      try {
        const response = await fetch(urlResult.value);
        if (!response.ok) return `Error: fetch failed with status ${response.status}`;

        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
          return "Error: file exceeds 10MB limit.";
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > 10 * 1024 * 1024) {
          return "Error: file exceeds 10MB limit.";
        }

        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);

        const contentType = response.headers.get("content-type") || "application/octet-stream";
        const urlPath = new URL(urlResult.value).pathname;
        const filename = urlPath.split("/").pop() || "file";

        return executeContentTool(ToolName.UPLOAD_FILE, {
          id: args.id,
          data: base64,
          filename,
          mimeType: contentType,
        }, tabId);
      } catch (e: any) {
        return `Error fetching file: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.GO_BACK,
    GO_BACK_DEF,
    async (_args, tabId) => {
      try {
        await chrome.tabs.goBack(tabId);
        await waitForNavigation(tabId);
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "Navigated back. Fresh page snapshot is available.";
      } catch (e: any) {
        return `Error going back: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.GO_FORWARD,
    GO_FORWARD_DEF,
    async (_args, tabId) => {
      try {
        await chrome.tabs.goForward(tabId);
        await waitForNavigation(tabId);
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "Navigated forward. Fresh page snapshot is available.";
      } catch (e: any) {
        return `Error going forward: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.LIST_TABS,
    LIST_TABS_DEF,
    async () => {
      const tabs = await chrome.tabs.query({});
      if (tabs.length === 0) return "No open tabs.";
      const lines = tabs.map(
        (t: any) => `Tab ${t.id}: "${t.title || "(untitled)"}" — ${t.url || "about:blank"}${t.active ? " [active]" : ""}`,
      );
      return lines.join("\n");
    },
  );

  toolRegistry.register(
    ToolName.EXECUTE_JS,
    EXECUTE_JS_DEF,
    async (args, tabId) => {
      const code = args.code as string;
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN" as any,
          func: (c: string) => {
            try {
              return String(eval(c));
            } catch (e: any) {
              return `Error: ${e.message}`;
            }
          },
          args: [code],
        });
        const value = results?.[0]?.result;
        return value !== undefined ? String(value) : "undefined";
      } catch (e: any) {
        return `Error executing JS: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.DOWNLOAD_FILE,
    DOWNLOAD_FILE_DEF,
    async (args) => {
      const url = args.url as string;
      const filename = args.filename as string | undefined;
      const urlResult = sanitizeUrl(url);
      if (!urlResult.ok) return `Error: ${urlResult.error}`;

      try {
        const opts: any = { url: urlResult.value };
        if (filename) opts.filename = filename;
        const downloadId = await chrome.downloads.download(opts);
        return `Download started (ID: ${downloadId})`;
      } catch (e: any) {
        return `Error starting download: ${e.message}`;
      }
    },
  );

  logger.info(
    "tools",
    `${toolRegistry.getDefinitions().length} tools registered`,
  );
}
