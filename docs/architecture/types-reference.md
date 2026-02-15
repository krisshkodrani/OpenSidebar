# OpenSidebar — TypeScript Types Reference

> **Source of truth** for every interface, type, enum, and constant used across the project.
> All types live in `src/types/index.ts` and are re-exported from there.

---

## Table of Contents

1. [Enums](#enums)
2. [Core Message Types](#core-message-types)
3. [Agent Feedback & Control Messages](#agent-feedback--control-messages)
4. [Agent Loop Types](#agent-loop-types)
5. [Agent Step Types](#agent-step-types)
6. [Tool System Types](#tool-system-types)
7. [Content Script Types](#content-script-types)
8. [Side Panel UI Types](#side-panel-ui-types)
9. [Memory / Second Brain Types](#memory--second-brain-types)
10. [Workspace / Tab Group Types](#workspace--tab-group-types)
11. [Navigation Bridge Types](#navigation-bridge-types)
12. [Configuration Types](#configuration-types)
13. [Trace Types](#trace-types)
14. [Utility Types](#utility-types)

---

## Enums

### `AgentStatus`

Represents the current state of the agent loop state machine.

```typescript
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
```

### `MessageSource`

Identifies the sender/receiver context for chrome.runtime messages.

```typescript
/** Extension context that originated or receives a message */
export enum MessageSource {
  SIDEPANEL = "sidepanel",
  BACKGROUND = "background",
  CONTENT = "content",
  OFFSCREEN = "offscreen",
}
```

### `ToolName`

All 52 tool names the agent can invoke.

```typescript
/** Tool identifiers exposed to the LLM */
export enum ToolName {
  CLICK_ELEMENT = "click_element",
  TYPE_TEXT = "type_text",
  SCROLL_PAGE = "scroll_page",
  READ_PAGE = "read_page",
  NAVIGATE = "navigate",
  MEMORY_SEARCH = "memory_search",
  MEMORY_ADD = "memory_add",
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
  UPDATE_PLAN = "update_plan",
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
}
```

### `RiskLevel`

Used by the security module to classify tool calls.

```typescript
/** Risk classification for a tool invocation */
export enum RiskLevel {
  /** No side effects — read-only operations */
  LOW = "low",
  /** Mutates page state but is reversible (click, type) */
  MEDIUM = "medium",
  /** Navigates away, closes tabs, or sends data externally */
  HIGH = "high",
}
```

### `ScrollDirection`

```typescript
/** Direction for the scroll_page tool */
export enum ScrollDirection {
  UP = "up",
  DOWN = "down",
  TOP = "top",
  BOTTOM = "bottom",
}
```

---

## Core Message Types

### `RuntimeMessage`

Discriminated union for all `chrome.runtime.sendMessage` / `onMessage` payloads.

```typescript
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
 * Discriminated union of all message types (27+ members).
 * The `type` field is the discriminant.
 */
export type RuntimeMessage =
  | UserChatMessage
  | AgentResponseMessage
  | AgentStatusMessage
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
  | SessionMetricsMessage;
```

### `UserChatMessage`

```typescript
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
```

### `AgentResponseMessage`

```typescript
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
  };
}
```

### `AgentStatusMessage`

```typescript
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
```

### `StreamChunkMessage`

```typescript
/** A single SSE chunk from the LLM stream, forwarded to side panel */
export interface StreamChunkMessage extends BaseMessage {
  type: "STREAM_CHUNK";
  source: MessageSource.BACKGROUND;
  payload: {
    /** Incremental text delta */
    delta: string;
    /** True when this is the final chunk */
    done: boolean;
  };
}
```

### `StopAgentMessage`

```typescript
/** User requests the agent loop to stop */
export interface StopAgentMessage extends BaseMessage {
  type: "STOP_AGENT";
  source: MessageSource.SIDEPANEL;
  payload: {
    workspaceId?: string | null;
  };
}
```

### `SettingsUpdateMessage`

```typescript
/** Settings changed — broadcast to all contexts */
export interface SettingsUpdateMessage extends BaseMessage {
  type: "SETTINGS_UPDATE";
  source: MessageSource.SIDEPANEL;
  payload: {
    settings: Partial<UserSettings>;
  };
}
```

### `SidePanelOpenedMessage`

```typescript
/** Side panel reports it has been opened/mounted */
export interface SidePanelOpenedMessage extends BaseMessage {
  type: "SIDE_PANEL_OPENED";
  source: MessageSource.SIDEPANEL;
  payload: {
    tabId: number;
    windowId: number;
  };
}
```

### `CloseSidePanelMessage`

```typescript
/** Background instructs the side panel to close itself */
export interface CloseSidePanelMessage extends BaseMessage {
  type: "CLOSE_SIDE_PANEL";
  source: MessageSource.BACKGROUND;
  payload: {
    tabId: number;
    windowId: number;
  };
}
```

### `ScreenshotCapturedMessage`

```typescript
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
```

### `DismissModalsMessage`

```typescript
/** Background asks the content script to auto-dismiss modals/banners */
export interface DismissModalsMessage extends BaseMessage {
  type: "DISMISS_MODALS";
  source: MessageSource.BACKGROUND;
  payload: Record<string, never>;
}
```

### `DismissModalsResponse`

```typescript
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
```

### `AgentStepMessage`

```typescript
/** Background sends a step update to the side panel for the timeline */
export interface AgentStepMessage extends BaseMessage {
  type: "AGENT_STEP";
  source: MessageSource.BACKGROUND;
  payload: { step: AgentStep; update: boolean };
}
```

### `AgentActivityMessage`

```typescript
/** Background tells the content script whether the agent is actively running */
export interface AgentActivityMessage extends BaseMessage {
  type: "AGENT_ACTIVITY";
  source: MessageSource.BACKGROUND;
  payload: { active: boolean };
}
```

---

## Agent Feedback & Control Messages

### `AgentStuckMessage`

```typescript
/** Background broadcasts stuck detection signals to the side panel */
export interface AgentStuckMessage extends BaseMessage {
  type: "AGENT_STUCK";
  source: MessageSource.BACKGROUND;
  payload: {
    signal: "nudge" | "pivot" | "escalate" | "resolved";
    staleTurns: number;
    url: string;
    /** Human-readable explanation */
    message: string;
  };
}
```

### `AgentTurnMessage`

```typescript
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
```

### `TaskProgressMessage`

```typescript
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
```

### `SubtaskSummary`

```typescript
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
```

### `TaskCompletionMessage`

```typescript
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
  };
}
```

### `SubtaskResult`

```typescript
/** Outcome of a single subtask within a completion report */
export interface SubtaskResult {
  description: string;
  status: "completed" | "failed" | "skipped";
  turnsUsed: number;
  result: string;
}
```

### `SkipSubtaskMessage`

```typescript
/** Side panel requests skipping the current subtask */
export interface SkipSubtaskMessage extends BaseMessage {
  type: "SKIP_SUBTASK";
  source: MessageSource.SIDEPANEL;
  payload: {
    taskId: string;
  };
}
```

### `PauseAgentMessage`

```typescript
/** Side panel requests pausing the agent loop */
export interface PauseAgentMessage extends BaseMessage {
  type: "PAUSE_AGENT";
  source: MessageSource.SIDEPANEL;
  payload: {
    workspaceId?: string | null;
  };
}
```

### `ResumeAgentMessage`

```typescript
/** Side panel requests resuming the paused agent loop */
export interface ResumeAgentMessage extends BaseMessage {
  type: "RESUME_AGENT";
  source: MessageSource.SIDEPANEL;
  payload: {
    workspaceId?: string | null;
  };
}
```

### `SessionMetricsMessage`

```typescript
/** Background broadcasts session token/cost metrics to the side panel */
export interface SessionMetricsMessage extends BaseMessage {
  type: "SESSION_METRICS";
  source: MessageSource.BACKGROUND;
  payload: SessionMetrics;
}
```

### `SessionMetrics`

```typescript
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
      calls: number;
    }
  >;
}
```

---

## Agent Loop Types

### `AgentLoopState`

The full runtime state of the agent loop, persisted to `chrome.storage.local` for Navigation Bridge survival.

```typescript
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
  /** Timestamp of last activity (for timeout detection) */
  lastActivityTs: number;
  /** Pending tool call that triggered navigation, if any */
  pendingToolCall: PendingToolCall | null;
}
```

### `ChatMessage`

OpenAI-compatible chat message format (used by OpenRouter).

```typescript
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
```

### `ToolCall`

```typescript
/** An LLM-generated tool call (OpenAI function calling format) */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: ToolName;
    arguments: string; // JSON-encoded string
  };
}
```

### `ToolCallSummary`

```typescript
/** Lightweight summary of an executed tool call for UI display */
export interface ToolCallSummary {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  riskLevel: RiskLevel;
  durationMs: number;
}
```

### `PendingToolCall`

```typescript
/** A tool call that triggered a page navigation — saved for resumption */
export interface PendingToolCall {
  toolCallId: string;
  toolName: ToolName;
  args: Record<string, unknown>;
  /** URL we expect to arrive at (for validation) */
  expectedUrl: string | null;
}
```

### `SlidingWindowConfig`

```typescript
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
```

---

## Agent Step Types

### `AgentStep`

```typescript
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
```

---

## Tool System Types

### `ToolDefinition`

OpenAI-compatible function tool definition, sent to the LLM.

```typescript
/** A tool definition in OpenAI function calling format */
export interface ToolDefinition {
  type: "function";
  function: {
    name: ToolName;
    description: string;
    parameters: JsonSchema;
  };
}
```

### `JsonSchema`

```typescript
/** JSON Schema subset used for tool parameter definitions */
export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
}

export interface JsonSchemaProperty {
  type: "string" | "number" | "integer" | "boolean" | "array";
  description: string;
  enum?: (string | number)[];
  items?: JsonSchemaProperty;
  default?: unknown;
}
```

### Tool Argument Interfaces

Each tool has a typed argument interface (52 tools):

```typescript
/** Arguments for click_element */
export interface ClickElementArgs {
  /** The numeric tag ID from the DOM snapshot */
  id: number;
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

/** Arguments for update_plan — report task plan and progress */
export interface UpdatePlanArgs {
  subtasks: string[];
  currentIndex: number;
  lastResult?: string;
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
```

### `ToolRouter`

```typescript
/** Maps tool names to their execution handlers */
export type ToolRouter = {
  [K in ToolName]: (args: ToolArgsMap[K]) => Promise<string>;
};

/** Maps each tool name to its argument type */
export type ToolArgsMap = {
  // ... (46 entries mapping each ToolName to its Args type)
  [ToolName.CLICK_ELEMENT]: ClickElementArgs;
  [ToolName.TYPE_TEXT]: TypeTextArgs;
  // ... etc.
};
```

---

## Content Script Types

### `DomSnapshot`

```typescript
/** The distilled DOM representation sent to the LLM */
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
  /** Overlays that survived auto-dismiss (agent should handle manually) */
  survivingOverlays?: { tagId: number; coveragePercent: number }[];
  /** Text content extracted from overlays that were dismissed (deduplicated) */
  capturedTexts?: string[];
}
```

### `TaggedElement`

```typescript
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
```

### `ElementRect`

```typescript
/** Bounding rectangle for a DOM element */
export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

### `OverlayDescriptor`

```typescript
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
```

### `DomSnapshotRequest`

```typescript
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
```

### `DomSnapshotResponse`

```typescript
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
```

### `ToolExecuteMessage`

```typescript
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
```

### `ToolResultMessage`

```typescript
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
```

---

## Side Panel UI Types

### `ChatEntry`

```typescript
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
}
```

### `StuckState`

```typescript
/** Stuck detection state for the side panel */
export interface StuckState {
  signal: "nudge" | "pivot" | "escalate";
  staleTurns: number;
  url: string;
  /** Timestamp of the stuck signal (for auto-dismiss timing) */
  receivedAt: number;
}
```

### `TurnProgress`

```typescript
/** Turn progress state for the side panel */
export interface TurnProgress {
  turn: number;
  maxTurns: number;
  provider?: string;
}
```

### `SidePanelState`

```typescript
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
  /** True when agent is paused waiting for plan approval */
  awaitingPlanApproval: boolean;
  /** Live session metrics (null when no active session or tracking disabled) */
  sessionMetrics: SessionMetrics | null;
  /** User-saved prompt templates */
  savedPrompts: SavedPrompt[];
}
```

### `SavedPrompt`

```typescript
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
```

---

## Memory / Second Brain Types

### `MemoryEntry`

```typescript
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
}
```

### `MemorySearchResult`

```typescript
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
```

### `MemoryWorkerMessage`

```typescript
/** Messages sent to the memory offscreen document / web worker */
export interface MemoryWorkerMessage extends BaseMessage {
  type: "MEMORY_WORKER";
  source: MessageSource.BACKGROUND;
  payload:
    | { action: "init" }
    | { action: "add"; content: string; category: string; sourceUrl: string }
    | { action: "search"; query: string; limit: number }
    | { action: "delete"; id: string }
    | { action: "clear" }
    | { action: "extract_pdf"; url: string; maxPages?: number };
}
```

### `MemoryWorkerResponse`

```typescript
/** Responses from the memory worker back to the service worker */
export interface MemoryWorkerResponse extends BaseMessage {
  type: "MEMORY_WORKER_RESPONSE";
  source: MessageSource.OFFSCREEN;
  payload:
    | { action: "init"; success: boolean; error?: string }
    | { action: "add"; success: boolean; id: string; error?: string }
    | { action: "search"; results: MemorySearchResult[]; error?: string }
    | { action: "delete"; success: boolean; error?: string }
    | { action: "clear"; success: boolean; error?: string }
    | { action: "extract_pdf"; text: string; success: boolean; error?: string };
}
```

### `FTS5Row`

```typescript
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
```

---

## Workspace / Tab Group Types

### `Workspace`

```typescript
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
```

---

## Navigation Bridge Types

### `NavigationState`

```typescript
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
```

### `NavigationResumeMessage`

```typescript
export interface NavigationResumeMessage extends BaseMessage {
  type: "NAVIGATION_RESUME";
  source: MessageSource.BACKGROUND;
  payload: {
    success: boolean;
    url: string;
    error?: string;
  };
}
```

---

## Configuration Types

### `UserSettings`

```typescript
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
  /** Show action plan and wait for confirmation before executing (default: false) */
  confirmPlan: boolean;
  /** Show token usage and cost metrics during and after agent sessions */
  showSessionMetrics: boolean;
  /** Hide take_screenshot from tools; also skips auto-screenshot on stuck */
  disableScreenshot: boolean;
  /** Hide navigate from tools */
  disableNavigation: boolean;
  /** Speech-to-text provider for voice input */
  speechProvider: "browser" | "groq";
}
```

---

## Trace Types

### `TraceEntry`

```typescript
/** A single turn's full-fidelity recording for offline eval replay */
export interface TraceEntry {
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
}
```

### `TraceToolExecution`

```typescript
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
```

### `TraceEvent`

```typescript
/** A notable event that occurred during a trace turn */
export interface TraceEvent {
  type:
    | "escalation"
    | "hint"
    | "modal_dismiss"
    | "done_rejected"
    | "plan_update"
    | "screenshot"
    | "stuck_signal"
    | "circuit_breaker"
    | "navigate_blocked";
  timestamp: number;
  data: Record<string, unknown>;
}
```

### `TraceSession`

```typescript
/** Session-level metadata written to traces/index.jsonl on session end */
export interface TraceSession {
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
}
```

---

## Utility Types

### `Result<T, E>`

```typescript
/** A discriminated union for success/error returns (no exceptions) */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```
