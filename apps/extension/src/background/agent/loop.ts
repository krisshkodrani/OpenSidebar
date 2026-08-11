import {
  AgentStatus,
  AgentLoopState,
  AgentStep,
  Citation,
  MessageSource,
  PartialHandoffReason,
  PartialProgressHandoff,
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
  isVLCapable,
  normalizeExecutorModel,
} from "../../utils/executor-model-policy";
import {
  emptyRegionZoomState,
  executeInspectRegion,
  type RegionZoomHost,
} from "./region-zoom";
import {
  extractPerceptionPageSignals,
  PERCEPTION_AUTO_DEFAULT_MODE,
  resolvePerceptionRuntimeMode,
  resolvePerceptionRuntimeModeDecision,
} from "../../utils/perception-mode";
import { LLMClient } from "../llm";
import { toolRegistry } from "../tools";
import type { ToolProfile } from "../tools/metadata";
import { waitForDomReady } from "../tab-ready";
import {
  isBridgeDisconnect,
  recoverContentScriptBridge,
  type BridgeRecoveryTraceHook,
} from "../tools/bridge";
import { type DryRunClassification } from "./mutation-dry-run-policy";
import {
  runFormSubmitDryRun,
  type FormSubmitDryRunHost,
} from "./form-submit-dry-run";
import type { ForwardedApprovalDryRun } from "@shared-types/browser-bridge";
import { workspaceManager } from "../workspaces/manager";
import { ContextManager } from "./context";
import { StagnationMonitor } from "./stagnation";
import { PerceptionScreenshotState } from "../perception/perception-screenshot-state";
import {
  captureVLExecutorScreenshot,
  createVLScreenshotState,
  type VLScreenshotHost,
} from "./vl-screenshot";
import {
  captureVisibleTabWithQuotaRetry,
  withPresenceSuspended,
} from "./capture-guard";
import type { PerceptionTaskContext } from "../perception/types";
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
} from "../../utils/step-labels";
import { TaskPlanner, PlanStep, PlanMonitorResult } from "./planner";
import { TraceRecorder } from "./trace";
import { ToolResultCache } from "./tool-cache";
import {
  runPrepareModelTurnPhase,
  type PrepareModelTurnHost,
} from "./turn-phases/prepare-model-turn";
import { runGatesPhase, type GatesPhaseHost } from "./turn-phases/gates";
import {
  runFeedbackPhase,
  type FeedbackPhaseHost,
} from "./turn-phases/feedback";
import {
  runEscalationPhase,
  type EscalationPhaseHost,
} from "./turn-phases/escalation";
import {
  runAccountAndRefreshPhase,
  type AccountAndRefreshHost,
} from "./turn-phases/account-and-refresh";
import {
  runDispatchToolsPhase,
  type DispatchToolsHost,
} from "./turn-phases/dispatch-tools";
import {
  runPostToolGuardsPhase,
  type PostToolGuardsHost,
} from "./turn-phases/post-tool-guards";
import {
  runCompletionPhase,
  type CompletionPhaseHost,
} from "./turn-phases/completion";
import {
  runTextResponsePhase,
  type TextResponsePhaseHost,
} from "./turn-phases/text-response";
import {
  runPrepareTurnContextPhase,
  type PrepareTurnContextHost,
} from "./turn-phases/prepare-turn-context";
import {
  runDonePlanRejection,
  type DonePlanRejectionHost,
} from "./done-plan-rejection";
import {
  evaluateDonePlanPrecheck,
  evaluateDonePlanValidation,
  type DonePlanValidationHost,
} from "./done-plan-validation";
import {
  collectDoneDiagnosticIssues,
  type DoneDiagnosticsHost,
} from "./done-diagnostics";
import {
  saveTurnCheckpoint,
  restoreFromTurnCheckpoint,
  clearTurnCheckpoint,
  type TurnCheckpointHost,
} from "./turn-checkpoint";
import {
  getActiveCompletionContext,
  recordCompletionEvidence,
  refreshCompletionEvidenceFromSnapshot,
  recordCompletionToolEvidence,
  evaluateCompletionCandidate,
  getCompletionRecoveryHintForCurrentState,
  maybeAddCompletionRecoveryHint,
  type CompletionEvidenceHost,
} from "./completion-evidence";
import {
  extractServiceNowModuleRequest,
  maybeInferServiceNowModuleNavigationEvidence,
  type ModuleNavEvidenceHost,
  type ServiceNowMissingFieldSearchEvidence,
  type TrustedCatalogOrderSubmission,
} from "./servicenow/trusted-workflow-adapter";
import {
  assessServiceNowMissingFieldInfeasibility,
  getServiceNowMissingFieldAdmissionSummary,
  hasTaskLevelServiceNowSubmitIntent,
  hasTrustedServiceNowSubmitIntent,
  isRetryableServiceNowModuleControllerMiss,
  isTaskLevelServiceNowRecordWorkflow,
  maybeAutoSubmitTrustedServiceNowForm,
  maybeRunServiceNowRecordFormController,
  shouldAutoSubmitTrustedServiceNowForm,
  startServiceNowRecordControllerTraceTurn,
  type ServiceNowRecordFormHost,
} from "./servicenow/record-form-controller";
import {
  maybeAutoSubmitConfiguredCatalogItem,
  maybeCompleteCatalogOrderFromSnapshot,
  maybeCompleteTrustedCatalogOrderSubmit,
  shouldAutoSubmitConfiguredCatalogItem,
  type ServiceNowCatalogHost,
} from "./servicenow/catalog-controller";
import { resolveInitialSnapshot } from "./initial-snapshot";
import { bootstrapRuntimePlan } from "./start-planner-bootstrap";
import { PendingInteractionYield, runStartExecution } from "./start-result";
import { finalizeStartResult } from "./start-finalization";
import { AgentMiddleware } from "./middleware";
import { EvidenceAccumulator } from "./evidence";
import { EscalationRescueTracker } from "./escalation-rescue-policy";
import {
  buildCompletionEnvelope,
  buildTrustedCompletionCandidate,
  CompletionEvidenceLedger,
  deriveCompletionEvidenceFromSnapshot,
  type CompletionCandidateSource,
  type CompletionEnvelope,
  type CompletionEvaluation,
  type TrustedCompletionCandidate,
} from "./completion-kernel";
import {
  buildCompletionDecisionRecord,
  computeSnapshotDigest,
  projectKernelEvidence,
  type CompletionDecisionBasis,
  type CompletionDecisionRecordInput,
} from "./completion/decision-record";
import {
  isCompletionDecisionRecordingEnabled,
  recordCompletionDecision,
} from "./completion/decision-recorder";
import type { CompletionGuardContext } from "./completion/guards/context";
import {
  runCompletionPipeline,
  type PlannerValidationResult,
} from "./completion/pipeline";
import type {
  CompletionEffect,
  CompletionPipelineDecision,
} from "./completion/pipeline-types";
import {
  applyCompletionEffects,
  type CompletionEffectHost,
} from "./completion/apply-effects";
import type { TurnCheckpoint } from "./checkpoint-types";
import { CheckpointCoordinator } from "./checkpoint-coordinator";
import { AgentTelemetryController } from "./agent-telemetry-controller";
import { TurnState } from "./turn-state";
import { LoopSession, TurnScope } from "./loop-scope";
import {
  createTurnController,
  type TurnControllerHost,
} from "./turn-controller";
import {
  getActiveSubtaskDescription,
  getMatchingApprovalInteraction,
  getMatchingClarificationInteraction,
  getWorkspaceTabs,
  isPureListFilterWorkflowRequest,
  lookupMutationReplay,
  shouldEscalateOnDoneRejection,
  type LoopQueriesHost,
} from "./loop-queries";
import type { MoneyTableAggregate } from "./money-table-aggregate";
import {
  isTextLikeInputElement,
  normalizeGuardText,
} from "./text-entry-guards";
import { assessRepeatedAddItemClick } from "./repeated-add-item-policy";
export {
  rewriteAutocompleteTextEntry,
  validateTextEntryTarget,
} from "./text-entry-guards";
import {
  countVisibleListDetailActions,
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
import { imagePromptUsageForCount } from "./agent-telemetry";
import {
  approvalRequestMessage,
  BroadcastMessage,
  clarificationRequestMessage,
  forwardSuppressedStreamChunk,
  planTerminationMessage,
  runtimeBroadcastMessage,
  successfulTaskCompletionMessage,
  taskProgressMessage,
} from "./agent-broadcast";
import {
  buildPartialProgressHandoff,
  createProgressLedger,
  formatPartialProgressHandoffSummary,
  recordProgressLedgerToolResult,
  updateProgressLedgerState,
  type ProgressLedger,
} from "./partial-progress-handoff";
import {
  approvalRequestStep,
  clarificationRequestStep,
} from "./agent-interaction-steps";
import {
  annotateCompletedPlanSubtasksForAcceptedDone,
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
export {
  isPerceptionFailurePlaceholder,
  shouldOmitPerceptionForDoneValidation,
} from "./perception-done-validation";
import {
  AGENT_LIMITS,
  STRING_LIMITS,
  TOOL_CACHE,
  DEFAULT_RUNTIME_LIMITS,
} from "./constants";
import type { Difficulty, RuntimeLimits } from "./constants";
// reassessRuntimeLimits is available from "./constants" for mid-session S5 reassessment
import { APPROVAL_TIMEOUT_MS, MAX_SESSION_MS } from "./loop-metrics";
import type { LoopResult } from "./loop-types";
import type { PendingUserInteraction } from "./loop-types";
import { getLoadedSkillContract } from "../orchestrator/skills";
import { evaluateWorkflowTabRedirect } from "./workflow-tab-controller";
import {
  BlockedAction,
  buildStructuredFailureContext,
  detectInstructionContradiction,
  detectFormSubmissionResetSuccess,
  detectTrustedFormFillStepCompletion,
  detectTrustedFormSubmitCompletion,
  extractAttemptSummary,
  formatStructuredFailureContext,
  isPendingAsyncChangeSatisfied,
  type RecentOutcome,
  SubgoalAttempt,
  userExplicitlyRequestedTabManagement,
} from "./loop-helpers";
import { extractFieldValuePairs } from "./task-contract";
import { PIVOT_MESSAGE } from "./loop-prompts";
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
import { type TurnToolOutcomeRecord } from "./turn-tool-outcomes";
export { isDoneSummaryAskingClarification } from "./completion-kernel";

type CompletionRejectionDecision = Extract<
  CompletionEvaluation,
  { status: "rejected" | "needs_verification" }
>;
type CompletionValidationErrorEvidence = Extract<
  CompletionRejectionDecision["evidence"][number],
  { type: "validation_error" }
>;

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
  public completedResult: {
    outcome: "completed";
    summary: string;
    completionEnvelope?: CompletionEnvelope;
  } | null = null;

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
  /** Tool names exposed to the model for the current LLM turn. */
  private activeToolNamesForTurn: ToolName[] = [];
  /** Original user query that started this loop */
  private originalQuery = "";
  public readonly enabledSkillPackIds?: string[];
  private moneyTableAggregate: MoneyTableAggregate | null = null;
  /** Progress tracker — promoted from local to instance for external access */
  private stagnation = new StagnationMonitor();
  /** Owns the mutation replay ledger + durable turn-checkpoint persistence. */
  private checkpoints = new CheckpointCoordinator();
  /** Turn checkpoint to restore from (injected by orchestrator on restart). */
  private pendingTurnCheckpoint: TurnCheckpoint | null = null;
  /** Pending interaction response injected by orchestrator on resume. */
  private resumeInteraction: PendingUserInteraction | null = null;
  /** Unified VL executor mode: screenshot sent directly to executor, skip separate perception */
  private useVLExecutor = false;
  private perceptionModeOption?: PerceptionRuntimeMode;
  private providerModeOption?:
    | "openrouter"
    | "openrouter-groq"
    | "openai-groq"
    | "fireworks"
    | "fireworks-deepseek" | "cerebras-fireworks"
    | "moonshot"
    | "xiaomi";
  /** When true, mutation replay guard persists across turns (set after done() rejection) */
  private guardAfterDoneRejection = false;
  /** Pending hint from the user, picked up on the next turn */
  private pendingFeedback: string | null = null;
  /** Stateful perception agent — accumulates observations across turns */
  private perception = new PerceptionScreenshotState();
  /** LP-17b CM-5: reuse state for the VL executor screenshot (vl-screenshot.ts). */
  private vlScreenshotState = createVLScreenshotState();
  /** Whether the resolved executor model accepts images (gates unified_vl). */
  private executorVLCapable = true;
  /** inspect_region per-turn cap state (LP-13). */
  private regionZoomState = emptyRegionZoomState();
  /** Last DOM-modifying tool step (retroactively gets screenshot attached) */
  private lastDomStep: AgentStep | null = null;
  /** Promise-based gate for pause/resume */
  private pauseGate: { promise: Promise<void>; resolve: () => void } | null =
    null;

  /** Task planner — planner model for decomposition and done validation */
  private planner: TaskPlanner;
  /** Number of times done() has been rejected by the planner */
  private doneRejections = 0;
  /** Last contract kind that rejected done() */
  private lastContractRejectionKind: string | undefined = undefined;
  /** Number of times the same contract kind rejected done() consecutively */
  private consecutiveSameKindRejections = 0;
  /** Set when a done() rejection mid-point is reached and escalation should fire on the next main-loop tick. */
  private pendingDoneRejectionEscalation = false;
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
  /** Compact deterministic progress state used for partial handoffs. */
  private progressLedger: ProgressLedger = createProgressLedger();

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
  /** Escalation rescue policy state (RFC LP-2): progress clocks + efficacy window. */
  private escalationRescue = new EscalationRescueTracker();
  private completionEvidence = new CompletionEvidenceLedger();
  private lastCompletionRejection: CompletionEvaluation | null = null;
  private lastCompletionRecoveryHint: string | null = null;
  /**
   * The planner-validation result for the current done() decision (null
   * when no plan applied). Captured so the offline replay can stub the
   * planner stage without a model call (RFC LP-15, Phase 7a).
   */
  private lastDonePlanValidation: PlannerValidationResult | null = null;

  /** Session telemetry: metrics, session clock, context spend, citations, turn carry. */
  private telemetry!: AgentTelemetryController;

  /** Accumulate usage from an LLM response */
  private recordUsage(response: CompletionResponse, llmMs: number): void {
    this.telemetry.recordUsage(response, llmMs);
  }

  /** Record usage from a vision API call */
  public recordVisionUsage(
    usage: TokenUsage,
    llmMs: number,
    model: string,
    providerId: ProviderConfig["providerId"] = "openrouter",
    imageCount = 0,
  ): void {
    this.telemetry.recordVisionUsage(
      usage,
      llmMs,
      model,
      providerId,
      imageCount,
    );
  }

  /** Record estimated image prompt tokens for direct screenshot-backed LLM calls. */
  private recordPromptImageUsage(messages: LLMMessage[]): void {
    this.telemetry.recordPromptImageUsage(messages);
  }

  private imagePromptBudgetAllows(imageCount: number): boolean {
    return this.telemetry.imagePromptBudgetAllows(imageCount);
  }

  private recordImagePromptBudgetExhausted(
    imageCount: number,
    source: string,
  ): void {
    this.telemetry.recordImagePromptBudgetExhausted(imageCount, source);
  }

  /** Get the current accumulated metrics snapshot */
  public getMetrics(): SessionMetrics {
    return this.telemetry.getMetrics();
  }

  /** Record a citation for a URL the agent visited or read */
  private recordCitation(url: string, title: string, tool: ToolName): void {
    this.telemetry.recordCitation(url, title, tool);
  }

  /** Get collected citations */
  public getCitations(): Citation[] {
    return this.telemetry.getCitations();
  }

  /** Broadcast metrics to side panel (throttled) */
  private broadcastMetrics(): void {
    this.telemetry.broadcastMetrics();
  }

  private broadcastFinalMetrics(): void {
    this.telemetry.broadcastFinalMetrics();
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
      judgeModel?: string;
      executorProviderPin?: string;
      plannerProviderPin?: string;
      judgeProviderPin?: string;
      writerModel?: string;
      useNitro?: boolean;
      providerMode?:
        | "openrouter"
        | "openrouter-groq"
        | "openai-groq"
        | "fireworks"
        | "fireworks-deepseek" | "cerebras-fireworks"
        | "moonshot"
        | "xiaomi";
      provider?: "openrouter" | "openai" | "groq"; // legacy compat
      openaiApiKey?: string;
      groqApiKey?: string;
      fireworksApiKey?: string;
      deepseekApiKey?: string;
      kimiApiKey?: string;
      xiaomiApiKey?: string; cerebrasApiKey?: string;
      temperature?: number;
      perceptionMode?: PerceptionRuntimeMode;
      maxImagePromptTokenEstimate?: number;
      /** Durable turn checkpoint from a prior SW lifetime — injected by orchestrator on restart. */
      turnCheckpoint?: TurnCheckpoint | null;
      /** Pending user interaction state injected by the orchestrator on resume. */
      resumeInteraction?: PendingUserInteraction | null;
    },
  ) {
    this.perceptionModeOption = options?.perceptionMode;
    this.providerModeOption = options?.providerMode;
    this.telemetry = new AgentTelemetryController({
      getTurnCount: () => this.turnCount,
      getTraceRecorder: () => this.traceRecorder,
      getLog: () => this.log,
      getProvider: () =>
        this.llm.getCurrentProvider() as ProviderConfig["providerId"],
      getModel: () => this.llm.getCurrentModel(),
      broadcast: (msg) => this.broadcast(msg),
      showSessionMetrics: options?.showSessionMetrics ?? false,
      maxImagePromptTokenEstimate: options?.maxImagePromptTokenEstimate,
    });
    // Capability gate input: resolve the executor the same way LLMClient
    // does, so the mode decision and the wire agree on what model acts.
    this.executorVLCapable = isVLCapable(
      normalizeExecutorModel({
        providerMode: this.providerModeOption,
        executorModel: options?.executorModel,
      }),
    );
    // Initial observation path. start() refines auto mode once task/page
    // signals are available from the initial snapshot.
    this.useVLExecutor =
      resolvePerceptionRuntimeMode({
        perceptionMode: this.perceptionModeOption,
        providerMode: this.providerModeOption,
        executorVLCapable: this.executorVLCapable,
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
      judgeModel: options?.judgeModel,
      executorProviderPin: options?.executorProviderPin,
      plannerProviderPin: options?.plannerProviderPin,
      judgeProviderPin: options?.judgeProviderPin,
      writerModel: options?.writerModel,
      useNitro: options?.useNitro,
      providerMode: options?.providerMode,
      provider: options?.provider,
      openaiApiKey: options?.openaiApiKey,
      groqApiKey: options?.groqApiKey,
      fireworksApiKey: options?.fireworksApiKey,
      deepseekApiKey: options?.deepseekApiKey,
      kimiApiKey: options?.kimiApiKey,
      xiaomiApiKey: options?.xiaomiApiKey, cerebrasApiKey: options?.cerebrasApiKey,
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
    // Enable compose_text steering when a dedicated Writer specialist is configured.
    this.context.setWriterAvailable(this.llm.hasWriterModel?.() ?? false);
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

  private async finalizeLoopStartResult(result: LoopResult): Promise<void> {
    // Resolve any still-open escalation efficacy window for outcome telemetry.
    this.escalationRescue.onLoopEnd(
      this.turnCount,
      result.outcome === "completed"
        ? "completed"
        : result.outcome === "max_turns"
          ? "max_turns"
          : "other",
    );
    this.flushEscalationRescueEvents();
    await finalizeStartResult({
      result,
      taskId: this.taskId,
      planSubtasks: this.planSubtasks,
      mutationLedger: this.checkpoints.ledger,
      evidenceAccumulator: this.evidenceAccumulator,
      context: this.context,
      traceRecorder: this.traceRecorder,
      toolCache: this.toolCache,
      clearTurnCheckpoint: () => this.clearTurnCheckpoint(),
      broadcastPlanTermination: (outcome, summary) =>
        this.broadcastPlanTermination(outcome, summary),
      setRunning: (isRunning) => {
        this.isRunning = isRunning;
      },
      clearTraceRecorder: () => {
        this.traceRecorder = null;
      },
    });
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
    await saveTurnCheckpoint(this as unknown as TurnCheckpointHost);
  }

  /**
   * Restore loop-local state from a durable turn checkpoint injected by the
   * orchestrator. Returns true if restoration succeeded, false otherwise.
   *
   * The caller (start path) should compare the live page fingerprint before
   * calling this — if the page diverged materially, skip restore.
   */
  private restoreFromTurnCheckpoint(cp: TurnCheckpoint): boolean {
    return restoreFromTurnCheckpoint(this as unknown as TurnCheckpointHost, cp);
  }

  /**
   * Delete the turn checkpoint for this node (called on terminal states).
   */
  private async clearTurnCheckpoint(): Promise<void> {
    await clearTurnCheckpoint(this as unknown as TurnCheckpointHost);
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

    const repeatedAddItemBlock = assessRepeatedAddItemClick({
      toolName,
      args,
      snapshot: this.context.getSnapshot(),
      userRequest: this.originalQuery,
    });
    if (repeatedAddItemBlock) {
      this.log.warn(
        "agent",
        "Idempotency guard: blocked repeated add-item click",
        {
          turn: this.turnCount,
          tool: toolName,
          args: JSON.stringify(args).slice(0, 100),
        },
      );
      this.context.addMessage({
        role: "tool",
        tool_call_id: toolCallId,
        content: repeatedAddItemBlock,
      });
      return true;
    }

    const replay = lookupMutationReplay(
      this as unknown as LoopQueriesHost,
      toolName,
      args,
    );
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
    this.checkpoints.recordMutation({
      toolName,
      args,
      result,
      actionSnapshot,
      currentSnapshot: this.context.getSnapshot?.() ?? null,
      planIndex: this.lastPlanIndex,
      turn: this.turnCount,
    });
    if (!/^\s*(error|failed)\b/i.test(result)) {
      this.escalationRescue.recordVerifiedProgress(this.turnCount, "mutation");
    }
  }

  /** Verified-progress hook for plan-step advancement (loop-plan-progress host). */
  public recordVerifiedPlanAdvance(): void {
    this.escalationRescue.recordVerifiedProgress(
      this.turnCount,
      "plan_step_advance",
    );
  }

  /** Verified-progress hook for first visits to new URLs (post-tool snapshot host). */
  public recordVerifiedNewUrl(): void {
    this.escalationRescue.recordVerifiedProgress(this.turnCount, "new_url");
  }

  /** Forward queued escalation-rescue telemetry to the trace stream. */
  private flushEscalationRescueEvents(): void {
    for (const event of this.escalationRescue.drainEvents()) {
      this.traceRecorder?.recordEvent(event.type, event.data);
    }
  }

  /**
   * End the run after a failed escalation (RFC LP-2 efficacy guard): the
   * escalation produced no verified progress within the efficacy window, so
   * burning the remaining budget is waste. Surfaces a partial-progress
   * handoff so the orchestrator or user can restart with context.
   */
  private failFastAfterEscalation(reason: string): LoopResult {
    this.log.warn("agent", "Escalation rescue: failing fast", {
      turn: this.turnCount,
      reason,
    });
    const partialHandoff = this.buildMaxTurnPartialHandoff("escalation_failed");
    this.traceRecorder?.recordEvent("partial_handoff_created", {
      reason: partialHandoff.reason,
      turnsUsed: partialHandoff.turnsUsed,
      maxTurns: partialHandoff.maxTurns,
      completedCount: partialHandoff.completed.length,
      evidenceCount: partialHandoff.evidence.length,
      remainingCount: partialHandoff.remaining.length,
      handoff: partialHandoff,
    });
    const summary = formatPartialProgressHandoffSummary(partialHandoff);
    this.broadcast({
      type: "STREAM_CHUNK",
      payload: { delta: "", done: false, replaceContent: summary },
    });
    this.finishStream();
    this.statusHandler(
      AgentStatus.IDLE,
      "Stalled — escalation did not recover",
    );
    return {
      outcome: "max_turns" as const,
      turnCount: this.turnCount,
      summary,
      failure: {
        category: "stuck",
        code: "escalation_failed",
        detail: reason,
      },
      metrics: this.getMetrics(),
      partialHandoff,
    };
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
      | "trusted_list_sort_success"
      | "trusted_list_filter_success"
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
          citations: this.telemetry.getCitations(),
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
    options: {
      saveCheckpoint?: boolean;
      completionCandidate?: TrustedCompletionCandidate;
    } = {},
  ): void {
    if (this.completedResult) {
      return;
    }
    let completionEnvelope: CompletionEnvelope | undefined;
    const candidate = options.completionCandidate;
    if (candidate) {
      this.recordCompletionEvidence(candidate.evidence, "trusted_tool");
      this.traceRecorder?.recordEvent("completion_candidate", {
        turn: this.turnCount,
        source: "trusted_tool",
        contractKind: candidate.contractKind,
        confidence: "high",
      });
      completionEnvelope = this.createCompletionEnvelope({
        source: "trusted_tool",
        contractKind: candidate.contractKind,
        decisionReason: candidate.decisionReason,
        evidence: candidate.evidence,
        summary,
      });
      this.traceRecorder?.recordEvent("completion_decision", {
        turn: this.turnCount,
        status: "accepted",
        source: "trusted_tool",
        reason: candidate.decisionReason,
        contractKind: candidate.contractKind,
        resultId: completionEnvelope.resultId,
        evidenceKeys: completionEnvelope.evidenceKeys,
        completionEnvelope,
      });
      this.recordCompletionEnvelope(completionEnvelope);
    }
    this.completedResult = {
      outcome: "completed",
      summary,
      ...(completionEnvelope ? { completionEnvelope } : {}),
    };
    this.traceRecorder?.recordEvent("completion_state_transition", {
      turn: this.turnCount,
      from: "working",
      to: "completed",
      source: candidate ? "trusted_tool" : "direct_completion",
      ...(completionEnvelope
        ? {
            resultId: completionEnvelope.resultId,
            contractKind: completionEnvelope.contractKind,
          }
        : {}),
    });
    this.statusHandler(AgentStatus.IDLE, "Done");
    this.messageHandler(summary, []);
    if (options.saveCheckpoint !== false) {
      this.saveTurnCheckpoint().catch(() => {});
    }
  }

  private createCompletionEnvelope(params: {
    source: CompletionCandidateSource;
    contractKind: string;
    decisionReason: string;
    evidence?: CompletionEvaluation["evidence"];
    summary: string;
  }): CompletionEnvelope {
    return buildCompletionEnvelope({
      source: params.source,
      contractKind: params.contractKind,
      decisionReason: params.decisionReason,
      evidence: params.evidence ?? [],
      turn: this.turnCount,
      summary: params.summary,
    });
  }

  private createTrustedCompletionCandidate(params: {
    workflow: string;
    summary: string;
    reason: string;
    evidenceText?: string;
    recordId?: string;
    targetText?: string;
  }): TrustedCompletionCandidate {
    return buildTrustedCompletionCandidate({
      ...params,
      turn: this.turnCount,
      url: this.context.getCurrentUrl(),
    });
  }

  private recordCompletionEnvelope(
    envelope: CompletionEnvelope,
    metadata: Record<string, unknown> = {},
  ): void {
    this.traceRecorder?.recordEvent("completion_envelope_created", {
      turn: this.turnCount,
      ...envelope,
      ...metadata,
    });
  }

  private acceptDoneToolCall(
    summary: string,
    toolCallId: string,
    completionEnvelope: CompletionEnvelope,
  ): void {
    // Signal completion immediately - the orchestrator reads this after a lane
    // timeout to avoid retrying completed subtasks.
    this.completedResult = {
      outcome: "completed",
      summary,
      completionEnvelope,
    };
    this.recordCompletionEnvelope(completionEnvelope);
    this.traceRecorder?.recordEvent("completion_state_transition", {
      turn: this.turnCount,
      from: "working",
      to: "completed",
      source: "model_done",
      resultId: completionEnvelope.resultId,
      contractKind: completionEnvelope.contractKind,
    });

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
      annotateCompletedPlanSubtasksForAcceptedDone({
        subtasks: this.planSubtasks,
        summary,
      });

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

  private doneRejectionDiagnosticContent(params: {
    summary: string;
    primaryReason: string;
    fallbackInstruction: string;
    nextStepHint?: string;
  }): string {
    const nextStepHint = params.nextStepHint ?? "";
    if (this.doneRejections < 2) {
      return (
        `done() REJECTED: ${params.primaryReason}\n\n` +
        params.fallbackInstruction +
        nextStepHint
      );
    }

    const issues = collectDoneDiagnosticIssues(
      this as unknown as DoneDiagnosticsHost,
      params.summary,
    );
    if (!issues.some((issue) => issue.includes(params.primaryReason))) {
      issues.unshift(params.primaryReason);
    }
    const outstanding =
      issues.length > 0
        ? issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")
        : `1. ${params.primaryReason}`;

    return (
      `done() REJECTED (attempt ${this.doneRejections}/${this.limits.maxDoneRejections}). Outstanding:\n` +
      `${outstanding}\n\n` +
      "Fix all outstanding issues before calling done(). Take a concrete page action or call escalate() if the current approach cannot resolve them." +
      nextStepHint
    );
  }

  private getActiveCompletionContext(): {
    activeObjective?: string;
    successCriteria?: string;
  } {
    return getActiveCompletionContext(
      this as unknown as CompletionEvidenceHost,
    );
  }

  private recordCompletionEvidence(
    evidence: ReturnType<typeof deriveCompletionEvidenceFromSnapshot>,
    source: string,
  ): number {
    return recordCompletionEvidence(
      this as unknown as CompletionEvidenceHost,
      evidence,
      source,
    );
  }

  private refreshCompletionEvidenceFromSnapshot(source: string): void {
    refreshCompletionEvidenceFromSnapshot(
      this as unknown as CompletionEvidenceHost,
      source,
    );
  }

  private recordCompletionToolEvidence(
    toolName: ToolName,
    args: Record<string, unknown>,
    result: string,
    preActionSnapshot?: DomSnapshot | null,
  ): void {
    recordCompletionToolEvidence(
      this as unknown as CompletionEvidenceHost,
      toolName,
      args,
      result,
      preActionSnapshot,
    );
  }

  private evaluateCompletionCandidate(
    source: CompletionCandidateSource,
    summary: string,
  ): CompletionEvaluation {
    return evaluateCompletionCandidate(
      this as unknown as CompletionEvidenceHost,
      source,
      summary,
    );
  }

  private getCompletionRecoveryHintForCurrentState(): string | null {
    return getCompletionRecoveryHintForCurrentState(
      this as unknown as CompletionEvidenceHost,
    );
  }

  private maybeAddCompletionRecoveryHint(trigger: string): void {
    maybeAddCompletionRecoveryHint(
      this as unknown as CompletionEvidenceHost,
      trigger,
    );
  }

  private getPendingAutocompleteCompletionEvidence(
    decision: CompletionRejectionDecision,
  ): CompletionValidationErrorEvidence | undefined {
    return decision.evidence.find(
      (event): event is CompletionValidationErrorEvidence =>
        event.type === "validation_error" &&
        event.logicalKey.startsWith("form:autocomplete_pending:"),
    );
  }

  private getCompletionRejectionInstruction(
    decision: CompletionRejectionDecision,
  ): string {
    if (decision.status === "needs_verification") {
      return decision.hint;
    }

    const pendingAutocomplete =
      this.getPendingAutocompleteCompletionEvidence(decision);
    const suggestionTag = pendingAutocomplete?.detail.suggestionElementId;
    if (typeof suggestionTag === "number") {
      return `YOUR NEXT ACTION: click_element({"id": ${suggestionTag}}), then verify the selected value is visible.`;
    }

    switch (decision.contract.kind) {
      case "quiz_selection":
        return "Verify the current page state, repair the selected options if needed, then call done() again.";
      case "form_fill":
        return "Verify the current form state, select or repair the required field values, then call done() again.";
      case "draft_only":
        return "Verify the draft remains visible and unsent, repair the draft if needed, then call done() again.";
      case "navigation":
        return "Navigate to the requested page or verify the current URL, then call done() again.";
      case "read_answer":
        return "Read or verify the current page evidence, repair the answer summary if needed, then call done() again.";
      case "workflow_confirmation":
        return "Verify the requested workflow result is visible or structurally confirmed, repair any missing action, then call done() again.";
      default:
        return "Verify the current page state, repair the missing completion evidence, then call done() again.";
    }
  }

  /**
   * Build the deterministic-kernel-rejection effects (RFC LP-16 Phase 2 — single
   * completion authority): the mutations flow through the pipeline effect stream
   * instead of a side-effecting callback. post_rejection_diagnostic renders at
   * apply-time (after increment); the log + autocomplete `rejections` use the
   * post-increment value (`doneRejections + 1`), matching the prior ordering.
   */
  private buildKernelRejectionEffects(
    summary: string,
    decision: CompletionRejectionDecision,
  ): CompletionEffect[] {
    this.log.warn("agent", "DONE rejected by deterministic completion kernel", {
      turn: this.turnCount,
      rejections: this.doneRejections + 1,
      status: decision.status,
      reason: decision.reason,
      contractKind: decision.contract.kind,
    });
    const effects: CompletionEffect[] = [
      { type: "record_contract_rejection", kind: decision.contract.kind },
      { type: "increment_done_rejections" },
      { type: "check_done_rejection_escalation" },
      { type: "set_last_completion_rejection", decision },
      {
        type: "emit_trace",
        event: "completion_decision",
        data: {
          turn: this.turnCount,
          status: decision.status,
          source: "model_done",
          reason: decision.reason,
          contractKind: decision.contract.kind,
          evidenceKeys: decision.evidence.map((event) => event.logicalKey),
        },
      },
    ];
    const pendingAutocomplete =
      this.getPendingAutocompleteCompletionEvidence(decision);
    if (pendingAutocomplete) {
      effects.push({
        type: "emit_trace",
        event: "done_rejected_autocomplete_suggestion_pending",
        data: {
          rejections: this.doneRejections + 1,
          inputTag: pendingAutocomplete.detail.inputElementId,
          suggestionTag: pendingAutocomplete.detail.suggestionElementId,
          value: String(pendingAutocomplete.detail.value ?? "").toLowerCase(),
        },
      });
    }
    effects.push({
      type: "post_rejection_diagnostic",
      summary,
      primaryReason: decision.reason,
      fallbackInstruction: this.getCompletionRejectionInstruction(decision),
    });
    return effects;
  }

  /**
   * Concrete effect applier host (RFC LP-15, Phase 7b). Maps each declarative
   * CompletionEffect to the loop-side mutation it represents. Constructed per
   * done() call so the tool-message effects carry the current toolCallId and the
   * grounding refresh targets the current tab.
   */
  private createCompletionEffectHost(
    toolCallId: string,
    tabId: number,
  ): CompletionEffectHost {
    return {
      incrementDoneRejections: () => {
        this.doneRejections++;
      },
      recordContractRejection: (kind: string) => {
        if (this.lastContractRejectionKind === kind) {
          this.consecutiveSameKindRejections++;
        } else {
          this.lastContractRejectionKind = kind;
          this.consecutiveSameKindRejections = 1;
        }
      },
      setLastCompletionRejection: (decision) => {
        this.lastCompletionRejection = decision;
      },
      setRecoveryHint: (hint) => {
        this.lastCompletionRecoveryHint = hint;
      },
      postContextMessage: (role, content) => {
        this.context.addMessage(
          role === "tool"
            ? { role: "tool", tool_call_id: toolCallId, content }
            : { role: "user", content },
        );
      },
      postRejectionDiagnostic: (
        summary,
        primaryReason,
        fallbackInstruction,
      ) => {
        this.context.addMessage({
          role: "tool",
          tool_call_id: toolCallId,
          content: this.doneRejectionDiagnosticContent({
            summary,
            primaryReason,
            fallbackInstruction,
          }),
        });
      },
      emitTrace: (event, data) => {
        this.traceRecorder?.recordEvent(event, data);
      },
      setGuardAfterDoneRejection: () => {
        this.guardAfterDoneRejection = true;
      },
      checkDoneRejectionEscalation: () => {
        this.checkAndSetDoneRejectionEscalation();
      },
      forceGroundingRefresh: async () => {
        await this.forceGroundingRefresh(tabId, "done_before_grounding_read");
      },
      runDonePlanRejection: (id, summary, rejectReason, idx) =>
        runDonePlanRejection(
          this as unknown as DonePlanRejectionHost,
          id,
          summary,
          rejectReason,
          idx,
        ),
    };
  }

  /**
   * Golden-harness tap (RFC LP-15, Phase 0). When decision recording is off
   * (production default) this is a straight pass-through. When on, it captures
   * the input surface BEFORE the decision runs (counters/evidence are mutated
   * inside), then records `(input -> outcome)` for the replay corpus. The tap
   * is the single choke point so completion behaviour has exactly one recorder.
   */
  private async handleDoneToolCall(
    toolCallId: string,
    summary: string,
    tabId: number,
  ): Promise<boolean> {
    if (!isCompletionDecisionRecordingEnabled()) {
      return this.handleDoneToolCallInner(toolCallId, summary, tabId);
    }
    const input = this.captureCompletionDecisionInput(summary);
    const verdict = await this.handleDoneToolCallInner(
      toolCallId,
      summary,
      tabId,
    );
    try {
      this.recordCompletionDecisionOutcome(input, verdict);
    } catch (err) {
      this.log.warn("agent", "completion decision recording failed", {
        turn: this.turnCount,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return verdict;
  }

  /**
   * Snapshot the completion decision input surface as the kernel will see it,
   * without mutating loop state. Evidence is projected (current ledger +
   * snapshot-derived) to mirror the refresh `handleDoneToolCallInner` performs.
   */
  private captureCompletionDecisionInput(
    summary: string,
  ): CompletionDecisionRecordInput {
    const snapshot = this.context.getSnapshot() ?? null;
    const completionContext = this.getActiveCompletionContext();
    const runningSubtaskIndex = this.planSubtasks.findIndex(
      (step) => step.status === "running",
    );
    return {
      userRequest: this.originalQuery,
      summary,
      candidateSource: "model_done",
      activeObjective: completionContext.activeObjective,
      successCriteria: completionContext.successCriteria,
      snapshot,
      snapshotDigest: computeSnapshotDigest(snapshot),
      evidence: projectKernelEvidence(
        this.completionEvidence.toArray(),
        snapshot,
        this.turnCount,
      ),
      counters: {
        turnCount: this.turnCount,
        doneRejections: this.doneRejections,
        consecutiveSameKindRejections: this.consecutiveSameKindRejections,
        lastContractRejectionKind: this.lastContractRejectionKind ?? null,
      },
      planValidation: {
        hasPlan: Boolean(this.taskId) && this.planSubtasks.length > 0,
        planSubtaskCount: this.planSubtasks.length,
        runningSubtaskIndex,
      },
      guardContext: this.buildCompletionGuardContext(
        summary,
        snapshot,
        completionContext,
        runningSubtaskIndex,
      ),
      isDuplicateTerminal: Boolean(this.completedResult),
      // Filled post-inner in recordCompletionDecisionOutcome.
      plannerResult: null,
    };
  }

  /**
   * Assemble the pure-guard input surface from live loop state (RFC LP-15,
   * Phase 7a). Captured pre-inner so counters/evidence are unmutated; because
   * legacy stops at the first rejecting guard, no guard bumps `doneRejections`
   * before the decider, so a single snapshot is faithful for the whole chain.
   * (The ServiceNow evidence inference is a live-only pre-step; the corpus is
   * generic so `missingRequiredEvidence` is inference-independent there.)
   */
  private buildCompletionGuardContext(
    summary: string,
    snapshot: DomSnapshot | null,
    completionContext: { activeObjective?: string; successCriteria?: string },
    runningSubtaskIndex: number,
  ): CompletionGuardContext {
    const incompleteMoneyTableScan =
      this.getIncompleteMoneyTableAggregateDoneRejection();
    return {
      summary,
      userRequest: this.originalQuery,
      snapshot,
      taskContext: this.getCompletionSummaryTaskContext(),
      turnCount: this.turnCount,
      isOrchestratorNode: Boolean(this.nodeId),
      doneRejections: this.doneRejections,
      maxDoneRejections: this.limits.maxDoneRejections,
      consecutiveSameKindRejections: this.consecutiveSameKindRejections,
      lastContractRejectionKind: this.lastContractRejectionKind ?? null,
      planSubtaskCount: this.planSubtasks.length,
      runningSubtaskIndex,
      selectedSkillId: this.selectedSkillId,
      hasReadPage: this.hasReadPage,
      hasExplicitPageRead: this.hasExplicitPageRead,
      hasTaskId: Boolean(this.taskId),
      missingRequiredEvidence: this.getMissingRequiredEvidenceTypes(),
      activeObjective: completionContext.activeObjective,
      successCriteria: completionContext.successCriteria,
      listDetailReviewedCount: this.listDetailReviewedTargets.size,
      listDetailOpenedCount: this.listDetailOpenedTargets.size,
      listDetailVisibleActionCount: Math.max(
        this.listDetailVisibleActionCount,
        countVisibleListDetailActions(snapshot),
      ),
      moneyTableIncompleteScanReason: incompleteMoneyTableScan,
      moneyTableIncorrectAnswerReason: incompleteMoneyTableScan
        ? null
        : this.getIncorrectMoneyTableAggregateDoneRejection(summary),
    };
  }

  /** Build and store a decision record from the captured input and verdict. */
  private recordCompletionDecisionOutcome(
    input: CompletionDecisionRecordInput,
    verdict: boolean,
  ): void {
    // The planner result is only known after the inner decision runs.
    input.plannerResult = this.lastDonePlanValidation;
    let basis: CompletionDecisionBasis = "unknown";
    let contractKind = "unknown";
    let reason = "";
    const envelope = this.completedResult?.completionEnvelope;
    if (verdict && envelope) {
      contractKind = envelope.contractKind;
      reason = envelope.decisionReason;
      basis =
        envelope.contractKind === "legacy_done_guards"
          ? "legacy_done_guards"
          : this.completionEvidence.toArray().length === 0 &&
              envelope.decisionReason ===
                "duplicate_done_after_terminal_completion"
            ? "duplicate_terminal"
            : "kernel";
    } else if (!verdict) {
      const rejection = this.lastCompletionRejection;
      basis = "kernel_reject";
      contractKind =
        rejection && rejection.status !== "accepted"
          ? (rejection.contract?.kind ?? "unknown")
          : "unknown";
      reason =
        rejection && rejection.status !== "accepted"
          ? rejection.reason
          : "rejected_by_legacy_guard";
    }
    recordCompletionDecision(
      buildCompletionDecisionRecord({
        recordedAtTurn: input.counters.turnCount,
        input,
        verdict: verdict ? "accepted" : "rejected",
        basis,
        contractKind,
        guardId: verdict
          ? null
          : contractKind === "unknown"
            ? null
            : contractKind,
        reason,
        recoveryHint: this.lastCompletionRecoveryHint ?? null,
      }),
    );
  }

  private async handleDoneToolCallInner(
    toolCallId: string,
    summary: string,
    tabId: number,
  ): Promise<boolean> {
    this.lastDonePlanValidation = null;
    if (this.completedResult) {
      const completedSummary = this.completedResult.summary;
      const completionEnvelope = this.completedResult.completionEnvelope;
      this.traceRecorder?.recordEvent("completion_decision", {
        turn: this.turnCount,
        status: "accepted",
        reason: "duplicate_done_after_terminal_completion",
        source: "model_done",
        ...(completionEnvelope
          ? {
              resultId: completionEnvelope.resultId,
              contractKind: completionEnvelope.contractKind,
              evidenceKeys: completionEnvelope.evidenceKeys,
              completionEnvelope,
            }
          : {}),
      });
      this.context.addMessage({
        role: "tool",
        tool_call_id: toolCallId,
        content: completedSummary,
      });
      return true;
    }

    // Authority: the pure completion pipeline decides (RFC LP-15, Phase 7b).
    // The frozen kernel is evaluated lazily inside the pipeline (after summary +
    // grounding pass) so its side-effects (evidence refresh, candidate traces,
    // lastCompletionRejection) fire at the legacy point. The planner stage keeps
    // its bespoke rejection handling (retry_step / auto-advance) via the injected
    // dep. Declarative reject-side effects are applied by the effect host; the
    // accept side maps the decision basis to an envelope + acceptDoneToolCall.
    // ServiceNow module-navigation evidence inference (live pre-step, RFC LP-15
    // Phase 7b): legacy ran this inside rejectDoneForMissingRequiredEvidence
    // before evaluating; run it before the guard context is built so the
    // missing-evidence guard sees the post-inference evidence.
    if (this.getMissingRequiredEvidenceTypes().length > 0) {
      maybeInferServiceNowModuleNavigationEvidence(
        this as unknown as ModuleNavEvidenceHost,
        summary,
      );
    }

    const snapshot = this.context.getSnapshot() ?? null;
    const completionContext = this.getActiveCompletionContext();
    const runningSubtaskIndex = this.planSubtasks.findIndex(
      (step) => step.status === "running",
    );
    const ctx = this.buildCompletionGuardContext(
      summary,
      snapshot,
      completionContext,
      runningSubtaskIndex,
    );

    let kernelDecision: CompletionEvaluation | null = null;
    const decision = await runCompletionPipeline(ctx, {
      getKernelDecision: () => {
        kernelDecision = this.evaluateCompletionCandidate(
          "model_done",
          summary,
        );
        return kernelDecision;
      },
      isDuplicateTerminal: false, // handled inline above
      validatePlan: () => this.runDonePlanValidation(toolCallId, summary),
      buildKernelRejectionEffects: (decision) =>
        // Only invoked on a kernel rejection, so the evaluation is a rejection.
        this.buildKernelRejectionEffects(
          summary,
          decision as CompletionRejectionDecision,
        ),
      buildPlanRejectionEffects: (plan) => [
        {
          type: "run_done_plan_rejection",
          toolCallId,
          summary,
          rejectReason: plan.reason,
          effectiveCurrentIdx: plan.effectiveCurrentIdx ?? -1,
        },
      ],
    });

    await applyCompletionEffects(
      decision.effects,
      this.createCompletionEffectHost(toolCallId, tabId),
    );

    if (decision.verdict === "reject") return false;
    return this.acceptFromPipelineDecision(
      decision,
      summary,
      toolCallId,
      kernelDecision,
    );
  }

  /**
   * Run the plan-validation stage as the pipeline's injected dep (RFC LP-15,
   * Phase 7b). Preserves the legacy precheck → model-validation → bespoke
   * handleDonePlanRejection flow; the rejection effects are applied here (not as
   * pipeline effects), so the pipeline's planner reject carries none. Returns
   * null when no plan applies.
   */
  private async runDonePlanValidation(
    toolCallId: string,
    summary: string,
  ): Promise<PlannerValidationResult | null> {
    if (!(this.taskId && this.planSubtasks.length > 0)) {
      this.lastDonePlanValidation = null;
      return null;
    }
    const host = this as unknown as DonePlanValidationHost;
    const donePlanPrecheck = evaluateDonePlanPrecheck(host, summary);
    let shouldReject = donePlanPrecheck.shouldReject;
    let rejectReason = donePlanPrecheck.rejectReason;
    const effectiveCurrentIdx = donePlanPrecheck.effectiveCurrentIdx;
    const completedMoneyTableAggregate =
      donePlanPrecheck.completedMoneyTableAggregate;

    ({ shouldReject, rejectReason } = await evaluateDonePlanValidation(
      host,
      summary,
      effectiveCurrentIdx,
      completedMoneyTableAggregate,
      shouldReject,
      rejectReason,
    ));

    this.lastDonePlanValidation = {
      rejected: shouldReject,
      reason: rejectReason ?? "",
    };

    if (shouldReject) {
      // Single-authority (RFC LP-16 Phase 2): don't apply the policy inline —
      // the pipeline carries a run_done_plan_rejection effect built from this.
      return {
        rejected: true,
        reason: rejectReason ?? "",
        effectiveCurrentIdx,
      };
    }
    return { rejected: false, reason: "" };
  }

  /**
   * Map an accepting pipeline decision to the loop-side accept actions (RFC
   * LP-15, Phase 7b): build the completion envelope for the deciding basis, emit
   * the completion_decision trace, and finalize via acceptDoneToolCall.
   */
  private acceptFromPipelineDecision(
    decision: CompletionPipelineDecision,
    summary: string,
    toolCallId: string,
    kernelDecision: CompletionEvaluation | null,
  ): boolean {
    if (decision.basis === "kernel" && kernelDecision?.status === "accepted") {
      const completionEnvelope = this.createCompletionEnvelope({
        source: "model_done",
        contractKind: kernelDecision.contract.kind,
        decisionReason: kernelDecision.reason,
        evidence: kernelDecision.evidence,
        summary,
      });
      this.traceRecorder?.recordEvent("completion_decision", {
        turn: this.turnCount,
        status: "accepted",
        source: "model_done",
        reason: kernelDecision.reason,
        contractKind: kernelDecision.contract.kind,
        resultId: completionEnvelope.resultId,
        evidenceKeys: kernelDecision.evidence.map((event) => event.logicalKey),
        completionEnvelope,
      });
      this.acceptDoneToolCall(summary, toolCallId, completionEnvelope);
      return true;
    }

    const completionEnvelope = this.createCompletionEnvelope({
      source: "model_done",
      contractKind: "legacy_done_guards",
      decisionReason: "legacy_done_guards_passed",
      evidence: this.completionEvidence.toArray(),
      summary,
    });
    this.traceRecorder?.recordEvent("completion_decision", {
      turn: this.turnCount,
      status: "accepted",
      source: "model_done",
      reason: "legacy_done_guards_passed",
      resultId: completionEnvelope.resultId,
      contractKind: completionEnvelope.contractKind,
      evidenceKeys: completionEnvelope.evidenceKeys,
      completionEnvelope,
    });
    this.acceptDoneToolCall(summary, toolCallId, completionEnvelope);
    return true;
  }

  private getCompletionSummaryTaskContext(): string {
    const runningIdx = this.planSubtasks.findIndex(
      (step) => step.status === "running",
    );
    return [
      this.originalQuery,
      runningIdx >= 0 ? this.planSubtasks[runningIdx]?.description : undefined,
      runningIdx >= 0 ? this.planSteps[runningIdx]?.successCriteria : undefined,
    ]
      .filter(
        (part): part is string => typeof part === "string" && part.length > 0,
      )
      .join("\n");
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

  private updatePartialProgressState(lastAction?: string): void {
    updateProgressLedgerState(
      this.progressLedger,
      this.context.getSnapshot?.() ?? null,
      getActiveSubtaskDescription(this as unknown as LoopQueriesHost),
      lastAction,
    );
  }

  public recordPartialProgressToolResult(
    toolName: ToolName,
    args: Record<string, unknown>,
    result: string,
  ): void {
    const lastAction = formatStepLabel(toolName, args, this.elementResolver);
    this.updatePartialProgressState(lastAction);
    recordProgressLedgerToolResult(this.progressLedger, {
      toolName,
      args,
      result,
      turn: this.turnCount,
      url: this.context.getCurrentUrl?.() || this.context.getSnapshot()?.url,
    });
  }

  private buildMaxTurnPartialHandoff(
    reason: PartialHandoffReason = "max_turns",
  ): PartialProgressHandoff {
    this.updatePartialProgressState();
    return buildPartialProgressHandoff({
      ledger: this.progressLedger,
      task: this.originalQuery,
      reason,
      turnsUsed: this.turnCount,
      maxTurns: this.maxTurns,
    });
  }

  private broadcastPlanTermination(
    outcome: "stopped" | "max_turns" | "error",
    summary: string,
    partialHandoff?: PartialProgressHandoff,
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
      partialHandoff,
    });
    if (message) this.broadcast(message);
  }

  private async requestApproval(
    toolName: ToolName,
    args: Record<string, unknown>,
    context: string,
    dryRun?: ForwardedApprovalDryRun,
  ): Promise<boolean> {
    const interaction = getMatchingApprovalInteraction(
      this as unknown as LoopQueriesHost,
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
      ...(dryRun ? { dryRun } : {}),
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
    const interaction = getMatchingClarificationInteraction(
      this as unknown as LoopQueriesHost,
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

  /**
   * Dry-run gate for a consequential form submit (RFC LP-15, Phase 8). Captures
   * the live form state via extract_form_state and diffs it against the approved
   * draft (the form_fill contract's required fields). A clean diff means the form
   * holds exactly the intended values → the submit auto-approves; an unexpected
   * diff routes to human approval carrying the rendered diff. `no_draft` (not a
   * form-fill task, or capture failed) leaves the normal approval gate unchanged.
   */
  private async runFormSubmitDryRun(
    toolName: ToolName,
    args: Record<string, unknown>,
    tabId: number,
  ): Promise<DryRunClassification> {
    // Relocated to form-submit-dry-run.ts (loop ratchet, pi-backend Phase 4).
    return runFormSubmitDryRun(
      this as unknown as FormSubmitDryRunHost,
      toolName,
      args,
      tabId,
    );
  }

  private async ensureToolApproval(
    toolName: ToolName,
    args: Record<string, unknown>,
    riskLevel: RiskLevel,
    forceApproval = false,
    dryRun?: ForwardedApprovalDryRun,
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
    const approved = await this.requestApproval(toolName, args, context, dryRun);
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

  public getConsequentialActionTaskText(): string {
    return buildConsequentialActionTaskText({
      planStatus: this.context.getPlanStatusRaw(),
      planSubtasks: this.planSubtasks,
      planSteps: this.planSteps,
      lastPlanIndex: this.lastPlanIndex,
      originalQuery: this.originalQuery,
    });
  }

  public recordCachedVisionUsage(): void {
    this.telemetry.recordCachedVisionUse();
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
    this.escalationRescue.reset();
    this.pendingFeedback = null;
    this.taskId = null;
    this.planSubtasks = [];
    this.planSteps = [];
    this.planRequiresTabManagement = false;
    this.progressLedger = createProgressLedger();
    this.taskStartTime = Date.now();
    this.urlHistory = [];
    this.doneRejections = 0;
    this.pendingDoneRejectionEscalation = false;
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
    this.lastCompletionRejection = null;
    this.lastCompletionRecoveryHint = null;
    this.completionEvidence.clear();
    this.completedResult = null;
    this.perception.reset();
    this.telemetry.reset();
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
        const restoredCompletion = cp.completedResult ?? null;
        if (restoredCompletion) {
          this.traceRecorder?.recordEvent("completion_resume_short_circuit", {
            turn: this.turnCount,
            nodeId: this.nodeId,
            resultId: restoredCompletion.completionEnvelope?.resultId,
            contractKind: restoredCompletion.completionEnvelope?.contractKind,
          });
          this.statusHandler(AgentStatus.IDLE, "Done");
          this.messageHandler(restoredCompletion.summary, []);
          const result: LoopResult = {
            outcome: "completed",
            turnCount: this.turnCount,
            summary: restoredCompletion.summary,
            failure: { category: "none", code: "none" },
            metrics: this.getMetrics(),
            completionEnvelope: restoredCompletion.completionEnvelope,
          };
          try {
            return result;
          } finally {
            await this.finalizeLoopStartResult(result);
          }
        }
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
    const warmupScreenshot = initialSnapshotResolution.warmupScreenshot;

    const perceptionDecision = resolvePerceptionRuntimeModeDecision({
      perceptionMode: this.perceptionModeOption,
      providerMode: this.providerModeOption,
      executorVLCapable: this.executorVLCapable,
      taskText: initialUserText ?? "",
      imagePromptTokensUsed: this.telemetry.imagePromptTokensUsed,
      maxImagePromptTokens: this.telemetry.imagePromptTokenBudget,
      // Conservative high-detail estimate; the final runtime gates enforce the
      // same cap before any screenshot-backed prompt is sent.
      nextImagePromptTokenEstimate: imagePromptUsageForCount(1).estimatedTokens,
      ...extractPerceptionPageSignals(snapshot),
    });
    this.useVLExecutor = perceptionDecision.mode === "unified_vl";
    const autoDefault = PERCEPTION_AUTO_DEFAULT_MODE;
    this.telemetry.recordPerceptionMode(perceptionDecision, autoDefault);
    this.log.info("agent", "Resolved perception runtime mode", {
      mode: perceptionDecision.mode,
      reason: perceptionDecision.reason,
      signals: perceptionDecision.signals,
    });
    this.traceRecorder?.recordEvent("perception_mode_decision", {
      mode: perceptionDecision.mode,
      reason: perceptionDecision.reason,
      signals: perceptionDecision.signals,
      autoDefault,
    });

    if (snapshot) {
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
      } else if (this.useVLExecutor && warmupScreenshot) {
        // Warmup screenshot present but the image budget is exhausted.
        this.recordImagePromptBudgetExhausted(1, "vl_warmup_screenshot");
        this.context.setScreenshotForExecutor(null);
        this.context.setPageInterpretation(null);
        this.perception.setScreenshotUrl(null);
      } else {
        // No usable warmup — run the normal perception refresh.
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
      getCompletedResult: () => this.completedResult,
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
      await this.finalizeLoopStartResult(result);
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

  /**
   * Check whether a done() rejection mid-point has been reached and we should
   * escalate to planner mode on the next main-loop tick.
   * Only fires when we have not already escalated (executor tier only) and the
   * task has a meaningful rejection budget (≥ 2 allowed rejections).
   */

  /**
   * Called after every doneRejections++ to schedule a planner escalation when
   * the mid-point threshold is crossed.  The actual escalation happens in the
   * main loop so that escalationTier (a loop-local variable) is updated there.
   */
  private checkAndSetDoneRejectionEscalation(): void {
    if (!shouldEscalateOnDoneRejection(this as unknown as LoopQueriesHost))
      return;
    this.pendingDoneRejectionEscalation = true;
    this.traceRecorder?.recordEvent("done_rejection_escalation", {
      doneRejections: this.doneRejections,
      maxDoneRejections: this.limits.maxDoneRejections,
    } as Record<string, unknown>);
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
    const tabs = await getWorkspaceTabs(this as unknown as LoopQueriesHost);
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
    this.checkpoints.clearReplayState();

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

  public getActiveToolNamesForTurn(): ToolName[] {
    return [...this.activeToolNamesForTurn];
  }

  /** Extracted to capture-guard.ts (LP-24) — quota retry lives there. */
  private async captureVisibleTabWithRetry(
    windowId: number,
    options: { format?: "jpeg" | "png"; quality?: number },
  ): Promise<string> {
    return captureVisibleTabWithQuotaRetry(windowId, options, this.log);
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
   * Refresh perception then auto-dismiss nuisance popups identified in BLOCKERS.
   * Use this instead of bare `refreshPerception()` at all call sites.
   */
  private updatePerceptionRuntimeModeFromSnapshot(
    snapshot: DomSnapshot | null | undefined,
  ): void {
    if (!snapshot) return;

    const decision = resolvePerceptionRuntimeModeDecision({
      perceptionMode: this.perceptionModeOption,
      providerMode: this.providerModeOption,
      executorVLCapable: this.executorVLCapable,
      taskText: this.originalQuery ?? "",
      imagePromptTokensUsed: this.telemetry.imagePromptTokensUsed,
      maxImagePromptTokens: this.telemetry.imagePromptTokenBudget,
      nextImagePromptTokenEstimate: imagePromptUsageForCount(1).estimatedTokens,
      ...extractPerceptionPageSignals(snapshot),
    });
    const previousMode = this.useVLExecutor ? "unified_vl" : "structured";
    this.useVLExecutor = decision.mode === "unified_vl";
    const autoDefault = PERCEPTION_AUTO_DEFAULT_MODE;
    this.telemetry.recordPerceptionMode(decision, autoDefault);

    if (previousMode === decision.mode) return;

    this.log.info("agent", "Updated perception runtime mode", {
      previousMode,
      mode: decision.mode,
      reason: decision.reason,
      signals: decision.signals,
    });
    this.traceRecorder?.recordEvent("perception_mode_decision", {
      mode: decision.mode,
      previousMode,
      reason: decision.reason,
      signals: decision.signals,
      dynamic: true,
      autoDefault,
    });
  }

  private async refreshPerceptionAndTriage(tabId: number): Promise<void> {
    // LP-13 guardrail: a staged zoom never crosses the turn boundary.
    this.context.setRegionZoomForExecutor(null);
    this.updatePerceptionRuntimeModeFromSnapshot(this.context.getSnapshot());
    this.telemetry.recordPerceptionTurn(
      this.useVLExecutor ? "unified_vl" : "structured",
    );
    if (this.useVLExecutor) {
      // Unified VL mode: capture screenshot for the executor, skip perception VLM call.
      // The executor LLM receives the screenshot directly as an image content block.
      await this.captureScreenshotForVLExecutor(tabId);
      // Skip triagePopups — executor sees overlays in screenshot and calls dismiss_overlays.
      return;
    }
    // Text-only turn: no screenshot and no separate perception model. The
    // executor works from the DOM element summary and dismisses overlays
    // itself (via dismiss_overlays).
    this.context.setScreenshotForExecutor(null);
    this.context.setPageInterpretation(null);
  }

  /** Capture screenshot and store for VL executor injection (no perception VLM call).
   *  Body extracted to agent/vl-screenshot.ts (LP-17b CM-5), which also reuses
   *  the previous screenshot when the page fingerprint is unchanged. */
  private async captureScreenshotForVLExecutor(tabId: number): Promise<void> {
    return captureVLExecutorScreenshot(
      this as unknown as VLScreenshotHost,
      tabId,
      this.vlScreenshotState,
    );
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

    if (this.replanCount >= this.limits.maxReplans) {
      this.log.warn("agent", "Plan deviation detected but replan cap reached", {
        replanCount: this.replanCount,
        maxReplans: this.limits.maxReplans,
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
    if (this.replanCount >= this.limits.maxReplans) {
      this.log.info("agent", "replanOnEscalation: cap reached", {
        replanCount: this.replanCount,
        maxReplans: this.limits.maxReplans,
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
    this.doneRejections = 0;
    this.lastContractRejectionKind = undefined;
    this.consecutiveSameKindRejections = 0;
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

  /** Build the narrow host inspect_region runs against (LP-13). */
  private buildRegionZoomHost(tabId: number): RegionZoomHost {
    return {
      turnCount: this.turnCount,
      useVLExecutor: this.useVLExecutor,
      getSnapshot: () => this.context.getSnapshot(),
      imagePromptBudgetAllows: (imageCount) =>
        this.imagePromptBudgetAllows(imageCount),
      recordImagePromptBudgetExhausted: (imageCount, source) =>
        this.recordImagePromptBudgetExhausted(imageCount, source),
      captureVisibleTab: async (options) =>
        withPresenceSuspended(tabId, async () => {
          const tab = await chrome.tabs.get(tabId);
          return this.captureVisibleTabWithRetry(tab.windowId, options);
        }),
      resolveTagRect: async (id) => {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: (tagId: number) => {
              const el = document.querySelector(`[data-os-tag="${tagId}"]`);
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return { x: r.x, y: r.y, width: r.width, height: r.height };
            },
            args: [id],
          });
          const live = results?.[0]?.result;
          if (live) return live;
        } catch {
          // Fall through to the snapshot rect (may be stale after scroll).
        }
        const el = this.context
          .getSnapshot()
          ?.elements.find((element) => element.tag === id);
        return el
          ? {
              x: el.rect.x,
              y: el.rect.y,
              width: el.rect.width,
              height: el.rect.height,
            }
          : null;
      },
      recordInspectRegionEvent: (data) =>
        this.traceRecorder?.recordEvent("inspect_region", data),
      setRegionZoomForExecutor: (zoom) =>
        this.context.setRegionZoomForExecutor(zoom),
    };
  }

  /** Execute a tool call via the tool registry. */
  private async executeToolCall(
    toolCall: ToolCall,
    tabId: number,
  ): Promise<string> {
    // LP-13: inspect_region needs loop-owned state (screenshot cache
    // metadata, zoom cap, budget, delivery) — intercept before the registry
    // so both the sequential and parallel dispatch paths are covered.
    if (toolCall.function.name === ToolName.INSPECT_REGION) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        // Empty args fail validation inside with a bad_args refusal.
      }
      return executeInspectRegion(
        this.buildRegionZoomHost(tabId),
        this.regionZoomState,
        args,
        tabId,
      );
    }
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
      this.escalationRescue.recordVerifiedProgress(
        this.turnCount,
        "trusted_evidence",
      );
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
  }): {
    finalSummary: string;
    newIndex: number;
    completionCandidate: TrustedCompletionCandidate;
  } | null {
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
      const shortDirection = sort.direction === "ascending" ? "asc" : "desc";
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
    const completionCandidate = this.createTrustedCompletionCandidate({
      workflow: "list_sort",
      summary: finalSummary,
      reason: "Trusted list sort tool result matched the requested sort.",
      evidenceText: params.toolResult,
    });

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
      return { finalSummary, newIndex: 0, completionCandidate };
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
    return { finalSummary, newIndex, completionCandidate };
  }

  private maybeCompleteTrustedListFilterStep(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    mode: "parallel" | "sequential";
  }): {
    finalSummary: string;
    newIndex: number;
    completionCandidate: TrustedCompletionCandidate;
  } | null {
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
        const value = condition.value.length > 0 ? ` ${condition.value}` : "";
        return `${condition.field} ${condition.operator}${value}`;
      })
      .join("; ");
    const finalSummary = `Applied list filter: ${conditionSummary}. Evidence: ${queryLine}`;
    const completionCandidate = this.createTrustedCompletionCandidate({
      workflow: "list_filter",
      summary: finalSummary,
      reason: "Trusted list filter tool result matched the requested filter.",
      evidenceText: params.toolResult,
    });

    const plan = this.context.getPlanStatusRaw();
    if (
      !plan ||
      plan.currentIndex < 0 ||
      plan.currentIndex >= plan.subtasks.length
    ) {
      if (!isPureListFilterWorkflowRequest(this as unknown as LoopQueriesHost))
        return null;
      this.log.info(
        "agent",
        "trusted list filter completed planless workflow",
        {
          turn: this.turnCount,
          mode: params.mode,
          conditionCount: conditions.length,
        },
      );
      this.traceRecorder?.recordEvent("trusted_list_filter_success", {
        fromStep: -1,
        toStep: 0,
        reason: finalSummary,
        trustedTool: params.toolName,
        mode: params.mode,
        completedAllSteps: true,
        planless: true,
      });
      return { finalSummary, newIndex: 0, completionCandidate };
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
    return { finalSummary, newIndex, completionCandidate };
  }

  // --- ServiceNow record-form controller (quarantined adapter) ---
  // Thin delegates into ./servicenow/record-form-controller.ts; the loop
  // passes itself as the dispatch host (every host member is a real loop
  // field/method).

  private hasTrustedServiceNowSubmitIntent(text?: string): boolean {
    return hasTrustedServiceNowSubmitIntent(
      this as unknown as ServiceNowRecordFormHost,
      text,
    );
  }

  private isTaskLevelServiceNowRecordWorkflow(): boolean {
    return isTaskLevelServiceNowRecordWorkflow(
      this as unknown as ServiceNowRecordFormHost,
    );
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
    startServiceNowRecordControllerTraceTurn(
      this as unknown as ServiceNowRecordFormHost,
      fields.length,
    );
    const executeAtomicToolCall = async (idPrefix: string): Promise<string> => {
      const toolCall: ToolCall = {
        id: `${idPrefix}_${crypto.randomUUID()}`,
        type: "function",
        function: {
          name: preferredTool,
          arguments: JSON.stringify(args),
        },
      } as ToolCall;
      const startedAt = Date.now();
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
      return result;
    };

    this.traceRecorder?.recordEvent("atomic_skill_controller_started", {
      turn: this.turnCount,
      selectedSkillId: contract.id,
      preferredTool,
    });
    let result = await executeAtomicToolCall("atomic");
    if (
      preferredTool === ToolName.OPEN_SERVICENOW_MODULE &&
      this.getMissingRequiredEvidenceTypes().length > 0 &&
      isRetryableServiceNowModuleControllerMiss(result)
    ) {
      this.traceRecorder?.recordEvent("atomic_skill_controller_retry", {
        turn: this.turnCount,
        selectedSkillId: contract.id,
        preferredTool,
      });
      await waitForDomReady(tabId, {
        timeoutMs: 1500,
        waitForElements: true,
      });
      result = await executeAtomicToolCall("atomic_retry");
    }

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
    this.completeTaskResult(finalSummary, {
      completionCandidate: this.createTrustedCompletionCandidate({
        workflow: "atomic_skill_controller",
        summary: finalSummary,
        reason: "Atomic skill controller completed with required evidence.",
        evidenceText: result,
        recordId: recordSummary,
      }),
    });
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
      completionEnvelope: this.completedResult?.completionEnvelope,
    };
  }

  private assessServiceNowMissingFieldInfeasibility(
    toolOutcomes: TurnToolOutcomeRecord[],
    searchEvidence: Map<string, ServiceNowMissingFieldSearchEvidence>,
  ): string | null {
    return assessServiceNowMissingFieldInfeasibility(
      this as unknown as ServiceNowRecordFormHost,
      toolOutcomes,
      searchEvidence,
    );
  }

  private getServiceNowMissingFieldAdmissionSummary(
    text: string | null,
  ): string | null {
    return getServiceNowMissingFieldAdmissionSummary(
      this as unknown as ServiceNowRecordFormHost,
      text,
    );
  }

  private async maybeRunServiceNowRecordFormController(
    tabId: number,
  ): Promise<LoopResult | null> {
    return maybeRunServiceNowRecordFormController(
      this as unknown as ServiceNowRecordFormHost,
      tabId,
    );
  }

  private shouldAutoSubmitTrustedServiceNowForm(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
  }): boolean {
    return shouldAutoSubmitTrustedServiceNowForm(
      this as unknown as ServiceNowRecordFormHost,
      params,
    );
  }

  private async maybeAutoSubmitTrustedServiceNowForm(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    tabId: number;
    mode: "parallel" | "sequential";
  }): Promise<{
    finalSummary: string;
    newIndex: number;
    completionCandidate: TrustedCompletionCandidate;
  } | null> {
    return maybeAutoSubmitTrustedServiceNowForm(
      this as unknown as ServiceNowRecordFormHost,
      params,
    );
  }

  private maybeCompleteTrustedFormSubmitStep(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    mode: "parallel" | "sequential";
  }): {
    finalSummary: string;
    newIndex: number;
    completionCandidate: TrustedCompletionCandidate;
  } | null {
    const signal = detectTrustedFormSubmitCompletion({
      toolName: params.toolName,
      toolArgs: params.toolArgs,
      toolResult: params.toolResult,
    });
    if (!signal) return null;
    const completionCandidate = this.createTrustedCompletionCandidate({
      workflow: "form_submit",
      summary: signal.reason,
      reason: "Trusted form submit tool result confirmed submission.",
      evidenceText: params.toolResult,
      recordId: signal.submittedRecord,
      targetText: signal.submittedRecord,
    });

    const plan = this.context.getPlanStatusRaw();
    if (
      !plan ||
      plan.currentIndex < 0 ||
      plan.currentIndex >= plan.subtasks.length
    ) {
      if (
        this.selectedSkillId !== "servicenow-record-form" ||
        !hasTaskLevelServiceNowSubmitIntent(
          this as unknown as ServiceNowRecordFormHost,
        )
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
      return {
        finalSummary: signal.reason,
        newIndex: 0,
        completionCandidate,
      };
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
    return { finalSummary: signal.reason, newIndex, completionCandidate };
  }

  // --- ServiceNow catalog-order controller (quarantined adapter) ---
  // Thin delegates into ./servicenow/catalog-controller.ts; the loop passes
  // itself as the dispatch host (every host member is a real loop field).

  private maybeCompleteCatalogOrderFromSnapshot(): LoopResult | null {
    return maybeCompleteCatalogOrderFromSnapshot(
      this as unknown as ServiceNowCatalogHost,
    );
  }

  private shouldAutoSubmitConfiguredCatalogItem(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
  }): boolean {
    return shouldAutoSubmitConfiguredCatalogItem(
      this as unknown as ServiceNowCatalogHost,
      params,
    );
  }

  async maybeCompleteTrustedCatalogOrderSubmit(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    tabId: number;
    mode: "parallel" | "sequential";
  }): Promise<{ finalSummary: string } | null> {
    return maybeCompleteTrustedCatalogOrderSubmit(
      this as unknown as ServiceNowCatalogHost,
      params,
    );
  }

  private async maybeAutoSubmitConfiguredCatalogItem(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    tabId: number;
    mode: "parallel" | "sequential";
  }): Promise<void> {
    return maybeAutoSubmitConfiguredCatalogItem(
      this as unknown as ServiceNowCatalogHost,
      params,
    );
  }

  private completeSubmitFormReset(
    currentIndex: number,
    signal: NonNullable<ReturnType<typeof detectFormSubmissionResetSuccess>>,
  ): {
    finalSummary: string;
    newIndex: number;
    completionCandidate: TrustedCompletionCandidate;
  } {
    const newIndex = completeRemainingSubtasks(
      this as unknown as AgentLoopPlanProgressHost,
      currentIndex,
      signal.reason,
    );
    const completionCandidate = this.createTrustedCompletionCandidate({
      workflow: "form_submit_reset",
      summary: signal.reason,
      reason: "Trusted form submit reset evidence confirmed submission.",
      evidenceText:
        `${signal.reason}\n` +
        `Previous record: ${signal.previousRecordId}\n` +
        `Current record: ${signal.currentRecordId}\n` +
        `Filled fields before submit: ${signal.filledFieldsBeforeSubmit}`,
      recordId: signal.previousRecordId,
      targetText: signal.previousRecordId,
    });
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

    return { finalSummary: signal.reason, newIndex, completionCandidate };
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
   * Compares origin + pathname for plain URLs, and includes query params when
   * either side has them so SPA view-state URLs remain distinct. Hash is ignored.
   * Returns a block message if matched, or null to allow navigation.
   */

  private async loop(initialTabId: number): Promise<LoopResult> {
    // Session-scoped state, persists across turns (RFC LP-16 Phase 3). See loop-scope.ts.
    const session = new LoopSession(initialTabId, this.lastPlanIndex);
    // Two-tier escalation state machine (0=executor, 1=planner). plan-then-act:
    // start at tier 1 (planner) for orientation, then hand off to tier 0
    // (executor). Exception: preferredModelTier="executor" skips orientation.
    // Run-scoped turn accumulators (LP-15 Phase 6): same-tool failure counts,
    // the recent-success / recent-tool-call windows, result-page progress, and
    // find_element-discovered tag IDs. Owned by TurnState; consumed by the
    // dispatchers + stagnation-adjacent policies by reference.
    const turnState = new TurnState();
    const { toolFailCounts, recentSuccesses, recentToolCalls } = turnState;
    const verifiedFinalClickBypassKeys = new Set<string>();
    const blockedActions: BlockedAction[] = [];
    const recentOutcomes: RecentOutcome[] = [];
    const recentObservationProgressKeys: string[] = [];
    const subgoalAttempts: SubgoalAttempt[] = [];
    const serviceNowMissingFieldSearchEvidence = new Map<
      string,
      ServiceNowMissingFieldSearchEvidence
    >();

    // Two-tier escalation controller + working-memory closures (RFC LP-16
    // Phase 3b). See turn-controller.ts.
    const {
      esc,
      resetStepScopedActionMemory,
      resetEscalationWorkingMemory,
      beginPlannerEscalation,
    } = createTurnController(this as unknown as TurnControllerHost, session, {
      recentToolCalls,
      recentSuccesses,
      blockedActions,
      verifiedFinalClickBypassKeys,
      subgoalAttempts,
      recentOutcomes,
      serviceNowMissingFieldSearchEvidence,
    });
    if (esc.orientationPhase) {
      this.escalateModel(); // Start with planner model (plan phase)
    }

    while (this.isRunning && this.turnCount < this.maxTurns) {
      // Turn-scoped state, reset each iteration (RFC LP-16 Phase 3). See loop-scope.ts.
      const turn = new TurnScope();

      // Top-of-turn control gate (RFC LP-15 Phase 11): pause / graceful-stop /
      // middleware halt + counter advance + idempotency-cache clear.
      const gate = await runGatesPhase(this as unknown as GatesPhaseHost, {
        resetStepScopedActionMemory,
      });
      if (gate.kind === "end_turn") break;

      // Per-turn escalation bookkeeping: cooldown tick, one-shot investigation
      // extension, and the plan-then-act orientation handoff (tier 1→0).
      session.prevElementCount = await esc.onTurnStart({
        tabId: session.tabId,
        prevElementCount: session.prevElementCount,
      });

      // Feedback phase: fold pending user feedback + the turn-budget reminder
      // into context before inference. Extracted (RFC LP-16 Phase 3).
      runFeedbackPhase(this as unknown as FeedbackPhaseHost);

      // Pre-inference turn bookkeeping: turn-progress broadcast, time context,
      // budget-urgency trace, money-table refresh, catalog-order snapshot
      // completion. Extracted (RFC LP-16 Phase 3b).
      const turnContext = runPrepareTurnContextPhase(
        this as unknown as PrepareTurnContextHost,
        session,
      );
      if (turnContext.kind === "end_task") return turnContext.result;

      // Escalation phase: escalation-rescue policy (RFC LP-2) — fail-fast or
      // replan/strategy-pivot on no verified progress. Extracted (LP-16 Phase 3).
      const escalationOutcome = await runEscalationPhase(
        this as unknown as EscalationPhaseHost,
        {
          esc,
          tabId: session.tabId,
          subgoalAttempts,
          resetEscalationWorkingMemory,
          beginPlannerEscalation,
        },
      );
      if (escalationOutcome.kind === "end_task") {
        return escalationOutcome.result;
      }

      // 1. LLM Inference: prepare request → model call (w/ retries) → process
      // response. Extracted to the prepare_model_turn phase (RFC LP-15 Phase 11).
      const preparedTurn = await runPrepareModelTurnPhase(
        this as unknown as PrepareModelTurnHost,
        session.prevElementCount,
      );
      if (preparedTurn.kind === "end_task") {
        return preparedTurn.result;
      }
      session.prevElementCount = preparedTurn.prepared.previousElementCount;
      const response = preparedTurn.prepared.response;
      const hallucinationDetected = preparedTurn.prepared.hallucinationDetected;
      const normalizedContent = preparedTurn.prepared.normalizedContent;
      const rawContent = preparedTurn.prepared.rawContent;
      const cleanContent = preparedTurn.prepared.cleanContent;
      const toolsRecoveredFromText =
        preparedTurn.prepared.toolsRecoveredFromText;
      const llmIntention = preparedTurn.prepared.llmIntention;

      // 3. Handle Response
      if (response.tool_calls && response.tool_calls.length > 0) {
        // ACTION REQUIRED. The streaming message stays open across tool-calling
        // turns (finalized when done() is called or the loop exits).
        // signalCompletedResult is shared with the completion phase, so it is
        // created here and threaded into both.
        const signalCompletedResult = (
          summary: string,
          options?: {
            saveCheckpoint?: boolean;
            completionCandidate?: TrustedCompletionCandidate;
          },
        ) => {
          session.doneSummary = summary;
          turn.doneSignaled = true;
          this.completeTaskResult(summary, options);
        };
        const dispatch = await runDispatchToolsPhase(
          this as unknown as DispatchToolsHost,
          {
            session,
            turn,
            esc,
            turnState,
            verifiedFinalClickBypassKeys,
            blockedActions,
            signalCompletedResult,
            response,
            cleanContent,
            toolsRecoveredFromText,
            llmIntention,
            hadThinking: normalizedContent.hadThinking,
          },
        );
        if (dispatch.kind === "end_task") return dispatch.result;
        if (dispatch.kind === "next_turn") continue;

        const guards = await runPostToolGuardsPhase(
          this as unknown as PostToolGuardsHost,
          {
            session,
            turn,
            esc,
            toolCalls: response.tool_calls!,
            signalCompletedResult,
            beginPlannerEscalation,
            resetEscalationWorkingMemory,
            subgoalAttempts,
            recentOutcomes,
            recentObservationProgressKeys,
            blockedActions,
            toolFailCounts,
            recentSuccesses,
            serviceNowMissingFieldSearchEvidence,
          },
        );
        if (guards.kind === "end_task") return guards.result;
        if (guards.kind === "end_turn") break;
        if (guards.kind === "next_turn") continue;

        const completion = await runCompletionPhase(
          this as unknown as CompletionPhaseHost,
          {
            session,
            turn,
            esc,
            toolCalls: response.tool_calls!,
            signalCompletedResult,
            beginPlannerEscalation,
            resetEscalationWorkingMemory,
            subgoalAttempts,
            recentSuccesses,
            recentOutcomes,
            blockedActions,
          },
        );
        if (completion.kind === "end_turn") break;
        if (completion.kind === "next_turn") continue;

        // End-of-turn bookkeeping: distill + checkpoint + trace flush (RFC LP-16 Phase 3).
        const account = await runAccountAndRefreshPhase(
          this as unknown as AccountAndRefreshHost,
          turn,
        );
        if (account.kind === "end_turn") break;
      } else {
        const text = await runTextResponsePhase(
          this as unknown as TextResponsePhaseHost,
          {
            session,
            esc,
            cleanContent,
            rawContent,
            hallucinationDetected,
            subgoalAttempts,
            recentSuccesses,
            beginPlannerEscalation,
            resetEscalationWorkingMemory,
          },
        );
        if (text.kind === "end_turn") break;
        continue;
      }
    }

    if (this.turnCount >= this.maxTurns && !this.completedResult) {
      this.log.warn("agent", "Loop ended: max turns reached", {
        turns: this.turnCount,
        maxTurns: this.maxTurns,
      });
      const partialHandoff = this.buildMaxTurnPartialHandoff();
      this.traceRecorder?.recordEvent("partial_handoff_created", {
        reason: partialHandoff.reason,
        turnsUsed: partialHandoff.turnsUsed,
        maxTurns: partialHandoff.maxTurns,
        completedCount: partialHandoff.completed.length,
        evidenceCount: partialHandoff.evidence.length,
        remainingCount: partialHandoff.remaining.length,
        handoff: partialHandoff,
      });
      const limitMsg = formatPartialProgressHandoffSummary(partialHandoff);
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
        partialHandoff,
      };
    }

    return {
      outcome: "completed" as const,
      turnCount: this.turnCount,
      summary: session.doneSummary,
      failure: { category: "none", code: "none" },
      metrics: this.getMetrics(),
      completionEnvelope: this.completedResult?.completionEnvelope,
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
