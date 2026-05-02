import {
  AgentStatus,
  AgentLoopState,
  AgentStep,
  Citation,
  MessageSource,
  PerceptionRuntimeMode,
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
import { resolvePerceptionRuntimeMode } from "../../utils/perception-mode";
import { LLMClient, stripThinkTags, extractThinkContent } from "../llm";
import { toolRegistry } from "../tools";
import {
  DOM_MODIFYING_TOOLS,
  SEQUENTIAL_TOOLS,
  CACHEABLE_TOOLS,
  resolveToolProfile,
  buildDomAwareProfile,
} from "../tools/metadata";
import type { ToolProfile } from "../tools/metadata";
import { classifyRisk, sanitizeUrl, validateToolCalls } from "../security";
import { waitForDomReady, ensureContentScript } from "../tab-ready";
import {
  isBridgeDisconnect,
  recoverContentScriptBridge,
  type BridgeRecoveryTraceHook,
} from "../tools/bridge";
import { perceptionWarmup } from "../perception-warmup";
import { workspaceManager } from "../workspaces/manager";
import {
  ContextManager,
  summarizeCausalChain,
  summarizeHistory,
} from "./context";
import {
  assessDoneSummary,
  assessWorkflowDoneGuard,
  checkSummaryStepCoherence,
  checkVerificationGate,
  detectAdmission,
} from "./verification";
import { StagnationMonitor, computeSnapshotFingerprint } from "./stagnation";
import { buildElementSummary } from "../perception";
import { PerceptionAgent } from "../perception/perception-agent";
import type { PanoramicShot, PerceptionTaskContext } from "../perception/types";
import { recoverToolCallsFromText } from "./tool-recovery";
import { DomSnapshot } from "../../types";
import {
  CompletionResponse,
  ProviderConfig,
  TokenUsage,
} from "../llm/types";
import { estimateCostUsd } from "../llm/pricing";
import {
  formatStepLabel,
  buildElementResolver,
  ElementResolver,
} from "./step-labels";
import {
  TaskPlanner,
  inferToolProfileForStep,
  PlanStep,
  PlanMonitorResult,
} from "./planner";
import { TraceRecorder } from "./trace";
import { validateNuisanceBlockers } from "./popup-triage";
import { ToolResultCache } from "./tool-cache";
import { AgentMiddleware } from "./middleware";
import { EvidenceAccumulator } from "./evidence";
import {
  TURN_CHECKPOINT_VERSION,
  turnCheckpointKey,
  buildMutationKey,
} from "./checkpoint-types";
import type { TurnCheckpoint } from "./checkpoint-types";
import { MutationLedger } from "./mutation-ledger";
import {
  formatSeenRowRanges,
  formatSeenRows,
  getMoneyTableNextActionHint,
  parseMoneyAmount,
  parseSeenRowRanges,
  type MoneyTableAggregate,
} from "./money-table-aggregate";
import {
  extractExplicitInputValueForElement,
  isTextLikeInputElement,
  normalizeGuardText,
  rewriteAutocompleteTextEntry,
  validateTextEntryTarget,
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
  requiresBroadListDetailReview,
} from "./list-detail-policy";
export {
  countVisibleListDetailActions,
  getListDetailDoneRejection,
  getListDetailWorkflowBlock,
  getNextUnreviewedListDetailAction,
  isListDetailReturnControlRepeatExempt,
  requiresBroadListDetailReview,
} from "./list-detail-policy";
import {
  hasRecentExactTextFieldRead,
  isFinalCommunicationClick,
  isPaginationNavigationClick,
} from "./action-exemption-policy";
import {
  actionMemoryKey,
  shouldTrackRepeatAction,
} from "./repeat-action-policy";
import { getCachedScreenshot, setCachedScreenshot } from "./screenshot-cache";
import { formatProviderName, getProviderCreditsUrl } from "./provider-display";
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
import type {
  PendingApprovalInteraction,
  PendingClarificationInteraction,
  PendingUserInteraction,
} from "./loop-types";
import {
  getSkillToolPolicy,
  getSkillToolSuppressionPolicy,
  getLoadedSkillContract,
  resolveSkillToolProfile,
  type SkillToolPolicy,
} from "../orchestrator/skills";
import { evaluateWorkflowTabRedirect } from "./workflow-tab-controller";
import {
  BlockedAction,
  buildFailureBrief,
  buildFailureRecovery,
  buildHandoffBriefing,
  buildStructuredFailureContext,
  buildZeroEffectDecision,
  buildFirstTurnTextOnlyNudge,
  classifyTurnError,
  detectInstructionContradiction,
  detectFormSubmissionResetSuccess,
  detectPendingAsyncChange,
  detectStructuralStepAdvance,
  detectTrustedFormFillStepCompletion,
  detectTrustedFormSubmitCompletion,
  extractAttemptSummary,
  evaluateDoneTaskContractGuard,
  findPriorFailure,
  formatStateEvidence,
  formatStructuredFailureContext,
  getSnapshotFingerprint,
  isPendingAsyncChangeSatisfied,
  isFillerText,
  isHallucinatedToolCall,
  matchSuccessCriteria,
  MAX_TURN_RETRIES,
  normalizeOutcome,
  preflightElementCheck,
  RecentAction,
  requiresGroundingReadBeforeDone,
  RETRYABLE_ERRORS,
  shouldTrackFormSubmissionReset,
  SubgoalAttempt,
  TURN_RETRY_BACKOFF_MS,
  tokenizeStepText,
  userExplicitlyRequestedTabManagement,
  validateElementIds,
  extractDiscoveredTagIds,
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

const SKILL_TURN_CAPS: Record<string, number> = {
  "multi-tab-procurement-loop": 45,
  "list-detail-review-loop": 45,
  "paginated-table-scan": 55,
  "paginated-record-lookup": 35,
};

function applySkillTurnCap(
  selectedSkillId: string | null | undefined,
  maxTurns: number,
): number {
  if (!selectedSkillId) return maxTurns;
  const cap = SKILL_TURN_CAPS[selectedSkillId];
  return typeof cap === "number" ? Math.min(maxTurns, cap) : maxTurns;
}

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

function isToolProfileName(value: string | undefined): value is ToolProfile {
  return (
    value === "full" ||
    value === "read_only" ||
    value === "form_fill" ||
    value === "edit_surface" ||
    value === "navigate" ||
    value === "enter_code" ||
    value === "submit_form" ||
    value === "inspect_hidden_state" ||
    value === "recover_from_stuck" ||
    value === "navigation_only"
  );
}

/**
 * Count explicit numbered steps in a user query.
 * Matches patterns like "Step 1:", "1.", "1)", and sequential markers.
 * Returns the number of distinct steps detected.
 */
function countExplicitSteps(query: string): number {
  // Match numbered patterns: "Step 1", "Step 2", "1.", "2.", "1)", "2)"
  const numberedStepPattern = /(?:^|\n)\s*(?:step\s+)?(\d+)[.):\s]/gim;
  const numbers = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = numberedStepPattern.exec(query)) !== null) {
    numbers.add(parseInt(match[1], 10));
  }
  return numbers.size;
}

const REPEAT_ACTION_WINDOW = 20;
const CAPTURE_VISIBLE_TAB_RETRY_DELAY_MS = 300;

export function isPerceptionFailurePlaceholder(
  interpretation: string | null | undefined,
): boolean {
  if (!interpretation) return false;
  return /\[visual perception failed:/i.test(interpretation);
}

export function shouldOmitPerceptionForDoneValidation(args: {
  interpretation: string | null | undefined;
  hasReadPage: boolean;
  originalQuery: string;
  activeStepDescription?: string;
  activeStepToolProfile?: ToolProfile;
}): boolean {
  if (!args.hasReadPage) return false;
  if (!isPerceptionFailurePlaceholder(args.interpretation)) return false;

  const activeProfile =
    args.activeStepToolProfile ??
    inferToolProfileForStep(
      args.activeStepDescription || args.originalQuery,
      "",
    );
  if (activeProfile === "read_only") return true;

  return inferToolProfileForStep(args.originalQuery, "") === "read_only";
}

function rectsLikelyOverlap(
  a: DomSnapshot["elements"][number]["rect"] | undefined,
  b: DomSnapshot["elements"][number]["rect"] | undefined,
): boolean {
  if (!a || !b) return false;
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

class PendingInteractionYield extends Error {
  constructor(readonly pendingInteraction: PendingUserInteraction) {
    super(
      pendingInteraction.kind === "approval"
        ? "Awaiting approval"
        : "Awaiting clarification",
    );
    this.name = "PendingInteractionYield";
  }
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
  private getActiveSkillToolPolicy(): SkillToolPolicy | null {
    return getSkillToolPolicy(this.selectedSkillId ?? undefined);
  }

  private classifySkillToolPreference(
    toolName: ToolName,
  ): "preferred" | "discouraged" | "neutral" | null {
    const policy = this.getActiveSkillToolPolicy();
    if (!policy) return null;
    if (policy.preferredTools.includes(toolName)) return "preferred";
    if (policy.discouragedTools.includes(toolName)) return "discouraged";
    return "neutral";
  }

  private applySkillToolRanking(tools: ToolDefinition[]): ToolDefinition[] {
    const policy = this.getActiveSkillToolPolicy();
    if (!policy) return tools;

    const preferredIndex = new Map<ToolName, number>(
      policy.preferredTools.map((toolName, index) => [toolName, index]),
    );
    const discouragedIndex = new Map<ToolName, number>(
      policy.discouragedTools.map((toolName, index) => [toolName, index]),
    );

    const ranked = [...tools]
      .map((tool, originalIndex) => {
        const toolName = tool.function.name as ToolName;
        if (preferredIndex.has(toolName)) {
          return {
            tool,
            bucket: 0,
            policyIndex: preferredIndex.get(toolName) ?? 0,
            originalIndex,
          };
        }
        if (discouragedIndex.has(toolName)) {
          return {
            tool,
            bucket: 2,
            policyIndex: discouragedIndex.get(toolName) ?? 0,
            originalIndex,
          };
        }
        return {
          tool,
          bucket: 1,
          policyIndex: Number.MAX_SAFE_INTEGER,
          originalIndex,
        };
      })
      .sort((a, b) => {
        if (a.bucket !== b.bucket) return a.bucket - b.bucket;
        if (a.policyIndex !== b.policyIndex)
          return a.policyIndex - b.policyIndex;
        return a.originalIndex - b.originalIndex;
      })
      .map((entry) => entry.tool);

    const originalOrder = tools.map((tool) => tool.function.name).join(",");
    const rankedOrder = ranked.map((tool) => tool.function.name).join(",");
    if (originalOrder !== rankedOrder) {
      this.log.info("agent", "Skill tool ranking applied", {
        turn: this.turnCount,
        skillId: this.selectedSkillId,
        preferredTools: policy.preferredTools,
        discouragedTools: policy.discouragedTools,
        originalToolCount: tools.length,
        rankedToolCount: ranked.length,
      });
      this.traceRecorder?.recordEvent("skill_tool_ranking_applied", {
        turn: this.turnCount,
        skillId: this.selectedSkillId ?? "unknown",
        preferredTools: policy.preferredTools,
        discouragedTools: policy.discouragedTools,
        originalOrder: tools.map((tool) => tool.function.name),
        rankedOrder: ranked.map((tool) => tool.function.name),
      });
    }

    return ranked;
  }

  private applySkillToolSuppression(tools: ToolDefinition[]): ToolDefinition[] {
    const policy = getSkillToolSuppressionPolicy(
      this.selectedSkillId ?? undefined,
    );
    if (!policy) return tools;

    const suppressed = new Set<ToolName>(
      policy.temporarilySuppressedTools.filter(
        (tool) => !policy.exemptTools.includes(tool),
      ),
    );
    if (suppressed.size === 0) return tools;

    const filtered = tools.filter(
      (tool) => !suppressed.has(tool.function.name as ToolName),
    );
    if (filtered.length !== tools.length) {
      this.log.info("agent", "Skill tool suppression applied", {
        turn: this.turnCount,
        skillId: this.selectedSkillId,
        suppressedTools: Array.from(suppressed),
        originalToolCount: tools.length,
        filteredToolCount: filtered.length,
      });
      this.traceRecorder?.recordEvent("skill_tool_suppression_applied", {
        turn: this.turnCount,
        skillId: this.selectedSkillId ?? "unknown",
        suppressedTools: Array.from(suppressed),
        originalToolCount: tools.length,
        filteredToolCount: filtered.length,
      });
    }

    return filtered;
  }

  private recordSkillToolSelection(
    toolName: ToolName,
    mode: "parallel" | "sequential",
  ): void {
    const preference = this.classifySkillToolPreference(toolName);
    if (!this.selectedSkillId || !preference) return;
    this.traceRecorder?.recordEvent("skill_tool_selected", {
      turn: this.turnCount,
      skillId: this.selectedSkillId,
      toolName,
      preference,
      mode,
    });
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
  private initialPlanState: {
    subtasks: Array<{
      description: string;
      successCriteria?: string;
      status: SubtaskSummary["status"];
      turnsUsed?: number;
      turnBudget?: number;
      result?: string;
      completedAtUrl?: string;
      verificationGate?: {
        trigger: string;
        action: "call_done" | "advance_step" | "retry_step";
        maxRetries?: number;
        pattern?: string;
      };
      toolProfile?: ToolProfile;
    }>;
    currentIndex: number;
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
  public readonly selectedSkillId: string | null;

  /** Current turn count — exposed via getCurrentTurn() */
  private turnCount = 0;
  /** Original user query that started this loop */
  private originalQuery = "";
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
    providerId: ProviderConfig["providerId"],
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
      const providerId = (response.actualProviderId ??
        this.llm.getCurrentProvider()) as ProviderConfig["providerId"];
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
      const providerId = (response.actualProviderId ??
        this.llm.getCurrentProvider()) as ProviderConfig["providerId"];
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
    providerId: ProviderConfig["providerId"] = "openrouter",
  ): void {
    this.metrics.totalPromptTokens += usage.prompt_tokens;
    this.metrics.totalCompletionTokens += usage.completion_tokens;
    this.metrics.totalTokens += usage.total_tokens;
    const cost = this.resolveCost(usage, providerId, model);
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
      selectedSkillId?: string | null;
      suppressUiBroadcast?: boolean;
      /** Called for STREAM_CHUNK even when suppressUiBroadcast is true.
       *  Allows orchestrator to forward content for single-node tasks. */
      onStreamChunk?: (
        delta: string,
        done: boolean,
        replaceContent?: string,
        thinking?: string,
      ) => void;
      initialPlanState?: {
        subtasks: Array<{
          description: string;
          successCriteria?: string;
          status: SubtaskSummary["status"];
          turnsUsed?: number;
          turnBudget?: number;
          result?: string;
          completedAtUrl?: string;
          verificationGate?: {
            trigger: string;
            action: "call_done" | "advance_step" | "retry_step";
            maxRetries?: number;
            pattern?: string;
          };
          toolProfile?: ToolProfile;
        }>;
        currentIndex: number;
      };
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
      useVLExecutor?: boolean;
      /** Durable turn checkpoint from a prior SW lifetime — injected by orchestrator on restart. */
      turnCheckpoint?: TurnCheckpoint | null;
      /** Pending user interaction state injected by the orchestrator on resume. */
      resumeInteraction?: PendingUserInteraction | null;
    },
  ) {
    this.showSessionMetrics = options?.showSessionMetrics ?? false;
    // Observation path: Fireworks defaults to unified VL; other stacks default
    // to structured perception unless explicitly overridden.
    this.useVLExecutor =
      resolvePerceptionRuntimeMode({
        perceptionMode: options?.perceptionMode,
        useVLExecutor: options?.useVLExecutor,
        providerMode: options?.providerMode,
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
    this.planSubtasks = this.initialPlanState.subtasks.map((subtask) => ({
      description: subtask.description,
      status: subtask.status,
      turnsUsed: subtask.turnsUsed ?? 0,
      turnBudget: subtask.turnBudget ?? 0,
      ...(subtask.result ? { result: subtask.result } : {}),
      ...(subtask.completedAtUrl
        ? { completedAtUrl: subtask.completedAtUrl }
        : {}),
    }));
    this.planSteps = this.initialPlanState.subtasks.map((subtask) => ({
      objective: subtask.description,
      successCriteria:
        subtask.successCriteria ||
        "The current step is completed and verified.",
      dependencies: [],
      assumptions: [],
      ...(subtask.verificationGate
        ? { verifyAfter: subtask.verificationGate }
        : {}),
      ...(subtask.toolProfile ? { toolProfile: subtask.toolProfile } : {}),
    }));
    this.lastPlanIndex = this.initialPlanState.currentIndex;
    this.context.setPlanStatus(
      this.initialPlanState.subtasks.map((subtask) => ({
        description: subtask.description,
        status: subtask.status,
        ...(subtask.result ? { result: subtask.result } : {}),
        ...(subtask.completedAtUrl
          ? { completedAtUrl: subtask.completedAtUrl }
          : {}),
        ...(subtask.verificationGate
          ? { verificationGate: subtask.verificationGate }
          : {}),
        ...(subtask.toolProfile ? { toolProfile: subtask.toolProfile } : {}),
      })),
      this.initialPlanState.currentIndex,
    );
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
    const taskText =
      `${this.originalQuery}\n${this.planSubtasks[this.lastPlanIndex]?.description ?? ""}`.toLowerCase();
    return (
      /\b(highest|max(?:imum)?|largest|most)\b/.test(taskText) &&
      /\b(salary|pay|compensation|price|cost|amount|revenue|budget)\b/.test(
        taskText,
      )
    );
  }

  private hydrateMoneyTableAggregateFromWorkingNotes(): MoneyTableAggregate | null {
    const notes = this.context.getWorkingNotes?.() ?? "";
    if (!notes.includes("Paginated table aggregate:")) return null;
    const candidate = notes.match(
      /current highest ([^;]+?) candidate is (.+?) at (\$\s*[\d,]+(?:\.\d+)?)/i,
    );
    if (!candidate) return null;

    const totalMatch =
      notes.match(/seen rows [\d,\-\s]+\/(\d+)/i) ??
      notes.match(/rows read \d+\/(\d+)/i);
    const seenMatch = notes.match(/seen rows ([\d,\-\s]+)\/\d+/i);
    const seenRows = seenMatch
      ? parseSeenRowRanges(seenMatch[1])
      : new Set<number>();
    const totalRows = totalMatch ? Number(totalMatch[1]) : null;
    const bestAmount = parseMoneyAmount(candidate[3]);
    if (bestAmount === null) return null;

    return {
      mode: "max",
      label: candidate[1],
      bestName: candidate[2],
      bestAmount,
      bestDisplay: candidate[3],
      seenRows,
      totalRows: totalRows && Number.isFinite(totalRows) ? totalRows : null,
      currentStart: null,
      currentEnd: null,
    };
  }

  private updateMoneyTableAggregate(result: string): string | null {
    if (!this.isMoneyTableAggregateTask()) return null;

    const lines = result
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const range = result.match(
      /Showing\s+(\d+)\s*(?:-|\u2012|\u2013|\u2014)\s*(\d+)\s+of\s+(\d+)/i,
    );
    let rangeStart: number | null = null;
    let rangeEnd: number | null = null;
    let totalRows: number | null = null;
    if (range) {
      rangeStart = Number(range[1]);
      rangeEnd = Number(range[2]);
      totalRows = Number(range[3]);
    } else {
      const totalSummary = result.match(
        /\b(\d+)\s+(?:rows|records|employees|items)\b[^.\n]*\b(\d+)\s+per\s+page\b/i,
      );
      if (totalSummary) {
        totalRows = Number(totalSummary[1]);
      }
    }

    const aggregate =
      this.moneyTableAggregate ??
      this.hydrateMoneyTableAggregateFromWorkingNotes() ??
      ({
        mode: "max",
        label: "money value",
        bestName: null,
        bestAmount: null,
        bestDisplay: null,
        seenRows: new Set<number>(),
        totalRows: null,
        currentStart: null,
        currentEnd: null,
      } satisfies MoneyTableAggregate);
    if (totalRows && Number.isFinite(totalRows)) {
      aggregate.totalRows = totalRows;
    }

    if (
      rangeStart !== null &&
      rangeEnd !== null &&
      Number.isFinite(rangeStart) &&
      Number.isFinite(rangeEnd)
    ) {
      aggregate.currentStart = rangeStart;
      aggregate.currentEnd = rangeEnd;
      for (let row = rangeStart; row <= rangeEnd; row++) {
        aggregate.seenRows.add(row);
      }
    }

    const visibleRowIds = new Set<number>();
    const compactResult = result.replace(/\s+/g, " ");
    const compactRowPattern =
      /\b(\d{1,6})\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s+[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\s+[A-Za-z][A-Za-z&/ -]{0,60}?\s+(\$\s*[\d,]+(?:\.\d+)?)/g;
    let compactRow: RegExpExecArray | null;
    while ((compactRow = compactRowPattern.exec(compactResult)) !== null) {
      const rowId = Number(compactRow[1]);
      const name = compactRow[2].trim();
      const display = compactRow[3].trim();
      const amount = parseMoneyAmount(display);
      if (!Number.isFinite(rowId) || amount === null) continue;

      visibleRowIds.add(rowId);
      if (aggregate.bestAmount === null || amount > aggregate.bestAmount) {
        aggregate.bestAmount = amount;
        aggregate.bestDisplay = display;
        aggregate.bestName = name;
      }
    }

    for (let idx = 0; idx < lines.length; idx++) {
      const amount = parseMoneyAmount(lines[idx]);
      if (amount === null) continue;

      let name: string | null = null;
      let emailLineIndex: number | null = null;
      for (let back = idx - 1; back >= Math.max(0, idx - 5); back--) {
        if (lines[back].includes("@") && back > 0) {
          emailLineIndex = back;
          name = lines[back - 1];
          break;
        }
      }
      if (!name || /^[#\d]+$/.test(name)) continue;

      if (emailLineIndex !== null) {
        for (
          let back = emailLineIndex - 2;
          back >= Math.max(0, emailLineIndex - 7);
          back--
        ) {
          if (/^\d+$/.test(lines[back])) {
            const rowId = Number(lines[back]);
            if (Number.isFinite(rowId)) {
              visibleRowIds.add(rowId);
            }
            break;
          }
        }
      }

      if (aggregate.bestAmount === null || amount > aggregate.bestAmount) {
        aggregate.bestAmount = amount;
        aggregate.bestDisplay = lines[idx];
        aggregate.bestName = name;
      }
    }

    if (visibleRowIds.size > 0) {
      for (const row of visibleRowIds) aggregate.seenRows.add(row);
      if (rangeStart === null || rangeEnd === null) {
        const sorted = Array.from(visibleRowIds).sort((a, b) => a - b);
        aggregate.currentStart = sorted[0];
        aggregate.currentEnd = sorted[sorted.length - 1];
      }
    }

    this.moneyTableAggregate = aggregate;
    if (!aggregate.bestName || !aggregate.bestDisplay) return null;

    const coverage = formatSeenRows(aggregate);
    const complete =
      aggregate.totalRows !== null &&
      aggregate.totalRows > 0 &&
      aggregate.seenRows.size >= aggregate.totalRows;
    const note =
      `Paginated table aggregate: current highest ${aggregate.label} candidate is ` +
      `${aggregate.bestName} at ${aggregate.bestDisplay}; rows read ${coverage}; ` +
      `seen rows ${formatSeenRowRanges(aggregate.seenRows)}/${aggregate.totalRows ?? "unknown"}. ` +
      (complete
        ? "The scan is exhaustive; call done with this candidate unless the current page contradicts it."
        : `The scan is not exhaustive yet. Next action: ${getMoneyTableNextActionHint(aggregate)}.`);
    this.context.setWorkingNotes(note);
    return `[Aggregation state: ${note}]`;
  }

  private updateMoneyTableAggregateFromSnapshot(): void {
    const snapshot = this.context.getSnapshot?.();
    const pageText = snapshot?.pageContent || snapshot?.visibleContent || "";
    if (!pageText.trim()) return;
    this.updateMoneyTableAggregate(pageText);
  }

  private getIncompleteMoneyTableAggregateDoneRejection(): string | null {
    if (!this.isMoneyTableAggregateTask()) return null;
    this.updateMoneyTableAggregateFromSnapshot();
    const aggregate =
      this.moneyTableAggregate ??
      this.hydrateMoneyTableAggregateFromWorkingNotes();
    if (!aggregate?.bestName || !aggregate.bestDisplay) return null;

    const complete =
      aggregate.totalRows !== null &&
      aggregate.totalRows > 0 &&
      aggregate.seenRows.size >= aggregate.totalRows;
    if (complete) return null;

    return (
      `The paginated table scan is not exhaustive yet: current candidate is ` +
      `${aggregate.bestName} at ${aggregate.bestDisplay}, with rows read ` +
      `${formatSeenRows(aggregate)} and seen rows ` +
      `${formatSeenRowRanges(aggregate.seenRows)}/${aggregate.totalRows ?? "unknown"}. ` +
      `Continue scanning remaining table pages before reporting the highest value. ` +
      `Next action: ${getMoneyTableNextActionHint(aggregate)}.`
    );
  }

  private getIncorrectMoneyTableAggregateDoneRejection(
    summary: string,
  ): string | null {
    if (!this.isMoneyTableAggregateTask()) return null;
    this.updateMoneyTableAggregateFromSnapshot();
    const aggregate =
      this.moneyTableAggregate ??
      this.hydrateMoneyTableAggregateFromWorkingNotes();
    if (!aggregate?.bestName || !aggregate.bestDisplay) return null;

    const complete =
      aggregate.totalRows !== null &&
      aggregate.totalRows > 0 &&
      aggregate.seenRows.size >= aggregate.totalRows;
    if (!complete) return null;

    const normalizedSummary = summary.toLowerCase();
    const normalizedName = aggregate.bestName.toLowerCase();
    const bestDigits = aggregate.bestDisplay.replace(/[^\d]/g, "");
    const summaryDigits = summary.replace(/[^\d]/g, "");
    if (
      normalizedSummary.includes(normalizedName) &&
      bestDigits.length > 0 &&
      summaryDigits.includes(bestDigits)
    ) {
      return null;
    }

    return (
      `The exhaustive table scan found ${aggregate.bestName} at ` +
      `${aggregate.bestDisplay}, but the done() summary did not report that ` +
      `tracked highest candidate. Report ${aggregate.bestName} at ` +
      `${aggregate.bestDisplay}.`
    );
  }

  private isCompletedMoneyTableAggregateSummary(summary: string): boolean {
    if (this.selectedSkillId !== "paginated-table-scan") return false;
    if (!this.isMoneyTableAggregateTask()) return false;
    this.updateMoneyTableAggregateFromSnapshot();
    const aggregate =
      this.moneyTableAggregate ??
      this.hydrateMoneyTableAggregateFromWorkingNotes();
    if (!aggregate?.bestName || !aggregate.bestDisplay) return false;

    const complete =
      aggregate.totalRows !== null &&
      aggregate.totalRows > 0 &&
      aggregate.seenRows.size >= aggregate.totalRows;
    if (!complete) return false;

    return this.getIncorrectMoneyTableAggregateDoneRejection(summary) === null;
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
    const existingPlan = this.context.getPlanStatusRaw();
    const subtasks = this.planSubtasks.map((s, idx) => ({
      description: s.description,
      status: s.status,
      completedAtUrl: s.completedAtUrl,
      result: s.result,
      ...(existingPlan?.subtasks[idx]?.verificationGate
        ? { verificationGate: existingPlan.subtasks[idx].verificationGate }
        : this.planSteps[idx]?.verifyAfter
          ? { verificationGate: this.planSteps[idx].verifyAfter }
          : {}),
      ...(existingPlan?.subtasks[idx]?.toolProfile
        ? { toolProfile: existingPlan.subtasks[idx].toolProfile }
        : this.planSteps[idx]?.toolProfile
          ? { toolProfile: this.planSteps[idx].toolProfile }
          : {}),
    }));

    if (
      !subtasks.some((subtask) => subtask.status === "running") &&
      currentIndex < subtasks.length
    ) {
      const repairedIndex = subtasks.findIndex(
        (subtask) => subtask.status !== "completed",
      );
      if (repairedIndex >= 0) {
        subtasks[repairedIndex].status = "running";
      }
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
  private broadcast(
    msg: Omit<RuntimeMessage, "requestId" | "source" | "workspaceId">,
  ): void {
    if (this.suppressUiBroadcast) {
      // Forward STREAM_CHUNK to callback even when UI broadcasts are suppressed
      if (msg.type === "STREAM_CHUNK" && this.onStreamChunk) {
        const p = msg.payload as {
          delta: string;
          done: boolean;
          replaceContent?: string;
          thinking?: string;
        };
        this.onStreamChunk(p.delta, p.done, p.replaceContent, p.thinking);
      }
      return;
    }
    // Attach citations to the final stream chunk
    if (msg.type === "STREAM_CHUNK") {
      const p = msg.payload as {
        delta: string;
        done: boolean;
        citations?: unknown[];
      };
      if (p.done && this.citations.length > 0) {
        msg = {
          ...msg,
          payload: { ...p, citations: [...this.citations] },
        } as typeof msg;
      }
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
    const approvalStep: AgentStep = {
      id: crypto.randomUUID(),
      type: "info",
      label: `Approval requested: ${context}`,
      status: "running",
      timestamp: Date.now(),
    };
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
      .sendMessage({
        type: "APPROVAL_REQUEST",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        workspaceId: this.workspaceId,
        payload: {
          approvalId: interaction.approvalId,
          toolName,
          args,
          risk: RiskLevel.HIGH,
          context,
          timeoutMs: remainingTimeoutMs,
        },
      } as RuntimeMessage)
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
    const clarifyStep: AgentStep = {
      id: crypto.randomUUID(),
      type: "info",
      label: `Clarification: "${question.slice(0, 80)}"`,
      status: "running",
      timestamp: Date.now(),
    };
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
      .sendMessage({
        type: "CLARIFICATION_REQUEST",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        workspaceId: this.workspaceId,
        payload: {
          clarificationId: interaction.clarificationId,
          question,
          suggestions,
          timeoutMs: remainingTimeoutMs,
        },
      } as RuntimeMessage)
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

  private requiresJobApplicationSubmitApproval(
    toolName: ToolName,
    args: Record<string, unknown>,
  ): boolean {
    if (toolName !== ToolName.CLICK_ELEMENT) return false;
    if (args.id == null) return false;
    const taskText = this.getJobApplicationApprovalTaskText();
    const isJobApplicationWorkflow =
      /\b(job|career|position|vacancy|cv|resume)\b/.test(taskText) ||
      /\b(apply|application)\b[^.\n]{0,80}\b(job|career|position|vacancy)\b/.test(
        taskText,
      ) ||
      /\b(job|career|position|vacancy)\b[^.\n]{0,80}\b(apply|application)\b/.test(
        taskText,
      );
    if (!isJobApplicationWorkflow) return false;
    const label = formatStepLabel(
      toolName,
      args,
      this.elementResolver,
    ).toLowerCase();
    return (
      /\b(submit|send|finish|complete)\b/.test(label) ||
      /\bapply\b.*\b(application|form)\b/.test(label)
    );
  }

  private getJobApplicationApprovalTaskText(): string {
    const planStatus = this.context.getPlanStatusRaw();
    const activeIndex =
      planStatus?.currentIndex ??
      this.planSubtasks.findIndex((subtask) => subtask.status === "running");
    const stepIndex =
      activeIndex != null && activeIndex >= 0 ? activeIndex : this.lastPlanIndex;

    const currentTaskObjective =
      this.originalQuery.match(/## Current Task[\s\S]*?Objective:\s*([^\n]+)/i)?.[1] ??
      this.originalQuery.match(/^Objective:\s*([^\n]+)/im)?.[1] ??
      "";
    const originalUserRequest =
      this.originalQuery.match(/Original user request[^:\n]*:\s*\n([^\n]+)/i)?.[1] ??
      "";

    return [
      this.planSubtasks[stepIndex]?.description,
      this.planSteps[stepIndex]?.objective,
      this.planSteps[stepIndex]?.successCriteria,
      currentTaskObjective,
      originalUserRequest,
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
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

    // Ensure we have a snapshot — either from the orchestrator, warmup cache, or by fetching our own
    let snapshot = initialSnapshot;
    let warmupPerception: {
      interpretation: string;
      providerId?: string;
      durationMs: number;
    } | null = null;
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
          if (entry.perception) warmupPerception = entry.perception;
          warmupScreenshot = entry.screenshotUrl;
          this.log.info(
            "agent",
            "Using warmup snapshot" +
              (entry.screenshotOnly ? " (screenshot-only)" : " + perception"),
            {
              tabId,
              elementCount: snapshot.elements.length,
              screenshotOnly: entry.screenshotOnly ?? false,
              provider: entry.perception?.providerId,
            },
          );
        }
      } else {
        // Check static cache (warmup may have finished already)
        const cached = perceptionWarmup.get(tabId);
        if (cached) {
          snapshot = cached.snapshot;
          if (cached.perception) warmupPerception = cached.perception;
          warmupScreenshot = cached.screenshotUrl;
          this.log.info(
            "agent",
            "Using cached warmup snapshot" +
              (cached.screenshotOnly ? " (screenshot-only)" : " + perception"),
            {
              tabId,
              elementCount: snapshot.elements.length,
              ageMs: Date.now() - cached.timestamp,
            },
          );
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

      if (this.useVLExecutor && warmupScreenshot) {
        // VL mode: use warmup screenshot directly — skip VLM call
        this.context.setScreenshotForExecutor(warmupScreenshot);
        this.context.setPageInterpretation(null);
        this.perception.setScreenshotUrl(warmupScreenshot);
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
          this.log.info("agent", "Planner decomposition outcome", {
            turn: this.turnCount,
            outcome:
              decomposition.instrumentation?.outcome ??
              (decomposition.steps
                ? "structured_steps"
                : decomposition.subtasks.length >= 2
                  ? "legacy_subtasks"
                  : "simple_task"),
            requestedMultiStep:
              decomposition.instrumentation?.requestedMultiStep ?? null,
            parsedStepCount:
              decomposition.instrumentation?.parsedStepCount ??
              decomposition.steps?.length ??
              0,
            parsedSubtaskCount:
              decomposition.instrumentation?.parsedSubtaskCount ??
              decomposition.subtasks.length,
            runtimeSubtaskCount: decomposition.subtasks.length,
          });
          this.traceRecorder?.recordEvent("planner_decomposition_outcome", {
            turn: this.turnCount,
            outcome:
              decomposition.instrumentation?.outcome ??
              (decomposition.steps
                ? "structured_steps"
                : decomposition.subtasks.length >= 2
                  ? "legacy_subtasks"
                  : "simple_task"),
            requestedMultiStep:
              decomposition.instrumentation?.requestedMultiStep ?? null,
            parsedStepCount:
              decomposition.instrumentation?.parsedStepCount ??
              decomposition.steps?.length ??
              0,
            parsedSubtaskCount:
              decomposition.instrumentation?.parsedSubtaskCount ??
              decomposition.subtasks.length,
            runtimeSubtaskCount: decomposition.subtasks.length,
          });
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
            steps: (decomposition.steps ?? []).map((s: any) => ({
              objective: s.objective,
              successCriteria: s.successCriteria,
              dependencies: s.dependencies,
              assumptions: s.assumptions,
              ...(s.verifyAfter ? { verifyAfter: s.verifyAfter } : {}),
              ...(s.toolProfile ? { toolProfile: s.toolProfile } : {}),
              ...(s.expectedState ? { expectedState: s.expectedState } : {}),
            })),
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

            // Detect if plan steps require tab management
            const TAB_STEP_KEYWORDS =
              /(new tab|open.*tab|switch.*tab|close.*tab|separate tab|another tab|each tab|multiple tab|across tab)/i;
            this.planRequiresTabManagement =
              decomposition.requiresTabManagement ??
              this.planSteps.some((s) =>
                TAB_STEP_KEYWORDS.test(s.objective || ""),
              );

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
            this.log.info("agent", "Runtime plan status initialized", {
              turn: this.turnCount,
              subtaskCount: decomposition.subtasks.length,
              currentIndex: 0,
              toolProfiles: (decomposition.steps ?? []).map(
                (step) => step.toolProfile ?? null,
              ),
            });
            this.traceRecorder?.recordEvent("runtime_plan_status_initialized", {
              turn: this.turnCount,
              subtaskCount: decomposition.subtasks.length,
              currentIndex: 0,
              toolProfiles: (decomposition.steps ?? []).map(
                (step) => step.toolProfile ?? null,
              ),
            });

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
          } else {
            this.log.info(
              "agent",
              "Planner decomposition did not initialize runtime plan",
              {
                turn: this.turnCount,
                runtimeSubtaskCount: decomposition.subtasks.length,
                outcome:
                  decomposition.instrumentation?.outcome ??
                  (decomposition.steps ? "structured_steps" : "simple_task"),
              },
            );
            this.traceRecorder?.recordEvent("runtime_plan_status_skipped", {
              turn: this.turnCount,
              runtimeSubtaskCount: decomposition.subtasks.length,
              outcome:
                decomposition.instrumentation?.outcome ??
                (decomposition.steps ? "structured_steps" : "simple_task"),
            });
          }
        } else {
          this.log.warn("agent", "Planner decomposition returned null", {
            turn: this.turnCount,
          });
          this.traceRecorder?.recordEvent("planner_decomposition_outcome", {
            turn: this.turnCount,
            outcome: "null",
          });
        }
      } catch (err: any) {
        this.log.warn("agent", "Planner decompose error (non-fatal)", {
          error: err?.message,
        });
      }
    } else {
      this.log.info(
        "agent",
        "Internal planning disabled for this executor run",
        {
          workspaceId: this.workspaceId,
          workerId: this.workerId,
          originalQueryPreview: initialUserText.slice(0, 200),
        },
      );
      this.traceRecorder?.recordEvent("internal_planning_disabled", {
        workspaceId: this.workspaceId,
        workerId: this.workerId,
      });
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
      const controllerResult =
        await this.maybeRunAtomicSkillController(tabId);
      result = controllerResult ?? (await this.loop(tabId));
    } catch (error: any) {
      if (error instanceof PendingInteractionYield) {
        const awaitingSummary =
          error.pendingInteraction.kind === "approval"
            ? "Awaiting approval"
            : "Awaiting clarification";
        this.log.info("agent", "Loop yielded for user interaction", {
          outcome:
            error.pendingInteraction.kind === "approval"
              ? "awaiting_approval"
              : "awaiting_clarification",
          nodeId: this.nodeId,
          turn: this.turnCount,
        });
        result = {
          outcome:
            error.pendingInteraction.kind === "approval"
              ? "awaiting_approval"
              : "awaiting_clarification",
          turnCount: this.turnCount,
          summary: awaitingSummary,
          failure: { category: "none", code: "none" },
          metrics: this.getMetrics(),
          pendingInteraction: error.pendingInteraction,
        };
      } else if (error.name === "AbortError") {
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
      result.sideEffectsLog = [...this.mutationLedger.sideEffects];
      result.evidence = this.evidenceAccumulator.toArray();

      if (
        result.outcome !== "awaiting_approval" &&
        result.outcome !== "awaiting_clarification"
      ) {
        // Clean up durable turn checkpoint — node has reached a terminal state
        this.clearTurnCheckpoint().catch(() => {});
      }

      if (
        result.outcome !== "completed" &&
        result.outcome !== "awaiting_approval" &&
        result.outcome !== "awaiting_clarification" &&
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
          await this.scrollContentScript(tabId, initialScrollY, 1500);
        } catch (error) {
          this.traceRecorder?.recordEvent("terminal_cleanup_timeout", {
            phase: "restore_scroll",
            tabId,
            targetScrollY: initialScrollY,
            error: error instanceof Error ? error.message : String(error),
          });
          // Tab may have been closed or navigated — safe to ignore
        }
      }

      this.isRunning = false;

      // Capture condensed action history for handoff to the next same-tab node.
      // This lets the successor know what happened (e.g. "cart drawer opened")
      // without carrying the full conversation history.
      try {
        const trajectory = summarizeHistory(this.context.getMessages(), 20);
        if (trajectory.length > 0) {
          result.trajectory = trajectory;
        }
      } catch {
        // Non-critical — trajectory is best-effort for handoff
      }

      // Finalize trace recording (fire-and-forget)
      if (this.traceRecorder) {
        this.traceRecorder.recordEvent("tool_cache_stats", {
          ...this.toolCache.getStats(),
        } as Record<string, unknown>);
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
    if (this.selectedSkillId === "multi-tab-procurement-loop") return false;
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
    const planStatus = this.context.getPlanStatusRaw();
    const currentSubtaskIndex =
      planStatus?.subtasks.findIndex((s) => s.status === "running") ?? -1;
    const currentSubtask =
      currentSubtaskIndex >= 0
        ? planStatus?.subtasks[currentSubtaskIndex]
        : undefined;

    // If planner assigned an explicit profile, use it. Otherwise infer one
    // from the active step so inline-edit tasks do not fall back to an overly
    // broad DOM-aware tool set.
    const explicitProfile = isToolProfileName(currentSubtask?.toolProfile)
      ? currentSubtask.toolProfile
      : undefined;
    const inferredProfile =
      !explicitProfile && currentSubtask
        ? inferToolProfileForStep(
            currentSubtask.description,
            this.planSteps[currentSubtaskIndex]?.successCriteria || "",
          )
        : undefined;
    const activeProfile = resolveSkillToolProfile(
      this.selectedSkillId,
      currentSubtask?.description ?? this.originalQuery,
      this.planSteps[currentSubtaskIndex]?.successCriteria || "",
      explicitProfile ?? inferredProfile,
    );
    if (activeProfile) {
      if (this.turnsOnCurrentStep >= this.limits.stepWarnTurns) {
        this.log.info("agent", "Tool profile widened due to step stagnation", {
          turn: this.turnCount,
          profile: activeProfile,
          turnsOnCurrentStep: this.turnsOnCurrentStep,
          stepWarnTurns: this.limits.stepWarnTurns,
        });
        this.traceRecorder?.recordEvent("tool_profile_widened", {
          turn: this.turnCount,
          profile: activeProfile,
          reason: "step_stagnation",
          turnsOnCurrentStep: this.turnsOnCurrentStep,
        });
        return tools;
      }

      const allowedNames = resolveToolProfile(activeProfile as ToolProfile);
      if (!allowedNames) return tools; // "full" or unknown → no filtering

      const allowedSet = new Set<string>(allowedNames);
      allowedSet.add(ToolName.DONE);
      allowedSet.add(ToolName.ESCALATE);
      allowedSet.add(ToolName.CLARIFY);
      allowedSet.add(ToolName.UPDATE_NOTES);

      const filtered = tools.filter((t) => allowedSet.has(t.function.name));
      this.log.info("agent", "Tool profile applied", {
        turn: this.turnCount,
        profile: activeProfile,
        subtask: currentSubtask?.description,
        source: explicitProfile ? "plan_status" : "step_inference",
        originalToolCount: tools.length,
        filteredToolCount: filtered.length,
      });
      this.traceRecorder?.recordEvent("tool_profile_applied", {
        turn: this.turnCount,
        profile: activeProfile,
        source: explicitProfile ? "plan_status" : "step_inference",
        originalToolCount: tools.length,
        filteredToolCount: filtered.length,
      });
      return filtered;
    }

    // No explicit profile — use DOM-aware profiling based on current snapshot
    const snapshot = this.context.getSnapshot();
    if (snapshot?.elements) {
      const allowedSet = buildDomAwareProfile(snapshot.elements);
      const filtered = tools.filter((t) =>
        allowedSet.has(t.function.name as ToolName),
      );
      this.log.info("agent", "Tool profile applied", {
        turn: this.turnCount,
        profile: "dom_aware",
        subtask: currentSubtask?.description ?? this.originalQuery,
        source: "dom_snapshot",
        originalToolCount: tools.length,
        filteredToolCount: filtered.length,
      });
      this.traceRecorder?.recordEvent("tool_profile_applied", {
        turn: this.turnCount,
        profile: "dom_aware",
        source: "dom_snapshot",
        originalToolCount: tools.length,
        filteredToolCount: filtered.length,
      });
      return filtered;
    }

    // No snapshot available — use all tools
    return tools;
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

      // No screenshot available — use element-only fallback
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
            fallbackReason:
              screenshotStatus === "capture_failed"
                ? "capture_failed"
                : "screenshot_unavailable",
            screenshotStatus:
              screenshotStatus === "capture_failed"
                ? "capture_failed"
                : "missing",
          },
          undefined,
          elSummary,
        );
        this.log.info(
          "agent",
          "Perception: screenshot unavailable, using element-only mode",
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
          );
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
    return (
      this.selectedSkillId === "list-detail-review-loop" &&
      requiresBroadListDetailReview(this.originalQuery)
    );
  }

  private isSkillOwnedProcurementLoop(): boolean {
    return this.selectedSkillId === "multi-tab-procurement-loop";
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
      this.isSkillOwnedProcurementLoop()
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
      this.isSkillOwnedProcurementLoop()
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
      this.isSkillOwnedProcurementLoop()
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

    // Build completed steps summary
    const completedSteps = this.planSubtasks
      .map((s, i) => ({
        index: i,
        objective: s.description,
        result: s.result,
      }))
      .filter((s) => this.planSubtasks[s.index].status === "completed");

    const failedStep = {
      index: runningIdx,
      objective: stuckStepGoal,
    };

    // Call the planner to replan (temporarily — no model switch needed, planner has its own LLM)
    const replanResult = await this.planner.replanFrom(
      this.originalQuery,
      completedSteps,
      failedStep,
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

    // Clear history and inject fresh context with the new plan
    this.context.clearHistory();
    this.context.addMessage({
      role: "user",
      content: this.originalQuery,
    });
    this.context.addMessage({
      role: "user",
      content:
        `[Plan Revised]: Step ${runningIdx + 1} was stuck. New plan:\n` +
        replanResult.newSteps
          .map((s, i) => `${runningIdx + i + 1}. ${s.objective}`)
          .join("\n") +
        `\n\nReason: ${replanResult.reason}\n` +
        `Execute step ${runningIdx + 1} now.`,
    });

    // Reset step tracking for the new step
    this.turnsOnCurrentStep = 0;
    this.escalationsOnCurrentStep = 0;
    this.lastPlanIndex = runningIdx;

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
      getLoadedSkillContract(this.selectedSkillId ?? undefined)
        ?.requiredEvidenceTypes ?? [];
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
      this.escalationsOnCurrentStep = 0;
      this.stepRetryCount = 0;
      this.mutationLedger.clearStepLedger();
    }
    return advancedTo;
  }

  /**
   * Complete exactly one plan subtask and move the running pointer forward.
   * This is safer than walking all subtasks when advancement is triggered by
   * local structural evidence from the current page.
   */
  private completeSingleSubtask(currentIndex: number): number {
    if (currentIndex < 0 || currentIndex >= this.planSubtasks.length) {
      return currentIndex;
    }

    const target = this.planSubtasks[currentIndex];
    if (target.status !== "completed") {
      target.status = "completed";
      target.result = target.result || this.captureSubtaskResult();
      target.completedAtUrl = this.context.getCurrentUrl() || undefined;
    }

    for (let i = currentIndex + 1; i < this.planSubtasks.length; i++) {
      if (this.planSubtasks[i].status !== "completed") {
        this.planSubtasks[i].status = "pending";
      }
    }

    const nextIndex = this.planSubtasks.findIndex(
      (subtask, idx) => idx > currentIndex && subtask.status !== "completed",
    );
    if (nextIndex >= 0) {
      this.planSubtasks[nextIndex].status = "running";
    }

    const resolvedIndex = nextIndex >= 0 ? nextIndex : this.planSubtasks.length;

    if (resolvedIndex !== this.lastPlanIndex) {
      this.lastPlanIndex = resolvedIndex;
      this.perception.invalidateCache();
      this.turnsOnCurrentStep = 0;
      this.escalationsOnCurrentStep = 0;
      this.mutationLedger.clearReplayState();
    }

    return resolvedIndex;
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
    const newIdx = this.completeSingleSubtask(fromStep);
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
    this.broadcast({
      type: "TASK_PROGRESS",
      payload: {
        taskId: this.taskId,
        subtasks: this.planSubtasks,
        currentIndex: newIdx,
        totalTurnsUsed: this.turnCount,
      },
    });
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

  private hasTrustedServiceNowSubmitIntent(): boolean {
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
    return (
      this.selectedSkillId === "servicenow-record-form" &&
      /\bObjective:\s*Complete the workflow for the original request\b/i.test(
        this.originalQuery,
      )
    );
  }

  private async maybeRunAtomicSkillController(
    tabId: number,
  ): Promise<LoopResult | null> {
    const contract = getLoadedSkillContract(this.selectedSkillId ?? undefined);
    if (!contract?.atomic) return null;
    if (this.getMissingRequiredEvidenceTypes().length === 0) return null;

    const preferredTool = contract.preferredTools
      ?.map((tool) => tool as ToolName)
      .find((tool) => tool !== ToolName.DONE && tool !== ToolName.READ_PAGE);
    if (!preferredTool) return null;

    const fields = extractFieldValuePairs(this.originalQuery);
    if (
      preferredTool === ToolName.CONFIGURE_SERVICENOW_FORM &&
      fields.length === 0
    ) {
      return null;
    }

    const args: Record<string, unknown> =
      preferredTool === ToolName.CONFIGURE_SERVICENOW_FORM
        ? { fields, submit: this.hasTrustedServiceNowSubmitIntent(), submitButton: "Submit" }
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

    const summary =
      this.evidenceAccumulator
        .getByType("record_identity_observed")
        .at(-1)?.detail?.recordNumber?.toString() ||
      result.split("\n").find((line) => /submitted|configured/i.test(line)) ||
      `${contract.name} completed with required evidence.`;
    const finalSummary = /completed|submitted|configured/i.test(summary)
      ? summary
      : `${contract.name} completed: ${summary}`;
    this.completedResult = { outcome: "completed", summary: finalSummary };
    this.statusHandler(AgentStatus.IDLE, "Done");
    this.messageHandler(finalSummary, []);
    this.saveTurnCheckpoint().catch(() => {});
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
      fieldCount: Array.isArray(traceArgs.fields)
        ? traceArgs.fields.length
        : 0,
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
    if (!this.hasTrustedServiceNowSubmitIntent()) return null;

    const fields = extractFieldValuePairs(this.originalQuery);
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
      const fill = await this.executeServiceNowRecordControllerTool({
        tabId,
        args: fillArgs,
        label: "Configure ServiceNow form",
        eventName: "servicenow_record_controller_fill_started",
      });
      const fillSignal = detectTrustedFormFillStepCompletion({
        toolName: ToolName.CONFIGURE_SERVICENOW_FORM,
        toolArgs: fillArgs,
        toolResult: fill.result,
      });
      if (!fill.ok || !fillSignal) {
        this.traceRecorder?.recordEvent("servicenow_record_controller_deferred", {
          turn: this.turnCount,
          phase: "fill",
          reason: fill.ok ? "untrusted_fill_result" : "tool_error",
        });
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
              reason: refill.ok ? "untrusted_refill_result" : "refill_tool_error",
            },
          );
        }
      }
      if (!submit.ok || !completion) {
        this.traceRecorder?.recordEvent("servicenow_record_controller_deferred", {
          turn: this.turnCount,
          phase: "submit",
          reason: submit.ok ? "untrusted_submit_result" : "tool_error",
        });
        this.context.addMessage({
          role: "user",
          content:
            "The ServiceNow record form controller filled the requested fields but did not get trusted submit evidence. Verify validation errors or submit the form with configure_servicenow_form({ submit: true }).",
        });
        return null;
      }

      const summary = completion.finalSummary;
      this.completedResult = { outcome: "completed", summary };
      this.statusHandler(AgentStatus.IDLE, "Done");
      this.messageHandler(summary, []);
      this.saveTurnCheckpoint().catch(() => {});
      this.traceRecorder?.recordEvent("servicenow_record_controller_completed", {
        turn: this.turnCount,
        summary,
      });

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
    if (!this.hasTrustedServiceNowSubmitIntent()) return false;
    return Boolean(
      detectTrustedFormFillStepCompletion({
        toolName: params.toolName,
        toolArgs: params.toolArgs,
        toolResult: params.toolResult,
      }),
    );
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
        !this.hasTrustedServiceNowSubmitIntent()
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
    const newIndex = this.completeRemainingSubtasks(fromStep, signal.reason);
    this.syncPlanStatus(newIndex, "trusted_form_submit_success", {
      reason: signal.reason,
      matchedTokens: signal.matchedTokens,
      submittedRecord: signal.submittedRecord,
      advancedTo: newIndex,
      mode: params.mode,
      trustedTool: params.toolName,
    });
    if (this.taskId) {
      this.broadcast({
        type: "TASK_PROGRESS",
        payload: {
          taskId: this.taskId,
          subtasks: this.planSubtasks,
          currentIndex: newIndex,
          totalTurnsUsed: this.turnCount,
        },
      });
    }
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

  private completeRemainingSubtasks(
    currentIndex: number,
    result: string,
  ): number {
    if (currentIndex < 0 || currentIndex >= this.planSubtasks.length) {
      return currentIndex;
    }

    for (let i = currentIndex; i < this.planSubtasks.length; i++) {
      const subtask = this.planSubtasks[i];
      subtask.status = "completed";
      subtask.result = subtask.result || result;
      subtask.completedAtUrl = this.context.getCurrentUrl() || undefined;
    }

    const resolvedIndex = this.planSubtasks.length;
    if (resolvedIndex !== this.lastPlanIndex) {
      this.lastPlanIndex = resolvedIndex;
      this.perception.invalidateCache();
      this.turnsOnCurrentStep = 0;
      this.escalationsOnCurrentStep = 0;
      this.mutationLedger.clearReplayState();
    }

    return resolvedIndex;
  }

  private completeSubmitFormReset(
    currentIndex: number,
    signal: NonNullable<ReturnType<typeof detectFormSubmissionResetSuccess>>,
  ): { finalSummary: string; newIndex: number } {
    const newIndex = this.completeRemainingSubtasks(
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
    if (this.taskId) {
      this.broadcast({
        type: "TASK_PROGRESS",
        payload: {
          taskId: this.taskId,
          subtasks: this.planSubtasks,
          currentIndex: newIndex,
          totalTurnsUsed: this.turnCount,
        },
      });
    }
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
      /\b(submit|submission|confirm|confirmation|complete|completed|success|sent|saved|applied|placed)\b/i.test(
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

    const procurementIntent =
      this.selectedSkillId === "multi-tab-procurement-loop" ||
      /\b(procurement|purchase|buy)\b/i.test(taskContext);
    if (procurementIntent) {
      const summaryShowsPurchase =
        /\b(purchase|purchased|order|ordered|confirmed|bought|place(?:d)? order)\b/i.test(
          summaryText,
        );
      const summaryShowsChecklistReturn =
        /\b(check(?:ed|ing)? off|mark(?:ed|ing)? .* (?:done|complete)|returned? to .* (?:list|checklist|procurement)|back on .* (?:list|checklist|procurement))\b/i.test(
          summaryText,
        );
      const checklistLooksComplete =
        /\b\d+\s+of\s+\d+\s+items?\s+completed\b/i.test(snapshotText) ||
        /\b(mark .* as done|all items procured)\b/i.test(snapshotText);

      if (
        summaryShowsPurchase &&
        summaryShowsChecklistReturn &&
        checklistLooksComplete
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
    const subtask = this.planSubtasks[stepIndex];
    if (!subtask) return undefined;
    const explicitProfile = subtask.toolProfile;
    if (explicitProfile && resolveToolProfile(explicitProfile as ToolProfile)) {
      return resolveSkillToolProfile(
        this.selectedSkillId,
        subtask.description,
        this.planSteps[stepIndex]?.successCriteria || "",
        explicitProfile as ToolProfile,
      );
    }
    const inferredProfile = inferToolProfileForStep(
      subtask.description,
      this.planSteps[stepIndex]?.successCriteria || "",
    );
    return resolveSkillToolProfile(
      this.selectedSkillId,
      subtask.description,
      this.planSteps[stepIndex]?.successCriteria || "",
      inferredProfile,
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

  private retargetInlineEditTextEntry(params: {
    targetId: number;
    currentStepIndex: number;
  }): { retargetedId: number; reason: string } | null {
    const { targetId, currentStepIndex } = params;
    if (this.getActiveToolProfileForStep(currentStepIndex) !== "edit_surface") {
      return null;
    }

    const snapshot = this.context.getSnapshot();
    const target = snapshot?.elements?.find((el) => el.tag === targetId);
    if (!target || isTextLikeInputElement(target)) {
      return null;
    }

    const visibleTextInputs =
      snapshot?.elements?.filter(
        (element) =>
          element.isVisible !== false && isTextLikeInputElement(element),
      ) ?? [];
    if (visibleTextInputs.length === 0) {
      return null;
    }

    const targetText = normalizeGuardText(target.text);
    const retarget =
      visibleTextInputs.find((element) =>
        rectsLikelyOverlap(target.rect, element.rect),
      ) ??
      visibleTextInputs.find((element) => {
        const liveValue = normalizeGuardText(
          element.attributes.value || element.text,
        );
        return Boolean(targetText) && liveValue === targetText;
      });
    if (!retarget) {
      return null;
    }

    return {
      retargetedId: retarget.tag,
      reason:
        `Retargeted type_text from [${targetId}] to the active inline editor ` +
        `[${retarget.tag}] for this edit-surface step.`,
    };
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
    const recentOutcomes: { fingerprint: string; snapshotFp: string }[] = [];

    // Cumulative failure brief: tracks tool attempts for failure synthesis
    const subgoalAttempts: SubgoalAttempt[] = [];

    while (this.isRunning && this.turnCount < this.maxTurns) {
      // Pause gate — block here if user paused the loop
      if (this.pauseGate) await this.pauseGate.promise;
      this.throwIfGracefulStopRequested();
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

      // Clear idempotency cache unless a done() was just rejected (prevents re-execution of
      // actions that already succeeded). Normal turns clear it so legitimate repeated clicks work.
      if (!this.guardAfterDoneRejection) {
        this.mutationLedger.clearEphemeral();
      }
      this.guardAfterDoneRejection = false;

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

      // 1. LLM Inference (streamed)
      // `let` because retry loop may append diagnostic hints (cleaned up after)
      let messages = this.context.getPrompt();
      const allTools = toolRegistry.getDefinitions(this.disabledTools);
      // Apply plan/DOM filtering first, then skill-based ranking within the surviving set.
      const tools = this.applySkillToolRanking(
        this.applySkillToolSuppression(this.applyToolProfile(allTools)),
      );

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
          const perceptionMeta = this.perception.getLastTraceMeta();
          await this.traceRecorder.recordPerception(
            {
              interpretation: this.perception.getInterpretation()!,
              model: "google/gemini-2.5-flash",
              durationMs: 0,
              cached: false,
              ...perceptionMeta,
            },
            this.perception.getLastScreenshot() || undefined,
            elSummary,
            this.perception.getPanoramicShots() || undefined,
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

      // ── LLM call with bounded retry loop ──
      // Retries hallucinations, network errors, and empty responses up to MAX_TURN_RETRIES.
      // Non-retryable errors (user abort, 402, bad request) exit immediately.
      const llmStart = Date.now();
      let response: CompletionResponse;
      let turnRetryCount = 0;

      // eslint-disable-next-line no-constant-condition
      retryLoop: while (true) {
        // Reset per-attempt streaming state
        streamedTextAccumulator = "";
        hallucinationDetected = false;

        // Per-turn AbortController: allows aborting just this turn (e.g. on hallucination)
        // while keeping the main loop alive. Recreated on each retry attempt.
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

          // Check for empty response (retryable)
          if (
            !response.content &&
            (!response.tool_calls || response.tool_calls.length === 0)
          ) {
            const switchedToFallback =
              !this.llm.isPlannerTier() &&
              this.llm.activateExecutorFallback("empty_response");
            if (switchedToFallback) {
              turnRetryCount++;
              this.log.warn(
                "agent",
                "Empty LLM response, switching to executor fallback model",
                {
                  turn: this.turnCount,
                  retry: turnRetryCount,
                  fallbackModel: this.llm.getCurrentModel(),
                },
              );
              this.broadcast({
                type: "STREAM_CHUNK",
                payload: { delta: "", done: false, replaceContent: "" },
              });
              this.stepHandler(
                {
                  id: crypto.randomUUID(),
                  type: "info",
                  label: `Retrying with fallback model (${turnRetryCount}/${MAX_TURN_RETRIES})...`,
                  status: "running",
                  timestamp: Date.now(),
                },
                false,
              );
              this.traceRecorder?.recordEvent(
                "executor_empty_response_fallback",
                {
                  turn: this.turnCount,
                  retry: turnRetryCount,
                  model: this.llm.getCurrentModel(),
                },
              );
              const backoff = TURN_RETRY_BACKOFF_MS[turnRetryCount - 1] ?? 500;
              if (backoff > 0) await new Promise((r) => setTimeout(r, backoff));
              this.abortController?.signal.removeEventListener(
                "abort",
                onMainAbort,
              );
              continue retryLoop;
            }
            if (
              turnRetryCount < MAX_TURN_RETRIES &&
              RETRYABLE_ERRORS.has("empty_response")
            ) {
              turnRetryCount++;
              this.log.warn("agent", "Empty LLM response, retrying", {
                turn: this.turnCount,
                retry: turnRetryCount,
              });
              this.broadcast({
                type: "STREAM_CHUNK",
                payload: { delta: "", done: false, replaceContent: "" },
              });
              this.stepHandler(
                {
                  id: crypto.randomUUID(),
                  type: "info",
                  label: `Retrying (${turnRetryCount}/${MAX_TURN_RETRIES})...`,
                  status: "running",
                  timestamp: Date.now(),
                },
                false,
              );
              this.traceRecorder?.recordEvent("turn_retry", {
                turn: this.turnCount,
                retry: turnRetryCount,
                errorClass: "empty_response",
              });
              const backoff = TURN_RETRY_BACKOFF_MS[turnRetryCount - 1] ?? 500;
              if (backoff > 0) await new Promise((r) => setTimeout(r, backoff));
              this.abortController?.signal.removeEventListener(
                "abort",
                onMainAbort,
              );
              continue retryLoop;
            }
          }

          // Success — exit retry loop
          this.abortController?.signal.removeEventListener(
            "abort",
            onMainAbort,
          );
          // Reset fallback to primary model after a successful response
          this.llm.resetExecutorFallback();
          break;
        } catch (llmError: any) {
          // Always clean up the main abort listener
          this.abortController?.signal.removeEventListener(
            "abort",
            onMainAbort,
          );

          const errorClass = classifyTurnError(llmError, hallucinationDetected);

          // Non-retryable: user abort — propagate immediately
          if (errorClass === "user_abort" && !hallucinationDetected) {
            throw llmError;
          }

          // Non-retryable: insufficient credits
          if (errorClass === "credits_exhausted") {
            const providerId = this.llm.getActiveProviderInfo().providerId;
            const providerName = formatProviderName(providerId);
            const creditsUrl = getProviderCreditsUrl(providerId);
            const msg =
              `Your ${providerName} account has insufficient credits.` +
              (creditsUrl
                ? ` Please add credits at ${creditsUrl} and try again.`
                : "");
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
              summary: `Insufficient ${providerName} credits`,
              failure: {
                category: "provider" as const,
                code: "credits_exhausted",
                detail: `HTTP 402 from ${providerName}`,
              },
              metrics: this.getMetrics(),
            };
          }

          // Retryable errors: hallucination, network
          if (
            turnRetryCount < MAX_TURN_RETRIES &&
            RETRYABLE_ERRORS.has(errorClass)
          ) {
            turnRetryCount++;
            this.log.warn("agent", `Turn error (${errorClass}), retrying`, {
              turn: this.turnCount,
              retry: turnRetryCount,
            });

            // Clear any garbage streamed to UI
            this.broadcast({
              type: "STREAM_CHUNK",
              payload: { delta: "", done: false, replaceContent: "" },
            });

            // Show retry step in timeline
            this.stepHandler(
              {
                id: crypto.randomUUID(),
                type: "info",
                label: `Retrying (${turnRetryCount}/${MAX_TURN_RETRIES})...`,
                status: "running",
                timestamp: Date.now(),
              },
              false,
            );

            this.traceRecorder?.recordEvent("turn_retry", {
              turn: this.turnCount,
              retry: turnRetryCount,
              errorClass,
            });

            // Inject diagnostic hint for hallucination retries
            if (errorClass === "hallucination") {
              this.traceRecorder?.recordEvent("hallucination_detected", {
                turn: this.turnCount,
                textLen: streamedTextAccumulator.length,
              });
              messages = [
                ...messages,
                {
                  role: "user" as const,
                  content:
                    "[System] Your previous response contained raw JSON instead of a proper tool call. " +
                    "Use the tool_calls API to invoke tools. Do not emit JSON as text.",
                },
              ];
            }

            // Invalidate perception cache (force fresh observation on retry)
            this.perception.invalidateCache();

            const backoff = TURN_RETRY_BACKOFF_MS[turnRetryCount - 1] ?? 500;
            if (backoff > 0) await new Promise((r) => setTimeout(r, backoff));
            continue retryLoop;
          }

          // Retries exhausted for hallucination — fall through with synthesized response
          if (hallucinationDetected) {
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
            break;
          }

          throw llmError;
        }
      } // end retryLoop

      // Clean up diagnostic hints injected during retries (don't pollute history)
      if (turnRetryCount > 0) {
        messages = messages.filter(
          (m) =>
            !(
              m.role === "user" &&
              typeof m.content === "string" &&
              m.content.startsWith("[System] Your previous response")
            ),
        );
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

      // Fix 2: Empty Response Circuit Breaker
      // After retry loop exhausts, a truly empty response (no content AND no tool_calls)
      // should exit immediately rather than degrading through the text-only flow.
      if (
        !rawContent &&
        (!response.tool_calls || response.tool_calls.length === 0)
      ) {
        this.log.error("agent", "Empty response after retries exhausted", {
          turn: this.turnCount,
        });
        this.traceRecorder?.recordEvent("empty_response_circuit_breaker", {
          turn: this.turnCount,
        });
        const errorMsg = "AI provider returned an empty response. Try again.";
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: errorMsg, done: false },
        });
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: true },
        });
        this.statusHandler(AgentStatus.ERROR, "Empty response from provider");
        await this.traceRecorder?.endTurn();
        return {
          outcome: "error" as const,
          turnCount: this.turnCount,
          summary: "AI provider returned an empty response",
          failure: {
            category: "provider" as const,
            code: "empty_response",
            detail: `Turn ${this.turnCount}: no content and no tool_calls after retry loop`,
          },
          metrics: this.getMetrics(),
        };
      }

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
      let toolsRecoveredFromText = false;
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
          toolsRecoveredFromText = true;
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
        this.throwIfGracefulStopRequested();

        // Blind Tool Call Guard — nudge when tool calls arrive with no reasoning.
        // Skip for text-recovered tool calls: the model DID produce text, it was just JSON.
        // Skip when model emitted think tags: reasoning IS present, just in <think> blocks
        // (Qwen3, DeepSeek, etc. put all reasoning in think tags before tool calls).
        // Only nudge (no forced escalation) — stagnation monitor and dead-end
        // detection handle actual stuck loops. Forced escalation caused
        // escalate→de-escalate loops with models that naturally omit reasoning.
        const hadThinking = rawContent
          ? extractThinkContent(rawContent) !== null
          : false;
        if (!cleanContent && !toolsRecoveredFromText && !hadThinking) {
          consecutiveBlindToolTurns++;
          if (consecutiveBlindToolTurns === 3) {
            this.log.warn(
              "agent",
              "Blind tool calls: 3 consecutive turns with no reasoning",
              {
                turn: this.turnCount,
              },
            );
            this.traceRecorder?.recordEvent("blind_tool_call_nudge", {
              turn: this.turnCount,
              consecutive: consecutiveBlindToolTurns,
            });
            this.context.addMessage({
              role: "user",
              content:
                "WARNING: You have made 3 consecutive tool calls with no reasoning. " +
                "Include your Think step before calling tools — state what you observe, your plan, and why this action.",
            });
          } else if (
            consecutiveBlindToolTurns > 0 &&
            consecutiveBlindToolTurns % 6 === 0
          ) {
            // Repeat the nudge every 6 blind turns (no escalation)
            this.log.warn("agent", "Blind tool calls: repeating nudge", {
              turn: this.turnCount,
              consecutive: consecutiveBlindToolTurns,
            });
            this.context.addMessage({
              role: "user",
              content:
                "REMINDER: Include reasoning text before tool calls. Explain what you see and your plan.",
            });
          }
        } else {
          consecutiveBlindToolTurns = 0;
        }

        const firstToolName = response.tool_calls[0].function.name;
        this.statusHandler(AgentStatus.ACTING, `Executing ${firstToolName}...`);

        // Keep the streaming message open across tool-calling turns.
        // The stream is finalized when done() is called (with replaceContent)
        // or when the loop exits (by the orchestrator or exit-path handlers).

        // Execute Tools
        let doneSignaled = false;
        let domModified = false;
        let visuallyModified = false;
        let lastDomAffectingToolName: string | null = null;
        this.lastDomStep = null;
        this.context.setLastActionOutcome(null);

        // --- Safety gate: validate tool calls before dispatch ---
        const validated = validateToolCalls(response.tool_calls);
        const blockedCalls = validated.filter((v) => v.blocked);
        const auditedCalls = validated.filter((v) => v.auditFlag);
        for (const a of auditedCalls) {
          this.traceRecorder?.recordEvent("safety_gate_audit", {
            tool: a.original.function.name,
            flag: a.auditFlag ?? "unknown",
            phase: "output",
          });
        }
        const allowedToolCalls = validated
          .filter((v) => !v.blocked)
          .map((v) => v.original);

        response.tool_calls = allowedToolCalls;

        // Use the model's original allowed batch shape for workflow redirect telemetry.
        // After a redirect, collapse the allowed batch to the single corrected
        // navigation action so follow-on calls cannot run against the wrong page.
        const originalHasSequentialTool = response.tool_calls.some((tc) =>
          SEQUENTIAL_TOOLS.has(tc.function.name as ToolName),
        );
        const originalHasHighRiskTool = response.tool_calls.some((tc) => {
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
        const originalHasDomModifyingTool = response.tool_calls.some((tc) =>
          DOM_MODIFYING_TOOLS.has(tc.function.name as ToolName),
        );
        const originalCanParallelize =
          !originalHasSequentialTool &&
          !originalHasHighRiskTool &&
          !originalHasDomModifyingTool &&
          response.tool_calls.length > 1;
        const workflowRedirectMode = originalCanParallelize
          ? "parallel"
          : "sequential";
        for (const toolCall of response.tool_calls) {
          if (
            this.rewriteListDetailWorkflowToolCall(
              toolCall,
              workflowRedirectMode,
            )
          ) {
            response.tool_calls = [toolCall];
            break;
          }
        }

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
            reason: b.reason ?? "unknown",
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
          this.throwIfGracefulStopRequested();
          // PARALLEL EXECUTION
          const results = await Promise.all(
            response.tool_calls.map(async (toolCall) => {
              const toolName = toolCall.function.name as ToolName;
              const rawArgsKey = toolCall.function.arguments.slice(0, 100);
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(toolCall.function.arguments);
              } catch {
                // Registry will handle parse error on execute
              }
              const argsKey = actionMemoryKey(
                toolName,
                args,
                rawArgsKey,
                this.context.getSnapshot(),
              );
              this.recordSkillToolSelection(toolName, "parallel");

              const repeatActionExempt =
                isListDetailReturnControlRepeatExempt({
                  selectedSkillId: this.selectedSkillId,
                  toolName,
                  args,
                  snapshot: this.context.getSnapshot(),
                }) ||
                (this.selectedSkillId === "multi-tab-procurement-loop" &&
                  toolName === ToolName.SWITCH_TAB);
              if (shouldTrackRepeatAction(toolName) && !repeatActionExempt) {
                const priorRepeatCount = recentToolCalls.filter(
                  (entry) =>
                    entry.tool === toolName && entry.argsKey === argsKey,
                ).length;
                if (priorRepeatCount >= 2) {
                  const finalClickBypass =
                    !verifiedFinalClickBypassKeys.has(argsKey) &&
                    hasRecentExactTextFieldRead(this.context.getMessages()) &&
                    isFinalCommunicationClick({
                      selectedSkillId: this.selectedSkillId,
                      toolName,
                      args,
                      snapshot: this.context.getSnapshot(),
                      originalQuery: this.originalQuery,
                    });
                  if (finalClickBypass) {
                    verifiedFinalClickBypassKeys.add(argsKey);
                    this.log.info(
                      "agent",
                      "Repeat final communication click allowed after exact draft read",
                      {
                        turn: this.turnCount,
                        tool: toolName,
                        mode: "parallel",
                      },
                    );
                    this.traceRecorder?.recordEvent(
                      "repeat_final_click_allowed",
                      {
                        turn: this.turnCount,
                        tool: toolName,
                        mode: "parallel",
                      },
                    );
                  } else {
                    const repeatCount = priorRepeatCount + 1;
                    const blockMsg =
                      `BLOCKED: You already called ${toolName} with the same arguments ${repeatCount} times in recent turns. ` +
                      `This is cycling. Try a fundamentally different action or call escalate({"reason": "Repeated ${toolName} without progress"})`;
                    this.log.warn("agent", "Repeat action blocked", {
                      turn: this.turnCount,
                      tool: toolName,
                      repeatCount,
                      mode: "parallel",
                    });
                    this.traceRecorder?.recordEvent("repeat_action_blocked", {
                      turn: this.turnCount,
                      tool: toolName,
                      repeatCount,
                      mode: "parallel",
                    });
                    return { toolCall, result: blockMsg, error: null };
                  }
                }
                recentToolCalls.push({ tool: toolName, argsKey });
                if (recentToolCalls.length > REPEAT_ACTION_WINDOW) {
                  recentToolCalls.shift();
                }
              }

              // read_element same-ID nudge (parallel path)
              if (toolName === ToolName.READ_ELEMENT) {
                const elemId =
                  typeof args.id === "number" ? args.id : Number(args.id);
                if (elemId === lastReadElementId) {
                  consecutiveReadElementSameId++;
                  if (consecutiveReadElementSameId >= 2) {
                    const nudgeMsg =
                      `You have called read_element on element [${elemId}] ${consecutiveReadElementSameId + 1} times. ` +
                      `Try a different approach: click_element to interact with it, read_page for full page context, or find_element to locate a different target.`;
                    this.log.warn("agent", "read_element same-ID nudge", {
                      turn: this.turnCount,
                      elementId: elemId,
                      consecutive: consecutiveReadElementSameId + 1,
                    });
                    this.traceRecorder?.recordEvent(
                      "read_element_same_id_nudge",
                      {
                        elementId: elemId,
                        consecutive: consecutiveReadElementSameId + 1,
                      },
                    );
                    return { toolCall, result: nudgeMsg, error: null };
                  }
                } else {
                  lastReadElementId = elemId;
                  consecutiveReadElementSameId = 0;
                }
              } else {
                lastReadElementId = null;
                consecutiveReadElementSameId = 0;
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
                discoveredTagIds,
              );
              if (idError) {
                this.log.warn("agent", "Invalid element ID pre-dispatch", {
                  turn: this.turnCount,
                  tool: toolName,
                  args: JSON.stringify(args).slice(0, 100),
                  mode: "parallel",
                });
                this.traceRecorder?.recordEvent("grounding_mismatch", {
                  turn: this.turnCount,
                  toolName,
                  requestedId:
                    typeof args.id === "number"
                      ? args.id
                      : (args.sourceId ?? args.targetId ?? null),
                  currentUrl: this.context.getCurrentUrl(),
                  reason: "invalid_element_id_pre_dispatch",
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

              const currentSnapshot = this.context.getSnapshot();
              const visibleDetailActionCount =
                countVisibleListDetailActions(currentSnapshot);
              if (
                visibleDetailActionCount > this.listDetailVisibleActionCount
              ) {
                this.listDetailVisibleActionCount = visibleDetailActionCount;
              }
              const listDetailWorkflowBlock = getListDetailWorkflowBlock({
                selectedSkillId: this.selectedSkillId,
                query: this.originalQuery,
                toolName,
                args,
                snapshot: currentSnapshot,
                reviewedTargets: this.listDetailReviewedTargets,
                openedTargets: this.listDetailOpenedTargets,
                visibleDetailActionCount: this.listDetailVisibleActionCount,
              });
              if (listDetailWorkflowBlock) {
                this.log.warn("agent", "List-detail workflow tool blocked", {
                  turn: this.turnCount,
                  tool: toolName,
                  mode: "parallel",
                });
                this.traceRecorder?.recordEvent(
                  "list_detail_workflow_tool_blocked",
                  {
                    turn: this.turnCount,
                    tool: toolName,
                    mode: "parallel",
                    openedDetailCount: this.listDetailOpenedTargets.size,
                    reviewedDetailCount: this.listDetailReviewedTargets.size,
                    visibleDetailActionCount: this.listDetailVisibleActionCount,
                  },
                );
                return {
                  toolCall,
                  result: listDetailWorkflowBlock,
                  error: null,
                };
              }

              if (
                toolName === ToolName.TYPE_TEXT &&
                typeof args.id === "number" &&
                typeof args.text === "string"
              ) {
                const planStatus = this.context.getPlanStatusRaw();
                const currentStepIndex = planStatus?.currentIndex ?? -1;
                const inlineRetarget = this.retargetInlineEditTextEntry({
                  targetId: args.id,
                  currentStepIndex,
                });
                if (inlineRetarget) {
                  args.id = inlineRetarget.retargetedId;
                  toolCall.function.arguments = JSON.stringify(args);
                  this.context.addMessage({
                    role: "user",
                    content: inlineRetarget.reason,
                  });
                }
                const snapshot = this.context.getSnapshot();
                const target = snapshot?.elements.find(
                  (el) => el.tag === args.id,
                );
                const activeObjective =
                  planStatus?.subtasks[currentStepIndex]?.description ??
                  this.originalQuery;
                const targetError = validateTextEntryTarget(
                  activeObjective,
                  target,
                  args.text,
                );
                if (targetError) {
                  this.log.warn("agent", "Text entry target blocked", {
                    turn: this.turnCount,
                    tool: toolName,
                    id: args.id,
                    mode: "parallel",
                  });
                  return { toolCall, result: null, error: targetError };
                }
              }

              if (
                toolName === ToolName.CLICK_ELEMENT &&
                typeof args.id === "number"
              ) {
                const snapshot = this.context.getSnapshot();
                const target = snapshot?.elements.find(
                  (el) => el.tag === args.id,
                );
                const planStatus = this.context.getPlanStatusRaw();
                const activeObjective =
                  planStatus?.subtasks[planStatus.currentIndex]?.description ??
                  this.originalQuery;
                const explicitValue = extractExplicitInputValueForElement(
                  activeObjective,
                  target,
                );
                if (isTextLikeInputElement(target) && explicitValue) {
                  const blockReason =
                    `Error: This step requires entering "${explicitValue}" into [${args.id}]. ` +
                    `Use type_text instead of click_element on this input.`;
                  this.log.warn("agent", "Text entry click blocked", {
                    turn: this.turnCount,
                    tool: toolName,
                    id: args.id,
                    explicitValue,
                    mode: "parallel",
                  });
                  return { toolCall, result: null, error: blockReason };
                }
              }

              if (
                toolName === ToolName.CLICK_ELEMENT ||
                toolName === ToolName.CREATE_TAB ||
                toolName === ToolName.RIGHT_CLICK
              ) {
                const workflowRedirect = await this.getWorkflowTabToolRedirect({
                  toolName,
                  args,
                  currentTabId: tabId,
                });
                if (workflowRedirect) {
                  this.log.info(
                    "agent",
                    "Workflow tab controller redirected tool call",
                    {
                      turn: this.turnCount,
                      tool: toolName,
                      mode: "parallel",
                      skillId: this.selectedSkillId,
                    },
                  );
                  return {
                    toolCall,
                    result: workflowRedirect,
                    error: null,
                  };
                }
              }

              let autocompleteRewriteReason: string | null = null;
              if (toolName === ToolName.TYPE_TEXT && args.id != null) {
                const snapshot = this.context.getSnapshot();
                const targetId = Number(args.id);
                const target = Number.isFinite(targetId)
                  ? snapshot?.elements.find((el) => el.tag === targetId)
                  : null;
                const planStatus = this.context.getPlanStatusRaw();
                const activeObjective =
                  planStatus?.subtasks[planStatus.currentIndex]?.description ??
                  this.originalQuery;
                const rewrite = rewriteAutocompleteTextEntry({
                  objectiveText: activeObjective,
                  originalQuery: this.originalQuery,
                  element: target,
                  typedText: String(args.text || ""),
                });
                if (rewrite) {
                  args.text = rewrite.rewrittenText;
                  toolCall.function.arguments = JSON.stringify(args);
                  autocompleteRewriteReason = rewrite.reason;
                }
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
                const preActionSnapshot = this.context.getSnapshot();
                let result = await this.executeToolCall(toolCall, tabId);
                if (autocompleteRewriteReason) {
                  result = `${result}\n${autocompleteRewriteReason}`;
                }
                this.trackListDetailToolSuccess(
                  toolName,
                  args,
                  preActionSnapshot,
                );
                const toolMs = Date.now() - toolStep.timestamp;
                // Track tag IDs discovered by find_element
                for (const id of extractDiscoveredTagIds(toolName, result)) {
                  discoveredTagIds.add(id);
                }
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
                    lastDomAffectingToolName = toolName;
                  }
                  this.lastDomStep = {
                    ...toolStep,
                    status: "done",
                    durationMs: toolMs,
                  };
                }

                // Track read_page / xray_page for done() content verification guard
                if (
                  toolName === ToolName.READ_PAGE ||
                  toolName === ToolName.XRAY_PAGE
                ) {
                  this.hasReadPage = true;
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
                if (currentSub.verificationGate.action === "advance_step") {
                  this.consecutiveAutoAdvances = 0;
                  const newIdx = this.advanceCompletedSubtasks();
                  this.syncPlanStatus(newIdx, "step_advanced_by_gate", {
                    evidence: gateResult.evidence,
                    mode: "parallel",
                    advancedTo: newIdx,
                  });
                  this.broadcast({
                    type: "TASK_PROGRESS",
                    payload: {
                      taskId: this.taskId!,
                      subtasks: this.planSubtasks,
                      currentIndex: newIdx,
                      totalTurnsUsed: this.turnCount,
                    },
                  });
                  this.context.addMessage({
                    role: "user",
                    content: `STEP ADVANCED: '${gateResult.evidence}' matched. Now on step ${newIdx + 1}.`,
                  });
                } else {
                  this.context.addMessage({
                    role: "user",
                    content: `CHECKPOINT: Gate triggered. Evidence: '${gateResult.evidence}'. Call done() now.`,
                  });
                }
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
            this.throwIfGracefulStopRequested();

            // Parse args for risk classification and done detection
            const toolName = toolCall.function.name as ToolName;
            const rawArgsKey = toolCall.function.arguments.slice(0, 100);
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(toolCall.function.arguments);
            } catch {
              // Registry will handle parse error on execute
            }
            const argsKey = actionMemoryKey(
              toolName,
              args,
              rawArgsKey,
              this.context.getSnapshot(),
            );
            this.recordSkillToolSelection(toolName, "sequential");

            const repeatActionExempt =
              isListDetailReturnControlRepeatExempt({
                selectedSkillId: this.selectedSkillId,
                toolName,
                args,
                snapshot: this.context.getSnapshot(),
              }) ||
              (this.selectedSkillId === "multi-tab-procurement-loop" &&
                toolName === ToolName.SWITCH_TAB);
            if (shouldTrackRepeatAction(toolName) && !repeatActionExempt) {
              const priorRepeatCount = recentToolCalls.filter(
                (entry) => entry.tool === toolName && entry.argsKey === argsKey,
              ).length;
              if (priorRepeatCount >= 2) {
                const finalClickBypass =
                  !verifiedFinalClickBypassKeys.has(argsKey) &&
                  hasRecentExactTextFieldRead(this.context.getMessages()) &&
                  isFinalCommunicationClick({
                    selectedSkillId: this.selectedSkillId,
                    toolName,
                    args,
                    snapshot: this.context.getSnapshot(),
                    originalQuery: this.originalQuery,
                  });
                if (finalClickBypass) {
                  verifiedFinalClickBypassKeys.add(argsKey);
                  this.log.info(
                    "agent",
                    "Repeat final communication click allowed after exact draft read",
                    {
                      turn: this.turnCount,
                      tool: toolName,
                      mode: "sequential",
                    },
                  );
                  this.traceRecorder?.recordEvent(
                    "repeat_final_click_allowed",
                    {
                      turn: this.turnCount,
                      tool: toolName,
                      mode: "sequential",
                    },
                  );
                } else {
                  const repeatCount = priorRepeatCount + 1;
                  const blockMsg =
                    `BLOCKED: You already called ${toolName} with the same arguments ${repeatCount} times in recent turns. ` +
                    `This is cycling. Try a fundamentally different action or call escalate({"reason": "Repeated ${toolName} without progress"})`;
                  this.context.addMessage({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: blockMsg,
                  });
                  this.log.warn("agent", "Repeat action blocked", {
                    turn: this.turnCount,
                    tool: toolName,
                    repeatCount,
                    mode: "sequential",
                  });
                  this.traceRecorder?.recordEvent("repeat_action_blocked", {
                    turn: this.turnCount,
                    tool: toolName,
                    repeatCount,
                    mode: "sequential",
                  });
                  continue;
                }
              }
              recentToolCalls.push({ tool: toolName, argsKey });
              if (recentToolCalls.length > REPEAT_ACTION_WINDOW) {
                recentToolCalls.shift();
              }
            }

            // read_element same-ID nudge (sequential path)
            if (toolName === ToolName.READ_ELEMENT) {
              const elemId =
                typeof args.id === "number" ? args.id : Number(args.id);
              if (elemId === lastReadElementId) {
                consecutiveReadElementSameId++;
                if (consecutiveReadElementSameId >= 2) {
                  const nudgeMsg =
                    `You have called read_element on element [${elemId}] ${consecutiveReadElementSameId + 1} times. ` +
                    `Try a different approach: click_element to interact with it, read_page for full page context, or find_element to locate a different target.`;
                  this.log.warn("agent", "read_element same-ID nudge", {
                    turn: this.turnCount,
                    elementId: elemId,
                    consecutive: consecutiveReadElementSameId + 1,
                  });
                  this.traceRecorder?.recordEvent(
                    "read_element_same_id_nudge",
                    {
                      elementId: elemId,
                      consecutive: consecutiveReadElementSameId + 1,
                    },
                  );
                  this.context.addMessage({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: nudgeMsg,
                  });
                  continue;
                }
              } else {
                lastReadElementId = elemId;
                consecutiveReadElementSameId = 0;
              }
            } else {
              lastReadElementId = null;
              consecutiveReadElementSameId = 0;
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
              discoveredTagIds,
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
              this.traceRecorder?.recordEvent("grounding_mismatch", {
                turn: this.turnCount,
                toolName,
                requestedId:
                  typeof args.id === "number"
                    ? args.id
                    : (args.sourceId ?? args.targetId ?? null),
                currentUrl: this.context.getCurrentUrl(),
                reason: "invalid_element_id_pre_dispatch",
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

            const currentSnapshot = this.context.getSnapshot();
            const visibleDetailActionCount =
              countVisibleListDetailActions(currentSnapshot);
            if (visibleDetailActionCount > this.listDetailVisibleActionCount) {
              this.listDetailVisibleActionCount = visibleDetailActionCount;
            }
            const listDetailWorkflowBlock = getListDetailWorkflowBlock({
              selectedSkillId: this.selectedSkillId,
              query: this.originalQuery,
              toolName,
              args,
              snapshot: currentSnapshot,
              reviewedTargets: this.listDetailReviewedTargets,
              openedTargets: this.listDetailOpenedTargets,
              visibleDetailActionCount: this.listDetailVisibleActionCount,
            });
            if (listDetailWorkflowBlock) {
              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: listDetailWorkflowBlock,
              });
              this.log.warn("agent", "List-detail workflow tool blocked", {
                turn: this.turnCount,
                tool: toolName,
                mode: "sequential",
              });
              this.traceRecorder?.recordEvent(
                "list_detail_workflow_tool_blocked",
                {
                  turn: this.turnCount,
                  tool: toolName,
                  mode: "sequential",
                  openedDetailCount: this.listDetailOpenedTargets.size,
                  reviewedDetailCount: this.listDetailReviewedTargets.size,
                  visibleDetailActionCount: this.listDetailVisibleActionCount,
                },
              );
              continue;
            }

            const planStatus = this.context.getPlanStatusRaw();
            const currentStepIndex = planStatus?.currentIndex ?? -1;
            const inlineVerificationBlock =
              this.getPendingInlineEditVerificationBlock(
                toolName,
                currentStepIndex,
              );
            if (inlineVerificationBlock) {
              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: inlineVerificationBlock,
              });
              this.log.warn("agent", "Inline edit verification required", {
                turn: this.turnCount,
                tool: toolName,
                step: currentStepIndex,
                mode: "sequential",
              });
              continue;
            }

            if (
              toolName === ToolName.TYPE_TEXT &&
              typeof args.id === "number" &&
              typeof args.text === "string"
            ) {
              const planStatus = this.context.getPlanStatusRaw();
              const inlineRetarget = this.retargetInlineEditTextEntry({
                targetId: args.id,
                currentStepIndex,
              });
              if (inlineRetarget) {
                args.id = inlineRetarget.retargetedId;
                toolCall.function.arguments = JSON.stringify(args);
                this.context.addMessage({
                  role: "user",
                  content: inlineRetarget.reason,
                });
              }
              const snapshot = this.context.getSnapshot();
              const target = snapshot?.elements.find(
                (el) => el.tag === args.id,
              );
              const activeObjective =
                planStatus?.subtasks[currentStepIndex]?.description ??
                this.originalQuery;
              const targetError = validateTextEntryTarget(
                activeObjective,
                target,
                args.text,
              );
              if (targetError) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: targetError,
                });
                this.log.warn("agent", "Text entry target blocked", {
                  turn: this.turnCount,
                  tool: toolName,
                  id: args.id,
                  mode: "sequential",
                });
                continue;
              }
            }

            if (
              toolName === ToolName.CLICK_ELEMENT &&
              typeof args.id === "number"
            ) {
              const snapshot = this.context.getSnapshot();
              const target = snapshot?.elements.find(
                (el) => el.tag === args.id,
              );
              const planStatus = this.context.getPlanStatusRaw();
              const activeObjective =
                planStatus?.subtasks[planStatus.currentIndex]?.description ??
                this.originalQuery;
              const explicitValue = extractExplicitInputValueForElement(
                activeObjective,
                target,
              );
              if (isTextLikeInputElement(target) && explicitValue) {
                const blockReason =
                  `Error: This step requires entering "${explicitValue}" into [${args.id}]. ` +
                  `Use type_text instead of click_element on this input.`;
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: blockReason,
                });
                this.log.warn("agent", "Text entry click blocked", {
                  turn: this.turnCount,
                  tool: toolName,
                  id: args.id,
                  explicitValue,
                  mode: "sequential",
                });
                continue;
              }
            }

            if (
              toolName === ToolName.CLICK_ELEMENT ||
              toolName === ToolName.CREATE_TAB ||
              toolName === ToolName.RIGHT_CLICK
            ) {
              const workflowRedirect = await this.getWorkflowTabToolRedirect({
                toolName,
                args,
                currentTabId: tabId,
              });
              if (workflowRedirect) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: workflowRedirect,
                });
                this.log.info(
                  "agent",
                  "Workflow tab controller redirected tool call",
                  {
                    turn: this.turnCount,
                    tool: toolName,
                    mode: "sequential",
                    skillId: this.selectedSkillId,
                  },
                );
                continue;
              }
            }

            let autocompleteRewriteReason: string | null = null;
            if (toolName === ToolName.TYPE_TEXT && args.id != null) {
              const snapshot = this.context.getSnapshot();
              const targetId = Number(args.id);
              const target = Number.isFinite(targetId)
                ? snapshot?.elements.find((el) => el.tag === targetId)
                : null;
              const planStatus = this.context.getPlanStatusRaw();
              const activeObjective =
                planStatus?.subtasks[planStatus.currentIndex]?.description ??
                this.originalQuery;
              const rewrite = rewriteAutocompleteTextEntry({
                objectiveText: activeObjective,
                originalQuery: this.originalQuery,
                element: target,
                typedText: String(args.text || ""),
              });
              if (rewrite) {
                args.text = rewrite.rewrittenText;
                toolCall.function.arguments = JSON.stringify(args);
                autocompleteRewriteReason = rewrite.reason;
              }
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
            const forceJobSubmitApproval =
              this.requiresJobApplicationSubmitApproval(toolName, args);
            if (preDecision.requiresApproval || forceJobSubmitApproval) {
              const approved = await this.ensureToolApproval(
                toolName,
                args,
                preDecision.riskLevel,
                forceJobSubmitApproval,
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
            const shouldArmInlineEditVerification =
              currentStepIndex >= 0 &&
              this.getActiveToolProfileForStep(currentStepIndex) ===
                "edit_surface" &&
              ((toolName === ToolName.PRESS_KEY &&
                typeof args.key === "string" &&
                ["enter", "tab"].includes(String(args.key).toLowerCase()) &&
                this.getUncommittedInlineEditDoneRejection(currentStepIndex) !==
                  null) ||
                (toolName === ToolName.TYPE_TEXT &&
                  args.pressEnter === true &&
                  this.getUncommittedInlineEditDoneRejection(
                    currentStepIndex,
                  ) !== null));
            if (toolName === ToolName.DONE) {
              const summary = (args.summary as string) || "Task completed.";

              // Hard gate: immediately reject done() when max rejections exceeded.
              // Prevents the LLM from burning turns + LLM calls on repeated
              // done() attempts after it's already been told to stop.
              if (this.doneRejections >= this.limits.maxDoneRejections) {
                this.log.warn(
                  "agent",
                  "DONE hard-gated (max rejections exceeded)",
                  {
                    turn: this.turnCount,
                    rejections: this.doneRejections,
                    max: this.limits.maxDoneRejections,
                  },
                );
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content:
                    "done() BLOCKED: You have already exceeded the maximum rejection limit. " +
                    "You MUST take a different action — click a button, type into a field, " +
                    "scroll the page, or call escalate(). Do NOT call done() again.",
                });
                continue;
              }

              // Guard: reject done() on early turns when the summary looks like a question
              // (model is asking for clarification instead of using the clarify tool)
              if (
                this.turnCount <= 2 &&
                isDoneSummaryAskingClarification(summary)
              ) {
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
                  tool_call_id: toolCall.id,
                  content:
                    "done() REJECTED: Your summary is a question, not a completion report. " +
                    "Use the clarify() tool to ask the user a question. " +
                    "Do NOT call done() to ask questions.",
                });
                continue;
              }

              // Done() Content Verification Guard
              // Reject done() if the agent never had access to page content and the page
              // has substantive content — prevents hallucinated summaries from filename/URL alone.
              // NOTE: hasReadPage is pre-set to true in start() when the initial snapshot
              // includes substantive content (system prompt provides it via {{pageContent}}).
              if (
                !this.hasReadPage &&
                (this.taskId ||
                  requiresGroundingReadBeforeDone(this.originalQuery))
              ) {
                const snap = this.context.getSnapshot();
                const elementCount = snap?.elements?.length ?? 0;
                const visibleLen = (
                  snap?.visibleContent ||
                  snap?.pageContent ||
                  ""
                ).length;
                if (elementCount > 5 && visibleLen > 100) {
                  const needsGroundingRead = requiresGroundingReadBeforeDone(
                    this.originalQuery,
                  );
                  this.log.warn(
                    "agent",
                    "DONE rejected: read_page never called on substantive page",
                    {
                      turn: this.turnCount,
                      taskId: this.taskId,
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
                    tool_call_id: toolCall.id,
                    content:
                      "done() REJECTED: Call read_page first to verify actual page content before reporting. " +
                      "Do NOT summarize from the page title or URL alone.",
                  });
                  if (needsGroundingRead) {
                    await this.forceGroundingRefresh(
                      tabId,
                      "done_before_grounding_read",
                    );
                    this.context.addMessage({
                      role: "user",
                      content:
                        'The page has been refreshed for grounding. Use the current page content to answer, then call done({"summary": "..."}).',
                    });
                  }
                  continue;
                }
              }

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
                  tool_call_id: toolCall.id,
                  content:
                    `done() REJECTED: ${incompleteMoneyTableScan}\n\n` +
                    "Do not call done() until the scan is exhaustive.",
                });
                continue;
              }

              const incorrectMoneyTableAnswer =
                this.getIncorrectMoneyTableAggregateDoneRejection(summary);
              if (incorrectMoneyTableAnswer) {
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
                  tool_call_id: toolCall.id,
                  content:
                    `done() REJECTED: ${incorrectMoneyTableAnswer}\n\n` +
                    "Use the tracked aggregate candidate in the final answer.",
                });
                continue;
              }

              // Multi-step early done() guard (works without plan state)
              // If the user's query has numbered steps and the agent has barely
              // started, reject once. Uses doneRejections so maxDoneRejections
              // cap prevents ghost sessions.
              if (
                this.doneRejections === 0 &&
                this.originalQuery &&
                !this.nodeId
              ) {
                const stepCount = countExplicitSteps(this.originalQuery);
                // Activate for queries with 3+ explicit steps where the agent
                // has spent very few turns (turnCount includes planner's ~2 turns,
                // so turnCount <= 3 means the executor ran at most 1 turn)
                if (stepCount >= 3 && this.turnCount <= 3) {
                  this.doneRejections++;
                  this.log.warn(
                    "agent",
                    "DONE rejected: multi-step query, too few turns",
                    {
                      turn: this.turnCount,
                      stepCount,
                      doneRejections: this.doneRejections,
                      summary: summary.slice(0, 150),
                    },
                  );
                  this.traceRecorder?.recordEvent(
                    "done_rejected_early_multistep",
                    {
                      turn: this.turnCount,
                      stepCount,
                    },
                  );
                  this.context.addMessage({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content:
                      `done() REJECTED: The task has ${stepCount} steps but you have only completed the first action. ` +
                      "Continue working through the remaining steps before calling done().",
                  });
                  continue;
                }
              }

              // Multi-return guard: only for root agent (no nodeId).
              // For orchestrator nodes, individual steps handle their own
              // objectives — the task-level final verification in the
              // orchestrator catches multi-return requirements after all
              // nodes complete.
              if (!this.nodeId) {
                let shouldReject = false;
                let rejectReason = "";
                const multiReturnContract = buildTaskContract(
                  this.originalQuery,
                );
                if (
                  (multiReturnContract.multiReturnCount ?? 0) >= 2 &&
                  !shouldReject
                ) {
                  const multiCoverage = assessTaskContractCoverage({
                    contract: multiReturnContract,
                    text: summary,
                  });
                  if (!multiCoverage.satisfied) {
                    shouldReject = true;
                    rejectReason = `Query requires ${multiReturnContract.multiReturnCount} results (detected "both"/"all") but summary only covers ${multiReturnContract.requiredEntities.length - multiCoverage.missingEntities.length}. Missing: ${multiCoverage.missingEntities.join(", ")}`;
                  }
                }
                if (shouldReject) {
                  this.doneRejections++;
                  this.context.addMessage({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content:
                      `done() REJECTED: ${rejectReason}\n\n` +
                      "Return all requested results before calling done().",
                  });
                  continue;
                }
              }

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
              if (taskContractGuard.blocked) {
                this.doneRejections++;
                this.log.warn(
                  "agent",
                  "DONE rejected: task contract incomplete",
                  {
                    turn: this.turnCount,
                    rejections: this.doneRejections,
                    reason: taskContractGuard.reason,
                    missingEntities:
                      taskContractGuard.summaryCoverage.missingEntities,
                    missingNumbers:
                      taskContractGuard.summaryCoverage.missingNumbers,
                    missingReturnTarget: taskContractGuard.missingReturnTarget,
                  },
                );
                this.traceRecorder?.recordEvent("done_rejected_task_contract", {
                  rejections: this.doneRejections,
                  reason: taskContractGuard.reason,
                  missingEntities:
                    taskContractGuard.summaryCoverage.missingEntities,
                  missingNumbers:
                    taskContractGuard.summaryCoverage.missingNumbers,
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
                  this.traceRecorder?.recordEvent(
                    "done_blocked_max_rejections",
                    {
                      rejections: this.doneRejections,
                      reason: taskContractGuard.reason,
                      source: "task_contract",
                    },
                  );
                  this.context.addMessage({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content:
                      `done() REJECTED: ${taskContractGuard.reason}\n\n` +
                      "You have repeated done() too many times while the task is still incomplete. " +
                      "Do not call done() again from this state. Take a different action or call escalate().",
                  });
                  continue;
                } else {
                  this.context.addMessage({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content:
                      `done() REJECTED: ${taskContractGuard.reason}\n\n` +
                      "Complete the missing task obligations, verify them on the page, then call done() again.",
                  });
                  continue;
                }
              }

              const workflowSnapshot = this.context.getSnapshot();
              const workflowDoneGuard = assessWorkflowDoneGuard({
                query: this.originalQuery,
                summary,
                selectedSkillId: this.selectedSkillId,
                pageUrl: workflowSnapshot?.url,
                pageTitle: workflowSnapshot?.title,
              });
              if (workflowDoneGuard.blocked) {
                this.doneRejections++;
                this.log.warn(
                  "agent",
                  "DONE rejected: workflow completion guard",
                  {
                    turn: this.turnCount,
                    rejections: this.doneRejections,
                    selectedSkillId: this.selectedSkillId,
                    reason: workflowDoneGuard.reason,
                  },
                );
                this.traceRecorder?.recordEvent(
                  "done_rejected_workflow_contract",
                  {
                    rejections: this.doneRejections,
                    selectedSkillId: this.selectedSkillId,
                    reason: workflowDoneGuard.reason,
                  },
                );
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content:
                    `done() REJECTED: ${workflowDoneGuard.reason}\n\n` +
                    "Continue the workflow, verify the requested final state, then call done() again.",
                });
                continue;
              }

              const latestListDetailActionCount = countVisibleListDetailActions(
                this.context.getSnapshot(),
              );
              const listDetailDoneRejection = getListDetailDoneRejection({
                selectedSkillId: this.selectedSkillId,
                query: this.originalQuery,
                reviewedDetailCount: this.listDetailReviewedTargets.size,
                visibleDetailActionCount: Math.max(
                  this.listDetailVisibleActionCount,
                  latestListDetailActionCount,
                ),
              });
              if (listDetailDoneRejection) {
                this.doneRejections++;
                this.log.warn(
                  "agent",
                  "DONE rejected: list-detail review incomplete",
                  {
                    turn: this.turnCount,
                    rejections: this.doneRejections,
                    openedDetailCount: this.listDetailOpenedTargets.size,
                    reviewedDetailCount: this.listDetailReviewedTargets.size,
                    visibleDetailActionCount: Math.max(
                      this.listDetailVisibleActionCount,
                      latestListDetailActionCount,
                    ),
                  },
                );
                this.traceRecorder?.recordEvent(
                  "done_rejected_list_detail_incomplete",
                  {
                    rejections: this.doneRejections,
                    openedDetailCount: this.listDetailOpenedTargets.size,
                    reviewedDetailCount: this.listDetailReviewedTargets.size,
                    visibleDetailActionCount: Math.max(
                      this.listDetailVisibleActionCount,
                      latestListDetailActionCount,
                    ),
                  },
                );
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content:
                    `done() REJECTED: ${listDetailDoneRejection}\n\n` +
                    "Do NOT synthesize the recommendation from list-card snippets alone.",
                });
                continue;
              }

              // Planner validation: only when a plan exists
              if (this.taskId && this.planSubtasks.length > 0) {
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
                const effectiveCurrentIdx =
                  runningIdx >= 0 ? runningIdx : completedCount;
                const uncommittedInlineEditRejection =
                  this.getUncommittedInlineEditDoneRejection(
                    effectiveCurrentIdx,
                  );
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
                      remainingSteps:
                        this.planSubtasks.length - effectiveCurrentIdx - 1,
                      selectedSkillId: this.selectedSkillId,
                      reason: completedMoneyTableAggregate
                        ? "completed_money_table_aggregate"
                        : "satisfied_edit_task",
                    },
                  );
                  this.traceRecorder?.recordEvent(
                    "done_plan_incomplete_bypassed",
                    {
                      step: effectiveCurrentIdx,
                      remainingSteps:
                        this.planSubtasks.length - effectiveCurrentIdx - 1,
                      selectedSkillId: this.selectedSkillId,
                      reason: completedMoneyTableAggregate
                        ? "completed_money_table_aggregate"
                        : "satisfied_edit_task",
                    },
                  );
                }

                const activeAsyncExpectation =
                  this.pendingAsyncVerification &&
                  this.pendingAsyncVerification.stepIndex ===
                    effectiveCurrentIdx
                    ? this.pendingAsyncVerification
                    : null;
                if (
                  this.pendingAsyncVerification &&
                  this.pendingAsyncVerification.stepIndex !==
                    effectiveCurrentIdx
                ) {
                  this.pendingAsyncVerification = null;
                }
                if (
                  activeAsyncExpectation &&
                  !isPendingAsyncChangeSatisfied({
                    snapshot: this.context.getSnapshot(),
                    expectedTokens: activeAsyncExpectation.expectedTokens,
                    baselineLoadingKeywords:
                      activeAsyncExpectation.baselineLoadingKeywords,
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
                  if (
                    !shouldReject &&
                    !this.nodeId &&
                    !completedMoneyTableAggregate
                  ) {
                    const currentSubtask =
                      effectiveCurrentIdx >= 0
                        ? this.planSubtasks[effectiveCurrentIdx]
                        : undefined;
                    const interpretation = this.perception.getInterpretation();
                    const validationPerception =
                      shouldOmitPerceptionForDoneValidation({
                        interpretation,
                        hasReadPage: this.hasReadPage,
                        originalQuery: this.originalQuery,
                        activeStepDescription: currentSubtask?.description,
                        activeStepToolProfile:
                          currentSubtask?.toolProfile &&
                          resolveToolProfile(
                            currentSubtask.toolProfile as ToolProfile,
                          )
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
                      rejectReason =
                        validation.reason || "Task is not yet complete.";
                    }
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
                        tool_call_id: toolCall.id,
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
                      continue;
                    }
                    // Exhausted retries — fall through to normal rejection
                  }

                  const planIncompleteOnly =
                    rejectReason.startsWith("Plan incomplete.");
                  const canAdvanceStep =
                    planIncompleteOnly &&
                    effectiveCurrentIdx >= 0 &&
                    effectiveCurrentIdx < this.planSubtasks.length - 1;

                  if (canAdvanceStep) {
                    // Three-layer verification gate before auto-advance
                    const sentiment = assessDoneSummary(summary);
                    const criteriaCheck = matchSuccessCriteria({
                      successCriteria:
                        this.planSteps[effectiveCurrentIdx]?.successCriteria,
                      snapshot: this.context.getSnapshot(),
                    });
                    const autoAdvanceCap = Math.max(
                      2,
                      Math.ceil(this.planSubtasks.length / 2),
                    );
                    const rateLimited =
                      this.consecutiveAutoAdvances >= autoAdvanceCap;

                    const coherence = checkSummaryStepCoherence({
                      summary,
                      currentStepIndex: effectiveCurrentIdx,
                      stepDescriptions: this.planSubtasks.map(
                        (s) => s.description,
                      ),
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
                      this.log.warn(
                        "agent",
                        "Auto-advance blocked by verification gate",
                        {
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
                        },
                      );
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
                      const newIdx = this.advanceCompletedSubtasks();
                      const completedStep =
                        this.planSubtasks[previousIdx]?.description ||
                        `Step ${previousIdx + 1}`;
                      const nextStep =
                        this.planSubtasks[newIdx]?.description ||
                        "Finish the remaining plan";

                      this.syncPlanStatus(
                        newIdx,
                        "step_advanced_by_done_rejection",
                        {
                          rejections: this.doneRejections,
                          advancedTo: newIdx,
                          convertedFromDone: true,
                        },
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
                      this.log.info(
                        "agent",
                        "DONE converted into step completion",
                        {
                          turn: this.turnCount,
                          completedStep: completedStep.slice(0, 200),
                          nextStep: nextStep.slice(0, 200),
                        },
                      );
                      this.context.addMessage({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content:
                          `Step ${previousIdx + 1} verified complete.\n\n` +
                          `Now active: Step ${newIdx + 1} — ${nextStep}.\n` +
                          "Observe the page with read_page first, then act. Do NOT call done() until this step is completed and verified.",
                      });
                      continue; // Resume executor loop on the next active step
                    }
                  }

                  this.doneRejections++;
                  // Activate idempotency guard: prevent re-execution of actions
                  // that already succeeded but whose done() was rejected by verifier
                  this.guardAfterDoneRejection = true;

                  this.log.warn("agent", "DONE rejected", {
                    turn: this.turnCount,
                    rejections: this.doneRejections,
                    advancedTo: effectiveCurrentIdx,
                    reason: rejectReason.slice(
                      0,
                      STRING_LIMITS.REJECTION_REASON,
                    ),
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
                    this.log.warn(
                      "agent",
                      "DONE blocked after max rejections",
                      {
                        turn: this.turnCount,
                        rejections: this.doneRejections,
                      },
                    );
                    this.traceRecorder?.recordEvent(
                      "done_blocked_max_rejections",
                      {
                        rejections: this.doneRejections,
                        reason: rejectReason,
                        source: "plan_validation",
                      },
                    );
                    this.context.addMessage({
                      role: "tool",
                      tool_call_id: toolCall.id,
                      content:
                        `done() REJECTED: ${rejectReason}\n\n` +
                        "You have repeated done() too many times while the task is still incomplete. " +
                        "Do not call done() again from this state. Take a different action or call escalate()." +
                        nextStepHint,
                    });
                    continue;
                  } else {
                    this.context.addMessage({
                      role: "tool",
                      tool_call_id: toolCall.id,
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
                    continue; // Resume executor loop
                  }
                }
              }

              const missingRequiredEvidence =
                this.getMissingRequiredEvidenceTypes();
              if (missingRequiredEvidence.length > 0) {
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
                  tool_call_id: toolCall.id,
                  content:
                    `done() REJECTED: Missing required typed evidence: ${missingRequiredEvidence.join(", ")}.\n\n` +
                    "Use the selected workflow tool to complete and verify the action before calling done().",
                });
                continue;
              }

              // --- Normal done handling ---
              // Signal completion immediately — the orchestrator reads this
              // after a lane timeout to avoid retrying completed subtasks.
              this.completedResult = { outcome: "completed", summary };

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
              const question =
                (args.question as string) || "Could you clarify?";
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

            // UPDATE_NOTES tool - save a note to the current run scratchpad
            if (toolName === ToolName.UPDATE_NOTES) {
              const note = (args.note as string) || "";
              this.context.appendWorkingNote(note);
              this.trackListDetailToolSuccess(
                toolName,
                args,
                this.context.getSnapshot(),
              );
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

              // Signal WAITING status so the UI activity indicator stays visible
              this.statusHandler(
                AgentStatus.WAITING_FOR_PAGE_LOAD,
                `Waiting ${seconds}s…`,
              );
              await new Promise((resolve) =>
                setTimeout(resolve, seconds * 1000),
              );
              this.statusHandler(AgentStatus.THINKING, "Analyzing…");

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

              // Normalize: LLMs sometimes send "id" instead of "tabId", or strings instead of ints
              const rawId = args.tabId ?? args.id;
              const targetTabId =
                typeof rawId === "string"
                  ? parseInt(rawId, 10)
                  : (rawId as number);
              if (!targetTabId || isNaN(targetTabId)) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Error: Invalid tab ID. Use switch_tab({"tabId": <integer>}) with the numeric tab ID from create_tab or list_tabs.`,
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
              if (
                this.replayMutationSensitiveAction(toolCall.id, toolName, args)
              ) {
                continue;
              }
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

              // Normalize: LLMs sometimes send "id" instead of "tabId", or strings instead of ints
              const rawCloseId = args.tabId ?? args.id;
              const parsedCloseId =
                typeof rawCloseId === "string"
                  ? parseInt(rawCloseId, 10)
                  : (rawCloseId as number);
              const targetTabId =
                parsedCloseId && !isNaN(parsedCloseId) ? parsedCloseId : tabId;

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
                this.recordMutationSensitiveAction(
                  toolName,
                  args,
                  `Closed tab ${targetTabId}.`,
                );
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
              if (
                this.replayMutationSensitiveAction(toolCall.id, toolName, args)
              ) {
                continue;
              }
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
                this.recordMutationSensitiveAction(
                  toolName,
                  args,
                  `Created new tab (ID: ${newTab.id}) with URL: ${urlResult.value}. Use switch_tab to make it the active tab.`,
                );
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

            // Idempotency guard: prevent re-execution of mutation-sensitive actions
            // within the same plan step. Checks the durable step mutation ledger first
            // (survives SW restart), then the ephemeral turn cache.
            if (
              this.replayMutationSensitiveAction(toolCall.id, toolName, args)
            ) {
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
              const preActionSnapshot = this.context.getSnapshot();
              result = await this.executeToolCall(toolCall, tabId);
              if (autocompleteRewriteReason) {
                result = `${result}\n${autocompleteRewriteReason}`;
              }
              this.trackListDetailToolSuccess(
                toolName,
                args,
                preActionSnapshot,
              );
              const toolMs = Date.now() - toolStep.timestamp;
              // Track tag IDs discovered by find_element
              for (const id of extractDiscoveredTagIds(toolName, result)) {
                discoveredTagIds.add(id);
              }
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
              if (
                this.pendingInlineEditVerification &&
                this.pendingInlineEditVerification.stepIndex ===
                  currentStepIndex &&
                [
                  ToolName.READ_PAGE,
                  ToolName.READ_ELEMENT,
                  ToolName.FIND_ELEMENT,
                ].includes(toolName)
              ) {
                this.pendingInlineEditVerification = null;
              } else if (shouldArmInlineEditVerification) {
                this.pendingInlineEditVerification = {
                  stepIndex: currentStepIndex,
                  reason:
                    "You likely just committed an inline edit on this step.",
                };
              }
              this.recordMutationSensitiveAction(
                toolName,
                args,
                result,
                preActionSnapshot,
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
              this.consecutiveAutoAdvances = 0;
              if (toolName !== ToolName.READ_PAGE) {
                visuallyModified = true;
                lastDomAffectingToolName = toolName;
              }
              this.lastDomStep = {
                ...toolStep,
                status: "done",
                durationMs: Date.now() - toolStep.timestamp,
              };
            }

            // Track read_page / xray_page for done() content verification guard
            if (
              toolName === ToolName.READ_PAGE ||
              toolName === ToolName.XRAY_PAGE
            ) {
              this.hasReadPage = true;
            }
            if (toolName === ToolName.READ_PAGE) {
              const aggregateNote = this.updateMoneyTableAggregate(result);
              if (aggregateNote) {
                result = `${result}\n\n${aggregateNote}`;
              }
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

            const trustedSubmitCompletion =
              this.maybeCompleteTrustedFormSubmitStep({
                toolName,
                toolArgs: args,
                toolResult: result,
                mode: "sequential",
              });
            if (trustedSubmitCompletion) {
              doneSummary = trustedSubmitCompletion.finalSummary;
              doneSignaled = true;
              this.completedResult = {
                outcome: "completed",
                summary: doneSummary,
              };
              this.statusHandler(AgentStatus.IDLE, "Done");
              this.messageHandler(doneSummary, []);
              this.saveTurnCheckpoint().catch(() => {});
              break;
            }

            // Trigger B: Blind input detection — warn when type_text value has no evidence
            this.maybeAdvanceTrustedFormFillStep({
              toolName,
              toolArgs: args,
              toolResult: result,
              mode: "sequential",
            });

            const trustedAutoSubmitCompletion =
              await this.maybeAutoSubmitTrustedServiceNowForm({
                toolName,
                toolArgs: args,
                toolResult: result,
                tabId,
                mode: "sequential",
              });
            if (trustedAutoSubmitCompletion) {
              doneSummary = trustedAutoSubmitCompletion.finalSummary;
              doneSignaled = true;
              this.completedResult = {
                outcome: "completed",
                summary: doneSummary,
              };
              this.statusHandler(AgentStatus.IDLE, "Done");
              this.messageHandler(doneSummary, []);
              this.saveTurnCheckpoint().catch(() => {});
              break;
            }

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

            // Post-type_text DOM settle: detect autocomplete/dropdown appearance
            if (
              !args.pressEnter &&
              !result.includes("ServiceNow reference value committed")
            ) {
              const preCount = this.context.getSnapshot()?.elements.length ?? 0;
              await new Promise((r) => setTimeout(r, 400));
              prevElementCount = await this.refreshSnapshotWithRetry(
                tabId,
                preCount,
              );
              if (prevElementCount > preCount + 2) {
                const delta = prevElementCount - preCount;
                this.context.addMessage({
                  role: "user",
                  content: `${delta} new elements appeared after typing (autocomplete suggestions or dropdown detected). Snapshot refreshed. IMPORTANT: Do NOT type the full value — select the matching option from the dropdown by clicking it. Typing the complete value will not register as a selection.`,
                });
                this.log.info(
                  "agent",
                  "Post-type DOM settle: new elements detected",
                  {
                    turn: this.turnCount,
                    preCount,
                    postCount: prevElementCount,
                    delta,
                  },
                );
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
                if (currentSubSeq.verificationGate.action === "advance_step") {
                  this.consecutiveAutoAdvances = 0;
                  const newIdx = this.advanceCompletedSubtasks();
                  this.syncPlanStatus(newIdx, "step_advanced_by_gate", {
                    evidence: seqGateResult.evidence,
                    mode: "sequential",
                    advancedTo: newIdx,
                  });
                  this.broadcast({
                    type: "TASK_PROGRESS",
                    payload: {
                      taskId: this.taskId!,
                      subtasks: this.planSubtasks,
                      currentIndex: newIdx,
                      totalTurnsUsed: this.turnCount,
                    },
                  });
                  this.context.addMessage({
                    role: "user",
                    content: `STEP ADVANCED: '${seqGateResult.evidence}' matched. Now on step ${newIdx + 1}.`,
                  });
                } else {
                  this.context.addMessage({
                    role: "user",
                    content: `CHECKPOINT: Gate triggered. Evidence: '${seqGateResult.evidence}'. Call done() now.`,
                  });
                }
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
            const toolName = toolCall.function.name as ToolName;
            const rawArgsKey = toolCall.function.arguments.slice(0, 100);
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(toolCall.function.arguments);
            } catch {
              parsedArgs = {};
            }
            const argsKey = actionMemoryKey(
              toolName,
              parsedArgs,
              rawArgsKey,
              this.context.getSnapshot(),
            );
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
                consecutiveExplorationTurns >=
                EXPLORATION_BUDGET.MAX_CONSECUTIVE
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
            const toolName = toolCall.function.name as ToolName;
            const rawArgsKey = toolCall.function.arguments.slice(0, 100);
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(toolCall.function.arguments);
            } catch {
              parsedArgs = {};
            }
            const argsKey = actionMemoryKey(
              toolName,
              parsedArgs,
              rawArgsKey,
              this.context.getSnapshot(),
            );

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
              } catch {
                /* */
              }
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

              // Try replan-on-escalation first: planner replans, executor continues
              const replanSucceeded = await this.replanOnEscalation(
                tabId,
                subgoalAttempts,
                this.abortController?.signal,
              );
              if (replanSucceeded) {
                this.stagnation.resetEscalation();
                subgoalAttempts.length = 0;
                recentOutcomes.length = 0;
                consecutiveTextOnly = 0;
                recentSuccesses.length = 0;
                turnsSinceStepEscalation = -1;
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

          // Try replan-on-escalation first
          const sameUrlReplanOk = await this.replanOnEscalation(
            tabId,
            subgoalAttempts,
            this.abortController?.signal,
          );
          if (sameUrlReplanOk) {
            this.stagnation.resetEscalation();
            subgoalAttempts.length = 0;
            recentOutcomes.length = 0;
            consecutiveTextOnly = 0;
            recentSuccesses.length = 0;
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
                autoDismiss: false, // Don't destroy agent-triggered dialogs
              },
            });
            let snap = snapResponse?.payload?.snapshot;

            // Retry once if elements dropped to 0 (SPA still rendering)
            // or if a visual action produced no element count change (framework
            // state update hasn't committed — React setState, Vue reactivity, etc.)
            const noChangeAfterVisualAction =
              snap &&
              snap.elements.length > 0 &&
              snap.elements.length === prevElementCount &&
              visuallyModified;
            if (
              (snap && snap.elements.length === 0 && prevElementCount > 0) ||
              noChangeAfterVisualAction
            ) {
              const isEmpty = snap!.elements.length === 0;
              this.log.info(
                "agent",
                isEmpty
                  ? "Empty snapshot after action, waiting for elements"
                  : "No DOM change after visual action, retrying snapshot",
                {
                  turn: this.turnCount,
                  elements: snap!.elements.length,
                  prevElements: prevElementCount,
                },
              );
              if (!isEmpty) {
                this.traceRecorder?.recordEvent("snapshot_retry_no_change", {
                  turn: this.turnCount,
                  elements: snap!.elements.length,
                });
              }
              // Wait for framework state commit: 500ms for empty page, 300ms for no-change
              await waitForDomReady(tabId, {
                timeoutMs: isEmpty ? 500 : 300,
                waitForElements: isEmpty,
              });
              snapResponse = await chrome.tabs.sendMessage(tabId, {
                type: "DOM_SNAPSHOT_REQUEST",
                requestId: crypto.randomUUID(),
                source: MessageSource.BACKGROUND,
                payload: {
                  refresh: true,
                  autoDismiss: false, // Don't destroy agent-triggered dialogs
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
              this.updateMoneyTableAggregateFromSnapshot();

              // Record post-tool DOM state so trace shows what perception was based on
              this.traceRecorder?.recordPostToolSnapshot({
                url: snap.url,
                title: snap.title || "",
                elementCount: snap.elements.length,
                visibleContentLength: snap.visibleContent?.length || 0,
                pageContentLength: snap.pageContent?.length || 0,
                scrollY: snap.scroll?.y || 0,
                elements: snap.elements,
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
                this.broadcast({
                  type: "STREAM_CHUNK",
                  payload: { delta: "", done: true, replaceContent: summary },
                });
                this.statusHandler(AgentStatus.IDLE, "Done");
                this.messageHandler(summary, []);
                doneSummary = summary;
                doneSignaled = true;

                if (this.showSessionMetrics) {
                  this.metrics.totalSessionTimeMs =
                    Date.now() - this.sessionStartTime;
                  this.broadcast({
                    type: "SESSION_METRICS",
                    payload: { ...this.metrics },
                  });
                }
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
                  const newIdx = this.advanceCompletedSubtasks();
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
                  doneSummary = finalSummary;
                  doneSignaled = true;
                  this.completedResult = {
                    outcome: "completed",
                    summary: finalSummary,
                  };
                  this.statusHandler(AgentStatus.IDLE, "Done");
                  this.messageHandler(finalSummary, []);
                  this.saveTurnCheckpoint().catch(() => {});
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
                    const submitResetSignal =
                      detectFormSubmissionResetSuccess({
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
                      doneSummary = finalSummary;
                      doneSignaled = true;
                      this.completedResult = {
                        outcome: "completed",
                        summary: finalSummary,
                      };
                      this.statusHandler(AgentStatus.IDLE, "Done");
                      this.messageHandler(finalSummary, []);
                      this.saveTurnCheckpoint().catch(() => {});
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
                      const newIdx = this.completeSingleSubtask(fromStep);
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
                      this.broadcast({
                        type: "TASK_PROGRESS",
                        payload: {
                          taskId: this.taskId!,
                          subtasks: this.planSubtasks,
                          currentIndex: newIdx,
                          totalTurnsUsed: this.turnCount,
                        },
                      });
                      if (completedAllSteps) {
                        const finalSummary = `Completed final planned step: ${reason}.`;
                        doneSummary = finalSummary;
                        doneSignaled = true;
                        this.completedResult = {
                          outcome: "completed",
                          summary: finalSummary,
                        };
                        this.statusHandler(AgentStatus.IDLE, "Done");
                        this.messageHandler(finalSummary, []);
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
                      this.stagnation.resetEscalation();
                      subgoalAttempts.length = 0;
                      recentOutcomes.length = 0;
                      consecutiveTextOnly = 0;
                      recentSuccesses.length = 0;
                      consecutiveProgressSignals = 0;
                      this.consecutiveZeroEffectTurns = 0;
                      wasStuck = false;
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
                    this.stagnation.resetEscalation();
                    subgoalAttempts.length = 0;
                    recentOutcomes.length = 0;
                    consecutiveTextOnly = 0;
                    recentSuccesses.length = 0;
                    consecutiveProgressSignals = 0;
                    wasStuck = false;
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
                  this.broadcast({
                    type: "STREAM_CHUNK",
                    payload: { delta: "", done: true },
                  });
                  continue;
                }

                const newIdx = this.completeSingleSubtask(gate.runningIdx);
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
                this.broadcast({
                  type: "STREAM_CHUNK",
                  payload: { delta: "", done: true },
                });
                continue;
              }
            }

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
            this.stagnation.resetEscalation();
            subgoalAttempts.length = 0;
            recentOutcomes.length = 0;
            consecutiveTextOnly = 0;
            recentSuccesses.length = 0;
            this.broadcast({
              type: "STREAM_CHUNK",
              payload: { delta: "", done: true },
            });
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

        // Durable checkpoint: persist loop state for SW restart recovery
        this.saveTurnCheckpoint().catch(() => {});

        // Trace: flush turn
        await this.traceRecorder?.endTurn();
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: true },
        });
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
