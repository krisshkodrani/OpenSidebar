/**
 * OpenSidebar — task/agent progress telemetry (background → side panel and
 * page overlay): step timeline, turn counters, subtask progress, completion
 * reports, session metrics, and durable-run status.
 */

import type { AgentRole, MessageSource } from "../enums";
import type { AgentStep } from "../agent";
import type { PartialProgressHandoff } from "../progress";
import type { BaseMessage } from "./base";
import type { ForwardedApprovalDryRun } from "../browser-bridge";

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

/** Background broadcasts session token/cost metrics to the side panel */
export interface SessionMetricsMessage extends BaseMessage {
  type: "SESSION_METRICS";
  source: MessageSource.BACKGROUND;
  payload: SessionMetrics;
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
  /** Forced stale-fingerprint re-interprets on structured turns (LP-11 cache efficacy) */
  staleReinterpretCount?: number;
  /** Stale re-interprets whose fresh interpretation differed from the cached one */
  staleReinterpretRevealedCount?: number;
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

/** Background reports the outcome of a navigation the agent triggered. */
export interface NavigationResumeMessage extends BaseMessage {
  type: "NAVIGATION_RESUME";
  source: MessageSource.BACKGROUND;
  payload: {
    success: boolean;
    url: string;
    error?: string;
  };
}

/** Progress, telemetry, and completion-report messages (background-sourced). */
/**
 * Background announces a task paused for a user interaction (pi-backend
 * Phase 4 approval forwarding). Emitted AFTER `task.pendingInteraction` is
 * set, so any consumer that answers immediately finds resolvable state. The
 * task is alive and checkpointed; it resumes via an approval response, or
 * auto-denies at `expiresAt`. The sidepanel ignores this (it already gets
 * APPROVAL_REQUEST); the browser-bridge driver forwards it over the wire.
 */
export interface TaskPausedMessage extends BaseMessage {
  type: "TASK_PAUSED";
  source: MessageSource.BACKGROUND;
  workspaceId: string;
  payload: {
    taskId: string;
    interaction: {
      kind: "approval";
      approvalId: string;
      toolName: string;
      args: Record<string, unknown>;
      context: string;
      requestedAt: number;
      timeoutMs: number;
      expiresAt: number;
      dryRun?: ForwardedApprovalDryRun;
    };
  };
}

export type ProgressMessage =
  | AgentStepMessage
  | AgentActivityMessage
  | AgentStepLabelMessage
  | AgentStagnationMessage
  | AgentTurnMessage
  | TaskProgressMessage
  | TaskRecoveryMessage
  | DurableRunStatusMessage
  | TaskCompletionMessage
  | TaskPausedMessage
  | SessionMetricsMessage
  | NavigationResumeMessage;
