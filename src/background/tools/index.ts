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
import { registerReactTools } from "./react";
import { waitForContentScriptReady } from "../tab-ready";
import { DemoStore, formatDemoForContext } from "../demos/store";

// Export registry and types
export * from "./registry";

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// --- Tool Definitions ---

const CLICK_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.CLICK_ELEMENT,
    description: "Click an element. Auto-scrolls to it first. Use count for repeated clicks (e.g. 'click 3 times').",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Tag ID.",
        },
        count: {
          type: "integer",
          description: "Number of times to click (for challenges requiring repeated clicks). Default 1, max 10.",
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
    description:
      "Type into an input field. Auto-focuses and auto-scrolls. Clears existing text in input/textarea fields; appends in contenteditable. Only set pressEnter for single-field forms (search bars). For multi-field forms, fill all fields first then click the submit button.",
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
    description:
      "Scroll the page or a container. If you know what text you're looking for, use find_element instead — it scrolls directly to it.",
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
    description:
      "Force a fresh DOM snapshot. Only needed after find_element fails or after dynamic content changes. The page snapshot is already in your context each turn — don't call this just to 'see' the page.",
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
        type: {
          type: "string",
          enum: ["fact", "procedure", "preference"],
          description: "Memory type: fact (information), procedure (how-to steps), preference (user preferences). Auto-classified if omitted.",
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
        types: {
          type: "array",
          items: { type: "string", enum: ["fact", "procedure", "preference"] },
          description: "Filter by memory types. Omit to search all types.",
        },
      },
      required: ["query"],
    },
  },
};

const MEMORY_UPDATE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.MEMORY_UPDATE,
    description: "Update an existing long-term memory entry by ID.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory ID to update." },
        content: {
          type: "string",
          description: "Replacement memory text.",
        },
        category: {
          type: "string",
          description: "Optional replacement category tag.",
        },
      },
      required: ["id", "content"],
    },
  },
};

const MEMORY_DELETE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.MEMORY_DELETE,
    description: "Delete a long-term memory entry by ID.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory ID to delete." },
      },
      required: ["id"],
    },
  },
};

const MEMORY_LIST_CATEGORIES_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.MEMORY_LIST_CATEGORIES,
    description: "List memory categories and how many entries each contains.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
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
    description:
      "Open a new tab in this workspace. Returns the new tab's ID. Use switch_tab to make it active for subsequent tools.",
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
    description:
      "Close a tab in this workspace. Cannot close the current tab — switch_tab to another tab first.",
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
    description:
      "Switch to another tab in this workspace. All subsequent tool calls will run on this tab until you switch again.",
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
    description:
      "Signal task completion or answer the user's question with a summary.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "What was accomplished, or your answer to the user's question.",
        },
      },
      required: ["summary"],
    },
  },
};

const HOVER_ELEMENT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.HOVER_ELEMENT,
    description:
      "Hover to reveal menus, tooltips, or hidden content. Auto-scrolls to element.",
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
    description:
      "Find exact visible text on the page, scroll to it, and return its tag ID. Only works with text that literally appears on screen — do NOT search for conceptual labels, element types, or attribute values. Use read_page first if unsure what text exists.",
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
    description:
      "Select an option from a native HTML <select> dropdown. For custom dropdowns (div-based menus), click the menu to open it then click the option.",
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
    description:
      "Press a keyboard key on the page (dispatched to window, not a specific element). For typing into fields, use type_text. Useful for Escape, Tab, Enter, arrow keys.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            'Key name (e.g. "Enter", "Escape", "Tab", "ArrowDown", " " for space).',
        },
        modifiers: {
          type: "array",
          items: {
            type: "string",
            enum: ["ctrl", "shift", "alt", "meta"],
          },
          description:
            "Modifier keys to hold (e.g. ['ctrl'], ['shift', 'alt']).",
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
    description:
      "Drag source element to target element. Look for elements with draggable=true (sources) and dropzone=true (targets) in the page snapshot. Source is auto-scrolled into view but target is NOT — scroll to reveal both elements first if they're far apart.",
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
    description:
      "Draw a stroke on a canvas. Coordinates are relative to the element's top-left corner (0,0 = top-left). Auto-scrolls to canvas.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Canvas tag ID.",
        },
        startX: {
          type: "number",
          description: "Start X (relative to element top-left).",
        },
        startY: {
          type: "number",
          description: "Start Y (relative to element top-left).",
        },
        endX: {
          type: "number",
          description: "End X (relative to element top-left).",
        },
        endY: {
          type: "number",
          description: "End Y (relative to element top-left).",
        },
      },
      required: ["id", "startX", "startY", "endX", "endY"],
    },
  },
};

const HIDE_ELEMENT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.HIDE_ELEMENT,
    description:
      "Hide an overlay blocking interaction (sets display:none). Must match overlay heuristics: fixed/absolute + z-index>100, dialog role, backdrop-filter, or >30% viewport coverage. If rejected, try click_element on a close button or press_key Escape instead.",
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

const DISMISS_OVERLAYS_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.DISMISS_OVERLAYS,
    description:
      "Aggressively dismiss ALL visible popups, modals, cookie banners, overlays, and dialogs on the page. Fast — no text is captured. Use when overlays block interaction and you don't need their content.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const CLOSE_POPUPS_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.CLOSE_POPUPS,
    description:
      "Close all visible popups, modals, banners, and dialogs by clicking their dismiss/close buttons. Triggers proper JS cleanup handlers. Falls back to hiding if no close button found. Preferred over dismiss_overlays.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

const ESCALATE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.ESCALATE,
    description:
      "Switch to a smarter, slower model for complex reasoning. Use when stuck on riddles, puzzles, math, or multi-step logic.",
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

const BATCH_EXECUTE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.BATCH_EXECUTE,
    description:
      "Execute a pre-planned sequence of tool calls without LLM roundtrips. " +
      "Use for deterministic sequences where all element IDs are known (form fills, multi-click flows). " +
      "Stops on first error. Only non-navigating tools allowed inside steps.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tool: { type: "string", description: "Tool name to call" },
              args: { type: "object", description: "Tool arguments" },
              expect: {
                type: "string",
                description: "Bail if result doesn't contain this substring",
              },
            },
            required: ["tool", "args"],
          },
          description: "Ordered tool calls (max 10). Executed serially, no LLM between steps.",
        },
        verify: {
          type: "string",
          description: "What to check after all steps complete.",
        },
      },
      required: ["steps"],
    },
  },
};

const READ_ELEMENT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.READ_ELEMENT,
    description:
      "Read a specific attribute (href, src, value) of an element. For visible text, check the page snapshot first — it's already there.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Tag ID.",
        },
        attribute: {
          type: "string",
          description:
            'Attribute to read (e.g. "href", "src", "value"). Omit for text content.',
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
    description:
      "Run JavaScript in the page context. Use for hidden/computed values, timers, or DOM queries that tagged elements can't reach. Returns the result as a string. IMPORTANT: No jQuery — use el.textContent.includes() not :contains(). Use el.getAttribute('class') not el.className (fails on SVG). Use Array.from(querySelectorAll(...)) for array methods. Wrap in (function(){ ... })() if using return.",
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
    description:
      'Upload a file to an <input type="file"> element. Downloads the file from the URL (max 10MB), then injects it into the file input.',
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
    description:
      "Go forward in browser history. Waits for page load to complete.",
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
    description:
      "List open tabs in this workspace with their IDs, titles, and URLs.",
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
    description:
      "Right-click on an element (dispatches contextmenu event). Auto-scrolls to element. If no menu appears, the page may not handle contextmenu events.",
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
    description:
      "Set a checkbox or radio to checked/unchecked. Fires input and change events.",
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

const CLICK_COORDINATES_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.CLICK_COORDINATES,
    description:
      "Click at viewport X/Y coordinates. ONLY use when the target has no [N] tag (canvas apps, games, obfuscated UIs). Prefer click_element when a tag exists.",
    parameters: {
      type: "object",
      properties: {
        x: {
          type: "number",
          description: "X coordinate in viewport pixels.",
        },
        y: {
          type: "number",
          description: "Y coordinate in viewport pixels.",
        },
        description: {
          type: "string",
          description: "What you expect to click (for logging).",
        },
      },
      required: ["x", "y"],
    },
  },
};

const DOWNLOAD_FILE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.DOWNLOAD_FILE,
    description:
      "Start a download to the user's downloads folder. Returns immediately — download completes in the background.",
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
    description:
      "Transcribe speech from an <audio> or <video> element. Use when a challenge hides information in audio (spoken codes, instructions, passwords). Returns the full text transcript. Requires a Groq API key in settings.",
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

const GROUP_TABS_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.GROUP_TABS,
    description: "Group tabs into a tab group with a title and optional color.",
    parameters: {
      type: "object",
      properties: {
        tabIds: {
          type: "array",
          items: { type: "integer", description: "Tab ID." },
          description: "Tab IDs to group.",
        },
        title: { type: "string", description: "Group title." },
        color: {
          type: "string",
          enum: [
            "grey",
            "blue",
            "red",
            "yellow",
            "green",
            "pink",
            "purple",
            "cyan",
            "orange",
          ],
          description: "Group color.",
        },
      },
      required: ["tabIds", "title"],
    },
  },
};

const UNGROUP_TABS_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.UNGROUP_TABS,
    description: "Remove tabs from their tab group.",
    parameters: {
      type: "object",
      properties: {
        tabIds: {
          type: "array",
          items: { type: "integer", description: "Tab ID." },
          description: "Tab IDs to ungroup.",
        },
      },
      required: ["tabIds"],
    },
  },
};

const GET_COOKIES_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.GET_COOKIES,
    description: "Get cookies for a URL. Defaults to current tab.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to get cookies for. Omit for current tab.",
        },
      },
      required: [],
    },
  },
};

const SET_COOKIE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.SET_COOKIE,
    description: "Set a cookie for a URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to set cookie on." },
        name: { type: "string", description: "Cookie name." },
        value: { type: "string", description: "Cookie value." },
        domain: { type: "string", description: "Cookie domain." },
        path: { type: "string", description: "Cookie path." },
      },
      required: ["url", "name", "value"],
    },
  },
};

const DELETE_COOKIE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.DELETE_COOKIE,
    description: "Delete a specific cookie by name and URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL the cookie belongs to." },
        name: { type: "string", description: "Cookie name to delete." },
      },
      required: ["url", "name"],
    },
  },
};

const COPY_TO_CLIPBOARD_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.COPY_TO_CLIPBOARD,
    description: "Copy text to the system clipboard.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to copy." },
      },
      required: ["text"],
    },
  },
};

const READ_PDF_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.READ_PDF,
    description: "Extract text from a PDF URL. Returns page-by-page text.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "PDF URL." },
        maxPages: {
          type: "integer",
          description: "Max pages to extract (default: 20).",
        },
      },
      required: ["url"],
    },
  },
};

const SEARCH_HISTORY_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.SEARCH_HISTORY,
    description: "Search browser history by keyword.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword." },
        maxResults: {
          type: "integer",
          description: "Max results (default: 20).",
        },
      },
      required: ["query"],
    },
  },
};

const CREATE_BOOKMARK_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.CREATE_BOOKMARK,
    description: "Bookmark a page. Defaults to current tab.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Bookmark title." },
        url: { type: "string", description: "URL to bookmark." },
        parentId: { type: "string", description: "Parent folder ID." },
      },
      required: [],
    },
  },
};

const GET_BOOKMARKS_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.GET_BOOKMARKS,
    description: "Search bookmarks by keyword.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword." },
        maxResults: {
          type: "integer",
          description: "Max results (default: 20).",
        },
      },
      required: ["query"],
    },
  },
};

const CREATE_WINDOW_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.CREATE_WINDOW,
    description: "Open a new browser window. Optionally incognito.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open in the new window." },
        incognito: {
          type: "boolean",
          description: "Open in incognito mode.",
        },
      },
      required: [],
    },
  },
};

const INSPECT_HIDDEN_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.INSPECT_HIDDEN,
    description:
      "Scan the page for hidden DOM elements (display:none, visibility:hidden, opacity:0, off-screen, color camouflage, aria-hidden, etc). Use when you suspect content is intentionally hidden in the page — hidden codes, invisible text, or CSS-concealed elements that don't appear in the normal page snapshot.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Case-insensitive text filter. Only return elements whose text contains this substring.",
        },
        maxResults: {
          type: "integer",
          description: "Max results (default: 25, max: 50).",
        },
      },
      required: [],
    },
  },
};

const XRAY_PAGE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.XRAY_PAGE,
    description:
      "Toggle X-ray mode: forces all hidden elements visible (overrides display:none, opacity:0, visibility:hidden). Call again to disable. Use when you suspect content is hidden by CSS.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

const FAST_FORWARD_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.FAST_FORWARD,
    description:
      "Toggle fast-forward mode: accelerates all page timers (setTimeout/setInterval) to fire instantly. Use when content appears after a countdown or timed delay. Call again to restore normal timing.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

const RECALL_DEMO_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.RECALL_DEMO,
    description:
      "Retrieve a saved demonstration by name or description. Returns step-by-step instructions from a previously recorded workflow. Use when you recognize a matching demo from the catalog, or when stuck on a repetitive task.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Demo name, goal, or description to search for.",
        },
      },
      required: ["query"],
    },
  },
};

const SEND_NOTIFICATION_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.SEND_NOTIFICATION,
    description: "Show a desktop notification to the user.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Notification title." },
        message: { type: "string", description: "Notification body." },
      },
      required: ["title", "message"],
    },
  },
};

// --- Execution Bridge ---

/** Detect Chrome bridge disconnect errors that indicate the content script is gone */
function isBridgeDisconnect(errorMsg: string): boolean {
  return errorMsg.includes("Receiving end does not exist")
    || errorMsg.includes("Could not establish connection")
    || errorMsg.includes("The message port closed");
}

/** Re-inject the content script into a tab after a bridge disconnect */
async function reinjectContentScript(tabId: number): Promise<boolean> {
  try {
    const manifest = chrome.runtime.getManifest();
    const files = manifest.content_scripts?.[0]?.js;
    if (!files?.length) return false;
    await chrome.scripting.executeScript({ target: { tabId }, files });
    await waitForContentScriptReady(tabId, 3000);
    return true;
  } catch (e: any) {
    logger.error("tools", "Content script reinjection failed", { tabId, error: e.message });
    return false;
  }
}

async function executeContentTool(
  startName: ToolName,
  args: any,
  tabId: number,
): Promise<string> {
  if (tabId === chrome.tabs.TAB_ID_NONE) {
    return "Error: No active tab to execute tool on.";
  }

  logger.debug("tools", `bridge → ${startName}`, { tabId, args });

  const sendMessage = () => chrome.tabs.sendMessage(tabId, {
    type: "TOOL_EXECUTE",
    requestId: crypto.randomUUID(),
    source: MessageSource.BACKGROUND,
    payload: {
      toolName: startName,
      args,
      toolCallId: "internal",
    },
  });

  try {
    const response = await sendMessage();
    return response.payload.result;
  } catch (e: any) {
    if (!isBridgeDisconnect(e.message)) {
      logger.error("tools", "Bridge execution failed", { error: e.message });
      return `Error: Could not communicate with content script. Is the tab active? (${e.message})`;
    }

    // Bridge disconnected — check if tab is still alive
    logger.warn("tools", "Bridge disconnect detected, attempting reinject", { tabId, error: e.message });
    try {
      await chrome.tabs.get(tabId);
    } catch {
      return "Error: Tab has been closed.";
    }

    // Tab alive — reinject content script and retry once
    const reinjected = await reinjectContentScript(tabId);
    if (!reinjected) {
      return `Error: Content script disconnected and reinjection failed. Try refreshing the page.`;
    }

    try {
      const retryResponse = await sendMessage();
      logger.info("tools", "Bridge reconnect successful after reinject", { tabId, tool: startName });
      return retryResponse.payload.result;
    } catch (retryErr: any) {
      logger.error("tools", "Bridge retry failed after reinject", { tabId, error: retryErr.message });
      return `Error: Content script reconnect failed after reinjection. (${retryErr.message})`;
    }
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

      const memType = args.type as string | undefined;
      logger.info("tools", "memory_add", { category: (args.category as string) || "general", contentLen: (args.content as string).length, sourceUrl, type: memType });
      const addPayload: any = {
        action: "add",
        content: args.content as string,
        category: (args.category as string) || "general",
        sourceUrl: sourceUrl,
      };
      if (memType) addPayload.type = memType;
      const res = await sendMessageToMemory(addPayload);

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
      const typesArg = args.types as string[] | undefined;
      logger.info("tools", "memory_search", { query: args.query, types: typesArg });
      const searchPayload: any = {
        action: "search",
        query: args.query as string,
        limit: 5,
      };
      if (typesArg && typesArg.length > 0) searchPayload.types = typesArg;
      const res = await sendMessageToMemory(searchPayload);

      if (res.action === "search") {
        if (!res.results || res.results.length === 0)
          return "No relevant memories found.";
        return (
          "Found memories:\n" +
          res.results
            .map(
              (r: any) => {
                const typeLabel = r.entry.type ? `[${r.entry.type}]` : `[${r.entry.category}]`;
                return `- ${typeLabel} ${r.entry.content} (Score: ${r.score.toFixed(2)})`;
              },
            )
            .join("\n")
        );
      }
      return "Error: Unexpected response from memory worker.";
    },
  );

  toolRegistry.register(
    ToolName.MEMORY_UPDATE,
    MEMORY_UPDATE_DEF,
    async (args) => {
      logger.info("tools", "memory_update", { id: args.id });
      const res = await sendMessageToMemory({
        action: "update",
        id: args.id as string,
        content: args.content as string,
        category: args.category as string | undefined,
      });

      if (res.action === "update") {
        return res.success
          ? `Memory updated (ID: ${res.id})`
          : `Failed to update memory: ${res.error || "unknown error"}`;
      }
      return "Error: Unexpected response from memory worker.";
    },
  );

  toolRegistry.register(
    ToolName.MEMORY_DELETE,
    MEMORY_DELETE_DEF,
    async (args) => {
      logger.info("tools", "memory_delete", { id: args.id });
      const res = await sendMessageToMemory({
        action: "delete",
        id: args.id as string,
      });

      if (res.action === "delete") {
        return res.success
          ? `Memory deleted (ID: ${args.id})`
          : `Failed to delete memory: ${res.error || "unknown error"}`;
      }
      return "Error: Unexpected response from memory worker.";
    },
  );

  toolRegistry.register(
    ToolName.MEMORY_LIST_CATEGORIES,
    MEMORY_LIST_CATEGORIES_DEF,
    async () => {
      logger.info("tools", "memory_list_categories");
      const res = await sendMessageToMemory({
        action: "list_categories",
      });
      if (res.action === "list_categories") {
        if (!res.categories || res.categories.length === 0) {
          return "No memory categories found.";
        }
        return (
          "Memory categories:\n" +
          res.categories
            .map((c) => `- ${c.name}: ${c.count}`)
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
          payload: { refresh: true, showTags: false },
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
  toolRegistry.register(ToolName.DRAW_STROKE, DRAW_STROKE_DEF, (args, tabId) =>
    executeContentTool(ToolName.DRAW_STROKE, args, tabId),
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
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            let dismissed = 0;

            // Phase 1: Selector-based — dialogs, modals, overlays, banners, cookie consent
            const selectors = [
              "[role='dialog']", "[role='alertdialog']",
              ".modal", ".overlay", ".popup", ".banner",
              ".cookie", ".consent", ".notice",
              "[class*='modal']", "[class*='overlay']", "[class*='popup']",
              "[class*='banner']", "[class*='cookie']", "[class*='consent']",
              "[class*='notification']", "[class*='toast']", "[class*='snackbar']",
              "#onetrust-consent-sdk", ".fc-consent-root",
              "[class*='gdpr']", "[class*='privacy']",
            ];
            for (const sel of selectors) {
              const els = document.querySelectorAll(sel);
              for (const el of els) {
                if (!(el instanceof HTMLElement)) continue;
                const style = getComputedStyle(el);
                if (style.display === "none" || style.visibility === "hidden") continue;
                const isOverlay = style.position === "fixed" || style.position === "sticky"
                  || style.position === "absolute" || parseInt(style.zIndex, 10) > 100;
                if (!isOverlay) continue;
                el.style.display = "none";
                dismissed++;
              }
            }

            // Phase 2: Viewport-covering elements (>30% coverage, fixed/absolute)
            const vpW = window.innerWidth;
            const vpH = window.innerHeight;
            const vpArea = vpW * vpH;
            if (vpArea > 0) {
              const all = document.querySelectorAll("*");
              for (const raw of all) {
                if (!(raw instanceof HTMLElement)) continue;
                const s = getComputedStyle(raw);
                if (s.display === "none" || s.visibility === "hidden") continue;
                if (s.position !== "fixed" && s.position !== "absolute") continue;
                const r = raw.getBoundingClientRect();
                const vW = Math.max(0, Math.min(vpW, r.right) - Math.max(0, r.left));
                const vH = Math.max(0, Math.min(vpH, r.bottom) - Math.max(0, r.top));
                if ((vW * vH) / vpArea > 0.3) {
                  raw.style.display = "none";
                  dismissed++;
                }
              }
            }

            // Phase 3: ESC key
            if (dismissed > 0) {
              document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            }

            // Phase 4: Remove overflow:hidden from body (often set by modals)
            const bodyStyle = getComputedStyle(document.body);
            if (bodyStyle.overflow === "hidden") {
              document.body.style.overflow = "";
              document.documentElement.style.overflow = "";
            }

            return `Dismissed ${dismissed} overlay(s).`;
          },
        });
        return results?.[0]?.result ?? "No overlays found.";
      } catch (e: any) {
        return `Error dismissing overlays: ${e.message}`;
      }
    },
  );

  // Close popups — click dismiss/close buttons, fall back to hiding
  toolRegistry.register(
    ToolName.CLOSE_POPUPS,
    CLOSE_POPUPS_DEF,
    async (_args, tabId) => {
      logger.info("tools", "close_popups", { tabId });
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            let clicked = 0;
            let hidden = 0;
            const acted = new Set<Element>();

            function isVisible(el: Element): boolean {
              if (!(el instanceof HTMLElement)) return false;
              const s = getComputedStyle(el);
              if (s.display === "none" || s.visibility === "hidden") return false;
              if (parseFloat(s.opacity) === 0) return false;
              return el.offsetParent !== null || s.position === "fixed" || s.position === "sticky";
            }

            function findCloseBtn(container: Element): HTMLElement | null {
              // 1. aria-label close/dismiss
              const ariaEls = container.querySelectorAll(
                '[aria-label*="close" i], [aria-label*="dismiss" i], [aria-label*="Close" i], [aria-label*="Dismiss" i]'
              );
              for (const el of ariaEls) {
                if (el instanceof HTMLElement && isVisible(el)) return el;
              }
              // 2. class-based close buttons
              const classEls = container.querySelectorAll(
                '.close, .dismiss, .btn-close, [class*="close-btn"], [class*="closeBtn"], [class*="close_btn"]'
              );
              for (const el of classEls) {
                if (el instanceof HTMLElement && isVisible(el)) return el;
              }
              // 3. X / x / times character button in top-right quadrant
              const rect = container.getBoundingClientRect();
              const midX = rect.left + rect.width / 2;
              const midY = rect.top + rect.height / 2;
              const btns = container.querySelectorAll("button, [role='button'], a");
              for (const btn of btns) {
                if (!(btn instanceof HTMLElement) || !isVisible(btn)) continue;
                const text = btn.textContent?.trim() || "";
                if (/^[×✕✖xX]$/.test(text) || text === "&times;") {
                  const br = btn.getBoundingClientRect();
                  const cx = br.left + br.width / 2;
                  const cy = br.top + br.height / 2;
                  if (cx >= midX && cy <= midY) return btn;
                }
              }
              return null;
            }

            const DISMISS_PATTERNS = /^(close|dismiss|got it|ok|accept|no thanks|decline|not now|maybe later|skip|i agree|i understand|allow all|reject all|accept all|deny|continue|allow)$/i;

            function findDismissBtn(container: Element): HTMLElement | null {
              const candidates = container.querySelectorAll("button, a, [role='button']");
              for (const el of candidates) {
                if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
                const text = el.textContent?.trim() || "";
                if (DISMISS_PATTERNS.test(text)) return el;
              }
              return null;
            }

            function tryClickOrHide(container: HTMLElement): void {
              if (acted.has(container)) return;
              acted.add(container);
              const closeBtn = findCloseBtn(container);
              if (closeBtn) {
                closeBtn.click();
                clicked++;
                return;
              }
              const dismissBtn = findDismissBtn(container);
              if (dismissBtn) {
                dismissBtn.click();
                clicked++;
                return;
              }
              container.style.display = "none";
              hidden++;
            }

            // Phase 1: Overlay containers by selector
            const selectors = [
              "[role='dialog']", "[role='alertdialog']",
              ".modal", ".overlay", ".popup", ".banner",
              ".cookie", ".consent", ".notice",
              "[class*='modal']", "[class*='overlay']", "[class*='popup']",
              "[class*='banner']", "[class*='cookie']", "[class*='consent']",
              "[class*='notification']", "[class*='toast']", "[class*='snackbar']",
              "#onetrust-consent-sdk", ".fc-consent-root",
              "[class*='gdpr']", "[class*='privacy']",
            ];
            for (const sel of selectors) {
              const els = document.querySelectorAll(sel);
              for (const el of els) {
                if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
                const style = getComputedStyle(el);
                const isOverlay = style.position === "fixed" || style.position === "sticky"
                  || style.position === "absolute" || parseInt(style.zIndex, 10) > 50;
                if (!isOverlay) continue;
                tryClickOrHide(el);
              }
            }

            // Phase 2: Viewport-covering elements (>20% coverage, fixed/absolute)
            const vpW = window.innerWidth;
            const vpH = window.innerHeight;
            const vpArea = vpW * vpH;
            if (vpArea > 0) {
              const all = document.querySelectorAll("*");
              for (const raw of all) {
                if (!(raw instanceof HTMLElement) || !isVisible(raw)) continue;
                if (acted.has(raw)) continue;
                const s = getComputedStyle(raw);
                if (s.position !== "fixed" && s.position !== "absolute") continue;
                const r = raw.getBoundingClientRect();
                const vW = Math.max(0, Math.min(vpW, r.right) - Math.max(0, r.left));
                const vH = Math.max(0, Math.min(vpH, r.bottom) - Math.max(0, r.top));
                const coverage = (vW * vH) / vpArea;
                if (coverage > 0.2) {
                  // Backdrops/dimming layers — hide directly
                  const childCount = raw.children.length;
                  const text = raw.textContent?.trim() || "";
                  if (childCount <= 1 && text.length < 10) {
                    raw.style.display = "none";
                    hidden++;
                    acted.add(raw);
                  } else {
                    tryClickOrHide(raw);
                  }
                }
              }
            }

            // Phase 3: Small floating popups (fixed/absolute, z>10, dismiss-text buttons)
            if (vpArea > 0) {
              const all = document.querySelectorAll("*");
              for (const raw of all) {
                if (!(raw instanceof HTMLElement) || !isVisible(raw)) continue;
                if (acted.has(raw)) continue;
                const s = getComputedStyle(raw);
                if (s.position !== "fixed" && s.position !== "absolute") continue;
                const z = parseInt(s.zIndex, 10);
                if (!(z > 10)) continue;
                const r = raw.getBoundingClientRect();
                const vW = Math.max(0, Math.min(vpW, r.right) - Math.max(0, r.left));
                const vH = Math.max(0, Math.min(vpH, r.bottom) - Math.max(0, r.top));
                const coverage = (vW * vH) / vpArea;
                // Skip viewport-covering ones (handled in phase 2)
                if (coverage > 0.2) continue;
                // Must have at least some visible size
                if (vW < 30 || vH < 30) continue;
                // Look for dismiss button
                const dismissBtn = findDismissBtn(raw) || findCloseBtn(raw);
                if (dismissBtn) {
                  dismissBtn.click();
                  clicked++;
                  acted.add(raw);
                }
              }
            }

            // Phase 4: ESC key
            const total = clicked + hidden;
            if (total > 0) {
              document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            }

            // Phase 5: Body overflow restoration
            const bodyStyle = getComputedStyle(document.body);
            if (bodyStyle.overflow === "hidden") {
              document.body.style.overflow = "";
              document.documentElement.style.overflow = "";
            }

            return `Closed ${total} popup(s) (${clicked} clicked, ${hidden} hidden).`;
          },
        });
        return results?.[0]?.result ?? "No popups found.";
      } catch (e: any) {
        return `Error closing popups: ${e.message}`;
      }
    },
  );

  // Batch execution tool (intercepted by agent loop before executor runs)
  toolRegistry.register(ToolName.BATCH_EXECUTE, BATCH_EXECUTE_DEF, async (args) => {
    // Fallback — the loop intercepts batch_execute before reaching here
    return `Batch requested: ${(args.steps as unknown[])?.length ?? 0} steps`;
  });

  // Escalation tool (intercepted by agent loop before executor runs)
  toolRegistry.register(ToolName.ESCALATE, ESCALATE_DEF, async (args) => {
    // This executor is a fallback — the loop intercepts escalate before reaching here
    return `Escalation requested: ${(args.reason as string) || "no reason given"}`;
  });

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

      if (url) {
        const urlResult = sanitizeUrl(url);
        if (!urlResult.ok) return `Error: ${urlResult.error}`;
        await chrome.tabs.update(tabId, { url: urlResult.value });
      } else {
        await chrome.search.query({ text: query!, disposition: "CURRENT_TAB" });
      }

      await waitForNavigation(tabId);
      await waitForContentScriptReady(tabId, 2000);
      return `Navigated to ${target}. Page has loaded. Fresh page snapshot is available.`;
    },
  );

  toolRegistry.register(ToolName.CREATE_TAB, CREATE_TAB_DEF, async (args) => {
    const urlResult = sanitizeUrl(args.url as string);
    if (!urlResult.ok) return `Error: ${urlResult.error}`;
    logger.info("tools", "create_tab", { url: urlResult.value });
    const tab = await chrome.tabs.create({ url: urlResult.value });
    logger.info("tools", "create_tab created", { tabId: tab.id, url: urlResult.value });

    // Auto-add to active workspace if exists
    const activeWorkspace = await workspaceManager.getActiveWorkspace();
    if (activeWorkspace && tab.id) {
      try {
        await workspaceManager.addTabToWorkspace(tab.id, activeWorkspace.id);
        logger.info("tools", "create_tab grouped", { tabId: tab.id, workspace: activeWorkspace.name });
        return `Created new tab (ID: ${tab.id}) with URL: ${urlResult.value} (added to ${activeWorkspace.name})`;
      } catch (e) {
        logger.warn("tools", "Failed to auto-group tab to workspace", {
          tabId: tab.id,
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
      logger.info("tools", "close_tab", { targetTabId, requestedTabId: args.tabId, currentTabId: tabId });
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

  toolRegistry.register(ToolName.RIGHT_CLICK, RIGHT_CLICK_DEF, (args, tabId) =>
    executeContentTool(ToolName.RIGHT_CLICK, args, tabId),
  );

  toolRegistry.register(
    ToolName.SET_CHECKBOX,
    SET_CHECKBOX_DEF,
    (args, tabId) => executeContentTool(ToolName.SET_CHECKBOX, args, tabId),
  );

  toolRegistry.register(
    ToolName.CLICK_COORDINATES,
    CLICK_COORDINATES_DEF,
    (args, tabId) =>
      executeContentTool(ToolName.CLICK_COORDINATES, args, tabId),
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
        if (!response.ok)
          return `Error: fetch failed with status ${response.status}`;

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
        for (let i = 0; i < bytes.length; i++)
          binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);

        const contentType =
          response.headers.get("content-type") || "application/octet-stream";
        const urlPath = new URL(urlResult.value).pathname;
        const filename = urlPath.split("/").pop() || "file";

        return executeContentTool(
          ToolName.UPLOAD_FILE,
          {
            id: args.id,
            data: base64,
            filename,
            mimeType: contentType,
          },
          tabId,
        );
      } catch (e: any) {
        return `Error fetching file: ${e.message}`;
      }
    },
  );

  toolRegistry.register(ToolName.GO_BACK, GO_BACK_DEF, async (_args, tabId) => {
    logger.info("tools", "go_back", { tabId });
    try {
      await chrome.tabs.goBack(tabId);
      await waitForNavigation(tabId);
      await waitForContentScriptReady(tabId, 2000);
      return "Navigated back. Fresh page snapshot is available.";
    } catch (e: any) {
      return `Error going back: ${e.message}`;
    }
  });

  toolRegistry.register(
    ToolName.GO_FORWARD,
    GO_FORWARD_DEF,
    async (_args, tabId) => {
      logger.info("tools", "go_forward", { tabId });
      try {
        await chrome.tabs.goForward(tabId);
        await waitForNavigation(tabId);
        await waitForContentScriptReady(tabId, 2000);
        return "Navigated forward. Fresh page snapshot is available.";
      } catch (e: any) {
        return `Error going forward: ${e.message}`;
      }
    },
  );

  toolRegistry.register(ToolName.LIST_TABS, LIST_TABS_DEF, async () => {
    const tabs = await chrome.tabs.query({});
    logger.info("tools", "list_tabs", { count: tabs.length });
    if (tabs.length === 0) return "No open tabs.";
    const lines = tabs.map(
      (t: chrome.tabs.Tab) =>
        `Tab ${t.id}: "${t.title || "(untitled)"}" — ${t.url || "about:blank"}${t.active ? " [active]" : ""}`,
    );
    return lines.join("\n");
  });

  toolRegistry.register(
    ToolName.EXECUTE_JS,
    EXECUTE_JS_DEF,
    async (args, tabId) => {
      const code = args.code as string;
      logger.info("tools", "execute_js", {
        tabId,
        codeLen: code.length,
        codeSnippet: code.slice(0, 120),
      });
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN" as any,
          func: (c: string) => {
            const serialize = (value: unknown): string => {
              if (value === null || value === undefined) return String(value);
              if (typeof value === "object") {
                try {
                  return JSON.stringify(value, null, 2);
                } catch {
                  return String(value);
                }
              }
              return String(value);
            };

            const formatError = (error: unknown): string => {
              if (error instanceof Error) return error.message;
              return String(error);
            };

            try {
              // Prefer expression mode, then fall back to statement mode.
              try {
                const expressionRunner = new Function(
                  `"use strict"; return (${c});`,
                );
                return serialize(expressionRunner());
              } catch {
                const statementRunner = new Function(`"use strict"; ${c}`);
                return serialize(statementRunner());
              }
            } catch (error: unknown) {
              return `Error: ${formatError(error)}`;
            }
          },
          args: [code],
        });
        const value = results?.[0]?.result;
        return value !== undefined ? value : "undefined";
      } catch (error: unknown) {
        return `Error executing JS: ${formatUnknownError(error)}`;
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
      logger.info("tools", "download_file", { url: urlResult.value, filename });

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
      logger.info("tools", "transcribe_audio", { elementId: args.id, tabId });
      // 1. Get audio source URL from the element
      let audioUrl = await executeContentTool(
        ToolName.READ_ELEMENT,
        { id: args.id, attribute: "src" },
        tabId,
      );
      if (!audioUrl || audioUrl.startsWith("Error") || audioUrl.trim() === "") {
        // Fallback: try currentSrc (handles <source> child elements)
        audioUrl = await executeContentTool(
          ToolName.READ_ELEMENT,
          { id: args.id, attribute: "currentSrc" },
          tabId,
        );
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
      } catch {
        /* ignore */
      }
      if (!groqApiKey) {
        try {
          groqApiKey = (globalThis as any).__GROQ_API_KEY__ || "";
        } catch {
          /* ignore */
        }
      }
      if (!groqApiKey) {
        return "Error: Groq API key required. Configure it in Settings.";
      }

      // 4. Fetch the audio file (25MB Whisper limit)
      let audioBlob: Blob;
      try {
        const response = await fetch(urlResult.value);
        if (!response.ok)
          return `Error: Failed to fetch audio (HTTP ${response.status}).`;
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

        const whisperResponse = await fetch(
          "https://api.groq.com/openai/v1/audio/transcriptions",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${groqApiKey}` },
            body: formData,
          },
        );
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

  // --- Chrome API Tools ---

  toolRegistry.register(ToolName.GROUP_TABS, GROUP_TABS_DEF, async (args) => {
    const tabIds = args.tabIds as number[];
    const title = args.title as string;
    const color = args.color as string | undefined;
    logger.info("tools", "group_tabs", { tabIds, title, color });
    try {
      // Bypass the locked-workspace listener so it doesn't fight the move
      workspaceManager.bypassRegroup(tabIds);

      const groupId = await chrome.tabs.group({ tabIds });
      const updateProps: chrome.tabGroups.UpdateProperties = { title };
      if (color)
        updateProps.color = color as chrome.tabGroups.ColorEnum;
      await chrome.tabGroups.update(groupId, updateProps);

      // Reconcile: remove tabs from any workspace they no longer belong to
      for (const tid of tabIds) {
        const ws = await workspaceManager.getWorkspaceForTab(tid);
        if (ws && ws.tabGroupId !== groupId) {
          await workspaceManager.removeTabFromWorkspace(tid, ws.id);
        }
      }

      workspaceManager.clearBypassRegroup(tabIds);
      return `Grouped ${tabIds.length} tab(s) into "${title}" (group ID: ${groupId})`;
    } catch (e: any) {
      workspaceManager.clearBypassRegroup(tabIds);
      return `Error grouping tabs: ${e.message}`;
    }
  });

  toolRegistry.register(
    ToolName.UNGROUP_TABS,
    UNGROUP_TABS_DEF,
    async (args) => {
      const tabIds = args.tabIds as number[];
      logger.info("tools", "ungroup_tabs", { tabIds });
      try {
        // Bypass the locked-workspace listener so it doesn't re-add the tabs
        workspaceManager.bypassRegroup(tabIds);

        // Remove tabs from their workspaces first
        for (const tid of tabIds) {
          await workspaceManager.removeTabFromWorkspace(tid);
        }

        await chrome.tabs.ungroup(tabIds);

        workspaceManager.clearBypassRegroup(tabIds);
        return `Ungrouped ${tabIds.length} tab(s).`;
      } catch (e: any) {
        workspaceManager.clearBypassRegroup(tabIds);
        return `Error ungrouping tabs: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.GET_COOKIES,
    GET_COOKIES_DEF,
    async (args, tabId) => {
      let url = args.url as string | undefined;
      if (!url) {
        try {
          const tab = await chrome.tabs.get(tabId);
          url = tab.url;
        } catch {
          return "Error: Could not determine current tab URL.";
        }
      }
      if (!url) return "Error: No URL available.";
      logger.info("tools", "get_cookies", { url });
      try {
        const cookies = await chrome.cookies.getAll({ url });
        if (cookies.length === 0) return "No cookies found for this URL.";
        return cookies.map((c: any) => `${c.name}=${c.value}`).join("\n");
      } catch (e: any) {
        return `Error getting cookies: ${e.message}`;
      }
    },
  );

  toolRegistry.register(ToolName.SET_COOKIE, SET_COOKIE_DEF, async (args) => {
    const url = args.url as string;
    const name = args.name as string;
    const value = args.value as string;
    const domain = args.domain as string | undefined;
    const path = args.path as string | undefined;
    logger.info("tools", "set_cookie", { url, name, domain, path });
    try {
      const opts: any = { url, name, value };
      if (domain) opts.domain = domain;
      if (path) opts.path = path;
      await chrome.cookies.set(opts);
      return `Cookie "${name}" set on ${url}`;
    } catch (e: any) {
      return `Error setting cookie: ${e.message}`;
    }
  });

  toolRegistry.register(
    ToolName.DELETE_COOKIE,
    DELETE_COOKIE_DEF,
    async (args) => {
      const url = args.url as string;
      const name = args.name as string;
      logger.info("tools", "delete_cookie", { url, name });
      try {
        await chrome.cookies.remove({ url, name });
        return `Cookie "${name}" deleted from ${url}`;
      } catch (e: any) {
        return `Error deleting cookie: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.COPY_TO_CLIPBOARD,
    COPY_TO_CLIPBOARD_DEF,
    async (args, tabId) => {
      const text = args.text as string;
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (t: string) => {
            const ta = document.createElement("textarea");
            ta.value = t;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          },
          args: [text],
        });
        return "Copied to clipboard.";
      } catch (e: any) {
        return `Error copying to clipboard: ${e.message}`;
      }
    },
  );

  toolRegistry.register(ToolName.READ_PDF, READ_PDF_DEF, async (args) => {
    const url = args.url as string;
    const maxPages = args.maxPages as number | undefined;
    const urlResult = sanitizeUrl(url);
    if (!urlResult.ok) return `Error: ${urlResult.error}`;
    logger.info("tools", "read_pdf", { url: urlResult.value, maxPages });
    try {
      const res = await sendMessageToMemory({
        action: "extract_pdf",
        url: urlResult.value,
        maxPages,
      } as any);
      if ((res as any).action === "extract_pdf") {
        let text = (res as any).text as string;
        if (text.length > 50_000) {
          text = text.slice(0, 50_000) + "\n[...truncated at 50K chars]";
        }
        return text || "PDF contained no extractable text.";
      }
      return "Error: Unexpected response from PDF extractor.";
    } catch (e: any) {
      return `Error reading PDF: ${e.message}`;
    }
  });

  toolRegistry.register(
    ToolName.SEARCH_HISTORY,
    SEARCH_HISTORY_DEF,
    async (args) => {
      const query = args.query as string;
      const maxResults = (args.maxResults as number) || 20;
      logger.info("tools", "search_history", { query, maxResults });
      try {
        const items = await chrome.history.search({
          text: query,
          maxResults,
        });
        if (items.length === 0) return "No history entries found.";
        return items
          .map((item: any) => {
            const lastVisit = item.lastVisitTime
              ? new Date(item.lastVisitTime).toISOString().slice(0, 16)
              : "unknown";
            return `${item.title || "(untitled)"} — ${item.url} (visited ${item.visitCount || 1} time(s), last: ${lastVisit})`;
          })
          .join("\n");
      } catch (e: any) {
        return `Error searching history: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.CREATE_BOOKMARK,
    CREATE_BOOKMARK_DEF,
    async (args, tabId) => {
      let title = args.title as string | undefined;
      let url = args.url as string | undefined;
      const parentId = args.parentId as string | undefined;
      if (!title || !url) {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (!title) title = tab.title || "Untitled";
          if (!url) url = tab.url || "";
        } catch {
          return "Error: Could not determine current tab info.";
        }
      }
      logger.info("tools", "create_bookmark", { title, url, parentId });
      try {
        const opts: any = { title, url };
        if (parentId) opts.parentId = parentId;
        const bm = await chrome.bookmarks.create(opts);
        return `Bookmarked: "${bm.title}" — ${bm.url}`;
      } catch (e: any) {
        return `Error creating bookmark: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.GET_BOOKMARKS,
    GET_BOOKMARKS_DEF,
    async (args) => {
      const query = args.query as string;
      const maxResults = (args.maxResults as number) || 20;
      logger.info("tools", "get_bookmarks", { query, maxResults });
      try {
        const results = await chrome.bookmarks.search(query);
        if (results.length === 0) return "No bookmarks found.";
        return results
          .slice(0, maxResults)
          .map(
            (bm: any) =>
              `${bm.title || "(untitled)"} — ${bm.url || "(folder)"}`,
          )
          .join("\n");
      } catch (e: any) {
        return `Error searching bookmarks: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.CREATE_WINDOW,
    CREATE_WINDOW_DEF,
    async (args) => {
      const url = args.url as string | undefined;
      const incognito = args.incognito as boolean | undefined;
      logger.info("tools", "create_window", { url, incognito });
      try {
        const opts: any = { focused: true };
        if (url) {
          const urlResult = sanitizeUrl(url);
          if (!urlResult.ok) return `Error: ${urlResult.error}`;
          opts.url = urlResult.value;
        }
        if (incognito) opts.incognito = true;
        const win = await chrome.windows.create(opts);
        return `Created new ${incognito ? "incognito " : ""}window (ID: ${win.id})`;
      } catch (e: any) {
        return `Error creating window: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.INSPECT_HIDDEN,
    INSPECT_HIDDEN_DEF,
    async (args, tabId) => {
      const pattern = (args.pattern as string) || "";
      const maxResults = Math.min(Math.max((args.maxResults as number) || 25, 1), 50);

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN" as any,
          func: (pat: string, max: number) => {
            const SKIP_TAGS = new Set([
              "SCRIPT", "STYLE", "NOSCRIPT", "META", "LINK", "HEAD",
              "BR", "HR", "WBR", "TEMPLATE",
            ]);
            const startTime = performance.now();
            const TIME_BUDGET = 50; // ms
            const TEXT_MAX = 200;

            interface HiddenEntry {
              method: string;
              selector: string;
              text: string;
            }
            const found: HiddenEntry[] = [];
            const seenTexts = new Set<string>();

            function getDirectText(el: Element): string {
              let text = "";
              for (const node of el.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                  text += (node as Text).textContent || "";
                }
              }
              return text.trim();
            }

            function describeElement(el: Element): string {
              const tag = el.tagName.toLowerCase();
              const id = el.id ? `#${el.id}` : "";
              const cls = el.className && typeof el.className === "string"
                ? `.${el.className.split(/\s+/).slice(0, 2).join(".")}`
                : "";
              return `${tag}${id}${cls}`.slice(0, 60);
            }

            function isAncestorHidden(el: Element): string | null {
              let current = el.parentElement;
              let depth = 0;
              while (current && depth < 10) {
                if (current.tagName === "BODY" || current.tagName === "HTML") break;
                const style = getComputedStyle(current);
                if (style.display === "none") return `parent(display:none)`;
                if (style.visibility === "hidden") return `parent(visibility:hidden)`;
                if (parseFloat(style.opacity) === 0) return `parent(opacity:0)`;
                if (current.getAttribute("aria-hidden") === "true") return `parent(aria-hidden)`;
                current = current.parentElement;
                depth++;
              }
              return null;
            }

            function detectHiding(el: Element): string | null {
              // aria-hidden on the element itself
              if (el.getAttribute("aria-hidden") === "true") return "aria-hidden";

              const style = getComputedStyle(el);

              if (style.display === "none") return "display:none";
              if (style.visibility === "hidden") return "visibility:hidden";
              if (parseFloat(style.opacity) === 0) return "opacity:0";

              // clip / clip-path
              if (style.clip === "rect(0px, 0px, 0px, 0px)" ||
                  style.clipPath === "inset(100%)" ||
                  style.clipPath === "polygon(0px 0px, 0px 0px, 0px 0px)") {
                return "clip";
              }

              // Zero-size with overflow hidden
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 && rect.height === 0 &&
                  (style.overflow === "hidden" || style.overflow === "clip")) {
                return "zero-size+overflow:hidden";
              }

              // Off-screen positioning
              if (rect.right < -500 || rect.bottom < -500 ||
                  rect.left > window.innerWidth + 500 ||
                  rect.top > window.innerHeight + 500) {
                return "off-screen";
              }

              // Negative text-indent
              const textIndent = parseFloat(style.textIndent);
              if (textIndent < -500) return "text-indent";

              // Color camouflage: text color matches background
              if (style.color && style.backgroundColor &&
                  style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
                  style.backgroundColor !== "transparent" &&
                  style.color === style.backgroundColor) {
                return "color-camouflage";
              }

              // Font-size: 0
              if (parseFloat(style.fontSize) === 0) return "font-size:0";

              // Check parent hiding
              return isAncestorHidden(el);
            }

            const allElements = document.querySelectorAll("*");
            for (let i = 0; i < allElements.length; i++) {
              if (performance.now() - startTime > TIME_BUDGET) break;
              if (found.length >= max) break;

              const el = allElements[i];
              if (SKIP_TAGS.has(el.tagName)) continue;
              // Skip SVG internals
              if (el.closest("svg") && el.tagName !== "SVG") continue;

              const method = detectHiding(el);
              if (!method) continue;

              // Prefer direct text to avoid duplicates from parent containers
              let text = getDirectText(el);
              if (!text) text = (el.textContent || "").trim();
              if (!text) continue;

              // Truncate
              if (text.length > TEXT_MAX) text = text.slice(0, TEXT_MAX) + "...";

              // Pattern filter
              if (pat && !text.toLowerCase().includes(pat.toLowerCase())) continue;

              // Dedup by text
              if (seenTexts.has(text)) continue;
              seenTexts.add(text);

              found.push({
                method,
                selector: describeElement(el),
                text,
              });
            }

            // Sort by text length descending (longer = more meaningful)
            found.sort((a, b) => b.text.length - a.text.length);

            const elapsed = Math.round(performance.now() - startTime);
            if (found.length === 0) {
              return `No hidden elements found${pat ? ` matching "${pat}"` : ""} (scanned in ${elapsed}ms).`;
            }

            const lines = found.map((entry, idx) =>
              `${idx + 1}. [${entry.method}] ${entry.selector}\n   Text: "${entry.text}"`
            );
            return `Found ${found.length} hidden element(s)${pat ? ` matching "${pat}"` : ""} (scanned in ${elapsed}ms):\n\n${lines.join("\n\n")}`;
          },
          args: [pattern, maxResults],
        });
        const value = results?.[0]?.result;
        return value !== undefined ? value : "No hidden elements found.";
      } catch (e: any) {
        return `Error scanning hidden elements: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.SEND_NOTIFICATION,
    SEND_NOTIFICATION_DEF,
    async (args) => {
      const title = args.title as string;
      const message = args.message as string;
      try {
        const notifId = `opensidebar-${Date.now()}`;
        chrome.notifications.create(notifId, {
          type: "basic",
          iconUrl: "/public/icons/icon-128.png",
          title,
          message,
        } as any);
        return `Notification sent: "${title}"`;
      } catch (e: any) {
        return `Error sending notification: ${e.message}`;
      }
    },
  );

  // Page Assist Tools (xray_page, fast_forward)
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

  toolRegistry.register(
    ToolName.FAST_FORWARD,
    FAST_FORWARD_DEF,
    async (_args, tabId) => {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN" as any,
        func: () => {
          const g = globalThis as any;
          if (g.__osb_origTimers) {
            window.setTimeout = g.__osb_origTimers.setTimeout;
            window.setInterval = g.__osb_origTimers.setInterval;
            delete g.__osb_origTimers;
            return "Fast-forward disabled. Timers restored to normal speed.";
          }
          g.__osb_origTimers = {
            setTimeout: window.setTimeout.bind(window),
            setInterval: window.setInterval.bind(window),
          };
          const origST = g.__osb_origTimers.setTimeout;
          const origSI = g.__osb_origTimers.setInterval;
          (window as any).setTimeout = (fn: any, delay?: number, ...a: any[]) =>
            origST(fn, Math.min(delay || 0, 10), ...a);
          (window as any).setInterval = (fn: any, delay?: number, ...a: any[]) =>
            origSI(fn, Math.max(Math.min(delay || 0, 10), 1), ...a);
          return "Fast-forward enabled. All timers now fire instantly.";
        },
      });
      return results?.[0]?.result ?? "Fast-forward toggled.";
    },
  );

  // Demo recall tool
  toolRegistry.register(
    ToolName.RECALL_DEMO,
    RECALL_DEMO_DEF,
    async (args) => {
      const query = args.query as string;
      if (!query || !query.trim()) return "Error: query is required.";
      logger.info("tools", "recall_demo", { query });
      try {
        const demoStore = new DemoStore();
        const demo = await demoStore.findByQuery(query);
        if (!demo) return `No demonstration found matching "${query}".`;
        await demoStore.recordDemoUsage(demo.id);
        return formatDemoForContext(demo);
      } catch (e: any) {
        return `Error recalling demo: ${e.message}`;
      }
    },
  );

  // React toolkit — gated behind disabledTools until React is detected
  registerReactTools(toolRegistry);

  logger.info(
    "tools",
    `${toolRegistry.getDefinitions().length} tools registered`,
  );
}
