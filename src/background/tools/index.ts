import { toolRegistry } from "./registry";
import {
  ToolName,
  ToolDefinition,
  ActivateSwarmArgs,
  MessageSource,
  UserSettings,
} from "../../types";
import { logger } from "../../utils";
import { sendMessageToMemory } from "../memory/bridge";
import { callKimiSwarm } from "../swarm";
import { sanitizeUrl } from "../security";
import { workspaceManager } from "../workspaces/manager";
import { takeScreenshotWithTags } from "./screenshot";
import { describeScreenshot } from "../vision";

// Export registry and types
export * from "./registry";

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
          description: "Element tag.",
        },
      },
      required: ["id"],
    },
  },
};

const SWARM_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.ACTIVATE_SWARM,
    description: "Delegate complex research to a deep research model.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Research topic or question.",
        },
        urls: {
          type: "array",
          items: { type: "string" },
          description: "Optional URLs to investigate.",
        },
      },
      required: ["task"],
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
          description: "Element tag.",
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
          description: "Container element tag. Omit for window.",
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
    description: "Re-scan page for fresh elements and text.",
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
    description: "Navigate to a URL. Waits for page load.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full URL (https://).",
        },
      },
      required: ["url"],
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
    description: "Signal task completion with a summary.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "What was accomplished.",
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
    description: "Capture and describe the visual layout.",
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
          description: "Element tag.",
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
    description: "Find an element by text. Scrolls to it.",
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
          description: "Element tag.",
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
          description: "Element to drag.",
        },
        targetId: {
          type: "integer",
          description: "Drop target element.",
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
          description: "Canvas element tag.",
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
    description: "Hide element (display:none). For overlays/modals.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Element tag.",
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

  // Swarm Tool
  toolRegistry.register(ToolName.ACTIVATE_SWARM, SWARM_DEF, async (args) => {
    const swarmArgs = args as unknown as ActivateSwarmArgs;
    return await callKimiSwarm(swarmArgs);
  });

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

  // Service Worker Tools (chrome.* APIs)
  toolRegistry.register(
    ToolName.NAVIGATE,
    NAVIGATE_DEF,
    async (args, tabId) => {
      const urlResult = sanitizeUrl(args.url as string);
      if (!urlResult.ok) return `Error: ${urlResult.error}`;
      await chrome.tabs.update(tabId, { url: urlResult.value });

      // Wait for navigation to complete using webNavigation.onCompleted
      // Falls back to timeout if the event doesn't fire
      await new Promise<void>((resolve) => {
        const NAV_TIMEOUT = 5000;
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
        const timer = setTimeout(done, NAV_TIMEOUT);
      });

      // Brief wait for content script initialization
      await new Promise((resolve) => setTimeout(resolve, 100));
      return `Navigated to ${urlResult.value}. Call read_page to see the new content.`;
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
      return `Switched to tab ${targetTabId}. Call read_page to see its content.`;
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
    async (_args, tabId) => {
      try {
        const tab = await chrome.tabs.get(tabId);
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "jpeg",
          quality: 40,
        });
        return await describeScreenshot(dataUrl);
      } catch (e: any) {
        return `Error capturing screenshot: ${e.message}`;
      }
    },
  );

  // Control Flow Tool
  toolRegistry.register(ToolName.DONE, DONE_DEF, async (args) => {
    return (args.summary as string) || "Task completed.";
  });

  logger.info(
    "tools",
    `${toolRegistry.getDefinitions().length} tools registered`,
  );
}
