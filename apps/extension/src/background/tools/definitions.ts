/**
 * Tool definitions - OpenAI function-calling schema for all tools
 */

import { ToolName, ToolDefinition } from "../../types";

export const CLICK_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.CLICK_ELEMENT,
    description:
      "Click an element by tag ID. For untagged canvas/game targets, use click_coordinates.",
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
            "Click count (default 1, max 10).",
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
      "Type into an input field. Clears existing text (appends in contenteditable). Set pressEnter only for single-field forms. For multi-field forms, fill all fields then click submit. Not for hotkeys — use press_key.",
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
      "Scroll page or container. Pass 'y' from @y hints for absolute jump, or 'direction' for relative. Prefer find_element if you know the target text.",
    parameters: {
      type: "object",
      properties: {
        y: {
          type: "integer",
          description:
            "Absolute Y position (from @y hints).",
        },
        direction: {
          type: "string",
          enum: ["up", "down", "top", "bottom"],
          description: "Direction for relative scrolling.",
        },
        amount: {
          type: "integer",
          description:
            "Pixels for relative scrolling. Use larger values such as 1200-2000 for long pages or lazy-loaded feeds.",
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
      "Force a fresh DOM snapshot. Only needed after find_element fails or dynamic content changes. Snapshot already refreshes after every action — don't call just to re-read.",
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
      "Pause for dynamic content (timed reveals, animations, AJAX). Returns goal reminder and fresh page state.",
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
      "Find exact visible text on the page, scroll to it, return its tag ID. Only literal on-screen text — not conceptual labels or attributes. For hidden content, use inspect_hidden.",
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
      "Press a keyboard key (dispatched to window). For typing text into fields, use type_text instead.",
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
            "Modifier keys to hold.",
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
      "Drag source element to target element. Look for draggable=true (sources) and dropzone=true (targets). Scroll to reveal both elements first if far apart.",
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
      "Hide a single overlay blocking interaction (display:none). Must match overlay heuristics. If rejected, try a close button or press_key Escape. To dismiss ALL overlays at once, use dismiss_overlays.",
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
      "Dismiss all overlays, popups, modals, and cookie banners blocking the viewport. Tries close buttons first, falls back to hiding. Reports surviving overlays.",
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
      "Save a brief note to the current run scratchpad. Notes survive context compression inside this run only. Use for: key element IDs, discovered values, form structure. Max 500 chars.",
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

export const GET_PROFILE_FIELDS_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.GET_PROFILE_FIELDS,
    description:
      "Read exact fields from the user's local personal profile for form filling. Request only the fields you need, using paths like identity.first_name or address.postal_code. Sensitive fields under sensitive.* require approval.",
    parameters: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          items: {
            type: "string",
            description: "Field path relative to the profile root.",
          },
          description:
            "Exact profile field paths to retrieve, e.g. [\"identity.first_name\", \"identity.last_name\"].",
        },
      },
      required: ["fields"],
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
      "Run JavaScript in the page context. Returns result as string. No jQuery. Use textContent.includes() not :contains(), getAttribute('class') not className (SVG), Array.from(querySelectorAll(...)). Wrap in (function(){ ... })() for return.",
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
      'Upload a file to an <input type="file"> element. Provide either url for a remote file or profileFile:"cv" for the user\'s saved CV/resume (max 10MB).',
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
        profileFile: {
          type: "string",
          description:
            'Named local profile file to upload. Use "cv" when the user asks to upload their saved CV/resume.',
          enum: ["cv"],
        },
      },
      required: ["id"],
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
      "Right-click on an element (dispatches contextmenu event).",
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
      "Scan for hidden DOM elements (display:none, visibility:hidden, opacity:0, off-screen, camouflage, aria-hidden). Use for hidden codes or CSS-concealed content. Not for visible text — use find_element.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Case-insensitive text filter.",
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

export const INSPECT_CHART_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.INSPECT_CHART,
    description:
      "Read chart/dashboard data from visible chart containers, SVG text, accessibility labels, and common chart libraries. Returns structured point counts and percentages when available. Use before hovering randomly on charts.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Case-insensitive text filter for chart labels or series.",
        },
        maxResults: {
          type: "integer",
          description: "Max labels, rows, or points to return (default: 30, max: 100).",
        },
      },
      required: [],
    },
  },
};

export const INSPECT_TABLE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.INSPECT_TABLE,
    description:
      "Summarize visible tables, data grids, list rows, columns, row samples, sort indicators, and URL query state.",
    parameters: {
      type: "object",
      properties: {
        maxRows: {
          type: "integer",
          description: "Max visible rows to summarize per table/list (default: 10, max: 50).",
        },
      },
      required: [],
    },
  },
};

export const INSPECT_FILTER_STATE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.INSPECT_FILTER_STATE,
    description:
      "Inspect active filters, filter-builder condition rows, field/operator/value controls, run/apply buttons, and query URL state.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Case-insensitive field or filter text to focus on.",
        },
        maxResults: {
          type: "integer",
          description: "Max controls or condition rows to return (default: 30, max: 80).",
        },
      },
      required: [],
    },
  },
};

export const APPLY_LIST_FILTER_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.APPLY_LIST_FILTER,
    description:
      "Apply a structured list/table filter from field/operator/value conditions, then verify the applied query state. For tasks like 'show records where Field is Value' or 'create a filter where A or B', call this as the first mutation instead of manually clicking complex filter-builder widgets.",
    parameters: {
      type: "object",
      properties: {
        conditions: {
          type: "array",
          description:
            "Filter conditions to apply. Use visible field labels or system field names and display values from the user request.",
          items: {
            type: "object",
            description: "One field/operator/value condition.",
            properties: {
              field: {
                type: "string",
                description: 'Visible field label or system field name, e.g. "Caller" or "caller_id".',
              },
              operator: {
                type: "string",
                description: 'Operator text such as "is", "is empty", "is not", or "starts with". Defaults to "is".',
              },
              value: {
                type: "string",
                description: "Display value to filter by. Use an empty string for empty-value filters.",
              },
            },
            required: ["field"],
          },
        },
        join: {
          type: "string",
          enum: ["AND", "OR"],
          description: "How to join multiple conditions. Use OR when the request says conditions are alternatives.",
        },
        table: {
          type: "string",
          description: "Optional visible list title or system table name when several lists are present.",
        },
        run: {
          type: "boolean",
          description: "Whether to run/navigate the filter after building it. Defaults to true.",
        },
      },
      required: ["conditions"],
    },
  },
};

export const APPLY_LIST_SORT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.APPLY_LIST_SORT,
    description:
      "Apply structured list/table sorting from ordered field/direction clauses, then verify the resulting query state. For tasks like 'sort by Number descending then Duration ascending', call this as the first mutation instead of manually clicking list headers or personalization menus.",
    parameters: {
      type: "object",
      properties: {
        sorts: {
          type: "array",
          description:
            "Ordered sort clauses, primary sort first. Use visible field labels or system field names from the user request.",
          items: {
            type: "object",
            description: "One field/direction sort clause.",
            properties: {
              field: {
                type: "string",
                description: 'Visible field label or system field name, e.g. "Number" or "calendar_duration".',
              },
              direction: {
                type: "string",
                enum: ["ascending", "descending", "asc", "desc"],
                description: "Sort direction. Defaults to ascending.",
              },
            },
            required: ["field"],
          },
        },
        table: {
          type: "string",
          description: "Optional visible list title or system table name when several lists are present.",
        },
        run: {
          type: "boolean",
          description: "Whether to run/navigate the sort after building it. Defaults to true.",
        },
      },
      required: ["sorts"],
    },
  },
};

export const INSPECT_CATALOG_ITEM_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.INSPECT_CATALOG_ITEM,
    description:
      "Summarize product/catalog configuration state: quantity, options, checkboxes, text fields, price/summary text, cart/order controls, and confirmation cues.",
    parameters: {
      type: "object",
      properties: {
        maxControls: {
          type: "integer",
          description: "Max configurable controls to return (default: 40, max: 80).",
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
      "Toggle X-ray mode: forces all hidden elements visible. Call again to disable. To read hidden content without changing visibility, use inspect_hidden.",
    parameters: { type: "object", properties: {}, required: [] },
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
