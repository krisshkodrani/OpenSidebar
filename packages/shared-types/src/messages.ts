/**
 * OpenSidebar — All RuntimeMessage types (discriminated union + every message interface)
 */

import type { AgentStatus, MessageSource, AgentRole, RiskLevel, ToolName } from "./enums";
import type { OverlayDescriptor, DomSnapshot } from "./dom";
import type { UserSettings } from "./settings";
import type {
  AgentStep,
  Citation,
  SkillRecordingEvent,
  ToolCallSummary,
  UserWebsiteSkill,
  UserWebsiteSkillDraft,
} from "./agent";
import type { PartialProgressHandoff } from "./progress";

export type UiMessageSource = MessageSource.SIDEPANEL | MessageSource.UI;
export type PassiveInputSource = "page" | "screenshot" | "tabAudio";
export type PassiveMonitorStatus =
  | "watching"
  | "paused"
  | "stopped"
  | "blocked"
  | "error";

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
  | UserChatAcceptedMessage
  | SpeechTranscriptionRequestMessage
  | SpeechTranscriptionResultMessage
  | PassiveMonitorStartMessage
  | PassiveMonitorStopMessage
  | PassiveMonitorStatusMessage
  | PassiveMonitorPageActivityMessage
  | PassiveMonitorSuggestionMessage
  | AgentResponseMessage
  | AgentStatusMessage
  | TaskRecoveryMessage
  | E2ESeedPendingInteractionMessage
  | E2ERailUpdateMessage
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
  | StopAgentMessage
  | SettingsUpdateMessage
  | SidePanelOpenedMessage
  | CloseSidePanelMessage
  | ScreenshotCapturedMessage
  | DismissModalsMessage
  | DismissModalsResponse
  | AgentStagnationMessage
  | AgentTurnMessage
  | TaskProgressMessage
  | TaskCompletionMessage
  | DurableRunStatusMessage
  | SkipSubtaskMessage
  | PauseAgentMessage
  | ResumeAgentMessage
  | SessionMetricsMessage
  | DataControlRequestMessage
  | DataControlResultMessage
  | ContentScriptReadyMessage
  | DomReadyProbeMessage
  | DomReadyAckMessage
  | PlanConfirmationRequestMessage
  | PlanConfirmationResponseMessage
  | ClarificationRequestMessage
  | ClarificationResponseMessage
  | ScrollToPositionMessage
  | ScrollToPositionResponse
  | WorkspaceSyncMessage
  | AgentStepLabelMessage
  | SkillRecordingStartMessage
  | SkillRecordingStopMessage
  | SkillRecordingCancelMessage
  | SkillRecordingEventMessage
  | SkillRecordingStatusMessage
  | UserSkillSaveMessage
  | UserSkillListMessage
  | UserSkillDeleteMessage
  | UserSkillUsageStatusMessage;

// --- Chat Messages ---

/** User sends a new chat message from the side panel */
export interface UserChatMessage extends BaseMessage {
  type: "USER_CHAT";
  source: UiMessageSource;
  payload: {
    text: string;
    /** Active tab ID at time of sending */
    tabId: number;
    /** Active workspace ID, if any */
    workspaceId: string | null;
    /** UI-generated chat entry ID, echoed back by the background for dedupe. */
    messageId?: string;
    /** UI timestamp, echoed back by the background for consistent ordering. */
    timestamp?: number;
    /** When true, inject as feedback into running agent context (don't start new loop) */
    isFeedback?: boolean;
  };
}

/** Background acknowledges a user chat so all mounted panels can render it */
export interface UserChatAcceptedMessage extends BaseMessage {
  type: "USER_CHAT_ACCEPTED";
  source: MessageSource.BACKGROUND;
  payload: {
    text: string;
    tabId: number;
    workspaceId: string | null;
    messageId: string;
    timestamp: number;
    isFeedback?: boolean;
  };
}

/** Side panel asks the background to transcribe user-captured audio. */
export interface SpeechTranscriptionRequestMessage extends BaseMessage {
  type: "SPEECH_TRANSCRIPTION_REQUEST";
  source: UiMessageSource;
  payload: {
    audioBase64: string;
    mimeType: string;
    workspaceId: string | null;
    language?: string;
    prompt?: string;
  };
}

/** Background returns a speech transcription result. */
export interface SpeechTranscriptionResultMessage extends BaseMessage {
  type: "SPEECH_TRANSCRIPTION_RESULT";
  source: MessageSource.BACKGROUND;
  payload: {
    ok: boolean;
    text?: string;
    detail?: string;
    durationMs?: number;
  };
}

/** Side panel starts a passive monitor for the active workspace tab. */
export interface PassiveMonitorStartMessage extends BaseMessage {
  type: "PASSIVE_MONITOR_START";
  source: UiMessageSource;
  payload: {
    tabId: number;
    workspaceId: string | null;
    instructions: string;
    inputSources: PassiveInputSource[];
    minIntervalMs?: number;
    maxSuggestionsPerMinute?: number;
  };
}

/** Side panel stops the passive monitor for a workspace. */
export interface PassiveMonitorStopMessage extends BaseMessage {
  type: "PASSIVE_MONITOR_STOP";
  source: UiMessageSource;
  payload: {
    workspaceId?: string | null;
  };
}

/** Background broadcasts passive monitor status to the side panel. */
export interface PassiveMonitorStatusMessage extends BaseMessage {
  type: "PASSIVE_MONITOR_STATUS";
  source: MessageSource.BACKGROUND;
  payload: {
    status: PassiveMonitorStatus;
    detail?: string;
    sessionId?: string;
    observedAt?: number;
  };
}

/** Background tells the watched page whether Watch Mode owns the page glow. */
export interface PassiveMonitorPageActivityMessage extends BaseMessage {
  type: "PASSIVE_MONITOR_PAGE_ACTIVITY";
  source: MessageSource.BACKGROUND;
  payload: {
    active: boolean;
    status: PassiveMonitorStatus;
    sessionId: string;
  };
}

/** Background posts a passive suggestion to the side panel chat. */
export interface PassiveMonitorSuggestionMessage extends BaseMessage {
  type: "PASSIVE_MONITOR_SUGGESTION";
  source: MessageSource.BACKGROUND;
  payload: {
    suggestionId: string;
    sessionId: string;
    answer: string;
    confidence: "low" | "medium" | "high";
    evidence: string[];
    reason?: string;
    observedAt: number;
    fingerprint: string;
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
    /** Optional terminal task outcome associated with an IDLE status. */
    completionStatus?: "completed" | "partial" | "failed" | "stopped";
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
  source: UiMessageSource;
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
    /** When set, replaces the entire content of the current streaming message */
    replaceContent?: string;
    /** Extracted LLM thinking/reasoning content */
    thinking?: string;
  };
}

/** User requests the agent loop to stop (from side panel or in-page stop button) */
export interface StopAgentMessage extends BaseMessage {
  type: "STOP_AGENT";
  source: UiMessageSource | MessageSource.CONTENT;
  payload: {
    workspaceId?: string | null;
  };
}

/** Settings changed — broadcast to all contexts */
export interface SettingsUpdateMessage extends BaseMessage {
  type: "SETTINGS_UPDATE";
  source: UiMessageSource;
  payload: {
    settings: Partial<UserSettings>;
  };
}

/** Side panel reports it has been opened/mounted */
export interface SidePanelOpenedMessage extends BaseMessage {
  type: "SIDE_PANEL_OPENED";
  source: UiMessageSource;
  payload: {
    tabId: number;
    windowId: number;
  };
}

/** Side panel requests background to re-broadcast current state for a workspace */
export interface WorkspaceSyncMessage extends BaseMessage {
  type: "WORKSPACE_SYNC";
  source: UiMessageSource;
  payload: {
    workspaceId: string;
  };
}

export interface SkillRecordingStartMessage extends BaseMessage {
  type: "SKILL_RECORDING_START";
  source: UiMessageSource | MessageSource.BACKGROUND;
  payload: {
    tabId: number;
  };
}

export interface SkillRecordingStopMessage extends BaseMessage {
  type: "SKILL_RECORDING_STOP";
  source: UiMessageSource | MessageSource.BACKGROUND | MessageSource.CONTENT;
  payload: {
    tabId?: number;
  };
}

export interface SkillRecordingCancelMessage extends BaseMessage {
  type: "SKILL_RECORDING_CANCEL";
  source: UiMessageSource | MessageSource.BACKGROUND | MessageSource.CONTENT;
  payload: {
    tabId?: number;
  };
}

export interface SkillRecordingEventMessage extends BaseMessage {
  type: "SKILL_RECORDING_EVENT";
  source: MessageSource.CONTENT | MessageSource.BACKGROUND;
  payload: {
    event: SkillRecordingEvent;
  };
}

export interface SkillRecordingStatusMessage extends BaseMessage {
  type: "SKILL_RECORDING_STATUS";
  source: MessageSource.BACKGROUND;
  payload: {
    status: "idle" | "recording" | "review" | "paused";
    timeline: string[];
    draft?: UserWebsiteSkillDraft;
    detail?: string;
  };
}

export interface UserSkillSaveMessage extends BaseMessage {
  type: "USER_SKILL_SAVE";
  source: UiMessageSource;
  payload: {
    draft: UserWebsiteSkillDraft;
    enabled?: boolean;
  };
}

export interface UserSkillListMessage extends BaseMessage {
  type: "USER_SKILL_LIST";
  source: UiMessageSource | MessageSource.BACKGROUND;
  payload: {
    skills?: UserWebsiteSkill[];
  };
}

export interface UserSkillDeleteMessage extends BaseMessage {
  type: "USER_SKILL_DELETE";
  source: UiMessageSource;
  payload: {
    id: string;
  };
}

export interface UserSkillUsageStatusMessage extends BaseMessage {
  type: "USER_SKILL_USAGE_STATUS";
  source: MessageSource.BACKGROUND;
  payload: {
    skill: UserWebsiteSkill | null;
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
    /** Whether the task is actively operating on the page surface. */
    pageActivity?: boolean;
    /** Final outcome sent with active=false so the overlay can show a brief done/failed flash */
    outcome?: { status: "completed" | "failed" | "stopped"; label?: string };
    laneTelemetry?: LaneTelemetrySnapshot;
  };
}

/** Background sends the latest step label to the content script for the floating overlay */
export interface AgentStepLabelMessage extends BaseMessage {
  type: "AGENT_STEP_LABEL";
  source: MessageSource.BACKGROUND;
  payload: {
    label: string;
    status: "running" | "done" | "error";
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

/** Background broadcasts stagnation detection signals to the side panel */
export interface AgentStagnationMessage extends BaseMessage {
  type: "AGENT_STAGNATION";
  source: MessageSource.BACKGROUND;
  payload: {
    signal: "escalate" | "resolved";
    stagnantTurns: number;
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

/** Background broadcasts minimal durable-run control state for the current workspace. */
export interface DurableRunStatusMessage extends BaseMessage {
  type: "DURABLE_RUN_STATUS";
  source: MessageSource.BACKGROUND;
  payload: {
    runId: string;
    query: string;
    status: "planning" | "running" | "completed" | "failed" | "stopped";
    canResume: boolean;
    lastKnownResumeSafe?: boolean | null;
    lastKnownResumeReason?: string | null;
    stopRequestedAt?: number | null;
    resumeRequestedAt?: number | null;
  } | null;
}

/** Test-only hook to seed a durable pending interaction without invoking the planner/executor. */
export interface E2ESeedPendingInteractionMessage extends BaseMessage {
  type: "E2E_SEED_PENDING_INTERACTION";
  source: string;
  payload: {
    tabId: number;
    workspaceId: string;
    interaction:
      | {
          kind: "approval";
          toolName: ToolName;
          args?: Record<string, unknown>;
          context: string;
        }
      | {
          kind: "clarification";
          question: string;
          suggestions?: string[];
        };
  };
}

/** Test-only observer update for the page-contained visible E2E rail. */
export interface E2ERailUpdateMessage extends BaseMessage {
  type: "E2E_RAIL_UPDATE";
  source: string;
  payload: {
    prompt?: string;
    status?: string;
    detail?: string;
    planItems?: string[];
    feed?: Array<{
      id: string;
      kind: "status" | "step" | "plan" | "completion";
      text: string;
      timestamp: number;
    }>;
    finalText?: string;
    outcome?: "completed" | "failed" | "stopped" | "";
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
  source: UiMessageSource;
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
  /** Stable orchestrator node id for worker-level progress correlation. */
  nodeId?: string;
  /** Parallel scheduling state shown by side panel and overlay progress UI. */
  workerStatus?:
    | "queued"
    | "blocked"
    | "running"
    | "verifying"
    | "retrying"
    | "completed"
    | "failed"
    | "skipped"
    | "cancelled";
  /** Concise human-facing explanation for queued, blocked, or running worker state. */
  workerStatusDetail?: string;
  /** Planner/repair parallelism classification for this node. */
  parallelism?: "independent" | "resource_bound" | "serialized" | "unknown";
  /** Compact resource ownership summary, intentionally environment-neutral. */
  resourceSummary?: string;
  /** URL (origin+pathname) where this step was completed — used by navigate guard */
  completedAtUrl?: string;
  /** Workflow skill selected for this subtask */
  selectedSkillId?: string;
  /** Tool profile applied to this subtask */
  toolProfile?: string;
}

/** Background sends structured completion report when a task finishes */
export interface TaskCompletionMessage extends BaseMessage {
  type: "TASK_COMPLETION";
  source: MessageSource.BACKGROUND;
  payload: {
    taskId: string;
    status: "completed" | "partial" | "failed" | "stopped";
    totalTurnsUsed: number;
    totalTimeMs: number;
    summary: string;
    subtaskResults: SubtaskResult[];
    urlHistory: string[];
    /** Session metrics (token usage, cost, timing) */
    metrics?: SessionMetrics;
    /** Explicit termination reason for budget/guardrail stops */
    terminationReason?: string;
    /** Structured continuation artifact for incomplete-but-useful runs. */
    partialHandoff?: PartialProgressHandoff;
  };
}

/** Outcome of a single subtask within a completion report */
export interface SubtaskResult {
  description: string;
  status: "completed" | "failed" | "skipped" | "stopped";
  turnsUsed: number;
  result: string;
}

/** Side panel requests skipping the current subtask */
export interface SkipSubtaskMessage extends BaseMessage {
  type: "SKIP_SUBTASK";
  source: UiMessageSource;
  payload: {
    taskId: string;
  };
}

/** Side panel requests pausing the agent loop */
export interface PauseAgentMessage extends BaseMessage {
  type: "PAUSE_AGENT";
  source: UiMessageSource;
  payload: {
    workspaceId?: string | null;
  };
}

/** Side panel requests resuming the paused agent loop */
export interface ResumeAgentMessage extends BaseMessage {
  type: "RESUME_AGENT";
  source: UiMessageSource;
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
  source: UiMessageSource;
  payload: {
    action:
      | "clear_logs"
      | "clear_chat_history"
      | "clear_workspace_chat_history"
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
  /** Number of screenshot-based vision/perception model calls made */
  visionCallCount?: number;
  /** Number of cached screenshot/perception observations reused without a model call */
  cachedVisionCallCount?: number;
  /** Estimated image prompt tokens for completed turns/calls; optional for legacy payloads and not added to totalTokens */
  totalImagePromptTokenEstimate?: number;
  /** Number of image parts in completed LLM/perception prompts; optional for legacy payloads */
  imagePromptCount?: number;
  /** Turns whose perception ran in structured mode (LP-11 telemetry) */
  structuredTurnCount?: number;
  /** Turns whose perception ran in unified VL mode (LP-11 telemetry) */
  unifiedVlTurnCount?: number;
  /** Selected perception path and why it was chosen for this run */
  perceptionModeDecision?: {
    mode: "structured" | "unified_vl";
    reason: string;
    signals: string[];
    /** Which auto-mode default produced the decision (LP-11 A/B) */
    autoDefault?: "structured" | "unified_vl";
  };
  /** Total prompt tokens served from cache (prefix caching) */
  totalCachedTokens: number;
  /** Per-model breakdown */
  modelBreakdown: Record<
    string,
    {
      promptTokens: number;
      completionTokens: number;
      imagePromptTokenEstimate?: number;
      imagePromptCount?: number;
      cost: number;
      actualCost?: number;
      estimatedCost?: number;
      costMode?: "none" | "actual" | "estimated" | "mixed";
      calls: number;
    }
  >;
}

// --- DOM Snapshot Request/Response Messages ---

/** Background requests a DOM snapshot from the content script */
export interface DomSnapshotRequest extends BaseMessage {
  type: "DOM_SNAPSHOT_REQUEST";
  source: MessageSource.BACKGROUND;
  payload: {
    /** Whether to re-tag elements or use cached tags */
    refresh: boolean;
    /** When true, auto-dismiss viewport-covering overlays before snapshotting.
     *  Default: true. Set false for post-tool refreshes so agent-triggered
     *  dialogs (confirmation prompts, menus) are not destroyed. */
    autoDismiss?: boolean;
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

// --- Navigation Resume Message ---

export interface NavigationResumeMessage extends BaseMessage {
  type: "NAVIGATION_RESUME";
  source: MessageSource.BACKGROUND;
  payload: {
    success: boolean;
    url: string;
    error?: string;
  };
}

// --- Plan Confirmation & Clarification Messages ---

/** Background sends a plan to the side panel for user review before execution */
export interface PlanConfirmationRequestMessage extends BaseMessage {
  type: "PLAN_CONFIRMATION_REQUEST";
  source: MessageSource.BACKGROUND;
  payload: {
    confirmationId: string;
    nodes: { description: string; successCriteria: string; selectedSkillId?: string }[];
    difficulty?: string;
    query: string;
  };
}

/** Side panel responds to a pending plan confirmation */
export interface PlanConfirmationResponseMessage extends BaseMessage {
  type: "PLAN_CONFIRMATION_RESPONSE";
  source: UiMessageSource;
  payload: {
    confirmationId: string;
    decision: "approve" | "cancel";
    feedback?: string;
  };
}

/** Background asks the user a clarifying question mid-execution */
export interface ClarificationRequestMessage extends BaseMessage {
  type: "CLARIFICATION_REQUEST";
  source: MessageSource.BACKGROUND;
  payload: {
    clarificationId: string;
    question: string;
    suggestions?: string[];
    timeoutMs: number;
  };
}

/** Side panel responds to a pending clarification request */
export interface ClarificationResponseMessage extends BaseMessage {
  type: "CLARIFICATION_RESPONSE";
  source: UiMessageSource;
  payload: {
    clarificationId: string;
    answer: string;
  };
}

// --- Scroll Position Messages (background ↔ content) ---

/** Background asks content script to scroll to an absolute Y position */
export interface ScrollToPositionMessage extends BaseMessage {
  type: "SCROLL_TO_POSITION";
  source: MessageSource.BACKGROUND;
  payload: { y: number };
}

/** Content script reports the actual scroll position after scrolling */
export interface ScrollToPositionResponse extends BaseMessage {
  type: "SCROLL_TO_POSITION_RESPONSE";
  source: MessageSource.CONTENT;
  payload: { actualY: number };
}
