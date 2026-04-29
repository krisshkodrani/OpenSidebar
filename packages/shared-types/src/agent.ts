/**
 * OpenSidebar — Agent state, chat history, and side panel state types
 */

import type { AgentStatus, RiskLevel, ToolName } from "./enums";
import type { UserSettings } from "./settings";
import type {
  EscalationPacket,
  SessionMetrics,
  TaskCompletionMessage,
  TaskProgressMessage,
  LaneTelemetrySnapshot,
} from "./messages";

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

// --- User-recorded Website Skills ---

export type SkillRecordingEventKind =
  | "click"
  | "input"
  | "select"
  | "checkbox"
  | "navigation"
  | "page";

export interface SkillRecordingEvent {
  id: string;
  kind: SkillRecordingEventKind;
  timestamp: number;
  url: string;
  path: string;
  label: string;
  tagName?: string;
  inputType?: string;
  valueKind?: "redacted" | "email" | "phone" | "number" | "date" | "text";
  selectedLabel?: string;
  checked?: boolean;
  sensitive?: boolean;
  timelineText: string;
}

export interface UserWebsiteSkillDraft {
  id: string;
  name: string;
  origin: string;
  pathPattern: string;
  triggerPhrase: string;
  workflowSteps: string[];
  requiredEvidence: string[];
  privacySummary: string;
  capturedEventCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface UserWebsiteSkill extends UserWebsiteSkillDraft {
  enabled: boolean;
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
  /** Whether this user message was sent as feedback during execution */
  isFeedback?: boolean;
  /** Structured completion data — when present, MessageBubble renders CompletionSummary */
  completionData?: TaskCompletionMessage["payload"];
  /** Source citations from URLs visited during the agent session */
  citations?: Citation[];
  /** Extracted LLM thinking/reasoning content (from <think> blocks or markdown sections) */
  thinking?: string;
  /** Synthetic entry that renders as PlanTimelineCard instead of MessageBubble */
  isPlanCard?: boolean;
}

/** Stagnation detection state for the side panel */
export interface StagnationState {
  signal: "escalate";
  stagnantTurns: number;
  url: string;
  /** Timestamp of the stagnation signal (for auto-dismiss timing) */
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

/** Pending plan confirmation state for sidepanel store */
export interface PendingPlanConfirmation {
  confirmationId: string;
  nodes: { description: string; successCriteria: string; selectedSkillId?: string }[];
  difficulty?: string;
  query: string;
  requestedAt: number;
}

/** Pending clarification state for sidepanel store */
export interface PendingClarification {
  clarificationId: string;
  question: string;
  suggestions?: string[];
  timeoutMs: number;
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
  /** Non-null when the agent is detected as stagnating */
  stagnationState: StagnationState | null;
  /** Current turn progress (null when agent is idle) */
  turnProgress: TurnProgress | null;
  /** Pending high-risk action awaiting user approval */
  pendingApproval: PendingApproval | null;
  /** Pending orchestrator escalation requiring user decision */
  pendingEscalation: PendingEscalation | null;
  /** Pending plan confirmation awaiting user approval */
  pendingPlanConfirmation: PendingPlanConfirmation | null;
  /** Pending clarification question awaiting user answer */
  pendingClarification: PendingClarification | null;
  /** Non-null when a task has been recovered from checkpoint */
  taskRecovery: TaskRecoveryState | null;
  /** Live session metrics (null when no active session or tracking disabled) */
  sessionMetrics: SessionMetrics | null;
  /** Runtime lane telemetry from orchestrator lane supervisors */
  laneTelemetry: LaneTelemetrySnapshot | null;
  /** User-saved prompt templates */
  savedPrompts: SavedPrompt[];
}
