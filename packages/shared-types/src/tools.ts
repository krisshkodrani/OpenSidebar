/**
 * OpenSidebar — Tool definitions and argument types
 */

import { ScrollDirection, ToolName } from "./enums";

// --- Tool System Types ---

export type EvidenceEventType =
  | "navigation_reached"
  | "field_value_observed"
  | "fill_attempted"
  | "submit_attempted"
  | "submit_succeeded"
  | "record_identity_observed"
  | "goal_state_verified"
  | "answer_extracted"
  | "uncertainty_detected";

export type EvidenceConfidence = "high" | "medium" | "low";

export interface EvidenceEvent {
  type: EvidenceEventType;
  source: ToolName;
  confidence: EvidenceConfidence;
  observedAt: string;
  supportsTaskGoal: boolean;
  detail?: Record<string, unknown>;
}

export interface ToolExecutionResult {
  result: string;
  evidence?: EvidenceEvent[];
}

export function isTrustedEvidence(event: unknown): event is EvidenceEvent {
  if (!event || typeof event !== "object") return false;
  const candidate = event as Partial<EvidenceEvent>;
  return (
    typeof candidate.type === "string" &&
    Object.values(ToolName).includes(candidate.source as ToolName) &&
    (candidate.confidence === "high" ||
      candidate.confidence === "medium" ||
      candidate.confidence === "low") &&
    typeof candidate.observedAt === "string" &&
    typeof candidate.supportsTaskGoal === "boolean"
  );
}

/** A tool definition in OpenAI function calling format */
export interface ToolDefinition {
  type: "function";
  function: {
    name: ToolName;
    description: string;
    parameters: JsonSchema;
  };
}

/** JSON Schema subset used for tool parameter definitions */
export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
}

export interface JsonSchemaProperty {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description: string;
  enum?: (string | number)[];
  items?: JsonSchemaProperty;
  default?: unknown;
  /** Nested properties (when type is "object") */
  properties?: Record<string, JsonSchemaProperty>;
  /** Required fields (when type is "object") */
  required?: string[];
}

// --- Tool Argument Types ---

/** Arguments for click_element */
export interface ClickElementArgs {
  /** The numeric tag ID from the DOM snapshot */
  id: number;
  /** Number of times to click (for challenges requiring repeated clicks). Default 1, max 10. */
  count?: number;
}

/** Arguments for type_text */
export interface TypeTextArgs {
  /** The numeric tag ID of the input element */
  id: number;
  /** Text to type into the element */
  text: string;
  /** Whether to press Enter after typing (default: false) */
  pressEnter?: boolean;
}

/** Arguments for scroll_page */
export interface ScrollPageArgs {
  /** Direction to scroll */
  direction?: ScrollDirection;
  /** Absolute Y position from @y hints — scrolls directly to this page offset */
  y?: number;
  /** Number of pixels to scroll (default: 500) */
  amount?: number;
  /** Optional tag ID of a scrollable container. Omit to scroll the window. */
  id?: number;
}

/** Arguments for read_page — no arguments, reads the current viewport */
export type ReadPageArgs = Record<string, never>;

/** Arguments for navigate */
export interface NavigateArgs {
  /** Full URL to navigate to */
  url?: string;
  /** Search query (uses default search engine). Provide url OR query, not both. */
  query?: string;
}

/** Arguments for open_servicenow_module */
export interface OpenServiceNowModuleArgs {
  /** Optional ServiceNow application name, e.g. "Configuration" */
  application?: string;
  /** Module path labels, with the target module as the last item */
  path: string[];
  /** Whether to navigate after resolving the target URL (default true) */
  run?: boolean;
}

/** Arguments for create_tab */
export interface CreateTabArgs {
  /** URL to open in the new tab */
  url: string;
}

/** Arguments for close_tab */
export interface CloseTabArgs {
  /** Tab ID to close (defaults to current tab) */
  tabId?: number;
}

/** Arguments for switch_tab */
export interface SwitchTabArgs {
  /** Tab ID to switch to */
  tabId: number;
}

/** Arguments for hover_element */
export interface HoverElementArgs {
  /** The numeric tag ID of the element to hover */
  id: number;
}

/** Arguments for find_element */
export interface FindElementArgs {
  /** Text to search for (case-insensitive) */
  text: string;
}

/** Arguments for wait */
export interface WaitArgs {
  /** Seconds to wait (1–10) */
  seconds: number;
  /** Why you're pausing — articulating confusion helps re-focus */
  reason?: string;
}

/** Arguments for done — signals task completion */
export interface DoneArgs {
  /** Final summary message to show the user */
  summary: string;
}

/** Arguments for select_option */
export interface SelectOptionArgs {
  /** The numeric tag ID of the <select> element */
  id: number;
  /** The option text or value to select */
  value: string;
}

/** Arguments for press_key */
export interface PressKeyArgs {
  /** Key value (e.g. "Enter", "a", "ArrowDown") */
  key: string;
  /** Optional modifier keys to hold */
  modifiers?: ("ctrl" | "shift" | "alt" | "meta")[];
}

/** Arguments for drag_and_drop */
export interface DragAndDropArgs {
  /** Tag ID of the element to drag from */
  sourceId: number;
  /** Tag ID of the element to drop onto */
  targetId: number;
}

/** Arguments for hide_element */
export interface HideElementArgs {
  /** The numeric tag ID of the element to hide */
  id: number;
}

/** Arguments for escalate — voluntary model upgrade */
export interface EscalateArgs {
  /** Why the executor model can't handle this (e.g. "riddle requires multi-step reasoning") */
  reason: string;
}

/** Arguments for clarify — ask the user a question mid-execution */
export interface ClarifyArgs {
  /** The question to ask the user */
  question: string;
  /** Optional suggested answers for quick selection */
  suggestions?: string[];
}

/** Arguments for read_element */
export interface ReadElementArgs {
  /** The numeric tag ID of the element */
  id: number;
  /** Attribute name to read (e.g. "href", "src"). Omit to read text content. */
  attribute?: string;
}

/** Arguments for execute_js */
export interface ExecuteJsArgs {
  /** JavaScript code to evaluate in the page's MAIN world */
  code: string;
}

/** Arguments for upload_file */
export interface UploadFileArgs {
  /** The numeric tag ID of the <input type="file"> element */
  id: number;
  /** URL of the file to upload (fetched by the service worker) */
  url?: string;
  /** Named file from the local personal profile, e.g. "cv" */
  profileFile?: string;
}

/** Arguments for go_back */
export type GoBackArgs = Record<string, never>;

/** Arguments for list_tabs */
export type ListTabsArgs = Record<string, never>;

/** Arguments for right_click */
export interface RightClickArgs {
  /** The numeric tag ID of the element to right-click */
  id: number;
}

/** Arguments for set_checkbox */
export interface SetCheckboxArgs {
  /** The numeric tag ID of the checkbox or radio input */
  id: number;
  /** Whether the checkbox should be checked */
  checked: boolean;
}

/** Arguments for click_coordinates */
export interface ClickCoordinatesArgs {
  /** X coordinate in viewport pixels */
  x: number;
  /** Y coordinate in viewport pixels */
  y: number;
  /** What you expect to click (for logging) */
  description?: string;
}

/** Arguments for download_file */
export interface DownloadFileArgs {
  /** URL of the file to download */
  url: string;
  /** Optional filename for the downloaded file */
  filename?: string;
}

/** Arguments for get_cookies */
export interface GetCookiesArgs {
  url?: string;
}

/** Arguments for set_cookie */
export interface SetCookieArgs {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

/** Arguments for delete_cookie */
export interface DeleteCookieArgs {
  url: string;
  name: string;
}

/** Arguments for search_history */
export interface SearchHistoryArgs {
  query: string;
  maxResults?: number;
}

/** Arguments for inspect_hidden */
export interface InspectHiddenArgs {
  /** Case-insensitive text filter */
  pattern?: string;
  /** Maximum results to return (default: 25, max: 50) */
  maxResults?: number;
}

/** Arguments for inspect_chart */
export interface InspectChartArgs {
  /** Case-insensitive text filter for chart labels or series */
  pattern?: string;
  /** Maximum data labels or points to return (default: 30, max: 100) */
  maxResults?: number;
}

/** Arguments for inspect_table */
export interface InspectTableArgs {
  /** Maximum visible rows to summarize per table/list (default: 10, max: 50) */
  maxRows?: number;
}

/** Arguments for inspect_filter_state */
export interface InspectFilterStateArgs {
  /** Case-insensitive field/filter text to focus on */
  pattern?: string;
  /** Maximum controls or condition rows to return (default: 30, max: 80) */
  maxResults?: number;
}

/** One structured condition for apply_list_filter */
export interface ApplyListFilterCondition {
  /** Visible field label or system field name, e.g. "Caller" or "caller_id" */
  field: string;
  /** Operator text, e.g. "is", "is empty", "is not", or "starts with" */
  operator?: string;
  /** Display value to filter by. Empty string with "is" becomes an empty condition. */
  value?: string;
}

/** Arguments for apply_list_filter */
export interface ApplyListFilterArgs {
  /** Structured field/operator/value conditions to apply */
  conditions: ApplyListFilterCondition[];
  /** How to join multiple conditions. Defaults to OR only when the request explicitly uses OR. */
  join?: "AND" | "OR";
  /** Optional visible list/table title or system table name */
  table?: string;
  /** Whether to navigate/run the filter after building it (default true) */
  run?: boolean;
}

/** One structured sort clause for apply_list_sort */
export interface ApplyListSortClause {
  /** Visible field label or system field name, e.g. "Number" or "calendar_duration" */
  field: string;
  /** Sort direction. Defaults to ascending. */
  direction?: "ascending" | "descending" | "asc" | "desc";
}

/** Arguments for apply_list_sort */
export interface ApplyListSortArgs {
  /** Ordered sort clauses to apply, primary first */
  sorts: ApplyListSortClause[];
  /** Optional visible list/table title or system table name */
  table?: string;
  /** Whether to navigate/run the sort after building it (default true) */
  run?: boolean;
}

/** Arguments for inspect_catalog_item */
export interface InspectCatalogItemArgs {
  /** Maximum configurable controls to return (default: 40, max: 80) */
  maxControls?: number;
}

/** One text field to configure on a catalog item page */
export interface ConfigureCatalogTextField {
  /** Visible label, aria label, name, or id of the text field */
  field: string;
  /** Value to enter */
  value: string;
}

/** One checkbox to configure on a catalog item page */
export interface ConfigureCatalogCheckbox {
  /** Visible label, aria label, name, or id of the checkbox */
  label: string;
  /** Desired checked state */
  checked: boolean;
}

/** Arguments for configure_catalog_item */
export interface ConfigureCatalogItemArgs {
  /** Quantity to set when a quantity control exists */
  quantity?: number | string;
  /** Text inputs or textareas to fill by label */
  textFields?: ConfigureCatalogTextField[];
  /** Checkboxes to set by label */
  checkboxes?: ConfigureCatalogCheckbox[];
  /** Click an order/request/add-to-cart control after verifying requested values */
  submit?: boolean;
  /** Optional visible submit button label, e.g. "Order Now" */
  submitButton?: string;
}

/** One field to configure on a ServiceNow record form */
export interface ConfigureServiceNowFormField {
  /** Visible label or ServiceNow system field name */
  field: string;
  /** Value to set; empty string clears optional fields */
  value: string;
}

/** Arguments for configure_servicenow_form */
export interface ConfigureServiceNowFormArgs {
  /** Fields to set by visible label or system name */
  fields?: ConfigureServiceNowFormField[];
  /** Click Submit/Save/Update after verifying requested fields */
  submit?: boolean;
  /** Optional visible submit button label */
  submitButton?: string;
}

/** Arguments for xray_page — no arguments, simple toggle */
export type XrayPageArgs = Record<string, never>;

/** Arguments for dismiss_overlays — no arguments */
export type DismissOverlaysArgs = Record<string, never>;

/** Arguments for update_notes — save a note to the current run scratchpad */
export interface UpdateNotesArgs {
  /** The note to save (max 500 chars) */
  note: string;
}

/** Arguments for get_profile_fields — fetch exact fields from the local personal profile */
export interface GetProfileFieldsArgs {
  /** Field paths relative to the `profile` root, e.g. `identity.first_name` */
  fields: string[];
}

// --- Tool Routing Types ---

/** Maps tool names to their execution handlers */
export type ToolRouter = {
  [K in ToolName]: (args: ToolArgsMap[K]) => Promise<string | ToolExecutionResult>;
};

/** Maps each tool name to its argument type */
export type ToolArgsMap = {
  [ToolName.CLICK_ELEMENT]: ClickElementArgs;
  [ToolName.TYPE_TEXT]: TypeTextArgs;
  [ToolName.SCROLL_PAGE]: ScrollPageArgs;
  [ToolName.READ_PAGE]: ReadPageArgs;
  [ToolName.NAVIGATE]: NavigateArgs;
  [ToolName.OPEN_SERVICENOW_MODULE]: OpenServiceNowModuleArgs;

  [ToolName.CREATE_TAB]: CreateTabArgs;
  [ToolName.CLOSE_TAB]: CloseTabArgs;
  [ToolName.SWITCH_TAB]: SwitchTabArgs;
  [ToolName.HOVER_ELEMENT]: HoverElementArgs;
  [ToolName.FIND_ELEMENT]: FindElementArgs;
  [ToolName.WAIT]: WaitArgs;
  [ToolName.DONE]: DoneArgs;
  [ToolName.SELECT_OPTION]: SelectOptionArgs;
  [ToolName.PRESS_KEY]: PressKeyArgs;
  [ToolName.DRAG_AND_DROP]: DragAndDropArgs;
  [ToolName.HIDE_ELEMENT]: HideElementArgs;
  [ToolName.ESCALATE]: EscalateArgs;
  [ToolName.READ_ELEMENT]: ReadElementArgs;
  [ToolName.EXECUTE_JS]: ExecuteJsArgs;
  [ToolName.UPLOAD_FILE]: UploadFileArgs;
  [ToolName.GO_BACK]: GoBackArgs;
  [ToolName.LIST_TABS]: ListTabsArgs;
  [ToolName.RIGHT_CLICK]: RightClickArgs;
  [ToolName.SET_CHECKBOX]: SetCheckboxArgs;
  [ToolName.CLICK_COORDINATES]: ClickCoordinatesArgs;
  [ToolName.DOWNLOAD_FILE]: DownloadFileArgs;
  [ToolName.GET_COOKIES]: GetCookiesArgs;
  [ToolName.SET_COOKIE]: SetCookieArgs;
  [ToolName.DELETE_COOKIE]: DeleteCookieArgs;
  [ToolName.SEARCH_HISTORY]: SearchHistoryArgs;
  [ToolName.INSPECT_HIDDEN]: InspectHiddenArgs;
  [ToolName.INSPECT_CHART]: InspectChartArgs;
  [ToolName.INSPECT_TABLE]: InspectTableArgs;
  [ToolName.INSPECT_FILTER_STATE]: InspectFilterStateArgs;
  [ToolName.APPLY_LIST_FILTER]: ApplyListFilterArgs;
  [ToolName.APPLY_LIST_SORT]: ApplyListSortArgs;
  [ToolName.INSPECT_CATALOG_ITEM]: InspectCatalogItemArgs;
  [ToolName.CONFIGURE_CATALOG_ITEM]: ConfigureCatalogItemArgs;
  [ToolName.CONFIGURE_SERVICENOW_FORM]: ConfigureServiceNowFormArgs;
  [ToolName.XRAY_PAGE]: XrayPageArgs;
  [ToolName.DISMISS_OVERLAYS]: DismissOverlaysArgs;
  [ToolName.CLARIFY]: ClarifyArgs;
  [ToolName.UPDATE_NOTES]: UpdateNotesArgs;
  [ToolName.GET_PROFILE_FIELDS]: GetProfileFieldsArgs;
  [ToolName.CREATE_WINDOW]: Record<string, unknown>;
  [ToolName.UPDATE_PLAN]: Record<string, unknown>;
};
