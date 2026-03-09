import {
  AgentStatus,
  AgentLoopState,
  AgentStep,
  Citation,
  MessageSource,
  RuntimeMessage,
  RiskLevel,
  SessionMetrics,
  SubtaskResult,
  SubtaskSummary,
  ToolDefinition,
  ToolCall,
  ToolName,
} from "../../types";
import { logger, SessionScopedLogger } from "../../utils";
import { LLMClient, stripThinkTags, extractThinkContent } from "../llm";
import { toolRegistry } from "../tools";
import {
  DOM_MODIFYING_TOOLS,
  SEQUENTIAL_TOOLS,
  CACHEABLE_TOOLS,
  resolveToolProfile,
} from "../tools/metadata";
import type { ToolProfile } from "../tools/metadata";
import { classifyRisk, sanitizeUrl, validateToolCalls } from "../security";
import {
  waitForDomReady,
  ensureContentScript,
} from "../tab-ready";
import {
  isBridgeDisconnect,
  reinjectContentScript,
} from "../tools/bridge";
import { perceptionWarmup } from "../perception-warmup";
import { workspaceManager } from "../workspaces/manager";
import { ContextManager, summarizeCausalChain } from "./context";
import { checkVerificationGate, detectAdmission } from "./verification";
import {
  StagnationMonitor,
  computeSnapshotFingerprint,
} from "./stagnation";
import { buildElementSummary } from "../perception";
import { PerceptionAgent } from "../perception/perception-agent";
import type { PanoramicShot } from "../perception/types";
import { recoverToolCallsFromText } from "./tool-recovery";
import { DomSnapshot } from "../../types";
import { CompletionResponse, TokenUsage } from "../llm/types";
import { estimateCostUsd } from "../llm/pricing";
import {
  formatStepLabel,
  buildElementResolver,
  ElementResolver,
} from "./step-labels";
import { TaskPlanner, PlanStep, PlanMonitorResult } from "./planner";
import { TraceRecorder } from "./trace";
import { parseNuisanceBlockers } from "./popup-triage";
import { ToolResultCache } from "./tool-cache";
import { AgentMiddleware } from "./middleware";
import { DemoStore, formatDemoForContext } from "../demos/store";
import {
  AGENT_LIMITS,
  BROADCAST_INTERVALS,
  LLM_CONFIG,
  STRING_LIMITS,
  ESCALATION_LIMITS,
  ORIENTATION,
  REDUNDANT_ACTION,
  FAILED_ACTION_MEMORY,
  STAGNATION_DETECTION,
  ROLLING_DISTILL,
  FRESH_START,
  TOOL_CACHE,
  ACTION_EFFECT,
  DEFAULT_RUNTIME_LIMITS,
  resolveRuntimeLimits,
  INVESTIGATION_TOOLS,
  INVESTIGATION_EXTENSION,
  MAX_ORIENTATION_TURNS,
  EXPLORATION_BUDGET,
  EXPLORATION_ONLY_TOOLS,
} from "./constants";
import type { Difficulty, RuntimeLimits } from "./constants";
// reassessRuntimeLimits is available from "./constants" for mid-session S5 reassessment
import { APPROVAL_TIMEOUT_MS, MAX_SESSION_MS } from "./loop-metrics";
import type { LoopResult } from "./loop-types";
import {
  BlockedAction,
  buildFailureBrief,
  buildFailureRecovery,
  buildHandoffBriefing,
  detectInstructionContradiction,
  extractAttemptSummary,
  findPriorFailure,
  formatActionEffect,
  getSnapshotFingerprint,
  isFillerText,
  isHallucinatedToolCall,
  normalizeOutcome,
  preflightElementCheck,
  RecentAction,
  SubgoalAttempt,
  userExplicitlyRequestedTabManagement,
  validateElementIds,
} from "./loop-helpers";
import {
  DEESCALATION_REFLECTION,
  ESCALATION_REFLECTION,
  HANDOFF_REFLECTION,
  PIVOT_MESSAGE,
  TEXT_ONLY_CORRECTION,
} from "./loop-prompts";

// Re-export submodules for barrel compatibility
export * from "./loop-types";
export * from "./loop-prompts";
export * from "./loop-metrics";
export * from "./loop-helpers";


/**
 * AgentLoop - Main orchestrator for the autonomous browser agent
 *
 * Core responsibilities:
 * - Execute the Think → Act → Verify loop
 * - Handle tool execution (parallel/sequential)
 * - Manage plan decomposition via TaskPlanner
 * - Track progress and detect stuck states
 * - Emit status updates to the UI
 *
 * Key features:
 * - Circuit breakers for tool failure handling
 * - Pause/resume capability
 * - Session metrics tracking
 * - Model escalation on stuck
 */
export class AgentLoop {
  private static approvalWaiters = new Map<
    string,
    (approved: boolean) => void
  >();

  public static resolveApproval(
    approvalId: string,
    approved: boolean,
  ): boolean {
    const waiter = AgentLoop.approvalWaiters.get(approvalId);
    if (!waiter) return false;
    AgentLoop.approvalWaiters.delete(approvalId);
    waiter(approved);
    return true;
  }

  private static clarificationWaiters = new Map<
    string,
    (answer: string) => void
  >();

  public static resolveClarification(
    clarificationId: string,
    answer: string,
  ): boolean {
    const waiter = AgentLoop.clarificationWaiters.get(clarificationId);
    if (!waiter) return false;
    AgentLoop.clarificationWaiters.delete(clarificationId);
    waiter(answer);
    return true;
  }

  private llm: LLMClient;
  private context: ContextManager;
  private baseContextTokens: number; // Original context window size for de-escalation restore
  private isRunning = false;
  private abortController: AbortController | null = null;
  private statusHandler: (status: AgentStatus, detail: string) => void;
  private messageHandler: (text: string, toolCalls: ToolCall[]) => void;
  private stepHandler: (step: AgentStep, update: boolean) => void;
  private maxTurns: number;
  /** Active runtime limits (resolved from difficulty + planner overrides) */
  private limits: RuntimeLimits = { ...DEFAULT_RUNTIME_LIMITS };
  /** Planner-assessed task difficulty */
  private difficulty: Difficulty = "moderate";
  private showSessionMetrics: boolean;
  private preferredModelTier: "executor" | "planner" | "default";
  private executionContract: {
    role: string;
    modelTier: "executor" | "planner";
    allowedTools: ToolName[];
  } | null;
  private disabledTools: Set<ToolName>;
  private suppressUiBroadcast: boolean;
  private onStreamChunk:
    | ((
        delta: string,
        done: boolean,
        replaceContent?: string,
        thinking?: string,
      ) => void)
    | null;
  private disableInternalPlanning: boolean;
  private bypassApprovals: boolean;
  private approvalTimeoutMs: number;
  private middleware: AgentMiddleware;

  /** Workspace ID for session isolation */
  public readonly workspaceId: string | null;
  public readonly workerId: string | null;
  public readonly taskIdRef: string | null;
  public readonly nodeId: string | null;
  public readonly runId: string | null;
  public readonly correlationId: string | null;

  /** Current turn count — exposed via getCurrentTurn() */
  private turnCount = 0;
  /** Original user query that started this loop */
  private originalQuery = "";
  /** Progress tracker — promoted from local to instance for external access */
  private stagnation = new StagnationMonitor();
  /** Pending hint from the user, picked up on the next turn */
  private pendingFeedback: string | null = null;
  /** Stateful perception agent — accumulates observations across turns */
  private perception = new PerceptionAgent();
  /** Last DOM-modifying tool step (retroactively gets screenshot attached) */
  private lastDomStep: AgentStep | null = null;
  /** Promise-based gate for pause/resume */
  private pauseGate: { promise: Promise<void>; resolve: () => void } | null =
    null;

  /** Task planner — planner model for decomposition and done validation */
  private planner: TaskPlanner;
  /** Number of times done() has been rejected by the planner */
  private doneRejections = 0;
  /** Turns spent on the current plan step */
  private turnsOnCurrentStep = 0;
  /** Last plan index — used to detect step transitions */
  private lastPlanIndex = 0;

  /** Task planning state */
  private taskId: string | null = null;
  private planSubtasks: SubtaskSummary[] = [];
  private planSteps: PlanStep[] = [];
  private taskStartTime = 0;
  private urlHistory: string[] = [];

  /** Plan monitor state */
  private turnsSinceLastMonitor = 0;
  private replanCount = 0;

  /** Trace recorder for session capture */
  private traceRecorder: TraceRecorder | null = null;

  /** Session-scoped logger — falls back to global logger before start() */
  private log: typeof logger | SessionScopedLogger = logger;

  /** Content-addressed tool result cache */
  private toolCache = new ToolResultCache(TOOL_CACHE.MAX_SIZE);

  /** Resolves element tag IDs to human-readable labels from current snapshot */
  private elementResolver: ElementResolver | undefined;

  /** Consecutive turns where DOM-modifying tools had no observable effect */
  private consecutiveZeroEffectTurns = 0;

  /** Last tool name executed — used for perception stale threshold selection */
  private lastToolNameForPerception: string | undefined;

  /** Off-domain navigation detection */
  private startingOrigin: string | null = null;
  private offDomainWarned = false;

  /** Collected source citations (deduplicated by URL) */
  private citations: Citation[] = [];
  private citationUrls = new Set<string>();

  /** Accumulated session metrics */
  private metrics: SessionMetrics = AgentLoop.emptyMetrics();
  private sessionStartTime = 0;

  private static emptyMetrics(): SessionMetrics {
    return {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      totalCostActual: 0,
      totalCostEstimated: 0,
      costMode: "none",
      totalLlmTimeMs: 0,
      totalSessionTimeMs: 0,
      llmCallCount: 0,
      totalCachedTokens: 0,
      modelBreakdown: {},
    };
  }

  private static deriveCostMode(
    actualCost: number,
    estimatedCost: number,
  ): "none" | "actual" | "estimated" | "mixed" {
    if (actualCost <= 0 && estimatedCost <= 0) return "none";
    if (actualCost > 0 && estimatedCost > 0) return "mixed";
    if (actualCost > 0) return "actual";
    return "estimated";
  }

  private resolveCost(
    usage: TokenUsage,
    providerId: "openrouter",
    model: string,
  ): { total: number; actual: number; estimated: number } {
    // Always use static pricing table for consistent cost across all providers
    const estimated = estimateCostUsd(providerId, model, usage) ?? 0;
    return { total: estimated, actual: 0, estimated };
  }

  /** Accumulate usage from an LLM response */
  private recordUsage(response: CompletionResponse, llmMs: number): void {
    if (response.usage) {
      this.metrics.totalPromptTokens += response.usage.prompt_tokens;
      this.metrics.totalCompletionTokens += response.usage.completion_tokens;
      this.metrics.totalTokens += response.usage.total_tokens;
      const providerId =
        response.actualProviderId ?? this.llm.getCurrentProvider();
      const model = response.actualModel ?? this.llm.getCurrentModel();
      const cost = this.resolveCost(response.usage, providerId, model);
      this.metrics.totalCost += cost.total;
      this.metrics.totalCostActual =
        (this.metrics.totalCostActual ?? 0) + cost.actual;
      this.metrics.totalCostEstimated =
        (this.metrics.totalCostEstimated ?? 0) + cost.estimated;
      this.metrics.costMode = AgentLoop.deriveCostMode(
        this.metrics.totalCostActual ?? 0,
        this.metrics.totalCostEstimated ?? 0,
      );
      if (response.usage.cached_tokens) {
        this.metrics.totalCachedTokens += response.usage.cached_tokens;
        this.log.debug("agent", "Cache hit", {
          cached: response.usage.cached_tokens,
          prompt: response.usage.prompt_tokens,
          pct: Math.round(
            (response.usage.cached_tokens / response.usage.prompt_tokens) * 100,
          ),
        });
      }
    }
    this.metrics.totalLlmTimeMs += llmMs;
    this.metrics.llmCallCount += 1;

    const model = response.actualModel ?? this.llm.getCurrentModel();
    if (!this.metrics.modelBreakdown[model]) {
      this.metrics.modelBreakdown[model] = {
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        actualCost: 0,
        estimatedCost: 0,
        costMode: "none",
        calls: 0,
      };
    }
    const entry = this.metrics.modelBreakdown[model];
    entry.calls += 1;
    if (response.usage) {
      entry.promptTokens += response.usage.prompt_tokens;
      entry.completionTokens += response.usage.completion_tokens;
      const providerId =
        response.actualProviderId ?? this.llm.getCurrentProvider();
      const cost = this.resolveCost(response.usage, providerId, model);
      entry.cost += cost.total;
      entry.actualCost = (entry.actualCost ?? 0) + cost.actual;
      entry.estimatedCost = (entry.estimatedCost ?? 0) + cost.estimated;
      entry.costMode = AgentLoop.deriveCostMode(
        entry.actualCost ?? 0,
        entry.estimatedCost ?? 0,
      );
    }
  }

  /** Record usage from a vision API call */
  public recordVisionUsage(
    usage: TokenUsage,
    llmMs: number,
    model: string,
  ): void {
    this.metrics.totalPromptTokens += usage.prompt_tokens;
    this.metrics.totalCompletionTokens += usage.completion_tokens;
    this.metrics.totalTokens += usage.total_tokens;
    const cost = this.resolveCost(usage, "openrouter", model);
    this.metrics.totalCost += cost.total;
    this.metrics.totalCostActual =
      (this.metrics.totalCostActual ?? 0) + cost.actual;
    this.metrics.totalCostEstimated =
      (this.metrics.totalCostEstimated ?? 0) + cost.estimated;
    this.metrics.costMode = AgentLoop.deriveCostMode(
      this.metrics.totalCostActual ?? 0,
      this.metrics.totalCostEstimated ?? 0,
    );
    this.metrics.totalLlmTimeMs += llmMs;
    this.metrics.llmCallCount += 1;

    if (!this.metrics.modelBreakdown[model]) {
      this.metrics.modelBreakdown[model] = {
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        actualCost: 0,
        estimatedCost: 0,
        costMode: "none",
        calls: 0,
      };
    }
    const entry = this.metrics.modelBreakdown[model];
    entry.calls += 1;
    entry.promptTokens += usage.prompt_tokens;
    entry.completionTokens += usage.completion_tokens;
    entry.cost += cost.total;
    entry.actualCost = (entry.actualCost ?? 0) + cost.actual;
    entry.estimatedCost = (entry.estimatedCost ?? 0) + cost.estimated;
    entry.costMode = AgentLoop.deriveCostMode(
      entry.actualCost ?? 0,
      entry.estimatedCost ?? 0,
    );
  }

  /** Get the current accumulated metrics snapshot */
  public getMetrics(): SessionMetrics {
    return {
      ...this.metrics,
      totalSessionTimeMs: Date.now() - this.sessionStartTime,
    };
  }

  /** Record a citation for a URL the agent visited or read */
  private recordCitation(url: string, title: string, tool: ToolName): void {
    try {
      const normalized = new URL(url).origin + new URL(url).pathname;
      if (this.citationUrls.has(normalized)) return;
      this.citationUrls.add(normalized);
      this.citations.push({
        url,
        title: title || url,
        tool,
        turn: this.turnCount,
      });
    } catch {
      // Ignore malformed URLs
    }
  }

  /** Get collected citations */
  public getCitations(): Citation[] {
    return this.citations;
  }

  /** Broadcast metrics to side panel (throttled) */
  private broadcastMetrics(): void {
    if (!this.showSessionMetrics) return;
    // Throttle: every N turns or on turn 1
    if (
      this.turnCount !== 1 &&
      this.turnCount % BROADCAST_INTERVALS.METRICS !== 0
    )
      return;

    this.metrics.totalSessionTimeMs = Date.now() - this.sessionStartTime;
    this.broadcast({
      type: "SESSION_METRICS",
      payload: { ...this.metrics },
    });
  }

  constructor(
    openRouterApiKey: string,
    callbacks: {
      onStatusUpdate: (status: AgentStatus, detail: string) => void;
      onMessage: (text: string, toolCalls: ToolCall[]) => void;
      onStep?: (step: AgentStep, update: boolean) => void;
    },
    options?: {
      maxContextTokens?: number;
      maxTurns?: number;
      showSessionMetrics?: boolean;
      preferredModelTier?: "executor" | "planner";
      executionContract?: {
        role: string;
        modelTier: "executor" | "planner";
        allowedTools: ToolName[];
      };
      disabledTools?: Set<ToolName>;
      workspaceId?: string | null;
      workerId?: string | null;
      taskId?: string | null;
      nodeId?: string | null;
      runId?: string | null;
      correlationId?: string | null;
      suppressUiBroadcast?: boolean;
      /** Called for STREAM_CHUNK even when suppressUiBroadcast is true.
       *  Allows orchestrator to forward content for single-node tasks. */
      onStreamChunk?: (
        delta: string,
        done: boolean,
        replaceContent?: string,
        thinking?: string,
      ) => void;
      disableInternalPlanning?: boolean;
      bypassApprovals?: boolean;
      approvalTimeoutMs?: number;
      executorModel?: string;
      plannerModel?: string;
    },
  ) {
    this.showSessionMetrics = options?.showSessionMetrics ?? false;
    this.preferredModelTier = options?.preferredModelTier ?? "default";
    this.executionContract = options?.executionContract ?? null;
    this.disabledTools = options?.disabledTools ?? new Set<ToolName>();
    this.workspaceId = options?.workspaceId ?? null;
    this.workerId = options?.workerId ?? null;
    this.taskIdRef = options?.taskId ?? null;
    this.nodeId = options?.nodeId ?? null;
    this.runId = options?.runId ?? null;
    this.correlationId = options?.correlationId ?? this.runId ?? null;
    this.suppressUiBroadcast = options?.suppressUiBroadcast ?? false;
    this.onStreamChunk = options?.onStreamChunk ?? null;
    this.disableInternalPlanning = options?.disableInternalPlanning ?? false;
    this.bypassApprovals = options?.bypassApprovals ?? false;
    this.approvalTimeoutMs = options?.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS;
    this.middleware = new AgentMiddleware({
      disabledTools: this.disabledTools,
      bypassApprovals: this.bypassApprovals,
      workspaceId: this.workspaceId,
      workerId: this.workerId,
      maxSessionMs: MAX_SESSION_MS,
    });
    const modelOverrides = {
      executorModel: options?.executorModel,
      plannerModel: options?.plannerModel,
    };
    this.llm = new LLMClient(openRouterApiKey, modelOverrides);
    if (this.preferredModelTier === "planner") {
      this.llm.switchToPlanner();
    } else if (this.preferredModelTier === "executor") {
      this.llm.switchToExecutor();
    }
    this.log.debug("policy", "Initial model tier selected", {
      preferredModelTier: this.preferredModelTier,
      model: this.llm.getCurrentModel(),
      provider: this.llm.getCurrentProvider(),
      workspaceId: this.workspaceId,
      workerId: this.workerId,
    });
    this.llm.setFailoverCallback((from, to) => {
      this.stepHandler(
        {
          id: crypto.randomUUID(),
          type: "info",
          label: `Rate limited on ${from} — switched to ${to}`,
          status: "done",
          timestamp: Date.now(),
        },
        false,
      );
    });
    this.planner = new TaskPlanner(openRouterApiKey, modelOverrides);
    this.baseContextTokens = options?.maxContextTokens ?? 32000;
    this.context = new ContextManager(
      this.baseContextTokens,
      this.workspaceId,
      this.workerId,
    );
    this.statusHandler = callbacks.onStatusUpdate;
    this.messageHandler = callbacks.onMessage;
    this.stepHandler = callbacks.onStep ?? (() => {});
    this.maxTurns = options?.maxTurns ?? AGENT_LIMITS.MAX_TURNS_DEFAULT;
  }

  /**
   * Send a message to the side panel, automatically injecting workspaceId,
   * requestId, and source. Fire-and-forget (errors are silenced).
   * Automatically attaches collected citations to STREAM_CHUNK done=true messages.
   */
  private broadcast(
    msg: Omit<RuntimeMessage, "requestId" | "source" | "workspaceId">,
  ): void {
    if (this.suppressUiBroadcast) {
      // Forward STREAM_CHUNK to callback even when UI broadcasts are suppressed
      if (msg.type === "STREAM_CHUNK" && this.onStreamChunk) {
        this.onStreamChunk(
          msg.payload.delta,
          msg.payload.done,
          msg.payload.replaceContent,
          msg.payload.thinking,
        );
      }
      return;
    }
    // Attach citations to the final stream chunk
    if (
      msg.type === "STREAM_CHUNK" &&
      msg.payload.done &&
      this.citations.length > 0
    ) {
      msg = {
        ...msg,
        payload: { ...msg.payload, citations: [...this.citations] },
      };
    }
    chrome.runtime
      .sendMessage({
        ...msg,
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        workspaceId: this.workspaceId,
      } as RuntimeMessage)
      .catch(() => {});
  }

  private broadcastPlanTermination(
    outcome: "stopped" | "max_turns" | "error",
    summary: string,
  ): void {
    if (!this.taskId || this.planSubtasks.length === 0) return;

    const subtaskResults: SubtaskResult[] = this.planSubtasks.map((st) => ({
      description: st.description,
      status:
        st.status === "completed"
          ? ("completed" as const)
          : st.status === "skipped"
            ? ("skipped" as const)
            : ("failed" as const),
      turnsUsed: st.turnsUsed,
      result: st.result || "",
    }));

    this.broadcast({
      type: "TASK_COMPLETION",
      payload: {
        taskId: this.taskId,
        status: subtaskResults.some((r) => r.status === "completed")
          ? "partial"
          : "failed",
        totalTurnsUsed: this.turnCount,
        totalTimeMs: Date.now() - this.taskStartTime,
        summary,
        subtaskResults,
        urlHistory: this.urlHistory,
        metrics: this.getMetrics(),
        terminationReason:
          outcome === "stopped"
            ? "Stopped by user"
            : outcome === "max_turns"
              ? `Turn limit reached (${this.turnCount}/${this.maxTurns})`
              : summary,
      },
    });
  }

  private async requestApproval(
    toolName: ToolName,
    args: Record<string, unknown>,
    context: string,
  ): Promise<boolean> {
    const approvalId = crypto.randomUUID();
    this.statusHandler(AgentStatus.ACTING, "Waiting for approval...");
    const approvalStep: AgentStep = {
      id: crypto.randomUUID(),
      type: "info",
      label: `Approval requested: ${context}`,
      status: "running",
      timestamp: Date.now(),
    };
    this.stepHandler(approvalStep, false);
    this.log.info("policy", "Approval request created", {
      approvalId,
      turn: this.turnCount,
      toolName,
      context,
      timeoutMs: this.approvalTimeoutMs,
      bypassApprovals: this.bypassApprovals,
      workspaceId: this.workspaceId,
      workerId: this.workerId,
    });
    this.traceRecorder?.recordEvent("approval", {
      approvalId,
      stage: "requested",
      turn: this.turnCount,
      toolName,
      context,
      timeoutMs: this.approvalTimeoutMs,
      bypassApprovals: this.bypassApprovals,
    });

    const approvalPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (
        approved: boolean,
        outcome: "approved" | "rejected" | "timeout" | "dispatch_failed",
      ) => {
        if (settled) return;
        settled = true;
        AgentLoop.approvalWaiters.delete(approvalId);
        const stepStatus = approved ? "done" : "error";
        const errorMessage =
          outcome === "timeout"
            ? "Approval timed out."
            : outcome === "dispatch_failed"
              ? "Approval request dispatch failed."
              : outcome === "rejected"
                ? "Approval rejected by user."
                : undefined;
        this.stepHandler(
          {
            ...approvalStep,
            label: approved
              ? `Approval granted: ${context}`
              : `Approval denied: ${context}`,
            status: stepStatus,
            durationMs: Date.now() - approvalStep.timestamp,
            errorMessage,
          },
          true,
        );
        this.log.info("policy", "Approval decision settled", {
          approvalId,
          turn: this.turnCount,
          toolName,
          outcome,
          approved,
          workspaceId: this.workspaceId,
          workerId: this.workerId,
        });
        this.traceRecorder?.recordEvent("approval", {
          approvalId,
          stage: "settled",
          turn: this.turnCount,
          toolName,
          outcome,
          approved,
        });
        resolve(approved);
      };

      const timer = setTimeout(() => {
        settle(false, "timeout");
      }, this.approvalTimeoutMs);

      AgentLoop.approvalWaiters.set(approvalId, (approved: boolean) => {
        clearTimeout(timer);
        settle(approved, approved ? "approved" : "rejected");
      });

      // Register waiter before emitting the request to avoid missing
      // synchronous approval responses from tests or fast UI handlers.
      chrome.runtime
        .sendMessage({
          type: "APPROVAL_REQUEST",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          workspaceId: this.workspaceId,
          payload: {
            approvalId,
            toolName,
            args,
            risk: RiskLevel.HIGH,
            context,
            timeoutMs: this.approvalTimeoutMs,
          },
        } as RuntimeMessage)
        .catch((error: any) => {
          clearTimeout(timer);
          this.log.error("policy", "Failed to dispatch approval request", {
            approvalId,
            turn: this.turnCount,
            toolName,
            error: error?.message ?? String(error),
            workspaceId: this.workspaceId,
            workerId: this.workerId,
          });
          settle(false, "dispatch_failed");
        });
    });

    return await approvalPromise;
  }

  private static readonly CLARIFICATION_TIMEOUT_MS = 120_000;

  private async requestClarification(
    question: string,
    suggestions?: string[],
  ): Promise<string> {
    const clarificationId = crypto.randomUUID();
    const timeoutMs = AgentLoop.CLARIFICATION_TIMEOUT_MS;

    this.statusHandler(AgentStatus.PAUSED, "Waiting for user clarification...");
    const clarifyStep: AgentStep = {
      id: crypto.randomUUID(),
      type: "info",
      label: `Clarification: "${question.slice(0, 80)}"`,
      status: "running",
      timestamp: Date.now(),
    };
    this.stepHandler(clarifyStep, false);

    this.log.info("agent", "Clarification requested", {
      clarificationId,
      turn: this.turnCount,
      question: question.slice(0, 200),
    });
    this.traceRecorder?.recordEvent("clarification", {
      clarificationId,
      stage: "requested",
      turn: this.turnCount,
      question,
    });

    return new Promise<string>((resolve) => {
      let settled = false;
      const settle = (answer: string, outcome: "answered" | "timeout") => {
        if (settled) return;
        settled = true;
        AgentLoop.clarificationWaiters.delete(clarificationId);
        this.stepHandler(
          {
            ...clarifyStep,
            label:
              outcome === "timeout"
                ? "Clarification timed out"
                : `Clarification answered`,
            status: outcome === "timeout" ? "error" : "done",
            durationMs: Date.now() - clarifyStep.timestamp,
          },
          true,
        );
        this.log.info("agent", "Clarification settled", {
          clarificationId,
          turn: this.turnCount,
          outcome,
        });
        this.traceRecorder?.recordEvent("clarification", {
          clarificationId,
          stage: "settled",
          turn: this.turnCount,
          outcome,
        });
        resolve(answer);
      };

      const timer = setTimeout(() => {
        settle("No response from user.", "timeout");
      }, timeoutMs);

      // Register waiter BEFORE sending message
      AgentLoop.clarificationWaiters.set(clarificationId, (answer: string) => {
        clearTimeout(timer);
        settle(answer, "answered");
      });

      chrome.runtime
        .sendMessage({
          type: "CLARIFICATION_REQUEST",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          workspaceId: this.workspaceId,
          payload: {
            clarificationId,
            question,
            suggestions,
            timeoutMs,
          },
        } as RuntimeMessage)
        .catch((error: any) => {
          clearTimeout(timer);
          this.log.error("agent", "Failed to dispatch clarification request", {
            clarificationId,
            error: error?.message ?? String(error),
          });
          settle("No response from user.", "timeout");
        });
    });
  }

  private async ensureToolApproval(
    toolName: ToolName,
    args: Record<string, unknown>,
    riskLevel: RiskLevel,
  ): Promise<boolean> {
    if (riskLevel !== RiskLevel.HIGH) return true;
    if (this.bypassApprovals) {
      const bypassContext = formatStepLabel(
        toolName,
        args,
        this.elementResolver,
      );
      this.stepHandler(
        {
          id: crypto.randomUUID(),
          type: "info",
          label: `Approval bypassed: ${bypassContext}`,
          status: "done",
          timestamp: Date.now(),
        },
        false,
      );
      this.log.warn("policy", "Approval bypass applied to high-risk tool", {
        turn: this.turnCount,
        tool: toolName,
        workspaceId: this.workspaceId,
        workerId: this.workerId,
      });
      this.traceRecorder?.recordEvent("approval", {
        stage: "bypassed",
        turn: this.turnCount,
        toolName,
      });
      return true;
    }
    const context = formatStepLabel(toolName, args, this.elementResolver);
    const approved = await this.requestApproval(toolName, args, context);
    if (!approved) {
      this.log.warn("policy", "High-risk tool denied or timed out", {
        turn: this.turnCount,
        tool: toolName,
        workspaceId: this.workspaceId,
        workerId: this.workerId,
      });
    }
    return approved;
  }

  /**
   * Starts the agent loop with a user query
   *
   * @param initialUserText - The user's request/task
   * @param tabId - Chrome tab ID to operate on
   * @param initialSnapshot - Optional initial DOM snapshot
   * @param options - Configuration options (clearHistory)
   * @returns LoopResult with outcome, turn count, summary, and metrics
   */
  public async start(
    initialUserText: string,
    tabId: number,
    initialSnapshot?: DomSnapshot,
    options?: { clearHistory?: boolean },
  ): Promise<LoopResult> {
    if (this.isRunning) {
      this.stop();
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    this.turnCount = 0;
    this.originalQuery = initialUserText;
    this.context.setOriginalQuery(initialUserText);
    this.stagnation.reset();
    this.pendingFeedback = null;
    this.taskId = null;
    this.planSubtasks = [];
    this.planSteps = [];
    this.taskStartTime = Date.now();
    this.urlHistory = [];
    this.doneRejections = 0;
    this.turnsOnCurrentStep = 0;
    this.lastPlanIndex = 0;
    this.turnsSinceLastMonitor = 0;
    this.replanCount = 0;
    this.startingOrigin = null;
    this.offDomainWarned = false;
    this.perception.reset();
    this.metrics = AgentLoop.emptyMetrics();
    this.sessionStartTime = Date.now();
    this.traceRecorder = new TraceRecorder(crypto.randomUUID());
    this.log = logger.withSessionId(this.traceRecorder.sessionId);
    this.traceRecorder.setSessionInfo(
      initialUserText,
      initialSnapshot?.url || "",
    );
    this.traceRecorder.setWorkspaceId(this.workspaceId);
    this.traceRecorder.setCorrelationContext({
      runId: this.runId,
      correlationId: this.correlationId,
      parentRunId: this.runId,
    });
    const allowedTools = this.executionContract?.allowedTools
      ? [...this.executionContract.allowedTools]
      : Object.values(ToolName).filter((tool) => !this.disabledTools.has(tool));
    this.traceRecorder.recordEvent("execution_contract", {
      role:
        this.executionContract?.role ||
        (this.workerId ? "executor" : "single_agent"),
      modelTier:
        this.executionContract?.modelTier ||
        (this.preferredModelTier === "default"
          ? this.llm.isPlannerTier()
            ? "planner"
            : "executor"
          : this.preferredModelTier),
      initialModel: this.llm.getCurrentModel(),
      allowedTools,
      workspaceId: this.workspaceId,
      workerId: this.workerId,
      nodeId: this.nodeId,
      runId: this.runId,
      correlationId: this.correlationId,
    });

    // Clear or restore context
    if (options?.clearHistory) {
      this.context.clear();
    } else {
      // Restore context from session storage to handle SW restarts
      await this.context.loadState();
    }

    // Ensure we have a snapshot — either from the orchestrator, warmup cache, or by fetching our own
    let snapshot = initialSnapshot;
    let warmupPerception: { interpretation: string; providerId?: string; durationMs: number } | null = null;
    let warmupScreenshot: string | null = null;

    if (!snapshot) {
      this.log.warn(
        "agent",
        "No initial snapshot from orchestrator, checking warmup",
        { tabId },
      );

      // Check if warmup has a cached or in-progress result for this tab
      const pending = perceptionWarmup.getPending(tabId);
      if (pending) {
        this.log.info("agent", "Awaiting perception warmup", { tabId });
        const entry = await pending;
        if (entry) {
          snapshot = entry.snapshot;
          warmupPerception = entry.perception;
          warmupScreenshot = entry.screenshotUrl;
          this.log.info("agent", "Using warmup snapshot + perception", {
            tabId,
            elementCount: snapshot.elements.length,
            provider: entry.perception.providerId,
          });
        }
      } else {
        // Check static cache (warmup may have finished already)
        const cached = perceptionWarmup.get(tabId);
        if (cached) {
          snapshot = cached.snapshot;
          warmupPerception = cached.perception;
          warmupScreenshot = cached.screenshotUrl;
          this.log.info("agent", "Using cached warmup snapshot + perception", {
            tabId,
            elementCount: snapshot.elements.length,
            ageMs: Date.now() - cached.timestamp,
          });
        }
      }

      // Still no snapshot — ensure content script is injected (handles SW restart), then fetch
      if (!snapshot) {
        this.log.warn(
          "agent",
          "No warmup available, ensuring content script and fetching snapshot",
          { tabId },
        );
        await ensureContentScript(tabId, 5000);
        const count = await this.refreshSnapshot(tabId);
        if (count >= 0) {
          snapshot = this.context.getSnapshot() ?? undefined;
          this.log.info("agent", "Fetched snapshot fallback", {
            elementCount: count,
          });
        }
      }
    }

    // Consume the warmup entry so it's not reused by a subsequent task
    perceptionWarmup.consume(tabId);

    // Save initial scroll position for restoration when the agent finishes
    let initialScrollY: number | null = null;

    if (snapshot) {
      initialScrollY = snapshot.scroll?.y ?? 0;
      this.context.setSnapshot(snapshot);
      this.elementResolver = buildElementResolver(snapshot.elements);
      // If snapshot was fetched via fallback/warmup, update trace startUrl
      if (!initialSnapshot && snapshot.url) {
        this.traceRecorder.setSessionInfo(initialUserText, snapshot.url);
      }
      // Track starting origin for off-domain navigation detection
      if (snapshot.url) {
        try {
          this.startingOrigin = new URL(snapshot.url).origin;
        } catch {
          /* */
        }
        // Record initial page as citation
        this.recordCitation(
          snapshot.url,
          snapshot.title || "",
          ToolName.READ_PAGE,
        );
      }

      if (warmupPerception) {
        // Use pre-computed perception — hydrate PerceptionAgent with warmup result
        const warmupFingerprint = computeSnapshotFingerprint(snapshot);
        this.perception.hydrateFromWarmup(
          warmupPerception.interpretation,
          warmupFingerprint,
          warmupScreenshot,
          snapshot.url,
        );
        this.context.setPageInterpretation(warmupPerception.interpretation);
        this.log.info("agent", "Perception from warmup (skipped vision API)", {
          provider: warmupPerception.providerId,
          durationMs: warmupPerception.durationMs,
        });
        // Still triage popups since it's fast and important
        await this.triagePopups(tabId);
      } else {
        // No warmup available — run perception normally
        await this.refreshPerceptionAndTriage(tabId);
      }
    } else {
      // Content script unreachable — build a minimal snapshot from tab metadata
      // so the system prompt shows the real URL instead of "about:blank"
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url && tab.url !== "about:blank") {
          const minimalSnapshot: DomSnapshot = {
            title: tab.title || "",
            url: tab.url,
            elements: [],
            viewport: { width: 0, height: 0 },
            scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 0 },
          };
          this.context.setSnapshot(minimalSnapshot);
          this.traceRecorder.setSessionInfo(initialUserText, tab.url);
          try {
            this.startingOrigin = new URL(tab.url).origin;
          } catch { /* */ }
          this.log.warn(
            "agent",
            "Using tab metadata fallback (content script unreachable)",
            { tabId, url: tab.url, title: tab.title },
          );
        } else {
          this.log.warn(
            "agent",
            "Starting without snapshot — content script unreachable",
            { tabId },
          );
        }
      } catch {
        this.log.warn(
          "agent",
          "Starting without snapshot — tab and content script unreachable",
          { tabId },
        );
      }
    }

    // 2. Add User Message
    const userContent = initialUserText;
    this.context.addMessage({
      role: "user",
      content: userContent,
    });

    // 2b. Grounding: detect instruction-vs-page contradictions on turn 1
    const currentSnapshot = this.context.getSnapshot();
    if (currentSnapshot) {
      const contradiction = detectInstructionContradiction(
        userContent,
        currentSnapshot,
      );
      if (contradiction?.mismatch) {
        this.context.setContradiction(contradiction.details);
        this.log.warn("grounding", "Instruction-page contradiction detected", {
          details: contradiction.details,
        });
      }
    }

    // --- Demo catalog + matching: inject reference demonstrations ---
    try {
      const demoStore = new DemoStore();

      // Layer 1: Load compact catalog into static prompt prefix (for prefix caching)
      const catalog = await demoStore.getCatalogSummary();
      if (catalog) {
        this.context.setDemoCatalog(catalog);
        this.log.info("agent", "Demo catalog loaded into prompt prefix", {
          lineCount: catalog.split("\n").length,
        });
      }

      // Layer 3: Auto-inject best-matching demo for this query + URL
      const currentUrl = this.context.getSnapshot()?.url || "";
      const matchedDemo = await demoStore.matchDemo(
        initialUserText,
        currentUrl,
      );
      if (matchedDemo) {
        await demoStore.recordDemoUsage(matchedDemo.demo.id);
        const demoText = formatDemoForContext(matchedDemo.demo);
        this.context.setDemonstrations(demoText);
        this.log.info("agent", "Demo matched and injected", {
          demoId: matchedDemo.demo.id,
          demoName: matchedDemo.demo.name,
          score: matchedDemo.score,
          actionCount: matchedDemo.demo.actions.length,
        });
        this.traceRecorder?.recordEvent("demo_matched" as any, {
          demoId: matchedDemo.demo.id,
          demoName: matchedDemo.demo.name,
          score: matchedDemo.score,
          actionCount: matchedDemo.demo.actions.length,
        });
      }
    } catch (err: any) {
      this.log.warn("agent", "Demo catalog/matching error (non-fatal)", {
        error: err?.message,
      });
    }

    // --- Planner: decompose task into plan (task-agnostic) ---
    if (!this.disableInternalPlanning) {
      try {
        this.stepHandler(
          {
            id: crypto.randomUUID(),
            type: "thinking",
            label: "Analyzing task scope...",
            status: "running",
            timestamp: Date.now(),
          },
          false,
        );

        const decomposition = await this.planner.decompose(
          initialUserText,
          this.context.getSnapshot()?.title || "",
          this.context.getSnapshot()?.url || "",
          this.abortController!.signal,
          this.perception.getInterpretation() ?? undefined,
        );

        if (decomposition) {
          // Apply difficulty-adaptive runtime limits
          this.difficulty = decomposition.difficulty;
          this.limits = resolveRuntimeLimits(
            decomposition.difficulty,
            decomposition.limitOverrides,
          );
          this.log.info("agent", "Difficulty assessment applied", {
            difficulty: this.difficulty,
            limits: this.limits,
            overrides: decomposition.limitOverrides ?? null,
          });
          this.traceRecorder?.setDifficultyInfo({
            difficulty: this.difficulty,
            resolvedLimits: { ...this.limits },
            plannerOverrides: decomposition.limitOverrides
              ? { ...(decomposition.limitOverrides as Record<string, number>) }
              : null,
          });
          this.traceRecorder?.setPlanDecomposition({
            subtasks: decomposition.subtasks,
            ...(decomposition.steps
              ? {
                  steps: decomposition.steps.map((s) => ({
                    objective: s.objective,
                    successCriteria: s.successCriteria,
                    dependencies: s.dependencies,
                    assumptions: s.assumptions,
                    ...(s.verifyAfter ? { verifyAfter: s.verifyAfter } : {}),
                    ...(s.toolProfile ? { toolProfile: s.toolProfile } : {}),
                    ...(s.expectedState
                      ? { expectedState: s.expectedState }
                      : {}),
                  })),
                }
              : {}),
          });

          if (decomposition.subtasks.length >= 2) {
            this.taskId = crypto.randomUUID();
            this.taskStartTime = Date.now();
            this.planSubtasks = decomposition.subtasks.map((desc, i) => ({
              description: desc,
              status: i === 0 ? ("running" as const) : ("pending" as const),
              turnsUsed: 0,
              turnBudget: 0,
            }));
            this.planSteps = decomposition.steps || [];

            // Inject plan status into system prompt (visible every turn)
            this.context.setPlanStatus(
              decomposition.subtasks.map((desc, i) => ({
                description: desc,
                status: i === 0 ? "running" : "pending",
                ...(decomposition.steps?.[i]?.verifyAfter
                  ? { verificationGate: decomposition.steps[i].verifyAfter }
                  : {}),
                ...(decomposition.steps?.[i]?.toolProfile
                  ? { toolProfile: decomposition.steps[i].toolProfile }
                  : {}),
              })),
              0,
            );

            this.context.addMessage({
              role: "user",
              content:
                `[Task Planner]: This is a multi-step task (${decomposition.subtasks.length} steps). Your plan:\n` +
                decomposition.subtasks
                  .map((s, i) => `${i + 1}. ${s}`)
                  .join("\n") +
                `\n\nExecute step 1 now. Complete each step in order and verify progress before continuing. ` +
                `If the plan fails, revise your approach and continue from the best next step. ` +
                `Call done() when all ${decomposition.subtasks.length} steps are complete.`,
            });

            this.broadcast({
              type: "TASK_PROGRESS",
              payload: {
                taskId: this.taskId,
                subtasks: this.planSubtasks,
                currentIndex: 0,
                totalTurnsUsed: 0,
              },
            });

            this.stepHandler(
              {
                id: crypto.randomUUID(),
                type: "info",
                label: `Plan: ${decomposition.subtasks.length} steps (${this.difficulty})`,
                status: "done",
                timestamp: Date.now(),
              },
              false,
            );
          }
        }
      } catch (err: any) {
        this.log.warn("agent", "Planner decompose error (non-fatal)", {
          error: err?.message,
        });
      }
    }

    this.statusHandler(AgentStatus.THINKING, "Analyzing...");

    // Register planner usage callback for metrics tracking
    this.planner.setUsageCallback((usage, llmMs, model) => {
      this.recordUsage(
        {
          role: "assistant",
          content: null,
          finish_reason: "stop",
          usage,
          actualModel: model,
        } as CompletionResponse,
        llmMs,
      );
    });

    let result: LoopResult = {
      outcome: "completed",
      turnCount: 0,
      summary: "",
      failure: { category: "none", code: "none" },
      metrics: undefined,
    };
    try {
      result = await this.loop(tabId);
    } catch (error: any) {
      if (error.name === "AbortError") {
        this.log.info("agent", "Agent stopped by user");
        this.statusHandler(AgentStatus.IDLE, "Stopped");
        result = {
          outcome: "stopped",
          turnCount: this.turnCount,
          summary: "Stopped by user",
          failure: {
            category: "user",
            code: "user_stopped",
            detail: "Stopped by user",
          },
          metrics: this.getMetrics(),
        };
      } else {
        this.log.error("agent", "Loop Error", { error });
        const errorMsg = `Agent stopped: ${error.message}. Send a follow-up message to retry.`;
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: false, replaceContent: errorMsg },
        });
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: true },
        });
        this.statusHandler(AgentStatus.ERROR, error.message);
        result = {
          outcome: "error",
          turnCount: this.turnCount,
          summary: error.message,
          failure: {
            category: "runtime",
            code: "runtime_error",
            detail: error.message,
          },
          metrics: this.getMetrics(),
        };
      }
    } finally {
      if (
        result.outcome !== "completed" &&
        this.taskId &&
        this.planSubtasks.length > 0
      ) {
        this.broadcastPlanTermination(
          result.outcome as "stopped" | "max_turns" | "error",
          result.summary,
        );
      }

      // Restore the user's original scroll position (only on successful completion —
      // on stop/error, freeze the page exactly where it is)
      if (initialScrollY !== null && result.outcome === "completed") {
        try {
          await this.scrollContentScript(tabId, initialScrollY);
        } catch {
          // Tab may have been closed or navigated — safe to ignore
        }
      }

      this.isRunning = false;
      // Finalize trace recording (fire-and-forget)
      if (this.traceRecorder) {
        this.traceRecorder.recordEvent(
          "tool_cache_stats",
          this.toolCache.getStats(),
        );
        await this.traceRecorder.finalize(
          result.outcome,
          result.summary,
          result.turnCount,
          result.failure ?? null,
          result.metrics ?? null,
        );
        this.traceRecorder = null;
      }
    }
    return result;
  }

  public stop() {
    // Resolve pause gate first so the loop can exit cleanly
    if (this.pauseGate) {
      this.pauseGate.resolve();
      this.pauseGate = null;
    }
    this.abortController?.abort();
    this.isRunning = false;
  }

  /** Queue a user hint to be picked up on the next turn */
  public injectFeedback(text: string): void {
    this.pendingFeedback = text;
  }

  /** Get the current turn number */
  public getCurrentTurn(): number {
    return this.turnCount;
  }

  /** Get the original user query that started this loop */
  public getOriginalQuery(): string {
    return this.originalQuery;
  }

  /** Get the progress tracker instance (for external queries) */
  public getStagnationMonitor(): StagnationMonitor {
    return this.stagnation;
  }

  /** Pause the agent loop — blocks at the top of the next iteration */
  public pause(): void {
    if (!this.pauseGate) {
      let resolve: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      this.pauseGate = { promise, resolve: resolve! };
      this.statusHandler(AgentStatus.PAUSED, "Paused by user");
    }
  }

  /** Resume a paused agent loop */
  public resume(): void {
    if (this.pauseGate) {
      this.pauseGate.resolve();
      this.pauseGate = null;
      this.statusHandler(AgentStatus.THINKING, "Resumed");
    }
  }

  /** Whether the loop is currently paused */
  public isPaused(): boolean {
    return this.pauseGate !== null;
  }

  /** Escalate to planner model when stuck. Distills context, then switches model via planner pool. */
  private escalateModel(): void {
    // Distill verbose history into compact situation report (unless orientation phase — no history yet)
    if (this.turnCount > 1) {
      this.context.summarizeTrajectory(this.originalQuery);
    }
    this.llm.switchToPlanner();
    this.context.setModelTier("planner");
    this.log.info("agent", "Escalating to planner model", {
      model: this.llm.getCurrentModel(),
      provider: this.llm.getCurrentProvider(),
    });
  }

  /** Get the tab IDs belonging to this agent's workspace, or null if no workspace. */
  private async getWorkspaceTabIds(): Promise<number[] | null> {
    if (!this.workspaceId || this.workspaceId === "default") return null;
    const ws = await workspaceManager.getWorkspaceById(this.workspaceId);
    return ws?.tabIds ?? null;
  }

  private shouldBlockTabManagementTools(): boolean {
    return !userExplicitlyRequestedTabManagement(this.originalQuery);
  }

  /** De-escalate back to executor model when progress resumes after automatic escalation. */
  private async deescalateModel(
    tabId?: number,
    prevElementCount?: number,
  ): Promise<number> {
    this.llm.switchToExecutor();
    this.context.setModelTier("executor");
    let newCount = prevElementCount ?? -1;
    // Refresh snapshot so executor model gets fresh element IDs
    if (tabId != null) {
      newCount = await this.refreshSnapshotWithRetry(
        tabId,
        prevElementCount ?? -1,
      );
      await this.refreshPerceptionAndTriage(tabId);
    }
    this.log.info("agent", "De-escalating to executor model", {
      model: this.llm.getCurrentModel(),
      provider: this.llm.getCurrentProvider(),
      snapshotRefreshed: tabId != null,
    });
    return newCount;
  }

  /**
   * Strategy pivot: prune failing history, inject original query + failure summary,
   * refresh DOM snapshot, and reset progress tracking. Gives the agent a fresh
   * start without changing models.
   */
  private async strategyPivot(
    tabId: number,
    precomputedSummary?: string,
  ): Promise<void> {
    // 1. Extract what was tried before clearing (use precomputed if available — history may already be distilled)
    const attemptSummary =
      precomputedSummary ?? extractAttemptSummary(this.context.getMessages());

    // 2. Clear history (keeps DOM snapshot)
    this.context.clearHistory();

    // 3. Re-inject original query
    this.context.addMessage({
      role: "user",
      content: this.originalQuery,
    });

    // 4. Inject pivot message with constraints
    this.context.addMessage({
      role: "user",
      content: PIVOT_MESSAGE(attemptSummary),
    });

    // 5. Refresh DOM snapshot + perception for current state
    await this.refreshSnapshotWithRetry(tabId, -1);
    await this.refreshPerceptionAndTriage(tabId);

    // 6. User-visible feedback
    this.stepHandler(
      {
        id: crypto.randomUUID(),
        type: "info",
        label: "Rethinking approach from scratch",
        status: "done",
        timestamp: Date.now(),
      },
      false,
    );

    this.log.info("agent", "Strategy pivot executed", {
      turn: this.turnCount,
      attemptSummaryLen: attemptSummary.length,
    });
    this.traceRecorder?.recordEvent("strategy_pivot", {
      turn: this.turnCount,
    });
  }

  /** Refresh DOM snapshot and update context. Returns element count or -1 on failure. */
  private async refreshSnapshot(tabId: number): Promise<number> {
    const sendRequest = () =>
      chrome.tabs.sendMessage(tabId, {
        type: "DOM_SNAPSHOT_REQUEST",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: { refresh: true },
      });

    try {
      const snapResponse = await sendRequest();
      if (snapResponse?.payload?.snapshot) {
        this.context.setSnapshot(snapResponse.payload.snapshot);
        this.elementResolver = buildElementResolver(
          snapResponse.payload.snapshot.elements,
        );
        return snapResponse.payload.snapshot.elements.length;
      }
    } catch (e: any) {
      // Content script disconnected — attempt reinjection once
      if (isBridgeDisconnect(e?.message || "")) {
        this.log.warn("agent", "Snapshot failed — content script disconnected, attempting reinjection", {
          turn: this.turnCount,
          tabId,
        });
        const reinjected = await reinjectContentScript(tabId);
        if (reinjected) {
          try {
            const retryResponse = await sendRequest();
            if (retryResponse?.payload?.snapshot) {
              this.context.setSnapshot(retryResponse.payload.snapshot);
              this.elementResolver = buildElementResolver(
                retryResponse.payload.snapshot.elements,
              );
              this.log.info("agent", "Snapshot recovered after reinjection", {
                turn: this.turnCount,
                elements: retryResponse.payload.snapshot.elements.length,
              });
              return retryResponse.payload.snapshot.elements.length;
            }
          } catch {
            /* reinjection succeeded but snapshot still failed */
          }
        }
      }
    }
    return -1;
  }

  /**
   * Apply tool profile filtering based on the current plan step.
   * If the running subtask has a toolProfile, only include matching tools
   * (plus always keep done and escalate).
   */
  private applyToolProfile(tools: ToolDefinition[]): ToolDefinition[] {
    const planStatus = this.context.getPlanStatusRaw();
    if (!planStatus) return tools;

    const currentSubtask = planStatus.subtasks.find(
      (s) => s.status === "running",
    );
    if (!currentSubtask?.toolProfile) return tools;

    const allowedNames = resolveToolProfile(
      currentSubtask.toolProfile as ToolProfile,
    );
    if (!allowedNames) return tools; // "full" or unknown → no filtering

    const allowedSet = new Set<string>(allowedNames);
    // Always ensure done, escalate, clarify, and update_notes are available
    allowedSet.add(ToolName.DONE);
    allowedSet.add(ToolName.ESCALATE);
    allowedSet.add(ToolName.CLARIFY);
    allowedSet.add(ToolName.UPDATE_NOTES);

    return tools.filter((t) => allowedSet.has(t.function.name));
  }

  /**
   * Send a scroll-to-position message to the content script and return
   * the actual scroll Y after the browser settles.
   */
  private async scrollContentScript(tabId: number, y: number): Promise<number> {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "SCROLL_TO_POSITION",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: { y },
    });
    return response?.payload?.actualY ?? y;
  }

  /**
   * Capture additional viewport screenshots at different scroll positions
   * for first-turn panoramic perception. Returns empty array for short pages.
   * @param primaryScrollY — If the primary screenshot was taken after an orientation
   *   scroll (e.g., to y=0), pass that value so we skip duplicate positions.
   */
  private async capturePanoramicScreenshots(
    tabId: number,
    primaryScrollY?: number,
    restoreY?: number,
  ): Promise<PanoramicShot[]> {
    const snapshot = this.context.getSnapshot();
    if (!snapshot) return [];

    const maxY = snapshot.scroll?.maxY ?? 0;
    const viewportH = snapshot.scroll?.viewportHeight ?? snapshot.viewport?.height ?? 720;

    // Short pages (< 1.5 viewports): no panoramic needed
    if (maxY < viewportH * 0.5) return [];

    const originalY = restoreY ?? snapshot.scroll?.y ?? 0;
    // Use primaryScrollY for filtering if the primary shot was taken at a different position
    const primaryY = primaryScrollY ?? originalY;
    const shots: PanoramicShot[] = [];

    // Calculate positions: top, middle, bottom
    const positions: Array<{ y: number; label: string }> = [
      { y: 0, label: "top" },
    ];
    if (maxY > viewportH * 1.5) {
      positions.push({ y: Math.floor(maxY / 2), label: "middle" });
    }
    positions.push({ y: maxY, label: "bottom" });

    // Filter out positions close to primary screenshot (already captured)
    const filteredPositions = positions.filter(
      (p) => Math.abs(p.y - primaryY) > viewportH * 0.3,
    );

    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) return shots; // Tab not visible — skip panoramic capture
    for (const pos of filteredPositions) {
      if (this.abortController?.signal.aborted) break;
      await this.scrollContentScript(tabId, pos.y);
      // Brief settle time for rendering
      await new Promise((r) => setTimeout(r, 150));
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "jpeg",
        quality: 50, // Lower quality for context shots
      });
      shots.push({ dataUrl, scrollY: pos.y, label: pos.label });
    }

    // Restore original scroll position
    await this.scrollContentScript(tabId, originalY);
    return shots;
  }

  /**
   * Refresh perception: take a screenshot and send to the PerceptionAgent
   * for structured page interpretation. The agent handles fingerprint caching,
   * near-empty DOM fallback, and observation history internally.
   */
  private async refreshPerception(tabId: number): Promise<void> {
    const snapshot = this.context.getSnapshot();
    if (!snapshot) return;

    const fingerprint = computeSnapshotFingerprint(snapshot);

    try {
      // Take screenshot (unless near-empty — agent handles fallback)
      let dataUrl: string | undefined;
      if (snapshot.elements.length > 3) {
        // Orientation scan: on first perception, scroll to top so the primary
        // screenshot shows the page beginning (defeats auto-scroll tricks).
        let primaryScrollY: number | undefined;
        const isFirstPerception = !this.perception.panoramicDone;
        if (isFirstPerception && (snapshot.scroll?.y ?? 0) > 0) {
          await this.scrollContentScript(tabId, 0);
          await new Promise((r) => setTimeout(r, 150));
          primaryScrollY = 0;
        }

        // Only capture if the agent's tab is the visible one — otherwise
        // captureVisibleTab returns the wrong page or a black frame.
        const tab = await chrome.tabs.get(tabId);
        if (tab.active) {
          dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: "jpeg",
            quality: 70,
          });
          this.perception.setScreenshotUrl(dataUrl);
        }

        // No screenshot available (tab not active) — use element-only fallback
        // instead of calling VLM with an invalid image URL.
        if (!dataUrl) {
          if (isFirstPerception) {
            this.perception.markPanoramicDone();
          }
          const result = await this.perception.observe(
            {
              screenshotDataUrl: "",
              elements: snapshot.elements,
              url: snapshot.url,
              title: snapshot.title,
              scroll: snapshot.scroll,
              skeleton: snapshot.skeleton,
              lang: snapshot.lang,
            },
            fingerprint,
            this.abortController?.signal,
            this.lastToolNameForPerception,
          );
          this.context.setPageInterpretation(result.interpretation);
          const elSummary = buildElementSummary(snapshot.elements, snapshot.skeleton);
          await this.traceRecorder?.recordPerception(result, undefined, elSummary);
          this.log.info(
            "agent",
            "Perception: tab not active, using element-only mode",
            { tabId, url: snapshot.url },
          );
        } else {
          // First-turn panoramic: capture additional viewports for page-level context
          let panoramicScreenshots: PanoramicShot[] | undefined;
          if (isFirstPerception) {
            this.perception.markPanoramicDone();
            panoramicScreenshots = await this.capturePanoramicScreenshots(
              tabId,
              primaryScrollY,
              // If we scrolled for orientation, restore to that position (not original)
              primaryScrollY,
            );
            if (panoramicScreenshots.length > 0) {
              this.log.info(
                "agent",
                "Panoramic perception: captured additional viewports",
                {
                  count: panoramicScreenshots.length,
                  labels: panoramicScreenshots.map((s) => s.label),
                },
              );
            } else {
              panoramicScreenshots = undefined;
            }
          }

          // If we scrolled for orientation, tell the VLM the primary screenshot is from y=0
          const scrollOverride =
            primaryScrollY !== undefined
              ? { ...snapshot.scroll, y: primaryScrollY }
              : snapshot.scroll;

          const result = await this.perception.observe(
            {
              screenshotDataUrl: dataUrl,
              panoramicScreenshots,
              elements: snapshot.elements,
              url: snapshot.url,
              title: snapshot.title,
              scroll: scrollOverride,
              skeleton: snapshot.skeleton,
              lang: snapshot.lang,
            },
            fingerprint,
            this.abortController?.signal,
            this.lastToolNameForPerception,
          );

          this.context.setPageInterpretation(result.interpretation);
          const elSummary = buildElementSummary(snapshot.elements, snapshot.skeleton);
          await this.traceRecorder?.recordPerception(result, dataUrl, elSummary);

          // Track usage for non-cached calls
          if (result.usage && !result.cached) {
            this.recordVisionUsage(result.usage, result.durationMs, result.model);
          }
        }
      } else {
        // Near-empty DOM: let agent handle fallback
        const result = await this.perception.observe(
          {
            screenshotDataUrl: "",
            elements: snapshot.elements,
            url: snapshot.url,
            title: snapshot.title,
            scroll: snapshot.scroll,
            skeleton: snapshot.skeleton,
            lang: snapshot.lang,
          },
          fingerprint,
          this.abortController?.signal,
          this.lastToolNameForPerception,
        );

        this.context.setPageInterpretation(result.interpretation);
        const elSummary = buildElementSummary(snapshot.elements);
        await this.traceRecorder?.recordPerception(result, undefined, elSummary);
        this.log.info(
          "agent",
          "Perception: near-empty DOM, skipping vision model",
          {
            elementCount: snapshot.elements.length,
            url: snapshot.url,
          },
        );
      }
    } catch (e: any) {
      this.log.warn("agent", "Perception failed, using element-only mode", {
        error: e?.message,
      });
      this.perception.setScreenshotUrl(null);
      this.context.setPageInterpretation(null);
    }
  }

  /**
   * Perception-guided popup triage: parse BLOCKERS from perception output,
   * auto-click dismiss buttons for nuisance popups (cookie/consent/promo/etc),
   * and re-snapshot so the LLM sees a clean page.
   */
  private async triagePopups(tabId: number): Promise<number> {
    const interpretation = this.perception.getInterpretation();
    if (!interpretation) return 0;
    if (this.abortController?.signal.aborted) return 0;

    const blockers = parseNuisanceBlockers(interpretation);
    if (blockers.length === 0) return 0;

    // Cap at 3 dismiss attempts per cycle to prevent infinite loops
    const targets = blockers.slice(0, 3);
    let dismissed = 0;

    for (const b of targets) {
      if (this.abortController?.signal.aborted) break;

      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          type: "TOOL_EXECUTE",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          payload: {
            toolName: ToolName.CLICK_ELEMENT,
            args: { id: b.dismissTagId },
            toolCallId: "popup-triage",
          },
        });
        if (
          response?.payload?.result &&
          !response.payload.result.startsWith("Error")
        ) {
          dismissed++;
        }
      } catch {
        // Non-critical — popup may already be gone
      }

      // Wait for DOM to settle after dismiss (event-driven, not arbitrary sleep)
      if (dismissed > 0) {
        await waitForDomReady(tabId, { timeoutMs: 200 });
      }
    }

    if (dismissed > 0) {
      // Re-snapshot to get clean DOM state
      await this.refreshSnapshot(tabId);
      // Invalidate perception fingerprint so next perception re-interprets
      this.perception.invalidateCache();
      // Record what was dismissed for LLM context
      this.context.addTriagedPopups(
        targets.slice(0, dismissed).map((b) => b.description),
      );

      this.log.info("agent", `Auto-dismissed ${dismissed} nuisance popup(s)`, {
        blockers: targets.map((b) => `[${b.dismissTagId}] ${b.description}`),
      });
    }

    return dismissed;
  }

  /**
   * Refresh perception then auto-dismiss nuisance popups identified in BLOCKERS.
   * Use this instead of bare `refreshPerception()` at all call sites.
   */
  private async refreshPerceptionAndTriage(tabId: number): Promise<void> {
    await this.refreshPerception(tabId);
    await this.triagePopups(tabId);
  }

  /**
   * Run plan monitor: compare current perception against expected state for the active step.
   * Only runs when a plan is active, perception is available, and enough turns have passed.
   */
  private async runPlanMonitor(
    signal?: AbortSignal,
  ): Promise<PlanMonitorResult | null> {
    if (this.planSteps.length === 0 || !this.perception.getInterpretation()) return null;

    // Find the currently running step
    const runningIdx = this.planSubtasks.findIndex(
      (s) => s.status === "running",
    );
    if (runningIdx < 0 || runningIdx >= this.planSteps.length) return null;

    const step = this.planSteps[runningIdx];
    if (!step.expectedState) return null;

    const pageUrl = this.context.getSnapshot()?.url || "";
    const result = await this.planner.monitorStep(
      step,
      runningIdx,
      this.perception.getInterpretation()!,
      pageUrl,
      signal,
    );

    if (result) {
      this.traceRecorder?.recordEvent("plan_monitor", {
        stepIndex: runningIdx,
        alignment: result.alignment,
        reason: result.reason,
        heuristicHit: !result.reason.includes("LLM"),
        ...(result.blocker ? { blocker: result.blocker } : {}),
      });
      this.log.info("agent", "Plan monitor check", {
        stepIndex: runningIdx,
        alignment: result.alignment,
        reason: result.reason.slice(0, 150),
      });
    }

    return result;
  }

  /**
   * Handle plan deviation: invoke selective replan and update plan state.
   */
  private async handlePlanDeviation(
    monitorResult: PlanMonitorResult,
    tabId: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.replanCount >= 3) {
      this.log.warn("agent", "Plan deviation detected but replan cap reached", {
        replanCount: this.replanCount,
      });
      return;
    }

    const perception = this.perception.getInterpretation() || "";
    const pageUrl = this.context.getSnapshot()?.url || "";

    // Build completed steps summary
    const completedSteps = this.planSubtasks
      .map((s, i) => ({ index: i, objective: s.description, result: s.result }))
      .filter((s) => this.planSubtasks[s.index].status === "completed");

    const runningIdx = this.planSubtasks.findIndex(
      (s) => s.status === "running",
    );
    if (runningIdx < 0) return;

    const failedStep = {
      index: runningIdx,
      objective: this.planSubtasks[runningIdx].description,
    };

    this.stepHandler(
      {
        id: crypto.randomUUID(),
        type: "thinking",
        label: "Replanning from deviation...",
        status: "running",
        timestamp: Date.now(),
      },
      false,
    );

    const replanResult = await this.planner.replanFrom(
      this.originalQuery,
      completedSteps,
      failedStep,
      perception,
      pageUrl,
      signal,
    );

    if (!replanResult || replanResult.newSteps.length === 0) {
      this.log.warn("agent", "Replan produced no new steps");
      return;
    }

    this.replanCount++;

    // Replace steps from deviation point onward
    const keptSubtasks = this.planSubtasks.slice(0, runningIdx);
    const newSubtasks: SubtaskSummary[] = replanResult.newSteps.map(
      (step, i) => ({
        description: step.objective,
        status: i === 0 ? ("running" as const) : ("pending" as const),
        turnsUsed: 0,
        turnBudget: 0,
      }),
    );

    this.planSubtasks = [...keptSubtasks, ...newSubtasks];
    this.planSteps = [
      ...this.planSteps.slice(0, runningIdx),
      ...replanResult.newSteps,
    ];

    // Update context with new plan
    this.context.setPlanStatus(
      this.planSubtasks.map((s, idx) => ({
        description: s.description,
        status: s.status,
        completedAtUrl: s.completedAtUrl,
        result: s.result,
        ...(this.planSteps[idx]?.verifyAfter
          ? { verificationGate: this.planSteps[idx].verifyAfter }
          : {}),
        ...(this.planSteps[idx]?.toolProfile
          ? { toolProfile: this.planSteps[idx].toolProfile }
          : {}),
      })),
      runningIdx,
    );

    // Inject plan monitor message into conversation
    this.context.addMessage({
      role: "user",
      content:
        `[Plan Monitor]: Plan deviated at step ${runningIdx + 1}. Reason: ${monitorResult.reason}\n` +
        `Replanned from step ${runningIdx + 1}:\n` +
        replanResult.newSteps
          .map((s, i) => `${runningIdx + i + 1}. ${s.objective}`)
          .join("\n") +
        `\n\nExecute step ${runningIdx + 1} now.`,
    });

    // Broadcast updated progress
    this.broadcast({
      type: "TASK_PROGRESS",
      payload: {
        taskId: this.taskId!,
        subtasks: this.planSubtasks,
        currentIndex: runningIdx,
        totalTurnsUsed: this.turnCount,
      },
    });

    this.traceRecorder?.recordEvent("plan_replan", {
      fromIndex: runningIdx,
      newStepCount: replanResult.newSteps.length,
      reason: replanResult.reason,
      replanNumber: this.replanCount,
    });

    this.stepHandler(
      {
        id: crypto.randomUUID(),
        type: "info",
        label: `Plan repaired (${replanResult.newSteps.length} new steps)`,
        status: "done",
        timestamp: Date.now(),
      },
      false,
    );

    this.log.info("agent", "Plan repaired after deviation", {
      fromIndex: runningIdx,
      newStepCount: replanResult.newSteps.length,
      replanCount: this.replanCount,
      reason: replanResult.reason.slice(0, 200),
    });
  }

  /** Refresh snapshot with retry — used after model escalation where fresh context is critical. */
  private async refreshSnapshotWithRetry(
    tabId: number,
    prevCount: number,
  ): Promise<number> {
    let count = await this.refreshSnapshot(tabId);
    if (count >= 0) return count;
    // Retry once after DOM readiness probe (replaces fixed 300ms sleep)
    await waitForDomReady(tabId, { timeoutMs: 300, waitForElements: true });
    count = await this.refreshSnapshot(tabId);
    if (count >= 0) return count;
    return prevCount; // Keep existing count if both attempts fail
  }

  /** Execute a tool call via the tool registry. */
  private async executeToolCall(
    toolCall: ToolCall,
    tabId: number,
  ): Promise<string> {
    return await toolRegistry.execute(
      toolCall,
      tabId,
      this.abortController!.signal,
    );
  }

  /** Stream a message to side panel and break the loop (for circuit breaker exits) */
  private circuitBreakerExit(message: string): void {
    this.broadcast({
      type: "STREAM_CHUNK",
      payload: { delta: message, done: false },
    });
    this.broadcast({
      type: "STREAM_CHUNK",
      payload: { delta: "", done: true },
    });
    this.statusHandler(
      AgentStatus.IDLE,
      "Circuit breaker — send a follow-up to continue",
    );
  }

  /**
   * Walk planSubtasks and mark early steps as completed based on
   * planner rejection (which implies the agent has progressed past them).
   * Returns the new currentIndex (first non-completed step).
   */
  private advanceCompletedSubtasks(): number {
    let advancedTo = 0;
    for (let i = 0; i < this.planSubtasks.length; i++) {
      const s = this.planSubtasks[i];
      if (s.status === "completed") {
        advancedTo = i + 1;
        continue;
      }
      if (s.status === "running") {
        // If planner rejected done(), the current "running" step
        // might be done. Mark it completed with a captured result.
        s.status = "completed";
        s.result = s.result || this.captureSubtaskResult();
        s.completedAtUrl = this.context.getCurrentUrl() || undefined;
        advancedTo = i + 1;
        continue;
      }
      break;
    }
    // Mark the next step as running
    if (advancedTo < this.planSubtasks.length) {
      this.planSubtasks[advancedTo].status = "running";
    }
    // Plan-aware cache invalidation: force fresh perception on step advancement
    if (advancedTo !== this.lastPlanIndex) {
      this.lastPlanIndex = advancedTo;
      this.perception.invalidateCache();
      this.turnsOnCurrentStep = 0;
    }
    return advancedTo;
  }

  /**
   * Walk backward through history to capture the most recent tool result
   * as a subtask result string.
   */
  private captureSubtaskResult(): string {
    const history = this.context.getMessages();
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (
        msg.role === "tool" &&
        typeof msg.content === "string" &&
        msg.content.length > 0
      ) {
        return msg.content.slice(0, 200);
      }
    }
    return "Completed";
  }

  /**
   * Check whether a navigate() target URL matches a completed plan step's URL.
   * Compares origin + pathname only (ignores query params and hash).
   * Returns a block message if matched, or null to allow navigation.
   */
  private checkNavigateGuard(targetUrl: string): string | null {
    if (this.planSubtasks.length === 0) return null;

    const completedWithUrls = this.planSubtasks
      .map((s, i) => ({ ...s, index: i }))
      .filter((s) => s.status === "completed" && s.completedAtUrl);

    if (completedWithUrls.length === 0) return null;

    let targetOriginPath: string;
    try {
      const u = new URL(targetUrl);
      targetOriginPath = u.origin + u.pathname;
    } catch {
      return null; // Unparseable URL — let it through
    }

    for (const step of completedWithUrls) {
      try {
        const u = new URL(step.completedAtUrl!);
        const stepOriginPath = u.origin + u.pathname;
        if (targetOriginPath === stepOriginPath) {
          return (
            `BLOCKED: Cannot navigate to "${targetUrl}" — matches completed step ${step.index + 1} ("${step.description}").\n` +
            `Navigating back would undo progress. Continue with the current step.\n` +
            `If re-visiting is genuinely needed, revise your plan first.`
          );
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async loop(initialTabId: number): Promise<LoopResult> {
    let tabId = initialTabId;
    let prevElementCount = -1; // Track element count for empty-page retry
    let consecutiveTextOnly = 0;
    let totalTextOnly = 0;
    let doneSummary = "";
    let wasStuck = false; // Track stuck state for "resolved" signal

    // Two-tier escalation: 0=executor, 1=planner
    // plan-then-act: start at tier 1 (planner) for orientation, then hand off to tier 0 (executor)
    // Exception: when orchestrator sets preferredModelTier="executor", skip orientation entirely
    let escalationTier: number;
    let orientationPhase: boolean;
    if (this.preferredModelTier === "executor") {
      escalationTier = 0;
      orientationPhase = false;
    } else {
      escalationTier = 1;
      this.escalateModel(); // Start with planner model (plan phase)
      orientationPhase = true; // true during initial planner model orientation
    }
    let escalationCycles = 0;
    let cooldownRemaining = 0;
    let plannerModelStartTurn = 0; // turn when auto-escalation fired
    let consecutiveProgressSignals = 0; // progress gate for de-escalation
    let freshStartCount = 0; // S3: fresh-start recovery counter

    // Complexity-adaptive orientation: extend planner phase when investigation tools are used
    let effectiveOrientationTurns = ORIENTATION.PHASE_TURNS;
    const orientationToolsUsed = new Set<string>();

    // Circuit breaker: consecutive all-fail turns
    let consecutiveAllFailTurns = 0;

    // Circuit breaker: same-tool repeat failure
    const toolFailCounts = new Map<string, number>();

    // Redundant action detection: sliding window of recent successful tool calls
    const recentSuccesses: RecentAction[] = [];

    // Failed action memory: prevents exact repeats of failed tool calls
    const blockedActions: BlockedAction[] = [];
    let turnsSinceStepEscalation = -1; // -1 = no step escalation active

    // Exploration budget: nudge after N consecutive exploration-only turns
    let consecutiveExplorationTurns = 0;

    // Outcome-based dead-end detection: sliding window of normalized tool result fingerprints
    // Each entry pairs the outcome fingerprint with the page snapshot fingerprint
    const recentOutcomes: { fingerprint: string; snapshotFp: string }[] = [];

    // Cumulative failure brief: tracks tool attempts for failure synthesis
    const subgoalAttempts: SubgoalAttempt[] = [];

    while (this.isRunning && this.turnCount < this.maxTurns) {
      // Pause gate — block here if user paused the loop
      if (this.pauseGate) await this.pauseGate.promise;
      if (!this.isRunning) {
        // Finalize the stream so the side panel exits isStreaming state
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: true },
        });
        break;
      }

      this.turnCount++;
      this.turnsOnCurrentStep++;

      // Per-turn hallucination detection state (reset each turn)
      let hallucinationDetected = false;
      let streamedTextAccumulator = "";

      if (
        this.middleware.shouldHaltTurn(
          this.turnCount,
          this.maxTurns,
          this.sessionStartTime,
        )
      ) {
        const haltMessage =
          "Stopped by policy middleware due to session budget limits.";
        this.log.warn("policy", "Halting loop turn", {
          turn: this.turnCount,
          workspaceId: this.workspaceId,
          workerId: this.workerId,
        });
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: haltMessage, done: false },
        });
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: true },
        });
        this.statusHandler(AgentStatus.IDLE, "Stopped by middleware policy");
        break;
      }

      // Decrement de-escalation cooldown
      if (cooldownRemaining > 0) cooldownRemaining--;

      // plan-then-act handoff: planner model has oriented, hand off to executor model
      // Complexity-adaptive: extend orientation when investigation tools are used
      if (
        orientationPhase &&
        escalationTier === 1 &&
        orientationToolsUsed.size > 0 &&
        effectiveOrientationTurns === ORIENTATION.PHASE_TURNS
      ) {
        effectiveOrientationTurns = Math.min(
          ORIENTATION.PHASE_TURNS + INVESTIGATION_EXTENSION,
          MAX_ORIENTATION_TURNS,
        );
        this.log.info(
          "agent",
          "Investigation detected, extending orientation",
          {
            turn: this.turnCount,
            tools: [...orientationToolsUsed],
            effectiveOrientationTurns,
          },
        );
      }
      if (
        orientationPhase &&
        this.turnCount > effectiveOrientationTurns &&
        escalationTier === 1
      ) {
        orientationPhase = false;
        prevElementCount = await this.deescalateModel(tabId, prevElementCount);
        escalationTier = 0;
        cooldownRemaining = this.limits.escalationCooldown;
        const briefing = buildHandoffBriefing(
          this.context.getMessages(),
          this.context.getSnapshot(),
        );
        this.context.addMessage({
          role: "user",
          content: HANDOFF_REFLECTION(briefing),
        });
        this.stepHandler(
          {
            id: crypto.randomUUID(),
            type: "info",
            label: "Handing off to executor model",
            status: "done",
            timestamp: Date.now(),
          },
          false,
        );
        this.log.info("agent", "plan-then-act handoff", {
          turn: this.turnCount,
          orientationTurns: effectiveOrientationTurns,
        });
      }

      // Inject pending hint from user before LLM call
      if (this.pendingFeedback) {
        this.traceRecorder?.recordEvent("feedback", {
          text: this.pendingFeedback,
        });
        this.context.addMessage({
          role: "user",
          content: `[User feedback]: ${this.pendingFeedback}`,
        });
        this.pendingFeedback = null;
      }

      // Broadcast turn progress to side panel (throttled)
      if (
        this.turnCount === 1 ||
        this.turnCount % BROADCAST_INTERVALS.TURN_PROGRESS === 0
      ) {
        this.broadcast({
          type: "AGENT_TURN",
          payload: {
            turn: this.turnCount,
            maxTurns: this.maxTurns,
            provider: this.llm.getActiveProviderInfo().providerId,
          },
        });
      }

      // Set time context for turn budget indicator
      this.context.setTimeContext(this.turnCount, this.maxTurns, this.sessionStartTime);

      // 1. LLM Inference (streamed)
      const messages = this.context.getPrompt();
      const allTools = toolRegistry.getDefinitions(this.disabledTools);
      // Apply tool profile filtering for current plan step
      const tools = this.applyToolProfile(allTools);

      // Log context metrics for telemetry (reuse already-computed prompt)
      const metrics = this.context.getPromptMetricsFrom(messages);
      if (prevElementCount < 0) prevElementCount = metrics.elementCount;
      this.log.info("agent", "Context metrics", {
        turn: this.turnCount,
        systemTokens: metrics.systemTokens,
        historyTokens: metrics.historyTokens,
        totalTokens: metrics.totalTokens,
        utilization: Math.round(metrics.utilization * 100) + "%",
        elements: metrics.elementCount,
        compression: metrics.compressionLevel,
        toolCount: tools.length,
      });

      // Trace: start turn recording
      if (this.traceRecorder) {
        const snap = this.context.getSnapshot();

        // Compute context metrics for trace
        const systemContent =
          messages.length > 0 && messages[0].role === "system"
            ? typeof messages[0].content === "string"
              ? messages[0].content
              : ""
            : "";
        const cachedPrefixLength = systemContent.indexOf("## Page Context");
        const droppedMessageCount = Math.max(
          0,
          this.context.getHistoryLength() - (messages.length - 1),
        );

        this.traceRecorder.startTurn(
          this.turnCount,
          {
            url: snap?.url || "",
            title: snap?.title || "",
            elementCount: metrics.elementCount,
            visibleContentLength: snap?.visibleContent?.length || 0,
            pageContentLength: snap?.pageContent?.length || 0,
            scrollY: snap?.scroll?.y || 0,
          },
          snap?.elements || [],
          metrics.systemTokens + metrics.historyTokens,
          tools.length,
          this.llm.getCurrentModel(),
          metrics.compressionLevel,
          TraceRecorder.toTraceMessages(messages),
          {
            systemTokens: metrics.systemTokens,
            historyTokens: metrics.historyTokens,
            totalTokens: metrics.totalTokens,
            maxTokens: metrics.maxTokens,
            utilization: metrics.utilization,
            droppedMessageCount,
            compressionLevel: metrics.compressionLevel,
            cachedPrefixLength:
              cachedPrefixLength >= 0 ? cachedPrefixLength : 0,
          },
          this.llm.isPlannerTier() ? "planner" : "executor",
        );

        // Record initial perception on T1 (retroactive — perception ran before first startTurn)
        if (this.turnCount === 1 && this.perception.getInterpretation()) {
          const elSummary = snap
            ? buildElementSummary(snap.elements)
            : undefined;
          await this.traceRecorder.recordPerception(
            {
              interpretation: this.perception.getInterpretation()!,
              model: "google/gemini-2.5-flash",
              durationMs: 0,
              cached: false,
            },
            this.perception.getLastScreenshot() || undefined,
            elSummary,
          );
        }
      }

      const thinkingStepId = crypto.randomUUID();
      const thinkingStep: AgentStep = {
        id: thinkingStepId,
        type: "thinking",
        label: this.turnCount === 1 ? "Understanding request" : "Thinking...",
        status: "running",
        timestamp: Date.now(),
      };
      this.stepHandler(thinkingStep, false);

      // Per-turn AbortController: allows aborting just this turn (e.g. on hallucination)
      // while keeping the main loop alive
      const turnAbortController = new AbortController();
      const onMainAbort = () => turnAbortController.abort();
      this.abortController!.signal.addEventListener("abort", onMainAbort);

      // Always stream deltas to side panel, with hallucination detection
      const onTextDelta = (delta: string) => {
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta, done: false },
        });
        // Accumulate streamed text for hallucination detection
        streamedTextAccumulator += delta;
        if (
          !hallucinationDetected &&
          streamedTextAccumulator.length > 150 &&
          isHallucinatedToolCall(streamedTextAccumulator)
        ) {
          hallucinationDetected = true;
          this.log.warn(
            "agent",
            "Hallucinated tool call detected, aborting stream",
            {
              turn: this.turnCount,
              textLen: streamedTextAccumulator.length,
            },
          );
          turnAbortController.abort();
        }
      };

      const llmStart = Date.now();
      let response: CompletionResponse;
      try {
        response = await this.llm.completeStream(
          {
            messages,
            tools,
            max_tokens: LLM_CONFIG.MAX_TOKENS,
            stop: ["Observation:"], // ReAct pattern stop token just in case
            signal: turnAbortController.signal,
          },
          onTextDelta,
        );
      } catch (llmError: any) {
        // Hallucination abort: synthesize a response from accumulated text
        if (hallucinationDetected && llmError.name === "AbortError") {
          this.traceRecorder?.recordEvent("hallucination_detected", {
            turn: this.turnCount,
            textLen: streamedTextAccumulator.length,
          });
          // Clear the hallucinated garbage from the chat stream
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: false, replaceContent: "" },
          });
          response = {
            role: "assistant",
            content: streamedTextAccumulator,
            tool_calls: undefined,
            finish_reason: "stop",
          };
        } else if (llmError.name === "AbortError") {
          throw llmError;
        } else if ((llmError as any).status === 402) {
          const msg = "Your OpenRouter account has insufficient credits. " +
            "Please add credits at openrouter.ai/credits and try again.";
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: msg, done: false },
          });
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: true },
          });
          this.statusHandler(AgentStatus.ERROR, "Insufficient credits");
          return {
            outcome: "error" as const,
            turnCount: this.turnCount,
            summary: "Insufficient OpenRouter credits",
            failure: {
              category: "provider" as const,
              code: "credits_exhausted",
              detail: "HTTP 402 from OpenRouter",
            },
            metrics: this.getMetrics(),
          };
        }
        throw llmError;
      } finally {
        // Always clean up the main abort listener — prevents leak on all paths
        // (success, hallucination recovery, 402 return, and re-thrown errors)
        this.abortController?.signal.removeEventListener("abort", onMainAbort);
      }
      const llmMs = Date.now() - llmStart;

      // Accumulate token usage and broadcast metrics
      this.recordUsage(response, llmMs);
      this.broadcastMetrics();

      // Trace: record LLM response
      if (this.traceRecorder) {
        this.traceRecorder.recordLLMResponse(
          response.content,
          response.tool_calls || [],
          response.finish_reason,
          response.usage ?? null,
          llmMs,
          response.actualProviderId,
          response.actualModel,
        );
      }

      // Derive clean content (no <think> blocks) for logging and logic,
      // but keep raw content (with think blocks) in history for M2.5 reasoning chain continuity.
      const rawContent = response.content;
      let cleanContent = rawContent ? stripThinkTags(rawContent) || null : null;

      // Extract thinking content and broadcast to UI before any done:true
      const thinkingContent = rawContent
        ? extractThinkContent(rawContent)
        : null;
      if (thinkingContent) {
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: false, thinking: thinkingContent },
        });
      }

      // Log LLM response summary for debugging
      const toolSummary =
        response.tool_calls?.map((tc) => {
          let argSnippet = "";
          try {
            argSnippet = tc.function.arguments.slice(
              0,
              STRING_LIMITS.TOOL_CALL_SNIPPET,
            );
          } catch {
            /* */
          }
          return `${tc.function.name}(${argSnippet})`;
        }) ?? [];
      this.log.info("agent", "LLM response", {
        turn: this.turnCount,
        llmMs,
        url: this.context.getCurrentUrl(),
        text: cleanContent?.slice(0, STRING_LIMITS.REASONING_LOG) || null,
        toolCalls: toolSummary,
        toolCount: toolSummary.length,
      });

      // Full reasoning at DEBUG level (untruncated for performance analysis)
      if (cleanContent) {
        this.log.debug("agent", "LLM reasoning (full)", {
          turn: this.turnCount,
          text: cleanContent,
        });
      }

      // Grounding: mark first turn done so the observe-first prompt is only injected once
      if (this.context.getIsFirstTurn()) {
        this.context.setFirstTurnDone();
      }

      // Recover tool calls from text output (models sometimes emit JSON as text)
      if (
        (!response.tool_calls || response.tool_calls.length === 0) &&
        cleanContent
      ) {
        const recovered = recoverToolCallsFromText(cleanContent);
        if (recovered && recovered.length > 0) {
          this.log.info("agent", "Recovered tool calls from text", {
            turn: this.turnCount,
            count: recovered.length,
            tools: recovered.map((tc) => tc.function.name),
          });
          response.tool_calls = recovered;
          // Clear text content — it was tool-call JSON, not real narration.
          // Leaving it causes 422 errors: providers reject assistant messages
          // with both non-null content and tool_calls.
          response.content = null;
          cleanContent = null;
          // Retract the raw JSON that was already streamed to chat.
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: false, replaceContent: "" },
          });
        }
      }

      const llmIntention =
        cleanContent?.slice(0, STRING_LIMITS.REASONING_LOG) || null;

      // 2. Add Assistant Message to History
      // For tool_calls path, deferred until after safety gate + batch cap
      // so tool_calls in history match actual results (prevents 422 on next turn).
      if (!response.tool_calls || response.tool_calls.length === 0) {
        this.context.addMessage({
          role: "assistant",
          content: response.content,
        });
      }

      // Mark thinking step as done
      this.stepHandler(
        {
          ...thinkingStep,
          status: "done",
          durationMs: Date.now() - thinkingStep.timestamp,
        },
        true,
      );

      // 3. Handle Response
      if (response.tool_calls && response.tool_calls.length > 0) {
        // ACTION REQUIRED
        consecutiveTextOnly = 0;
        const firstToolName = response.tool_calls[0].function.name;
        this.statusHandler(AgentStatus.ACTING, `Executing ${firstToolName}...`);

        // Keep the streaming message open across tool-calling turns.
        // The stream is finalized when done() is called (with replaceContent)
        // or when the loop exits (by the orchestrator or exit-path handlers).

        // Execute Tools
        let doneSignaled = false;
        let domModified = false;
        let visuallyModified = false;
        this.lastDomStep = null;

        // --- Safety gate: validate tool calls before dispatch ---
        const validated = validateToolCalls(response.tool_calls);
        const blockedCalls = validated.filter((v) => v.blocked);
        const auditedCalls = validated.filter((v) => v.auditFlag);
        for (const a of auditedCalls) {
          this.traceRecorder?.recordEvent("safety_gate_audit", {
            tool: a.original.function.name,
            flag: a.auditFlag,
            phase: "output",
          });
        }
        const allowedToolCalls = validated
          .filter((v) => !v.blocked)
          .map((v) => v.original);

        response.tool_calls = allowedToolCalls;

        // Deferred assistant message: only includes tool_calls that will have
        // corresponding results (blocked calls + allowed). Prevents 422
        // errors from orphaned tool_call IDs.
        const finalToolCalls = [
          ...blockedCalls.map((b) => b.original),
          ...response.tool_calls,
        ];
        this.context.addMessage({
          role: "assistant",
          content: response.content,
          tool_calls: finalToolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        });

        // Add blocked tool results (after assistant message for correct ordering)
        for (const b of blockedCalls) {
          this.context.addMessage({
            role: "tool",
            tool_call_id: b.original.id,
            content: `Blocked: ${b.reason}`,
          });
          this.traceRecorder?.recordEvent("safety_gate_blocked", {
            tool: b.original.function.name,
            reason: b.reason,
            phase: "output",
          });
        }

        if (response.tool_calls.length === 0 && blockedCalls.length > 0) {
          continue; // All tool calls blocked — retry
        }

        // Determine if we can parallelize: no sequential tools present
        const hasSequentialTool = response.tool_calls.some((tc) =>
          SEQUENTIAL_TOOLS.has(tc.function.name as ToolName),
        );
        const hasHighRiskTool = response.tool_calls.some((tc) => {
          try {
            const parsed = JSON.parse(tc.function.arguments || "{}");
            return (
              classifyRisk(tc.function.name as ToolName, parsed) ===
              RiskLevel.HIGH
            );
          } catch {
            return (
              classifyRisk(tc.function.name as ToolName, {}) === RiskLevel.HIGH
            );
          }
        });
        const hasDomModifyingTool = response.tool_calls.some((tc) =>
          DOM_MODIFYING_TOOLS.has(tc.function.name as ToolName),
        );
        const canParallelize =
          !hasSequentialTool &&
          !hasHighRiskTool &&
          !hasDomModifyingTool &&
          response.tool_calls.length > 1;

        if (canParallelize) {
          // PARALLEL EXECUTION
          const results = await Promise.all(
            response.tool_calls.map(async (toolCall) => {
              const toolName = toolCall.function.name as ToolName;
              const argsKey = toolCall.function.arguments.slice(0, 100);
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(toolCall.function.arguments);
              } catch {
                // Registry will handle parse error on execute
              }

              // Failed-action memory: block exact repeat of a previously failed tool call
              const priorFail = findPriorFailure(
                blockedActions,
                toolName,
                argsKey,
              );
              if (priorFail) {
                const failMsg =
                  `Error: This exact action already failed at turn ${priorFail.turn} with: '${priorFail.error}'. ` +
                  buildFailureRecovery(priorFail.error);
                this.log.warn("agent", "Failed-action repeat blocked", {
                  turn: this.turnCount,
                  tool: toolName,
                  priorTurn: priorFail.turn,
                  mode: "parallel",
                });
                return { toolCall, result: null, error: failMsg };
              }

              // Tool result cache lookup (Feature 1)
              const cacheType = CACHEABLE_TOOLS.get(toolName);
              if (cacheType) {
                const cacheKey = ToolResultCache.key(toolName, args);
                const fp = getSnapshotFingerprint(this.context.getSnapshot());
                const cached = this.toolCache.get(cacheKey, fp);
                if (cached !== null) {
                  this.log.info("agent", "Tool cache hit", {
                    turn: this.turnCount,
                    tool: toolName,
                    mode: "parallel",
                  });
                  this.traceRecorder?.recordEvent("tool_cache_hit", {
                    tool: toolName,
                    mode: "parallel",
                  });
                  return { toolCall, result: cached, error: null };
                }
              }

              // Redundant action block (Feature 2): skip if same (tool+args+fingerprint) repeated >= threshold
              {
                const fp = getSnapshotFingerprint(this.context.getSnapshot());
                const sameCount = recentSuccesses.filter(
                  (e) =>
                    e.tool === toolName &&
                    e.args === argsKey &&
                    e.snapshotFingerprint === fp,
                ).length;
                if (sameCount >= TOOL_CACHE.BLOCK_THRESHOLD) {
                  const lastMatch = recentSuccesses.findLast(
                    (e) =>
                      e.tool === toolName &&
                      e.args === argsKey &&
                      e.snapshotFingerprint === fp,
                  );
                  if (lastMatch) {
                    this.log.info("agent", "Redundant action blocked", {
                      turn: this.turnCount,
                      tool: toolName,
                      count: sameCount,
                      mode: "parallel",
                    });
                    this.traceRecorder?.recordEvent(
                      "redundant_action_blocked",
                      {
                        tool: toolName,
                        count: sameCount,
                        mode: "parallel",
                      },
                    );
                    return { toolCall, result: lastMatch.result, error: null };
                  }
                }
              }

              // Pre-dispatch element ID validation
              const idError = validateElementIds(
                toolName,
                args,
                this.context.getSnapshot(),
              );
              if (idError) {
                this.log.warn("agent", "Invalid element ID pre-dispatch", {
                  turn: this.turnCount,
                  tool: toolName,
                  args: JSON.stringify(args).slice(0, 100),
                  mode: "parallel",
                });
                return { toolCall, result: null, error: idError };
              }

              // Pre-action feasibility check (disabled, zero-size, invisible)
              const preflight = preflightElementCheck(
                toolName,
                args,
                this.context.getSnapshot(),
              );
              if (preflight.error) {
                this.log.warn("agent", "Preflight check failed", {
                  turn: this.turnCount,
                  tool: toolName,
                  reason: preflight.error,
                  mode: "parallel",
                });
                return { toolCall, result: null, error: preflight.error };
              }

              const preDecision = this.middleware.evaluatePreTool(
                toolName,
                args,
                this.turnCount,
              );

              const toolStep: AgentStep = {
                id: crypto.randomUUID(),
                type: "tool",
                label: formatStepLabel(toolName, args, this.elementResolver),
                detail: JSON.stringify(args),
                toolName,
                status: "running",
                timestamp: Date.now(),
              };
              this.stepHandler(toolStep, false);

              if (!preDecision.allowed) {
                const deniedReason =
                  preDecision.denyReason ||
                  `Tool ${toolName} denied by middleware`;
                const toolMs = Date.now() - toolStep.timestamp;
                this.stepHandler(
                  {
                    ...toolStep,
                    status: "error",
                    durationMs: toolMs,
                    errorMessage: deniedReason,
                  },
                  true,
                );
                return {
                  toolCall,
                  result: null,
                  error: deniedReason,
                };
              }

              try {
                const result = await this.executeToolCall(toolCall, tabId);
                const toolMs = Date.now() - toolStep.timestamp;
                this.middleware.evaluatePostTool(
                  toolName,
                  result,
                  null,
                  toolMs,
                  this.turnCount,
                );
                this.stepHandler(
                  {
                    ...toolStep,
                    status: "done",
                    durationMs: toolMs,
                  },
                  true,
                );
                this.log.info("tools", `${toolName} OK`, {
                  turn: this.turnCount,
                  tool: toolName,
                  risk: preDecision.riskLevel,
                  mode: "parallel",
                  args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
                  result: result.slice(0, STRING_LIMITS.RESULT_LOG),
                  durationMs: toolMs,
                  intention: llmIntention,
                });
                this.traceRecorder?.recordToolExecution(
                  toolCall.id,
                  toolName,
                  args,
                  result,
                  true,
                  toolMs,
                  preDecision.riskLevel,
                );

                if (
                  DOM_MODIFYING_TOOLS.has(toolName) &&
                  !result.includes("Click intercepted")
                ) {
                  domModified = true;
                  if (toolName !== ToolName.READ_PAGE) {
                    visuallyModified = true;
                  }
                  this.lastDomStep = {
                    ...toolStep,
                    status: "done",
                    durationMs: toolMs,
                  };
                }

                // Cache store (Feature 1): cache successful results for cacheable tools
                if (cacheType && !result.startsWith("Error:")) {
                  const fp = getSnapshotFingerprint(this.context.getSnapshot());
                  this.toolCache.set(
                    ToolResultCache.key(toolName, args),
                    result,
                    fp,
                    cacheType,
                  );
                }

                // Track investigation tools during orientation for adaptive tier allocation
                if (orientationPhase && INVESTIGATION_TOOLS.has(toolName)) {
                  orientationToolsUsed.add(toolName);
                }

                return { toolCall, result, error: null };
              } catch (toolError: any) {
                if (toolError.name === "AbortError") throw toolError;
                const errorMsg = toolError.message || String(toolError);
                const toolMs = Date.now() - toolStep.timestamp;
                this.middleware.evaluatePostTool(
                  toolName,
                  null,
                  errorMsg,
                  toolMs,
                  this.turnCount,
                );
                this.log.error("tools", `${toolName} FAIL`, {
                  turn: this.turnCount,
                  tool: toolName,
                  risk: preDecision.riskLevel,
                  mode: "parallel",
                  args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
                  error: errorMsg,
                  durationMs: toolMs,
                  intention: llmIntention,
                });
                this.traceRecorder?.recordToolExecution(
                  toolCall.id,
                  toolName,
                  args,
                  errorMsg,
                  false,
                  toolMs,
                  preDecision.riskLevel,
                  errorMsg,
                );
                this.stepHandler(
                  {
                    ...toolStep,
                    status: "error",
                    durationMs: Date.now() - toolStep.timestamp,
                    errorMessage: errorMsg,
                  },
                  true,
                );
                return { toolCall, result: null, error: errorMsg };
              }
            }),
          );

          // Add all results to context
          for (const { toolCall, result, error } of results) {
            this.context.addMessage({
              role: "tool",
              tool_call_id: toolCall.id,
              content: error ? `Error: ${error}` : result!,
            });
          }

          // Post-batch verification gate check
          const planAfterParallel = this.context.getPlanStatusRaw();
          if (planAfterParallel) {
            const currentSub =
              planAfterParallel.subtasks[planAfterParallel.currentIndex];
            if (currentSub?.verificationGate) {
              const toolResultStrings = results.map((r) =>
                r.error ? `Error: ${r.error}` : r.result!,
              );
              const gateResult = checkVerificationGate(
                toolResultStrings,
                currentSub.verificationGate,
                this.context.getCurrentUrl(),
              );
              if (gateResult.matched) {
                const actionLabel =
                  currentSub.verificationGate.action === "call_done"
                    ? `CHECKPOINT: Gate triggered. Evidence: '${gateResult.evidence}'. Call done() now.`
                    : `CHECKPOINT: Step complete. Evidence: '${gateResult.evidence}'. Advance to next step.`;
                this.context.addMessage({ role: "user", content: actionLabel });
                this.log.info(
                  "agent",
                  "Verification gate triggered (parallel)",
                  {
                    turn: this.turnCount,
                    action: currentSub.verificationGate.action,
                    evidence: gateResult.evidence,
                  },
                );
                this.traceRecorder?.recordEvent("verification_gate_triggered", {
                  action: currentSub.verificationGate.action,
                  evidence: gateResult.evidence,
                  mode: "parallel",
                });
              }
            }
          }
        } else {
          // SEQUENTIAL EXECUTION (has sequential tools or single tool)
          for (const toolCall of response.tool_calls) {
            if (!this.isRunning) break;

            // Parse args for risk classification and done detection
            const toolName = toolCall.function.name as ToolName;
            const argsKey = toolCall.function.arguments.slice(0, 100);
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(toolCall.function.arguments);
            } catch {
              // Registry will handle parse error on execute
            }

            // Failed-action memory: block exact repeat of a previously failed tool call
            const priorFail = findPriorFailure(
              blockedActions,
              toolName,
              argsKey,
            );
            if (priorFail) {
              const failMsg =
                `Error: This exact action already failed at turn ${priorFail.turn} with: '${priorFail.error}'. ` +
                buildFailureRecovery(priorFail.error);
              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: failMsg,
              });
              this.log.warn("agent", "Failed-action repeat blocked", {
                turn: this.turnCount,
                tool: toolName,
                priorTurn: priorFail.turn,
                mode: "sequential",
              });
              continue;
            }

            // Tool result cache lookup (Feature 1)
            const cacheType = CACHEABLE_TOOLS.get(toolName);
            if (cacheType) {
              const cacheKey = ToolResultCache.key(toolName, args);
              const fp = getSnapshotFingerprint(this.context.getSnapshot());
              const cached = this.toolCache.get(cacheKey, fp);
              if (cached !== null) {
                this.log.info("agent", "Tool cache hit", {
                  turn: this.turnCount,
                  tool: toolName,
                  mode: "sequential",
                });
                this.traceRecorder?.recordEvent("tool_cache_hit", {
                  tool: toolName,
                  mode: "sequential",
                });
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: cached,
                });
                continue;
              }
            }

            // Redundant action block (Feature 2): skip if same (tool+args+fingerprint) repeated >= threshold
            {
              const fp = getSnapshotFingerprint(this.context.getSnapshot());
              const sameCount = recentSuccesses.filter(
                (e) =>
                  e.tool === toolName &&
                  e.args === argsKey &&
                  e.snapshotFingerprint === fp,
              ).length;
              if (sameCount >= TOOL_CACHE.BLOCK_THRESHOLD) {
                const lastMatch = recentSuccesses.findLast(
                  (e) =>
                    e.tool === toolName &&
                    e.args === argsKey &&
                    e.snapshotFingerprint === fp,
                );
                if (lastMatch) {
                  this.log.info("agent", "Redundant action blocked", {
                    turn: this.turnCount,
                    tool: toolName,
                    count: sameCount,
                    mode: "sequential",
                  });
                  this.traceRecorder?.recordEvent("redundant_action_blocked", {
                    tool: toolName,
                    count: sameCount,
                    mode: "sequential",
                  });
                  this.context.addMessage({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: lastMatch.result,
                  });
                  continue;
                }
              }
            }

            // Pre-dispatch element ID validation
            const idError = validateElementIds(
              toolName,
              args,
              this.context.getSnapshot(),
            );
            if (idError) {
              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: idError,
              });
              this.log.warn("agent", "Invalid element ID pre-dispatch", {
                turn: this.turnCount,
                tool: toolName,
                args: JSON.stringify(args).slice(0, 100),
                mode: "sequential",
              });
              continue;
            }

            // Pre-action feasibility check (disabled, zero-size, invisible)
            const preflight = preflightElementCheck(
              toolName,
              args,
              this.context.getSnapshot(),
            );
            if (preflight.error) {
              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: preflight.error,
              });
              this.log.warn("agent", "Preflight check failed", {
                turn: this.turnCount,
                tool: toolName,
                reason: preflight.error,
                mode: "sequential",
              });
              continue;
            }
            if (preflight.warning) {
              // Soft warning: inject as context but don't block execution
              this.context.addMessage({
                role: "user",
                content: preflight.warning,
              });
            }

            const preDecision = this.middleware.evaluatePreTool(
              toolName,
              args,
              this.turnCount,
            );
            if (!preDecision.allowed) {
              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Error: ${preDecision.denyReason || "Blocked by policy middleware."}`,
              });
              continue;
            }
            if (
              preDecision.approvalMode === "bypassed" &&
              preDecision.riskLevel === RiskLevel.HIGH
            ) {
              this.stepHandler(
                {
                  id: crypto.randomUUID(),
                  type: "info",
                  label: `Approval bypassed: ${formatStepLabel(toolName, args, this.elementResolver)}`,
                  status: "done",
                  timestamp: Date.now(),
                },
                false,
              );
            }
            if (preDecision.requiresApproval) {
              const approved = await this.ensureToolApproval(
                toolName,
                args,
                preDecision.riskLevel,
              );
              if (!approved) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: "Error: Action denied by user approval policy.",
                });
                continue;
              }
            }

            // DONE tool — planner-validated exit
            if (toolName === ToolName.DONE) {
              const summary = (args.summary as string) || "Task completed.";

              // Planner validation: only when a plan exists
              if (this.taskId && this.planSubtasks.length > 0) {
                let shouldReject = false;
                let rejectReason = "";

                try {
                  this.stepHandler(
                    {
                      id: crypto.randomUUID(),
                      type: "thinking",
                      label: "Verifying completion...",
                      status: "running",
                      timestamp: Date.now(),
                    },
                    false,
                  );

                  const validation = await this.planner.validateDone(
                    this.originalQuery,
                    this.planSubtasks,
                    summary,
                    this.context.getSnapshot()?.title || "",
                    this.context.getSnapshot()?.url || "",
                    this.abortController!.signal,
                    this.perception.getInterpretation() ?? undefined,
                  );

                  if (!validation.approved) {
                    shouldReject = true;
                    rejectReason =
                      validation.reason || "Task is not yet complete.";
                  }
                } catch (_err: any) {
                  // Planner call failed — structural fallback
                  const completedCount = this.planSubtasks.filter(
                    (s) => s.status === "completed",
                  ).length;
                  if (completedCount < this.planSubtasks.length) {
                    shouldReject = true;
                    rejectReason = `Planner unavailable. ${completedCount}/${this.planSubtasks.length} subtasks completed. Continue.`;
                  }
                }

                if (shouldReject) {
                  this.doneRejections++;

                  // Advance completed subtasks and update plan state
                  const newIdx = this.advanceCompletedSubtasks();
                  if (newIdx > 0) {
                    const existingPlan = this.context.getPlanStatusRaw();
                    this.context.setPlanStatus(
                      this.planSubtasks.map((s, idx) => ({
                        description: s.description,
                        status: s.status,
                        completedAtUrl: s.completedAtUrl,
                        result: s.result,
                        verificationGate:
                          existingPlan?.subtasks[idx]?.verificationGate,
                      })),
                      newIdx,
                    );
                    this.broadcast({
                      type: "TASK_PROGRESS",
                      payload: {
                        taskId: this.taskId!,
                        subtasks: this.planSubtasks,
                        currentIndex: newIdx,
                        totalTurnsUsed: this.turnCount,
                      },
                    });
                  }

                  this.log.warn("agent", "DONE rejected", {
                    turn: this.turnCount,
                    rejections: this.doneRejections,
                    advancedTo: newIdx,
                    reason: rejectReason.slice(
                      0,
                      STRING_LIMITS.REJECTION_REASON,
                    ),
                  });
                  this.traceRecorder?.recordEvent("done_rejected", {
                    rejections: this.doneRejections,
                    reason: rejectReason,
                    advancedTo: newIdx,
                  });

                  if (this.doneRejections >= this.limits.maxDoneRejections) {
                    this.log.warn("agent", "DONE forced after max rejections", {
                      turn: this.turnCount,
                      rejections: this.doneRejections,
                    });
                    // Fall through to normal done handling
                  } else {
                    this.context.addMessage({
                      role: "tool",
                      tool_call_id: toolCall.id,
                      content: `done() REJECTED: ${rejectReason}\n\nContinue working. Do NOT call done() until all steps are complete.`,
                    });
                    this.stepHandler(
                      {
                        id: crypto.randomUUID(),
                        type: "info",
                        label: `Not done yet (${this.doneRejections}/${this.limits.maxDoneRejections})`,
                        status: "done",
                        timestamp: Date.now(),
                      },
                      false,
                    );
                    continue; // Resume executor loop
                  }
                }
              }

              // --- Normal done handling ---
              this.context.clearPlanStatus();
              this.log.info("agent", "DONE called", {
                turn: this.turnCount,
                url: this.context.getCurrentUrl(),
                summary: summary.slice(0, STRING_LIMITS.SUMMARY_LOG),
              });
              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: summary,
              });
              this.stepHandler(
                {
                  id: crypto.randomUUID(),
                  type: "info",
                  label: "Task complete",
                  status: "done",
                  timestamp: Date.now(),
                },
                false,
              );
              // Replace accumulated reasoning with clean summary and finalize the stream.
              // done:true is critical — without it the side panel message stays in
              // isStreaming state and the "Thinking..." placeholder hides the summary.
              this.broadcast({
                type: "STREAM_CHUNK",
                payload: { delta: "", done: true, replaceContent: summary },
              });
              this.statusHandler(AgentStatus.IDLE, "Done");
              this.messageHandler(summary, []);
              doneSummary = summary;
              doneSignaled = true;

              // Broadcast task completion if plan was active
              if (this.taskId && this.planSubtasks.length > 0) {
                // Populate results for all subtasks before broadcasting
                for (const sub of this.planSubtasks) {
                  if (!sub.result) sub.result = "Completed";
                }
                // Last subtask gets the done() summary
                this.planSubtasks[this.planSubtasks.length - 1].result =
                  summary.slice(0, 200);

                const subtaskResults: SubtaskResult[] = this.planSubtasks.map(
                  (st) => ({
                    description: st.description,
                    status:
                      st.status === "failed"
                        ? ("failed" as const)
                        : st.status === "skipped"
                          ? ("skipped" as const)
                          : ("completed" as const),
                    turnsUsed: st.turnsUsed,
                    result: st.result || "",
                  }),
                );

                this.broadcast({
                  type: "TASK_COMPLETION",
                  payload: {
                    taskId: this.taskId,
                    status: subtaskResults.every(
                      (sr) => sr.status === "completed",
                    )
                      ? "completed"
                      : "partial",
                    totalTurnsUsed: this.turnCount,
                    totalTimeMs: Date.now() - this.taskStartTime,
                    summary,
                    subtaskResults,
                    urlHistory: this.urlHistory,
                  },
                });
              }

              // Broadcast final metrics
              if (this.showSessionMetrics) {
                this.metrics.totalSessionTimeMs =
                  Date.now() - this.sessionStartTime;
                this.broadcast({
                  type: "SESSION_METRICS",
                  payload: { ...this.metrics },
                });
              }

              break;
            }

            // ESCALATE tool — voluntary model upgrade (de-escalates after progress)
            if (toolName === ToolName.ESCALATE) {
              const reason = (args.reason as string) || "";
              if (escalationTier < 1) {
                this.escalateModel();
                escalationTier = 1;
                plannerModelStartTurn = this.turnCount;
                orientationPhase = false; // Cancel plan-then-act handoff
                prevElementCount = await this.refreshSnapshotWithRetry(
                  tabId,
                  prevElementCount,
                );
                await this.refreshPerceptionAndTriage(tabId);
                this.stepHandler(
                  {
                    id: crypto.randomUUID(),
                    type: "info",
                    label: reason
                      ? `Escalating: "${reason.slice(0, STRING_LIMITS.ESCALATION_REASON)}"`
                      : "Escalating to smarter model",
                    status: "done",
                    timestamp: Date.now(),
                  },
                  false,
                );
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: ESCALATION_REFLECTION(
                    reason || "voluntary escalation",
                  ),
                });
              } else {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Already using the most capable model (${this.llm.getCurrentModel()}). Escalation won't help further. Try a fundamentally different approach:\n- Use read_page to force a fresh page perception\n- Try a completely different interaction strategy`,
                });
              }
              this.log.info("agent", "ESCALATE called", {
                turn: this.turnCount,
                reason,
                tier: escalationTier,
              });
              this.traceRecorder?.recordEvent("escalation", {
                reason,
                voluntary: true,
              });
              continue;
            }

            // CLARIFY tool — ask the user a question mid-execution
            if (toolName === ToolName.CLARIFY) {
              const question = (args.question as string) || "Could you clarify?";
              const suggestions = args.suggestions as string[] | undefined;
              const answer = await this.requestClarification(
                question,
                suggestions,
              );
              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `User's answer: ${answer}`,
              });
              this.log.info("agent", "CLARIFY answered", {
                turn: this.turnCount,
                question: question.slice(0, 100),
                answer: answer.slice(0, 200),
              });
              continue;
            }

            // UPDATE_NOTES tool — save a note to persistent working memory
            if (toolName === ToolName.UPDATE_NOTES) {
              const note = (args.note as string) || "";
              this.context.appendWorkingNote(note);
              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: "Note saved.",
              });
              this.log.info("agent", "UPDATE_NOTES saved", {
                turn: this.turnCount,
                noteLength: note.length,
              });
              continue;
            }

            // WAIT tool — re-orientation mechanism
            if (toolName === ToolName.WAIT) {
              const seconds = Math.min(
                Math.max((args.seconds as number) || 2, 1),
                10,
              );
              const reason = (args.reason as string) || "";

              await new Promise((resolve) =>
                setTimeout(resolve, seconds * 1000),
              );

              // Refresh DOM snapshot for fresh context
              prevElementCount = await this.refreshSnapshotWithRetry(
                tabId,
                prevElementCount,
              );

              // Build re-orientation response
              const snapshot = this.context.getSnapshot();
              const parts: string[] = [
                `--- RE-ORIENTATION (waited ${seconds}s) ---`,
              ];
              if (reason) parts.push(`Reason: ${reason}`);
              parts.push(`\nOriginal task: "${this.originalQuery}"`);

              if (this.planSubtasks.length > 0) {
                const planLines = this.planSubtasks.map((s, i) => {
                  const marker =
                    s.status === "completed"
                      ? "[done]"
                      : s.status === "running"
                        ? "[NOW]"
                        : "[pending]";
                  return `  ${i + 1}. ${marker} ${s.description}`;
                });
                parts.push(`\nPlan progress:\n${planLines.join("\n")}`);
              }

              parts.push(
                `\nCurrent page: "${snapshot?.title || "unknown"}" — ${snapshot?.url || "unknown"}`,
              );
              parts.push(`Turn: ${this.turnCount} / ${this.maxTurns}`);
              parts.push(
                `\nReview the above → observe the page → decide your next action.`,
              );

              const reorientation = parts.join("\n");

              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: reorientation,
              });

              this.stepHandler(
                {
                  id: crypto.randomUUID(),
                  type: "tool",
                  label: formatStepLabel(toolName, args, this.elementResolver),
                  toolName,
                  status: "done",
                  timestamp: Date.now(),
                },
                false,
              );

              this.log.info("agent", "WAIT_REORIENT", {
                turn: this.turnCount,
                seconds,
                reason: reason.slice(0, 100),
              });
              this.traceRecorder?.recordEvent("wait_reorient", {
                seconds,
                reason,
              });
              continue;
            }

            // NAVIGATE guard — block navigation to completed step URLs
            if (toolName === ToolName.NAVIGATE && args.url) {
              const blockMessage = this.checkNavigateGuard(args.url as string);
              if (blockMessage) {
                this.log.warn("agent", "Navigate blocked by guard", {
                  turn: this.turnCount,
                  targetUrl: (args.url as string).slice(0, 120),
                });
                this.traceRecorder?.recordEvent("navigate_blocked", {
                  targetUrl: args.url,
                });
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: blockMessage,
                });
                this.stepHandler(
                  {
                    id: crypto.randomUUID(),
                    type: "info",
                    label: "Navigate blocked — would undo progress",
                    status: "done",
                    timestamp: Date.now(),
                  },
                  false,
                );
                continue;
              }
            }

            // LIST_TABS — workspace-scoped
            if (toolName === ToolName.LIST_TABS) {
              const wsTabIds = await this.getWorkspaceTabIds();
              let tabLines: string[];
              if (wsTabIds) {
                // Filter to workspace tabs only
                const tabs: chrome.tabs.Tab[] = [];
                for (const id of wsTabIds) {
                  try {
                    tabs.push(await chrome.tabs.get(id));
                  } catch {
                    // Tab may have been closed externally
                  }
                }
                if (tabs.length === 0) {
                  tabLines = ["No open tabs in this workspace."];
                } else {
                  tabLines = tabs.map(
                    (t) =>
                      `Tab ${t.id}: "${t.title || "(untitled)"}" — ${t.url || "about:blank"}${t.id === tabId ? " [current]" : ""}`,
                  );
                }
              } else {
                // No workspace — show all tabs (fallback)
                const allTabs = await chrome.tabs.query({});
                tabLines = allTabs.map(
                  (t: any) =>
                    `Tab ${t.id}: "${t.title || "(untitled)"}" — ${t.url || "about:blank"}${t.id === tabId ? " [current]" : ""}`,
                );
              }
              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: tabLines.join("\n") || "No open tabs.",
              });
              this.log.info("agent", "LIST_TABS", {
                turn: this.turnCount,
                count: tabLines.length,
                workspaceScoped: wsTabIds !== null,
              });
              continue;
            }

            // SWITCH_TAB — workspace-scoped, updates loop tabId
            if (toolName === ToolName.SWITCH_TAB) {
              if (this.shouldBlockTabManagementTools()) {
                const blockedMessage =
                  "Blocked: switch_tab requires explicit user instruction to manage tabs. " +
                  "Stay on the current tab unless the user asks for tab switching. " +
                  "Tab management tools disabled for this session.";
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: blockedMessage,
                });
                for (const tabTool of [
                  ToolName.CREATE_TAB,
                  ToolName.SWITCH_TAB,
                  ToolName.CLOSE_TAB,
                  ToolName.CREATE_WINDOW,
                ]) {
                  this.disabledTools.add(tabTool);
                }
                this.log.warn(
                  "agent",
                  "switch_tab blocked - not explicitly requested, tab tools disabled",
                  {
                    turn: this.turnCount,
                    originalQuery: this.originalQuery,
                  },
                );
                continue;
              }

              const targetTabId = args.tabId as number;
              const wsTabIds = await this.getWorkspaceTabIds();

              if (wsTabIds && !wsTabIds.includes(targetTabId)) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Error: Tab ${targetTabId} is not in this workspace. Available tabs: ${wsTabIds.join(", ")}`,
                });
                this.log.warn(
                  "agent",
                  "switch_tab blocked — outside workspace",
                  {
                    turn: this.turnCount,
                    targetTabId,
                    workspaceTabs: wsTabIds,
                  },
                );
                continue;
              }

              try {
                await chrome.tabs.update(targetTabId, { active: true });
                tabId = targetTabId;

                // Refresh snapshot for new tab
                prevElementCount = await this.refreshSnapshotWithRetry(
                  tabId,
                  prevElementCount,
                );

                // Warm start: pre-run perception so next turn already has page interpretation
                await this.refreshPerceptionAndTriage(tabId);

                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Switched to tab ${targetTabId}. Fresh page snapshot is available.`,
                });
              } catch (e: any) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Error switching to tab ${targetTabId}: ${e.message}`,
                });
              }
              this.log.info("agent", "SWITCH_TAB", {
                turn: this.turnCount,
                targetTabId,
                newTabId: tabId,
              });
              continue;
            }

            // CLOSE_TAB — workspace-scoped, prevents closing current tab
            if (toolName === ToolName.CLOSE_TAB) {
              if (this.shouldBlockTabManagementTools()) {
                const blockedMessage =
                  "Blocked: close_tab requires explicit user instruction to manage tabs. " +
                  "Tab management tools disabled for this session.";
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: blockedMessage,
                });
                for (const tabTool of [
                  ToolName.CREATE_TAB,
                  ToolName.SWITCH_TAB,
                  ToolName.CLOSE_TAB,
                  ToolName.CREATE_WINDOW,
                ]) {
                  this.disabledTools.add(tabTool);
                }
                this.log.warn(
                  "agent",
                  "close_tab blocked - not explicitly requested, tab tools disabled",
                  {
                    turn: this.turnCount,
                    originalQuery: this.originalQuery,
                  },
                );
                continue;
              }

              const targetTabId = (args.tabId as number) || tabId;

              if (targetTabId === tabId) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Error: Cannot close the current tab (${tabId}). Use switch_tab to move to another tab first.`,
                });
                continue;
              }

              const wsTabIds = await this.getWorkspaceTabIds();
              if (wsTabIds && !wsTabIds.includes(targetTabId)) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Error: Tab ${targetTabId} is not in this workspace. Available tabs: ${wsTabIds.join(", ")}`,
                });
                this.log.warn(
                  "agent",
                  "close_tab blocked — outside workspace",
                  {
                    turn: this.turnCount,
                    targetTabId,
                    workspaceTabs: wsTabIds,
                  },
                );
                continue;
              }

              try {
                await chrome.tabs.remove(targetTabId);
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Closed tab ${targetTabId}.`,
                });
              } catch (e: any) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Error closing tab ${targetTabId}: ${e.message}`,
                });
              }
              this.log.info("agent", "CLOSE_TAB", {
                turn: this.turnCount,
                targetTabId,
              });
              continue;
            }

            // CREATE_TAB — workspace-scoped, auto-adds to workspace
            if (toolName === ToolName.CREATE_TAB) {
              if (this.shouldBlockTabManagementTools()) {
                const blockedMessage =
                  "Blocked: create_tab requires explicit user instruction to open additional tabs. " +
                  "Tab management tools disabled for this session.";
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: blockedMessage,
                });
                for (const tabTool of [
                  ToolName.CREATE_TAB,
                  ToolName.SWITCH_TAB,
                  ToolName.CLOSE_TAB,
                  ToolName.CREATE_WINDOW,
                ]) {
                  this.disabledTools.add(tabTool);
                }
                this.log.warn(
                  "agent",
                  "create_tab blocked - not explicitly requested, tab tools disabled",
                  {
                    turn: this.turnCount,
                    originalQuery: this.originalQuery,
                  },
                );
                continue;
              }

              const url = args.url as string;
              const urlResult = sanitizeUrl(url);
              if (!urlResult.ok) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Error: ${urlResult.error}`,
                });
                continue;
              }

              try {
                const newTab = await chrome.tabs.create({
                  url: urlResult.value,
                });
                if (
                  newTab.id &&
                  this.workspaceId &&
                  this.workspaceId !== "default"
                ) {
                  await workspaceManager.addTabToWorkspace(
                    newTab.id,
                    this.workspaceId,
                  );
                }

                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Created new tab (ID: ${newTab.id}) with URL: ${urlResult.value}. Use switch_tab to make it the active tab.`,
                });
                this.log.info("agent", "CREATE_TAB", {
                  turn: this.turnCount,
                  newTabId: newTab.id,
                  url: urlResult.value,
                  workspaceId: this.workspaceId,
                });
              } catch (e: any) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Error creating tab: ${e.message}`,
                });
              }
              continue;
            }

            const toolStepId = crypto.randomUUID();
            const toolStep: AgentStep = {
              id: toolStepId,
              type: "tool",
              label: formatStepLabel(toolName, args, this.elementResolver),
              detail: JSON.stringify(args),
              toolName,
              status: "running",
              timestamp: Date.now(),
            };
            this.stepHandler(toolStep, false);

            let result: string;
            try {
              result = await this.executeToolCall(toolCall, tabId);
              const toolMs = Date.now() - toolStep.timestamp;
              this.middleware.evaluatePostTool(
                toolName,
                result,
                null,
                toolMs,
                this.turnCount,
              );
              this.stepHandler(
                {
                  ...toolStep,
                  status: "done",
                  durationMs: toolMs,
                },
                true,
              );
              this.log.info("tools", `${toolName} OK`, {
                turn: this.turnCount,
                tool: toolName,
                risk: preDecision.riskLevel,
                mode: "sequential",
                args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
                result: result.slice(0, STRING_LIMITS.RESULT_LOG),
                durationMs: toolMs,
                intention: llmIntention,
              });
              this.traceRecorder?.recordToolExecution(
                toolCall.id,
                toolName,
                args,
                result,
                true,
                toolMs,
                preDecision.riskLevel,
              );
            } catch (toolError: any) {
              if (toolError.name === "AbortError") throw toolError;
              const errorMsg = toolError.message || String(toolError);
              const toolMs = Date.now() - toolStep.timestamp;
              this.middleware.evaluatePostTool(
                toolName,
                null,
                errorMsg,
                toolMs,
                this.turnCount,
              );
              this.log.error("tools", `${toolName} FAIL`, {
                turn: this.turnCount,
                tool: toolName,
                risk: preDecision.riskLevel,
                mode: "sequential",
                args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
                error: errorMsg,
                durationMs: toolMs,
                intention: llmIntention,
              });
              this.traceRecorder?.recordToolExecution(
                toolCall.id,
                toolName,
                args,
                errorMsg,
                false,
                toolMs,
                preDecision.riskLevel,
                errorMsg,
              );
              this.stepHandler(
                {
                  ...toolStep,
                  status: "error",
                  durationMs: toolMs,
                  errorMessage: errorMsg,
                },
                true,
              );
              // Add error to conversation history so the LLM can recover
              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Error: ${errorMsg}`,
              });
              continue;
            }

            if (
              DOM_MODIFYING_TOOLS.has(toolName) &&
              !result.includes("Click intercepted")
            ) {
              domModified = true;
              if (toolName !== ToolName.READ_PAGE) {
                visuallyModified = true;
              }
              this.lastDomStep = {
                ...toolStep,
                status: "done",
                durationMs: Date.now() - toolStep.timestamp,
              };
            }

            // Cache store (Feature 1): cache successful results for cacheable tools
            if (cacheType && !result.startsWith("Error:")) {
              const fp = getSnapshotFingerprint(this.context.getSnapshot());
              this.toolCache.set(
                ToolResultCache.key(toolName, args),
                result,
                fp,
                cacheType,
              );
            }

            // Track investigation tools during orientation for adaptive tier allocation
            if (orientationPhase && INVESTIGATION_TOOLS.has(toolName)) {
              orientationToolsUsed.add(toolName);
            }

            // Add Tool Result to History
            this.context.addMessage({
              role: "tool",
              content: result,
              tool_call_id: toolCall.id,
            });

            // Trigger B: Blind input detection — warn when type_text value has no evidence
            if (toolName === ToolName.TYPE_TEXT) {
              const typedValue = String(args.text || "");
              if (typedValue.length > 3) {
                const snap = this.context.getSnapshot();
                const pageText =
                  snap?.pageContent || snap?.visibleContent || "";
                const originalQuery = this.originalQuery || "";
                // Check if typed value appears in any recent tool result
                let hasEvidence = false;
                if (
                  pageText.includes(typedValue) ||
                  originalQuery.includes(typedValue)
                ) {
                  hasEvidence = true;
                } else {
                  const recentMsgs = this.context.getMessages();
                  const lookback = Math.min(20, recentMsgs.length);
                  for (
                    let ri = recentMsgs.length - 1;
                    ri >= recentMsgs.length - lookback && ri >= 0;
                    ri--
                  ) {
                    const m = recentMsgs[ri];
                    if (
                      m.role === "tool" &&
                      typeof m.content === "string" &&
                      m.content.includes(typedValue)
                    ) {
                      hasEvidence = true;
                      break;
                    }
                  }
                }
                if (!hasEvidence) {
                  this.log.warn("agent", "Blind input detected", {
                    turn: this.turnCount,
                    typedValue: typedValue.slice(0, 50),
                  });
                  this.traceRecorder?.recordEvent("blind_input_detected", {
                    typedValue: typedValue.slice(0, 50),
                  });
                  this.context.addMessage({
                    role: "user",
                    content: `WARNING: You typed "${typedValue.slice(0, 50)}" but this value doesn't appear in any page content, tool result, or the user's query. Use investigation tools first (inspect_hidden, execute_js, read_element) to find the correct value before typing.`,
                  });
                }
              }
            }
          }

          // Post-sequential verification gate check
          const planAfterSeq = this.context.getPlanStatusRaw();
          if (planAfterSeq && !doneSignaled) {
            const currentSubSeq =
              planAfterSeq.subtasks[planAfterSeq.currentIndex];
            if (currentSubSeq?.verificationGate) {
              // Collect recent tool result messages from this turn
              const seqMessages = this.context.getMessages();
              const seqToolResults: string[] = [];
              for (let ri = seqMessages.length - 1; ri >= 0; ri--) {
                const msg = seqMessages[ri];
                if (msg.role !== "tool") break;
                if (typeof msg.content === "string")
                  seqToolResults.push(msg.content);
              }
              const seqGateResult = checkVerificationGate(
                seqToolResults,
                currentSubSeq.verificationGate,
                this.context.getCurrentUrl(),
              );
              if (seqGateResult.matched) {
                const seqActionLabel =
                  currentSubSeq.verificationGate.action === "call_done"
                    ? `CHECKPOINT: Gate triggered. Evidence: '${seqGateResult.evidence}'. Call done() now.`
                    : `CHECKPOINT: Step complete. Evidence: '${seqGateResult.evidence}'. Advance to next step.`;
                this.context.addMessage({
                  role: "user",
                  content: seqActionLabel,
                });
                this.log.info(
                  "agent",
                  "Verification gate triggered (sequential)",
                  {
                    turn: this.turnCount,
                    action: currentSubSeq.verificationGate.action,
                    evidence: seqGateResult.evidence,
                  },
                );
                this.traceRecorder?.recordEvent("verification_gate_triggered", {
                  action: currentSubSeq.verificationGate.action,
                  evidence: seqGateResult.evidence,
                  mode: "sequential",
                });
              }
            }
          }
        }

        // --- Circuit Breaker: track tool failures ---
        if (!doneSignaled) {
          // Count successes/failures from this turn's tool results
          let turnSuccesses = 0;
          let turnFailures = 0;
          const recentMessages = this.context.getMessages();
          // Look at the tool results we just added (they're the most recent messages)
          for (let i = recentMessages.length - 1; i >= 0; i--) {
            const msg = recentMessages[i];
            if (msg.role !== "tool") break;
            const content = typeof msg.content === "string" ? msg.content : "";
            if (
              content.startsWith("Error:") ||
              content.includes("does not appear to be") ||
              content.includes("No element with tag") ||
              content.includes("Click intercepted")
            ) {
              turnFailures++;
            } else {
              turnSuccesses++;
            }
          }

          // A. Consecutive all-fail turns
          if (turnFailures > 0 && turnSuccesses === 0) {
            consecutiveAllFailTurns++;
          } else {
            consecutiveAllFailTurns = 0;
          }

          if (consecutiveAllFailTurns >= this.limits.maxConsecutiveAllFail) {
            this.log.warn(
              "agent",
              "Circuit breaker: consecutive all-fail turns",
              {
                turn: this.turnCount,
                consecutiveAllFailTurns,
              },
            );
            this.traceRecorder?.recordEvent("circuit_breaker", {
              reason: "consecutive_all_fail",
              consecutiveAllFailTurns,
            });
            this.circuitBreakerExit(
              `All tool calls have failed for ${consecutiveAllFailTurns} consecutive turns. The agent cannot make progress. Send a follow-up with different instructions.`,
            );
            return {
              outcome: "error" as const,
              turnCount: this.turnCount,
              summary: "Circuit breaker: consecutive tool failures",
              metrics: this.getMetrics(),
            };
          }

          // B. Same-tool repeat failure tracking
          for (const toolCall of response.tool_calls!) {
            const toolName = toolCall.function.name;
            const argsKey = toolCall.function.arguments.slice(0, 100);
            const failKey = `${toolName}:${argsKey}`;

            // Find the corresponding tool result
            const toolResult = recentMessages.find(
              (m) => m.role === "tool" && m.tool_call_id === toolCall.id,
            );
            const resultContent =
              typeof toolResult?.content === "string" ? toolResult.content : "";
            const isFail =
              resultContent.startsWith("Error:") ||
              resultContent.includes("does not appear to be") ||
              resultContent.includes("No element with tag") ||
              resultContent.includes("Click intercepted");

            if (isFail) {
              // Record to failed-action memory ring buffer
              blockedActions.push({
                tool: toolName,
                argsKey,
                error: resultContent.split("\n")[0].slice(0, 80),
                turn: this.turnCount,
              });
              if (blockedActions.length > FAILED_ACTION_MEMORY.BUFFER_SIZE) {
                blockedActions.shift();
              }

              const count = (toolFailCounts.get(failKey) || 0) + 1;
              toolFailCounts.set(failKey, count);

              if (count >= this.limits.toolFailureExit) {
                this.log.warn(
                  "agent",
                  "Circuit breaker: same-tool repeat failure",
                  {
                    turn: this.turnCount,
                    tool: toolName,
                    count,
                  },
                );
                this.traceRecorder?.recordEvent("circuit_breaker", {
                  reason: "same_tool_repeat",
                  tool: toolName,
                  count,
                });
                this.circuitBreakerExit(
                  `The same tool call (${toolName}) has failed ${count} times with the same arguments. The agent is stuck in a loop. Send a follow-up with different instructions.`,
                );
                return {
                  outcome: "error" as const,
                  turnCount: this.turnCount,
                  summary: "Circuit breaker: repeated tool failure",
                  metrics: this.getMetrics(),
                };
              }

              if (count === this.limits.toolFailureWarn) {
                this.log.warn(
                  "agent",
                  "Circuit breaker warning: tool repeating failures",
                  {
                    turn: this.turnCount,
                    tool: toolName,
                    count,
                  },
                );
                this.context.addMessage({
                  role: "user",
                  content: `WARNING: ${toolName} has failed ${count} times with similar arguments. Stop repeating this approach. Try a fundamentally different strategy — use a different tool, different element, or scroll/navigate to find an alternative path.`,
                });
              }
            } else {
              // Reset on success for this tool+args combo
              toolFailCounts.delete(failKey);
            }
          }

          // B2. Exploration budget: nudge after N consecutive turns of only reading/inspecting
          {
            const allDiscovery = response.tool_calls!.every((tc) =>
              EXPLORATION_ONLY_TOOLS.has(tc.function.name),
            );
            if (allDiscovery) {
              consecutiveExplorationTurns++;
              if (
                consecutiveExplorationTurns >= EXPLORATION_BUDGET.MAX_CONSECUTIVE
              ) {
                this.context.addMessage({
                  role: "user",
                  content: `You've spent ${consecutiveExplorationTurns} consecutive turns only reading/inspecting without acting. Use what you've gathered — click, type, scroll, navigate — or escalate if stuck.`,
                });
              }
            } else {
              consecutiveExplorationTurns = 0;
            }
          }

          // C. Redundant successful action detection
          for (const toolCall of response.tool_calls!) {
            const toolName = toolCall.function.name;
            const argsKey = toolCall.function.arguments.slice(0, 100);

            // Find the corresponding tool result
            const toolResult = recentMessages.find(
              (m) => m.role === "tool" && m.tool_call_id === toolCall.id,
            );
            const resultContent =
              typeof toolResult?.content === "string" ? toolResult.content : "";
            const isSuccess =
              !resultContent.startsWith("Error:") &&
              !resultContent.includes("does not appear to be") &&
              !resultContent.includes("No element with tag") &&
              !resultContent.includes("Click intercepted") &&
              !resultContent.includes("REJECTED");

            if (isSuccess) {
              // Push to ring buffer (capped at WINDOW size)
              const actionFingerprint = getSnapshotFingerprint(
                this.context.getSnapshot(),
              );
              recentSuccesses.push({
                tool: toolName,
                args: argsKey,
                result: resultContent,
                snapshotFingerprint: actionFingerprint,
              });
              if (recentSuccesses.length > REDUNDANT_ACTION.WINDOW) {
                recentSuccesses.shift();
              }

              // Count repetitions of this tool+args WITH same page state in the window
              const sameStateCount = recentSuccesses.filter(
                (entry) =>
                  entry.tool === toolName &&
                  entry.args === argsKey &&
                  entry.snapshotFingerprint === actionFingerprint,
              ).length;
              // Also count total calls to this tool+args regardless of page state
              const totalRepeatCount = recentSuccesses.filter(
                (entry) => entry.tool === toolName && entry.args === argsKey,
              ).length;

              // If page state changed between calls, the action is making progress — no nudge
              // Only nudge when same action + same page state (truly stuck)
              if (sameStateCount >= REDUNDANT_ACTION.INFO_THRESHOLD) {
                this.log.info("agent", "Redundant action nudge", {
                  turn: this.turnCount,
                  tool: toolName,
                  sameStateCount,
                  totalRepeats: totalRepeatCount,
                });
                this.traceRecorder?.recordEvent("redundant_action_nudge", {
                  tool: toolName,
                  count: sameStateCount,
                });
                this.traceRecorder?.recordEvent("multi_turn_pathology", {
                  pathology: "anchoring",
                  trigger: "redundant_action_nudge",
                  turn: this.turnCount,
                  details: `${toolName} x${sameStateCount} same state`,
                });
                this.context.addMessage({
                  role: "user",
                  content: `Note: You have called ${toolName} ${sameStateCount} times with similar arguments and the page appears unchanged each time. Consider whether a different approach might be more effective.`,
                });
                // Clear the buffer so the nudge doesn't fire every subsequent turn
                recentSuccesses.length = 0;
              } else {
                // Tool-name-only pattern: same tool with varying args
                const toolNameCount = recentSuccesses.filter(
                  (entry) => entry.tool === toolName,
                ).length;
                if (
                  toolNameCount >= REDUNDANT_ACTION.TOOL_NAME_INFO_THRESHOLD
                ) {
                  this.log.info("agent", "Tool-name pattern noted", {
                    turn: this.turnCount,
                    tool: toolName,
                    count: toolNameCount,
                  });
                  this.traceRecorder?.recordEvent("tool_name_pattern", {
                    tool: toolName,
                    count: toolNameCount,
                  });
                  this.context.addMessage({
                    role: "user",
                    content: `Note: You have used ${toolName} ${toolNameCount} times in recent turns. If your current approach isn't yielding results, a different strategy might help.`,
                  });
                  recentSuccesses.length = 0;
                }
              }
            }
          }

          // D2. Outcome-based dead-end detection: fingerprint tool results and detect patterns
          {
            const currentSnapshotFp = getSnapshotFingerprint(
              this.context.getSnapshot(),
            );
            for (const toolCall of response.tool_calls!) {
              const toolResult = recentMessages.find(
                (m) => m.role === "tool" && m.tool_call_id === toolCall.id,
              );
              const resultContent =
                typeof toolResult?.content === "string"
                  ? toolResult.content
                  : "";
              if (resultContent) {
                const fingerprint = normalizeOutcome(resultContent);
                recentOutcomes.push({
                  fingerprint,
                  snapshotFp: currentSnapshotFp,
                });
                if (recentOutcomes.length > STAGNATION_DETECTION.WINDOW)
                  recentOutcomes.shift();
              }

              // Accumulate subgoal attempts for cumulative failure brief
              const toolName = toolCall.function.name;
              const firstLine = resultContent.split("\n")[0].slice(0, 120);
              const wasFailure =
                firstLine.startsWith("Error:") ||
                firstLine.includes("does not appear") ||
                firstLine.includes("No element with tag") ||
                firstLine.includes("Click intercepted") ||
                firstLine.includes("REJECTED");
              let argSnippet = "";
              try {
                argSnippet = toolCall.function.arguments.slice(0, 100);
              } catch { /* */ }
              subgoalAttempts.push({
                turn: this.turnCount,
                tool: toolName,
                args: argSnippet,
                outcome: firstLine,
                wasFailure,
                snapshotFp: currentSnapshotFp,
              });
            }
          }
          // Check for dead-end pattern (all recent outcomes identical AND same page state)
          {
            const lastN = recentOutcomes.slice(-this.limits.stagnationPivot);
            const allSame =
              lastN.length >= this.limits.stagnationReflection &&
              lastN.every(
                (o) =>
                  o.fingerprint === lastN[0].fingerprint &&
                  o.snapshotFp === lastN[0].snapshotFp,
              );
            if (allSame && lastN.length >= this.limits.stagnationPivot) {
              this.log.warn(
                "agent",
                "Dead-end detected: forcing strategy pivot",
                {
                  turn: this.turnCount,
                  pattern: lastN[0].fingerprint.slice(0, 80),
                  count: lastN.length,
                },
              );
              this.traceRecorder?.recordEvent("dead_end_pivot", {
                pattern: lastN[0].fingerprint.slice(0, 80),
                count: lastN.length,
              });
              this.traceRecorder?.recordEvent("multi_turn_pathology", {
                pathology: "anchoring",
                trigger: "dead_end_pivot",
                turn: this.turnCount,
                details: `pattern: ${lastN[0].fingerprint.slice(0, 60)}`,
              });
              await this.strategyPivot(tabId);
              recentOutcomes.length = 0;
            } else if (allSame) {
              this.log.info(
                "agent",
                "Dead-end nudge: repeated outcome pattern",
                {
                  turn: this.turnCount,
                  pattern: lastN[0].fingerprint.slice(0, 80),
                  count: lastN.length,
                },
              );
              this.traceRecorder?.recordEvent("dead_end_nudge", {
                pattern: lastN[0].fingerprint.slice(0, 80),
                count: lastN.length,
              });
              this.traceRecorder?.recordEvent("multi_turn_pathology", {
                pathology: "anchoring",
                trigger: "dead_end_nudge",
                turn: this.turnCount,
                details: `pattern: ${lastN[0].fingerprint.slice(0, 60)}`,
              });
              this.context.addMessage({
                role: "user",
                content: `⚠ Dead-end detected: last ${lastN.length} actions all produced the same outcome pattern: "${lastN[0].fingerprint.slice(0, 80)}". Try a fundamentally different approach — use read_page, scroll_page, or find_element to reassess the page.`,
              });
            }
          }

          // E-pre. Post-escalation forced pivot: if N turns passed since step watchdog escalation
          // without step advancement, force a strategy pivot and clear failed-action memory.
          if (turnsSinceStepEscalation >= 0) {
            turnsSinceStepEscalation++;
            if (
              turnsSinceStepEscalation >=
              FAILED_ACTION_MEMORY.POST_ESCALATION_PIVOT_TURNS
            ) {
              this.log.info("agent", "Post-escalation forced pivot", {
                turn: this.turnCount,
                turnsSinceStepEscalation,
              });
              await this.strategyPivot(tabId);
              blockedActions.length = 0;
              turnsSinceStepEscalation = -1; // Reset — only trigger once per escalation
            }
          }

          // E. Step duration watchdog
          if (
            this.taskId &&
            this.planSubtasks.length > 0 &&
            this.turnsOnCurrentStep > 0
          ) {
            if (
              this.turnsOnCurrentStep >= this.limits.stepEscalateTurns &&
              escalationTier < 1 &&
              cooldownRemaining <= 0
            ) {
              this.log.warn("agent", "Step watchdog: force escalation", {
                turn: this.turnCount,
                turnsOnStep: this.turnsOnCurrentStep,
                stepIndex: this.lastPlanIndex,
                fromTier: escalationTier,
              });
              this.traceRecorder?.recordEvent("step_watchdog_escalate", {
                turnsOnStep: this.turnsOnCurrentStep,
                stepIndex: this.lastPlanIndex,
              });
              const stepAttemptSummary = extractAttemptSummary(
                this.context.getMessages(),
              );
              this.escalateModel();
              escalationTier = 1;
              orientationPhase = false;
              plannerModelStartTurn = this.turnCount;
              turnsSinceStepEscalation = 0; // Start tracking post-escalation pivot
              await this.strategyPivot(tabId, stepAttemptSummary);
              this.stagnation.resetEscalation();
              this.context.addMessage({
                role: "user",
                content: `STEP WATCHDOG: You spent ${this.turnsOnCurrentStep} turns on step ${this.lastPlanIndex + 1} without advancing. ${ESCALATION_REFLECTION("stuck on step " + (this.lastPlanIndex + 1) + " for " + this.turnsOnCurrentStep + " turns")}\nEither complete this step and move forward, or revise the plan if the step is impossible.`,
              });
              this.stepHandler(
                {
                  id: crypto.randomUUID(),
                  type: "info",
                  label: `Stuck on step ${this.lastPlanIndex + 1} — escalating to planner model`,
                  status: "done",
                  timestamp: Date.now(),
                },
                false,
              );
            } else if (this.turnsOnCurrentStep === this.limits.stepWarnTurns) {
              this.log.warn("agent", "Step watchdog: warn", {
                turn: this.turnCount,
                turnsOnStep: this.turnsOnCurrentStep,
                stepIndex: this.lastPlanIndex,
              });
              this.traceRecorder?.recordEvent("step_watchdog_warn", {
                turnsOnStep: this.turnsOnCurrentStep,
                stepIndex: this.lastPlanIndex,
              });
              this.context.addMessage({
                role: "user",
                content: `You have spent ${this.turnsOnCurrentStep} turns on this step. Either the step is ALREADY COMPLETE (advance) or your approach isn't working (try escalate or a different approach).`,
              });
            }
          }
        }

        // Trigger A: Same-URL forced escalation — fires even without a plan/subtask structure.
        // Catches the agent spinning on one page regardless of DOM changes (Fix 5A).
        if (
          escalationTier < 1 &&
          cooldownRemaining <= 0 &&
          this.stagnation.sameUrlTurns >= this.limits.sameUrlEscalate
        ) {
          this.log.warn("agent", "Same-URL forced escalation", {
            turn: this.turnCount,
            sameUrlTurns: this.stagnation.sameUrlTurns,
            threshold: this.limits.sameUrlEscalate,
          });
          this.traceRecorder?.recordEvent("same_url_forced_escalation", {
            sameUrlTurns: this.stagnation.sameUrlTurns,
            threshold: this.limits.sameUrlEscalate,
          });
          const urlAttemptSummary = extractAttemptSummary(
            this.context.getMessages(),
          );
          this.escalateModel();
          escalationTier = 1;
          orientationPhase = false;
          plannerModelStartTurn = this.turnCount;
          await this.strategyPivot(tabId, urlAttemptSummary);
          this.stagnation.resetEscalation();
          this.context.addMessage({
            role: "user",
            content: `SAME-URL ESCALATION: You spent ${this.stagnation.sameUrlTurns} turns on this page without navigating away. ${ESCALATION_REFLECTION("same URL for " + this.stagnation.sameUrlTurns + " turns without progress")}`,
          });
          consecutiveTextOnly = 0;
          recentSuccesses.length = 0;
          this.stepHandler(
            {
              id: crypto.randomUUID(),
              type: "info",
              label: `Stuck on same page — escalating`,
              status: "done",
              timestamp: Date.now(),
            },
            false,
          );
        }

        // Force snapshot refresh when tools hit stale element IDs
        // Ensures the LLM's next turn sees fresh IDs without wasting a read_page call
        if (!domModified && !doneSignaled) {
          const recentMsgs = this.context.getMessages();
          for (let i = recentMsgs.length - 1; i >= 0; i--) {
            const msg = recentMsgs[i];
            if (msg.role !== "tool") break;
            if (
              typeof msg.content === "string" &&
              msg.content.includes("No element with tag")
            ) {
              domModified = true;
              this.log.info(
                "agent",
                "Stale element ID detected, forcing snapshot refresh",
                {
                  turn: this.turnCount,
                },
              );
              break;
            }
          }
        }

        // Track last tool name for perception stale threshold selection
        if (response.tool_calls.length > 0) {
          this.lastToolNameForPerception = response.tool_calls[response.tool_calls.length - 1].function.name;
        }

        // Batch snapshot refresh: ONE refresh after all tools complete
        if (domModified && !doneSignaled) {
          try {
            // Wait for DOM to settle instead of fixed 100ms sleep
            // Uses MutationObserver + rAF in content script — responds when idle
            const readiness = await waitForDomReady(tabId, {
              timeoutMs: 150,
              waitForElements: prevElementCount > 0,
            });
            this.log.debug("agent", "DOM ready probe", {
              turn: this.turnCount,
              waitedMs: readiness.waitedMs,
              elementCount: readiness.elementCount,
            });

            let snapResponse = await chrome.tabs.sendMessage(tabId, {
              type: "DOM_SNAPSHOT_REQUEST",
              requestId: crypto.randomUUID(),
              source: MessageSource.BACKGROUND,
              payload: {
                refresh: true,
                              },
            });
            let snap = snapResponse?.payload?.snapshot;

            // Retry once if elements dropped to 0 (SPA still rendering)
            if (snap && snap.elements.length === 0 && prevElementCount > 0) {
              this.log.info(
                "agent",
                "Empty snapshot after action, waiting for elements",
                {
                  turn: this.turnCount,
                  prevElements: prevElementCount,
                },
              );
              // Use DOM probe with waitForElements — content script watches for element insertion
              await waitForDomReady(tabId, {
                timeoutMs: 500,
                waitForElements: true,
              });
              snapResponse = await chrome.tabs.sendMessage(tabId, {
                type: "DOM_SNAPSHOT_REQUEST",
                requestId: crypto.randomUUID(),
                source: MessageSource.BACKGROUND,
                payload: {
                  refresh: true,
                                  },
              });
              snap = snapResponse?.payload?.snapshot;
            }

            if (snap) {
              this.log.info("agent", "Snapshot refreshed", {
                turn: this.turnCount,
                title: snap.title?.slice(0, 60),
                url: snap.url?.slice(0, 100),
                elements: snap.elements.length,
                durationMs: snapResponse.payload.durationMs,
              });
              prevElementCount = snap.elements.length;
              this.context.setSnapshot(snap);

              // Record post-tool DOM state so trace shows what perception was based on
              this.traceRecorder?.recordPostToolSnapshot({
                url: snap.url,
                title: snap.title || "",
                elementCount: snap.elements.length,
                scrollY: snap.scroll?.y || 0,
              });

              // Invalidate DOM cache entries after snapshot refresh
              this.toolCache.invalidateDom();

              // Track URL in history + reset redundant action buffer on navigation
              const currentUrl = snap.url;
              if (currentUrl && !this.urlHistory.includes(currentUrl)) {
                this.urlHistory.push(currentUrl);
                recentSuccesses.length = 0;
              }

              // Record citation for visited page
              if (currentUrl) {
                this.recordCitation(
                  currentUrl,
                  snap.title || "",
                  ToolName.READ_PAGE,
                );
              }

              // Off-domain navigation detection
              if (this.startingOrigin && snap.url) {
                try {
                  const currentOrigin = new URL(snap.url).origin;
                  if (currentOrigin !== this.startingOrigin) {
                    if (!this.offDomainWarned) {
                      this.offDomainWarned = true;
                      this.log.warn("agent", "Off-domain navigation detected", {
                        turn: this.turnCount,
                        startingOrigin: this.startingOrigin,
                        currentUrl: snap.url,
                      });
                      this.context.addMessage({
                        role: "user",
                        content: `WARNING: You navigated away from the original page (${this.startingOrigin}). If the task should be completed on the original page, navigate back immediately. Do not search for answers on other sites — solve the task using the tools available on the original page.`,
                      });
                    }
                  } else {
                    this.offDomainWarned = false; // Reset when back on original domain
                  }
                } catch {
                  /* invalid URL, skip */
                }
              }

              // Refresh perception (vision model) — skips if fingerprint unchanged
              // Skip vision call for read_page (snapshot refresh is sufficient)
              if (visuallyModified) {
                await this.refreshPerceptionAndTriage(tabId);
              }

              // Retroactive screenshot attachment: update the last DOM-modifying step with the screenshot
              if (this.perception.getLastScreenshot() && this.lastDomStep) {
                this.stepHandler(
                  {
                    ...this.lastDomStep,
                    screenshotUrl: this.perception.getLastScreenshot()!,
                  },
                  true,
                );
                this.lastDomStep = null;
              }

              // Plan monitor: check alignment every 2 turns when plan is active
              this.turnsSinceLastMonitor++;
              if (
                this.taskId &&
                this.planSteps.length > 0 &&
                this.turnsSinceLastMonitor >= 2 &&
                this.perception.getInterpretation() &&
                !this.abortController?.signal.aborted
              ) {
                this.turnsSinceLastMonitor = 0;
                const monitorResult = await this.runPlanMonitor(
                  this.abortController?.signal,
                );
                if (monitorResult) {
                  if (
                    monitorResult.alignment === "deviated" &&
                    this.replanCount < 3
                  ) {
                    await this.handlePlanDeviation(
                      monitorResult,
                      tabId,
                      this.abortController?.signal,
                    );
                  } else if (
                    monitorResult.alignment === "blocked" &&
                    monitorResult.blocker
                  ) {
                    this.context.addMessage({
                      role: "user",
                      content: `[Plan Monitor]: Blocker detected — ${monitorResult.blocker}. Address this before continuing with the current step.`,
                    });
                  }
                  // aligned/progressing → no action needed
                }
              }

              // Progress tracking: detect stuck loops
              const progressSignal = this.stagnation.onSnapshotRefresh(snap);

              // P0: Surface action effect — tell the agent whether its last action changed the page
              // Use visuallyModified (not domModified) so read_page doesn't produce misleading deltas
              const actionEffect = this.stagnation.lastActionEffect;
              if (actionEffect && visuallyModified) {
                const effectLine = formatActionEffect(actionEffect);
                if (effectLine) {
                  this.context.addMessage({
                    role: "user",
                    content: effectLine,
                  });
                  this.traceRecorder?.recordEvent("action_effect", {
                    deltaPercent: actionEffect.deltaPercent,
                    urlChanged: actionEffect.urlChanged,
                    elementsAdded: actionEffect.elementsAdded,
                    elementsRemoved: actionEffect.elementsRemoved,
                  });
                }
                // P1b: Track consecutive zero-effect turns for dual-gating
                if (
                  actionEffect.deltaPercent < ACTION_EFFECT.ZERO_THRESHOLD &&
                  !actionEffect.urlChanged
                ) {
                  this.consecutiveZeroEffectTurns++;
                  if (
                    this.consecutiveZeroEffectTurns >=
                    ACTION_EFFECT.WARNING_THRESHOLD
                  ) {
                    // Use cumulative failure brief if we have enough data
                    const failureBrief = buildFailureBrief(subgoalAttempts);
                    const warningContent = failureBrief
                      ? `[Verification: Last ${this.consecutiveZeroEffectTurns} actions had no observable effect. Here is what was tried:\n${failureBrief}\nTry a fundamentally different strategy.]`
                      : `[Verification: Last ${this.consecutiveZeroEffectTurns} actions had no observable effect on the page. Your current approach is not working — try a fundamentally different strategy (different element, different tool, or different page area).]`;
                    this.context.addMessage({
                      role: "user",
                      content: warningContent,
                    });
                    this.traceRecorder?.recordEvent("zero_effect_warning", {
                      consecutiveTurns: this.consecutiveZeroEffectTurns,
                      hasFailureBrief: !!failureBrief,
                    });
                    this.consecutiveZeroEffectTurns = 0; // reset after warning
                    subgoalAttempts.length = 0; // reset after injection
                  }
                } else {
                  this.consecutiveZeroEffectTurns = 0;
                  subgoalAttempts.length = 0; // reset on progress
                }
              }

              if (progressSignal) {
                this.traceRecorder?.recordProgress(
                  progressSignal.stagnantTurns,
                  progressSignal.type,
                );
                this.traceRecorder?.recordEvent("stuck_signal", {
                  type: progressSignal.type,
                  stagnantTurns: progressSignal.stagnantTurns,
                });
                this.log.warn("agent", "Progress stuck detected", {
                  turn: this.turnCount,
                  type: progressSignal.type,
                  stagnantTurns: progressSignal.stagnantTurns,
                  url: snap.url,
                });

                // Broadcast stagnation signal to side panel
                this.broadcast({
                  type: "AGENT_STAGNATION",
                  payload: {
                    signal: "escalate",
                    stagnantTurns: progressSignal.stagnantTurns,
                    url: snap.url,
                    message: progressSignal.message,
                  },
                });
                wasStuck = true;

                // S3: Fresh-start recovery — full context reset when escalation cycles exhaust
                if (
                  escalationCycles >= FRESH_START.TRIGGER_ESCALATION_CYCLE &&
                  freshStartCount < this.limits.maxFreshStarts &&
                  this.turnCount >= FRESH_START.MIN_TURNS_BEFORE_RESET
                ) {
                  freshStartCount++;
                  const causalSummary = summarizeCausalChain(
                    this.context.getMessages(),
                    ROLLING_DISTILL.MAX_SUMMARY_ENTRIES,
                  );
                  const planState =
                    this.planSubtasks.length > 0
                      ? `Plan: ${this.planSubtasks.map((s, i) => `${i + 1}.[${s.status}] ${s.description}`).join(", ")}`
                      : "";
                  const currentUrl = this.context.getCurrentUrl();
                  const brief = [
                    `FRESH START #${freshStartCount} — previous approach exhausted after ${this.turnCount} turns.`,
                    `Original task: "${this.originalQuery}"`,
                    planState,
                    causalSummary ? `What was tried:\n${causalSummary}` : "",
                    currentUrl ? `Current page: ${currentUrl}` : "",
                    "Start with a completely different strategy. Do NOT repeat previous approaches.",
                  ]
                    .filter(Boolean)
                    .join("\n\n");

                  // Record trace events
                  this.traceRecorder?.recordEvent("fresh_start_recovery", {
                    freshStartNumber: freshStartCount,
                    totalTurnsSoFar: this.turnCount,
                    escalationCycles,
                  });
                  this.traceRecorder?.recordEvent("multi_turn_pathology", {
                    pathology: "compound_degradation",
                    trigger: "fresh_start",
                    turn: this.turnCount,
                    details: `escalationCycles=${escalationCycles} freshStart=${freshStartCount}`,
                  });

                  // Reset context with the brief
                  this.context.clearHistory();
                  this.context.addMessage({ role: "user", content: brief });

                  // Reset loop state
                  this.stagnation.reset();
                  this.toolCache.clear();
                  blockedActions.length = 0;
                  consecutiveTextOnly = 0;
                  recentOutcomes.length = 0;
                  recentSuccesses.length = 0;
                  consecutiveAllFailTurns = 0;
                  escalationCycles = 0;
                  cooldownRemaining = 0;

                  // Ensure planner tier
                  if (escalationTier === 0) {
                    this.escalateModel();
                    escalationTier = 1;
                  }
                  plannerModelStartTurn = this.turnCount;

                  // Refresh snapshot
                  try {
                    const freshSnap = await this.refreshSnapshot(tabId);
                    if (freshSnap) {
                      this.context.setSnapshot(freshSnap);
                    }
                  } catch {
                    /* non-critical */
                  }

                  this.stepHandler(
                    {
                      id: crypto.randomUUID(),
                      type: "info",
                      label: `Fresh start #${freshStartCount} — resetting context`,
                      status: "done",
                      timestamp: Date.now(),
                    },
                    false,
                  );

                  this.log.info("agent", "Fresh-start recovery", {
                    freshStartCount,
                    turn: this.turnCount,
                    escalationCycles,
                  });
                  wasStuck = false;
                  continue;
                }

                // Escalate: executor → planner
                else if (escalationTier === 0 && cooldownRemaining <= 0) {
                  // Invalidate perception cache so the planner model gets a fresh interpretation
                  this.perception.invalidateCache();
                  const attemptSummary = extractAttemptSummary(
                    this.context.getMessages(),
                  );
                  this.escalateModel();
                  escalationTier = 1;
                  orientationPhase = false;
                  plannerModelStartTurn = this.turnCount;
                  await this.strategyPivot(tabId, attemptSummary);
                  this.stagnation.resetEscalation();
                  this.context.addMessage({
                    role: "user",
                    content: ESCALATION_REFLECTION(
                      "no DOM progress detected by stagnation monitor",
                    ),
                  });
                  consecutiveTextOnly = 0;
                  recentSuccesses.length = 0;
                  consecutiveProgressSignals = 0;
                  this.stepHandler(
                    {
                      id: crypto.randomUUID(),
                      type: "info",
                      label: "Stuck — switching to smarter model",
                      status: "done",
                      timestamp: Date.now(),
                    },
                    false,
                  );
                }
              } else if (wasStuck) {
                // Only count as recovery if the page actually changed (stagnantTurns reset to 0).
                // When stagnantTurns > 0, tracker returned null only because it's below threshold
                // or escalation already fired — the agent is still stuck.
                if (this.stagnation.isStillStuck()) {
                  consecutiveProgressSignals = 0;
                } else {
                  consecutiveProgressSignals++;
                }

                // Require PROGRESS_GATE consecutive progress signals before de-escalating
                if (
                  consecutiveProgressSignals >= ESCALATION_LIMITS.PROGRESS_GATE
                ) {
                  this.broadcast({
                    type: "AGENT_STAGNATION",
                    payload: {
                      signal: "resolved",
                      stagnantTurns: 0,
                      url: snap.url,
                      message: "Agent is making progress again.",
                    },
                  });
                  wasStuck = false;
                  consecutiveProgressSignals = 0;

                  // De-escalate if on planner model, under cycle limit,
                  // and the planner model has had enough turns to actually work
                  const plannerTenure = this.turnCount - plannerModelStartTurn;
                  if (
                    escalationTier > 0 &&
                    escalationCycles < this.limits.maxEscalationCycles &&
                    plannerTenure >= ESCALATION_LIMITS.MIN_PLANNER_TENURE
                  ) {
                    prevElementCount = await this.deescalateModel(
                      tabId,
                      prevElementCount,
                    );
                    this.context.addMessage({
                      role: "user",
                      content: DEESCALATION_REFLECTION,
                    });
                    escalationTier = 0;
                    cooldownRemaining =
                      this.limits.escalationCooldown *
                      Math.pow(2, escalationCycles);
                    escalationCycles++;
                    this.stagnation.resetEscalation();

                    this.stepHandler(
                      {
                        id: crypto.randomUUID(),
                        type: "info",
                        label: "Progress made — switching back to executor model",
                        status: "done",
                        timestamp: Date.now(),
                      },
                      false,
                    );
                  }
                }
              } else {
                // Not stuck — reset progress gate
                consecutiveProgressSignals = 0;
              }
            }
          } catch {
            // Non-critical: snapshot refresh failed, continue with stale data
          }
        }

        // S1: Rolling distillation — periodically compress older history
        if (
          this.turnCount > 0 &&
          this.turnCount % ROLLING_DISTILL.INTERVAL === 0 &&
          this.context.getMessages().length >= ROLLING_DISTILL.MIN_MESSAGES
        ) {
          this.context.rollingDistill(
            ROLLING_DISTILL.KEEP_RECENT,
            ROLLING_DISTILL.MAX_SUMMARY_ENTRIES,
          );
        }

        if (doneSignaled) {
          await this.traceRecorder?.endTurn();
          break;
        }
      } else {
        // TEXT RESPONSE — no tool calls

        // Think-only output: model reasoned (rawContent has tokens) but produced
        // no visible text or tool calls after think-tag stripping. Fast-track the
        // text-only counter so escalation fires sooner — the generic nudge doesn't
        // help a model that's stuck in a think loop.
        if (
          !cleanContent &&
          rawContent &&
          rawContent.length > 50 &&
          consecutiveTextOnly < 2
        ) {
          consecutiveTextOnly = 2; // Next text-only turn triggers escalation
          this.log.warn("agent", "Think-only output detected, fast-tracking escalation", {
            turn: this.turnCount,
            rawLen: rawContent.length,
          });
          this.context.addMessage({
            role: "user",
            content:
              "Your response contained only internal reasoning with no output or tool calls. " +
              "You MUST include at least one tool call. Use read_page to inspect the page, " +
              "or done() if the task is already complete.",
          });
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: true },
          });
          await this.traceRecorder?.endTurn();
          continue;
        }

        // Soft nudge: turn 1, no plan, substantive text — likely an answer to a question
        if (
          this.turnCount === 1 &&
          !this.taskId &&
          cleanContent &&
          cleanContent.trim().length > 20
        ) {
          consecutiveTextOnly++;
          totalTextOnly++;
          this.log.info(
            "agent",
            "Soft nudge: turn 1 text response, suggesting done()",
            {
              turn: this.turnCount,
              textLen: cleanContent.trim().length,
            },
          );
          this.context.addMessage({
            role: "user",
            content: `If that was your answer to the user's question, wrap it in done({"summary": "..."}) to deliver it. If you need to act on the page, call the appropriate tool.`,
          });
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: true },
          });
          continue;
        }

        // Text-admission detection: catch when the LLM states success/failure in text
        if (cleanContent) {
          const admission = detectAdmission(cleanContent);
          if (admission) {
            this.log.info("agent", "Text admission detected", {
              turn: this.turnCount,
              type: admission.type,
              match: admission.match,
            });
            this.traceRecorder?.recordEvent("text_admission_detected", {
              type: admission.type,
              match: admission.match,
            });
            const nudge =
              admission.type === "success"
                ? `You stated: "${admission.match}". Call done() to deliver the result.`
                : `You stated: "${admission.match}". Call done() to report inability, or call escalate() for help.`;
            this.context.addMessage({ role: "user", content: nudge });
            this.broadcast({
              type: "STREAM_CHUNK",
              payload: { delta: "", done: true },
            });
            continue;
          }
        }

        // Text-only escalation: uniform counting, progress-aware
        const filler = cleanContent ? isFillerText(cleanContent) : true;
        // Hallucination fast-tracks: bypass nudge, go straight to escalation
        if (hallucinationDetected) {
          consecutiveTextOnly = Math.max(consecutiveTextOnly, 3);
        } else {
          consecutiveTextOnly += 1; // Uniform counting — no filler fast-track
        }

        // Progress immunity: if the last action changed the page, don't escalate yet
        const lastEffect = this.stagnation.lastActionEffect;
        const recentProgress = lastEffect && (
          lastEffect.deltaPercent > ACTION_EFFECT.ZERO_THRESHOLD ||
          lastEffect.urlChanged
        );
        if (recentProgress) {
          consecutiveTextOnly = Math.max(0, consecutiveTextOnly - 1);
        }

        totalTextOnly++;
        this.log.warn("agent", "LLM emitted text instead of tools", {
          turn: this.turnCount,
          consecutiveTextOnly,
          tier: escalationTier,
          filler,
          recentProgress: !!recentProgress,
          text: cleanContent?.slice(0, 80),
        });

        // S6: Record pathology for text-only responses
        if (consecutiveTextOnly >= 3) {
          this.traceRecorder?.recordEvent("multi_turn_pathology", {
            pathology: filler ? "verbosity" : "premature_generation",
            trigger: "text_only_response",
            turn: this.turnCount,
            details: `consecutiveTextOnly=${consecutiveTextOnly} filler=${filler}`,
          });
        }

        // Escalate to next tier on 3rd consecutive text-only (with minimum turn gate)
        if (
          consecutiveTextOnly >= 3 &&
          escalationTier < 1 &&
          cooldownRemaining <= 0 &&
          this.turnCount >= 4
        ) {
          const textOnlyAttemptSummary = extractAttemptSummary(
            this.context.getMessages(),
          );
          this.escalateModel();
          escalationTier = 1;
          orientationPhase = false;
          plannerModelStartTurn = this.turnCount;
          await this.strategyPivot(tabId, textOnlyAttemptSummary);
          this.stagnation.resetEscalation();
          this.context.addMessage({
            role: "user",
            content: ESCALATION_REFLECTION(
              "consecutive text-only responses without tool calls",
            ),
          });
          consecutiveTextOnly = 0;
          recentSuccesses.length = 0;
          this.stepHandler(
            {
              id: crypto.randomUUID(),
              type: "info",
              label: "Switching to smarter model",
              status: "done",
              timestamp: Date.now(),
            },
            false,
          );
          this.statusHandler(AgentStatus.THINKING, "Escalating model...");
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: true },
          });
          continue;
        }

        // Give-up: 4 consecutive text-only at max tier
        if (consecutiveTextOnly >= 4) {
          this.log.warn("agent", "Loop ended: consecutive text-only limit", {
            turns: this.turnCount,
            consecutiveTextOnly,
            totalTextOnly,
            tier: escalationTier,
          });
          const stuckMsg =
            cleanContent || "The agent appears stuck and cannot continue.";
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: false, replaceContent: stuckMsg },
          });
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: true },
          });
          this.statusHandler(
            AgentStatus.IDLE,
            "Stalled — send a follow-up to continue",
          );
          await this.traceRecorder?.endTurn();
          break;
        }

        // Planner model turn-based give-up
        const plannerTurns =
          escalationTier > 0 ? this.turnCount - plannerModelStartTurn : 0;
        if (
          escalationTier > 0 &&
          plannerTurns >= this.limits.stuckGiveUpPlanner &&
          totalTextOnly >= 3
        ) {
          this.log.warn("agent", "Loop ended: planner model turn limit", {
            turns: this.turnCount,
            plannerTurns,
            totalTextOnly,
            tier: escalationTier,
          });
          const stuckMsg =
            "The agent is struggling to make progress. Send a follow-up with more specific instructions.";
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: false, replaceContent: stuckMsg },
          });
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: true },
          });
          this.statusHandler(
            AgentStatus.IDLE,
            "Stalled — send a follow-up to continue",
          );
          await this.traceRecorder?.endTurn();
          break;
        }

        // Regular nudge: refresh snapshot + perception + inject message
        const count = await this.refreshSnapshot(tabId);
        if (count >= 0) prevElementCount = count;
        await this.refreshPerceptionAndTriage(tabId);
        this.context.addMessage({
          role: "user",
          content: TEXT_ONLY_CORRECTION,
        });

        // Trace: flush turn
        await this.traceRecorder?.endTurn();
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: true },
        });
        continue;
      }

      // Trace: flush turn at end of each iteration
      await this.traceRecorder?.endTurn();
    }

    if (this.turnCount >= this.maxTurns) {
      this.log.warn("agent", "Loop ended: max turns reached", {
        turns: this.turnCount,
        maxTurns: this.maxTurns,
      });
      const limitMsg = `Reached turn limit (${this.turnCount}/${this.maxTurns}). You can increase the limit in Settings or send a follow-up message to continue.`;
      this.broadcast({
        type: "STREAM_CHUNK",
        payload: { delta: "", done: false, replaceContent: limitMsg },
      });
      this.broadcast({
        type: "STREAM_CHUNK",
        payload: { delta: "", done: true },
      });
      this.statusHandler(
        AgentStatus.IDLE,
        `Turn limit (${this.turnCount}/${this.maxTurns})`,
      );
      return {
        outcome: "max_turns" as const,
        turnCount: this.turnCount,
        summary: limitMsg,
        failure: {
          category: "budget",
          code: "turn_limit_reached",
          detail: limitMsg,
        },
        metrics: this.getMetrics(),
      };
    }

    return {
      outcome: "completed" as const,
      turnCount: this.turnCount,
      summary: doneSummary,
      failure: { category: "none", code: "none" },
      metrics: this.getMetrics(),
    };
  }

  /**
   * Resume the agent loop from a saved state (after navigation).
   * Called by the navigation bridge when webNavigation.onCompleted fires.
   */
  public async resumeFromNavigation(
    savedState: AgentLoopState,
    newSnapshot?: DomSnapshot,
  ) {
    if (this.isRunning) {
      this.stop();
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    // Restore context from saved state
    this.context.restoreFromState(savedState.messages);

    if (newSnapshot) {
      this.context.setSnapshot(newSnapshot);
    }

    this.statusHandler(AgentStatus.THINKING, "Resuming after navigation...");

    const tabId = savedState.activeTabId;

    try {
      await this.loop(tabId);
    } catch (error: any) {
      if (error.name === "AbortError") {
        this.log.info("agent", "Agent stopped by user");
        this.statusHandler(AgentStatus.IDLE, "Stopped");
      } else {
        this.log.error("agent", "Loop Error", { error });
        const errorMsg = `Agent stopped: ${error.message}. Send a follow-up message to retry.`;
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: false, replaceContent: errorMsg },
        });
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: true },
        });
        this.statusHandler(AgentStatus.ERROR, error.message);
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get current loop state for saving before navigation.
   */
  public getState(tabId: number): AgentLoopState {
    // Cast LLMMessage[] to ChatMessage[] - they are compatible at runtime
    const messages =
      this.context.getMessages() as unknown as import("../../types").ChatMessage[];
    return {
      status: AgentStatus.WAITING_FOR_PAGE_LOAD,
      messages,
      originalQuery: this.originalQuery,
      turnCount: this.turnCount,
      maxTurns: this.maxTurns,
      activeTabId: tabId,
      workspaceId: this.workspaceId,
      workerId: this.workerId,
      lastActivityTs: Date.now(),
      pendingToolCall: null,
    };
  }
}
