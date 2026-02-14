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

/** Per-tab callbacks for reporting vision usage to the agent loop. */
const visionUsageCallbacks = new Map<number, (usage: TokenUsage, durationMs: number, model: string) => void>();

export function setVisionUsageCallback(cb: ((usage: TokenUsage, durationMs: number, model: string) => void) | null, tabId?: number): void {
  if (tabId != null) {
    if (cb) visionUsageCallbacks.set(tabId, cb);
    else visionUsageCallbacks.delete(tabId);
  } else {
    // Backwards compat: null clears all
    if (!cb) visionUsageCallbacks.clear();
  }
}

/** Per-tab callbacks for passing screenshot thumbnails to the agent loop. */
const screenshotCaptureCallbacks = new Map<number, (thumbnailDataUrl: string) => void>();

export function setScreenshotCaptureCallback(cb: ((thumbnailDataUrl: string) => void) | null, tabId?: number): void {
  if (tabId != null) {
    if (cb) screenshotCaptureCallbacks.set(tabId, cb);
    else screenshotCaptureCallbacks.delete(tabId);
  } else {
    // Backwards compat: null clears all
    if (!cb) screenshotCaptureCallbacks.clear();
  }
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
    description: "Click an element. Auto-scrolls to it first.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Tag ID.",
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
    description: "Type into an input field. Clears existing text, auto-focuses, auto-scrolls. Only set pressEnter for single-field forms (search bars). For multi-field forms, fill all fields first then click the submit button.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Tag ID.",
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
    description: "Scroll the page or a container. If you know what text you're looking for, use find_element instead — it scrolls directly to it.",
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
          description: "Container tag ID. Omit for window.",
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
    description: "Force a fresh DOM snapshot. Only needed after find_element fails or after dynamic content changes. The page snapshot is already in your context each turn — don't call this just to 'see' the page.",
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
      "Navigate to a URL or search query. Waits for page load to complete. Provide url OR query, not both.",
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
    description: "Open a new tab in this workspace. Returns the new tab's ID. Use switch_tab to make it active for subsequent tools.",
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
    description: "Close a tab in this workspace. Cannot close the current tab — switch_tab to another tab first.",
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
    description: "Switch to another tab in this workspace. All subsequent tool calls will run on this tab until you switch again.",
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
    description:
      "Pause for dynamic content to load, then re-orient. Returns your original goal, plan progress, and fresh page state. Use for timed reveals, animations, or AJAX loads — not just to re-read the page (use read_page for that).",
    parameters: {
      type: "object",
      properties: {
        seconds: {
          type: "integer",
          description: "Seconds to wait (1–10).",
        },
        reason: {
          type: "string",
          description:
            "Why you're pausing (e.g. 'lost track of which step I'm on').",
        },
      },
      required: ["seconds"],
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
    description: "Capture and describe the visual layout. Use when element tags don't match what you expect, when you need spatial context, or when stuck after 3+ failed attempts.",
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
    description: "Hover to reveal menus, tooltips, or hidden content. Auto-scrolls to element.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Tag ID.",
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
    description: "Find text on the page, scroll to it, and return its tag ID for interaction. Preferred over blind scroll_page when you know what to look for.",
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
    description: "Select an option from a native HTML <select> dropdown. For custom dropdowns (div-based menus), click the menu to open it then click the option.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Tag ID.",
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
    description: "Press a keyboard key on the page (dispatched to window, not a specific element). For typing into fields, use type_text. Useful for Escape, Tab, Enter, arrow keys.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: 'Key name (e.g. "Enter", "Escape", "Tab", "ArrowDown", " " for space).',
        },
        modifiers: {
          type: "array",
          items: {
            type: "string",
            enum: ["ctrl", "shift", "alt", "meta"],
          },
          description: "Modifier keys to hold (e.g. ['ctrl'], ['shift', 'alt']).",
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
    description: "Drag source element to target element. Source is auto-scrolled into view but target is NOT — scroll to reveal both elements first if they're far apart.",
    parameters: {
      type: "object",
      properties: {
        sourceId: {
          type: "integer",
          description: "Source tag ID.",
        },
        targetId: {
          type: "integer",
          description: "Target tag ID.",
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
    description: "Draw a stroke on a canvas. Coordinates are relative to the element's top-left corner (0,0 = top-left). Auto-scrolls to canvas.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Canvas tag ID.",
        },
        startX: { type: "number", description: "Start X (relative to element top-left)." },
        startY: { type: "number", description: "Start Y (relative to element top-left)." },
        endX: { type: "number", description: "End X (relative to element top-left)." },
        endY: { type: "number", description: "End Y (relative to element top-left)." },
      },
      required: ["id", "startX", "startY", "endX", "endY"],
    },
  },
};

const HIDE_ELEMENT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.HIDE_ELEMENT,
    description: "Hide an overlay blocking interaction (sets display:none). Must match overlay heuristics: fixed/absolute + z-index>100, dialog role, backdrop-filter, or >30% viewport coverage. If rejected, try click_element on a close button or press_key Escape instead.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Tag ID.",
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
    description: "Read a specific attribute (href, src, value) of an element. For visible text, check the page snapshot first — it's already there.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Tag ID.",
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
    description: "Run JavaScript in the page context. Use for hidden/computed values, timers, or DOM queries that tagged elements can't reach. Returns the result as a string.",
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
    description: "Upload a file to an <input type=\"file\"> element. Downloads the file from the URL (max 10MB), then injects it into the file input.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "File input tag ID.",
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
    description: "Go back in browser history. Waits for page load to complete.",
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
    description: "Go forward in browser history. Waits for page load to complete.",
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
    description: "List open tabs in this workspace with their IDs, titles, and URLs.",
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
    description: "Right-click on an element (dispatches contextmenu event). Auto-scrolls to element. If no menu appears, the page may not handle contextmenu events.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Tag ID.",
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
    description: "Set a checkbox or radio to checked/unchecked. Fires input and change events.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Checkbox/radio tag ID.",
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
    description: "Start a download to the user's downloads folder. Returns immediately — download completes in the background.",
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

const TRANSCRIBE_AUDIO_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.TRANSCRIBE_AUDIO,
    description: "Transcribe speech from an <audio> or <video> element. Use when a challenge hides information in audio (spoken codes, instructions, passwords). Returns the full text transcript. Requires a Groq API key in settings.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Tag ID of the audio/video element.",
        },
      },
      required: ["id"],
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
    async (args, tabId) => {
      const sourceId = args.sourceId as number;
      const targetId = args.targetId as number;

      // Pre-validation: request a fresh snapshot and check both IDs exist
      try {
        const snapResponse = await chrome.tabs.sendMessage(tabId, {
          type: "DOM_SNAPSHOT_REQUEST",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          payload: { includeText: false, refresh: true, showTags: false },
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
            const draggables = elements.filter((el: any) =>
              el.attributes?.draggable === "true" || el.tagName === "li"
            ).slice(0, 8);
            const suggestions = draggables.length > 0
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
    // Fallback — normally intercepted in loop.ts for re-orientation
    const seconds = Math.min(Math.max((args.seconds as number) || 2, 1), 10);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return `Waited ${seconds}s`;
  });

  toolRegistry.register(
    ToolName.TAKE_SCREENSHOT,
    TAKE_SCREENSHOT_DEF,
    async (_args, tabId, signal) => {
      try {
        const tab = await chrome.tabs.get(tabId);
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "jpeg",
          quality: 70,
        });

        // Generate thumbnail and fire callback (before vision LLM call)
        const captureCallback = screenshotCaptureCallbacks.get(tabId);
        if (captureCallback) {
          try {
            const thumbnailUrl = await createThumbnail(dataUrl);
            captureCallback(thumbnailUrl);
          } catch (e) {
            logger.warn("tools", "Thumbnail generation failed", { error: e });
          }
        }

        const result = await describeScreenshot(dataUrl, signal);
        // Report vision usage to the agent loop if callback is registered
        const usageCallback = visionUsageCallbacks.get(tabId);
        if (result.usage && result.model && result.durationMs != null && usageCallback) {
          usageCallback(result.usage, result.durationMs, result.model);
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
              const result = eval(c);
              if (result === null || result === undefined) return String(result);
              if (typeof result === "object") {
                try {
                  return JSON.stringify(result, null, 2);
                } catch {
                  return String(result);
                }
              }
              return String(result);
            } catch (e: any) {
              return `Error: ${e.message}`;
            }
          },
          args: [code],
        });
        const value = results?.[0]?.result;
        return value !== undefined ? value : "undefined";
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

  toolRegistry.register(
    ToolName.TRANSCRIBE_AUDIO,
    TRANSCRIBE_AUDIO_DEF,
    async (args, tabId) => {
      // 1. Get audio source URL from the element
      let audioUrl = await executeContentTool(ToolName.READ_ELEMENT, { id: args.id, attribute: "src" }, tabId);
      if (!audioUrl || audioUrl.startsWith("Error") || audioUrl.trim() === "") {
        // Fallback: try currentSrc (handles <source> child elements)
        audioUrl = await executeContentTool(ToolName.READ_ELEMENT, { id: args.id, attribute: "currentSrc" }, tabId);
      }
      if (!audioUrl || audioUrl.startsWith("Error") || audioUrl.trim() === "") {
        return `Error: Element [${args.id}] has no audio source URL. Try execute_js to inspect the element.`;
      }

      // 2. Validate URL
      const urlResult = sanitizeUrl(audioUrl);
      if (!urlResult.ok) return `Error: ${urlResult.error}`;

      // 3. Load Groq API key
      let groqApiKey = "";
      try {
        const stored = await chrome.storage.sync.get("userSettings");
        const settings = stored.userSettings as UserSettings | undefined;
        groqApiKey = settings?.groqApiKey || "";
      } catch { /* ignore */ }
      if (!groqApiKey) {
        try {
          groqApiKey = (globalThis as any).__GROQ_API_KEY__ || "";
        } catch { /* ignore */ }
      }
      if (!groqApiKey) {
        return "Error: Groq API key required. Configure it in Settings.";
      }

      // 4. Fetch the audio file (25MB Whisper limit)
      let audioBlob: Blob;
      try {
        const response = await fetch(urlResult.value);
        if (!response.ok) return `Error: Failed to fetch audio (HTTP ${response.status}).`;
        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > 25 * 1024 * 1024) {
          return "Error: Audio file exceeds 25MB Whisper limit.";
        }
        audioBlob = await response.blob();
        if (audioBlob.size > 25 * 1024 * 1024) {
          return "Error: Audio file exceeds 25MB Whisper limit.";
        }
      } catch (e: any) {
        return `Error fetching audio: ${e.message}`;
      }

      // 5. Send to Groq Whisper API
      try {
        const formData = new FormData();
        // Derive filename from URL for content-type hint
        const urlPath = new URL(urlResult.value).pathname;
        const filename = urlPath.split("/").pop() || "audio.webm";
        formData.append("file", audioBlob, filename);
        formData.append("model", "whisper-large-v3-turbo");

        const whisperResponse = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${groqApiKey}` },
          body: formData,
        });
        if (!whisperResponse.ok) {
          const errText = await whisperResponse.text().catch(() => "");
          return `Error: Whisper API returned ${whisperResponse.status}. ${errText}`;
        }
        const result = await whisperResponse.json();
        return result.text || "Transcription returned empty text.";
      } catch (e: any) {
        return `Error calling Whisper API: ${e.message}`;
      }
    },
  );

  logger.info(
    "tools",
    `${toolRegistry.getDefinitions().length} tools registered`,
  );
}
