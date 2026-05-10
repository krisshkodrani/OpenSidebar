import {
  AgentStatus,
  AgentLoopState,
  AgentStep,
  Citation,
  MessageSource,
  PerceptionRuntimeMode,
  RiskLevel,
  SessionMetrics,
  SubtaskSummary,
  ToolDefinition,
  ToolCall,
  ToolName,
} from "../../types";
import { logger, SessionScopedLogger } from "../../utils";
import {
  extractPerceptionPageSignals,
  resolvePerceptionRuntimeMode,
  resolvePerceptionRuntimeModeDecision,
} from "../../utils/perception-mode";
import { LLMClient } from "../llm";
import { toolRegistry } from "../tools";
import { resolveToolProfile } from "../tools/metadata";
import type { ToolProfile } from "../tools/metadata";
import { waitForDomReady } from "../tab-ready";
import {
  isBridgeDisconnect,
  recoverContentScriptBridge,
  type BridgeRecoveryTraceHook,
} from "../tools/bridge";
import { workspaceManager } from "../workspaces/manager";
import { ContextManager, summarizeCausalChain } from "./context";
import {
  assessDoneSummary,
  assessWorkflowDoneGuard,
  checkSummaryStepCoherence,
  detectAdmission,
} from "./verification";
import { StagnationMonitor, computeSnapshotFingerprint } from "./stagnation";
import { createResultPageProgressState } from "./result-page-progress-policy";
import { buildElementSummary } from "../perception";
import { PerceptionAgent } from "../perception/perception-agent";
import type { PanoramicShot, PerceptionTaskContext } from "../perception/types";
import { DomSnapshot } from "../../types";
import {
  CompletionResponse,
  LLMMessage,
  ProviderConfig,
  TokenUsage,
} from "../llm/types";
import {
  formatStepLabel,
  buildElementResolver,
  ElementResolver,
} from "./step-labels";
import { TaskPlanner, PlanStep, PlanMonitorResult } from "./planner";
import { TraceRecorder } from "./trace";
import { validateNuisanceBlockers } from "./popup-triage";
import { ToolResultCache } from "./tool-cache";
import { completeTurnWithRetries } from "./turn-completion";
import { prepareLlmTurnRequest } from "./loop-turn-preparation";
import { processLlmTurnResponse } from "./loop-response-processing";
import { resolveInitialSnapshot } from "./initial-snapshot";
import { bootstrapRuntimePlan } from "./start-planner-bootstrap";
import { PendingInteractionYield, runStartExecution } from "./start-result";
import { finalizeStartResult } from "./start-finalization";
import { prepareToolCallBranch } from "./tool-call-branch-setup";
import { AgentMiddleware } from "./middleware";
import { EvidenceAccumulator } from "./evidence";
import {
  TURN_CHECKPOINT_VERSION,
  turnCheckpointKey,
  buildMutationKey,
} from "./checkpoint-types";
import type { TurnCheckpoint } from "./checkpoint-types";
import { MutationLedger } from "./mutation-ledger";
import { type MoneyTableAggregate } from "./money-table-aggregate";
import {
  getAutocompleteSuggestionDoneRejection,
  isTextLikeInputElement,
  normalizeGuardText,
} from "./text-entry-guards";
export {
  rewriteAutocompleteTextEntry,
  validateTextEntryTarget,
} from "./text-entry-guards";
import {
  countVisibleListDetailActions,
  getListDetailDoneRejection,
  getListDetailReturnControl,
  getListDetailWorkflowBlock,
  getNextUnreviewedListDetailAction,
  hasListDetailReturnControl,
  isListDetailReturnControlRepeatExempt,
  listDetailActionTargetLabel,
  listDetailElementLabel,
} from "./list-detail-policy";
export {
  countVisibleListDetailActions,
  getListDetailDoneRejection,
  getListDetailWorkflowBlock,
  getNextUnreviewedListDetailAction,
  isListDetailReturnControlRepeatExempt,
  requiresBroadListDetailReview,
} from "./list-detail-policy";
import { isPaginationNavigationClick } from "./action-exemption-policy";
import { getCachedScreenshot, setCachedScreenshot } from "./screenshot-cache";
import {
  canSpendImagePromptBudget,
  emptySessionMetrics,
  estimateImagePromptUsage,
  imagePromptUsageForCount,
  recordCachedVisionTelemetryUse,
  recordCompletionUsage,
  recordImagePromptUsage,
  recordPerceptionModeDecision,
  recordTelemetryCitation,
  recordVisionTelemetryUsage,
  resolveImagePromptTokenBudget,
} from "./agent-telemetry";
import {
  approvalRequestMessage,
  BroadcastMessage,
  clarificationRequestMessage,
  forwardSuppressedStreamChunk,
  planTerminationMessage,
  runtimeBroadcastMessage,
  sessionMetricsMessage,
  sessionMetricsSnapshot,
  shouldBroadcastSessionMetrics,
  successfulTaskCompletionMessage,
  taskProgressMessage,
} from "./agent-broadcast";
import {
  approvalRequestStep,
  clarificationRequestStep,
} from "./agent-interaction-steps";
import {
  buildCompletedPlanStepSummaries,
  buildFailedPlanStep,
  buildPlanMonitorReplanMessage,
  buildPlanReplacementState,
  buildPlanRevisionMessage,
  buildPlanStatusSnapshot,
  buildRestoredPlanState,
  type RestorablePlanState,
} from "./agent-plan-progress";
import { applySkillTurnCap } from "./skill-turn-cap-policy";
import { countExplicitSteps } from "./explicit-steps";
import { shouldOmitPerceptionForDoneValidation } from "./perception-done-validation";
export {
  isPerceptionFailurePlaceholder,
  shouldOmitPerceptionForDoneValidation,
} from "./perception-done-validation";
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
  INVESTIGATION_EXTENSION,
  MAX_ORIENTATION_TURNS,
  EXPLORATION_BUDGET,
  EXPLORATION_ONLY_TOOLS,
} from "./constants";
import type { Difficulty, RuntimeLimits } from "./constants";
// reassessRuntimeLimits is available from "./constants" for mid-session S5 reassessment
import { APPROVAL_TIMEOUT_MS, MAX_SESSION_MS } from "./loop-metrics";
import type { LoopResult } from "./loop-types";
import type {
  PendingApprovalInteraction,
  PendingClarificationInteraction,
  PendingUserInteraction,
} from "./loop-types";
import { getLoadedSkillContract } from "../orchestrator/skills";
import { evaluateWorkflowTabRedirect } from "./workflow-tab-controller";
import {
  BlockedAction,
  assessDeadEndPattern,
  assessSameUrlForcedEscalation,
  assessStepDurationWatchdog,
  buildOverlayRecoveryCompletionSummary,
  buildFailureBrief,
  buildHandoffBriefing,
  buildSubgoalAttempt,
  buildStructuredFailureContext,
  buildZeroEffectDecision,
  buildFirstTurnTextOnlyNudge,
  countTrailingToolResultOutcomes,
  detectInstructionContradiction,
  detectFormSubmissionResetSuccess,
  detectPendingAsyncChange,
  detectStructuralStepAdvance,
  detectTrustedFormFillStepCompletion,
  detectTrustedFormSubmitCompletion,
  extractAttemptSummary,
  evaluateDoneTaskContractGuard,
  formatStateEvidence,
  formatStructuredFailureContext,
  getSnapshotFingerprint,
  isDoneSummaryGroundedInSnapshot,
  isPendingAsyncChangeSatisfied,
  isFillerText,
  matchSuccessCriteria,
  recordRecentOutcome,
  recordRecentSuccessfulAction,
  type RecentOutcome,
  RecentAction,
  requiresGroundingReadBeforeDone,
  shouldTrackFormSubmissionReset,
  SubgoalAttempt,
  tokenizeStepText,
  updateConsecutiveAllFailTurns,
  updateExplorationBudget,
  updatePostEscalationPivot,
  updateSameToolFailureTracking,
  userExplicitlyRequestedTabManagement,
} from "./loop-helpers";
import {
  assessTaskContractCoverage,
  buildTaskContract,
  extractFieldValuePairs,
} from "./task-contract";
import {
  DEESCALATION_REFLECTION,
  ESCALATION_RECOVERY,
  ESCALATION_REFLECTION,
  HANDOFF_REFLECTION,
  PIVOT_MESSAGE,
  TEXT_ONLY_CORRECTION,
} from "./loop-prompts";
import {
  advanceCompletedSubtasks,
  completeRemainingSubtasks,
  completeSingleSubtask,
  type AgentLoopPlanProgressHost,
} from "./loop-plan-progress";
import {
  applySkillToolRanking,
  applySkillToolSuppression,
  applyToolProfile,
  classifySkillToolPreference,
  getActiveSkillToolPolicy,
  getActiveToolProfileForStep,
  isSkillOwnedListDetailReview,
  isSkillOwnedMultiTabChecklistLoop,
  recordSkillToolSelection,
  type AgentLoopSkillToolsHost,
} from "./loop-skill-tools";
import {
  getIncompleteMoneyTableAggregateDoneRejection,
  getIncorrectMoneyTableAggregateDoneRejection,
  hydrateMoneyTableAggregateFromWorkingNotes,
  isCompletedMoneyTableAggregateSummary,
  isMoneyTableAggregateTask,
  updateMoneyTableAggregate,
  updateMoneyTableAggregateFromSnapshot,
  type AgentLoopMoneyTableHost,
} from "./loop-money-table";
import { buildConsequentialActionTaskText } from "./consequential-action-context";
import { assessConsequentialActionApproval } from "./consequential-action-policy";
import {
  addParallelToolResultsToContext,
  handleParallelVerificationGate,
  type ParallelToolExecutionResult,
} from "./parallel-tool-execution";
import {
  executeParallelToolCalls,
  type ParallelToolDispatchHost,
} from "./parallel-tool-dispatch";
import {
  executeSequentialToolCalls,
  type SequentialToolDispatchOutput,
  type SequentialToolDispatchHost,
} from "./sequential-tool-dispatch";
import { collectTurnToolOutcomeRecords } from "./turn-tool-outcomes";
import {
  refreshPostToolSnapshot,
  type PostToolSnapshotRefreshHost,
} from "./post-tool-snapshot-refresh";

export function isDoneSummaryAskingClarification(summary: string): boolean {
  const text = summary.trim();
  if (!text.includes("?")) return false;

  const lower = text.toLowerCase();
  const hasCompletionFrame =
    /\b(completed|successfully|identified|found|located|confirmed|verified|posted|sent|drafted|updated|read|analysis complete|summary)\b/.test(
      lower,
    );
  if (hasCompletionFrame) return false;

  if (
    /^(can|could|should|do|does|did|is|are|which|what|when|where|who|why|how|would|please)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  return /\?$/.test(text);
}

const REPEAT_ACTION_WINDOW = 20;
const CAPTURE_VISIBLE_TAB_RETRY_DELAY_MS = 300;

type TrustedCatalogOrderSubmission = {
  itemName: string | null;
  quantity: string | null;
  configuredResult: string;
  submittedAtTurn: number;
};

type ParsedServiceNowModuleRequest = {
  application: string;
  path: string[];
};

function cleanServiceNowModuleLabel(value: string): string {
  return value
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/^["'\s]+|["'.\s]+$/g, "")
    .replace(/^the\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractServiceNowModuleRequest(
  text: string,
): ParsedServiceNowModuleRequest | null {
  const normalized = text.replace(/\s+/g, " ");
  const patterns = [
    /\b(?:navigate to|open)\s+(?:the\s+)?["\u201c]([^"\u201d]+)["\u201d]\s+module\s+(?:of|in)\s+(?:the\s+)?["\u201c]([^"\u201d]+)["\u201d]\s+application\b/i,
    /\b(?:navigate to|open)\s+(?:the\s+)?(.+?)\s+module\s+(?:of|in)\s+(?:the\s+)?(.+?)\s+application\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (!match) continue;
    const rawPath = cleanServiceNowModuleLabel(match[1] ?? "");
    const application = cleanServiceNowModuleLabel(match[2] ?? "");
    const path = rawPath
      .split(/\s*>\s*|\s*\/\s*/)
      .map(cleanServiceNowModuleLabel)
      .filter(Boolean);
    if (application && path.length > 0) {
      return { application, path };
    }
  }
  return null;
}

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
  private getActiveSkillToolPolicy() {
    return getActiveSkillToolPolicy(this as unknown as AgentLoopSkillToolsHost);
  }

  private classifySkillToolPreference(
    toolName: ToolName,
  ): "preferred" | "discouraged" | "neutral" | null {
    return classifySkillToolPreference(
      this as unknown as AgentLoopSkillToolsHost,
      toolName,
    );
  }

  private applySkillToolRanking(tools: ToolDefinition[]): ToolDefinition[] {
    return applySkillToolRanking(
      this as unknown as AgentLoopSkillToolsHost,
      tools,
    );
  }

  private applySkillToolSuppression(tools: ToolDefinition[]): ToolDefinition[] {
    return applySkillToolSuppression(
      this as unknown as AgentLoopSkillToolsHost,
      tools,
    );
  }

  private recordSkillToolSelection(
    toolName: ToolName,
    mode: "parallel" | "sequential",
  ): void {
    recordSkillToolSelection(
      this as unknown as AgentLoopSkillToolsHost,
      toolName,
      mode,
    );
  }

  /**
   * Set the moment done() is accepted, BEFORE post-processing (trace, metrics,
   * verification). The orchestrator reads this after a lane timeout to avoid
   * retrying a subtask that already completed — prevents duplicate actions
   * (e.g. adding the same item to cart multiple times).
   */
  public completedResult: { outcome: "completed"; summary: string } | null =
    null;

  private llm: LLMClient;
  private context: ContextManager;
  private baseContextTokens: number; // Original context window size for de-escalation restore
  private isRunning = false;
  private abortController: AbortController | null = null;
  private gracefulStopRequested = false;
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
  private verificationTurnMode: boolean;
  private initialPlanState: RestorablePlanState | null;
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
  public readonly selectedSkillId: string | null;

  /** Current turn count — exposed via getCurrentTurn() */
  private turnCount = 0;
  /** Original user query that started this loop */
  private originalQuery = "";
  public readonly enabledSkillPackIds?: string[];
  private moneyTableAggregate: MoneyTableAggregate | null = null;
  /** Progress tracker — promoted from local to instance for external access */
  private stagnation = new StagnationMonitor();
  /** Durable mutation replay guard and side-effect log. */
  private mutationLedger = new MutationLedger();
  /** Turn checkpoint to restore from (injected by orchestrator on restart). */
  private pendingTurnCheckpoint: TurnCheckpoint | null = null;
  /** Pending interaction response injected by orchestrator on resume. */
  private resumeInteraction: PendingUserInteraction | null = null;
  /** Unified VL executor mode: screenshot sent directly to executor, skip separate perception */
  private useVLExecutor = false;
  private perceptionModeOption?: PerceptionRuntimeMode;
  private useVLExecutorOption?: boolean;
  private maxImagePromptTokenEstimate?: number;
  private providerModeOption?:
    | "openrouter"
    | "openrouter-groq"
    | "openai-groq"
    | "fireworks"
    | "fireworks-deepseek"
    | "moonshot"
    | "xiaomi";
  /** When true, mutation replay guard persists across turns (set after done() rejection) */
  private guardAfterDoneRejection = false;
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
  /** Whether read_page or xray_page has been called at least once this session */
  private hasReadPage = false;
  /** Whether read_page has been explicitly called rather than inferred from initial context. */
  private hasExplicitPageRead = false;
  /** Turns spent on the current plan step */
  private turnsOnCurrentStep = 0;
  /** Last plan index — used to detect step transitions */
  private lastPlanIndex = 0;
  /** Escalation count on current plan step — resets on step advancement */
  private escalationsOnCurrentStep = 0;
  /** Consecutive done()-based auto-advances without a DOM-modifying action in between */
  private consecutiveAutoAdvances = 0;
  /** Detail targets opened while executing a list/detail review skill. */
  private listDetailOpenedTargets = new Set<string>();
  /** Detail targets that have evidence from a detail read or saved note. */
  private listDetailReviewedTargets = new Set<string>();
  /** Current detail target opened from the list and awaiting evidence capture. */
  private listDetailCurrentTarget: string | null = null;
  /** Whether the current detail target has had a detail-page read. */
  private listDetailCurrentTargetRead = false;
  /** Largest visible detail-action set observed for the active list/detail review. */
  private listDetailVisibleActionCount = 0;
  /** Trusted catalog helper evidence waiting for the next request confirmation page. */
  private trustedCatalogOrderSubmission: TrustedCatalogOrderSubmission | null =
    null;

  /** Task planning state */
  private taskId: string | null = null;
  private planSubtasks: SubtaskSummary[] = [];
  private planSteps: PlanStep[] = [];
  private planRequiresTabManagement = false;
  private stepRetryCount = 0;
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
  private pendingAsyncVerification: {
    stepIndex: number;
    expectedTokens: string[];
    baselineLoadingKeywords: string[];
    reason: string;
    startedTurn: number;
  } | null = null;
  private pendingFormSubmissionReset: {
    stepIndex: number;
    stepDescription: string;
    successCriteria?: string;
    preActionSnapshot: DomSnapshot;
    toolName: string;
    toolArgs?: Record<string, unknown>;
    startedTurn: number;
  } | null = null;
  private pendingInlineEditVerification: {
    stepIndex: number;
    reason: string;
  } | null = null;
  private evidenceAccumulator = new EvidenceAccumulator();

  /** Collected source citations (deduplicated by URL) */
  private citations: Citation[] = [];
  private citationUrls = new Set<string>();

  /** Accumulated session metrics */
  private metrics: SessionMetrics = emptySessionMetrics();
  private sessionStartTime = 0;

  /** Accumulate usage from an LLM response */
  private recordUsage(response: CompletionResponse, llmMs: number): void {
    recordCompletionUsage({
      metrics: this.metrics,
      response,
      llmMs,
      currentProvider:
        this.llm.getCurrentProvider() as ProviderConfig["providerId"],
      currentModel: this.llm.getCurrentModel(),
      onCacheHit: (cacheHit) => this.log.debug("agent", "Cache hit", cacheHit),
    });
  }

  /** Record usage from a vision API call */
  public recordVisionUsage(
    usage: TokenUsage,
    llmMs: number,
    model: string,
    providerId: ProviderConfig["providerId"] = "openrouter",
    imageCount = 0,
  ): void {
    recordVisionTelemetryUsage({
      metrics: this.metrics,
      usage,
      llmMs,
      model,
      providerId,
      imagePrompt: imagePromptUsageForCount(imageCount),
    });
  }

  /** Record estimated image prompt tokens for direct screenshot-backed LLM calls. */
  private recordPromptImageUsage(messages: LLMMessage[]): void {
    recordImagePromptUsage(this.metrics, estimateImagePromptUsage(messages));
  }

  private imagePromptBudgetAllows(imageCount: number): boolean {
    return canSpendImagePromptBudget(
      this.metrics,
      imagePromptUsageForCount(imageCount),
      this.maxImagePromptTokenEstimate,
    );
  }

  private recordImagePromptBudgetExhausted(
    imageCount: number,
    source: string,
  ): void {
    const requested = imagePromptUsageForCount(imageCount);
    const used = this.metrics.totalImagePromptTokenEstimate ?? 0;
    const max = resolveImagePromptTokenBudget(this.maxImagePromptTokenEstimate);
    const detail = {
      source,
      requestedImages: imageCount,
      requestedTokenEstimate: requested.estimatedTokens,
      usedTokenEstimate: used,
      maxTokenEstimate: max,
      remainingTokenEstimate: Math.max(0, max - used),
    };
    this.traceRecorder?.recordEvent("image_prompt_budget_exhausted", detail);
    this.log.info("agent", "Image prompt budget exhausted", detail);
  }

  /** Get the current accumulated metrics snapshot */
  public getMetrics(): SessionMetrics {
    return sessionMetricsSnapshot({
      metrics: this.metrics,
      now: Date.now(),
      sessionStartTime: this.sessionStartTime,
    });
  }

  /** Record a citation for a URL the agent visited or read */
  private recordCitation(url: string, title: string, tool: ToolName): void {
    recordTelemetryCitation({
      citations: this.citations,
      citationUrls: this.citationUrls,
      url,
      title,
      tool,
      turn: this.turnCount,
    });
  }

  /** Get collected citations */
  public getCitations(): Citation[] {
    return this.citations;
  }

  /** Broadcast metrics to side panel (throttled) */
  private broadcastMetrics(): void {
    if (
      !shouldBroadcastSessionMetrics({
        showSessionMetrics: this.showSessionMetrics,
        turnCount: this.turnCount,
        interval: BROADCAST_INTERVALS.METRICS,
      })
    )
      return;

    this.metrics.totalSessionTimeMs = Date.now() - this.sessionStartTime;
    this.broadcast(sessionMetricsMessage(this.metrics));
  }

  private broadcastFinalMetrics(): void {
    if (!this.showSessionMetrics) return;
    this.metrics.totalSessionTimeMs = Date.now() - this.sessionStartTime;
    this.broadcast(sessionMetricsMessage(this.metrics));
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
      selectedSkillId?: string | null;
      enabledSkillPackIds?: string[];
      suppressUiBroadcast?: boolean;
      /** Called for STREAM_CHUNK even when suppressUiBroadcast is true.
       *  Allows orchestrator to forward content for single-node tasks. */
      onStreamChunk?: (
        delta: string,
        done: boolean,
        replaceContent?: string,
        thinking?: string,
      ) => void;
      initialPlanState?: RestorablePlanState;
      verificationTurnMode?: boolean;
      disableInternalPlanning?: boolean;
      bypassApprovals?: boolean;
      approvalTimeoutMs?: number;
      executorModel?: string;
      plannerModel?: string;
      useNitro?: boolean;
      providerMode?:
        | "openrouter"
        | "openrouter-groq"
        | "openai-groq"
        | "fireworks"
        | "fireworks-deepseek"
        | "moonshot"
        | "xiaomi";
      provider?: "openrouter" | "openai" | "groq"; // legacy compat
      openaiApiKey?: string;
      groqApiKey?: string;
      fireworksApiKey?: string;
      deepseekApiKey?: string;
      kimiApiKey?: string;
      xiaomiApiKey?: string;
      temperature?: number;
      perceptionMode?: PerceptionRuntimeMode;
      maxImagePromptTokenEstimate?: number;
      useVLExecutor?: boolean;
      /** Durable turn checkpoint from a prior SW lifetime — injected by orchestrator on restart. */
      turnCheckpoint?: TurnCheckpoint | null;
      /** Pending user interaction state injected by the orchestrator on resume. */
      resumeInteraction?: PendingUserInteraction | null;
    },
  ) {
    this.showSessionMetrics = options?.showSessionMetrics ?? false;
    this.perceptionModeOption = options?.perceptionMode;
    this.useVLExecutorOption = options?.useVLExecutor;
    this.maxImagePromptTokenEstimate = options?.maxImagePromptTokenEstimate;
    this.providerModeOption = options?.providerMode;
    // Initial observation path. start() refines auto mode once task/page
    // signals are available from the initial snapshot.
    this.useVLExecutor =
      resolvePerceptionRuntimeMode({
        perceptionMode: this.perceptionModeOption,
        useVLExecutor: this.useVLExecutorOption,
        providerMode: this.providerModeOption,
      }) === "unified_vl";
    this.preferredModelTier = options?.preferredModelTier ?? "default";
    this.executionContract = options?.executionContract ?? null;
    this.verificationTurnMode = options?.verificationTurnMode ?? false;
    this.initialPlanState = options?.initialPlanState ?? null;
    this.disabledTools = options?.disabledTools ?? new Set<ToolName>();
    this.workspaceId = options?.workspaceId ?? null;
    this.workerId = options?.workerId ?? null;
    this.taskIdRef = options?.taskId ?? null;
    this.nodeId = options?.nodeId ?? null;
    this.runId = options?.runId ?? null;
    this.correlationId = options?.correlationId ?? this.runId ?? null;
    this.selectedSkillId = options?.selectedSkillId ?? null;
    this.enabledSkillPackIds = options?.enabledSkillPackIds
      ? [...options.enabledSkillPackIds]
      : undefined;
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
    const modelOverrides: import("../llm").LLMClientOptions = {
      executorModel: options?.executorModel,
      plannerModel: options?.plannerModel,
      useNitro: options?.useNitro,
      providerMode: options?.providerMode,
      provider: options?.provider,
      openaiApiKey: options?.openaiApiKey,
      groqApiKey: options?.groqApiKey,
      fireworksApiKey: options?.fireworksApiKey,
      deepseekApiKey: options?.deepseekApiKey,
      kimiApiKey: options?.kimiApiKey,
      xiaomiApiKey: options?.xiaomiApiKey,
      temperature: options?.temperature,
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
    const requestedMaxTurns =
      options?.maxTurns ?? AGENT_LIMITS.MAX_TURNS_DEFAULT;
    this.maxTurns = applySkillTurnCap(this.selectedSkillId, requestedMaxTurns);
    this.pendingTurnCheckpoint = options?.turnCheckpoint ?? null;
    this.resumeInteraction = options?.resumeInteraction ?? null;

    this.applyInitialPlanState();
  }

  private applyInitialPlanState(): void {
    if (!this.initialPlanState || this.initialPlanState.subtasks.length === 0) {
      return;
    }

    this.taskId = this.taskIdRef;
    this.taskStartTime = Date.now();
    const restored = buildRestoredPlanState(this.initialPlanState);
    this.planSubtasks = restored.planSubtasks;
    this.planSteps = restored.planSteps;
    this.lastPlanIndex = restored.currentIndex;
    this.context.setPlanStatus(restored.statusEntries, restored.currentIndex);
  }

  // ---------------------------------------------------------------------------
  // Durable turn checkpoints (Phase 1 + 2)
  // ---------------------------------------------------------------------------

  /**
   * Persist loop-local state so a fresh AgentLoop can resume after SW restart.
   * Called once per turn, after tool results are committed and before the next
   * LLM call. Fire-and-forget — checkpoint failure must not block the loop.
   */
  private async saveTurnCheckpoint(): Promise<void> {
    if (!this.nodeId || !this.workspaceId) return;
    try {
      const snapshot = this.context.getSnapshot?.() ?? null;
      const cp: TurnCheckpoint = {
        version: TURN_CHECKPOINT_VERSION,
        workspaceId: this.workspaceId,
        nodeId: this.nodeId,
        savedAt: Date.now(),

        // Loop runtime
        turnCount: this.turnCount,
        maxTurns: this.maxTurns,
        currentPlanIndex: this.lastPlanIndex,
        turnsOnCurrentStep: this.turnsOnCurrentStep,
        escalationsOnCurrentStep: this.escalationsOnCurrentStep,
        guardAfterDoneRejection: this.guardAfterDoneRejection,

        // Context / prompt state
        history: this.context.exportForCheckpoint(),
        planStatus: this.context.getPlanStatusRaw(),
        workingNotes: this.context.getWorkingNotes(),
        lastActionOutcome: this.context.getLastActionOutcome(),
        modelTier: this.llm.isPlannerTier() ? "planner" : "executor",
        isFirstTurn: this.context.getIsFirstTurn(),

        // Resume validation
        snapshotFingerprint: getSnapshotFingerprint(snapshot),
        pageUrl: snapshot?.url ?? null,

        // Phase 2
        stepMutationLedger: this.mutationLedger.entries,

        // Phase 4
        sideEffectsLog: this.mutationLedger.sideEffects,
      };
      const key = turnCheckpointKey(this.workspaceId, this.nodeId);
      await chrome.storage.local.set({ [key]: cp });
    } catch (e) {
      this.log.warn("agent", "Failed to save turn checkpoint", { error: e });
    }
  }

  /**
   * Restore loop-local state from a durable turn checkpoint injected by the
   * orchestrator. Returns true if restoration succeeded, false otherwise.
   *
   * The caller (start path) should compare the live page fingerprint before
   * calling this — if the page diverged materially, skip restore.
   */
  private restoreFromTurnCheckpoint(cp: TurnCheckpoint): boolean {
    try {
      // Runtime counters
      this.turnCount = cp.turnCount;
      this.maxTurns = applySkillTurnCap(
        this.selectedSkillId,
        Math.max(this.maxTurns, cp.maxTurns),
      );
      this.lastPlanIndex = cp.currentPlanIndex;
      this.turnsOnCurrentStep = cp.turnsOnCurrentStep;
      this.escalationsOnCurrentStep = cp.escalationsOnCurrentStep;
      this.guardAfterDoneRejection = cp.guardAfterDoneRejection;

      // Context / history
      this.context.restoreFromCheckpointHistory(cp.history, cp.isFirstTurn);
      if (cp.planStatus) {
        this.context.setPlanStatus(
          cp.planStatus.subtasks,
          cp.planStatus.currentIndex,
        );
      }
      if (cp.workingNotes) {
        this.context.setWorkingNotes(cp.workingNotes);
      }
      if (cp.lastActionOutcome) {
        this.context.setLastActionOutcome(cp.lastActionOutcome);
      }
      if (cp.modelTier === "planner") {
        this.llm.switchToPlanner();
      } else {
        this.llm.switchToExecutor();
      }

      this.mutationLedger.restore(cp.stepMutationLedger, cp.sideEffectsLog);

      this.log.info("agent", "Restored from turn checkpoint", {
        turn: cp.turnCount,
        historyMessages: cp.history.originalCount,
        ledgerEntries: this.mutationLedger.entries.length,
        sideEffects: this.mutationLedger.sideEffects.length,
      });
      return true;
    } catch (e) {
      this.log.warn("agent", "Failed to restore turn checkpoint", { error: e });
      return false;
    }
  }

  /**
   * Delete the turn checkpoint for this node (called on terminal states).
   */
  private async clearTurnCheckpoint(): Promise<void> {
    if (!this.nodeId || !this.workspaceId) return;
    try {
      const key = turnCheckpointKey(this.workspaceId, this.nodeId);
      await chrome.storage.local.remove(key);
    } catch {
      // Best-effort cleanup
    }
  }

  private lookupMutationReplay(
    toolName: ToolName,
    args: Record<string, unknown>,
  ): { result: string; source: "ledger" | "ephemeral" } | null {
    const currentSnapshot = this.context.getSnapshot?.() ?? null;
    return this.mutationLedger.lookup(
      toolName,
      args,
      currentSnapshot,
      this.guardAfterDoneRejection,
    );
  }

  private replayMutationSensitiveAction(
    toolCallId: string,
    toolName: ToolName,
    args: Record<string, unknown>,
  ): boolean {
    if (
      isListDetailReturnControlRepeatExempt({
        selectedSkillId: this.selectedSkillId,
        toolName,
        args,
        snapshot: this.context.getSnapshot(),
      })
    ) {
      return false;
    }
    if (
      isPaginationNavigationClick({
        selectedSkillId: this.selectedSkillId,
        toolName,
        args,
        snapshot: this.context.getSnapshot(),
      })
    ) {
      return false;
    }

    const replay = this.lookupMutationReplay(toolName, args);
    if (!replay) return false;

    this.log.info("agent", "Idempotency guard: returning cached result", {
      turn: this.turnCount,
      tool: toolName,
      source: replay.source,
      args: JSON.stringify(args).slice(0, 100),
    });
    this.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        replay.result +
        "\n[Note: This action was already executed earlier in this step. " +
        "The result above is from the previous execution. The page state already reflects this action — do NOT repeat it.]",
    });
    return true;
  }

  private recordMutationSensitiveAction(
    toolName: ToolName,
    args: Record<string, unknown>,
    result: string,
    actionSnapshot?: DomSnapshot | null,
  ): void {
    this.mutationLedger.record({
      toolName,
      args,
      result,
      actionSnapshot,
      currentSnapshot: this.context.getSnapshot?.() ?? null,
      planIndex: this.lastPlanIndex,
      turn: this.turnCount,
    });
  }

  private isMoneyTableAggregateTask(): boolean {
    return isMoneyTableAggregateTask(
      this as unknown as AgentLoopMoneyTableHost,
    );
  }

  private hydrateMoneyTableAggregateFromWorkingNotes(): MoneyTableAggregate | null {
    return hydrateMoneyTableAggregateFromWorkingNotes(
      this as unknown as AgentLoopMoneyTableHost,
    );
  }

  private updateMoneyTableAggregate(result: string): string | null {
    return updateMoneyTableAggregate(
      this as unknown as AgentLoopMoneyTableHost,
      result,
    );
  }

  private updateMoneyTableAggregateFromSnapshot(): void {
    updateMoneyTableAggregateFromSnapshot(
      this as unknown as AgentLoopMoneyTableHost,
    );
  }

  private getIncompleteMoneyTableAggregateDoneRejection(): string | null {
    return getIncompleteMoneyTableAggregateDoneRejection(
      this as unknown as AgentLoopMoneyTableHost,
    );
  }

  private getIncorrectMoneyTableAggregateDoneRejection(
    summary: string,
  ): string | null {
    return getIncorrectMoneyTableAggregateDoneRejection(
      this as unknown as AgentLoopMoneyTableHost,
      summary,
    );
  }

  private isCompletedMoneyTableAggregateSummary(summary: string): boolean {
    return isCompletedMoneyTableAggregateSummary(
      this as unknown as AgentLoopMoneyTableHost,
      summary,
    );
  }
  private syncPlanStatus(
    currentIndex: number,
    traceEvent?:
      | "step_advanced_by_gate"
      | "step_advanced_by_done_rejection"
      | "structural_step_advance"
      | "passive_step_advance"
      | "text_admission_criteria_advance"
      | "multi_return_step_advanced"
      | "submit_form_reset_success"
      | "trusted_form_submit_success"
      | undefined,
    traceData: Record<string, unknown> = {},
  ): void {
    const { subtasks, repairedIndex } = buildPlanStatusSnapshot({
      existingPlan: this.context.getPlanStatusRaw(),
      planSubtasks: this.planSubtasks,
      planSteps: this.planSteps,
      currentIndex,
    });

    if (repairedIndex !== null) {
      this.log.warn("agent", "Plan status missing running subtask", {
        turn: this.turnCount,
        currentIndex,
        repairedIndex,
      });
      this.traceRecorder?.recordEvent("plan_status_missing_running_subtask", {
        currentIndex,
        repairedIndex,
      });
    }

    this.context.setPlanStatus(subtasks, currentIndex);
    if (traceEvent) {
      this.traceRecorder?.recordEvent(traceEvent, traceData);
    }
  }

  /**
   * Send a message to the side panel, automatically injecting workspaceId,
   * requestId, and source. Fire-and-forget (errors are silenced).
   * Automatically attaches collected citations to STREAM_CHUNK done=true messages.
   */
  private broadcast(msg: BroadcastMessage): void {
    if (this.suppressUiBroadcast) {
      forwardSuppressedStreamChunk(msg, this.onStreamChunk ?? undefined);
      return;
    }
    chrome.runtime
      .sendMessage(
        runtimeBroadcastMessage({
          msg,
          citations: this.citations,
          workspaceId: this.workspaceId,
          requestId: crypto.randomUUID(),
        }),
      )
      .catch(() => {});
  }

  private broadcastTaskProgress(
    currentIndex: number,
    totalTurnsUsed = this.turnCount,
  ): void {
    if (!this.taskId) return;
    this.broadcast(
      taskProgressMessage({
        taskId: this.taskId,
        subtasks: this.planSubtasks,
        currentIndex,
        totalTurnsUsed,
      }),
    );
  }

  private finalizeParallelToolResults(
    results: ParallelToolExecutionResult[],
  ): void {
    addParallelToolResultsToContext(this.context, results);
    handleParallelVerificationGate({
      planStatus: this.context.getPlanStatusRaw(),
      results,
      currentUrl: this.context.getCurrentUrl(),
      host: {
        advanceCompletedSubtasks: () =>
          advanceCompletedSubtasks(
            this as unknown as AgentLoopPlanProgressHost,
          ),
        resetConsecutiveAutoAdvances: () => {
          this.consecutiveAutoAdvances = 0;
        },
        syncPlanStatus: (currentIndex, reason, data) =>
          this.syncPlanStatus(currentIndex, reason, data),
        broadcastTaskProgress: (currentIndex) =>
          this.broadcastTaskProgress(currentIndex),
        addUserMessage: (content) => {
          this.context.addMessage({
            role: "user",
            content,
          });
        },
        logVerificationGate: (data) => {
          this.log.info("agent", "Verification gate triggered (parallel)", {
            turn: this.turnCount,
            action: data.action,
            evidence: data.evidence,
          });
        },
        recordVerificationGate: (data) => {
          this.traceRecorder?.recordEvent("verification_gate_triggered", data);
        },
      },
    });
  }

  private finishStream(replaceContent?: string): void {
    this.broadcast({
      type: "STREAM_CHUNK",
      payload:
        replaceContent === undefined
          ? { delta: "", done: true }
          : { delta: "", done: true, replaceContent },
    });
  }

  private completeTaskUi(summary: string): void {
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
    // done:true is critical - without it the side panel message stays in
    // isStreaming state and the "Thinking..." placeholder hides the summary.
    this.finishStream(summary);
    this.statusHandler(AgentStatus.IDLE, "Done");
    this.messageHandler(summary, []);
  }

  private completeTaskResult(
    summary: string,
    options: { saveCheckpoint?: boolean } = {},
  ): void {
    this.completedResult = { outcome: "completed", summary };
    this.statusHandler(AgentStatus.IDLE, "Done");
    this.messageHandler(summary, []);
    if (options.saveCheckpoint !== false) {
      this.saveTurnCheckpoint().catch(() => {});
    }
  }

  private acceptDoneToolCall(summary: string, toolCallId: string): void {
    // Signal completion immediately - the orchestrator reads this after a lane
    // timeout to avoid retrying completed subtasks.
    this.completedResult = { outcome: "completed", summary };

    this.context.clearPlanStatus();
    this.log.info("agent", "DONE called", {
      turn: this.turnCount,
      url: this.context.getCurrentUrl(),
      summary: summary.slice(0, STRING_LIMITS.SUMMARY_LOG),
    });
    this.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: summary,
    });
    this.completeTaskUi(summary);

    if (this.taskId && this.planSubtasks.length > 0) {
      for (const sub of this.planSubtasks) {
        if (!sub.result) sub.result = "Completed";
      }
      this.planSubtasks[this.planSubtasks.length - 1].result = summary.slice(
        0,
        200,
      );

      const completionMessage = successfulTaskCompletionMessage({
        taskId: this.taskId,
        subtasks: this.planSubtasks,
        turnCount: this.turnCount,
        totalTimeMs: Date.now() - this.taskStartTime,
        summary,
        urlHistory: this.urlHistory,
      });
      if (completionMessage) this.broadcast(completionMessage);
    }

    this.broadcastFinalMetrics();
  }

  private rejectDoneAfterMaxRejections(toolCallId: string): void {
    this.log.warn("agent", "DONE hard-gated (max rejections exceeded)", {
      turn: this.turnCount,
      rejections: this.doneRejections,
      max: this.limits.maxDoneRejections,
    });
    this.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        "done() BLOCKED: You have already exceeded the maximum rejection limit. " +
        "You MUST take a different action - click a button, type into a field, " +
        "scroll the page, or call escalate(). Do NOT call done() again.",
    });
  }

  private rejectDoneQuestionAsClarification(
    toolCallId: string,
    summary: string,
  ): boolean {
    if (this.turnCount > 2 || !isDoneSummaryAskingClarification(summary)) {
      return false;
    }

    this.log.warn(
      "agent",
      "DONE rejected: summary is a question on T1, redirecting to clarify",
      {
        turn: this.turnCount,
        summary: summary.slice(0, 150),
      },
    );
    this.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        "done() REJECTED: Your summary is a question, not a completion report. " +
        "Use the clarify() tool to ask the user a question. " +
        "Do NOT call done() to ask questions.",
    });
    return true;
  }

  private async rejectDoneBeforeGroundingRead(
    toolCallId: string,
    summary: string,
    tabId: number,
  ): Promise<boolean> {
    // Done() Content Verification Guard
    // Reject done() if the agent never had access to page content and the page
    // has substantive content - prevents hallucinated summaries from filename/URL alone.
    // NOTE: hasReadPage is pre-set to true in start() when the initial snapshot
    // includes substantive content (system prompt provides it via {{pageContent}}).
    const needsGroundingRead = requiresGroundingReadBeforeDone(
      this.originalQuery,
    );
    const hasEnoughGrounding = needsGroundingRead
      ? this.hasExplicitPageRead
      : this.hasReadPage;
    if (hasEnoughGrounding || (!this.taskId && !needsGroundingRead)) {
      return false;
    }

    const snap = this.context.getSnapshot();
    const elementCount = snap?.elements?.length ?? 0;
    const visibleLen = (snap?.visibleContent || snap?.pageContent || "").length;
    if (elementCount <= 5 || visibleLen <= 100) {
      return false;
    }
    if (isDoneSummaryGroundedInSnapshot(summary, snap)) {
      this.traceRecorder?.recordEvent("done_grounded_from_snapshot", {
        turn: this.turnCount,
        elementCount,
        visibleLen,
      });
      return false;
    }

    this.log.warn(
      "agent",
      "DONE rejected: read_page never called on substantive page",
      {
        turn: this.turnCount,
        taskId: this.taskId,
        hasExplicitPageRead: this.hasExplicitPageRead,
        requiresGroundingReadBeforeDone: needsGroundingRead,
        elementCount,
        visibleLen,
        summary: summary.slice(0, 150),
      },
    );
    this.traceRecorder?.recordEvent("done_rejected_no_read", {
      turn: this.turnCount,
      elementCount,
      visibleLen,
    });
    this.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        "done() REJECTED: Call read_page first to verify actual page content before reporting. " +
        "Do NOT summarize from the page title or URL alone.",
    });
    if (needsGroundingRead) {
      await this.forceGroundingRefresh(tabId, "done_before_grounding_read");
      this.context.addMessage({
        role: "user",
        content:
          'The page has been refreshed for grounding. Use the current page content to answer, then call done({"summary": "..."}).',
      });
    }
    return true;
  }

  private async rejectDoneBeforePlanValidation(
    toolCallId: string,
    summary: string,
    tabId: number,
  ): Promise<boolean> {
    // Hard gate: immediately reject done() when max rejections exceeded.
    // Prevents the LLM from burning turns + LLM calls on repeated
    // done() attempts after it's already been told to stop.
    if (this.doneRejections >= this.limits.maxDoneRejections) {
      this.rejectDoneAfterMaxRejections(toolCallId);
      return true;
    }

    if (this.rejectDoneQuestionAsClarification(toolCallId, summary)) {
      return true;
    }

    if (await this.rejectDoneBeforeGroundingRead(toolCallId, summary, tabId)) {
      return true;
    }

    if (this.rejectDoneForMoneyTableAggregate(toolCallId, summary)) {
      return true;
    }

    if (this.rejectDoneForEarlyMultiStepTask(toolCallId, summary)) {
      return true;
    }

    if (this.rejectDoneForIncompleteMultiReturn(toolCallId, summary)) {
      return true;
    }

    if (this.rejectDoneForIncompleteTaskContract(toolCallId, summary)) {
      return true;
    }

    if (this.rejectDoneForWorkflowContract(toolCallId, summary)) {
      return true;
    }

    if (this.rejectDoneForIncompleteListDetailReview(toolCallId)) {
      return true;
    }

    return false;
  }

  private rejectDoneAfterPlanValidation(
    toolCallId: string,
    rejectReason: string,
    effectiveCurrentIdx: number,
  ): void {
    this.doneRejections++;
    // Activate idempotency guard: prevent re-execution of actions
    // that already succeeded but whose done() was rejected by verifier
    this.guardAfterDoneRejection = true;

    this.log.warn("agent", "DONE rejected", {
      turn: this.turnCount,
      rejections: this.doneRejections,
      advancedTo: effectiveCurrentIdx,
      reason: rejectReason.slice(0, STRING_LIMITS.REJECTION_REASON),
    });
    this.traceRecorder?.recordEvent("done_rejected", {
      rejections: this.doneRejections,
      reason: rejectReason,
      advancedTo: effectiveCurrentIdx,
    });

    // Build next-step hint for actionable rejection
    const nextStepIdx = effectiveCurrentIdx + 1;
    const nextStepDesc =
      nextStepIdx < this.planSubtasks.length
        ? this.planSubtasks[nextStepIdx].description
        : null;
    const nextStepHint = nextStepDesc
      ? `\nYOUR NEXT ACTION: ${nextStepDesc}\nDo NOT call done(). Execute this step now.`
      : "";

    if (this.doneRejections >= this.limits.maxDoneRejections) {
      this.log.warn("agent", "DONE blocked after max rejections", {
        turn: this.turnCount,
        rejections: this.doneRejections,
      });
      this.traceRecorder?.recordEvent("done_blocked_max_rejections", {
        rejections: this.doneRejections,
        reason: rejectReason,
        source: "plan_validation",
      });
      this.context.addMessage({
        role: "tool",
        tool_call_id: toolCallId,
        content:
          `done() REJECTED: ${rejectReason}\n\n` +
          "You have repeated done() too many times while the task is still incomplete. " +
          "Do not call done() again from this state. Take a different action or call escalate()." +
          nextStepHint,
      });
      return;
    }

    this.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        `done() REJECTED: ${rejectReason}\n\n` +
        "Take concrete actions to complete this step — click, type, scroll, or navigate. " +
        "Do NOT call done() again until you have performed the missing actions." +
        nextStepHint,
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
  }

  private evaluateDonePlanPrecheck(summary: string): {
    shouldReject: boolean;
    rejectReason: string;
    effectiveCurrentIdx: number;
    completedMoneyTableAggregate: boolean;
  } {
    let shouldReject = false;
    let rejectReason = "";
    const completedMoneyTableAggregate =
      this.isCompletedMoneyTableAggregateSummary(summary);
    const completedCount = this.planSubtasks.filter(
      (s) => s.status === "completed",
    ).length;
    const runningIdx = this.planSubtasks.findIndex(
      (s) => s.status === "running",
    );
    const effectiveCurrentIdx = runningIdx >= 0 ? runningIdx : completedCount;
    const uncommittedInlineEditRejection =
      this.getUncommittedInlineEditDoneRejection(effectiveCurrentIdx);
    if (uncommittedInlineEditRejection) {
      shouldReject = true;
      rejectReason = uncommittedInlineEditRejection;
    }

    const bypassPlanIncompleteRejection = shouldReject
      ? false
      : completedMoneyTableAggregate ||
        this.shouldBypassPlanIncompleteDoneRejection({
          summary,
          currentStepIndex: effectiveCurrentIdx,
        });
    if (
      effectiveCurrentIdx < this.planSubtasks.length - 1 &&
      !shouldReject &&
      !bypassPlanIncompleteRejection
    ) {
      shouldReject = true;
      rejectReason = `Plan incomplete. Step ${effectiveCurrentIdx + 1}/${this.planSubtasks.length} is active; continue to the next planned step instead of ending the task.`;
    } else if (bypassPlanIncompleteRejection) {
      this.log.info(
        "agent",
        "Bypassing stale plan done rejection for satisfied task",
        {
          turn: this.turnCount,
          step: effectiveCurrentIdx,
          remainingSteps: this.planSubtasks.length - effectiveCurrentIdx - 1,
          selectedSkillId: this.selectedSkillId,
          reason: completedMoneyTableAggregate
            ? "completed_money_table_aggregate"
            : "satisfied_edit_task",
        },
      );
      this.traceRecorder?.recordEvent("done_plan_incomplete_bypassed", {
        step: effectiveCurrentIdx,
        remainingSteps: this.planSubtasks.length - effectiveCurrentIdx - 1,
        selectedSkillId: this.selectedSkillId,
        reason: completedMoneyTableAggregate
          ? "completed_money_table_aggregate"
          : "satisfied_edit_task",
      });
    }

    const activeAsyncExpectation =
      this.pendingAsyncVerification &&
      this.pendingAsyncVerification.stepIndex === effectiveCurrentIdx
        ? this.pendingAsyncVerification
        : null;
    if (
      this.pendingAsyncVerification &&
      this.pendingAsyncVerification.stepIndex !== effectiveCurrentIdx
    ) {
      this.pendingAsyncVerification = null;
    }
    if (
      activeAsyncExpectation &&
      !isPendingAsyncChangeSatisfied({
        snapshot: this.context.getSnapshot(),
        expectedTokens: activeAsyncExpectation.expectedTokens,
        baselineLoadingKeywords: activeAsyncExpectation.baselineLoadingKeywords,
      }) &&
      !this.hasRecentToolEvidenceForTokens(
        activeAsyncExpectation.expectedTokens,
      )
    ) {
      shouldReject = true;
      rejectReason = `The last action likely triggered delayed page content, but the expected result is not visible yet. ${activeAsyncExpectation.reason} Wait for the update and verify it before ending the task.`;
    } else if (activeAsyncExpectation) {
      this.pendingAsyncVerification = null;
    }

    return {
      shouldReject,
      rejectReason,
      effectiveCurrentIdx,
      completedMoneyTableAggregate,
    };
  }

  private async evaluateDonePlanValidation(
    summary: string,
    effectiveCurrentIdx: number,
    completedMoneyTableAggregate: boolean,
    initialShouldReject: boolean,
    initialRejectReason: string,
  ): Promise<{ shouldReject: boolean; rejectReason: string }> {
    let shouldReject = initialShouldReject;
    let rejectReason = initialRejectReason;

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

      // Skip planner validateDone for orchestrator sub-nodes.
      // Sub-nodes only need to satisfy their node-level objective;
      // the orchestrator's own verifier checks node completion.
      // Calling validateDone with the full original query would
      // reject because sibling steps aren't done yet.
      if (!shouldReject && !this.nodeId && !completedMoneyTableAggregate) {
        const currentSubtask =
          effectiveCurrentIdx >= 0
            ? this.planSubtasks[effectiveCurrentIdx]
            : undefined;
        const interpretation = this.perception.getInterpretation();
        const validationPerception = shouldOmitPerceptionForDoneValidation({
          interpretation,
          hasReadPage: this.hasReadPage,
          originalQuery: this.originalQuery,
          activeStepDescription: currentSubtask?.description,
          activeStepToolProfile:
            currentSubtask?.toolProfile &&
            resolveToolProfile(currentSubtask.toolProfile as ToolProfile)
              ? (currentSubtask.toolProfile as ToolProfile)
              : undefined,
        })
          ? undefined
          : (interpretation ?? undefined);
        const lastEffect = this.stagnation.lastActionEffect;
        const stateEvidence = lastEffect
          ? formatStateEvidence(lastEffect)
          : undefined;
        const validation = await this.planner.validateDone(
          this.originalQuery,
          this.planSubtasks,
          summary,
          this.context.getSnapshot()?.title || "",
          this.context.getSnapshot()?.url || "",
          this.abortController!.signal,
          validationPerception,
          this.planSteps[effectiveCurrentIdx]?.successCriteria,
          stateEvidence ?? undefined,
        );

        if (!validation.approved) {
          shouldReject = true;
          rejectReason = validation.reason || "Task is not yet complete.";
        }
      }
    } catch (_err: any) {
      // Planner call failed - structural fallback
      const completedCount = this.planSubtasks.filter(
        (s) => s.status === "completed",
      ).length;
      if (completedCount < this.planSubtasks.length) {
        shouldReject = true;
        rejectReason = `Planner unavailable. ${completedCount}/${this.planSubtasks.length} subtasks completed. Continue.`;
      }
    }

    return { shouldReject, rejectReason };
  }

  private handleDonePlanRejection(
    toolCallId: string,
    summary: string,
    rejectReason: string,
    effectiveCurrentIdx: number,
  ): void {
    // retry_step: when the current step uses retry semantics
    // (infinite scroll, pagination), reject done() without
    // counting toward doneRejections — the executor should
    // keep trying the same step.
    const currentStep = this.planSteps[effectiveCurrentIdx];
    if (currentStep?.verifyAfter?.action === "retry_step") {
      const maxRetries = currentStep.verifyAfter.maxRetries ?? 8;
      if (this.stepRetryCount < maxRetries) {
        this.stepRetryCount++;
        this.context.addMessage({
          role: "tool",
          tool_call_id: toolCallId,
          content:
            `Step not yet complete (attempt ${this.stepRetryCount}/${maxRetries}). ` +
            `${currentStep.verifyAfter.trigger} not detected yet. ` +
            `Keep trying: scroll down further, wait for content to load, then check again.`,
        });
        this.log.info("agent", "retry_step: attempt", {
          turn: this.turnCount,
          step: effectiveCurrentIdx,
          attempt: this.stepRetryCount,
          maxRetries,
        });
        return;
      }
      // Exhausted retries — fall through to normal rejection
    }

    const planIncompleteOnly = rejectReason.startsWith("Plan incomplete.");
    const canAdvanceStep =
      planIncompleteOnly &&
      effectiveCurrentIdx >= 0 &&
      effectiveCurrentIdx < this.planSubtasks.length - 1;

    if (canAdvanceStep) {
      // Three-layer verification gate before auto-advance
      const sentiment = assessDoneSummary(summary);
      const criteriaCheck = matchSuccessCriteria({
        successCriteria: this.planSteps[effectiveCurrentIdx]?.successCriteria,
        snapshot: this.context.getSnapshot(),
      });
      const autoAdvanceCap = Math.max(
        2,
        Math.ceil(this.planSubtasks.length / 2),
      );
      const rateLimited = this.consecutiveAutoAdvances >= autoAdvanceCap;

      const coherence = checkSummaryStepCoherence({
        summary,
        currentStepIndex: effectiveCurrentIdx,
        stepDescriptions: this.planSubtasks.map((s) => s.description),
      });

      let gateBlockReason: string | null = null;
      if (!sentiment.confident) {
        gateBlockReason = `Summary admits failure: ${sentiment.reason}`;
      } else if (!coherence.coherent) {
        gateBlockReason = `Summary doesn't match current step: ${coherence.reason}`;
      } else if (!criteriaCheck.satisfied) {
        const evidenceParts = [
          `${criteriaCheck.matchedTokens.length}/${criteriaCheck.totalTokens} tokens matched`,
        ];
        if (criteriaCheck.requiredQuotedPhrases.length > 0) {
          evidenceParts.push(
            `${criteriaCheck.matchedQuotedPhrases.length}/${criteriaCheck.requiredQuotedPhrases.length} quoted phrases matched`,
          );
        }
        if (criteriaCheck.requiredNumbers.length > 0) {
          evidenceParts.push(
            `${criteriaCheck.matchedNumbers.length}/${criteriaCheck.requiredNumbers.length} numeric values matched`,
          );
        }
        gateBlockReason = `Success criteria not met (${evidenceParts.join(", ")})`;
      } else if (rateLimited) {
        gateBlockReason = `Rate limited: ${this.consecutiveAutoAdvances} consecutive auto-advances without DOM action`;
      }

      if (gateBlockReason) {
        // Gate blocked — fall through to rejection path below
        this.log.warn("agent", "Auto-advance blocked by verification gate", {
          turn: this.turnCount,
          step: effectiveCurrentIdx,
          reason: gateBlockReason,
          sentiment: sentiment.confident,
          criteriaMatched: criteriaCheck.matchedTokens,
          criteriaTotal: criteriaCheck.totalTokens,
          quotedMatched: criteriaCheck.matchedQuotedPhrases,
          quotedTotal: criteriaCheck.requiredQuotedPhrases,
          numbersMatched: criteriaCheck.matchedNumbers,
          numbersTotal: criteriaCheck.requiredNumbers,
          consecutiveAutoAdvances: this.consecutiveAutoAdvances,
        });
        this.traceRecorder?.recordEvent("auto_advance_blocked", {
          step: effectiveCurrentIdx,
          reason: gateBlockReason,
          summary: summary.slice(0, 200),
        });
        // Fall through to doneRejections++ below
      } else {
        // Gate passed — proceed with auto-advance
        this.consecutiveAutoAdvances++;
        const previousIdx = effectiveCurrentIdx;
        const newIdx = advanceCompletedSubtasks(
          this as unknown as AgentLoopPlanProgressHost,
        );
        const completedStep =
          this.planSubtasks[previousIdx]?.description ||
          `Step ${previousIdx + 1}`;
        const nextStep =
          this.planSubtasks[newIdx]?.description || "Finish the remaining plan";

        this.syncPlanStatus(newIdx, "step_advanced_by_done_rejection", {
          rejections: this.doneRejections,
          advancedTo: newIdx,
          convertedFromDone: true,
        });
        this.broadcastTaskProgress(newIdx);
        this.log.info("agent", "DONE converted into step completion", {
          turn: this.turnCount,
          completedStep: completedStep.slice(0, 200),
          nextStep: nextStep.slice(0, 200),
        });
        this.context.addMessage({
          role: "tool",
          tool_call_id: toolCallId,
          content:
            `Step ${previousIdx + 1} verified complete.\n\n` +
            `Now active: Step ${newIdx + 1} — ${nextStep}.\n` +
            "Observe the page with read_page first, then act. Do NOT call done() until this step is completed and verified.",
        });
        return;
      }
    }

    this.rejectDoneAfterPlanValidation(
      toolCallId,
      rejectReason,
      effectiveCurrentIdx,
    );
  }

  private async handleDoneToolCall(
    toolCallId: string,
    summary: string,
    tabId: number,
  ): Promise<boolean> {
    if (await this.rejectDoneBeforePlanValidation(toolCallId, summary, tabId)) {
      return false;
    }

    // Planner validation: only when a plan exists
    if (this.taskId && this.planSubtasks.length > 0) {
      const donePlanPrecheck = this.evaluateDonePlanPrecheck(summary);
      let shouldReject = donePlanPrecheck.shouldReject;
      let rejectReason = donePlanPrecheck.rejectReason;
      const effectiveCurrentIdx = donePlanPrecheck.effectiveCurrentIdx;
      const completedMoneyTableAggregate =
        donePlanPrecheck.completedMoneyTableAggregate;

      ({ shouldReject, rejectReason } = await this.evaluateDonePlanValidation(
        summary,
        effectiveCurrentIdx,
        completedMoneyTableAggregate,
        shouldReject,
        rejectReason,
      ));

      if (shouldReject) {
        this.handleDonePlanRejection(
          toolCallId,
          summary,
          rejectReason,
          effectiveCurrentIdx,
        );
        return false;
      }
    }

    if (this.rejectDoneForPendingAutocompleteSuggestion(toolCallId, summary)) {
      return false;
    }

    if (this.rejectDoneForMissingRequiredEvidence(toolCallId)) {
      return false;
    }

    this.acceptDoneToolCall(summary, toolCallId);
    return true;
  }

  private rejectDoneForPendingAutocompleteSuggestion(
    toolCallId: string,
    summary: string,
  ): boolean {
    const activePlanIdx =
      this.planSubtasks.length > 0
        ? this.planSubtasks.findIndex((s) => s.status === "running")
        : -1;
    const effectivePlanIdx =
      activePlanIdx >= 0
        ? activePlanIdx
        : Math.min(
            this.planSubtasks.filter((s) => s.status === "completed").length,
            this.planSubtasks.length - 1,
          );
    const activeObjective =
      effectivePlanIdx >= 0
        ? this.planSubtasks[effectivePlanIdx]?.description
        : undefined;
    const successCriteria =
      effectivePlanIdx >= 0
        ? this.planSteps[effectivePlanIdx]?.successCriteria
        : undefined;
    const rejection = getAutocompleteSuggestionDoneRejection({
      snapshot: this.context.getSnapshot(),
      originalQuery: this.originalQuery,
      activeObjective,
      successCriteria,
      summary,
    });
    if (!rejection) return false;

    this.doneRejections++;
    this.log.warn("agent", "DONE rejected: autocomplete suggestion pending", {
      turn: this.turnCount,
      rejections: this.doneRejections,
      inputTag: rejection.inputTag,
      suggestionTag: rejection.suggestionTag,
      value: rejection.value,
    });
    this.traceRecorder?.recordEvent(
      "done_rejected_autocomplete_suggestion_pending",
      {
        rejections: this.doneRejections,
        inputTag: rejection.inputTag,
        suggestionTag: rejection.suggestionTag,
        value: rejection.value,
      },
    );
    this.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        `done() REJECTED: ${rejection.reason}\n\n` +
        `YOUR NEXT ACTION: click_element({"id": ${rejection.suggestionTag}}), then verify the selected value is visible.`,
    });
    return true;
  }

  private async handleClarifyToolCall(
    toolCallId: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const question = (args.question as string) || "Could you clarify?";
    const suggestions = args.suggestions as string[] | undefined;
    const answer = await this.requestClarification(question, suggestions);
    this.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: `User's answer: ${answer}`,
    });
    this.log.info("agent", "CLARIFY answered", {
      turn: this.turnCount,
      question: question.slice(0, 100),
      answer: answer.slice(0, 200),
    });
  }

  private rejectDoneForMissingRequiredEvidence(toolCallId: string): boolean {
    const missingRequiredEvidence = this.getMissingRequiredEvidenceTypes();
    if (missingRequiredEvidence.length === 0) return false;

    this.doneRejections++;
    this.log.warn("agent", "DONE rejected: missing typed evidence", {
      turn: this.turnCount,
      rejections: this.doneRejections,
      selectedSkillId: this.selectedSkillId,
      missingRequiredEvidence,
    });
    this.traceRecorder?.recordEvent("done_rejected_missing_evidence", {
      rejections: this.doneRejections,
      selectedSkillId: this.selectedSkillId,
      missingRequiredEvidence,
    });
    this.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        `done() REJECTED: Missing required typed evidence: ${missingRequiredEvidence.join(", ")}.\n\n` +
        "Use the selected workflow tool to complete and verify the action before calling done().",
    });
    return true;
  }

  private rejectDoneForIncompleteTaskContract(
    toolCallId: string,
    summary: string,
  ): boolean {
    const activePlanIdxForTaskContract =
      this.planSubtasks.length > 0
        ? this.planSubtasks.findIndex((s) => s.status === "running")
        : -1;
    const isIntermediateRootPlanStep =
      !this.nodeId &&
      this.planSubtasks.length > 1 &&
      activePlanIdxForTaskContract >= 0 &&
      activePlanIdxForTaskContract < this.planSubtasks.length - 1;

    // Skip the full task contract guard for orchestrator sub-nodes
    // and for intermediate root plan steps. In both cases, the
    // current executor objective is intentionally narrower than the
    // original user request; plan validation handles step completion
    // and the full guard still runs on the final root step.
    const taskContractGuard =
      this.nodeId || isIntermediateRootPlanStep
        ? {
            blocked: false,
            reason: null,
            summaryCoverage: {
              missingEntities: [],
              missingNumbers: [],
              missingReturnTarget: false,
              satisfied: true,
            },
            missingReturnTarget: false,
          }
        : evaluateDoneTaskContractGuard({
            query: this.originalQuery,
            summary,
            snapshot: this.context.getSnapshot(),
          });
    if (!taskContractGuard.blocked) return false;

    this.doneRejections++;
    this.log.warn("agent", "DONE rejected: task contract incomplete", {
      turn: this.turnCount,
      rejections: this.doneRejections,
      reason: taskContractGuard.reason,
      missingEntities: taskContractGuard.summaryCoverage.missingEntities,
      missingNumbers: taskContractGuard.summaryCoverage.missingNumbers,
      missingReturnTarget: taskContractGuard.missingReturnTarget,
    });
    this.traceRecorder?.recordEvent("done_rejected_task_contract", {
      rejections: this.doneRejections,
      reason: taskContractGuard.reason,
      missingEntities: taskContractGuard.summaryCoverage.missingEntities,
      missingNumbers: taskContractGuard.summaryCoverage.missingNumbers,
      missingReturnTarget: taskContractGuard.missingReturnTarget,
    });

    if (this.doneRejections >= this.limits.maxDoneRejections) {
      this.log.warn(
        "agent",
        "DONE blocked after max rejections due to incomplete task contract",
        {
          turn: this.turnCount,
          rejections: this.doneRejections,
        },
      );
      this.traceRecorder?.recordEvent("done_blocked_max_rejections", {
        rejections: this.doneRejections,
        reason: taskContractGuard.reason,
        source: "task_contract",
      });
      this.context.addMessage({
        role: "tool",
        tool_call_id: toolCallId,
        content:
          `done() REJECTED: ${taskContractGuard.reason}\n\n` +
          "You have repeated done() too many times while the task is still incomplete. " +
          "Do not call done() again from this state. Take a different action or call escalate().",
      });
      return true;
    }

    this.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        `done() REJECTED: ${taskContractGuard.reason}\n\n` +
        "Complete the missing task obligations, verify them on the page, then call done() again.",
    });
    return true;
  }

  private rejectDoneForWorkflowContract(
    toolCallId: string,
    summary: string,
  ): boolean {
    const workflowSnapshot = this.context.getSnapshot();
    const workflowDoneGuard = assessWorkflowDoneGuard({
      query: this.originalQuery,
      summary,
      selectedSkillId: this.selectedSkillId,
      pageUrl: workflowSnapshot?.url,
      pageTitle: workflowSnapshot?.title,
    });
    if (!workflowDoneGuard.blocked) return false;

    this.doneRejections++;
    this.log.warn("agent", "DONE rejected: workflow completion guard", {
      turn: this.turnCount,
      rejections: this.doneRejections,
      selectedSkillId: this.selectedSkillId,
      reason: workflowDoneGuard.reason,
    });
    this.traceRecorder?.recordEvent("done_rejected_workflow_contract", {
      rejections: this.doneRejections,
      selectedSkillId: this.selectedSkillId,
      reason: workflowDoneGuard.reason,
    });
    this.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        `done() REJECTED: ${workflowDoneGuard.reason}\n\n` +
        "Continue the workflow, verify the requested final state, then call done() again.",
    });
    return true;
  }

  private rejectDoneForIncompleteListDetailReview(toolCallId: string): boolean {
    const latestListDetailActionCount = countVisibleListDetailActions(
      this.context.getSnapshot(),
    );
    const visibleDetailActionCount = Math.max(
      this.listDetailVisibleActionCount,
      latestListDetailActionCount,
    );
    const listDetailDoneRejection = getListDetailDoneRejection({
      selectedSkillId: this.selectedSkillId,
      query: this.originalQuery,
      reviewedDetailCount: this.listDetailReviewedTargets.size,
      visibleDetailActionCount,
    });
    if (!listDetailDoneRejection) return false;

    this.doneRejections++;
    this.log.warn("agent", "DONE rejected: list-detail review incomplete", {
      turn: this.turnCount,
      rejections: this.doneRejections,
      openedDetailCount: this.listDetailOpenedTargets.size,
      reviewedDetailCount: this.listDetailReviewedTargets.size,
      visibleDetailActionCount,
    });
    this.traceRecorder?.recordEvent("done_rejected_list_detail_incomplete", {
      rejections: this.doneRejections,
      openedDetailCount: this.listDetailOpenedTargets.size,
      reviewedDetailCount: this.listDetailReviewedTargets.size,
      visibleDetailActionCount,
    });
    this.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        `done() REJECTED: ${listDetailDoneRejection}\n\n` +
        "Do NOT synthesize the recommendation from list-card snippets alone.",
    });
    return true;
  }

  private rejectDoneForMoneyTableAggregate(
    toolCallId: string,
    summary: string,
  ): boolean {
    const incompleteMoneyTableScan =
      this.getIncompleteMoneyTableAggregateDoneRejection();
    if (incompleteMoneyTableScan) {
      this.doneRejections++;
      this.log.warn(
        "agent",
        "DONE rejected: paginated money table scan incomplete",
        {
          turn: this.turnCount,
          rejections: this.doneRejections,
          reason: incompleteMoneyTableScan.slice(0, 200),
        },
      );
      this.traceRecorder?.recordEvent(
        "done_rejected_incomplete_money_table_scan",
        {
          turn: this.turnCount,
          reason: incompleteMoneyTableScan,
        },
      );
      this.context.addMessage({
        role: "tool",
        tool_call_id: toolCallId,
        content:
          `done() REJECTED: ${incompleteMoneyTableScan}\n\n` +
          "Do not call done() until the scan is exhaustive.",
      });
      return true;
    }

    const incorrectMoneyTableAnswer =
      this.getIncorrectMoneyTableAggregateDoneRejection(summary);
    if (!incorrectMoneyTableAnswer) return false;

    this.doneRejections++;
    this.log.warn(
      "agent",
      "DONE rejected: paginated money table answer conflicts with aggregate",
      {
        turn: this.turnCount,
        rejections: this.doneRejections,
        reason: incorrectMoneyTableAnswer.slice(0, 200),
      },
    );
    this.traceRecorder?.recordEvent(
      "done_rejected_incorrect_money_table_answer",
      {
        turn: this.turnCount,
        reason: incorrectMoneyTableAnswer,
      },
    );
    this.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        `done() REJECTED: ${incorrectMoneyTableAnswer}\n\n` +
        "Use the tracked aggregate candidate in the final answer.",
    });
    return true;
  }

  private rejectDoneForEarlyMultiStepTask(
    toolCallId: string,
    summary: string,
  ): boolean {
    if (this.doneRejections !== 0 || !this.originalQuery || this.nodeId) {
      return false;
    }

    const stepCount = countExplicitSteps(this.originalQuery);
    // Activate for queries with 3+ explicit steps where the agent
    // has spent very few turns (turnCount includes planner's ~2 turns,
    // so turnCount <= 3 means the executor ran at most 1 turn)
    if (stepCount < 3 || this.turnCount > 3) return false;

    this.doneRejections++;
    this.log.warn("agent", "DONE rejected: multi-step query, too few turns", {
      turn: this.turnCount,
      stepCount,
      doneRejections: this.doneRejections,
      summary: summary.slice(0, 150),
    });
    this.traceRecorder?.recordEvent("done_rejected_early_multistep", {
      turn: this.turnCount,
      stepCount,
    });
    this.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        `done() REJECTED: The task has ${stepCount} steps but you have only completed the first action. ` +
        "Continue working through the remaining steps before calling done().",
    });
    return true;
  }

  private rejectDoneForIncompleteMultiReturn(
    toolCallId: string,
    summary: string,
  ): boolean {
    // Multi-return guard: only for root agent (no nodeId).
    // For orchestrator nodes, individual steps handle their own
    // objectives - the task-level final verification in the
    // orchestrator catches multi-return requirements after all
    // nodes complete.
    if (this.nodeId) return false;

    const multiReturnContract = buildTaskContract(this.originalQuery);
    if ((multiReturnContract.multiReturnCount ?? 0) < 2) return false;

    const multiCoverage = assessTaskContractCoverage({
      contract: multiReturnContract,
      text: summary,
    });
    if (multiCoverage.satisfied) return false;

    const rejectReason = `Query requires ${multiReturnContract.multiReturnCount} results (detected "both"/"all") but summary only covers ${multiReturnContract.requiredEntities.length - multiCoverage.missingEntities.length}. Missing: ${multiCoverage.missingEntities.join(", ")}`;
    this.doneRejections++;
    this.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        `done() REJECTED: ${rejectReason}\n\n` +
        "Return all requested results before calling done().",
    });
    return true;
  }

  private broadcastPlanTermination(
    outcome: "stopped" | "max_turns" | "error",
    summary: string,
  ): void {
    const message = planTerminationMessage({
      taskId: this.taskId,
      subtasks: this.planSubtasks,
      outcome,
      summary,
      turnCount: this.turnCount,
      maxTurns: this.maxTurns,
      totalTimeMs: Date.now() - this.taskStartTime,
      urlHistory: this.urlHistory,
      metrics: this.getMetrics(),
    });
    if (message) this.broadcast(message);
  }

  private getMatchingApprovalInteraction(
    toolName: ToolName,
    args: Record<string, unknown>,
    context: string,
  ): PendingApprovalInteraction | null {
    if (this.resumeInteraction?.kind !== "approval") return null;
    const interaction = this.resumeInteraction;
    const currentKey = buildMutationKey(toolName, args);
    const pendingKey = buildMutationKey(interaction.toolName, interaction.args);
    if (pendingKey !== currentKey || interaction.context !== context) {
      return null;
    }
    return interaction;
  }

  private getMatchingClarificationInteraction(
    question: string,
    suggestions?: string[],
  ): PendingClarificationInteraction | null {
    if (this.resumeInteraction?.kind !== "clarification") return null;
    const interaction = this.resumeInteraction;
    const currentSuggestions = JSON.stringify(suggestions ?? []);
    const pendingSuggestions = JSON.stringify(interaction.suggestions ?? []);
    if (
      interaction.question !== question ||
      currentSuggestions !== pendingSuggestions
    ) {
      return null;
    }
    return interaction;
  }

  private async requestApproval(
    toolName: ToolName,
    args: Record<string, unknown>,
    context: string,
  ): Promise<boolean> {
    const interaction = this.getMatchingApprovalInteraction(
      toolName,
      args,
      context,
    ) ?? {
      kind: "approval" as const,
      nodeId: this.nodeId,
      requestedAt: Date.now(),
      approvalId: crypto.randomUUID(),
      toolName,
      args,
      context,
      timeoutMs: this.approvalTimeoutMs,
    };
    const remainingTimeoutMs = Math.max(
      0,
      interaction.timeoutMs - (Date.now() - interaction.requestedAt),
    );

    if (remainingTimeoutMs <= 0) {
      this.resumeInteraction = null;
      this.log.warn("policy", "Approval timed out before resume", {
        approvalId: interaction.approvalId,
        turn: this.turnCount,
        toolName,
        workspaceId: this.workspaceId,
        workerId: this.workerId,
      });
      this.traceRecorder?.recordEvent("approval", {
        approvalId: interaction.approvalId,
        stage: "settled",
        turn: this.turnCount,
        toolName,
        outcome: "timeout",
        approved: false,
      });
      return false;
    }

    if (typeof interaction.approved === "boolean") {
      this.resumeInteraction = null;
      this.log.info("policy", "Approval decision restored", {
        approvalId: interaction.approvalId,
        turn: this.turnCount,
        toolName,
        approved: interaction.approved,
        workspaceId: this.workspaceId,
        workerId: this.workerId,
      });
      this.traceRecorder?.recordEvent("approval", {
        approvalId: interaction.approvalId,
        stage: "settled",
        turn: this.turnCount,
        toolName,
        outcome: interaction.approved ? "approved" : "rejected",
        approved: interaction.approved,
      });
      return interaction.approved;
    }

    this.statusHandler(AgentStatus.PAUSED, "Waiting for approval...");
    const approvalStep = approvalRequestStep({
      id: crypto.randomUUID(),
      context,
      timestamp: Date.now(),
    });
    this.stepHandler(approvalStep, false);
    this.log.info("policy", "Approval request yielded to orchestrator", {
      approvalId: interaction.approvalId,
      turn: this.turnCount,
      toolName,
      context,
      timeoutMs: interaction.timeoutMs,
      remainingTimeoutMs,
      workspaceId: this.workspaceId,
      workerId: this.workerId,
    });
    this.traceRecorder?.recordEvent("approval", {
      approvalId: interaction.approvalId,
      stage: "requested",
      turn: this.turnCount,
      toolName,
      context,
      timeoutMs: interaction.timeoutMs,
      bypassApprovals: this.bypassApprovals,
    });
    chrome.runtime
      .sendMessage(
        approvalRequestMessage({
          approvalId: interaction.approvalId,
          toolName,
          toolArgs: args,
          context,
          timeoutMs: remainingTimeoutMs,
          workspaceId: this.workspaceId,
          requestId: crypto.randomUUID(),
        }),
      )
      .catch((error: any) => {
        this.log.warn("policy", "Approval request dispatch failed", {
          approvalId: interaction.approvalId,
          turn: this.turnCount,
          toolName,
          error: error?.message ?? String(error),
          workspaceId: this.workspaceId,
          workerId: this.workerId,
        });
      });
    throw new PendingInteractionYield(interaction);
  }

  private static readonly CLARIFICATION_TIMEOUT_MS = 120_000;

  private async requestClarification(
    question: string,
    suggestions?: string[],
  ): Promise<string> {
    const interaction = this.getMatchingClarificationInteraction(
      question,
      suggestions,
    ) ?? {
      kind: "clarification" as const,
      nodeId: this.nodeId,
      requestedAt: Date.now(),
      clarificationId: crypto.randomUUID(),
      question,
      ...(suggestions ? { suggestions } : {}),
      timeoutMs: AgentLoop.CLARIFICATION_TIMEOUT_MS,
    };
    const remainingTimeoutMs = Math.max(
      0,
      interaction.timeoutMs - (Date.now() - interaction.requestedAt),
    );

    if (remainingTimeoutMs <= 0) {
      this.resumeInteraction = null;
      this.log.warn("agent", "Clarification timed out before resume", {
        clarificationId: interaction.clarificationId,
        turn: this.turnCount,
      });
      this.traceRecorder?.recordEvent("clarification", {
        clarificationId: interaction.clarificationId,
        stage: "settled",
        turn: this.turnCount,
        outcome: "timeout",
      });
      return "No response from user.";
    }

    if (typeof interaction.answer === "string") {
      this.resumeInteraction = null;
      this.log.info("agent", "Clarification response restored", {
        clarificationId: interaction.clarificationId,
        turn: this.turnCount,
      });
      this.traceRecorder?.recordEvent("clarification", {
        clarificationId: interaction.clarificationId,
        stage: "settled",
        turn: this.turnCount,
        outcome: "answered",
      });
      return interaction.answer;
    }

    this.statusHandler(AgentStatus.PAUSED, "Waiting for user clarification...");
    const clarifyStep = clarificationRequestStep({
      id: crypto.randomUUID(),
      question,
      timestamp: Date.now(),
    });
    this.stepHandler(clarifyStep, false);

    this.log.info("agent", "Clarification yielded to orchestrator", {
      clarificationId: interaction.clarificationId,
      turn: this.turnCount,
      question: question.slice(0, 200),
      timeoutMs: interaction.timeoutMs,
      remainingTimeoutMs,
    });
    this.traceRecorder?.recordEvent("clarification", {
      clarificationId: interaction.clarificationId,
      stage: "requested",
      turn: this.turnCount,
      question,
    });
    chrome.runtime
      .sendMessage(
        clarificationRequestMessage({
          clarificationId: interaction.clarificationId,
          question,
          suggestions,
          timeoutMs: remainingTimeoutMs,
          workspaceId: this.workspaceId,
          requestId: crypto.randomUUID(),
        }),
      )
      .catch((error: any) => {
        this.log.warn("agent", "Clarification request dispatch failed", {
          clarificationId: interaction.clarificationId,
          error: error?.message ?? String(error),
        });
      });
    throw new PendingInteractionYield(interaction);
  }

  private async ensureToolApproval(
    toolName: ToolName,
    args: Record<string, unknown>,
    riskLevel: RiskLevel,
    forceApproval = false,
  ): Promise<boolean> {
    if (riskLevel !== RiskLevel.HIGH && !forceApproval) return true;
    if (this.bypassApprovals && !forceApproval) {
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

  private requiresConsequentialActionApproval(
    toolName: ToolName,
    args: Record<string, unknown>,
  ): boolean {
    return assessConsequentialActionApproval({
      toolName,
      args,
      taskText: this.getConsequentialActionTaskText(),
      actionLabel: formatStepLabel(toolName, args, this.elementResolver),
    }).requiresApproval;
  }

  private requiresJobApplicationSubmitApproval(
    toolName: ToolName,
    args: Record<string, unknown>,
  ): boolean {
    return this.requiresConsequentialActionApproval(toolName, args);
  }

  private getConsequentialActionTaskText(): string {
    return buildConsequentialActionTaskText({
      planStatus: this.context.getPlanStatusRaw(),
      planSubtasks: this.planSubtasks,
      planSteps: this.planSteps,
      lastPlanIndex: this.lastPlanIndex,
      originalQuery: this.originalQuery,
    });
  }

  public recordCachedVisionUsage(): void {
    recordCachedVisionTelemetryUse(this.metrics);
  }

  private getJobApplicationApprovalTaskText(): string {
    return this.getConsequentialActionTaskText();
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
    this.gracefulStopRequested = false;
    this.abortController = new AbortController();
    this.turnCount = 0;
    this.originalQuery = initialUserText;
    this.context.setOriginalQuery(initialUserText);
    this.stagnation.reset();
    this.pendingFeedback = null;
    this.taskId = null;
    this.planSubtasks = [];
    this.planSteps = [];
    this.planRequiresTabManagement = false;
    this.taskStartTime = Date.now();
    this.urlHistory = [];
    this.doneRejections = 0;
    this.consecutiveAutoAdvances = 0;
    this.turnsOnCurrentStep = 0;
    this.lastPlanIndex = 0;
    this.escalationsOnCurrentStep = 0;
    this.turnsSinceLastMonitor = 0;
    this.replanCount = 0;
    this.startingOrigin = null;
    this.offDomainWarned = false;
    this.pendingAsyncVerification = null;
    this.pendingFormSubmissionReset = null;
    this.perception.reset();
    this.metrics = emptySessionMetrics();
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
      ...(this.selectedSkillId
        ? { selectedSkillId: this.selectedSkillId }
        : {}),
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
    this.applyInitialPlanState();

    // Durable checkpoint restore: if the orchestrator injected a turn checkpoint
    // from a prior SW lifetime, restore loop-local state before proceeding.
    if (this.pendingTurnCheckpoint) {
      const cp = this.pendingTurnCheckpoint;
      this.pendingTurnCheckpoint = null;
      const restored = this.restoreFromTurnCheckpoint(cp);
      if (restored) {
        this.log.info("agent", "Resumed from durable turn checkpoint", {
          priorTurn: cp.turnCount,
          nodeId: this.nodeId,
        });
      }
    }

    const initialSnapshotResolution = await resolveInitialSnapshot({
      tabId,
      initialSnapshot,
      log: this.log,
      refreshSnapshot: (targetTabId) => this.refreshSnapshot(targetTabId),
      getSnapshot: () => this.context.getSnapshot(),
    });
    const snapshot = initialSnapshotResolution.snapshot;
    const warmupPerception = initialSnapshotResolution.warmupPerception;
    const warmupScreenshot = initialSnapshotResolution.warmupScreenshot;

    // Save initial scroll position for restoration when the agent finishes
    let initialScrollY: number | null = null;

    const perceptionDecision = resolvePerceptionRuntimeModeDecision({
      perceptionMode: this.perceptionModeOption,
      useVLExecutor: this.useVLExecutorOption,
      providerMode: this.providerModeOption,
      taskText: initialUserText ?? "",
      imagePromptTokensUsed: this.metrics.totalImagePromptTokenEstimate ?? 0,
      maxImagePromptTokens: resolveImagePromptTokenBudget(
        this.maxImagePromptTokenEstimate,
      ),
      // Conservative high-detail estimate; the final runtime gates enforce the
      // same cap before any screenshot-backed prompt is sent.
      nextImagePromptTokenEstimate: imagePromptUsageForCount(1).estimatedTokens,
      ...extractPerceptionPageSignals(snapshot),
    });
    this.useVLExecutor = perceptionDecision.mode === "unified_vl";
    recordPerceptionModeDecision(this.metrics, perceptionDecision);
    this.log.info("agent", "Resolved perception runtime mode", {
      mode: perceptionDecision.mode,
      reason: perceptionDecision.reason,
      signals: perceptionDecision.signals,
    });
    this.traceRecorder?.recordEvent("perception_mode_decision", {
      mode: perceptionDecision.mode,
      reason: perceptionDecision.reason,
      signals: perceptionDecision.signals,
    });

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
          /* ignore invalid starting URL */
        }
        // Record initial page as citation
        this.recordCitation(
          snapshot.url,
          snapshot.title || "",
          ToolName.READ_PAGE,
        );
      }

      // Pre-set hasReadPage when initial snapshot has substantive content.
      // The system prompt includes pageContent (up to 60K chars), so the LLM
      // genuinely has the page content — no need to require an explicit read_page call.
      const initElements = snapshot.elements?.length ?? 0;
      const initContentLen = (
        snapshot.pageContent ??
        snapshot.visibleContent ??
        ""
      ).length;
      if (initElements > 5 && initContentLen > 100) {
        this.hasReadPage = true;
      }

      if (
        this.useVLExecutor &&
        warmupScreenshot &&
        this.imagePromptBudgetAllows(1)
      ) {
        // VL mode: use warmup screenshot directly — skip VLM call
        this.context.setScreenshotForExecutor(warmupScreenshot);
        this.context.setPageInterpretation(null);
        this.perception.setScreenshotUrl(warmupScreenshot);
        this.recordCachedVisionUsage();
        this.traceRecorder?.recordPerception(
          {
            interpretation:
              "[VL mode] Screenshot from warmup cache — no perception call.",
            model: "none (unified VL, warmup)",
            durationMs: 0,
            cached: true,
            mode: "vl_screenshot_only",
            source: "warmup",
            freshnessReason: "warmup_cache",
            screenshotStatus: "cached",
          },
          warmupScreenshot,
        );
        this.log.info(
          "agent",
          "VL mode: using warmup screenshot (skipped VLM)",
          { tabId },
        );
      } else if (this.useVLExecutor && warmupScreenshot && !warmupPerception) {
        this.recordImagePromptBudgetExhausted(1, "vl_warmup_screenshot");
        this.context.setScreenshotForExecutor(null);
        this.context.setPageInterpretation(null);
        this.perception.setScreenshotUrl(null);
      } else if (warmupPerception) {
        // Use pre-computed perception — hydrate PerceptionAgent with warmup result
        const warmupFingerprint = computeSnapshotFingerprint(snapshot);
        this.perception.hydrateFromWarmup(
          warmupPerception.interpretation,
          warmupFingerprint,
          warmupScreenshot,
          snapshot.url,
        );
        this.context.setPageInterpretation(warmupPerception.interpretation);
        this.recordCachedVisionUsage();
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
          } catch {
            /* */
          }
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

    const runtimePlanState = await bootstrapRuntimePlan({
      initialUserText,
      disableInternalPlanning: this.disableInternalPlanning,
      turnCount: this.turnCount,
      workspaceId: this.workspaceId,
      workerId: this.workerId,
      context: this.context,
      planner: this.planner,
      abortSignal: this.abortController!.signal,
      perceptionInterpretation:
        this.perception.getInterpretation() ?? undefined,
      log: this.log,
      traceRecorder: this.traceRecorder,
      stepHandler: (step, update) => this.stepHandler(step, update),
      broadcastTaskProgress: (currentIndex, totalTurnsUsed) =>
        this.broadcastTaskProgress(currentIndex, totalTurnsUsed),
      currentState: {
        difficulty: this.difficulty,
        limits: this.limits,
        taskId: this.taskId,
        taskStartTime: this.taskStartTime,
        planSubtasks: this.planSubtasks,
        planSteps: this.planSteps,
        planRequiresTabManagement: this.planRequiresTabManagement,
      },
    });
    this.difficulty = runtimePlanState.difficulty;
    this.limits = runtimePlanState.limits;
    this.taskId = runtimePlanState.taskId;
    this.taskStartTime = runtimePlanState.taskStartTime;
    this.planSubtasks = runtimePlanState.planSubtasks;
    this.planSteps = runtimePlanState.planSteps;
    this.planRequiresTabManagement = runtimePlanState.planRequiresTabManagement;

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

    const result = await runStartExecution({
      run: async () => {
        const controllerResult =
          (await this.maybeRunServiceNowRecordFormController(tabId)) ??
          (await this.maybeRunAtomicSkillController(tabId));
        return controllerResult ?? (await this.loop(tabId));
      },
      getTurnCount: () => this.turnCount,
      nodeId: this.nodeId,
      log: this.log,
      getMetrics: () => this.getMetrics(),
      broadcast: (message) => this.broadcast(message),
      finishStream: () => this.finishStream(),
      statusHandler: (status, detail) => this.statusHandler(status, detail),
    });
    try {
      return result;
    } finally {
      await finalizeStartResult({
        result,
        tabId,
        initialScrollY,
        taskId: this.taskId,
        planSubtasks: this.planSubtasks,
        mutationLedger: this.mutationLedger,
        evidenceAccumulator: this.evidenceAccumulator,
        context: this.context,
        traceRecorder: this.traceRecorder,
        toolCache: this.toolCache,
        clearTurnCheckpoint: () => this.clearTurnCheckpoint(),
        broadcastPlanTermination: (outcome, summary) =>
          this.broadcastPlanTermination(outcome, summary),
        scrollContentScript: (targetTabId, y, timeoutMs) =>
          this.scrollContentScript(targetTabId, y, timeoutMs),
        setRunning: (isRunning) => {
          this.isRunning = isRunning;
        },
        clearTraceRecorder: () => {
          this.traceRecorder = null;
        },
      });
    }
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

  public requestStop() {
    this.gracefulStopRequested = true;
    if (this.pauseGate) {
      this.pauseGate.resolve();
      this.pauseGate = null;
    }
    if (this.isRunning) {
      this.statusHandler(AgentStatus.ACTING, "Stopping at next safe point...");
    }
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

  private throwIfGracefulStopRequested(): void {
    if (!this.gracefulStopRequested) return;
    throw new DOMException("Stop requested", "AbortError");
  }

  /**
   * Escalate when stuck. Distills context into compact timeline + injects reflection prompt.
   * Does NOT switch LLM provider — tool calls stay on executor provider for reliability.
   * The "fresh start" comes from context distillation, not from a different model.
   */
  private escalateModel(): void {
    // Distill verbose history into compact situation report (unless orientation phase — no history yet)
    if (this.turnCount > 1) {
      this.context.summarizeTrajectory(this.originalQuery);
    }
    // Keep provider/model unchanged — escalation is prompt-based, not provider-based.
    // In hybrid mode (OpenRouter executor + Groq planner), switching to planner pool
    // would route tool calls through Groq, which can't handle them reliably.
    this.context.setModelTier("planner"); // label only, for logging/trace
    this.log.info("agent", "Escalating (context distilled, same provider)", {
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
    if (userExplicitlyRequestedTabManagement(this.originalQuery)) return false;
    if (this.selectedSkillId === "multi-tab-checklist-workflow") return false;
    if (this.planRequiresTabManagement) return false;
    return true;
  }

  private async getWorkspaceTabs(): Promise<chrome.tabs.Tab[]> {
    const wsTabIds = await this.getWorkspaceTabIds();
    if (!wsTabIds) {
      return await chrome.tabs.query({});
    }
    const tabs: chrome.tabs.Tab[] = [];
    for (const id of wsTabIds) {
      try {
        tabs.push(await chrome.tabs.get(id));
      } catch {
        // Ignore tabs closed outside the agent loop.
      }
    }
    return tabs;
  }

  private async getWorkflowTabToolRedirect(params: {
    toolName: ToolName;
    args: Record<string, unknown>;
    currentTabId: number;
  }): Promise<string | null> {
    const { toolName, args, currentTabId } = params;
    const snapshot = this.context.getSnapshot();
    const targetId =
      typeof args.id === "number"
        ? args.id
        : typeof args.id === "string"
          ? parseInt(args.id, 10)
          : null;
    const target =
      (toolName === ToolName.CLICK_ELEMENT ||
        toolName === ToolName.RIGHT_CLICK) &&
      targetId
        ? snapshot?.elements?.find((element) => element.tag === targetId)
        : null;
    const targetHref =
      typeof target?.attributes?.href === "string"
        ? target.attributes.href
        : toolName === ToolName.CREATE_TAB && typeof args.url === "string"
          ? (args.url as string)
          : null;
    if (!targetHref) return null;

    let resolvedHref: string | null = null;
    try {
      resolvedHref = new URL(
        targetHref,
        this.context.getCurrentUrl() || "http://127.0.0.1/",
      ).toString();
    } catch {
      return null;
    }
    const tabs = await this.getWorkspaceTabs();
    const decision = evaluateWorkflowTabRedirect({
      skillId: this.selectedSkillId,
      toolName,
      currentTabId,
      currentUrl: this.context.getCurrentUrl(),
      targetUrl: resolvedHref,
      workspaceTabs: tabs,
    });
    if (!decision) return null;
    this.traceRecorder?.recordEvent(decision.traceEvent, {
      turn: this.turnCount,
      toolName,
      controllerId: decision.controllerId,
      currentTabId,
      currentUrl: this.context.getCurrentUrl(),
      targetUrl: resolvedHref,
      message: decision.message,
    });
    return decision.message;
  }

  /** De-escalate back to executor mode when progress resumes after escalation. */
  private async deescalateModel(
    tabId?: number,
    prevElementCount?: number,
  ): Promise<number> {
    // No provider switch needed — escalation is prompt-based only.
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

    // 2. Clear history and idempotency ledger (keeps DOM snapshot)
    this.context.clearHistory();
    this.mutationLedger.clearReplayState();

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
    const recordBridgeRecovery: BridgeRecoveryTraceHook = (event) => {
      if (event.stage === "attempt") {
        this.traceRecorder?.recordEvent("bridge_recovery_attempt", {
          turn: this.turnCount,
          phase: event.phase,
          context: event.context,
          ...(event.toolName ? { toolName: event.toolName } : {}),
          ...(event.error ? { error: event.error } : {}),
        });
        return;
      }
      this.traceRecorder?.recordEvent("bridge_recovery_result", {
        turn: this.turnCount,
        phase: event.phase,
        context: event.context,
        success: Boolean(event.success),
        ...(event.toolName ? { toolName: event.toolName } : {}),
        ...(event.error ? { error: event.error } : {}),
      });
    };

    const sendRequest = () =>
      chrome.tabs.sendMessage(tabId, {
        type: "DOM_SNAPSHOT_REQUEST",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: { refresh: true, autoDismiss: false },
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
        this.log.warn(
          "agent",
          "Snapshot failed — content script disconnected, attempting reinjection",
          {
            turn: this.turnCount,
            tabId,
          },
        );
        const recovered = await recoverContentScriptBridge(tabId, {
          allowReloadFallback: true,
          context: "snapshot",
          traceHook: recordBridgeRecovery,
        });
        if (recovered) {
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
   * If the running subtask has an explicit toolProfile, use it.
   * Otherwise, use DOM-aware profiling: inspect the current snapshot's
   * elements to determine which tools are relevant (e.g., draggable
   * elements → include drag_and_drop, file inputs → include upload_file).
   */
  private applyToolProfile(tools: ToolDefinition[]): ToolDefinition[] {
    return applyToolProfile(this as unknown as AgentLoopSkillToolsHost, tools);
  }

  /**
   * Send a scroll-to-position message to the content script and return
   * the actual scroll Y after the browser settles.
   */
  private async scrollContentScript(
    tabId: number,
    y: number,
    timeoutMs = 15_000,
  ): Promise<number> {
    const response = await Promise.race([
      chrome.tabs.sendMessage(tabId, {
        type: "SCROLL_TO_POSITION",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: { y },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Scroll restore timed out (${timeoutMs}ms)`)),
          timeoutMs,
        ),
      ),
    ]);
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
    const viewportH =
      snapshot.scroll?.viewportHeight ?? snapshot.viewport?.height ?? 720;

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
      const dataUrl = await this.captureVisibleTabWithRetry(tab.windowId, {
        format: "jpeg",
        quality: 50, // Lower quality for context shots
      });
      shots.push({ dataUrl, scrollY: pos.y, label: pos.label });
    }

    // Restore original scroll position
    await this.scrollContentScript(tabId, originalY);
    return shots;
  }

  private async captureVisibleTabWithRetry(
    windowId: number,
    options: { format?: "jpeg" | "png"; quality?: number },
  ): Promise<string> {
    try {
      return (await chrome.tabs.captureVisibleTab(
        windowId,
        options as chrome.tabs.CaptureVisibleTabOptions,
      )) as unknown as string;
    } catch (error: any) {
      const message = String(error?.message || "");
      const isQuotaError =
        /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(message) ||
        /\bquota\b/i.test(message);
      if (!isQuotaError) throw error;

      this.log.warn("agent", "captureVisibleTab quota hit, retrying once", {
        error: message,
        delayMs: CAPTURE_VISIBLE_TAB_RETRY_DELAY_MS,
      });
      await new Promise((resolve) =>
        setTimeout(resolve, CAPTURE_VISIBLE_TAB_RETRY_DELAY_MS),
      );
      return (await chrome.tabs.captureVisibleTab(
        windowId,
        options as chrome.tabs.CaptureVisibleTabOptions,
      )) as unknown as string;
    }
  }

  private getActivePerceptionTaskContext(): PerceptionTaskContext | undefined {
    if (this.planSteps.length === 0) return undefined;

    let stepIndex = this.planSubtasks.findIndex(
      (subtask) => subtask.status === "running",
    );
    if (
      stepIndex < 0 &&
      this.lastPlanIndex >= 0 &&
      this.lastPlanIndex < this.planSteps.length
    ) {
      stepIndex = this.lastPlanIndex;
    }
    if (stepIndex < 0 || stepIndex >= this.planSteps.length) return undefined;

    const step = this.planSteps[stepIndex];
    const objective =
      step.objective?.trim() ||
      this.planSubtasks[stepIndex]?.description?.trim();
    if (!objective) return undefined;

    return {
      objective,
      successCriteria: step.successCriteria?.trim() || undefined,
      expectedStateDescription:
        step.expectedState?.description?.trim() || undefined,
      toolProfile: step.toolProfile,
      currentStepIndex: stepIndex,
      totalSteps: this.planSteps.length,
    };
  }

  /**
   * Refresh perception: take a screenshot and send to the PerceptionAgent
   * for structured page interpretation. The agent handles fingerprint caching
   * and observation history internally.
   */
  private async refreshPerception(tabId: number): Promise<void> {
    const snapshot = this.context.getSnapshot();
    if (!snapshot) return;

    const fingerprint = computeSnapshotFingerprint(snapshot);
    const taskContext = this.getActivePerceptionTaskContext();

    try {
      // Take screenshot (unless near-empty — agent handles fallback)
      let dataUrl: string | undefined;
      let screenshotStatus:
        | "captured"
        | "cached"
        | "missing"
        | "capture_failed"
        | "not_requested" = "not_requested";
      // Orientation scan: on first perception, scroll to top so the primary
      // screenshot shows the page beginning (defeats auto-scroll tricks).
      let primaryScrollY: number | undefined;
      const isFirstPerception = !this.perception.panoramicDone;
      if (isFirstPerception && (snapshot.scroll?.y ?? 0) > 0) {
        await this.scrollContentScript(tabId, 0);
        await new Promise((r) => setTimeout(r, 150));
        primaryScrollY = 0;
      }

      // Ensure the agent's tab is the visible one before capturing —
      // captureVisibleTab captures whatever tab is active in the window.
      const tab = await chrome.tabs.get(tabId);
      if (!tab.active) {
        try {
          await chrome.tabs.update(tabId, { active: true });
        } catch {
          // Tab may have been closed — fall back to cache
        }
      }

      try {
        const refreshedTab = tab.active ? tab : await chrome.tabs.get(tabId);
        dataUrl = await this.captureVisibleTabWithRetry(refreshedTab.windowId, {
          format: "jpeg",
          quality: 70,
        });
        setCachedScreenshot(tabId, dataUrl);
        screenshotStatus = "captured";
      } catch {
        // Quota or other capture error — fall back to shared cache
        dataUrl = getCachedScreenshot(tabId);
        screenshotStatus = dataUrl ? "cached" : "capture_failed";
      }
      if (dataUrl) {
        this.perception.setScreenshotUrl(dataUrl);
      }
      const primaryImageBudgetAllowed =
        !dataUrl || this.imagePromptBudgetAllows(1);
      if (dataUrl && !primaryImageBudgetAllowed) {
        this.recordImagePromptBudgetExhausted(1, "structured_perception");
      }

      // No screenshot available — use element-only fallback
      // instead of calling VLM with an invalid image URL.
      if (!dataUrl || !primaryImageBudgetAllowed) {
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
            taskContext,
          },
          fingerprint,
          this.abortController?.signal,
          this.lastToolNameForPerception,
        );
        this.context.setPageInterpretation(result.interpretation);
        const elSummary = buildElementSummary(
          snapshot.elements,
          snapshot.skeleton,
        );
        await this.traceRecorder?.recordPerception(
          {
            ...result,
            source: "fallback",
            fallbackReason: !primaryImageBudgetAllowed
              ? "image_budget_exhausted"
              : screenshotStatus === "capture_failed"
                ? "capture_failed"
                : "screenshot_unavailable",
            screenshotStatus: !primaryImageBudgetAllowed
              ? "not_requested"
              : screenshotStatus === "capture_failed"
                ? "capture_failed"
                : "missing",
          },
          undefined,
          elSummary,
        );
        this.log.info(
          "agent",
          !primaryImageBudgetAllowed
            ? "Perception: image prompt budget exhausted, using element-only mode"
            : "Perception: screenshot unavailable, using element-only mode",
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
            // Restore to user's original scroll position after panoramic capture
            snapshot.scroll?.y,
          );
          if (panoramicScreenshots.length > 0) {
            // Store on perception agent for retroactive T1 trace recording
            this.perception.setPanoramicShots(panoramicScreenshots);
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
        const imageCount = 1 + (panoramicScreenshots?.length ?? 0);
        if (
          panoramicScreenshots &&
          panoramicScreenshots.length > 0 &&
          !this.imagePromptBudgetAllows(imageCount)
        ) {
          this.recordImagePromptBudgetExhausted(
            imageCount,
            "structured_panoramic_perception",
          );
          panoramicScreenshots = undefined;
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
            taskContext,
          },
          fingerprint,
          this.abortController?.signal,
          this.lastToolNameForPerception,
        );

        this.context.setPageInterpretation(result.interpretation);
        const elSummary = buildElementSummary(
          snapshot.elements,
          snapshot.skeleton,
        );
        await this.traceRecorder?.recordPerception(
          {
            ...result,
            screenshotStatus,
          },
          dataUrl,
          elSummary,
          panoramicScreenshots,
        );

        // Track usage for non-cached calls
        if (result.usage && !result.cached) {
          this.recordVisionUsage(
            result.usage,
            result.durationMs,
            result.model,
            result.providerId as ProviderConfig["providerId"] | undefined,
            1 + (panoramicScreenshots?.length ?? 0),
          );
        } else if (result.cached) {
          this.recordCachedVisionUsage();
        }
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

    const snapshot = this.context.getSnapshot();
    const { valid: blockers, rejected } = snapshot
      ? validateNuisanceBlockers(interpretation, snapshot.elements)
      : { valid: [], rejected: [] };
    if (rejected.length > 0) {
      this.traceRecorder?.recordEvent("perception_blocker_validation", {
        turn: this.turnCount,
        rejectedCount: rejected.length,
        reasons: rejected.slice(0, 3).map((b) => b.reason),
      });
      this.log.warn(
        "agent",
        "Rejected nuisance blockers with invalid grounding",
        {
          rejected: rejected.slice(0, 3).map((b) => ({
            overlayTagId: b.overlayTagId,
            dismissTagId: b.dismissTagId,
            reason: b.reason,
          })),
        },
      );
    }
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
    if (this.useVLExecutor) {
      // Unified VL mode: capture screenshot for the executor, skip perception VLM call.
      // The executor LLM receives the screenshot directly as an image content block.
      await this.captureScreenshotForVLExecutor(tabId);
      // Skip triagePopups — executor sees overlays in screenshot and calls dismiss_overlays.
      return;
    }
    await this.refreshPerception(tabId);
    await this.triagePopups(tabId);
  }

  /** Capture screenshot and store for VL executor injection (no perception VLM call). */
  private async captureScreenshotForVLExecutor(tabId: number): Promise<void> {
    const snapshot = this.context.getSnapshot();
    if (!snapshot) {
      this.context.setScreenshotForExecutor(null);
      this.context.setPageInterpretation(null);
      return;
    }
    if (!this.imagePromptBudgetAllows(1)) {
      this.recordImagePromptBudgetExhausted(1, "vl_executor_screenshot");
      this.context.setScreenshotForExecutor(null);
      this.context.setPageInterpretation(null);
      this.perception.setScreenshotUrl(null);
      this.traceRecorder?.recordPerception(
        {
          interpretation:
            "[VL mode] Screenshot omitted because the image prompt budget is exhausted.",
          model: "none (image budget)",
          durationMs: 0,
          cached: false,
          mode: "element_only",
          source: "fallback",
          freshnessReason: "dom_fallback",
          fallbackReason: "image_budget_exhausted",
          screenshotStatus: "not_requested",
        },
        undefined,
      );
      return;
    }
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.active) {
        try {
          await chrome.tabs.update(tabId, { active: true });
        } catch {
          /* tab may be closed */
        }
      }
      const dataUrl = await this.captureVisibleTabWithRetry(tab.windowId, {
        format: "jpeg",
        quality: 70,
      });
      setCachedScreenshot(tabId, dataUrl);
      this.context.setScreenshotForExecutor(dataUrl);
      this.context.setPageInterpretation(null); // VL instructions generated by context
      this.perception.setScreenshotUrl(dataUrl); // keep for trace recording
      // Record synthetic perception entry so trace viewer shows the screenshot
      this.traceRecorder?.recordPerception(
        {
          interpretation:
            "[VL mode] Screenshot sent directly to executor — no separate perception call.",
          model: "none (unified VL)",
          durationMs: 0,
          cached: false,
          mode: "vl_screenshot_only",
          source: "fresh",
          freshnessReason: "vl_screenshot",
          screenshotStatus: "captured",
        },
        dataUrl,
      );
    } catch (e: any) {
      // Capture failed — fall back to 2-call pipeline for this turn
      this.log.warn(
        "agent",
        "VL screenshot capture failed, falling back to perception",
        {
          error: e?.message,
          tabId,
        },
      );
      this.context.setScreenshotForExecutor(null);
      await this.refreshPerception(tabId);
      await this.triagePopups(tabId);
    }
  }

  /**
   * Force a grounding refresh for read/report tasks after an ungrounded first move.
   * This keeps summarize-style tasks recoverable within the expected turn budget.
   */
  private async forceGroundingRefresh(
    tabId: number,
    reason: string,
  ): Promise<void> {
    const count = await this.refreshSnapshot(tabId);
    if (count >= 0) {
      this.hasReadPage = true;
    }
    await this.refreshPerceptionAndTriage(tabId);
    this.traceRecorder?.recordEvent("forced_grounding_refresh", {
      turn: this.turnCount,
      reason,
    });
    this.log.info("agent", "Forced grounding refresh", {
      turn: this.turnCount,
      reason,
    });
  }

  private isSkillOwnedListDetailReview(): boolean {
    return isSkillOwnedListDetailReview(
      this as unknown as AgentLoopSkillToolsHost,
    );
  }

  private isSkillOwnedMultiTabChecklistLoop(): boolean {
    return isSkillOwnedMultiTabChecklistLoop(
      this as unknown as AgentLoopSkillToolsHost,
    );
  }

  /**
   * Run plan monitor: compare current perception against expected state for the active step.
   * Only runs when a plan is active, perception is available, and enough turns have passed.
   */
  private async runPlanMonitor(
    signal?: AbortSignal,
  ): Promise<PlanMonitorResult | null> {
    if (
      this.isSkillOwnedListDetailReview() ||
      this.isSkillOwnedMultiTabChecklistLoop()
    ) {
      return null;
    }
    if (this.planSteps.length === 0 || !this.perception.getInterpretation())
      return null;

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
    if (
      this.isSkillOwnedListDetailReview() ||
      this.isSkillOwnedMultiTabChecklistLoop()
    ) {
      this.traceRecorder?.recordEvent("plan_replan_skipped_skill_owned_loop", {
        turn: this.turnCount,
        skillId: this.selectedSkillId,
        reason: "plan_monitor_deviation",
      });
      return;
    }

    if (this.replanCount >= 3) {
      this.log.warn("agent", "Plan deviation detected but replan cap reached", {
        replanCount: this.replanCount,
      });
      return;
    }

    const perception = this.perception.getInterpretation() || "";
    const pageUrl = this.context.getSnapshot()?.url || "";

    const runningIdx = this.planSubtasks.findIndex(
      (s) => s.status === "running",
    );
    if (runningIdx < 0) return;

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
      buildCompletedPlanStepSummaries(this.planSubtasks),
      buildFailedPlanStep(this.planSubtasks, runningIdx),
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
    const replacement = buildPlanReplacementState({
      subtasks: this.planSubtasks,
      steps: this.planSteps,
      fromIndex: runningIdx,
      replacementSteps: replanResult.newSteps,
    });
    this.planSubtasks = replacement.planSubtasks;
    this.planSteps = replacement.planSteps;

    // Update context with new plan
    this.context.setPlanStatus(replacement.statusEntries, runningIdx);

    // Inject plan monitor message into conversation
    this.context.addMessage({
      role: "user",
      content: buildPlanMonitorReplanMessage({
        fromIndex: runningIdx,
        reason: monitorResult.reason,
        replacementSteps: replanResult.newSteps,
      }),
    });

    // Broadcast updated progress
    this.broadcastTaskProgress(runningIdx);

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

  /**
   * Attempt replan-on-escalation: instead of switching the planner model to execute
   * tools directly, ask it to produce a revised plan, then hand back to executor.
   *
   * Returns true if replan succeeded (caller should skip old escalation behavior).
   * Returns false if replan is not applicable or fails (caller falls through to old behavior).
   */
  private async replanOnEscalation(
    tabId: number,
    subgoalAttempts: SubgoalAttempt[],
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (
      this.isSkillOwnedListDetailReview() ||
      this.isSkillOwnedMultiTabChecklistLoop()
    ) {
      this.traceRecorder?.recordEvent("plan_replan_skipped_skill_owned_loop", {
        turn: this.turnCount,
        skillId: this.selectedSkillId,
        reason: "escalation_or_stagnation",
      });
      this.log.info(
        "agent",
        "Skipping replan for skill-owned list-detail loop",
        {
          turn: this.turnCount,
        },
      );
      return false;
    }

    // Guard: replan cap
    if (this.replanCount >= 3) {
      this.log.info("agent", "replanOnEscalation: cap reached", {
        replanCount: this.replanCount,
      });
      return false;
    }

    // Guard: must have a plan with steps
    if (this.planSteps.length === 0 || this.planSubtasks.length === 0) {
      this.log.info("agent", "replanOnEscalation: no plan exists");
      return false;
    }

    // Find running step
    const runningIdx = this.planSubtasks.findIndex(
      (s) => s.status === "running",
    );
    if (runningIdx < 0) {
      this.log.info("agent", "replanOnEscalation: no running step");
      return false;
    }

    const stuckStep = this.planSubtasks[runningIdx];
    const stuckStepGoal = stuckStep.description;

    // Build structured failure context from subgoal attempts
    const failureContext = buildStructuredFailureContext(
      subgoalAttempts,
      stuckStepGoal,
      runningIdx,
      this.turnsOnCurrentStep,
      this.context.getSnapshot()?.url || "",
    );
    const failureContextStr = formatStructuredFailureContext(failureContext);

    this.stepHandler(
      {
        id: crypto.randomUUID(),
        type: "thinking",
        label: "Replanning stuck step...",
        status: "running",
        timestamp: Date.now(),
      },
      false,
    );

    // Get fresh perception for the replan prompt
    await this.refreshSnapshotWithRetry(tabId, -1);
    this.perception.invalidateCache();
    await this.refreshPerceptionAndTriage(tabId);

    const perception = this.perception.getInterpretation() || "";
    const pageUrl = this.context.getSnapshot()?.url || "";

    // Call the planner to replan (temporarily — no model switch needed, planner has its own LLM)
    const replanResult = await this.planner.replanFrom(
      this.originalQuery,
      buildCompletedPlanStepSummaries(this.planSubtasks),
      buildFailedPlanStep(this.planSubtasks, runningIdx),
      perception,
      pageUrl,
      signal,
      failureContextStr,
    );

    if (!replanResult || replanResult.newSteps.length === 0) {
      this.log.warn("agent", "replanOnEscalation: replan produced no steps");
      return false;
    }

    this.replanCount++;

    // Replace steps from stuck point onward
    const replacement = buildPlanReplacementState({
      subtasks: this.planSubtasks,
      steps: this.planSteps,
      fromIndex: runningIdx,
      replacementSteps: replanResult.newSteps,
    });
    this.planSubtasks = replacement.planSubtasks;
    this.planSteps = replacement.planSteps;

    // Update context with new plan
    this.context.setPlanStatus(replacement.statusEntries, runningIdx);

    // Clear history and inject fresh context with the new plan
    this.context.clearHistory();
    this.context.addMessage({
      role: "user",
      content: this.originalQuery,
    });
    this.context.addMessage({
      role: "user",
      content: buildPlanRevisionMessage({
        fromIndex: runningIdx,
        reason: replanResult.reason,
        replacementSteps: replanResult.newSteps,
      }),
    });

    // Reset step tracking for the new step
    this.turnsOnCurrentStep = 0;
    this.escalationsOnCurrentStep = 0;
    this.lastPlanIndex = runningIdx;

    // Broadcast updated progress
    this.broadcastTaskProgress(runningIdx);

    this.traceRecorder?.recordEvent("replan_on_escalation", {
      fromIndex: runningIdx,
      newStepCount: replanResult.newSteps.length,
      reason: replanResult.reason,
      replanNumber: this.replanCount,
      failureContext: failureContextStr.slice(0, 300),
    });

    this.stepHandler(
      {
        id: crypto.randomUUID(),
        type: "info",
        label: `Replanned from step ${runningIdx + 1} (${replanResult.newSteps.length} new steps)`,
        status: "done",
        timestamp: Date.now(),
      },
      false,
    );

    this.log.info("agent", "replanOnEscalation succeeded", {
      fromIndex: runningIdx,
      newStepCount: replanResult.newSteps.length,
      replanCount: this.replanCount,
      reason: replanResult.reason.slice(0, 200),
    });

    return true;
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

  private async waitForPendingAsyncChange(
    tabId: number,
    prevCount: number,
    expectation: {
      stepIndex: number;
      expectedTokens: string[];
      baselineLoadingKeywords: string[];
      reason: string;
      startedTurn: number;
    },
  ): Promise<DomSnapshot | null> {
    const maxCycles = 4;
    const waitMs = 1200;

    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      await waitForDomReady(tabId, {
        timeoutMs: waitMs,
        waitForElements: true,
      });
      await this.refreshSnapshotWithRetry(tabId, prevCount);
      const refreshed = this.context.getSnapshot();
      if (!refreshed) continue;
      prevCount = refreshed.elements.length;

      if (
        isPendingAsyncChangeSatisfied({
          snapshot: refreshed,
          expectedTokens: expectation.expectedTokens,
          baselineLoadingKeywords: expectation.baselineLoadingKeywords,
        })
      ) {
        this.pendingAsyncVerification = null;
        this.context.addMessage({
          role: "user",
          content:
            "ASYNC RESULT: The expected delayed page update is now visible. Continue from the refreshed state.",
        });
        this.traceRecorder?.recordEvent("pending_async_change_resolved", {
          turn: this.turnCount,
          cycle,
          stepIndex: expectation.stepIndex,
          expectedTokens: expectation.expectedTokens,
        });
        return refreshed;
      }
    }

    this.context.addMessage({
      role: "user",
      content: `ASYNC CHECKPOINT: ${expectation.reason} Keep verifying the result of the last action before calling done().`,
    });
    this.traceRecorder?.recordEvent("pending_async_change_unresolved", {
      turn: this.turnCount,
      stepIndex: expectation.stepIndex,
      expectedTokens: expectation.expectedTokens,
    });
    return this.context.getSnapshot();
  }

  private hasRecentToolEvidenceForTokens(expectedTokens: string[]): boolean {
    if (expectedTokens.length === 0) return false;
    const messages = this.context.getMessages();
    const threshold =
      expectedTokens.length >= 4 ? 2 : Math.min(1, expectedTokens.length);

    for (let i = messages.length - 1, seen = 0; i >= 0 && seen < 12; i--) {
      const message = messages[i];
      if (message.role !== "tool" || typeof message.content !== "string") {
        continue;
      }
      seen++;
      const text = message.content.toLowerCase();
      const matched = expectedTokens.filter((token) => text.includes(token));
      if (matched.length >= threshold) return true;
    }

    return false;
  }

  private getMissingRequiredEvidenceTypes(): string[] {
    const required =
      getLoadedSkillContract(this.selectedSkillId ?? undefined, {
        enabledSkillPackIds: this.enabledSkillPackIds,
      })?.requiredEvidenceTypes ?? [];
    if (required.length === 0) return [];
    const evidence = this.evidenceAccumulator.toArray();
    if (evidence.some((event) => event.type === "uncertainty_detected")) {
      return [...required, "no_uncertainty_detected"];
    }
    return required.filter(
      (type) =>
        !evidence.some(
          (event) =>
            event.type === type &&
            event.supportsTaskGoal &&
            event.confidence !== "low",
        ),
    );
  }

  private trackListDetailToolSuccess(
    toolName: ToolName,
    args: Record<string, unknown>,
    preActionSnapshot: DomSnapshot | null,
  ): void {
    if (this.selectedSkillId !== "list-detail-review-loop") return;
    const visibleCount = countVisibleListDetailActions(preActionSnapshot);
    if (visibleCount > this.listDetailVisibleActionCount) {
      this.listDetailVisibleActionCount = visibleCount;
    }

    if (toolName === ToolName.CLICK_ELEMENT) {
      const id = typeof args.id === "number" ? args.id : Number(args.id);
      if (!Number.isFinite(id)) return;
      const target = preActionSnapshot?.elements.find(
        (element) => element.tag === id,
      );
      const label = listDetailActionTargetLabel(target);
      if (!label) return;

      this.listDetailOpenedTargets.add(label);
      this.listDetailCurrentTarget = label;
      this.listDetailCurrentTargetRead = false;
      this.traceRecorder?.recordEvent("list_detail_item_opened", {
        turn: this.turnCount,
        openedCount: this.listDetailOpenedTargets.size,
        reviewedCount: this.listDetailReviewedTargets.size,
        visibleActionCount: this.listDetailVisibleActionCount,
        target: label.slice(0, 160),
      });
      return;
    }

    if (
      toolName === ToolName.READ_PAGE ||
      toolName === ToolName.XRAY_PAGE ||
      toolName === ToolName.UPDATE_NOTES
    ) {
      const appearsToBeListPage =
        countVisibleListDetailActions(preActionSnapshot) >= 3;
      if (appearsToBeListPage && toolName !== ToolName.UPDATE_NOTES) {
        return;
      }
      if (
        appearsToBeListPage &&
        toolName === ToolName.UPDATE_NOTES &&
        !this.listDetailCurrentTargetRead
      ) {
        return;
      }
      this.markCurrentListDetailReviewed(
        toolName === ToolName.UPDATE_NOTES ? "note" : "read",
      );
    }
  }

  private markCurrentListDetailReviewed(source: "read" | "note"): void {
    if (this.selectedSkillId !== "list-detail-review-loop") return;
    if (!this.listDetailCurrentTarget) return;
    if (source === "read") {
      this.listDetailCurrentTargetRead = true;
    }

    const target = this.listDetailCurrentTarget;
    this.listDetailReviewedTargets.add(target);
    this.traceRecorder?.recordEvent("list_detail_item_reviewed", {
      turn: this.turnCount,
      source,
      openedCount: this.listDetailOpenedTargets.size,
      reviewedCount: this.listDetailReviewedTargets.size,
      visibleActionCount: this.listDetailVisibleActionCount,
      target: target.slice(0, 160),
    });
  }

  private rewriteListDetailWorkflowToolCall(
    toolCall: ToolCall,
    mode: "parallel" | "sequential",
  ): boolean {
    if (!this.isSkillOwnedListDetailReview()) return false;

    const toolName = toolCall.function.name as ToolName;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolCall.function.arguments || "{}");
    } catch {
      args = {};
    }

    const currentSnapshot = this.context.getSnapshot();
    const visibleDetailActionCount =
      countVisibleListDetailActions(currentSnapshot);
    if (visibleDetailActionCount > this.listDetailVisibleActionCount) {
      this.listDetailVisibleActionCount = visibleDetailActionCount;
    }

    const currentTargetKey = normalizeGuardText(
      this.listDetailCurrentTarget || "",
    );
    const currentTargetNeedsRead =
      !!currentTargetKey &&
      !this.listDetailReviewedTargets.has(currentTargetKey);
    const isOpenDetailSurface =
      currentTargetNeedsRead &&
      visibleDetailActionCount < 3 &&
      hasListDetailReturnControl(currentSnapshot);
    if (
      isOpenDetailSurface &&
      toolName !== ToolName.READ_PAGE &&
      toolName !== ToolName.XRAY_PAGE &&
      toolName !== ToolName.UPDATE_NOTES &&
      toolName !== ToolName.ESCALATE &&
      toolName !== ToolName.DONE
    ) {
      toolCall.function.name = ToolName.READ_PAGE;
      toolCall.function.arguments = "{}";
      this.traceRecorder?.recordEvent("list_detail_workflow_tool_redirected", {
        turn: this.turnCount,
        mode,
        fromTool: toolName,
        toTool: ToolName.READ_PAGE,
        target: this.listDetailCurrentTarget?.slice(0, 160),
        openedDetailCount: this.listDetailOpenedTargets.size,
        reviewedDetailCount: this.listDetailReviewedTargets.size,
        visibleDetailActionCount: this.listDetailVisibleActionCount,
        reason: "current_detail_needs_read",
      });
      this.log.info("agent", "List-detail workflow tool redirected", {
        turn: this.turnCount,
        mode,
        fromTool: toolName,
        toTool: ToolName.READ_PAGE,
        reason: "current_detail_needs_read",
      });
      return true;
    }

    const returnControl = getListDetailReturnControl(currentSnapshot);
    const clickId = typeof args.id === "number" ? args.id : Number(args.id);
    const isReturnControlClick =
      toolName === ToolName.CLICK_ELEMENT &&
      Number.isFinite(clickId) &&
      returnControl?.tag === clickId;
    const isDetailReadTool =
      toolName === ToolName.READ_PAGE || toolName === ToolName.XRAY_PAGE;
    const allowDetailReadTool = currentTargetNeedsRead && isDetailReadTool;
    if (
      returnControl &&
      visibleDetailActionCount < 3 &&
      !isReturnControlClick &&
      !allowDetailReadTool &&
      toolName !== ToolName.ESCALATE &&
      toolName !== ToolName.DONE &&
      toolName !== ToolName.UPDATE_NOTES
    ) {
      toolCall.function.name = ToolName.CLICK_ELEMENT;
      toolCall.function.arguments = JSON.stringify({ id: returnControl.tag });
      this.traceRecorder?.recordEvent("list_detail_workflow_tool_redirected", {
        turn: this.turnCount,
        mode,
        fromTool: toolName,
        toTool: ToolName.CLICK_ELEMENT,
        targetId: returnControl.tag,
        target: listDetailElementLabel(returnControl).slice(0, 160),
        openedDetailCount: this.listDetailOpenedTargets.size,
        reviewedDetailCount: this.listDetailReviewedTargets.size,
        visibleDetailActionCount: this.listDetailVisibleActionCount,
        reason: "return_to_list_required",
      });
      this.log.info("agent", "List-detail workflow tool redirected", {
        turn: this.turnCount,
        mode,
        fromTool: toolName,
        toTool: ToolName.CLICK_ELEMENT,
        targetId: returnControl.tag,
        reason: "return_to_list_required",
      });
      return true;
    }

    const block = getListDetailWorkflowBlock({
      selectedSkillId: this.selectedSkillId,
      query: this.originalQuery,
      toolName,
      args,
      snapshot: currentSnapshot,
      reviewedTargets: this.listDetailReviewedTargets,
      openedTargets: this.listDetailOpenedTargets,
      visibleDetailActionCount: this.listDetailVisibleActionCount,
    });
    if (!block) return false;

    const next = getNextUnreviewedListDetailAction(
      currentSnapshot,
      this.listDetailReviewedTargets,
    );
    if (!next) return false;

    toolCall.function.name = ToolName.CLICK_ELEMENT;
    toolCall.function.arguments = JSON.stringify({ id: next.id });
    this.traceRecorder?.recordEvent("list_detail_workflow_tool_redirected", {
      turn: this.turnCount,
      mode,
      fromTool: toolName,
      toTool: ToolName.CLICK_ELEMENT,
      targetId: next.id,
      target: next.label.slice(0, 160),
      openedDetailCount: this.listDetailOpenedTargets.size,
      reviewedDetailCount: this.listDetailReviewedTargets.size,
      visibleDetailActionCount: this.listDetailVisibleActionCount,
    });
    this.log.info("agent", "List-detail workflow tool redirected", {
      turn: this.turnCount,
      mode,
      fromTool: toolName,
      targetId: next.id,
    });
    return true;
  }

  /** Execute a tool call via the tool registry. */
  private async executeToolCall(
    toolCall: ToolCall,
    tabId: number,
  ): Promise<string> {
    const execution = await toolRegistry.executeDetailed(
      toolCall,
      tabId,
      this.abortController!.signal,
    );
    const added = this.evidenceAccumulator.addMany(execution.evidence);
    if (added > 0) {
      this.traceRecorder?.recordEvent("tool_evidence_accumulated", {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        added,
        total: this.evidenceAccumulator.toArray().length,
      });
    }
    return execution.result;
  }

  /** Stream a message to side panel and break the loop (for circuit breaker exits) */
  private circuitBreakerExit(message: string): void {
    this.broadcast({
      type: "STREAM_CHUNK",
      payload: { delta: message, done: false },
    });
    this.finishStream();
    this.statusHandler(
      AgentStatus.IDLE,
      "Circuit breaker — send a follow-up to continue",
    );
  }

  private advanceCompletedSubtasks(): number {
    return advanceCompletedSubtasks(
      this as unknown as AgentLoopPlanProgressHost,
    );
  }

  private completeSingleSubtask(currentIndex: number): number {
    return completeSingleSubtask(
      this as unknown as AgentLoopPlanProgressHost,
      currentIndex,
    );
  }

  private completeRemainingSubtasks(
    currentIndex: number,
    result: string,
  ): number {
    return completeRemainingSubtasks(
      this as unknown as AgentLoopPlanProgressHost,
      currentIndex,
      result,
    );
  }

  private maybeAdvanceTrustedFormFillStep(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    mode: "parallel" | "sequential";
  }): boolean {
    const plan = this.context.getPlanStatusRaw();
    if (
      !this.taskId ||
      !plan ||
      plan.currentIndex < 0 ||
      plan.currentIndex >= plan.subtasks.length
    ) {
      return false;
    }

    const currentSubtask = plan.subtasks[plan.currentIndex];
    const nextSubtask = plan.subtasks[plan.currentIndex + 1];
    if (!currentSubtask || !nextSubtask) return false;
    if (this.getActiveToolProfileForStep(plan.currentIndex) !== "form_fill") {
      return false;
    }

    const signal = detectTrustedFormFillStepCompletion({
      toolName: params.toolName,
      toolArgs: params.toolArgs,
      toolResult: params.toolResult,
    });
    if (!signal) return false;

    this.consecutiveAutoAdvances = 0;
    const fromStep = plan.currentIndex;
    const newIdx = completeSingleSubtask(
      this as unknown as AgentLoopPlanProgressHost,
      fromStep,
    );
    this.syncPlanStatus(newIdx, "structural_step_advance", {
      reason: signal.reason,
      matchedTokens: signal.matchedTokens,
      advancedTo: newIdx,
      mode: params.mode,
      trustedTool: params.toolName,
    });
    const nextStepDesc =
      this.planSubtasks[newIdx]?.description || "Finish the remaining plan";
    this.context.addMessage({
      role: "user",
      content:
        `STEP COMPLETED: ${signal.reason}. ` +
        `Continue with the next step: ${nextStepDesc}. ` +
        `Do NOT re-verify the completed form-fill step unless the page reports an error.`,
    });
    this.broadcastTaskProgress(newIdx);
    this.log.info("agent", "trusted form helper advanced step", {
      turn: this.turnCount,
      fromStep,
      toStep: newIdx,
      mode: params.mode,
      matchedTokens: signal.matchedTokens,
    });
    this.traceRecorder?.recordEvent("structural_step_advance", {
      fromStep,
      toStep: newIdx,
      matchedTokens: signal.matchedTokens,
      reason: signal.reason,
      trustedTool: params.toolName,
      mode: params.mode,
      completedAllSteps: newIdx >= this.planSubtasks.length,
    });
    return true;
  }

  private maybeCompleteTrustedListSortStep(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    mode: "parallel" | "sequential";
  }): { finalSummary: string; newIndex: number } | null {
    if (this.selectedSkillId !== "list-sort-workflow") return null;
    if (params.toolName !== ToolName.APPLY_LIST_SORT) return null;
    if (
      /^error:/i.test(params.toolResult) ||
      !/\bapplied\b/i.test(params.toolResult) ||
      !/\bquery state:\s*sysparm_query=.*orderby/i.test(params.toolResult)
    ) {
      return null;
    }

    const sorts = Array.isArray(params.toolArgs?.sorts)
      ? params.toolArgs.sorts
          .filter(
            (sort): sort is { field: string; direction?: string } =>
              !!sort &&
              typeof sort === "object" &&
              typeof (sort as any).field === "string" &&
              (sort as any).field.trim().length > 0,
          )
          .map((sort) => ({
            field: sort.field.trim(),
            direction: /^asc/i.test(String(sort.direction ?? "ascending"))
              ? "ascending"
              : "descending",
          }))
      : [];
    if (sorts.length === 0) return null;

    const normalizedResult = params.toolResult
      .replace(/\s+/g, " ")
      .toLowerCase();
    const missing = sorts.filter((sort) => {
      const field = sort.field.toLowerCase();
      const shortDirection =
        sort.direction === "ascending" ? "asc" : "desc";
      return !normalizedResult.includes(`${field} ${shortDirection}`);
    });
    if (missing.length > 0) return null;

    const queryLine =
      params.toolResult
        .split(/\r?\n/)
        .find((line) => /\bquery state:/i.test(line))
        ?.trim() ?? "Query state recorded by apply_list_sort.";
    const sortSummary = sorts
      .map((sort) => `${sort.field} ${sort.direction}`)
      .join("; ");
    const finalSummary = `Applied list sort: ${sortSummary}. Evidence: ${queryLine}`;

    const plan = this.context.getPlanStatusRaw();
    if (
      !plan ||
      plan.currentIndex < 0 ||
      plan.currentIndex >= plan.subtasks.length
    ) {
      this.log.info("agent", "trusted list sort completed planless workflow", {
        turn: this.turnCount,
        mode: params.mode,
        sortCount: sorts.length,
      });
      this.traceRecorder?.recordEvent("trusted_list_sort_success", {
        fromStep: -1,
        toStep: 0,
        reason: finalSummary,
        trustedTool: params.toolName,
        mode: params.mode,
        completedAllSteps: true,
        planless: true,
      });
      return { finalSummary, newIndex: 0 };
    }

    this.consecutiveAutoAdvances = 0;
    const fromStep = plan.currentIndex;
    const newIndex = completeRemainingSubtasks(
      this as unknown as AgentLoopPlanProgressHost,
      fromStep,
      finalSummary,
    );
    this.syncPlanStatus(newIndex, "trusted_list_sort_success", {
      reason: finalSummary,
      advancedTo: newIndex,
      mode: params.mode,
      trustedTool: params.toolName,
      sortCount: sorts.length,
    });
    this.broadcastTaskProgress(newIndex);
    this.log.info("agent", "trusted list sort completed workflow", {
      turn: this.turnCount,
      fromStep,
      toStep: newIndex,
      mode: params.mode,
      sortCount: sorts.length,
    });
    this.traceRecorder?.recordEvent("trusted_list_sort_success", {
      fromStep,
      toStep: newIndex,
      reason: finalSummary,
      trustedTool: params.toolName,
      mode: params.mode,
      completedAllSteps: newIndex >= this.planSubtasks.length,
    });
    return { finalSummary, newIndex };
  }

  private maybeCompleteTrustedListFilterStep(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    mode: "parallel" | "sequential";
  }): { finalSummary: string; newIndex: number } | null {
    if (this.selectedSkillId !== "list-filter-workflow") return null;
    if (params.toolName !== ToolName.APPLY_LIST_FILTER) return null;
    if (
      /^error:/i.test(params.toolResult) ||
      !/\bapplied\b/i.test(params.toolResult) ||
      !/\bquery state:\s*sysparm_query=.+/i.test(params.toolResult)
    ) {
      return null;
    }

    const conditions = Array.isArray(params.toolArgs?.conditions)
      ? params.toolArgs.conditions
          .filter(
            (
              condition,
            ): condition is {
              field: string;
              operator?: string;
              value?: unknown;
            } =>
              !!condition &&
              typeof condition === "object" &&
              typeof (condition as any).field === "string" &&
              (condition as any).field.trim().length > 0,
          )
          .map((condition) => ({
            field: condition.field.trim(),
            operator: String(condition.operator ?? "is").trim() || "is",
            value:
              condition.value == null ? "" : String(condition.value).trim(),
          }))
      : [];
    if (conditions.length === 0) return null;

    const normalizedResult = params.toolResult
      .replace(/\s+/g, " ")
      .toLowerCase();
    const missing = conditions.filter((condition) => {
      const field = condition.field.toLowerCase();
      const operator = condition.operator.toLowerCase();
      const value = condition.value.toLowerCase();
      const hasField = normalizedResult.includes(field);
      if (!hasField) return true;
      if (/empty/.test(operator)) {
        return !normalizedResult.includes("empty");
      }
      return value.length > 0 && !normalizedResult.includes(value);
    });
    if (missing.length > 0) return null;

    const queryLine =
      params.toolResult
        .split(/\r?\n/)
        .find((line) => /\bquery state:/i.test(line))
        ?.trim() ?? "Query state recorded by apply_list_filter.";
    const conditionSummary = conditions
      .map((condition) => {
        const value =
          condition.value.length > 0 ? ` ${condition.value}` : "";
        return `${condition.field} ${condition.operator}${value}`;
      })
      .join("; ");
    const finalSummary = `Applied list filter: ${conditionSummary}. Evidence: ${queryLine}`;

    const plan = this.context.getPlanStatusRaw();
    if (
      !plan ||
      plan.currentIndex < 0 ||
      plan.currentIndex >= plan.subtasks.length
    ) {
      this.log.info("agent", "trusted list filter completed planless workflow", {
        turn: this.turnCount,
        mode: params.mode,
        conditionCount: conditions.length,
      });
      this.traceRecorder?.recordEvent("trusted_list_filter_success", {
        fromStep: -1,
        toStep: 0,
        reason: finalSummary,
        trustedTool: params.toolName,
        mode: params.mode,
        completedAllSteps: true,
        planless: true,
      });
      return { finalSummary, newIndex: 0 };
    }

    this.consecutiveAutoAdvances = 0;
    const fromStep = plan.currentIndex;
    const newIndex = completeRemainingSubtasks(
      this as unknown as AgentLoopPlanProgressHost,
      fromStep,
      finalSummary,
    );
    this.syncPlanStatus(newIndex, "trusted_list_filter_success", {
      reason: finalSummary,
      advancedTo: newIndex,
      mode: params.mode,
      trustedTool: params.toolName,
      conditionCount: conditions.length,
    });
    this.broadcastTaskProgress(newIndex);
    this.log.info("agent", "trusted list filter completed workflow", {
      turn: this.turnCount,
      fromStep,
      toStep: newIndex,
      mode: params.mode,
      conditionCount: conditions.length,
    });
    this.traceRecorder?.recordEvent("trusted_list_filter_success", {
      fromStep,
      toStep: newIndex,
      reason: finalSummary,
      trustedTool: params.toolName,
      mode: params.mode,
      completedAllSteps: newIndex >= this.planSubtasks.length,
    });
    return { finalSummary, newIndex };
  }

  private hasTrustedServiceNowSubmitIntent(text?: string): boolean {
    const intentText =
      text ??
      `${this.originalQuery}\n${this.planSteps
        .map((step) => `${step.objective}\n${step.successCriteria ?? ""}`)
        .join("\n")}`;
    if (
      /\b(?:do not submit|not submit|ready to submit|submit action has not been clicked|has not been submitted)\b/i.test(
        intentText,
      )
    ) {
      return false;
    }
    if (
      /\b(?:submit the form|form submission completes|submitted record|created record|created\/updated record|confirmation|resulting item page)\b/i.test(
        intentText,
      )
    ) {
      return true;
    }
    return /\bcreate\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:incident|change request|problem|record|user|hardware asset|asset)\b/i.test(
      intentText,
    );
  }

  private hasTaskLevelServiceNowSubmitIntent(): boolean {
    const text = `${this.originalQuery}\n${this.planSteps
      .map((step) => `${step.objective}\n${step.successCriteria ?? ""}`)
      .join("\n")}`;
    if (
      /\b(?:submit the form|form submission completes|submitted record|created record|created\/updated record|confirmation|resulting item page)\b/i.test(
        text,
      )
    ) {
      return true;
    }
    if (
      /\b(?:do not submit|not submit|ready to submit|submit action has not been clicked|has not been submitted)\b/i.test(
        text,
      )
    ) {
      return false;
    }
    return /\bcreate\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:incident|change request|problem|record|user|hardware asset|asset)\b/i.test(
      text,
    );
  }

  private isTaskLevelServiceNowRecordWorkflow(): boolean {
    if (this.selectedSkillId !== "servicenow-record-form") return false;
    const text = this.getServiceNowRecordWorkflowText();
    if (
      /\bObjective:\s*Complete the workflow for the original request\b/i.test(
        text,
      )
    ) {
      return true;
    }
    return (
      extractFieldValuePairs(text).length > 0 &&
      /\b(?:ServiceNow|incident|change request|problem|record)\b/i.test(text) &&
      /\b(?:create|new|submit|submitted|created record|confirmation)\b/i.test(
        text,
      )
    );
  }

  private getServiceNowRecordWorkflowText(): string {
    return [
      this.originalQuery,
      ...this.planSteps.flatMap((step) => [
        step.objective,
        step.successCriteria ?? "",
      ]),
      ...this.planSubtasks.map((subtask) => subtask.description),
    ]
      .filter((part): part is string => typeof part === "string")
      .join("\n");
  }

  private async maybeRunAtomicSkillController(
    tabId: number,
  ): Promise<LoopResult | null> {
    const contract = getLoadedSkillContract(this.selectedSkillId ?? undefined, {
      enabledSkillPackIds: this.enabledSkillPackIds,
    });
    if (!contract?.atomic) return null;
    if (this.getMissingRequiredEvidenceTypes().length === 0) return null;

    const preferredTool = contract.preferredTools
      ?.map((tool) => tool as ToolName)
      .find((tool) => tool !== ToolName.DONE && tool !== ToolName.READ_PAGE);
    if (!preferredTool) return null;

    const activePlanIndex = this.planSubtasks.findIndex(
      (subtask) => subtask.status === "running",
    );
    const activePlanStep =
      activePlanIndex >= 0
        ? this.planSteps[activePlanIndex]
        : this.planSteps[0];
    const activeSubtask =
      activePlanIndex >= 0 ? this.planSubtasks[activePlanIndex] : undefined;
    const controllerText = [
      this.originalQuery,
      activeSubtask?.description,
      activePlanStep?.objective,
      activePlanStep?.successCriteria,
    ]
      .filter((part): part is string => typeof part === "string")
      .join("\n");
    const fields = extractFieldValuePairs(controllerText);
    if (
      preferredTool === ToolName.CONFIGURE_SERVICENOW_FORM &&
      fields.length === 0
    ) {
      return null;
    }
    const moduleRequest =
      preferredTool === ToolName.OPEN_SERVICENOW_MODULE
        ? extractServiceNowModuleRequest(controllerText)
        : null;
    if (preferredTool === ToolName.OPEN_SERVICENOW_MODULE && !moduleRequest) {
      return null;
    }

    const args: Record<string, unknown> =
      preferredTool === ToolName.CONFIGURE_SERVICENOW_FORM
        ? {
            fields,
            submit: this.hasTrustedServiceNowSubmitIntent(controllerText),
            submitButton: "Submit",
          }
        : preferredTool === ToolName.OPEN_SERVICENOW_MODULE && moduleRequest
          ? moduleRequest
          : {};

    this.statusHandler(AgentStatus.ACTING, `Running ${contract.name}...`);
    this.turnCount++;
    this.startServiceNowRecordControllerTraceTurn(fields.length);
    const toolCall: ToolCall = {
      id: `atomic_${crypto.randomUUID()}`,
      type: "function",
      function: {
        name: preferredTool,
        arguments: JSON.stringify(args),
      },
    } as ToolCall;

    const startedAt = Date.now();
    this.traceRecorder?.recordEvent("atomic_skill_controller_started", {
      turn: this.turnCount,
      selectedSkillId: contract.id,
      preferredTool,
    });
    const result = await this.executeToolCall(toolCall, tabId);
    const durationMs = Date.now() - startedAt;
    this.traceRecorder?.recordToolExecution(
      toolCall.id,
      preferredTool,
      args,
      result,
      !result.startsWith("Error:"),
      durationMs,
      RiskLevel.MEDIUM,
      result.startsWith("Error:") ? result : undefined,
    );
    this.context.addMessage({
      role: "tool",
      content: result,
      tool_call_id: toolCall.id,
    });

    const missing = this.getMissingRequiredEvidenceTypes();
    if (missing.length > 0) {
      this.traceRecorder?.recordEvent("atomic_skill_controller_deferred", {
        turn: this.turnCount,
        selectedSkillId: contract.id,
        missing,
      });
      this.context.addMessage({
        role: "user",
        content:
          `The atomic ${contract.name} controller did not collect all required evidence yet. ` +
          `Missing: ${missing.join(", ")}. Continue manually with the selected workflow tool.`,
      });
      await this.traceRecorder?.endTurn();
      return null;
    }

    const recordSummary = this.evidenceAccumulator
      .getByType("record_identity_observed")
      .at(-1)
      ?.detail?.recordNumber?.toString();
    const navigationEvidence = this.evidenceAccumulator
      .getByType("navigation_reached")
      .at(-1);
    const navigationSummary = navigationEvidence
      ? [
          navigationEvidence.detail?.application,
          ...(Array.isArray(navigationEvidence.detail?.path)
            ? navigationEvidence.detail.path
            : []),
        ]
          .filter(
            (part): part is string =>
              typeof part === "string" && part.length > 0,
          )
          .join(" > ")
      : "";
    const summary =
      recordSummary ||
      (navigationSummary
        ? `Successfully opened ServiceNow module ${navigationSummary}.`
        : "") ||
      result.split("\n").find((line) => /submitted|configured/i.test(line)) ||
      `${contract.name} completed with required evidence.`;
    const finalSummary =
      /completed|submitted|configured|opened|navigated/i.test(summary)
        ? summary
        : `${contract.name} completed: ${summary}`;
    this.completeTaskResult(finalSummary);
    this.traceRecorder?.recordEvent("atomic_skill_controller_completed", {
      turn: this.turnCount,
      selectedSkillId: contract.id,
      evidenceCount: this.evidenceAccumulator.toArray().length,
    });
    await this.traceRecorder?.endTurn();
    return {
      outcome: "completed",
      turnCount: this.turnCount,
      summary: finalSummary,
      failure: { category: "none", code: "none" },
      metrics: this.getMetrics(),
      evidence: this.evidenceAccumulator.toArray(),
    };
  }

  private async executeServiceNowRecordControllerTool(params: {
    tabId: number;
    args: Record<string, unknown>;
    label: string;
    eventName: string;
  }): Promise<{ toolCall: ToolCall; result: string; ok: boolean }> {
    const traceArgs = JSON.parse(JSON.stringify(params.args)) as Record<
      string,
      unknown
    >;
    const toolCall: ToolCall = {
      id: `controller_${crypto.randomUUID()}`,
      type: "function",
      function: {
        name: ToolName.CONFIGURE_SERVICENOW_FORM,
        arguments: JSON.stringify(traceArgs),
      },
    } as ToolCall;
    const toolStep: AgentStep = {
      id: crypto.randomUUID(),
      type: "tool",
      label: params.label,
      detail: JSON.stringify(traceArgs),
      toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
      status: "running",
      timestamp: Date.now(),
    };

    this.stepHandler(toolStep, false);
    this.traceRecorder?.recordEvent(params.eventName, {
      turn: this.turnCount,
      trustedTool: ToolName.CONFIGURE_SERVICENOW_FORM,
      fieldCount: Array.isArray(traceArgs.fields) ? traceArgs.fields.length : 0,
      submit: traceArgs.submit === true,
    });

    const startedAt = Date.now();
    let result = "";
    let ok = false;
    try {
      result = await this.executeToolCall(toolCall, params.tabId);
      ok = !result.startsWith("Error:");
    } catch (error) {
      result = `Error: ${error instanceof Error ? error.message : String(error)}`;
      ok = false;
    }
    const durationMs = Date.now() - startedAt;

    this.stepHandler(
      {
        ...toolStep,
        status: ok ? "done" : "error",
        durationMs,
        ...(ok ? {} : { errorMessage: result }),
      },
      true,
    );
    this.traceRecorder?.recordToolExecution(
      toolCall.id,
      ToolName.CONFIGURE_SERVICENOW_FORM,
      traceArgs,
      result,
      ok,
      durationMs,
      RiskLevel.MEDIUM,
      ok ? undefined : result,
    );
    this.context.addMessage({
      role: "tool",
      content: result,
      tool_call_id: toolCall.id,
    });

    return { toolCall, result, ok };
  }

  private isServiceNowRecordFormLoadMiss(result: string): boolean {
    return /could not find a servicenow record form|no servicenow record form|record form .*not.*found/i.test(
      result,
    );
  }

  private startServiceNowRecordControllerTraceTurn(fieldCount: number): void {
    if (!this.traceRecorder) return;

    const messages = this.context.getPrompt();
    const metrics = this.context.getPromptMetricsFrom(messages);
    const snap = this.context.getSnapshot();
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
      1,
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
        cachedPrefixLength: cachedPrefixLength >= 0 ? cachedPrefixLength : 0,
      },
      this.llm.isPlannerTier() ? "planner" : "executor",
    );
    this.traceRecorder.recordEvent("servicenow_record_controller_started", {
      turn: this.turnCount,
      fieldCount,
      trustedTool: ToolName.CONFIGURE_SERVICENOW_FORM,
    });
  }

  private async maybeRunServiceNowRecordFormController(
    tabId: number,
  ): Promise<LoopResult | null> {
    if (!this.isTaskLevelServiceNowRecordWorkflow()) return null;
    if (!this.hasTaskLevelServiceNowSubmitIntent()) return null;

    const fields = extractFieldValuePairs(this.getServiceNowRecordWorkflowText());
    if (fields.length === 0) return null;

    this.statusHandler(AgentStatus.ACTING, "Configuring ServiceNow form...");
    this.log.info("agent", "ServiceNow record form controller started", {
      turn: this.turnCount,
      fieldCount: fields.length,
    });

    this.turnCount++;
    this.startServiceNowRecordControllerTraceTurn(fields.length);
    try {
      const fillArgs = { fields, submit: false };
      let fill = await this.executeServiceNowRecordControllerTool({
        tabId,
        args: fillArgs,
        label: "Configure ServiceNow form",
        eventName: "servicenow_record_controller_fill_started",
      });
      let fillSignal = detectTrustedFormFillStepCompletion({
        toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
        toolArgs: fillArgs,
        toolResult: fill.result,
      });
      const maxFormLoadRetries = 5;
      for (
        let attempt = 1;
        (!fill.ok || !fillSignal) &&
        this.isServiceNowRecordFormLoadMiss(fill.result) &&
        attempt <= maxFormLoadRetries;
        attempt++
      ) {
        this.traceRecorder?.recordEvent(
          "servicenow_record_controller_fill_retry_queued",
          {
            turn: this.turnCount,
            attempt,
            reason: "form_not_ready",
          },
        );
        await waitForDomReady(tabId, {
          timeoutMs: 750 + attempt * 500,
          waitForElements: true,
        });
        fill = await this.executeServiceNowRecordControllerTool({
          tabId,
          args: fillArgs,
          label: `Configure ServiceNow form (retry ${attempt})`,
          eventName: "servicenow_record_controller_fill_retry_started",
        });
        fillSignal = detectTrustedFormFillStepCompletion({
          toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
          toolArgs: fillArgs,
          toolResult: fill.result,
        });
      }
      if (!fill.ok || !fillSignal) {
        this.traceRecorder?.recordEvent(
          "servicenow_record_controller_deferred",
          {
            turn: this.turnCount,
            phase: "fill",
            reason: fill.ok ? "untrusted_fill_result" : "tool_error",
          },
        );
        this.context.addMessage({
          role: "user",
          content:
            "The ServiceNow record form controller could not verify every requested field. Continue manually, using configure_servicenow_form again after correcting missing or mismatched fields.",
        });
        return null;
      }

      this.maybeAdvanceTrustedFormFillStep({
        toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
        toolArgs: fillArgs,
        toolResult: fill.result,
        mode: "sequential",
      });

      const submitArgs = { submit: true, submitButton: "Submit" };
      const submit = await this.executeServiceNowRecordControllerTool({
        tabId,
        args: submitArgs,
        label: "Submit ServiceNow form",
        eventName: "servicenow_record_controller_submit_started",
      });
      let completion = this.maybeCompleteTrustedFormSubmitStep({
        toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
        toolArgs: submitArgs,
        toolResult: submit.result,
        mode: "sequential",
      });

      if (submit.ok && !completion) {
        this.traceRecorder?.recordEvent(
          "servicenow_record_controller_submit_retry_queued",
          {
            turn: this.turnCount,
            reason: "untrusted_submit_result",
          },
        );
        await waitForDomReady(tabId, { timeoutMs: 500, waitForElements: true });

        const refill = await this.executeServiceNowRecordControllerTool({
          tabId,
          args: fillArgs,
          label: "Recheck ServiceNow form",
          eventName: "servicenow_record_controller_refill_started",
        });
        const refillSignal = detectTrustedFormFillStepCompletion({
          toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
          toolArgs: fillArgs,
          toolResult: refill.result,
        });
        if (refill.ok && refillSignal) {
          this.traceRecorder?.recordEvent(
            "servicenow_record_controller_submit_retry_ready",
            {
              turn: this.turnCount,
              fieldCount: fields.length,
            },
          );
          const retrySubmit = await this.executeServiceNowRecordControllerTool({
            tabId,
            args: submitArgs,
            label: "Retry ServiceNow submit",
            eventName: "servicenow_record_controller_submit_retry_started",
          });
          completion = this.maybeCompleteTrustedFormSubmitStep({
            toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
            toolArgs: submitArgs,
            toolResult: retrySubmit.result,
            mode: "sequential",
          });
        } else {
          this.traceRecorder?.recordEvent(
            "servicenow_record_controller_submit_retry_abandoned",
            {
              turn: this.turnCount,
              reason: refill.ok
                ? "untrusted_refill_result"
                : "refill_tool_error",
            },
          );
        }
      }
      if (!submit.ok || !completion) {
        this.traceRecorder?.recordEvent(
          "servicenow_record_controller_deferred",
          {
            turn: this.turnCount,
            phase: "submit",
            reason: submit.ok ? "untrusted_submit_result" : "tool_error",
          },
        );
        this.context.addMessage({
          role: "user",
          content:
            "The ServiceNow record form controller filled the requested fields but did not get trusted submit evidence. Verify validation errors or submit the form with configure_servicenow_form({ submit: true }).",
        });
        return null;
      }

      const summary = completion.finalSummary;
      this.completeTaskResult(summary);
      this.traceRecorder?.recordEvent(
        "servicenow_record_controller_completed",
        {
          turn: this.turnCount,
          summary,
        },
      );

      return {
        outcome: "completed",
        turnCount: this.turnCount,
        summary,
        failure: { category: "none", code: "none" },
        metrics: this.getMetrics(),
      };
    } finally {
      await this.traceRecorder?.endTurn();
    }
  }

  private shouldAutoSubmitTrustedServiceNowForm(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
  }): boolean {
    if (this.selectedSkillId !== "servicenow-record-form") return false;
    if (!this.isTaskLevelServiceNowRecordWorkflow()) return false;
    if (!this.hasTaskLevelServiceNowSubmitIntent()) return false;
    const signal = detectTrustedFormFillStepCompletion({
      toolName: params.toolName,
      toolArgs: params.toolArgs,
      toolResult: params.toolResult,
    });
    if (!signal) return false;
    const missingFields =
      this.getMissingTrustedServiceNowAutoSubmitFields(params);
    if (missingFields.length > 0) {
      this.traceRecorder?.recordEvent("trusted_form_auto_submit_blocked", {
        turn: this.turnCount,
        reason: "missing_requested_fields",
        missingFields,
        trustedTool: ToolName.CONFIGURE_SERVICENOW_FORM,
      });
      return false;
    }
    return true;
  }

  private getMissingTrustedServiceNowAutoSubmitFields(params: {
    toolArgs?: Record<string, unknown>;
    toolResult: string;
  }): string[] {
    const expectedFields = extractFieldValuePairs(
      this.getServiceNowRecordWorkflowText(),
    );
    if (expectedFields.length === 0) return [];

    const normalizeField = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9 _-]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const normalizeValue = (value: string) => {
      let normalized = value.trim();
      if (/^\((empty|none|null)\)$/i.test(normalized)) return "";
      normalized = normalized
        .replace(/^"([\s\S]*)"$/, "$1")
        .replace(/^'([\s\S]*)'$/, "$1")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return normalized;
    };
    const configuredRows = [
      ...params.toolResult.matchAll(
        /(?:^|\n)- (.+?)\s+\(([^)]+)\) =\s*([\s\S]*?)(?=\n- .+?\s+\([^)]+\) =|\nServiceNow form fields discovered|\nCurrent URL|\nCurrent title|\nMismatches:|$)/g,
      ),
    ].map((match) => ({
      field: match[1] ?? "",
      systemName: match[2] ?? "",
      value: match[3] ?? "",
    }));

    return expectedFields
      .filter((expected) => {
        const expectedField = normalizeField(expected.field);
        if (!expectedField) return true;
        const row = configuredRows.find(
          (entry) =>
            normalizeField(entry.field) === expectedField ||
            normalizeField(entry.systemName) === expectedField,
        );
        if (!row) return true;
        const expectedValue = normalizeValue(expected.value);
        if (!expectedValue) {
          return normalizeValue(row.value) !== "";
        }
        const actualValue = normalizeValue(row.value);
        return actualValue !== expectedValue;
      })
      .map((field) => field.field);
  }

  private async maybeAutoSubmitTrustedServiceNowForm(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    tabId: number;
    mode: "parallel" | "sequential";
  }): Promise<{ finalSummary: string; newIndex: number } | null> {
    if (!this.shouldAutoSubmitTrustedServiceNowForm(params)) return null;

    const submitArgs = { submit: true, submitButton: "Submit" };
    const submitToolCall: ToolCall = {
      id: `auto_${crypto.randomUUID()}`,
      type: "function",
      function: {
        name: ToolName.CONFIGURE_SERVICENOW_FORM,
        arguments: JSON.stringify(submitArgs),
      },
    } as ToolCall;
    const toolStep: AgentStep = {
      id: crypto.randomUUID(),
      type: "tool",
      label: "Submit ServiceNow form",
      detail: JSON.stringify(submitArgs),
      toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
      status: "running",
      timestamp: Date.now(),
    };
    this.stepHandler(toolStep, false);
    this.log.info("agent", "Auto-submitting trusted ServiceNow form", {
      turn: this.turnCount,
      mode: params.mode,
    });
    this.traceRecorder?.recordEvent("trusted_form_auto_submit_started", {
      turn: this.turnCount,
      mode: params.mode,
      trustedTool: ToolName.CONFIGURE_SERVICENOW_FORM,
    });

    const startedAt = Date.now();
    const result = await this.executeToolCall(submitToolCall, params.tabId);
    const durationMs = Date.now() - startedAt;
    this.stepHandler(
      {
        ...toolStep,
        status: "done",
        durationMs,
      },
      true,
    );
    this.traceRecorder?.recordToolExecution(
      submitToolCall.id,
      ToolName.CONFIGURE_SERVICENOW_FORM,
      submitArgs,
      result,
      true,
      durationMs,
      RiskLevel.MEDIUM,
    );
    this.context.addMessage({
      role: "tool",
      content: result,
      tool_call_id: submitToolCall.id,
    });

    return this.maybeCompleteTrustedFormSubmitStep({
      toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
      toolArgs: submitArgs,
      toolResult: result,
      mode: params.mode,
    });
  }

  private maybeCompleteTrustedFormSubmitStep(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    mode: "parallel" | "sequential";
  }): { finalSummary: string; newIndex: number } | null {
    const signal = detectTrustedFormSubmitCompletion({
      toolName: params.toolName,
      toolArgs: params.toolArgs,
      toolResult: params.toolResult,
    });
    if (!signal) return null;

    const plan = this.context.getPlanStatusRaw();
    if (
      !plan ||
      plan.currentIndex < 0 ||
      plan.currentIndex >= plan.subtasks.length
    ) {
      if (
        this.selectedSkillId !== "servicenow-record-form" ||
        !this.hasTaskLevelServiceNowSubmitIntent()
      ) {
        return null;
      }

      this.log.info("agent", "trusted form helper completed planless submit", {
        turn: this.turnCount,
        mode: params.mode,
        submittedRecord: signal.submittedRecord,
      });
      this.traceRecorder?.recordEvent("trusted_form_submit_success", {
        fromStep: -1,
        toStep: 0,
        matchedTokens: signal.matchedTokens,
        reason: signal.reason,
        submittedRecord: signal.submittedRecord,
        trustedTool: params.toolName,
        mode: params.mode,
        completedAllSteps: true,
        planless: true,
      });
      return { finalSummary: signal.reason, newIndex: 0 };
    }

    const currentSubtask = plan.subtasks[plan.currentIndex];
    if (!currentSubtask) return null;
    if (this.getActiveToolProfileForStep(plan.currentIndex) !== "submit_form") {
      return null;
    }

    this.consecutiveAutoAdvances = 0;
    const fromStep = plan.currentIndex;
    const newIndex = completeRemainingSubtasks(
      this as unknown as AgentLoopPlanProgressHost,
      fromStep,
      signal.reason,
    );
    this.syncPlanStatus(newIndex, "trusted_form_submit_success", {
      reason: signal.reason,
      matchedTokens: signal.matchedTokens,
      submittedRecord: signal.submittedRecord,
      advancedTo: newIndex,
      mode: params.mode,
      trustedTool: params.toolName,
    });
    this.broadcastTaskProgress(newIndex);
    this.log.info("agent", "trusted form helper completed submit step", {
      turn: this.turnCount,
      fromStep,
      toStep: newIndex,
      mode: params.mode,
      submittedRecord: signal.submittedRecord,
    });
    this.traceRecorder?.recordEvent("trusted_form_submit_success", {
      fromStep,
      toStep: newIndex,
      matchedTokens: signal.matchedTokens,
      reason: signal.reason,
      submittedRecord: signal.submittedRecord,
      trustedTool: params.toolName,
      mode: params.mode,
      completedAllSteps: newIndex >= this.planSubtasks.length,
    });
    return { finalSummary: signal.reason, newIndex };
  }

  private maybeCompleteCatalogOrderFromSnapshot(): LoopResult | null {
    if (this.selectedSkillId !== "catalog-order-workflow") return null;
    const snapshot = this.context.getSnapshot();
    if (!snapshot) return null;
    const pageText = [
      snapshot.title,
      snapshot.url,
      snapshot.visibleContent,
      snapshot.pageContent,
    ]
      .filter(Boolean)
      .join("\n");
    const requestNumber = pageText.match(/\bREQ\d+\b/i)?.[0]?.toUpperCase();
    if (!requestNumber || !/\border status\b|\brequest number\b/i.test(pageText)) {
      return null;
    }

    const itemName = this.extractExpectedCatalogItemNameFromQuery();
    const trustedSubmission = this.getFreshTrustedCatalogOrderSubmission();
    if (
      itemName &&
      !pageText.toLowerCase().includes(itemName.toLowerCase()) &&
      !this.trustedCatalogOrderSubmissionCoversRequest(trustedSubmission)
    ) {
      return null;
    }

    const quantity = this.extractExpectedCatalogQuantityFromQuery();
    if (
      quantity &&
      /\bquantity\b/i.test(pageText) &&
      !new RegExp(`\\b${quantity}\\b`).test(pageText)
    ) {
      return null;
    }

    const summaryParts = [`Catalog order submitted: ${requestNumber}.`];
    if (itemName) summaryParts.push(`Item: ${itemName}.`);
    if (quantity) summaryParts.push(`Quantity: ${quantity}.`);
    if (trustedSubmission) {
      summaryParts.push("Requested configuration verified before submission.");
    }
    const summary = summaryParts.join(" ");
    this.completeTaskResult(summary);
    this.traceRecorder?.recordEvent("catalog_order_snapshot_completed", {
      turn: this.turnCount,
      requestNumber,
      itemName: itemName ?? null,
      quantity,
    });
    return {
      outcome: "completed",
      turnCount: this.turnCount,
      summary,
      failure: { category: "none", code: "none" },
      metrics: this.getMetrics(),
    };
  }

  private extractExpectedCatalogItemNameFromQuery(): string | null {
    const quotedOrderItem =
      this.originalQuery.match(
        /\b(?:order|request|purchase|buy)\s+\d+\s+"([^"]{3,120})"/i,
      )?.[1] ??
      this.originalQuery.match(
        /\b(?:order|request|purchase|buy|configure)\s+"([^"]{3,120})"/i,
      )?.[1] ??
      this.originalQuery.match(
        /"([^"]{3,120})"\s+(?:from|in)\s+(?:the\s+)?(?:service\s+)?catalog\b/i,
      )?.[1] ??
      null;
    if (quotedOrderItem) return quotedOrderItem.trim();

    const namedItem =
      this.originalQuery.match(
        /\b(?:catalog item|item|product)\s+(?:named|called)\s+(.{3,120}?)(?=\s+(?:with|and|from|in)\b|[.,;\n]|$)/i,
      )?.[1] ?? null;
    return namedItem ? namedItem.replace(/^["']|["']$/g, "").trim() : null;
  }

  private extractExpectedCatalogQuantityFromQuery(): string | null {
    return (
      this.originalQuery.match(/\border\s+(\d+)\b/i)?.[1] ??
      this.originalQuery.match(/\bquantity\s*(?:of|=|:)?\s*(\d+)\b/i)?.[1] ??
      null
    );
  }

  private extractExpectedCatalogConfigurationFieldsFromQuery(): string[] {
    const fields = new Set<string>();
    for (const match of this.originalQuery.matchAll(
      /['"]([^'"]{2,160})['"]\s*:/g,
    )) {
      const field = match[1]?.replace(/\s+/g, " ").trim();
      if (field) fields.add(field);
    }
    return [...fields];
  }

  private catalogConfigurationEvidenceCoversRequest(toolResult: string): boolean {
    const expectedFields = this.extractExpectedCatalogConfigurationFieldsFromQuery();
    if (expectedFields.length === 0) return true;
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
    const evidence = normalize(toolResult);
    return expectedFields.every((field) => evidence.includes(normalize(field)));
  }

  private getFreshTrustedCatalogOrderSubmission(): TrustedCatalogOrderSubmission | null {
    if (!this.trustedCatalogOrderSubmission) return null;
    return this.turnCount - this.trustedCatalogOrderSubmission.submittedAtTurn <= 6
      ? this.trustedCatalogOrderSubmission
      : null;
  }

  private trustedCatalogOrderSubmissionCoversRequest(
    submission: TrustedCatalogOrderSubmission | null,
  ): boolean {
    if (!submission) return false;
    if (this.extractExpectedCatalogConfigurationFieldsFromQuery().length === 0) {
      return false;
    }
    const itemName = this.extractExpectedCatalogItemNameFromQuery();
    if (itemName && submission.itemName !== itemName) return false;
    const quantity = this.extractExpectedCatalogQuantityFromQuery();
    if (quantity && submission.quantity !== quantity) return false;
    return this.catalogConfigurationEvidenceCoversRequest(
      submission.configuredResult,
    );
  }

  private shouldAutoSubmitConfiguredCatalogItem(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
  }): boolean {
    if (this.selectedSkillId !== "catalog-order-workflow") return false;
    if (params.toolName !== ToolName.CONFIGURE_CATALOG_ITEM) return false;
    if (params.toolArgs?.submit === true) return false;
    if (!/\b(order|request|cart|checkout)\b/i.test(this.originalQuery)) {
      return false;
    }
    if (!/^Configured catalog item\./i.test(params.toolResult)) return false;
    if (
      /\b(?:Error:|incomplete|Missing|Mismatches|could not|not found)\b/i.test(
        params.toolResult,
      )
    ) {
      return false;
    }
    if (!this.catalogConfigurationEvidenceCoversRequest(params.toolResult)) {
      return false;
    }
    return true;
  }

  private async maybeAutoSubmitConfiguredCatalogItem(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    tabId: number;
    mode: "parallel" | "sequential";
  }): Promise<void> {
    if (!this.shouldAutoSubmitConfiguredCatalogItem(params)) return;

    const submitArgs = {
      ...(params.toolArgs ?? {}),
      submit: true,
      continueToCheckout: true,
    };
    const submitToolCall: ToolCall = {
      id: `auto_${crypto.randomUUID()}`,
      type: "function",
      function: {
        name: ToolName.CONFIGURE_CATALOG_ITEM,
        arguments: JSON.stringify(submitArgs),
      },
    } as ToolCall;
    const toolStep: AgentStep = {
      id: crypto.randomUUID(),
      type: "tool",
      label: "Submit configured catalog item",
      detail: JSON.stringify(submitArgs),
      toolName: ToolName.CONFIGURE_CATALOG_ITEM,
      status: "running",
      timestamp: Date.now(),
    };
    this.stepHandler(toolStep, false);
    this.log.info("agent", "Auto-submitting configured catalog item", {
      turn: this.turnCount,
      mode: params.mode,
    });
    this.traceRecorder?.recordEvent("catalog_config_auto_submit_started", {
      turn: this.turnCount,
      mode: params.mode,
      trustedTool: ToolName.CONFIGURE_CATALOG_ITEM,
    });

    const startedAt = Date.now();
    const result = await this.executeToolCall(submitToolCall, params.tabId);
    const durationMs = Date.now() - startedAt;
    this.stepHandler(
      {
        ...toolStep,
        status: /^Error:/i.test(result) ? "error" : "done",
        durationMs,
        ...(/^Error:/i.test(result) ? { errorMessage: result } : {}),
      },
      true,
    );
    this.traceRecorder?.recordToolExecution(
      submitToolCall.id,
      ToolName.CONFIGURE_CATALOG_ITEM,
      submitArgs,
      result,
      !/^Error:/i.test(result),
      durationMs,
      RiskLevel.MEDIUM,
      /^Error:/i.test(result) ? result : undefined,
    );
    this.context.addMessage({
      role: "tool",
      content: result,
      tool_call_id: submitToolCall.id,
    });
    if (
      !/^Error:/i.test(result) &&
      !/\b(?:incomplete|Missing|Mismatches|could not|not found)\b/i.test(result)
    ) {
      this.trustedCatalogOrderSubmission = {
        itemName: this.extractExpectedCatalogItemNameFromQuery(),
        quantity: this.extractExpectedCatalogQuantityFromQuery(),
        configuredResult: params.toolResult,
        submittedAtTurn: this.turnCount,
      };
    }
  }

  private completeSubmitFormReset(
    currentIndex: number,
    signal: NonNullable<ReturnType<typeof detectFormSubmissionResetSuccess>>,
  ): { finalSummary: string; newIndex: number } {
    const newIndex = completeRemainingSubtasks(
      this as unknown as AgentLoopPlanProgressHost,
      currentIndex,
      signal.reason,
    );
    this.syncPlanStatus(newIndex, "submit_form_reset_success", {
      reason: signal.reason,
      previousRecordId: signal.previousRecordId,
      currentRecordId: signal.currentRecordId,
      filledFieldsBeforeSubmit: signal.filledFieldsBeforeSubmit,
      advancedTo: newIndex,
    });
    this.broadcastTaskProgress(newIndex);
    this.log.info("agent", "submit_form_reset_success", {
      turn: this.turnCount,
      fromStep: currentIndex,
      toStep: newIndex,
      previousRecordId: signal.previousRecordId,
      currentRecordId: signal.currentRecordId,
    });
    this.traceRecorder?.recordEvent("submit_form_reset_success", {
      fromStep: currentIndex,
      toStep: newIndex,
      reason: signal.reason,
      previousRecordId: signal.previousRecordId,
      currentRecordId: signal.currentRecordId,
      filledFieldsBeforeSubmit: signal.filledFieldsBeforeSubmit,
    });

    return { finalSummary: signal.reason, newIndex };
  }

  private evaluateTextAdmissionAdvanceGate(params: {
    summary: string;
    consecutiveTextOnly: number;
  }): {
    passed: boolean;
    runningIdx: number;
    isLastStep: boolean;
    reason?: string;
  } {
    const { summary, consecutiveTextOnly } = params;
    const runningIdx = this.planSubtasks.findIndex(
      (s) => s.status === "running",
    );
    if (runningIdx < 0) {
      return {
        passed: false,
        runningIdx: -1,
        isLastStep: false,
        reason: "no_running_step",
      };
    }

    const requiredTextOnlyTurns = this.verificationTurnMode ? 1 : 2;
    if (consecutiveTextOnly < requiredTextOnlyTurns) {
      return {
        passed: false,
        runningIdx,
        isLastStep: false,
        reason:
          requiredTextOnlyTurns === 1
            ? "verification_turn_waiting"
            : "first_text_only_turn",
      };
    }

    const currentStep = this.planSteps[runningIdx];
    if (!currentStep?.successCriteria) {
      return {
        passed: false,
        runningIdx,
        isLastStep: false,
        reason: "missing_success_criteria",
      };
    }

    const sentiment = assessDoneSummary(summary);
    if (!sentiment.confident) {
      return {
        passed: false,
        runningIdx,
        isLastStep: false,
        reason: `failure_sentiment:${sentiment.reason ?? "unknown"}`,
      };
    }

    const criteriaCheck = matchSuccessCriteria({
      successCriteria: currentStep.successCriteria,
      snapshot: this.context.getSnapshot(),
    });
    if (!criteriaCheck.satisfied) {
      return {
        passed: false,
        runningIdx,
        isLastStep: false,
        reason: "criteria_mismatch",
      };
    }

    const coherence = checkSummaryStepCoherence({
      summary,
      currentStepIndex: runningIdx,
      stepDescriptions: this.planSubtasks.map((s) => s.description),
    });
    if (!coherence.coherent) {
      return {
        passed: false,
        runningIdx,
        isLastStep: false,
        reason: `coherence_failed:${coherence.reason ?? "unknown"}`,
      };
    }

    const pendingCount = this.planSubtasks.filter(
      (s) => s.status === "pending",
    ).length;

    return {
      passed: true,
      runningIdx,
      isLastStep: pendingCount === 0,
    };
  }

  private shouldBypassPlanIncompleteDoneRejection(params: {
    summary: string;
    currentStepIndex: number;
  }): boolean {
    const { summary, currentStepIndex } = params;
    if (
      currentStepIndex < 0 ||
      currentStepIndex >= this.planSubtasks.length - 1 ||
      currentStepIndex >= this.planSteps.length
    ) {
      return false;
    }

    const currentStep = this.planSteps[currentStepIndex];
    if (!currentStep?.successCriteria) return false;

    const taskContext = [
      this.originalQuery,
      this.planSubtasks[currentStepIndex]?.description,
      currentStep.successCriteria,
    ]
      .filter(
        (part): part is string => typeof part === "string" && part.length > 0,
      )
      .join("\n");

    const sentiment = assessDoneSummary(summary);
    if (!sentiment.confident) return false;

    if (this.nodeId) {
      const snapshot = this.context.getSnapshot();
      const summaryTokens = new Set(tokenizeStepText(summary));
      const snapshotText = normalizeGuardText(
        `${snapshot?.title || ""}\n${snapshot?.url || ""}\n${snapshot?.visibleContent || ""}\n${snapshot?.pageContent || ""}`,
      );
      const groundedSummaryTokens = [...summaryTokens].filter((token) =>
        snapshotText.includes(token),
      );
      if (groundedSummaryTokens.length >= 2) {
        return true;
      }
    }

    const summaryText = normalizeGuardText(summary);
    const snapshot = this.context.getSnapshot();
    const snapshotText = normalizeGuardText(
      `${snapshot?.title || ""}\n${snapshot?.url || ""}\n${snapshot?.visibleContent || ""}\n${snapshot?.pageContent || ""}`,
    );
    const confirmationIntent =
      /\b(submit|submission|confirm|confirmation|sent|saved|applied|placed)\b/i.test(
        taskContext,
      );
    const summaryShowsFinalization =
      /\b(submitted?|submission complete|completed?|confirmed?|confirmation|saved|applied|sent|placed|finished)\b/i.test(
        summaryText,
      );
    const snapshotShowsFinalState =
      /\b(submission complete|submitted successfully|success(?:fully)?|thank you|reference(?: number)?|confirmation(?: number| page)?|has been submitted|request received|completed successfully|order confirmed|receipt)\b/i.test(
        snapshotText,
      );

    const multiTabChecklistIntent =
      this.selectedSkillId === "multi-tab-checklist-workflow" ||
      /\b(procurement|purchase|buy|checklist|source list|separate tabs?|new tabs?)\b/i.test(
        taskContext,
      );
    if (multiTabChecklistIntent) {
      const summaryShowsTargetWork =
        /\b(purchase|purchased|order|ordered|confirmed|bought|place(?:d)? order|reviewed|captured|extracted|recorded)\b/i.test(
          summaryText,
        );
      const summaryShowsSourceReturn =
        /\b(check(?:ed|ing)? off|mark(?:ed|ing)? .* (?:done|complete|reviewed)|record(?:ed|ing)? .* reviewed|returned? to .* (?:list|checklist|procurement|board|source)|back on .* (?:list|checklist|procurement|board|source))\b/i.test(
          summaryText,
        );
      const sourceLooksComplete =
        /\b\d+\s+of\s+\d+\s+items?\s+completed\b/i.test(snapshotText) ||
        /\b(mark .* as done|all items procured|viewed|reviewed|completed)\b/i.test(
          snapshotText,
        );

      if (
        summaryShowsTargetWork &&
        summaryShowsSourceReturn &&
        sourceLooksComplete
      ) {
        return true;
      }
    }

    if (
      confirmationIntent &&
      summaryShowsFinalization &&
      snapshotShowsFinalState
    ) {
      return true;
    }

    const nextStepText = normalizeGuardText(
      [
        this.planSubtasks[currentStepIndex + 1]?.description,
        this.planSteps[currentStepIndex + 1]?.objective,
        this.planSteps[currentStepIndex + 1]?.successCriteria,
      ]
        .filter(
          (part): part is string => typeof part === "string" && part.length > 0,
        )
        .join("\n"),
    );
    const nextStepIsFinalizationOnly =
      /\b(?:terminate|end|close|finali[sz]e)\b[\s\S]{0,80}\b(?:task|workflow|run)\b/i.test(
        nextStepText,
      ) ||
      /\b(?:finish|complete)\s+(?:the\s+)?(?:task|workflow|run)\b/i.test(
        nextStepText,
      ) ||
      /\b(?:task|workflow|run)\s+(?:is\s+)?(?:finished|complete|completed|done)\b/i.test(
        nextStepText,
      ) ||
      /\b(?:call|use)\s+done\b/i.test(nextStepText) ||
      /\breport\s+(?:success|completion|that\b[\s\S]{0,80}\bcomplete)/i.test(
        nextStepText,
      );
    const terminalMutationIntent =
      /\b(confirm|confirmation|delete|deletion|remove|removal|submit|submission|save|apply|send|post|complete|success|close|dismiss|update|change)\b/i.test(
        taskContext,
      );
    const summaryShowsTerminalState =
      /\b(success(?:fully)?|completed?|confirmed?|deleted?|removed?|saved|submitted?|sent|posted|closed|dismissed|updated|changed|finished)\b/i.test(
        summaryText,
      );
    const snapshotShowsTerminalMutation =
      /\b(?:deleted|removed|saved|submitted|sent|posted|closed|dismissed|updated|changed|completed|confirmed)\s+successfully\b/i.test(
        snapshotText,
      ) ||
      /\b(?:success|successful|thank you|confirmation|receipt|completed)\b/i.test(
        snapshotText,
      );
    if (
      nextStepIsFinalizationOnly &&
      terminalMutationIntent &&
      summaryShowsTerminalState &&
      snapshotShowsTerminalMutation
    ) {
      const coherence = checkSummaryStepCoherence({
        summary,
        currentStepIndex,
        stepDescriptions: this.planSubtasks.map((s) => s.description),
      });
      if (coherence.coherent) return true;
    }

    const editIntent =
      /\b(change|edit|update|replace|set|type|enter|revise|rewrite)\b/i.test(
        taskContext,
      );
    const inPlaceSurface =
      /\b(spreadsheet|grid|cell|row|column|sheet|table|field|value|draft|reply|email|message|text|copy|wording)\b/i.test(
        taskContext,
      );
    if (!editIntent || !inPlaceSurface) return false;

    const criteriaCheck = matchSuccessCriteria({
      successCriteria: currentStep.successCriteria,
      snapshot,
    });
    if (!criteriaCheck.satisfied) return false;

    const coherence = checkSummaryStepCoherence({
      summary,
      currentStepIndex,
      stepDescriptions: this.planSubtasks.map((s) => s.description),
    });
    if (!coherence.coherent) return false;

    return true;
  }

  private getActiveToolProfileForStep(
    stepIndex: number,
  ): ToolProfile | undefined {
    return getActiveToolProfileForStep(
      this as unknown as AgentLoopSkillToolsHost,
      stepIndex,
    );
  }

  private getUncommittedInlineEditDoneRejection(
    currentStepIndex: number,
  ): string | null {
    if (this.getActiveToolProfileForStep(currentStepIndex) !== "edit_surface") {
      return null;
    }

    const snapshot = this.context.getSnapshot();
    if (!snapshot?.elements?.length) return null;

    const hasVisibleTextInput = snapshot.elements.some(
      (element) =>
        element.isVisible !== false && isTextLikeInputElement(element),
    );
    if (!hasVisibleTextInput) return null;

    const pageText = `${snapshot.visibleContent || ""}\n${snapshot.pageContent || ""}`;
    const inlineEditTask =
      /\b(spreadsheet|grid|cell|row|column|rename|filename|file name|document|inline)\b/i.test(
        `${this.originalQuery}\n${this.planSubtasks[currentStepIndex]?.description || ""}\n${this.planSteps[currentStepIndex]?.successCriteria || ""}`,
      );
    if (!inlineEditTask && !/\(editing\)/i.test(pageText)) {
      return null;
    }

    return (
      "An inline edit field is still active on the page. Commit the edit " +
      "(for example with Enter or by applying the rename) before calling done()."
    );
  }

  private getPendingInlineEditVerificationBlock(
    toolName: ToolName,
    currentStepIndex: number,
  ): string | null {
    if (
      this.pendingInlineEditVerification &&
      this.pendingInlineEditVerification.stepIndex !== currentStepIndex
    ) {
      this.pendingInlineEditVerification = null;
    }
    if (
      !this.pendingInlineEditVerification ||
      this.pendingInlineEditVerification.stepIndex !== currentStepIndex
    ) {
      return null;
    }
    if (
      [
        ToolName.READ_PAGE,
        ToolName.READ_ELEMENT,
        ToolName.FIND_ELEMENT,
        ToolName.WAIT,
      ].includes(toolName)
    ) {
      return null;
    }
    return (
      `${this.pendingInlineEditVerification.reason} ` +
      "Verify the committed page state with read_page, read_element, or find_element before taking another action."
    );
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
    let effectiveOrientationTurns: number = ORIENTATION.PHASE_TURNS;
    const orientationToolsUsed = new Set<string>();

    // Circuit breaker: consecutive all-fail turns
    let consecutiveAllFailTurns = 0;

    // Circuit breaker: same-tool repeat failure
    const toolFailCounts = new Map<string, number>();

    // Redundant action detection: sliding window of recent successful tool calls
    const recentSuccesses: RecentAction[] = [];

    // Track all recent tool calls so exact looping can be blocked even when calls "succeed"
    const recentToolCalls: Array<{ tool: ToolName; argsKey: string }> = [];
    const resultPageProgress = createResultPageProgressState();
    const verifiedFinalClickBypassKeys = new Set<string>();

    // Tag IDs discovered by find_element (not yet in snapshot but valid for next tool call)
    const discoveredTagIds = new Set<number>();

    // Failed action memory: prevents exact repeats of failed tool calls
    const blockedActions: BlockedAction[] = [];
    let turnsSinceStepEscalation = -1; // -1 = no step escalation active

    // Exploration budget: nudge after N consecutive exploration-only turns
    let consecutiveExplorationTurns = 0;

    // Blind tool call detection: tool_calls present but no reasoning content
    let consecutiveBlindToolTurns = 0;

    // read_element same-ID tracker: detects repeated reads on the same element
    let lastReadElementId: number | null = null;
    let consecutiveReadElementSameId = 0;

    // Outcome-based dead-end detection: sliding window of normalized tool result fingerprints
    // Each entry pairs the outcome fingerprint with the page snapshot fingerprint
    const recentOutcomes: RecentOutcome[] = [];

    // Cumulative failure brief: tracks tool attempts for failure synthesis
    const subgoalAttempts: SubgoalAttempt[] = [];

    const resetEscalationWorkingMemory = (options?: {
      resetProgressSignals?: boolean;
      resetStepEscalation?: boolean;
      resetZeroEffectTurns?: boolean;
      clearStuckFlag?: boolean;
    }): void => {
      this.stagnation.resetEscalation();
      subgoalAttempts.length = 0;
      recentOutcomes.length = 0;
      consecutiveTextOnly = 0;
      recentSuccesses.length = 0;
      if (options?.resetProgressSignals) {
        consecutiveProgressSignals = 0;
      }
      if (options?.resetStepEscalation) {
        turnsSinceStepEscalation = -1;
      }
      if (options?.resetZeroEffectTurns) {
        this.consecutiveZeroEffectTurns = 0;
      }
      if (options?.clearStuckFlag) {
        wasStuck = false;
      }
    };

    while (this.isRunning && this.turnCount < this.maxTurns) {
      // Pause gate — block here if user paused the loop
      if (this.pauseGate) await this.pauseGate.promise;
      this.throwIfGracefulStopRequested();
      if (!this.isRunning) {
        // Finalize the stream so the side panel exits isStreaming state
        this.finishStream();
        break;
      }

      this.turnCount++;
      this.turnsOnCurrentStep++;

      // Clear idempotency cache unless a done() was just rejected (prevents re-execution of
      // actions that already succeeded). Normal turns clear it so legitimate repeated clicks work.
      if (!this.guardAfterDoneRejection) {
        this.mutationLedger.clearEphemeral();
      }
      this.guardAfterDoneRejection = false;

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
        this.finishStream();
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

      const historicalToolCalls = this.context
        .getMessages()
        .reduce(
          (count, msg) =>
            count +
            (msg.role === "assistant" && Array.isArray(msg.tool_calls)
              ? msg.tool_calls.length
              : 0),
          0,
        );
      const shouldInjectTurnBudgetReminder =
        (this.turnCount > 0 && this.turnCount % 15 === 0) ||
        (this.turnCount === 1 && historicalToolCalls >= 15);
      if (shouldInjectTurnBudgetReminder) {
        const attemptsSoFar = this.turnCount + historicalToolCalls;
        this.traceRecorder?.recordEvent("turn_budget_reminder", {
          turn: this.turnCount,
          historicalToolCalls,
        });
        this.context.addMessage({
          role: "user",
          content:
            `TURN BUDGET: You have already used about ${attemptsSoFar} action turns on this objective. ` +
            `If the goal is already satisfied, call done(). Otherwise, if you are not making clear progress, ` +
            `call escalate({"reason": "Stuck after ${attemptsSoFar} turns without completing the goal"}) now. Do not keep cycling.`,
        });
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
      this.context.setTimeContext(
        this.turnCount,
        this.maxTurns,
        this.sessionStartTime,
      );
      this.updateMoneyTableAggregateFromSnapshot();
      const catalogSnapshotCompletion =
        this.maybeCompleteCatalogOrderFromSnapshot();
      if (catalogSnapshotCompletion) {
        return catalogSnapshotCompletion;
      }

      // 1. LLM Inference (streamed)
      // `let` because retry loop may append diagnostic hints (cleaned up after)
      const allTools = toolRegistry.getDefinitions(this.disabledTools);
      const turnPreparation = await prepareLlmTurnRequest({
        turnCount: this.turnCount,
        previousElementCount: prevElementCount,
        context: this.context,
        allTools,
        // Apply plan/DOM filtering first, then skill-based ranking within the surviving set.
        selectTools: (definitions) =>
          this.applySkillToolRanking(
            this.applySkillToolSuppression(this.applyToolProfile(definitions)),
          ),
        llm: this.llm,
        perception: this.perception,
        log: this.log,
        traceRecorder: this.traceRecorder,
      });
      let messages = turnPreparation.messages;
      const tools = turnPreparation.tools;
      prevElementCount = turnPreparation.previousElementCount;

      const thinkingStepId = crypto.randomUUID();
      const thinkingStep: AgentStep = {
        id: thinkingStepId,
        type: "thinking",
        label: this.turnCount === 1 ? "Understanding request" : "Thinking...",
        status: "running",
        timestamp: Date.now(),
      };
      this.stepHandler(thinkingStep, false);

      const turnCompletion = await completeTurnWithRetries({
        llm: this.llm,
        messages,
        tools,
        maxTokens: LLM_CONFIG.MAX_TOKENS,
        turnCount: this.turnCount,
        mainAbortSignal: this.abortController!.signal,
        log: this.log,
        traceRecorder: this.traceRecorder,
        broadcast: (message) => this.broadcast(message),
        stepHandler: (step, replace) => this.stepHandler(step, replace),
        finishStream: () => this.finishStream(),
        statusHandler: (status, message) => this.statusHandler(status, message),
        getMetrics: () => this.getMetrics(),
        invalidatePerceptionCache: () => this.perception.invalidateCache(),
        recordPromptImageUsage: (promptMessages) =>
          this.recordPromptImageUsage(promptMessages),
      });
      if (turnCompletion.kind === "early_result") {
        return turnCompletion.result;
      }
      const response = turnCompletion.response;
      messages = turnCompletion.messages;
      const llmMs = turnCompletion.llmMs;
      const hallucinationDetected = turnCompletion.synthesizedFromHallucination;

      const processedResponse = await processLlmTurnResponse({
        response,
        llmMs,
        turnCount: this.turnCount,
        thinkingStep,
        context: this.context,
        traceRecorder: this.traceRecorder,
        log: this.log,
        recordUsage: (completion, durationMs) =>
          this.recordUsage(completion, durationMs),
        broadcastMetrics: () => this.broadcastMetrics(),
        broadcast: (message) => this.broadcast(message),
        finishStream: () => this.finishStream(),
        statusHandler: (status, message) => this.statusHandler(status, message),
        stepHandler: (step, replace) => this.stepHandler(step, replace),
        getMetrics: () => this.getMetrics(),
      });
      if (processedResponse.kind === "early_result") {
        return processedResponse.result;
      }
      const normalizedContent = processedResponse.normalizedContent;
      const rawContent = processedResponse.rawContent;
      const cleanContent = processedResponse.cleanContent;
      const toolsRecoveredFromText = processedResponse.toolsRecoveredFromText;
      const llmIntention = processedResponse.llmIntention;

      // 3. Handle Response
      if (response.tool_calls && response.tool_calls.length > 0) {
        // ACTION REQUIRED
        consecutiveTextOnly = 0;
        this.throwIfGracefulStopRequested();

        // Keep the streaming message open across tool-calling turns.
        // The stream is finalized when done() is called (with replaceContent)
        // or when the loop exits (by the orchestrator or exit-path handlers).

        // Execute Tools
        let doneSignaled = false;
        const signalCompletedResult = (
          summary: string,
          options?: { saveCheckpoint?: boolean },
        ) => {
          doneSummary = summary;
          doneSignaled = true;
          this.completeTaskResult(summary, options);
        };
        let domModified = false;
        let visuallyModified = false;
        let lastDomAffectingToolName: string | null = null;
        this.lastDomStep = null;
        this.context.setLastActionOutcome(null);
        const toolCallSetup = prepareToolCallBranch({
          response,
          turnCount: this.turnCount,
          cleanContent,
          toolsRecoveredFromText,
          hadThinking: normalizedContent.hadThinking,
          consecutiveBlindToolTurns,
          context: this.context,
          traceRecorder: this.traceRecorder,
          log: this.log,
          statusHandler: (status, message) =>
            this.statusHandler(status, message),
          rewriteListDetailWorkflowToolCall: (toolCall, mode) =>
            this.rewriteListDetailWorkflowToolCall(toolCall, mode),
        });
        consecutiveBlindToolTurns = toolCallSetup.consecutiveBlindToolTurns;

        if (toolCallSetup.allCallsBlocked) {
          continue; // All tool calls blocked - retry
        }

        const canParallelize = toolCallSetup.canParallelize;

        if (canParallelize) {
          this.throwIfGracefulStopRequested();
          // PARALLEL EXECUTION
          const parallelDispatch = await executeParallelToolCalls(
            this as unknown as ParallelToolDispatchHost,
            {
              toolCalls: response.tool_calls,
              tabId,
              repeatActionWindow: REPEAT_ACTION_WINDOW,
              llmIntention,
              state: {
                recentToolCalls,
                verifiedFinalClickBypassKeys,
                lastReadElementId,
                consecutiveReadElementSameId,
                blockedActions,
                recentSuccesses,
                discoveredTagIds,
                orientationPhase,
                orientationToolsUsed,
                domModified,
                visuallyModified,
                lastDomAffectingToolName,
              },
            },
          );
          lastReadElementId = parallelDispatch.state.lastReadElementId;
          consecutiveReadElementSameId =
            parallelDispatch.state.consecutiveReadElementSameId;
          domModified = parallelDispatch.state.domModified;
          visuallyModified = parallelDispatch.state.visuallyModified;
          lastDomAffectingToolName =
            parallelDispatch.state.lastDomAffectingToolName;

          this.finalizeParallelToolResults(parallelDispatch.results);
        } else {
          // SEQUENTIAL EXECUTION (has sequential tools or single tool)
          const sequentialDispatch: SequentialToolDispatchOutput =
            await executeSequentialToolCalls.call(
              this as unknown as SequentialToolDispatchHost,
              {
                toolCalls: response.tool_calls,
                repeatActionWindow: REPEAT_ACTION_WINDOW,
                llmIntention,
                signalCompletedResult,
                state: {
                  tabId,
                  prevElementCount,
                  escalationTier,
                  plannerModelStartTurn,
                  orientationPhase,
                  recentToolCalls,
                  verifiedFinalClickBypassKeys,
                  lastReadElementId,
                  consecutiveReadElementSameId,
                  blockedActions,
                  recentSuccesses,
                  discoveredTagIds,
                  orientationToolsUsed,
                  domModified,
                  visuallyModified,
                  lastDomAffectingToolName,
                  doneSignaled,
                  doneSummary,
                  resultPageProgress,
                },
              },
            );
          tabId = sequentialDispatch.tabId;
          prevElementCount = sequentialDispatch.prevElementCount;
          escalationTier = sequentialDispatch.escalationTier;
          plannerModelStartTurn = sequentialDispatch.plannerModelStartTurn;
          orientationPhase = sequentialDispatch.orientationPhase;
          lastReadElementId = sequentialDispatch.lastReadElementId;
          consecutiveReadElementSameId =
            sequentialDispatch.consecutiveReadElementSameId;
          domModified = sequentialDispatch.domModified;
          visuallyModified = sequentialDispatch.visuallyModified;
          lastDomAffectingToolName =
            sequentialDispatch.lastDomAffectingToolName;
          doneSignaled = sequentialDispatch.doneSignaled;
          doneSummary = sequentialDispatch.doneSummary;
        }

        // --- Circuit Breaker: track tool failures ---
        if (!doneSignaled) {
          const recentMessages = this.context.getMessages();
          const turnToolOutcomes = collectTurnToolOutcomeRecords({
            toolCalls: response.tool_calls!,
            messages: recentMessages,
            snapshot: this.context.getSnapshot(),
          });
          const overlayRecoveryCompletion =
            buildOverlayRecoveryCompletionSummary({
              originalQuery: this.originalQuery,
              selectedSkillId: this.selectedSkillId,
              snapshot: this.context.getSnapshot(),
              toolOutcomes: turnToolOutcomes,
            });
          if (overlayRecoveryCompletion) {
            signalCompletedResult(overlayRecoveryCompletion);
            this.traceRecorder?.recordEvent("overlay_recovery_completed", {
              turn: this.turnCount,
              selectedSkillId: this.selectedSkillId,
            });
            await this.traceRecorder?.endTurn();
            break;
          }
          const { turnSuccesses, turnFailures } =
            countTrailingToolResultOutcomes(recentMessages);

          // A. Consecutive all-fail turns
          consecutiveAllFailTurns = updateConsecutiveAllFailTurns({
            previousCount: consecutiveAllFailTurns,
            turnSuccesses,
            turnFailures,
          });

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
          for (const { toolName, argsKey, resultContent } of turnToolOutcomes) {
            const failureTracking = updateSameToolFailureTracking({
              blockedActions,
              toolFailCounts,
              toolName,
              argsKey,
              resultContent,
              turn: this.turnCount,
              bufferSize: FAILED_ACTION_MEMORY.BUFFER_SIZE,
              warnThreshold: this.limits.toolFailureWarn,
              exitThreshold: this.limits.toolFailureExit,
            });

            if (failureTracking.kind === "exit") {
              this.log.warn(
                "agent",
                "Circuit breaker: same-tool repeat failure",
                {
                  turn: this.turnCount,
                  tool: toolName,
                  count: failureTracking.count,
                },
              );
              this.traceRecorder?.recordEvent("circuit_breaker", {
                reason: "same_tool_repeat",
                tool: toolName,
                count: failureTracking.count,
              });
              this.circuitBreakerExit(failureTracking.message);
              return {
                outcome: "error" as const,
                turnCount: this.turnCount,
                summary: "Circuit breaker: repeated tool failure",
                metrics: this.getMetrics(),
              };
            }

            if (failureTracking.kind === "warn") {
              this.log.warn(
                "agent",
                "Circuit breaker warning: tool repeating failures",
                {
                  turn: this.turnCount,
                  tool: toolName,
                  count: failureTracking.count,
                },
              );
              this.context.addMessage({
                role: "user",
                content: failureTracking.message,
              });
            }
          }

          // B2. Exploration budget: nudge after N consecutive turns of only reading/inspecting
          {
            const explorationBudget = updateExplorationBudget({
              previousCount: consecutiveExplorationTurns,
              toolNames: turnToolOutcomes.map((outcome) => outcome.toolName),
              explorationOnlyTools: EXPLORATION_ONLY_TOOLS,
              maxConsecutive: EXPLORATION_BUDGET.MAX_CONSECUTIVE,
            });
            consecutiveExplorationTurns = explorationBudget.consecutiveTurns;
            if (explorationBudget.message) {
              this.context.addMessage({
                role: "user",
                content: explorationBudget.message,
              });
            }
          }

          // C. Redundant successful action detection
          for (const { toolName, argsKey, resultContent } of turnToolOutcomes) {
            const recentSuccessDecision = recordRecentSuccessfulAction({
              recentSuccesses,
              toolName,
              argsKey,
              resultContent,
              snapshot: this.context.getSnapshot(),
              windowSize: REDUNDANT_ACTION.WINDOW,
              infoThreshold: REDUNDANT_ACTION.INFO_THRESHOLD,
              toolNameInfoThreshold: REDUNDANT_ACTION.TOOL_NAME_INFO_THRESHOLD,
            });

            if (recentSuccessDecision.kind === "redundant_nudge") {
              this.log.info("agent", "Redundant action nudge", {
                turn: this.turnCount,
                tool: toolName,
                sameStateCount: recentSuccessDecision.sameStateCount,
                totalRepeats: recentSuccessDecision.totalRepeatCount,
              });
              this.traceRecorder?.recordEvent("redundant_action_nudge", {
                tool: toolName,
                count: recentSuccessDecision.sameStateCount,
              });
              this.traceRecorder?.recordEvent("multi_turn_pathology", {
                pathology: "anchoring",
                trigger: "redundant_action_nudge",
                turn: this.turnCount,
                details: `${toolName} x${recentSuccessDecision.sameStateCount} same state`,
              });
              this.context.addMessage({
                role: "user",
                content: recentSuccessDecision.message,
              });
            } else if (recentSuccessDecision.kind === "tool_name_pattern") {
              this.log.info("agent", "Tool-name pattern noted", {
                turn: this.turnCount,
                tool: toolName,
                count: recentSuccessDecision.toolNameCount,
              });
              this.traceRecorder?.recordEvent("tool_name_pattern", {
                tool: toolName,
                count: recentSuccessDecision.toolNameCount,
              });
              this.context.addMessage({
                role: "user",
                content: recentSuccessDecision.message,
              });
            }
          }

          // D2. Outcome-based dead-end detection: fingerprint tool results and detect patterns
          {
            const currentSnapshotFp = getSnapshotFingerprint(
              this.context.getSnapshot(),
            );
            for (const outcome of turnToolOutcomes) {
              recordRecentOutcome({
                recentOutcomes,
                resultContent: outcome.resultContent,
                snapshotFp: currentSnapshotFp,
                windowSize: STAGNATION_DETECTION.WINDOW,
              });

              subgoalAttempts.push(
                buildSubgoalAttempt({
                  turn: this.turnCount,
                  toolName: outcome.toolName,
                  toolArguments: outcome.toolCall.function.arguments,
                  resultContent: outcome.resultContent,
                  snapshotFp: currentSnapshotFp,
                }),
              );
            }
          }
          // Check for dead-end pattern (all recent outcomes identical AND same page state)
          {
            const deadEnd = assessDeadEndPattern({
              recentOutcomes,
              reflectionThreshold: this.limits.stagnationReflection,
              pivotThreshold: this.limits.stagnationPivot,
            });
            if (deadEnd.kind === "pivot") {
              this.log.warn(
                "agent",
                "Dead-end detected: forcing strategy pivot",
                {
                  turn: this.turnCount,
                  pattern: deadEnd.pattern.slice(0, 80),
                  count: deadEnd.count,
                },
              );
              this.traceRecorder?.recordEvent("dead_end_pivot", {
                pattern: deadEnd.pattern.slice(0, 80),
                count: deadEnd.count,
              });
              this.traceRecorder?.recordEvent("multi_turn_pathology", {
                pathology: "anchoring",
                trigger: "dead_end_pivot",
                turn: this.turnCount,
                details: `pattern: ${deadEnd.pattern.slice(0, 60)}`,
              });
              await this.strategyPivot(tabId);
              recentOutcomes.length = 0;
            } else if (deadEnd.kind === "nudge") {
              this.log.info(
                "agent",
                "Dead-end nudge: repeated outcome pattern",
                {
                  turn: this.turnCount,
                  pattern: deadEnd.pattern.slice(0, 80),
                  count: deadEnd.count,
                },
              );
              this.traceRecorder?.recordEvent("dead_end_nudge", {
                pattern: deadEnd.pattern.slice(0, 80),
                count: deadEnd.count,
              });
              this.traceRecorder?.recordEvent("multi_turn_pathology", {
                pathology: "anchoring",
                trigger: "dead_end_nudge",
                turn: this.turnCount,
                details: `pattern: ${deadEnd.pattern.slice(0, 60)}`,
              });
              this.context.addMessage({
                role: "user",
                content: deadEnd.message,
              });
            }
          }

          // E-pre. Post-escalation forced pivot: if N turns passed since step watchdog escalation
          // without step advancement, force a strategy pivot and clear failed-action memory.
          {
            const postEscalationPivot = updatePostEscalationPivot({
              turnsSinceStepEscalation,
              pivotTurns: FAILED_ACTION_MEMORY.POST_ESCALATION_PIVOT_TURNS,
            });
            turnsSinceStepEscalation =
              postEscalationPivot.turnsSinceStepEscalation;
            if (postEscalationPivot.kind === "pivot") {
              this.log.info("agent", "Post-escalation forced pivot", {
                turn: this.turnCount,
                turnsSinceStepEscalation,
              });
              await this.strategyPivot(tabId);
              blockedActions.length = 0;
              turnsSinceStepEscalation = -1;
            }
          }

          // E. Step duration watchdog
          {
            const stepWatchdog = assessStepDurationWatchdog({
              hasTaskId: Boolean(this.taskId),
              planSubtaskCount: this.planSubtasks.length,
              turnsOnCurrentStep: this.turnsOnCurrentStep,
              escalationTier,
              cooldownRemaining,
              warnTurns: this.limits.stepWarnTurns,
              escalateTurns: this.limits.stepEscalateTurns,
            });
            if (stepWatchdog.kind === "escalate") {
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

              // Try replan-on-escalation first: planner replans, executor continues
              const replanSucceeded = await this.replanOnEscalation(
                tabId,
                subgoalAttempts,
                this.abortController?.signal,
              );
              if (replanSucceeded) {
                resetEscalationWorkingMemory({ resetStepEscalation: true });
              } else {
                // Fallback: old escalation behavior
                const stepAttemptSummary = extractAttemptSummary(
                  this.context.getMessages(),
                );
                this.escalateModel();
                this.escalationsOnCurrentStep++;
                escalationTier = 1;
                orientationPhase = false;
                plannerModelStartTurn = this.turnCount;
                turnsSinceStepEscalation = 0; // Start tracking post-escalation pivot
                await this.strategyPivot(tabId, stepAttemptSummary);
                this.stagnation.resetEscalation();
                this.context.addMessage({
                  role: "user",
                  content:
                    this.escalationsOnCurrentStep >= 2
                      ? ESCALATION_RECOVERY(
                          this.escalationsOnCurrentStep,
                          `step ${this.lastPlanIndex + 1}`,
                        )
                      : `STEP WATCHDOG: You spent ${this.turnsOnCurrentStep} turns on step ${this.lastPlanIndex + 1} without advancing. ${ESCALATION_REFLECTION("stuck on step " + (this.lastPlanIndex + 1) + " for " + this.turnsOnCurrentStep + " turns")}\nEither complete this step and move forward, or revise the plan if the step is impossible.`,
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
              }
            } else if (stepWatchdog.kind === "warn") {
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
        const sameUrlEscalation = assessSameUrlForcedEscalation({
          escalationTier,
          cooldownRemaining,
          sameUrlTurns: this.stagnation.sameUrlTurns,
          sameUrlEscalate: this.limits.sameUrlEscalate,
        });
        if (sameUrlEscalation.kind === "escalate") {
          this.log.warn("agent", "Same-URL forced escalation", {
            turn: this.turnCount,
            sameUrlTurns: this.stagnation.sameUrlTurns,
            threshold: this.limits.sameUrlEscalate,
          });
          this.traceRecorder?.recordEvent("same_url_forced_escalation", {
            sameUrlTurns: this.stagnation.sameUrlTurns,
            threshold: this.limits.sameUrlEscalate,
          });

          // Try replan-on-escalation first
          const sameUrlReplanOk = await this.replanOnEscalation(
            tabId,
            subgoalAttempts,
            this.abortController?.signal,
          );
          if (sameUrlReplanOk) {
            resetEscalationWorkingMemory();
          } else {
            // Fallback: old escalation behavior
            const urlAttemptSummary = extractAttemptSummary(
              this.context.getMessages(),
            );
            this.escalateModel();
            this.escalationsOnCurrentStep++;
            escalationTier = 1;
            orientationPhase = false;
            plannerModelStartTurn = this.turnCount;
            await this.strategyPivot(tabId, urlAttemptSummary);
            this.stagnation.resetEscalation();
            this.context.addMessage({
              role: "user",
              content:
                this.escalationsOnCurrentStep >= 2
                  ? ESCALATION_RECOVERY(this.escalationsOnCurrentStep)
                  : `SAME-URL ESCALATION: You spent ${this.stagnation.sameUrlTurns} turns on this page without navigating away. ${ESCALATION_REFLECTION("same URL for " + this.stagnation.sameUrlTurns + " turns without progress")}`,
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
          this.lastToolNameForPerception =
            response.tool_calls[response.tool_calls.length - 1].function.name;
        }

        // Capture pre-action snapshot for diff-based loading detection.
        // Used to distinguish structural loading keywords (present before the
        // action) from transient ones (appeared due to the action).
        const preActionSnapshot = this.context.getSnapshot();

        // Batch snapshot refresh: ONE refresh after all tools complete
        if (domModified && !doneSignaled) {
          try {
            const snapshotRefresh = await refreshPostToolSnapshot(
              this as unknown as PostToolSnapshotRefreshHost,
              {
                tabId,
                prevElementCount,
                visuallyModified,
                recentSuccesses,
              },
            );
            let snap = snapshotRefresh.snap;
            prevElementCount = snapshotRefresh.prevElementCount;

            if (snap) {
              const explicitSuccessSignal =
                this.detectExplicitSuccessSignalInSnapshot(snap);
              // Suppress auto-complete for root agent (no nodeId) when query
              // requires multiple return values (e.g. "both numbers").
              // The explicit signal detector is scoped to the active step so
              // prior-step handoff history cannot complete the wrong node.
              const taskContractMultiReturn = !this.nodeId
                ? (buildTaskContract(this.originalQuery).multiReturnCount ?? 0)
                : 0;
              if (explicitSuccessSignal && taskContractMultiReturn < 2) {
                const summary = [
                  `- Verified "${explicitSuccessSignal}" is visible on the page.`,
                  `- URL: ${snap.url}`,
                  `- The task completion state is present in the refreshed page content.`,
                ].join("\n");

                this.context.clearPlanStatus();
                this.log.info(
                  "agent",
                  "Auto-completing from explicit success signal",
                  {
                    turn: this.turnCount,
                    signal: explicitSuccessSignal,
                    url: snap.url,
                  },
                );
                this.traceRecorder?.recordEvent(
                  "explicit_success_auto_completed",
                  {
                    turn: this.turnCount,
                    signal: explicitSuccessSignal,
                    url: snap.url,
                  },
                );
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: crypto.randomUUID(),
                  content: summary,
                });
                this.completeTaskUi(summary);
                doneSummary = summary;
                doneSignaled = true;

                this.broadcastFinalMetrics();
              } else if (
                explicitSuccessSignal &&
                taskContractMultiReturn >= 2 &&
                this.planSubtasks.length > 0
              ) {
                // Multi-return query: auto-complete blocked because not all
                // returns are collected yet. But the current step IS done.
                // Advance to the next step instead of blocking the executor.
                const runningIdx = this.planSubtasks.findIndex(
                  (s) => s.status === "running",
                );
                if (
                  runningIdx >= 0 &&
                  runningIdx < this.planSubtasks.length - 1
                ) {
                  const newIdx = advanceCompletedSubtasks(
                    this as unknown as AgentLoopPlanProgressHost,
                  );
                  const nextDesc =
                    this.planSubtasks[newIdx]?.description ||
                    "Continue to next step";
                  this.syncPlanStatus(newIdx, "multi_return_step_advanced", {
                    signal: explicitSuccessSignal,
                    advancedTo: newIdx,
                  });
                  this.context.addMessage({
                    role: "user",
                    content:
                      `Current step verified ("${explicitSuccessSignal}" visible). ` +
                      `But the task requires multiple results — advancing to next step.\n` +
                      `YOUR NEW OBJECTIVE: ${nextDesc}`,
                  });
                  this.log.info(
                    "agent",
                    "Multi-return: auto-advanced step instead of auto-completing",
                    {
                      turn: this.turnCount,
                      signal: explicitSuccessSignal,
                      advancedTo: newIdx,
                      nextObjective: nextDesc,
                    },
                  );
                }
              }

              // Retroactive screenshot attachment: update the last DOM-modifying step with the screenshot
              const lastScreenshot = this.perception.getLastScreenshot();
              const lastDomStep = this.lastDomStep as AgentStep | null;
              if (lastScreenshot && lastDomStep) {
                this.stepHandler(
                  {
                    ...lastDomStep,
                    screenshotUrl: lastScreenshot,
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
              if (
                this.pendingFormSubmissionReset &&
                this.taskId &&
                !doneSignaled
              ) {
                const pending = this.pendingFormSubmissionReset;
                const delayedSubmitSignal = detectFormSubmissionResetSuccess({
                  currentStepDescription: pending.stepDescription,
                  currentStepSuccessCriteria: pending.successCriteria,
                  preActionSnapshot: pending.preActionSnapshot,
                  currentSnapshot: snap,
                  actionEffect: {
                    deltaPercent: 1,
                    urlChanged: true,
                    currentUrl: snap.url,
                    elementsAdded: 0,
                    elementsRemoved: 0,
                    addedSignatures: [],
                    prevCount: pending.preActionSnapshot.elements.length,
                    currentCount: snap.elements.length,
                  },
                  toolName: pending.toolName,
                  toolArgs: pending.toolArgs,
                });

                if (delayedSubmitSignal) {
                  const { finalSummary } = this.completeSubmitFormReset(
                    pending.stepIndex,
                    delayedSubmitSignal,
                  );
                  this.pendingFormSubmissionReset = null;
                  signalCompletedResult(finalSummary);
                  await this.traceRecorder?.endTurn();
                  break;
                }

                if (this.turnCount - pending.startedTurn > 5) {
                  this.pendingFormSubmissionReset = null;
                }
              }
              if (actionEffect && visuallyModified) {
                this.context.setLastActionOutcome({
                  toolName: lastDomAffectingToolName ?? "unknown",
                  deltaPercent: actionEffect.deltaPercent,
                  urlChanged: actionEffect.urlChanged,
                  prevUrl: actionEffect.prevUrl,
                  currentUrl: actionEffect.currentUrl,
                  elementsAdded: actionEffect.elementsAdded,
                  elementsRemoved: actionEffect.elementsRemoved,
                });
                this.traceRecorder?.recordEvent("action_effect", {
                  toolName: lastDomAffectingToolName ?? "unknown",
                  deltaPercent: actionEffect.deltaPercent,
                  urlChanged: actionEffect.urlChanged,
                  elementsAdded: actionEffect.elementsAdded,
                  elementsRemoved: actionEffect.elementsRemoved,
                });

                const planAfterAction = this.context.getPlanStatusRaw();
                if (
                  this.taskId &&
                  planAfterAction &&
                  !doneSignaled &&
                  planAfterAction.currentIndex < planAfterAction.subtasks.length
                ) {
                  const currentSubtask =
                    planAfterAction.subtasks[planAfterAction.currentIndex];
                  const lastToolCall =
                    response.tool_calls[response.tool_calls.length - 1];
                  const lastToolName = lastToolCall?.function.name;
                  let lastToolArgs: Record<string, unknown> | undefined;
                  if (lastToolCall?.function.arguments) {
                    try {
                      lastToolArgs = JSON.parse(
                        lastToolCall.function.arguments,
                      ) as Record<string, unknown>;
                    } catch {
                      lastToolArgs = undefined;
                    }
                  }

                  if (currentSubtask && lastToolName) {
                    const asyncSignal = detectPendingAsyncChange({
                      currentStepDescription: currentSubtask.description,
                      currentStepSuccessCriteria:
                        this.planSteps[planAfterAction.currentIndex]
                          ?.successCriteria,
                      currentSnapshot: snap,
                      preActionSnapshot,
                      actionEffect,
                      toolName: lastToolName,
                    });

                    if (asyncSignal) {
                      this.pendingAsyncVerification = {
                        stepIndex: planAfterAction.currentIndex,
                        expectedTokens: asyncSignal.expectedTokens,
                        baselineLoadingKeywords:
                          asyncSignal.baselineLoadingKeywords,
                        reason: asyncSignal.reason,
                        startedTurn: this.turnCount,
                      };
                      this.context.addMessage({
                        role: "user",
                        content:
                          `ASYNC CHECKPOINT: ${asyncSignal.reason} ` +
                          "Wait for the page update and verify the new content before continuing.",
                      });
                      this.traceRecorder?.recordEvent(
                        "pending_async_change_detected",
                        {
                          turn: this.turnCount,
                          stepIndex: planAfterAction.currentIndex,
                          expectedTokens: asyncSignal.expectedTokens,
                          loadingIndicator: asyncSignal.loadingIndicator,
                        },
                      );

                      const awaitedSnapshot =
                        await this.waitForPendingAsyncChange(
                          tabId,
                          prevElementCount,
                          this.pendingAsyncVerification,
                        );
                      if (awaitedSnapshot) {
                        snap = awaitedSnapshot;
                        prevElementCount = awaitedSnapshot.elements.length;
                      }
                    } else if (
                      this.pendingAsyncVerification &&
                      this.pendingAsyncVerification.stepIndex ===
                        planAfterAction.currentIndex &&
                      isPendingAsyncChangeSatisfied({
                        snapshot: snap,
                        expectedTokens:
                          this.pendingAsyncVerification.expectedTokens,
                      })
                    ) {
                      this.pendingAsyncVerification = null;
                    }
                  }

                  if (
                    currentSubtask &&
                    lastToolName &&
                    this.getActiveToolProfileForStep(
                      planAfterAction.currentIndex,
                    ) === "submit_form"
                  ) {
                    const submitResetSignal = detectFormSubmissionResetSuccess({
                      currentStepDescription: currentSubtask.description,
                      currentStepSuccessCriteria:
                        this.planSteps[planAfterAction.currentIndex]
                          ?.successCriteria,
                      preActionSnapshot,
                      currentSnapshot: snap,
                      actionEffect,
                      toolName: lastToolName,
                      toolArgs: lastToolArgs,
                    });

                    if (submitResetSignal) {
                      this.consecutiveAutoAdvances = 0;
                      const fromStep = planAfterAction.currentIndex;
                      const { finalSummary } = this.completeSubmitFormReset(
                        fromStep,
                        submitResetSignal,
                      );
                      signalCompletedResult(finalSummary);
                      await this.traceRecorder?.endTurn();
                      break;
                    } else if (
                      shouldTrackFormSubmissionReset({
                        currentStepDescription: currentSubtask.description,
                        currentStepSuccessCriteria:
                          this.planSteps[planAfterAction.currentIndex]
                            ?.successCriteria,
                        preActionSnapshot,
                        toolName: lastToolName,
                        toolArgs: lastToolArgs,
                      })
                    ) {
                      this.pendingFormSubmissionReset = {
                        stepIndex: planAfterAction.currentIndex,
                        stepDescription: currentSubtask.description,
                        successCriteria:
                          this.planSteps[planAfterAction.currentIndex]
                            ?.successCriteria,
                        preActionSnapshot: preActionSnapshot!,
                        toolName: lastToolName,
                        toolArgs: lastToolArgs,
                        startedTurn: this.turnCount,
                      };
                      this.traceRecorder?.recordEvent(
                        "pending_submit_form_reset",
                        {
                          stepIndex: planAfterAction.currentIndex,
                          turn: this.turnCount,
                        },
                      );
                    }
                  }

                  const nextSubtask =
                    planAfterAction.subtasks[planAfterAction.currentIndex + 1];
                  if (currentSubtask && nextSubtask && lastToolName) {
                    const advanceSignal = detectStructuralStepAdvance({
                      currentStepDescription: currentSubtask.description,
                      currentStepSuccessCriteria:
                        this.planSteps[planAfterAction.currentIndex]
                          ?.successCriteria,
                      nextStepDescription: nextSubtask.description,
                      currentSnapshot: snap,
                      actionEffect,
                      toolName: lastToolName,
                    });

                    // Passive step advancement: if structural advance didn't fire,
                    // check if the current step's success criteria are satisfied in DOM.
                    // Advances silently so the agent continues acting instead of calling done().
                    const passiveCriteria = !advanceSignal
                      ? matchSuccessCriteria({
                          successCriteria:
                            this.planSteps[planAfterAction.currentIndex]
                              ?.successCriteria,
                          snapshot: snap,
                        })
                      : null;
                    const shouldPassiveAdvance =
                      passiveCriteria?.satisfied &&
                      passiveCriteria.totalTokens > 0 &&
                      passiveCriteria.matchedTokens.length >= 2;

                    if (advanceSignal || shouldPassiveAdvance) {
                      this.consecutiveAutoAdvances = 0;
                      const fromStep = planAfterAction.currentIndex;
                      const newIdx = completeSingleSubtask(
                        this as unknown as AgentLoopPlanProgressHost,
                        fromStep,
                      );
                      const isStructural = !!advanceSignal;
                      const reason = isStructural
                        ? advanceSignal!.reason
                        : `Step criteria satisfied (${passiveCriteria!.matchedTokens.join(", ")})`;
                      const matchedTokens = isStructural
                        ? advanceSignal!.matchedTokens
                        : passiveCriteria!.matchedTokens;
                      const traceEvent = isStructural
                        ? ("structural_step_advance" as const)
                        : ("passive_step_advance" as const);

                      this.syncPlanStatus(newIdx, traceEvent, {
                        reason,
                        matchedTokens,
                        advancedTo: newIdx,
                      });
                      const completedAllSteps =
                        newIdx >= this.planSubtasks.length;
                      const nextStepDesc =
                        this.planSubtasks[newIdx]?.description ||
                        "Finish the remaining plan";
                      if (!completedAllSteps) {
                        this.context.addMessage({
                          role: "user",
                          content:
                            `STEP COMPLETED: ${reason}. ` +
                            `Continue with the next step: ${nextStepDesc}. ` +
                            `Do NOT call done() - keep acting.`,
                        });
                      }
                      this.broadcastTaskProgress(newIdx);
                      if (completedAllSteps) {
                        const finalSummary = `Completed final planned step: ${reason}.`;
                        signalCompletedResult(finalSummary, {
                          saveCheckpoint: false,
                        });
                      }
                      this.log.info("agent", `${traceEvent} triggered`, {
                        turn: this.turnCount,
                        fromStep,
                        toStep: newIdx,
                        matchedTokens,
                      });
                      this.traceRecorder?.recordEvent(traceEvent, {
                        fromStep,
                        toStep: newIdx,
                        matchedTokens,
                        reason,
                        completedAllSteps,
                      });
                      if (completedAllSteps) {
                        this.saveTurnCheckpoint().catch(() => {});
                        await this.traceRecorder?.endTurn();
                        break;
                      }
                    }
                  }
                }

                // P1b: Track consecutive zero-effect turns with warn-then-escalate recovery
                if (
                  actionEffect.deltaPercent < ACTION_EFFECT.ZERO_THRESHOLD &&
                  !actionEffect.urlChanged
                ) {
                  this.consecutiveZeroEffectTurns++;
                  const failureBrief = buildFailureBrief(subgoalAttempts);
                  const zeroEffectDecision = buildZeroEffectDecision({
                    consecutiveTurns: this.consecutiveZeroEffectTurns,
                    failureBrief,
                    warningThreshold: ACTION_EFFECT.WARNING_THRESHOLD,
                    escalateThreshold: ACTION_EFFECT.ESCALATE_THRESHOLD,
                  });

                  if (
                    zeroEffectDecision.kind === "warn" &&
                    zeroEffectDecision.message
                  ) {
                    this.context.addMessage({
                      role: "user",
                      content: zeroEffectDecision.message,
                    });
                    this.traceRecorder?.recordEvent("zero_effect_warning", {
                      consecutiveTurns: this.consecutiveZeroEffectTurns,
                      hasFailureBrief: !!failureBrief,
                    });
                  } else if (
                    zeroEffectDecision.kind === "escalate" &&
                    zeroEffectDecision.message &&
                    escalationTier === 0 &&
                    cooldownRemaining <= 0
                  ) {
                    this.context.addMessage({
                      role: "user",
                      content: zeroEffectDecision.message,
                    });
                    this.traceRecorder?.recordEvent("zero_effect_escalation", {
                      consecutiveTurns: this.consecutiveZeroEffectTurns,
                      hasFailureBrief: !!failureBrief,
                    });

                    const zeroEffectReplanOk = await this.replanOnEscalation(
                      tabId,
                      subgoalAttempts,
                      this.abortController?.signal,
                    );
                    if (zeroEffectReplanOk) {
                      resetEscalationWorkingMemory({
                        resetProgressSignals: true,
                        resetZeroEffectTurns: true,
                        clearStuckFlag: true,
                      });
                      continue;
                    }

                    this.perception.invalidateCache();
                    const attemptSummary = extractAttemptSummary(
                      this.context.getMessages(),
                    );
                    this.escalateModel();
                    this.escalationsOnCurrentStep++;
                    escalationTier = 1;
                    orientationPhase = false;
                    plannerModelStartTurn = this.turnCount;
                    await this.strategyPivot(tabId, attemptSummary);
                    this.stagnation.resetEscalation();
                    this.context.addMessage({
                      role: "user",
                      content:
                        this.escalationsOnCurrentStep >= 2
                          ? ESCALATION_RECOVERY(this.escalationsOnCurrentStep)
                          : ESCALATION_REFLECTION(
                              "repeated DOM actions had no observable effect",
                            ),
                    });
                    consecutiveTextOnly = 0;
                    recentSuccesses.length = 0;
                    consecutiveProgressSignals = 0;
                    this.consecutiveZeroEffectTurns = 0;
                    subgoalAttempts.length = 0;
                    this.stepHandler(
                      {
                        id: crypto.randomUUID(),
                        type: "info",
                        label:
                          "Repeated no-effect actions - escalating to planner model",
                        status: "done",
                        timestamp: Date.now(),
                      },
                      false,
                    );
                    continue;
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
                  this.escalationsOnCurrentStep = 0;
                  lastReadElementId = null;
                  consecutiveReadElementSameId = 0;

                  // Ensure planner tier
                  if (escalationTier === 0) {
                    this.escalateModel();
                    escalationTier = 1;
                  }
                  plannerModelStartTurn = this.turnCount;

                  // Refresh snapshot
                  try {
                    await this.refreshSnapshot(tabId);
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

                // Escalate: executor → planner (try replan first)
                else if (escalationTier === 0 && cooldownRemaining <= 0) {
                  // Try replan-on-escalation first
                  const stagnationReplanOk = await this.replanOnEscalation(
                    tabId,
                    subgoalAttempts,
                    this.abortController?.signal,
                  );
                  if (stagnationReplanOk) {
                    resetEscalationWorkingMemory({
                      resetProgressSignals: true,
                      clearStuckFlag: true,
                    });
                  } else {
                    // Fallback: old escalation behavior
                    // Invalidate perception cache so the planner model gets a fresh interpretation
                    this.perception.invalidateCache();
                    const attemptSummary = extractAttemptSummary(
                      this.context.getMessages(),
                    );
                    this.escalateModel();
                    this.escalationsOnCurrentStep++;
                    escalationTier = 1;
                    orientationPhase = false;
                    plannerModelStartTurn = this.turnCount;
                    await this.strategyPivot(tabId, attemptSummary);
                    this.stagnation.resetEscalation();
                    this.context.addMessage({
                      role: "user",
                      content:
                        this.escalationsOnCurrentStep >= 2
                          ? ESCALATION_RECOVERY(this.escalationsOnCurrentStep)
                          : ESCALATION_REFLECTION(
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
                        label:
                          "Progress made — switching back to executor model",
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
          this.log.warn(
            "agent",
            "Think-only output detected, fast-tracking escalation",
            {
              turn: this.turnCount,
              rawLen: rawContent.length,
            },
          );
          this.context.addMessage({
            role: "user",
            content:
              "Your response contained only internal reasoning with no output or tool calls. " +
              "You MUST include at least one tool call. Use read_page to inspect the page, " +
              "or done() if the task is already complete.",
          });
          this.finishStream();
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
          const needsGroundingRead = requiresGroundingReadBeforeDone(
            this.originalQuery,
          );
          this.log.info("agent", "Soft nudge: turn 1 text response", {
            turn: this.turnCount,
            textLen: cleanContent.trim().length,
            requiresGroundingReadBeforeDone: needsGroundingRead,
          });
          if (needsGroundingRead) {
            await this.forceGroundingRefresh(
              tabId,
              "text_only_before_grounding_read",
            );
          }
          this.context.addMessage({
            role: "user",
            content: buildFirstTurnTextOnlyNudge(this.originalQuery),
          });
          this.finishStream();
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

            // When the model admits success in text but won't call done(),
            // reuse the existing evidence gate shape instead of trusting the
            // narration alone.
            const nextTextOnlyCount = consecutiveTextOnly + 1;
            consecutiveTextOnly = nextTextOnlyCount;
            totalTextOnly++;

            if (admission.type === "success" && this.planSubtasks.length > 0) {
              const gate = this.evaluateTextAdmissionAdvanceGate({
                summary: cleanContent,
                consecutiveTextOnly: nextTextOnlyCount,
              });

              if (gate.passed) {
                if (gate.isLastStep) {
                  this.log.info(
                    "agent",
                    "Text admission matched final step; nudging done()",
                    {
                      turn: this.turnCount,
                      step: gate.runningIdx,
                      text: cleanContent.slice(0, 100),
                    },
                  );
                  this.context.addMessage({
                    role: "user",
                    content:
                      `You stated: "${admission.match}". All step criteria are met. ` +
                      `Call done({"summary": "..."}) now with the complete result ` +
                      `including all requested data.`,
                  });
                  this.finishStream();
                  continue;
                }

                const newIdx = completeSingleSubtask(
                  this as unknown as AgentLoopPlanProgressHost,
                  gate.runningIdx,
                );
                const nextDesc =
                  this.planSubtasks[newIdx]?.description ||
                  "Continue to next step";
                this.syncPlanStatus(newIdx, "text_admission_criteria_advance", {
                  turn: this.turnCount,
                  fromStep: gate.runningIdx,
                });
                this.log.info(
                  "agent",
                  "Text admission criteria advanced step",
                  {
                    turn: this.turnCount,
                    fromStep: gate.runningIdx,
                    advancedTo: newIdx,
                    nextObjective: nextDesc,
                  },
                );
                this.context.addMessage({
                  role: "user",
                  content:
                    `Step verified complete (criteria matched, text confirms success). ` +
                    `Advancing.\nYOUR NEW OBJECTIVE: ${nextDesc}`,
                });
                this.finishStream();
                continue;
              }
            }

            const nudge =
              admission.type === "success"
                ? `You stated: "${admission.match}". Call done() to deliver the result.`
                : `You stated: "${admission.match}". Call done() to report inability, or call escalate() for help.`;
            this.context.addMessage({ role: "user", content: nudge });
            this.finishStream();
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
        const recentProgress =
          lastEffect &&
          (lastEffect.deltaPercent > ACTION_EFFECT.ZERO_THRESHOLD ||
            lastEffect.urlChanged);
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
          // Try replan-on-escalation first
          const textReplanOk = await this.replanOnEscalation(
            tabId,
            subgoalAttempts,
            this.abortController?.signal,
          );
          if (textReplanOk) {
            resetEscalationWorkingMemory();
            this.finishStream();
            continue;
          }

          // Fallback: old escalation behavior
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
          this.finishStream();
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
          this.finishStream();
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
          this.finishStream();
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

        // Durable checkpoint: persist loop state for SW restart recovery
        this.saveTurnCheckpoint().catch(() => {});

        // Trace: flush turn
        await this.traceRecorder?.endTurn();
        this.finishStream();
        continue;
      }

      // Durable checkpoint: persist loop state for SW restart recovery
      this.saveTurnCheckpoint().catch(() => {});

      // Trace: flush turn at end of each iteration
      await this.traceRecorder?.endTurn();
    }

    if (this.turnCount >= this.maxTurns && !this.completedResult) {
      this.log.warn("agent", "Loop ended: max turns reached", {
        turns: this.turnCount,
        maxTurns: this.maxTurns,
      });
      const limitMsg = `Reached turn limit (${this.turnCount}/${this.maxTurns}). You can increase the limit in Settings or send a follow-up message to continue.`;
      this.broadcast({
        type: "STREAM_CHUNK",
        payload: { delta: "", done: false, replaceContent: limitMsg },
      });
      this.finishStream();
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

  private detectExplicitSuccessSignalInSnapshot(snap: {
    title?: string;
    url?: string;
    pageContent?: string;
    visibleContent?: string;
  }): string | null {
    const query = this.getActiveExplicitSuccessContext();
    const quotedMatch =
      query.match(/verify the page shows ['"]([^'"]+)['"]/i) ??
      query.match(/page shows ['"]([^'"]+)['"]/i);
    const signal = quotedMatch?.[1]?.trim();
    if (!signal) return null;

    const haystacks = [
      snap.title ?? "",
      snap.pageContent ?? "",
      snap.visibleContent ?? "",
      snap.url ?? "",
    ];

    return haystacks.some((text) => text.includes(signal)) ? signal : null;
  }

  private getActiveExplicitSuccessContext(): string {
    const hasPlanContext =
      this.planSubtasks.length > 0 || this.planSteps.length > 0;
    if (!hasPlanContext) return this.originalQuery || "";

    const runningIdx = this.planSubtasks.findIndex(
      (subtask) => subtask.status === "running",
    );
    const stepIndex =
      runningIdx >= 0
        ? runningIdx
        : this.lastPlanIndex >= 0
          ? this.lastPlanIndex
          : -1;
    if (stepIndex < 0) return "";

    const currentStep = this.planSteps[stepIndex];
    const currentSubtask = this.planSubtasks[stepIndex];
    return [
      currentStep?.objective,
      currentStep?.successCriteria,
      currentStep?.verifyAfter?.trigger,
      currentSubtask?.description,
    ]
      .filter(Boolean)
      .join("\n");
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
    this.gracefulStopRequested = false;
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
        this.finishStream();
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
