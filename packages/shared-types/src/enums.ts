/**
 * OpenSidebar — Leaf enums and primitive types (no internal imports)
 */

/** Current operational state of the agent */
export enum AgentStatus {
  /** No active task — idle, waiting for user input */
  IDLE = "IDLE",
  /** Agent is calling the LLM and awaiting a response */
  THINKING = "THINKING",
  /** Agent is executing a tool call in the content script */
  ACTING = "ACTING",
  /** Agent has triggered navigation and is waiting for page load */
  WAITING_FOR_PAGE_LOAD = "WAITING_FOR_PAGE_LOAD",
  /** Agent encountered an unrecoverable error */
  ERROR = "ERROR",
  /** Agent loop is paused by user (awaiting resume) */
  PAUSED = "PAUSED",
}

/** Extension context that originated or receives a message */
export enum MessageSource {
  SIDEPANEL = "sidepanel",
  BACKGROUND = "background",
  CONTENT = "content",
}

/** Role contract for orchestrator-managed agent collaboration */
export type AgentRole = "planner" | "executor" | "verifier";

/** Tool identifiers exposed to the LLM */
export enum ToolName {
  CLICK_ELEMENT = "click_element",
  TYPE_TEXT = "type_text",
  SCROLL_PAGE = "scroll_page",
  READ_PAGE = "read_page",
  NAVIGATE = "navigate",
  OPEN_SERVICENOW_MODULE = "open_servicenow_module",

  CREATE_TAB = "create_tab",
  CLOSE_TAB = "close_tab",
  SWITCH_TAB = "switch_tab",
  HOVER_ELEMENT = "hover_element",
  FIND_ELEMENT = "find_element",
  WAIT = "wait",
  DONE = "done",
  SELECT_OPTION = "select_option",
  PRESS_KEY = "press_key",
  DRAG_AND_DROP = "drag_and_drop",
  HIDE_ELEMENT = "hide_element",
  ESCALATE = "escalate",
  READ_ELEMENT = "read_element",
  EXECUTE_JS = "execute_js",
  UPLOAD_FILE = "upload_file",
  GO_BACK = "go_back",
  LIST_TABS = "list_tabs",
  RIGHT_CLICK = "right_click",
  SET_CHECKBOX = "set_checkbox",
  CLICK_COORDINATES = "click_coordinates",
  DOWNLOAD_FILE = "download_file",
  GET_COOKIES = "get_cookies",
  SET_COOKIE = "set_cookie",
  DELETE_COOKIE = "delete_cookie",
  SEARCH_HISTORY = "search_history",
  INSPECT_HIDDEN = "inspect_hidden",
  INSPECT_CHART = "inspect_chart",
  INSPECT_TABLE = "inspect_table",
  INSPECT_FILTER_STATE = "inspect_filter_state",
  APPLY_LIST_FILTER = "apply_list_filter",
  APPLY_LIST_SORT = "apply_list_sort",
  INSPECT_CATALOG_ITEM = "inspect_catalog_item",
  CONFIGURE_CATALOG_ITEM = "configure_catalog_item",
  XRAY_PAGE = "xray_page",
  DISMISS_OVERLAYS = "dismiss_overlays",
  CLARIFY = "clarify",
  UPDATE_NOTES = "update_notes",
  GET_PROFILE_FIELDS = "get_profile_fields",
  CREATE_WINDOW = "create_window",
  UPDATE_PLAN = "update_plan",
}

/** Risk classification for a tool invocation */
export enum RiskLevel {
  /** No side effects — read-only operations */
  LOW = "low",
  /** Mutates page state but is reversible (click, type) */
  MEDIUM = "medium",
  /** Navigates away, closes tabs, or sends data externally */
  HIGH = "high",
}

/** Direction for the scroll_page tool */
export enum ScrollDirection {
  UP = "up",
  DOWN = "down",
  TOP = "top",
  BOTTOM = "bottom",
}
