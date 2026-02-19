/**
 * OpenSidebar — TypeScript Types Reference
 * Source of truth for every interface, type, enum, and constant used across the project.
 */

// --- Enums ---

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
  OFFSCREEN = "offscreen",
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

  MEMORY_SEARCH = "memory_search",
  MEMORY_ADD = "memory_add",
  MEMORY_UPDATE = "memory_update",
  MEMORY_DELETE = "memory_delete",
  MEMORY_LIST_CATEGORIES = "memory_list_categories",
  CREATE_TAB = "create_tab",
  CLOSE_TAB = "close_tab",
  SWITCH_TAB = "switch_tab",
  TAKE_SCREENSHOT = "take_screenshot",
  HOVER_ELEMENT = "hover_element",
  FIND_ELEMENT = "find_element",
  WAIT = "wait",
  DONE = "done",
  SELECT_OPTION = "select_option",
  PRESS_KEY = "press_key",
  DRAG_AND_DROP = "drag_and_drop",
  DRAW_STROKE = "draw_stroke",
  HIDE_ELEMENT = "hide_element",
  ESCALATE = "escalate",
  READ_ELEMENT = "read_element",
  EXECUTE_JS = "execute_js",
  UPLOAD_FILE = "upload_file",
  GO_BACK = "go_back",
  GO_FORWARD = "go_forward",
  LIST_TABS = "list_tabs",
  RIGHT_CLICK = "right_click",
  SET_CHECKBOX = "set_checkbox",
  CLICK_COORDINATES = "click_coordinates",
  DOWNLOAD_FILE = "download_file",
  TRANSCRIBE_AUDIO = "transcribe_audio",
  GROUP_TABS = "group_tabs",
  UNGROUP_TABS = "ungroup_tabs",
  GET_COOKIES = "get_cookies",
  SET_COOKIE = "set_cookie",
  DELETE_COOKIE = "delete_cookie",
  COPY_TO_CLIPBOARD = "copy_to_clipboard",
  READ_PDF = "read_pdf",
  SEARCH_HISTORY = "search_history",
  CREATE_BOOKMARK = "create_bookmark",
  GET_BOOKMARKS = "get_bookmarks",
  CREATE_WINDOW = "create_window",
  SEND_NOTIFICATION = "send_notification",
  INSPECT_HIDDEN = "inspect_hidden",
  XRAY_PAGE = "xray_page",
  FAST_FORWARD = "fast_forward",
  DISMISS_OVERLAYS = "dismiss_overlays",
  BATCH_EXECUTE = "batch_execute",

  // React toolkit (on-demand — enabled only when React is detected on the page)
  INSPECT_REACT = "inspect_react",
  REACT_SET_INPUT = "react_set_input",
  INSPECT_REACT_TREE = "inspect_react_tree",
  WAIT_FOR_REACT = "wait_for_react",
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

// --- Core Message Types ---

/** Base shape shared by every runtime message */
export interface BaseMessage {
  /** Unique request ID for correlating async responses */
  requestId: string;
  /** Where this message originated */
  source: MessageSource | string;
  /** Workspace this message belongs to (null = global / unscoped) */
  workspaceId?: string | null;
}

/**
 * Discriminated union of all message types.
 * The `type` field is the discriminant.
 */
export type RuntimeMessage =
  | UserChatMessage
  | AgentResponseMessage
  | AgentStatusMessage
  | TaskRecoveryMessage
  | EscalationRequestMessage
  | EscalationDecisionMessage
  | ApprovalRequestMessage
  | ApprovalResponseMessage
  | AgentStepMessage
  | AgentActivityMessage
  | StreamChunkMessage
  | ToolExecuteMessage
  | ToolResultMessage
  | DomSnapshotRequest
  | DomSnapshotResponse
  | NavigationResumeMessage
  | MemoryWorkerMessage
  | MemoryWorkerResponse
  | StopAgentMessage
  | SettingsUpdateMessage
  | SidePanelOpenedMessage
  | CloseSidePanelMessage
  | ScreenshotCapturedMessage
  | DismissModalsMessage
  | DismissModalsResponse
  | AgentStuckMessage
  | AgentTurnMessage
  | TaskProgressMessage
  | TaskCompletionMessage
  | SkipSubtaskMessage
  | PauseAgentMessage
  | ResumeAgentMessage
  | SessionMetricsMessage
  | DataControlRequestMessage
  | DataControlResultMessage
  | ContentScriptReadyMessage
  | DomReadyProbeMessage
  | DomReadyAckMessage
  | DemoRecordStartMessage
  | DemoRecordStopMessage
  | DemoActionCapturedMessage
  | DemoRecordStatusMessage
  | DemoSavedMessage
  | GoldenActionMessage
  | GoldenSavedMessage;

/** User sends a new chat message from the side panel */
export interface UserChatMessage extends BaseMessage {
  type: "USER_CHAT";
  source: MessageSource.SIDEPANEL;
  payload: {
    text: string;
    /** Active tab ID at time of sending */
    tabId: number;
    /** Active workspace ID, if any */
    workspaceId: string | null;
    /** When true, inject as hint into running agent context (don't start new loop) */
    isHint?: boolean;
  };
}

/** Background sends a completed agent response to the side panel */
export interface AgentResponseMessage extends BaseMessage {
  type: "AGENT_RESPONSE";
  source: MessageSource.BACKGROUND;
  payload: {
    text: string;
    /** Whether the agent loop is still running (more messages may follow) */
    isStreaming: boolean;
    /** Tool calls that were executed during this turn */
    toolCalls: ToolCallSummary[];
    /** Source citations collected during the session */
    citations?: Citation[];
  };
}

/** Background broadcasts status changes to the side panel */
export interface AgentStatusMessage extends BaseMessage {
  type: "AGENT_STATUS";
  source: MessageSource.BACKGROUND;
  payload: {
    status: AgentStatus;
    /** Human-readable description (e.g. "Clicking button [12]") */
    detail: string;
  };
}

/** Background requests user approval before executing a high-risk tool */
export interface ApprovalRequestMessage extends BaseMessage {
  type: "APPROVAL_REQUEST";
  source: MessageSource.BACKGROUND;
  payload: {
    approvalId: string;
    toolName: ToolName;
    args: Record<string, unknown>;
    risk: RiskLevel.HIGH;
    context: string;
    timeoutMs: number;
  };
}

/** Side panel responds to a pending approval request */
export interface ApprovalResponseMessage extends BaseMessage {
  type: "APPROVAL_RESPONSE";
  source: MessageSource.SIDEPANEL;
  payload: {
    approvalId: string;
    approved: boolean;
  };
}

/** A single SSE chunk from the LLM stream, forwarded to side panel */
export interface StreamChunkMessage extends BaseMessage {
  type: "STREAM_CHUNK";
  source: MessageSource.BACKGROUND;
  payload: {
    /** Incremental text delta */
    delta: string;
    /** True when this is the final chunk */
    done: boolean;
    /** Source citations collected during the session (only present on done=true) */
    citations?: Citation[];
  };
}

/** User requests the agent loop to stop */
export interface StopAgentMessage extends BaseMessage {
  type: "STOP_AGENT";
  source: MessageSource.SIDEPANEL;
  payload: {
    workspaceId?: string | null;
  };
}

/** Settings changed — broadcast to all contexts */
export interface SettingsUpdateMessage extends BaseMessage {
  type: "SETTINGS_UPDATE";
  source: MessageSource.SIDEPANEL;
  payload: {
    settings: Partial<UserSettings>;
  };
}

/** Side panel reports it has been opened/mounted */
export interface SidePanelOpenedMessage extends BaseMessage {
  type: "SIDE_PANEL_OPENED";
  source: MessageSource.SIDEPANEL;
  payload: {
    tabId: number;
    windowId: number;
  };
}

/** Background instructs the side panel to close itself */
export interface CloseSidePanelMessage extends BaseMessage {
  type: "CLOSE_SIDE_PANEL";
  source: MessageSource.BACKGROUND;
  payload: {
    tabId: number;
    windowId: number;
  };
}

/** Background sends a debug screenshot to the side panel for display */
export interface ScreenshotCapturedMessage extends BaseMessage {
  type: "SCREENSHOT_CAPTURED";
  source: MessageSource.BACKGROUND;
  payload: {
    dataUrl: string;
    context: string;
    timestamp: number;
  };
}

/** Background asks the content script to auto-dismiss modals/banners */
export interface DismissModalsMessage extends BaseMessage {
  type: "DISMISS_MODALS";
  source: MessageSource.BACKGROUND;
  payload: Record<string, never>;
}

/** Content script reports how many modals were dismissed */
export interface DismissModalsResponse extends BaseMessage {
  type: "DISMISS_MODALS_RESPONSE";
  source: MessageSource.CONTENT;
  payload: {
    dismissed: number;
    /** Non-null if heuristics couldn't dismiss a viewport-covering overlay */
    remainingOverlay: OverlayDescriptor | null;
    /** Text content extracted from dismissed overlays (deduplicated) */
    capturedTexts: string[];
  };
}

/** Content script announces it's initialized and ready to receive messages */
export interface ContentScriptReadyMessage extends BaseMessage {
  type: "CONTENT_SCRIPT_READY";
  source: MessageSource.CONTENT;
  payload: { tabId: number };
}

/** Background asks content script to signal when DOM has settled (no mutations) */
export interface DomReadyProbeMessage extends BaseMessage {
  type: "DOM_READY_PROBE";
  source: MessageSource.BACKGROUND;
  payload: {
    /** Hard cap in ms — respond even if DOM hasn't fully settled */
    timeoutMs: number;
    /** If true, wait until at least one element is present before responding */
    waitForElements?: boolean;
  };
}

/** Content script responds when DOM quiescence is reached */
export interface DomReadyAckMessage extends BaseMessage {
  type: "DOM_READY_ACK";
  source: MessageSource.CONTENT;
  payload: {
    /** How long the content script waited before responding (ms) */
    waitedMs: number;
    /** Number of elements currently in DOM (0 = page still loading) */
    elementCount: number;
  };
}

/** Background sends a step update to the side panel for the timeline */
export interface AgentStepMessage extends BaseMessage {
  type: "AGENT_STEP";
  source: MessageSource.BACKGROUND;
  payload: { step: AgentStep; update: boolean };
}

/** Background tells the content script whether the agent is actively running */
export interface AgentActivityMessage extends BaseMessage {
  type: "AGENT_ACTIVITY";
  source: MessageSource.BACKGROUND;
  payload: {
    active: boolean;
    laneTelemetry?: LaneTelemetrySnapshot;
  };
}

export interface LaneTelemetry {
  activeCalls: number;
  queueDepth: number;
  restartCount: number;
  consecutiveCrashes: number;
  circuitOpenUntilMs: number;
  lastCrashError?: string;
}

export interface LaneTelemetrySnapshot {
  timestamp: number;
  lanes: Record<AgentRole, LaneTelemetry>;
}

// --- Agent Feedback & Control Messages ---

/** Background broadcasts stuck detection signals to the side panel */
export interface AgentStuckMessage extends BaseMessage {
  type: "AGENT_STUCK";
  source: MessageSource.BACKGROUND;
  payload: {
    signal: "escalate" | "resolved";
    staleTurns: number;
    url: string;
    /** Human-readable explanation */
    message: string;
  };
}

/** Background broadcasts turn progress to the side panel */
export interface AgentTurnMessage extends BaseMessage {
  type: "AGENT_TURN";
  source: MessageSource.BACKGROUND;
  payload: {
    turn: number;
    maxTurns: number;
    provider?: string;
  };
}

/** Background broadcasts subtask progress to the side panel */
export interface TaskProgressMessage extends BaseMessage {
  type: "TASK_PROGRESS";
  source: MessageSource.BACKGROUND;
  payload: {
    taskId: string;
    subtasks: SubtaskSummary[];
    currentIndex: number;
    /** Turns used so far across all subtasks */
    totalTurnsUsed: number;
  };
}

/** Background informs the side panel that an unfinished task was recovered from checkpoint */
export interface TaskRecoveryMessage extends BaseMessage {
  type: "TASK_RECOVERY";
  source: MessageSource.BACKGROUND;
  payload: {
    taskId: string;
    totalSubtasks: number;
    completedSubtasks: number;
    pendingSubtasks: number;
  };
}

export type EscalationRisk = "medium" | "high" | "critical";

export type EscalationOptionId =
  | "approve_continue"
  | "reroute_with_option"
  | "skip_node"
  | "stop_task";

export interface EscalationOption {
  id: EscalationOptionId;
  label: string;
  impact: string;
  rerouteObjective?: string;
}

export interface EscalationPacket {
  escalationId: string;
  taskId: string;
  workspaceId: string;
  nodeId: string;
  risk: EscalationRisk;
  confidence: number;
  reason: string;
  options: EscalationOption[];
  recommendedOption: EscalationOptionId;
  snapshotSummary: string;
  lastActions: string[];
  budgetState: {
    elapsedMs: number;
    maxSessionTimeMs: number;
    totalTokens: number;
    maxTotalTokens: number;
    totalCostUsd: number;
    maxTotalCostUsd: number;
  };
  timeoutMs: number;
  timestamp: number;
}

export interface EscalationRequestMessage extends BaseMessage {
  type: "ESCALATION_REQUEST";
  source: MessageSource.BACKGROUND;
  payload: EscalationPacket;
}

export interface EscalationDecisionMessage extends BaseMessage {
  type: "ESCALATION_DECISION";
  source: MessageSource.SIDEPANEL;
  payload: {
    escalationId: string;
    optionId: EscalationOptionId;
    rerouteObjective?: string;
  };
}

/** Summary of a single subtask within a decomposed task */
export interface SubtaskSummary {
  description: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  turnsUsed: number;
  turnBudget: number;
  result?: string;
  /** URL (origin+pathname) where this step was completed — used by navigate guard */
  completedAtUrl?: string;
}

/** Background sends structured completion report when a task finishes */
export interface TaskCompletionMessage extends BaseMessage {
  type: "TASK_COMPLETION";
  source: MessageSource.BACKGROUND;
  payload: {
    taskId: string;
    status: "completed" | "partial" | "failed";
    totalTurnsUsed: number;
    totalTimeMs: number;
    summary: string;
    subtaskResults: SubtaskResult[];
    urlHistory: string[];
    /** Session metrics (token usage, cost, timing) */
    metrics?: SessionMetrics;
    /** Explicit termination reason for budget/guardrail stops */
    terminationReason?: string;
  };
}

/** Outcome of a single subtask within a completion report */
export interface SubtaskResult {
  description: string;
  status: "completed" | "failed" | "skipped";
  turnsUsed: number;
  result: string;
}

/** Side panel requests skipping the current subtask */
export interface SkipSubtaskMessage extends BaseMessage {
  type: "SKIP_SUBTASK";
  source: MessageSource.SIDEPANEL;
  payload: {
    taskId: string;
  };
}

/** Side panel requests pausing the agent loop */
export interface PauseAgentMessage extends BaseMessage {
  type: "PAUSE_AGENT";
  source: MessageSource.SIDEPANEL;
  payload: {
    workspaceId?: string | null;
  };
}

/** Side panel requests resuming the paused agent loop */
export interface ResumeAgentMessage extends BaseMessage {
  type: "RESUME_AGENT";
  source: MessageSource.SIDEPANEL;
  payload: {
    workspaceId?: string | null;
  };
}

/** Background broadcasts session token/cost metrics to the side panel */
export interface SessionMetricsMessage extends BaseMessage {
  type: "SESSION_METRICS";
  source: MessageSource.BACKGROUND;
  payload: SessionMetrics;
}

/** Side panel requests a scoped privacy/data cleanup action. */
export interface DataControlRequestMessage extends BaseMessage {
  type: "DATA_CONTROL_REQUEST";
  source: MessageSource.SIDEPANEL;
  payload: {
    action:
      | "clear_memory"
      | "clear_logs"
      | "clear_chat_history"
      | "clear_local_data";
  };
}

/** Background reports result of a data cleanup action. */
export interface DataControlResultMessage extends BaseMessage {
  type: "DATA_CONTROL_RESULT";
  source: MessageSource.BACKGROUND;
  payload: {
    action: DataControlRequestMessage["payload"]["action"];
    ok: boolean;
    detail: string;
  };
}

/** Accumulated token usage, cost, and timing for an agent session */
export interface SessionMetrics {
  /** Total prompt tokens across all LLM calls this session */
  totalPromptTokens: number;
  /** Total completion tokens across all LLM calls this session */
  totalCompletionTokens: number;
  /** Total tokens (prompt + completion) */
  totalTokens: number;
  /** Cumulative cost in USD from OpenRouter */
  totalCost: number;
  /** Cost returned directly by provider responses (`usage.cost`) */
  totalCostActual?: number;
  /** Cost estimated locally from token counts + pricing table when provider cost is missing */
  totalCostEstimated?: number;
  /** Provenance of `totalCost` */
  costMode?: "none" | "actual" | "estimated" | "mixed";
  /** Total LLM call time in ms (wall clock, not including tool execution) */
  totalLlmTimeMs: number;
  /** Total session wall clock time in ms */
  totalSessionTimeMs: number;
  /** Number of LLM calls made (including vision) */
  llmCallCount: number;
  /** Total prompt tokens served from cache (prefix caching) */
  totalCachedTokens: number;
  /** Per-model breakdown */
  modelBreakdown: Record<
    string,
    {
      promptTokens: number;
      completionTokens: number;
      cost: number;
      actualCost?: number;
      estimatedCost?: number;
      costMode?: "none" | "actual" | "estimated" | "mixed";
      calls: number;
    }
  >;
}

// --- Agent Loop Types ---

/** Serializable agent loop state for persistence across navigations */
export interface AgentLoopState {
  /** Current agent status */
  status: AgentStatus;
  /** Conversation history (sliding window managed) */
  messages: ChatMessage[];
  /** The user's original request that started this loop */
  originalQuery: string;
  /** Number of LLM round-trips completed in this loop */
  turnCount: number;
  /** Maximum turns before auto-stopping (safety limit) */
  maxTurns: number;
  /** Tab ID the agent is operating on */
  activeTabId: number;
  /** Workspace ID for context isolation */
  workspaceId: string | null;
  /** Optional worker identity for orchestrator-managed runs */
  workerId?: string | null;
  /** Timestamp of last activity (for timeout detection) */
  lastActivityTs: number;
  /** Pending tool call that triggered navigation, if any */
  pendingToolCall: PendingToolCall | null;
}

/** A single message in the conversation history */
export type ChatMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;

export interface SystemMessage {
  role: "system";
  content: string;
}

export interface UserMessage {
  role: "user";
  content: string;
}

export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
}

export interface ToolMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

/** An LLM-generated tool call (OpenAI function calling format) */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: ToolName;
    arguments: string; // JSON-encoded string
  };
}

/** Lightweight summary of an executed tool call for UI display */
export interface ToolCallSummary {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  riskLevel: RiskLevel;
  durationMs: number;
}

/** A source citation representing a URL the agent visited or read during the session */
export interface Citation {
  /** Page URL */
  url: string;
  /** Page title (from DOM snapshot or tab title) */
  title: string;
  /** Which tool produced this citation (e.g. navigate, read_page, create_tab) */
  tool: ToolName;
  /** Turn number when this citation was captured */
  turn: number;
}

/** A tool call that triggered a page navigation — saved for resumption */
export interface PendingToolCall {
  toolCallId: string;
  toolName: ToolName;
  args: Record<string, unknown>;
  /** URL we expect to arrive at (for validation) */
  expectedUrl: string | null;
}

/** Configuration for the context sliding window */
export interface SlidingWindowConfig {
  /** Maximum number of tokens to keep in context */
  maxTokens: number;
  /** Number of most-recent messages to always preserve */
  preserveRecentCount: number;
  /** Always keep the system message */
  preserveSystemMessage: boolean;
  /** Token budget reserved for the system prompt */
  systemPromptTokenBudget: number;
}

// --- Tool System Types ---

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
  direction: ScrollDirection;
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

/** Arguments for memory_search */
export interface MemorySearchArgs {
  /** Natural language query */
  query: string;
  /** Maximum number of results (default: 5) */
  limit?: number;
}

/** Arguments for memory_add */
export interface MemoryAddArgs {
  /** Content to store */
  content: string;
  /** Category tag for organization */
  category?: string;
}

/** Arguments for memory_update */
export interface MemoryUpdateArgs {
  /** Memory entry ID to update */
  id: string;
  /** New memory content */
  content: string;
  /** Optional replacement category */
  category?: string;
}

/** Arguments for memory_delete */
export interface MemoryDeleteArgs {
  /** Memory entry ID to delete */
  id: string;
}

/** Arguments for memory_list_categories */
export type MemoryListCategoriesArgs = Record<string, never>;

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

/** Arguments for take_screenshot */
export type TakeScreenshotArgs = Record<string, never>;

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

/** Arguments for draw_stroke */
export interface DrawStrokeArgs {
  /** Tag ID of the canvas element */
  id: number;
  /** Start X offset from element top-left */
  startX: number;
  /** Start Y offset from element top-left */
  startY: number;
  /** End X offset from element top-left */
  endX: number;
  /** End Y offset from element top-left */
  endY: number;
}

/** Arguments for hide_element */
export interface HideElementArgs {
  /** The numeric tag ID of the element to hide */
  id: number;
}

/** Arguments for escalate — voluntary model upgrade */
export interface EscalateArgs {
  /** Why the fast model can't handle this (e.g. "riddle requires multi-step reasoning") */
  reason: string;
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
  url: string;
}

/** Arguments for go_back */
export type GoBackArgs = Record<string, never>;

/** Arguments for go_forward */
export type GoForwardArgs = Record<string, never>;

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

/** Arguments for transcribe_audio */
export interface TranscribeAudioArgs {
  /** The numeric tag ID of the <audio> or <video> element */
  id: number;
}

/** Arguments for group_tabs */
export interface GroupTabsArgs {
  tabIds: number[];
  title: string;
  color?: string;
}

/** Arguments for ungroup_tabs */
export interface UngroupTabsArgs {
  tabIds: number[];
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

/** Arguments for copy_to_clipboard */
export interface CopyToClipboardArgs {
  text: string;
}

/** Arguments for read_pdf */
export interface ReadPdfArgs {
  url: string;
  maxPages?: number;
}

/** Arguments for search_history */
export interface SearchHistoryArgs {
  query: string;
  maxResults?: number;
}

/** Arguments for create_bookmark */
export interface CreateBookmarkArgs {
  title?: string;
  url?: string;
  parentId?: string;
}

/** Arguments for get_bookmarks */
export interface GetBookmarksArgs {
  query: string;
  maxResults?: number;
}

/** Arguments for create_window */
export interface CreateWindowArgs {
  url?: string;
  incognito?: boolean;
}

/** Arguments for send_notification */
export interface SendNotificationArgs {
  title: string;
  message: string;
}

/** Arguments for inspect_hidden */
export interface InspectHiddenArgs {
  /** Case-insensitive text filter */
  pattern?: string;
  /** Maximum results to return (default: 25, max: 50) */
  maxResults?: number;
}

/** Arguments for xray_page — no arguments, simple toggle */
export type XrayPageArgs = Record<string, never>;

/** Arguments for fast_forward — no arguments, simple toggle */
export type FastForwardArgs = Record<string, never>;

/** Arguments for dismiss_overlays — no arguments */
export type DismissOverlaysArgs = Record<string, never>;

/** A single step inside a batch_execute script */
export interface BatchExecuteStep {
  /** Tool name to execute */
  tool: string;
  /** Arguments for the tool */
  args: Record<string, unknown>;
  /** Optional expected outcome — bail if result doesn't contain this */
  expect?: string;
}

/** Arguments for batch_execute */
export interface BatchExecuteArgs {
  /** Ordered list of tool calls to execute without LLM roundtrips */
  steps: BatchExecuteStep[];
  /** What to verify after all steps complete (informational, not enforced) */
  verify?: string;
}

// --- React Toolkit Args ---

/** Arguments for inspect_react — read component state/props for a tagged element */
export interface InspectReactArgs {
  /** Tag ID of the element to inspect */
  id: number;
  /** How many parent components to traverse (default 3, max 8) */
  depth?: number;
}

/** Arguments for react_set_input — set a React controlled input value */
export interface ReactSetInputArgs {
  /** Tag ID of the input element */
  id: number;
  /** The value to set */
  value: string;
  /** Press Enter after setting value (default false) */
  submit?: boolean;
}

/** Arguments for inspect_react_tree — component hierarchy overview */
export interface InspectReactTreeArgs {
  /** Max tree depth (default 5, max 10) */
  depth?: number;
  /** Only show components whose name contains this string (case-insensitive) */
  filter?: string;
}

/** Arguments for wait_for_react — wait for React renders to settle */
export interface WaitForReactArgs {
  /** Max wait time in ms (default 3000, max 10000) */
  timeout?: number;
}

/** Maps tool names to their execution handlers */
export type ToolRouter = {
  [K in ToolName]: (args: ToolArgsMap[K]) => Promise<string>;
};

/** Maps each tool name to its argument type */
export type ToolArgsMap = {
  [ToolName.CLICK_ELEMENT]: ClickElementArgs;
  [ToolName.TYPE_TEXT]: TypeTextArgs;
  [ToolName.SCROLL_PAGE]: ScrollPageArgs;
  [ToolName.READ_PAGE]: ReadPageArgs;
  [ToolName.NAVIGATE]: NavigateArgs;

  [ToolName.MEMORY_SEARCH]: MemorySearchArgs;
  [ToolName.MEMORY_ADD]: MemoryAddArgs;
  [ToolName.MEMORY_UPDATE]: MemoryUpdateArgs;
  [ToolName.MEMORY_DELETE]: MemoryDeleteArgs;
  [ToolName.MEMORY_LIST_CATEGORIES]: MemoryListCategoriesArgs;
  [ToolName.CREATE_TAB]: CreateTabArgs;
  [ToolName.CLOSE_TAB]: CloseTabArgs;
  [ToolName.SWITCH_TAB]: SwitchTabArgs;
  [ToolName.TAKE_SCREENSHOT]: TakeScreenshotArgs;
  [ToolName.HOVER_ELEMENT]: HoverElementArgs;
  [ToolName.FIND_ELEMENT]: FindElementArgs;
  [ToolName.WAIT]: WaitArgs;
  [ToolName.DONE]: DoneArgs;
  [ToolName.SELECT_OPTION]: SelectOptionArgs;
  [ToolName.PRESS_KEY]: PressKeyArgs;
  [ToolName.DRAG_AND_DROP]: DragAndDropArgs;
  [ToolName.DRAW_STROKE]: DrawStrokeArgs;
  [ToolName.HIDE_ELEMENT]: HideElementArgs;
  [ToolName.ESCALATE]: EscalateArgs;
  [ToolName.READ_ELEMENT]: ReadElementArgs;
  [ToolName.EXECUTE_JS]: ExecuteJsArgs;
  [ToolName.UPLOAD_FILE]: UploadFileArgs;
  [ToolName.GO_BACK]: GoBackArgs;
  [ToolName.GO_FORWARD]: GoForwardArgs;
  [ToolName.LIST_TABS]: ListTabsArgs;
  [ToolName.RIGHT_CLICK]: RightClickArgs;
  [ToolName.SET_CHECKBOX]: SetCheckboxArgs;
  [ToolName.CLICK_COORDINATES]: ClickCoordinatesArgs;
  [ToolName.DOWNLOAD_FILE]: DownloadFileArgs;
  [ToolName.TRANSCRIBE_AUDIO]: TranscribeAudioArgs;
  [ToolName.GROUP_TABS]: GroupTabsArgs;
  [ToolName.UNGROUP_TABS]: UngroupTabsArgs;
  [ToolName.GET_COOKIES]: GetCookiesArgs;
  [ToolName.SET_COOKIE]: SetCookieArgs;
  [ToolName.DELETE_COOKIE]: DeleteCookieArgs;
  [ToolName.COPY_TO_CLIPBOARD]: CopyToClipboardArgs;
  [ToolName.READ_PDF]: ReadPdfArgs;
  [ToolName.SEARCH_HISTORY]: SearchHistoryArgs;
  [ToolName.CREATE_BOOKMARK]: CreateBookmarkArgs;
  [ToolName.GET_BOOKMARKS]: GetBookmarksArgs;
  [ToolName.CREATE_WINDOW]: CreateWindowArgs;
  [ToolName.SEND_NOTIFICATION]: SendNotificationArgs;
  [ToolName.INSPECT_HIDDEN]: InspectHiddenArgs;
  [ToolName.XRAY_PAGE]: XrayPageArgs;
  [ToolName.FAST_FORWARD]: FastForwardArgs;
  [ToolName.DISMISS_OVERLAYS]: DismissOverlaysArgs;
  [ToolName.BATCH_EXECUTE]: BatchExecuteArgs;
  [ToolName.INSPECT_REACT]: InspectReactArgs;
  [ToolName.REACT_SET_INPUT]: ReactSetInputArgs;
  [ToolName.INSPECT_REACT_TREE]: InspectReactTreeArgs;
  [ToolName.WAIT_FOR_REACT]: WaitForReactArgs;
};

// --- Content Script Types ---

/** The distilled DOM representation sent to the LLM */
/** Detected front-end framework on the page (used for on-demand toolkit injection) */
export interface FrameworkInfo {
  /** Framework identifier (e.g. "react") */
  name: string;
  /** Semver version string, or "unknown" if undetectable */
  version: string;
  /** Internal key used to access the fiber tree (e.g. "__reactFiber$abc123") */
  fiberKey: string;
}

export interface DomSnapshot {
  /** Page title */
  title: string;
  /** Current URL */
  url: string;
  /** Array of tagged interactive elements */
  elements: TaggedElement[];
  /** Plain text content of the visible viewport (truncated) */
  viewportText: string;
  /** Viewport dimensions */
  viewport: { width: number; height: number };
  /** Scroll position */
  scroll: { x: number; y: number; maxY: number };
  /** Overlays that survived auto-dismissal (agent should handle manually) */
  survivingOverlays?: { tagId: number; coveragePercent: number }[];
  /** Text content extracted from overlays that were dismissed (deduplicated) */
  capturedTexts?: string[];
  /** Front-end framework detected on the page (null if none) */
  framework?: FrameworkInfo | null;
  /** Overflow info when element cap was hit or near-identical elements collapsed */
  overflow?: { shown: number; total: number; collapsedGroups?: string[] };
}

/** A single interactive DOM element with a numeric tag */
export interface TaggedElement {
  /** Unique numeric tag (the [N] label) */
  tag: number;
  /** HTML tag name (lowercase) */
  tagName: string;
  /** Role attribute or inferred role */
  role: string;
  /** Visible text content (truncated to 80 chars) */
  text: string;
  /** Key attributes: href, placeholder, aria-label, type, name */
  attributes: Record<string, string>;
  /** Bounding rect relative to viewport */
  rect: ElementRect;
  /** Whether the element is currently visible in the viewport */
  isVisible: boolean;
  /** Whether the element is disabled */
  isDisabled: boolean;
}

/** Bounding rectangle for a DOM element */
export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Describes a viewport-covering overlay that heuristic dismissal couldn't remove */
export interface OverlayDescriptor {
  /** outerHTML truncated to 3000 chars */
  html: string;
  /** Assigned via addDynamicTag */
  tagId: number;
  /** Bounding rect of the overlay */
  rect: ElementRect;
  /** Percentage of viewport covered by this overlay */
  coveragePercent: number;
}

/** Background requests a DOM snapshot from the content script */
export interface DomSnapshotRequest extends BaseMessage {
  type: "DOM_SNAPSHOT_REQUEST";
  source: MessageSource.BACKGROUND;
  payload: {
    /** Whether to include viewport text (expensive) */
    includeText: boolean;
    /** Whether to re-tag elements or use cached tags */
    refresh: boolean;
    /** Whether to render visual [N] tag overlays on the page */
    showTags?: boolean;
  };
}

/** Content script returns the DOM snapshot */
export interface DomSnapshotResponse extends BaseMessage {
  type: "DOM_SNAPSHOT_RESPONSE";
  source: MessageSource.CONTENT;
  payload: {
    snapshot: DomSnapshot;
    /** Time in ms to generate the snapshot */
    durationMs: number;
  };
}

/** Background tells the content script to execute a DOM action */
export interface ToolExecuteMessage extends BaseMessage {
  type: "TOOL_EXECUTE";
  source: MessageSource.BACKGROUND;
  payload: {
    toolName: ToolName;
    args: Record<string, unknown>;
    toolCallId: string;
  };
}

/** Content script returns the result of a tool execution */
export interface ToolResultMessage extends BaseMessage {
  type: "TOOL_RESULT";
  source: MessageSource.CONTENT;
  payload: {
    toolCallId: string;
    success: boolean;
    result: string;
    /** If the action triggered a navigation */
    navigated: boolean;
  };
}

// --- Agent Step Types ---

/** A single step in the agent's execution timeline */
export interface AgentStep {
  id: string;
  type: "thinking" | "tool" | "info";
  label: string;
  detail?: string;
  toolName?: ToolName;
  status: "running" | "done" | "error";
  timestamp: number;
  durationMs?: number;
  errorMessage?: string;
  /** Base64 data URL of a downsized screenshot thumbnail (~320px wide) */
  screenshotUrl?: string;
}

// --- Saved Prompts ---

/** A user-saved reusable prompt template */
export interface SavedPrompt {
  /** Unique ID (crypto.randomUUID()) */
  id: string;
  /** Short label ("Summarize article") */
  title: string;
  /** Full prompt text */
  content: string;
  /** Free-form grouping ("Research", "Forms", "" = uncategorized) */
  category: string;
  /** Unix ms */
  createdAt: number;
  /** Unix ms */
  updatedAt: number;
}

// --- Side Panel UI Types ---

/** A single entry in the chat history UI */
export interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  /** Tool calls shown inline (collapsed by default) */
  toolCalls: ToolCallSummary[];
  /** Whether this message is still being streamed */
  isStreaming: boolean;
  /** Real-time step timeline for agent execution */
  steps?: AgentStep[];
  /** Whether this user message was sent as a hint during execution */
  isHint?: boolean;
  /** Structured completion data — when present, MessageBubble renders CompletionSummary */
  completionData?: TaskCompletionMessage["payload"];
  /** Source citations from URLs visited during the agent session */
  citations?: Citation[];
}

/** Stuck detection state for the side panel */
export interface StuckState {
  signal: "escalate";
  staleTurns: number;
  url: string;
  /** Timestamp of the stuck signal (for auto-dismiss timing) */
  receivedAt: number;
}

/** Turn progress state for the side panel */
export interface TurnProgress {
  turn: number;
  maxTurns: number;
  provider?: string;
}

/** Pending user approval request displayed in the side panel */
export interface PendingApproval {
  approvalId: string;
  toolName: ToolName;
  args: Record<string, unknown>;
  risk: RiskLevel.HIGH;
  context: string;
  timeoutMs: number;
  requestedAt: number;
}

export interface PendingEscalation extends EscalationPacket {
  requestedAt: number;
}

/** Recovery state for resumed orchestrator tasks */
export interface TaskRecoveryState {
  workspaceId: string | null;
  taskId: string;
  totalSubtasks: number;
  completedSubtasks: number;
  pendingSubtasks: number;
  recoveredAt: number;
}

/** Top-level React state for the side panel */
export interface SidePanelState {
  /** Whether initial load (settings + messages) is complete */
  ready: boolean;
  /** Active workspace ID for message scoping (null = global) */
  activeWorkspaceId: string | null;
  /** Chat history */
  messages: ChatEntry[];
  /** Current agent status (drives status indicator) */
  agentStatus: AgentStatus;
  /** Status detail text */
  statusDetail: string;
  /** Current input text */
  inputText: string;
  /** Whether the agent is running (disables input) */
  isAgentRunning: boolean;
  /** User settings */
  settings: UserSettings;
  /** Error message to display, if any */
  error: string | null;
  /** Active task decomposition progress (null when no decomposed task) */
  taskProgress: TaskProgressMessage["payload"] | null;
  /** Completed task report (null until task finishes) */
  taskCompletion: TaskCompletionMessage["payload"] | null;
  /** Non-null when the agent is detected as stuck */
  stuckState: StuckState | null;
  /** Current turn progress (null when agent is idle) */
  turnProgress: TurnProgress | null;
  /** Pending high-risk action awaiting user approval */
  pendingApproval: PendingApproval | null;
  /** Pending orchestrator escalation requiring user decision */
  pendingEscalation: PendingEscalation | null;
  /** Non-null when a task has been recovered from checkpoint */
  taskRecovery: TaskRecoveryState | null;
  /** Live session metrics (null when no active session or tracking disabled) */
  sessionMetrics: SessionMetrics | null;
  /** Runtime lane telemetry from orchestrator lane supervisors */
  laneTelemetry: LaneTelemetrySnapshot | null;
  /** User-saved prompt templates */
  savedPrompts: SavedPrompt[];
  /** Whether the PlanBoard panel is visible */
  showPlanBoard: boolean;
  /** Whether demo recording is active */
  demoRecording: boolean;
  /** Number of actions captured in current recording */
  demoActionCount: number;
  /** Whether golden mode is enabled for eval dataset recording */
  goldenMode: boolean;
}

// --- Memory / Second Brain Types ---

/** Classification of a memory entry for filtered retrieval */
export type MemoryType = "fact" | "procedure" | "preference";

/** A single entry stored in the Second Brain */
export interface MemoryEntry {
  /** UUID v4 */
  id: string;
  /** The stored text content */
  content: string;
  /** Embedding vector (384 dimensions for MiniLM-L6-v2) */
  embedding: Float32Array;
  /** User-defined category tag */
  category: string;
  /** Source URL where this was captured */
  sourceUrl: string;
  /** Unix timestamp of creation */
  createdAt: number;
  /** Semantic type classification */
  type: MemoryType;
}

/** A single result from a memory search */
export interface MemorySearchResult {
  entry: MemoryEntry;
  /** Combined RRF score (higher = more relevant) */
  score: number;
  /** Individual scores for debugging */
  scores: {
    semantic: number;
    keyword: number;
  };
}

/** Messages sent to the memory offscreen document / web worker */
export interface MemoryWorkerMessage extends BaseMessage {
  type: "MEMORY_WORKER";
  source: MessageSource.BACKGROUND;
  payload:
    | { action: "init" }
    | { action: "add"; content: string; category: string; sourceUrl: string; type?: MemoryType }
    | {
        action: "batch_add";
        items: { content: string; category: string; sourceUrl: string }[];
      }
    | { action: "search"; query: string; limit: number; types?: MemoryType[] }
    | { action: "update"; id: string; content: string; category?: string }
    | { action: "delete"; id: string }
    | { action: "list_categories" }
    | { action: "clear" }
    | { action: "extract_pdf"; url: string; maxPages?: number };
}

/** Responses from the memory worker back to the service worker */
export interface MemoryWorkerResponse extends BaseMessage {
  type: "MEMORY_WORKER_RESPONSE";
  source: MessageSource.OFFSCREEN;
  payload:
    | { action: "init"; success: boolean; error?: string }
    | { action: "add"; success: boolean; id: string; error?: string }
    | { action: "batch_add"; success: boolean; count: number; error?: string }
    | { action: "search"; results: MemorySearchResult[]; error?: string }
    | { action: "update"; success: boolean; id: string; error?: string }
    | { action: "delete"; success: boolean; error?: string }
    | {
        action: "list_categories";
        categories: { name: string; count: number }[];
        error?: string;
      }
    | { action: "clear"; success: boolean; error?: string }
    | { action: "extract_pdf"; text: string; success: boolean; error?: string };
}

/** A row from the SQLite FTS5 table */
export interface FTS5Row {
  id: string;
  content: string;
  category: string;
  source_url: string;
  created_at: number;
  /** BM25 relevance score (lower = more relevant in SQLite FTS5) */
  rank: number;
}

// --- Workspace / Tab Group Types ---

export interface Workspace {
  id: string;
  name: string;
  color:
    | "grey"
    | "blue"
    | "red"
    | "yellow"
    | "green"
    | "pink"
    | "purple"
    | "cyan"
    | "orange";
  tabGroupId: number | null;
  tabIds: number[];
}

// --- Navigation Bridge Types ---

export interface NavigationResumeMessage extends BaseMessage {
  type: "NAVIGATION_RESUME";
  source: MessageSource.BACKGROUND;
  payload: {
    success: boolean;
    url: string;
    error?: string;
  };
}

/** State persisted to chrome.storage.local during page navigations */
export interface NavigationState {
  /** Full agent loop state to restore */
  agentState: AgentLoopState;
  /** URL before navigation started */
  fromUrl: string;
  /** Expected destination URL (null for click-triggered navigations) */
  toUrl: string | null;
  /** Timestamp when navigation started (for timeout detection) */
  navigationStartTs: number;
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs: number;
}

// --- Configuration Types ---

export interface UserSettings {
  openRouterApiKey: string;
  /** Groq API key for fast model (GPT-OSS-120B) */
  groqApiKey: string;
  /** Cerebras API key for fast model (highest priority when present) */
  cerebrasApiKey: string;
  maxTurns: number;
  contextWindowSize: number;
  memoryEnabled: boolean;
  workspaceEnabled: boolean;
  theme: "light" | "dark" | "system";
  /** Show visual [N] tag overlays on page elements (debugging aid) */
  showElementTags: boolean;
  /** OpenRouter model ID for vision/screenshot analysis (default: qwen/qwen3-vl-235b-a22b-instruct) */
  visionModel: string;
  /** Show token usage and cost metrics during and after agent sessions */
  showSessionMetrics: boolean;
  /** Expand step timeline + tool logs by default in each assistant message */
  showMessageDetailsByDefault?: boolean;
  /** Site access policy for agent execution */
  siteAccessMode?: "allow_all" | "blocklist";
  /** Blocked domains when `siteAccessMode` is `blocklist` */
  siteAccessBlocklist?: string[];
  /** Hide take_screenshot from tools; also skips auto-screenshot on stuck */
  disableScreenshot: boolean;
  /** Hide navigate from tools */
  disableNavigation: boolean;
  /** Skip all user approval prompts (including high-risk tool approvals) */
  bypassApprovals: boolean;
  /** Speech-to-text provider for voice input */
  speechProvider: "browser" | "groq";
  /** Max parallel workers for orchestrator task execution */
  orchestratorMaxWorkers?: number;
  /** Global token budget for one orchestrator task (planner + executor + verifier) */
  orchestratorMaxTotalTokens?: number;
  /** Learn reusable skills from successful task executions */
  teachModeEnabled?: boolean;
  /** Attempt learned-skill replay before planner decomposition */
  autoSkillReplayEnabled?: boolean;
  /** Restrict skill replay to explicitly pinned skills */
  skillReplayPinnedOnly?: boolean;
  /** Evaluate skill matches without executing them (planner still runs) */
  skillReplayDryRun?: boolean;
  /** Master toggle for demonstration recording/injection system (default: true) */
  demoEnabled?: boolean;
  /** Auto-inject matching demos into agent context (default: true) */
  demosAutoInject?: boolean;
}

// --- Demonstration Types (Learning from Demonstration) ---

/** A single recorded user action */
export interface DemoAction {
  type: "click" | "type" | "scroll" | "select" | "press_key" | "navigate";
  timestamp: number;
  url: string;
  element?: ElementDescriptor;
  /** Typed text, selected option value */
  value?: string;
  /** Key name for press_key actions */
  key?: string;
  /** Pixels scrolled (positive = down) */
  scrollDelta?: number;
}

/** Robust element identifier that survives DOM changes */
export interface ElementDescriptor {
  tagName: string;
  /** Visible text (truncated 80 chars) */
  text: string;
  role?: string;
  /** Key attributes: id, name, type, placeholder, aria-label, href */
  attributes: Record<string, string>;
  /** DOM path e.g. "body>main>form>input:nth-of-type(2)" */
  domPath: string;
  /** Best-effort unique CSS selector */
  selector: string;
}

/** A complete recorded demonstration */
export interface Demonstration {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  actions: DemoAction[];
  /** Domain or URL prefix for matching */
  urlPattern: string;
  /** Tokenized name+description for semantic matching */
  matchTokens: string[];
  /** Times injected into agent context */
  uses: number;
  enabled: boolean;
}

/** Result of matching a demo against a query + URL */
export interface DemoMatchResult {
  demo: Demonstration;
  score: number;
}

// --- Demo RuntimeMessage Types ---

/** Side panel → Background: begin recording user actions */
export interface DemoRecordStartMessage extends BaseMessage {
  type: "DEMO_RECORD_START";
  source: MessageSource.SIDEPANEL;
  payload: {
    tabId: number;
    /** When true, capture enriched golden data (snapshots + tag IDs) for eval pipeline */
    golden?: boolean;
  };
}

/** Side panel → Background: stop recording, return captured actions */
export interface DemoRecordStopMessage extends BaseMessage {
  type: "DEMO_RECORD_STOP";
  source: MessageSource.SIDEPANEL;
  payload: {
    tabId: number;
    /** User-provided name for the demo */
    name: string;
  };
}

/** Content script → Background: individual action captured during recording */
export interface DemoActionCapturedMessage extends BaseMessage {
  type: "DEMO_ACTION_CAPTURED";
  source: MessageSource.CONTENT;
  payload: {
    action: DemoAction;
  };
}

/** Background → Side panel: recording state updates */
export interface DemoRecordStatusMessage extends BaseMessage {
  type: "DEMO_RECORD_STATUS";
  source: MessageSource.BACKGROUND;
  payload: {
    active: boolean;
    actionCount: number;
  };
}

/** Background → Side panel: confirmation after demo persisted */
export interface DemoSavedMessage extends BaseMessage {
  type: "DEMO_SAVED";
  source: MessageSource.BACKGROUND;
  payload: {
    demo: Demonstration;
  };
}

// --- Golden Dataset Recording Types ---

/** An enriched action captured during golden recording (includes snapshot + tag ID) */
export interface GoldenAction {
  action: DemoAction;
  /** Tag ID of the interacted element (null for scroll/navigate) */
  tagId: number | null;
  /** DOM snapshot at the time of the action */
  snapshot: DomSnapshot;
}

/** Content script → Background: enriched action during golden recording */
export interface GoldenActionMessage extends BaseMessage {
  type: "GOLDEN_ACTION";
  source: MessageSource.CONTENT;
  payload: {
    goldenAction: GoldenAction;
  };
}

/** Background → Side panel: golden dataset saved confirmation */
export interface GoldenSavedMessage extends BaseMessage {
  type: "GOLDEN_SAVED";
  source: MessageSource.BACKGROUND;
  payload: {
    filename: string;
    caseCount: number;
  };
}

// --- Utility Types ---

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// --- Trace Types (for recording agent sessions) ---

export type TraceSchemaVersion = "2026-02-19";

export type TraceRecordKind =
  | "agent.turn"
  | "agent.session"
  | "orchestrator.run.event"
  | "orchestrator.run.manifest";

export type TraceProducer =
  | "background.agent.trace-recorder"
  | "background.orchestrator.run-trace-writer";

/** A single turn's full-fidelity recording for offline eval replay */
export interface TraceEntry {
  /** Trace schema version (optional for backward compatibility with older traces) */
  schemaVersion?: TraceSchemaVersion;
  /** Trace record kind (optional for backward compatibility with older traces) */
  traceKind?: Extract<TraceRecordKind, "agent.turn">;
  /** ISO timestamp when the record was emitted (optional for backward compatibility) */
  recordedAt?: string;
  /** Component that emitted this record (optional for backward compatibility) */
  producer?: Extract<TraceProducer, "background.agent.trace-recorder">;
  /** Orchestrator run ID when this agent session is launched by orchestrator */
  runId?: string;
  /** End-to-end correlation ID spanning orchestrator + agent trace streams */
  correlationId?: string;
  /** Parent run for nested/derived executions (future-proofing) */
  parentRunId?: string;
  sessionId: string;
  turnNumber: number;
  timestamp: number;
  /** Workspace ID for session isolation correlation */
  workspaceId?: string | null;
  /** DOM state at turn start */
  snapshot: {
    url: string;
    title: string;
    elementCount: number;
    viewportTextLength: number;
    scrollY: number;
  };
  /** Full elements array (for eval replay — reconstruct system prompt) */
  elements: TaggedElement[];
  /** LLM call metadata */
  llmRequest: {
    model: string;
    messageCount: number;
    toolCount: number;
    compressionLevel: string;
  };
  /** LLM response data */
  llmResponse: {
    content: string | null;
    toolCalls: ToolCall[];
    finishReason: string;
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      cost?: number;
    } | null;
    durationMs: number;
  };
  /** Tool executions for this turn */
  toolExecutions: TraceToolExecution[];
  /** Events that occurred during this turn */
  events: TraceEvent[];
  /** Progress tracker state */
  progressState: {
    staleTurns: number;
    signal: string | null;
  };
  /** Mid-session runtime limit reassessment (only on reassessment turns) */
  limitReassessment?: {
    trigger: "escalation" | "manual";
    previousDifficulty: string;
    newDifficulty: string;
    changedLimits: Record<string, number>;
    reason: string;
  };
}

/** A single tool execution within a trace turn */
export interface TraceToolExecution {
  toolCallId: string;
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  success: boolean;
  error?: string;
  durationMs: number;
  riskLevel: RiskLevel;
}

/** A notable event that occurred during a trace turn */
export interface TraceEventPayloadByType {
  approval:
    | {
        stage: "requested";
        approvalId: string;
        turn: number;
        toolName: ToolName;
        context: string;
        timeoutMs: number;
        bypassApprovals?: boolean;
      }
    | {
        stage: "settled";
        approvalId: string;
        turn: number;
        toolName: ToolName;
        outcome: "approved" | "rejected" | "timeout" | "dispatch_failed";
        approved: boolean;
      }
    | {
        stage: "bypassed";
        turn: number;
        toolName: ToolName;
      };
  safety_gate_blocked: {
    tool: string;
    reason: string;
    phase: "input" | "output";
  };
  safety_gate_audit: {
    tool: string;
    flag: string;
    phase: "input" | "output";
  };
  escalation: {
    reason: string;
    voluntary: boolean;
  };
  done_rejected: {
    rejections: number;
    reason: string;
    advancedTo: number;
  };
  stuck_signal: {
    type: "escalate";
    staleTurns: number;
  };
  circuit_breaker:
    | {
        reason: "consecutive_all_fail";
        consecutiveAllFailTurns: number;
      }
    | {
        reason: "same_tool_repeat";
        tool: string;
        count: number;
      };
}

type KnownTraceEvent = {
  [K in keyof TraceEventPayloadByType]: {
    type: K;
    timestamp: number;
    data: TraceEventPayloadByType[K];
  };
}[keyof TraceEventPayloadByType];

type GenericTraceEvent = {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
};

export type TraceEvent = KnownTraceEvent | GenericTraceEvent;

/** Session-level metadata written to traces/index.jsonl on session end */
export interface TraceSession {
  /** Trace schema version (optional for backward compatibility with older traces) */
  schemaVersion?: TraceSchemaVersion;
  /** Trace record kind (optional for backward compatibility with older traces) */
  traceKind?: Extract<TraceRecordKind, "agent.session">;
  /** ISO timestamp when the record was emitted (optional for backward compatibility) */
  recordedAt?: string;
  /** Component that emitted this record (optional for backward compatibility) */
  producer?: Extract<TraceProducer, "background.agent.trace-recorder">;
  /** Orchestrator run ID when this agent session is launched by orchestrator */
  runId?: string;
  /** End-to-end correlation ID spanning orchestrator + agent trace streams */
  correlationId?: string;
  /** Parent run for nested/derived executions (future-proofing) */
  parentRunId?: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  query: string;
  startUrl: string;
  outcome: "completed" | "stopped" | "max_turns" | "error";
  turnCount: number;
  summary: string;
  metrics: SessionMetrics | null;
  /** Workspace ID for session isolation correlation */
  workspaceId?: string | null;
  /** Guardian's difficulty assessment for this session */
  difficultyAssessment?: string;
  /** Resolved runtime limits after merging defaults + profile + overrides */
  resolvedLimits?: Record<string, number>;
  /** Guardian's per-field limit overrides (null if none) */
  guardianLimitOverrides?: Record<string, number> | null;
}
