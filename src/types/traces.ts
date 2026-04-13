/**
 * OpenSidebar — Trace recording types
 */

import type { RiskLevel, ToolName } from "./enums";
import type { ToolCall } from "./agent";
import type { TaggedElement } from "./dom";
import type { SessionMetrics } from "./messages";

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

/** Slim message representation for traces — flattens ContentPart[] to string|null, replaces images with "[image]" */
export interface TraceLLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** Context budget metrics captured at time of LLM call */
export interface TraceContextMetrics {
  systemTokens: number;
  historyTokens: number;
  totalTokens: number;
  maxTokens: number;
  utilization: number;
  droppedMessageCount: number;
  compressionLevel: string;
  cachedPrefixLength: number;
}

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
  /** DOM state at turn start (what the LLM saw when deciding) */
  snapshot: {
    url: string;
    title: string;
    elementCount: number;
    visibleContentLength: number;
    pageContentLength?: number;
    scrollY: number;
  };
  /** DOM state after tool execution — matches what perception was based on */
  postToolSnapshot?: {
    url: string;
    title: string;
    elementCount: number;
    scrollY: number;
  };
  /** Full elements array (for eval replay — reconstruct system prompt) */
  elements: TaggedElement[];
  /** LLM call metadata */
  llmRequest: {
    model: string;
    /** Which tier executed this turn — executor (tier 0) vs planner (tier 1) */
    modelTier?: "executor" | "planner";
    messageCount: number;
    toolCount: number;
    compressionLevel: string;
    /** Full messages array sent to LLM (no tool defs) — optional for backward compat */
    messages?: TraceLLMMessage[];
    /** Context budget metrics — optional for backward compat */
    contextMetrics?: TraceContextMetrics;
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
    /** Provider that actually served the request (may differ after failover) */
    actualProviderId?: string;
    /** Model that actually served the request (may differ after failover) */
    actualModel?: string;
  };
  /** Tool executions for this turn */
  toolExecutions: TraceToolExecution[];
  /** Events that occurred during this turn */
  events: TraceEvent[];
  /** Stagnation monitor state */
  progressState: {
    stagnantTurns: number;
    signal: string | null;
  };
  /** Perception layer data (vision model interpretation of the page) */
  perception?: {
    interpretation: string;
    model: string;
    providerId?: string;
    durationMs: number;
    screenshotPath?: string;
    /** Inline base64 data URL of the screenshot (self-contained, no server needed) */
    screenshotDataUrl?: string;
    cached: boolean;
    /** The element summary text that was sent to the vision model */
    elementSummary?: string;
    /** Additional viewport screenshots from panoramic capture (first turn only) */
    panoramicShots?: TracePanoramicShot[];
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

/** A panoramic screenshot captured at a different scroll position for trace recording */
export interface TracePanoramicShot {
  dataUrl: string;
  scrollY: number;
  label: string; // "top", "middle", "bottom"
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
    stagnantTurns: number;
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
  plan_monitor: {
    stepIndex: number;
    alignment: "aligned" | "progressing" | "deviated" | "blocked";
    reason: string;
    heuristicHit: boolean;
    blocker?: string;
  };
  plan_replan: {
    fromIndex: number;
    newStepCount: number;
    reason: string;
    replanNumber: number;
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
  /** Normalized failure category */
  failureCategory?: string;
  /** Normalized failure code */
  failureCode?: string;
  /** Human-readable failure detail */
  failureDetail?: string;
  /** Workspace ID for session isolation correlation */
  workspaceId?: string | null;
  /** Models referenced in this session (e.g. for filtering recording/manual/agent sessions) */
  models?: string[];
  /** Planner's difficulty assessment for this session */
  difficultyAssessment?: string;
  /** Resolved runtime limits after merging defaults + profile + overrides */
  resolvedLimits?: Record<string, number>;
  /** Planner's per-field limit overrides (null if none) */
  plannerLimitOverrides?: Record<string, number> | null;
  /** Full plan decomposition from the planner (subtask descriptions + detailed steps) */
  planDecomposition?: {
    subtasks: string[];
    steps: Array<{
      objective: string;
      successCriteria: string;
      selectedSkillId?: string;
      dependencies: number[];
      assumptions: string[];
      verifyAfter?: { trigger: string; action: string; pattern?: string };
      toolProfile?: string;
      expectedState?: {
        description: string;
        urlPattern?: string;
        expectedPhrases?: string[];
      };
    }>;
  };
}

/** Normalized failure info for trace/session rollups */
export interface TraceFailureInfo {
  category: string;
  code: string;
  detail?: string;
}
