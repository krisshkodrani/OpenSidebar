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

/** Arguments for compose_text — delegate prose to the Writer specialist */
export interface ComposeTextArgs {
  /** The numeric tag ID of the target free-text field */
  id: number;
  /** What to write and any framing the Writer needs */
  instructions: string;
  /** Optional source material the answer should draw on */
  context?: string;
  /** Optional desired tone/register */
  tone?: string;
  /** Optional soft word limit */
  maxWords?: number;
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

/** Arguments for search_knowledge_base */
export interface SearchKnowledgeBaseArgs {
  /** Exact user question to answer from the knowledge source */
  question: string;
  /** Optional search query. Defaults to distinctive terms from the question. */
  query?: string;
  /** Expected answer shape. Defaults to auto; use number for count/percent/date-like numeric questions. */
  answerType?: "auto" | "number" | "text";
  /** Maximum result articles to fetch and rank (default 5, max 10). */
  maxResults?: number;
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
  /** Structured escalation reason; missing_tool only when the capability catalog lacks it */
  reasonCode?: "stuck" | "complex_reasoning" | "missing_tool" | "blocked" | "other";
  /** For reasonCode=missing_tool, the absent capability needed to proceed */
  requiredCapability?: string;
  /** Capabilities the executor believes are available from the current catalog */
  availableCapabilitiesSeenByExecutor?: string[];
  /** The concrete next action that cannot be performed without escalation */
  blockingAction?: string;
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

/** Arguments for extract_form_state (LP-15 Phase 8) */
export interface ExtractFormStateArgs {
  /**
   * Tag ID of a field or submit control inside the target form. Omit to capture
   * the primary (first) form on the page.
   */
  id?: number;
  /**
   * Capture the primary form (default, for submit verification) or every form
   * control in the document (for user-facing form inventories).
   */
  scope?: "primary_form" | "document";
}

export interface FormStateOption {
  value: string;
  label: string;
  selected: boolean;
}

/** A single captured form control. */
export interface FormStateField {
  /** name / id / aria-label of the control. */
  name: string;
  /**
   * The control's visible/accessible label (`<label for>`, wrapping `<label>`,
   * `aria-labelledby`, or `aria-label`), when resolvable. The dry-run matches a
   * draft's expected label against this AND `name` — a checkbox's `name` is
   * usually an id like `partner-terms`, so without the label it never matches
   * the drafted "I accept the …" expectation and reads as a spurious `missing`.
   */
  label?: string;
  /** A CSS selector that locates the control (id > [name] > tag). */
  selector: string;
  /** Control kind: the input `type`, or the tag name for select/textarea. */
  kind: string;
  /** Current value; "checked"/"unchecked" for checkbox/radio. */
  value: string;
  /** Whether the control is disabled. */
  disabled: boolean;
  /** Whether the page marks the control as required. */
  required: boolean;
  /** Whether the control currently contains a value or checked selection. */
  filled: boolean;
  /** Native constraint-validation result when the browser exposes one. */
  valid: boolean;
  /** Browser-provided validation detail for an invalid control. */
  validationMessage?: string;
  /** Available choices for select, radio, and checkbox controls. */
  options?: FormStateOption[];
}

/** The structured form-state capture returned by extract_form_state. */
export interface FormStateCapture {
  /** Stable-ish form identity (action > id > name > page path). */
  formKey: string;
  /** Scope actually inspected. */
  scope: "primary_form" | "document";
  /** Number of forms present in the traversable document. */
  formCount: number;
  /** False when a known browser boundary prevented a complete capture. */
  complete: boolean;
  /** Human-readable reasons why the capture may be partial. */
  limitations: string[];
  fields: FormStateField[];
  submitTargets: Array<{ label: string; selector: string }>;
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
  url: string;
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

/** Arguments for inspect_region (RFC LP-13): magnify a screen region. */
export interface InspectRegionArgs {
  /** Sugar: zoom onto tag N's live bounding box with 20px padding. */
  id?: number;
  /** Rect in viewport CSS pixels — the same space as @box(x,y WxH) hints. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Why the zoom is needed — recorded in the trace. */
  purpose?: string;
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

/** Arguments for apply_list_action */
export interface ApplyListActionArgs {
  /** Visible record identifiers or unique row text snippets to select */
  records: string[];
  /** Visible selected-row action label, e.g. Delete or Mark as Duplicate */
  action: string;
  /** Optional related/reference record value required by the action modal */
  relatedRecord?: string;
  /** Optional visible/reference field label or system field name for relatedRecord */
  relatedField?: string;
  /** Optional visible list/table title or system table name */
  table?: string;
  /** Confirm a resulting modal/dialog. Defaults to true. */
  confirm?: boolean;
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

/** One dropdown/select/radio option to choose on a catalog item page */
export interface ConfigureCatalogOptionField {
  /** Visible label, aria label, name, id, or nearby catalog variable label of the option field */
  field: string;
  /** Option label or value to select */
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
  /** Expected visible catalog item name; submit is refused if the current item does not match */
  expectedItem?: string;
  /** Quantity to set when a quantity control exists */
  quantity?: number | string;
  /** Text inputs or textareas to fill by label */
  textFields?: ConfigureCatalogTextField[];
  /** Dropdown/select/radio-like options to choose by label */
  optionFields?: ConfigureCatalogOptionField[];
  /** Checkboxes to set by label */
  checkboxes?: ConfigureCatalogCheckbox[];
  /** Click an order/request/add-to-cart control after verifying requested values */
  submit?: boolean;
  /** Optional visible submit button label, e.g. "Order Now" */
  submitButton?: string;
  /** After an add-to-cart submit, continue to a visible cart checkout control */
  continueToCheckout?: boolean;
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

/** Arguments for get_profile_fields - fetch exact facts from the local Profile Digest */
export interface GetProfileFieldsArgs {
  /** Profile labels or field paths, e.g. `full_name` or `email` */
  fields: string[];
}

/** Arguments for create_window */
export interface CreateWindowArgs {
  /** Optional URL to open in the new window */
  url?: string;
}

/** Arguments for update_plan */
export interface UpdatePlanArgs {
  /** Brief summary of progress or plan update */
  summary?: string;
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
  [ToolName.SEARCH_KNOWLEDGE_BASE]: SearchKnowledgeBaseArgs;

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
  [ToolName.EXTRACT_FORM_STATE]: ExtractFormStateArgs;
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
  [ToolName.APPLY_LIST_ACTION]: ApplyListActionArgs;
  [ToolName.INSPECT_CATALOG_ITEM]: InspectCatalogItemArgs;
  [ToolName.CONFIGURE_CATALOG_ITEM]: ConfigureCatalogItemArgs;
  [ToolName.CONFIGURE_SERVICENOW_FORM]: ConfigureServiceNowFormArgs;
  [ToolName.XRAY_PAGE]: XrayPageArgs;
  [ToolName.DISMISS_OVERLAYS]: DismissOverlaysArgs;
  [ToolName.CLARIFY]: ClarifyArgs;
  [ToolName.UPDATE_NOTES]: UpdateNotesArgs;
  [ToolName.GET_PROFILE_FIELDS]: GetProfileFieldsArgs;
  [ToolName.CREATE_WINDOW]: CreateWindowArgs;
  [ToolName.UPDATE_PLAN]: UpdatePlanArgs;
  [ToolName.COMPOSE_TEXT]: ComposeTextArgs;
  [ToolName.INSPECT_REGION]: InspectRegionArgs;
};
