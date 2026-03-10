/**
 * Tool definitions - OpenAI function-calling schema for all 35 tools
 */

import { ToolName, ToolDefinition } from "../../types";

export const CLICK_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.CLICK_ELEMENT,
    description:
      "Click an element. Auto-scrolls to it first. Use count for repeated clicks (e.g. 'click 3 times'). Not for canvas/game elements without tags — use click_coordinates.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Tag ID.",
        },
        count: {
          type: "integer",
          description:
            "Number of times to click (for challenges requiring repeated clicks). Default 1, max 10.",
        },
      },
      required: ["id"],
    },
  },
};

export const TYPE_TEXT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.TYPE_TEXT,
    description:
      "Type into an input field. Auto-focuses and auto-scrolls. Clears existing text in input/textarea fields; appends in contenteditable. Only set pressEnter for single-field forms (search bars). For multi-field forms, fill all fields first then click the submit button. Not for keyboard shortcuts or hotkeys — use press_key.",
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

export const SCROLL_PAGE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.SCROLL_PAGE,
    description:
      "Scroll the page or a container. Pass 'y' from @y hints to jump directly, or 'direction' for relative scrolling. If you know what text you're looking for, use find_element instead.",
    parameters: {
      type: "object",
      properties: {
        y: {
          type: "integer",
          description: "Absolute Y position (from @y hints). Scrolls directly to this page offset.",
        },
        direction: {
          type: "string",
          enum: ["up", "down", "top", "bottom"],
          description: "Direction for relative scrolling.",
        },
        id: {
          type: "integer",
          description: "Container tag ID. Omit for window.",
        },
      },
      required: [],
    },
  },
};

export const READ_PAGE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.READ_PAGE,
    description:
      "Force a fresh DOM snapshot. Only needed after find_element fails or after dynamic content changes. The page snapshot is already in your context each turn — don't call this just to 'see' the page. Not for searching text (use find_element) or waiting (use wait).",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export const NAVIGATE_DEF: ToolDefinition = {
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
      required: [],
    },
  },
};

export const CREATE_TAB_DEF: ToolDefinition = {
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

export const CLOSE_TAB_DEF: ToolDefinition = {
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

export const SWITCH_TAB_DEF: ToolDefinition = {
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

export const WAIT_DEF: ToolDefinition = {
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

export const DONE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.DONE,
    description:
      "Signal task completion or answer the user's question with a summary. NEVER use done() to ask the user a question — use clarify() instead.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "Your answer or report in clean Markdown. Use bullet points, headings, and clear structure. Write for the user — no internal reasoning.",
        },
      },
      required: ["summary"],
    },
  },
};

export const HOVER_ELEMENT_DEF: ToolDefinition = {
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

export const FIND_ELEMENT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.FIND_ELEMENT,
    description:
      "Find exact visible text on the page, scroll to it, and return its tag ID. Only works with text that literally appears on screen — do NOT search for conceptual labels, element types, or attribute values. Use read_page first if unsure what text exists. Only finds VISIBLE text. For hidden/CSS-concealed content, use inspect_hidden.",
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

export const SELECT_OPTION_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.SELECT_OPTION,
    description:
      "Select an option from a native HTML <select> dropdown ONLY. For div-based custom dropdowns, click the menu to open it then click_element the option.",
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

export const PRESS_KEY_DEF: ToolDefinition = {
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
            description: "A modifier key.",
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

export const DRAG_AND_DROP_DEF: ToolDefinition = {
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

export const HIDE_ELEMENT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.HIDE_ELEMENT,
    description:
      "Hide an overlay blocking interaction (sets display:none). Must match overlay heuristics: fixed/absolute + z-index>100, dialog role, backdrop-filter, or >30% viewport coverage. If rejected, try click_element on a close button or press_key Escape instead. To dismiss ALL overlays at once, use dismiss_overlays first.",
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

export const DISMISS_OVERLAYS_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.DISMISS_OVERLAYS,
    description:
      "Dismiss all overlays, popups, modals, cookie banners, and dialogs blocking the viewport. Tries close/dismiss buttons first (triggering proper JS cleanup), then falls back to hiding. Reports any surviving overlay with its tag ID so you can hide_element it. To target ONE specific overlay by tag ID, use hide_element instead.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export const ESCALATE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.ESCALATE,
    description:
      "Switch to the planner model for complex reasoning. Use when stuck on riddles, puzzles, math, or multi-step logic.",
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

export const CLARIFY_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.CLARIFY,
    description:
      "Ask the user a question when you encounter ambiguity that cannot be resolved from the page. Use when multiple valid interpretations exist or user preferences are unknown.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to ask the user.",
        },
        suggestions: {
          type: "array",
          items: { type: "string", description: "A suggested answer." },
          description: "Optional suggested answers for quick selection.",
        },
      },
      required: ["question"],
    },
  },
};

export const UPDATE_NOTES_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.UPDATE_NOTES,
    description:
      "Save a brief note to persistent working memory. Notes survive context compression. Use for: key element IDs, discovered values, form structure. Max 500 chars.",
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "The note to save.",
        },
      },
      required: ["note"],
    },
  },
};

export const READ_ELEMENT_DEF: ToolDefinition = {
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

export const EXECUTE_JS_DEF: ToolDefinition = {
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

export const UPLOAD_FILE_DEF: ToolDefinition = {
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

export const GO_BACK_DEF: ToolDefinition = {
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

export const LIST_TABS_DEF: ToolDefinition = {
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

export const RIGHT_CLICK_DEF: ToolDefinition = {
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

export const SET_CHECKBOX_DEF: ToolDefinition = {
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

export const CLICK_COORDINATES_DEF: ToolDefinition = {
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

export const DOWNLOAD_FILE_DEF: ToolDefinition = {
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

export const GET_COOKIES_DEF: ToolDefinition = {
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

export const SET_COOKIE_DEF: ToolDefinition = {
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

export const DELETE_COOKIE_DEF: ToolDefinition = {
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

export const SEARCH_HISTORY_DEF: ToolDefinition = {
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

export const INSPECT_HIDDEN_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.INSPECT_HIDDEN,
    description:
      "Scan the page for hidden DOM elements (display:none, visibility:hidden, opacity:0, off-screen, color camouflage, aria-hidden, etc). Use when you suspect content is intentionally hidden in the page — hidden codes, invisible text, or CSS-concealed elements that don't appear in the normal page snapshot. Not for visible text — use find_element for that.",
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

export const XRAY_PAGE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.XRAY_PAGE,
    description:
      "Toggle X-ray mode: forces all hidden elements visible (overrides display:none, opacity:0, visibility:hidden). Call again to disable. Use when you suspect content is hidden by CSS. To just read hidden content without changing visibility, use inspect_hidden.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const RECALL_DEMO_DEF: ToolDefinition = {
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

export const CREATE_WINDOW_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.CREATE_WINDOW,
    description:
      "Open a new browser window. Used by the orchestrator for parallel lane execution.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Optional URL to open in the new window.",
        },
      },
      required: [],
    },
  },
};

export const UPDATE_PLAN_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.UPDATE_PLAN,
    description:
      "Update the current task plan with progress or revised steps. Intercepted by the agent loop to broadcast progress to the side panel.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Brief summary of progress or plan update.",
        },
      },
      required: [],
    },
  },
};
