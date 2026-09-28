import { providerRoutingOptions } from "../llm/provider-routing-policy";
import {
  AgentStatus,
  AgentLoopState,
  AgentStep,
  Citation,
  DomSnapshot,
  PartialHandoffReason,
  PartialProgressHandoff,
  PageDocumentState,
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
} from "./region-zoom";
import {
  extractPerceptionPageSignals,
  PERCEPTION_AUTO_DEFAULT_MODE,
  resolvePerceptionRuntimeMode,
  resolvePerceptionRuntimeModeDecision,
} from "../../utils/perception-mode";
import { LLMClient } from "../llm";
import { toolRegistry } from "../tools";
import { waitForDomReady } from "../tab-ready";
import {
  isBridgeDisconnect,
  recoverContentScriptBridge,
  type BridgeRecoveryTraceHook,
} from "../tools/bridge";
import { type DryRunClassification } from "./mutation-dry-run-policy";
import {
  runFormSubmitDryRun,
} from "./form-submit-dry-run";
import type { ForwardedApprovalDryRun } from "@shared-types/browser-bridge";
import { ContextManager } from "./context";
import { StagnationMonitor } from "./stagnation";
import {
  PageStateCoordinator,
  legacyDocumentState,
  PAGE_STATE_COORDINATOR_MODE,
  type ObservationBasis,
} from "./page-state";
import { createRegionZoomHost, type RegionZoomLoopHost } from "./page-state/region-zoom-host";
import {
  adoptWarmupScreenshot,
  type WarmupAdoptionHost,
} from "./page-state/warmup-adoption";
import * as pageActionLifecycle from "./page-state/action-lifecycle";
import {
  captureVLExecutorScreenshot,
  createVLScreenshotState,
  type VLScreenshotHost,
} from "./vl-screenshot";
import { captureVisibleTabWithQuotaRetry } from "./capture-guard";
import type { PerceptionTaskContext } from "../perception/types";
import { deriveActivePerceptionTaskContext } from "./perception-task-context";
import { createNavigationLoopState } from "./navigation-loop-state";
import { requestPageSnapshot } from "../perception/frame-snapshot-runtime";
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
import { TaskPlanner, PlanStep } from "./planner";
import { TraceRecorder } from "./trace";
import { ToolResultCache } from "./tool-cache";
import {
  runPrepareModelTurnPhase,
  type PrepareModelTurnHost,
} from "./turn-phases/prepare-model-turn";
import { runGatesPhase, type GatesPhaseHost } from "./turn-phases/gates";
import { runFeedbackPhase } from "./turn-phases/feedback";
import {
  runEscalationPhase,
  type EscalationPhaseHost,
} from "./turn-phases/escalation";
import { runAccountAndRefreshPhase } from "./turn-phases/account-and-refresh";
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
  DonePlanValidationRuntime,
  type DonePlanValidationRuntimeHost,
} from "./done-plan-validation";
import {
  formatDoneRejectionDiagnosticContent,
} from "./done-diagnostics";
import {
  TurnCheckpointRuntime,
  type TurnCheckpointHost,
} from "./turn-checkpoint";
import { CompletionEvidenceRuntime } from "./completion-evidence";
import type { TrustedCatalogOrderSubmission } from "./catalog-controller";
import {
  maybeAutoSubmitConfiguredCatalogItem,
  maybeCompleteCatalogOrderFromSnapshot,
  maybeCompleteTrustedCatalogOrderSubmit,
  shouldAutoSubmitConfiguredCatalogItem,
  type CatalogHost,
} from "./catalog-controller";
import { resolveInitialSnapshot } from "./initial-snapshot";
import { bootstrapRuntimePlan } from "./start-planner-bootstrap";
import { runStartExecution } from "./start-result";
import { requestApproval, requestClarification, type InteractionHost } from "./loop-interactions";
import { finalizeStartResult } from "./start-finalization";
import { AgentMiddleware } from "./middleware";
import { EvidenceAccumulator } from "./evidence";
import { EscalationRescueTracker } from "./escalation-rescue-policy";
import {
  CompletionEvidenceLedger,
  type CompletionEnvelope,
  type CompletionEvaluation,
  type TrustedCompletionCandidate,
} from "./completion-kernel";
import { CompletionDecisionContextRuntime } from "./completion/decision-context";
import {
  isCompletionDecisionRecordingEnabled,
} from "./completion/decision-recorder";
import { recordCompletionDecisionOutcome } from "./completion/decision-outcome";
import { type CompletionRejectionDecision } from "./completion/rejection-instruction";
import {
  buildKernelRejectionEffects,
} from "./completion/rejection-effects";
import {
  runCompletionPipeline,
  type PlannerValidationResult,
} from "./completion/pipeline";
import type { CompletionEffect } from "./completion/pipeline-types";
import { acceptFromPipelineDecision } from "./completion/accept-decision";
import { CompletionFinalizationRuntime, type CompletedTaskResult } from "./completion/finalization";
import { applyCompletionEffects } from "./completion/apply-effects";
import {
  createCompletionEffectHost,
  type CompletionEffectStateHost,
} from "./completion/effect-host";
import type { TurnCheckpoint } from "./checkpoint-types";
import { CheckpointCoordinator } from "./checkpoint-coordinator";
import { AgentTelemetryController } from "./agent-telemetry-controller";
import { TurnScope } from "./loop-scope";
import { type TurnControllerHost } from "./turn-controller";
import { createLoopRunState } from "./loop-run-state";
import { createCompletionSignal, finishLoopSession } from "./loop-finalization";
import {
  captureRecentSubtaskResult,
  getWorkspaceTabs,
  isPureListFilterWorkflowRequest,
  shouldEscalateOnDoneRejection,
} from "./loop-queries";
import type { MoneyTableAggregate } from "./money-table-aggregate";
import { ListDetailWorkflow } from "./list-detail-workflow";
import { PlanRecoveryRuntime } from "./plan-recovery-runtime";
export {
  rewriteAutocompleteTextEntry,
  validateTextEntryTarget,
} from "./text-entry-guards";
export {
  countVisibleListDetailActions,
  getListDetailDoneRejection,
  getListDetailWorkflowBlock,
  getNextUnreviewedListDetailAction,
  isListDetailReturnControlRepeatExempt,
  requiresBroadListDetailReview,
} from "./list-detail-policy";
import { imagePromptUsageForCount } from "./agent-telemetry";
import {
  BroadcastMessage,
  forwardSuppressedStreamChunk,
  runtimeBroadcastMessage,
  taskProgressMessage,
} from "./agent-broadcast";
import {
  createProgressLedger,
  formatPartialProgressHandoffSummary,
  type ProgressLedger,
} from "./partial-progress-handoff";
import {
  buildRestoredPlanState,
  syncPlanStatus as syncPlanStatusPolicy,
  type PlanStatusTraceEvent,
  type RestorablePlanState,
} from "./agent-plan-progress";
import { applySkillTurnCap } from "./skill-turn-cap-policy";
export {
  isPerceptionFailurePlaceholder,
  shouldOmitPerceptionForDoneValidation,
} from "./perception-done-validation";
import {
  AGENT_LIMITS,
  TOOL_CACHE,
  DEFAULT_RUNTIME_LIMITS,
} from "./constants";
import type { Difficulty, RuntimeLimits } from "./constants";
// reassessRuntimeLimits is available from "./constants" for mid-session S5 reassessment
import { APPROVAL_TIMEOUT_MS, MAX_SESSION_MS } from "./loop-metrics";
import type { LoopResult } from "./loop-types";
import type { PendingUserInteraction } from "./loop-types";
import { getLoadedSkillContract } from "../orchestrator/skills";
import { getWorkflowTabToolRedirect as routeWorkflowTabTool } from "./workflow-tab-routing";
import {
  detectInstructionContradiction,
  detectFormSubmissionResetSuccess,
  extractAttemptSummary,
  isPendingAsyncChangeSatisfied,
} from "./loop-helpers";
import { PIVOT_MESSAGE } from "./loop-prompts";
import { PlanProgressRuntime } from "./loop-plan-progress";
import { InlineEditVerificationRuntime } from "./inline-edit-verification-runtime";
import { PartialProgressRuntime } from "./partial-progress-runtime";
import { MutationReplayRuntime } from "./mutation-replay-runtime";
import { TrustedListCompletionRuntime } from "./trusted-list-completion";
import { SkillToolRuntime } from "./loop-skill-tools";
import { MoneyTableRuntime } from "./loop-money-table";
import { buildConsequentialActionTaskText } from "./consequential-action-context";
import { assessConsequentialActionApproval } from "./consequential-action-policy";
import {
  addParallelToolResultsToContext,
  handleParallelVerificationGate,
  type ParallelToolExecutionResult,
} from "./parallel-tool-execution";
import { type TurnToolOutcomeRecord } from "./turn-tool-outcomes";
export { isDoneSummaryAskingClarification } from "./completion-kernel";

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
  /**
   * Set the moment done() is accepted, BEFORE post-processing (trace, metrics,
   * verification). The orchestrator reads this after a lane timeout to avoid
   * retrying a subtask that already completed — prevents duplicate actions
   * (e.g. adding the same item to cart multiple times).
   */
  public completedResult: CompletedTaskResult | null = null;

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
  readonly moneyTable = new MoneyTableRuntime((() => {
    const loop = () => this;
    return {
      get context() { return loop().context; },
      get lastPlanIndex() { return loop().lastPlanIndex; },
      get moneyTableAggregate() { return loop().moneyTableAggregate; },
      set moneyTableAggregate(value: MoneyTableAggregate | null) {
        loop().moneyTableAggregate = value;
      },
      get originalQuery() { return loop().originalQuery; },
      get planSubtasks() { return loop().planSubtasks; },
      get selectedSkillId() { return loop().selectedSkillId; },
    };
  })());
  /** Progress tracker — promoted from local to instance for external access */
  private stagnation = new StagnationMonitor();
  /** Owns the mutation replay ledger + durable turn-checkpoint persistence. */
  private checkpoints = new CheckpointCoordinator();
  readonly turnCheckpoint = new TurnCheckpointRuntime((() => {
    const loop = () => this;
    return {
      get turnCount() { return loop().turnCount; },
      set turnCount(value: number) { loop().turnCount = value; },
      get maxTurns() { return loop().maxTurns; },
      set maxTurns(value: number) { loop().maxTurns = value; },
      get lastPlanIndex() { return loop().lastPlanIndex; },
      set lastPlanIndex(value: number) { loop().lastPlanIndex = value; },
      get turnsOnCurrentStep() { return loop().turnsOnCurrentStep; },
      set turnsOnCurrentStep(value: number) { loop().turnsOnCurrentStep = value; },
      get escalationsOnCurrentStep() { return loop().escalationsOnCurrentStep; },
      set escalationsOnCurrentStep(value: number) { loop().escalationsOnCurrentStep = value; },
      get guardAfterDoneRejection() { return loop().guardAfterDoneRejection; },
      set guardAfterDoneRejection(value: boolean) { loop().guardAfterDoneRejection = value; },
      get completedResult() { return loop().completedResult; },
      set completedResult(value: TurnCheckpointHost["completedResult"]) {
        loop().completedResult = value;
      },
      get nodeId() { return loop().nodeId; },
      get workspaceId() { return loop().workspaceId; },
      get selectedSkillId() { return loop().selectedSkillId; },
      get context() { return loop().context; },
      get llm() { return loop().llm; },
      get checkpoints() { return loop().checkpoints; },
      get log() { return loop().log; },
    };
  })());
  readonly mutationReplay = new MutationReplayRuntime((() => {
    const loop = () => this;
    return {
      get selectedSkillId() { return loop().selectedSkillId; },
      get context() { return loop().context; },
      get originalQuery() { return loop().originalQuery; },
      get turnCount() { return loop().turnCount; },
      get checkpoints() { return loop().checkpoints; },
      get guardAfterDoneRejection() { return loop().guardAfterDoneRejection; },
      get lastPlanIndex() { return loop().lastPlanIndex; },
      logWarn: (component: "agent", message: string, data: Record<string, unknown>) =>
        loop().log.warn(component, message, data),
      logInfo: (component: "agent", message: string, data: Record<string, unknown>) =>
        loop().log.info(component, message, data),
      recordVerifiedProgress: (turn: number, source: "mutation") =>
        loop().escalationRescue.recordVerifiedProgress(turn, source),
    };
  })());
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
    | "fireworks-deepseek"
    | "cerebras-fireworks"
    | "moonshot"
    | "xiaomi";
  /** When true, mutation replay guard persists across turns (set after done() rejection) */
  private guardAfterDoneRejection = false;
  private pendingFeedback: string | null = null;
  private perception = new PageStateCoordinator();
  private modelTurnObservationBasis: ObservationBasis | null = null;
  private readonly enforcePageStateConsistency =
    PAGE_STATE_COORDINATOR_MODE === "authoritative";
  /** LP-17b CM-5: reuse state for the VL executor screenshot (vl-screenshot.ts). */
  private vlScreenshotState = createVLScreenshotState();
  private readonly perceptionCaptureHost: WarmupAdoptionHost & VLScreenshotHost & RegionZoomLoopHost = (() => {
    const loop = () => this;
    return {
      get context() { return loop().context; },
      get perception() { return loop().perception; },
      get traceRecorder() { return loop().traceRecorder; },
      get useVLExecutor() { return loop().useVLExecutor; },
      get enforcePageStateConsistency() { return loop().enforcePageStateConsistency; },
      get log() { return loop().log; },
      get telemetry() { return loop().telemetry; },
      get turnCount() { return loop().turnCount; },
      recordCachedVisionUsage: () => loop().recordCachedVisionUsage(),
      captureVisibleTabWithRetry: (windowId: number | undefined, options: { format?: "jpeg" | "png"; quality?: number }) =>
        captureVisibleTabWithQuotaRetry(windowId, options, loop().log),
      refreshSnapshot: (tabId: number) => loop().refreshSnapshot(tabId),
    };
  })();
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
  readonly listDetailWorkflow = new ListDetailWorkflow({
    selectedSkillId: () => this.selectedSkillId,
    turnCount: () => this.turnCount,
    getSnapshot: () => this.context.getSnapshot(),
    query: () => this.originalQuery,
    isSkillOwned: () => this.skillTools.isSkillOwnedListDetailReview(),
    recordEvent: (name, data) => this.traceRecorder?.recordEvent(name, data),
    logInfo: (message, data) => this.log.info("agent", message, data),
  });
  /** Trusted catalog helper evidence waiting for the next request confirmation page. */
  private trustedCatalogOrderSubmission: TrustedCatalogOrderSubmission | null =
    null;

  /** Task planning state */
  private taskId: string | null = null;
  private planSubtasks: SubtaskSummary[] = [];
  private planSteps: PlanStep[] = [];
  readonly planProgress = new PlanProgressRuntime((() => {
    const loop = () => this;
    return {
      captureSubtaskResult: () => captureRecentSubtaskResult(loop().context.getMessages()),
      get context() { return loop().context; },
      get escalationsOnCurrentStep() { return loop().escalationsOnCurrentStep; },
      set escalationsOnCurrentStep(value: number) { loop().escalationsOnCurrentStep = value; },
      get lastPlanIndex() { return loop().lastPlanIndex; },
      set lastPlanIndex(value: number) { loop().lastPlanIndex = value; },
      get checkpoints() { return loop().checkpoints; },
      get perception() { return loop().perception; },
      get planSubtasks() { return loop().planSubtasks; },
      recordVerifiedPlanAdvance: () => loop().recordVerifiedPlanAdvance(),
      get stepRetryCount() { return loop().stepRetryCount; },
      set stepRetryCount(value: number) { loop().stepRetryCount = value; },
      get turnsOnCurrentStep() { return loop().turnsOnCurrentStep; },
      set turnsOnCurrentStep(value: number) { loop().turnsOnCurrentStep = value; },
    };
  })());
  readonly trustedListCompletion = new TrustedListCompletionRuntime((() => {
    const loop = () => this;
    return {
      get selectedSkillId() { return loop().selectedSkillId; },
      get completionEvidenceRuntime() { return loop().completionEvidenceRuntime; },
      get context() { return loop().context; },
      get planProgress() { return loop().planProgress; },
      get turnCount() { return loop().turnCount; },
      get planSubtaskCount() { return loop().planSubtasks.length; },
      resetConsecutiveAutoAdvances: () => { loop().consecutiveAutoAdvances = 0; },
      syncPlanStatus: (index, event, data) => loop().syncPlanStatus(index, event, data),
      broadcastTaskProgress: (index) => loop().broadcastTaskProgress(index),
      logInfo: (message, data) => loop().log.info("agent", message, data),
      recordEvent: (
        event: Parameters<TraceRecorder["recordEvent"]>[0],
        data: Parameters<TraceRecorder["recordEvent"]>[1],
      ) => loop().traceRecorder?.recordEvent(event, data),
      isPureListFilterWorkflowRequest: () => isPureListFilterWorkflowRequest({
        originalQuery: loop().originalQuery,
        planSteps: loop().planSteps,
      }),
    };
  })());
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
  readonly partialProgress = new PartialProgressRuntime((() => {
    const loop = () => this;
    return {
      get progressLedger() { return loop().progressLedger; },
      get context() { return loop().context; },
      get planSubtasks() { return loop().planSubtasks; },
      get lastPlanIndex() { return loop().lastPlanIndex; },
      get elementResolver() { return loop().elementResolver; },
      get originalQuery() { return loop().originalQuery; },
      get turnCount() { return loop().turnCount; },
      get maxTurns() { return loop().maxTurns; },
      get taskId() { return loop().taskId; },
      get taskStartTime() { return loop().taskStartTime; },
      get urlHistory() { return loop().urlHistory; },
      getMetrics: () => loop().getMetrics(),
      broadcast: (message: BroadcastMessage) => loop().broadcast(message),
    };
  })());

  /** Session-scoped logger — falls back to global logger before start() */
  private log: typeof logger | SessionScopedLogger = logger;
  readonly skillTools = new SkillToolRuntime((() => {
    const loop = () => this;
    return {
      get context() { return loop().context; },
      get limits() { return loop().limits; },
      get log() { return loop().log; },
      get originalQuery() { return loop().originalQuery; },
      get planSteps() { return loop().planSteps; },
      get planSubtasks() { return loop().planSubtasks; },
      get selectedSkillId() { return loop().selectedSkillId; },
      get enabledSkillPackIds() { return loop().enabledSkillPackIds; },
      get traceRecorder() { return loop().traceRecorder ?? undefined; },
      get turnCount() { return loop().turnCount; },
      get turnsOnCurrentStep() { return loop().turnsOnCurrentStep; },
    };
  })());
  readonly planRecovery = new PlanRecoveryRuntime((() => {
    const loop = () => this;
    return {
      isSkillOwnedListDetailReview: () => this.skillTools.isSkillOwnedListDetailReview(),
      isSkillOwnedMultiTabChecklistLoop: () => this.skillTools.isSkillOwnedMultiTabChecklistLoop(),
      get planSteps() { return loop().planSteps; },
      set planSteps(value: PlanStep[]) { loop().planSteps = value; },
      get planSubtasks() { return loop().planSubtasks; },
      set planSubtasks(value: SubtaskSummary[]) { loop().planSubtasks = value; },
      get perception() { return loop().perception; },
      get context() { return loop().context; },
      get planner() { return loop().planner; },
      get originalQuery() { return loop().originalQuery; },
      get selectedSkillId() { return loop().selectedSkillId; },
      get turnCount() { return loop().turnCount; },
      get limits() { return loop().limits; },
      get replanCount() { return loop().replanCount; },
      set replanCount(value: number) { loop().replanCount = value; },
      get turnsOnCurrentStep() { return loop().turnsOnCurrentStep; },
      set turnsOnCurrentStep(value: number) { loop().turnsOnCurrentStep = value; },
      get escalationsOnCurrentStep() { return loop().escalationsOnCurrentStep; },
      set escalationsOnCurrentStep(value: number) { loop().escalationsOnCurrentStep = value; },
      get doneRejections() { return loop().doneRejections; },
      set doneRejections(value: number) { loop().doneRejections = value; },
      get lastContractRejectionKind() { return loop().lastContractRejectionKind; },
      set lastContractRejectionKind(value: string | undefined) { loop().lastContractRejectionKind = value; },
      get consecutiveSameKindRejections() { return loop().consecutiveSameKindRejections; },
      set consecutiveSameKindRejections(value: number) { loop().consecutiveSameKindRejections = value; },
      get lastPlanIndex() { return loop().lastPlanIndex; },
      set lastPlanIndex(value: number) { loop().lastPlanIndex = value; },
      get traceRecorder() { return loop().traceRecorder; },
      get log() { return loop().log; },
      stepHandler: (step: AgentStep, update: boolean) => this.stepHandler(step, update),
      broadcastTaskProgress: (index: number) => this.broadcastTaskProgress(index),
      refreshSnapshotWithRetry: (tabId: number, prevCount: number) => this.refreshSnapshotWithRetry(tabId, prevCount),
      refreshPerceptionAndTriage: (tabId: number) => this.refreshPerceptionAndTriage(tabId),
    };
  })());
  private readonly interactionHost = (): InteractionHost => ({
    resumeInteraction: this.resumeInteraction,
    clearResumeInteraction: () => { this.resumeInteraction = null; },
    nodeId: this.nodeId,
    approvalTimeoutMs: this.approvalTimeoutMs,
    turnCount: this.turnCount,
    log: this.log,
    traceRecorder: this.traceRecorder,
    statusHandler: (status, detail) => this.statusHandler(status, detail),
    stepHandler: (step, update) => this.stepHandler(step, update),
    workspaceId: this.workspaceId,
    workerId: this.workerId,
    bypassApprovals: this.bypassApprovals,
    dispatchMessage: (message) => chrome.runtime.sendMessage(message),
  });

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
  readonly inlineEditVerification = new InlineEditVerificationRuntime((() => {
    const loop = () => this;
    return {
      get skillTools() { return loop().skillTools; },
      get context() { return loop().context; },
      get originalQuery() { return loop().originalQuery; },
      get planSubtasks() { return loop().planSubtasks; },
      get planSteps() { return loop().planSteps; },
      get pendingInlineEditVerification() { return loop().pendingInlineEditVerification; },
      set pendingInlineEditVerification(value: { stepIndex: number; reason: string } | null) {
        loop().pendingInlineEditVerification = value;
      },
    };
  })());
  private evidenceAccumulator = new EvidenceAccumulator();
  /** Escalation rescue policy state (RFC LP-2): progress clocks + efficacy window. */
  private escalationRescue = new EscalationRescueTracker();
  private completionEvidence = new CompletionEvidenceLedger();
  private lastCompletionRejection: CompletionEvaluation | null = null;
  private lastCompletionRecoveryHint: string | null = null;
  readonly completionEvidenceRuntime = new CompletionEvidenceRuntime((() => {
    const loop = () => this;
    return {
      get planSubtasks() { return loop().planSubtasks; },
      get planSteps() { return loop().planSteps; },
      get completionEvidence() { return loop().completionEvidence; },
      get traceRecorder() { return loop().traceRecorder; },
      get turnCount() { return loop().turnCount; },
      get context() { return loop().context; },
      get originalQuery() { return loop().originalQuery; },
      get lastCompletionRejection() { return loop().lastCompletionRejection; },
      set lastCompletionRejection(value: CompletionEvaluation | null) {
        loop().lastCompletionRejection = value;
      },
      get lastCompletionRecoveryHint() { return loop().lastCompletionRecoveryHint; },
      set lastCompletionRecoveryHint(value: string | null) {
        loop().lastCompletionRecoveryHint = value;
      },
    };
  })());
  readonly completionFinalization = new CompletionFinalizationRuntime((() => {
    const loop = () => this;
    return {
      get completedResult() { return loop().completedResult; },
      set completedResult(value: CompletedTaskResult | null) { loop().completedResult = value; },
      get completionEvidenceRuntime() { return loop().completionEvidenceRuntime; },
      get traceRecorder() { return loop().traceRecorder; },
      get turnCount() { return loop().turnCount; },
      get context() { return loop().context; },
      get taskId() { return loop().taskId; },
      get planSubtasks() { return loop().planSubtasks; },
      get taskStartTime() { return loop().taskStartTime; },
      get urlHistory() { return loop().urlHistory; },
      stepHandler: (step: AgentStep, update: boolean) => loop().stepHandler(step, update),
      finishStream: (summary: string) => loop().finishStream(summary),
      statusHandler: (status: AgentStatus, detail: string) => loop().statusHandler(status, detail),
      messageHandler: (summary: string, calls: ToolCall[]) => loop().messageHandler(summary, calls),
      saveTurnCheckpoint: () => loop().turnCheckpoint.save(),
      logInfo: (component: "agent", message: string, data: Record<string, unknown>) =>
        loop().log.info(component, message, data),
      broadcast: (message: BroadcastMessage) => loop().broadcast(message),
      broadcastFinalMetrics: () => loop().telemetry.broadcastFinalMetrics(),
    };
  })());
  private readonly completionContextHost = (() => {
    const loop = () => this;
    return {
      get context() { return loop().context; },
      get completionEvidenceRuntime() { return loop().completionEvidenceRuntime; },
      get completionEvidence() { return loop().completionEvidence; },
      get planSubtasks() { return loop().planSubtasks; },
      get planSteps() { return loop().planSteps; },
      get originalQuery() { return loop().originalQuery; },
      get turnCount() { return loop().turnCount; },
      get doneRejections() { return loop().doneRejections; },
      get consecutiveSameKindRejections() { return loop().consecutiveSameKindRejections; },
      get lastContractRejectionKind() { return loop().lastContractRejectionKind; },
      get taskId() { return loop().taskId; },
      get nodeId() { return loop().nodeId; },
      get completedResult() { return loop().completedResult; },
      get limits() { return loop().limits; },
      get selectedSkillId() { return loop().selectedSkillId; },
      get hasReadPage() { return loop().hasReadPage; },
      get hasExplicitPageRead() { return loop().hasExplicitPageRead; },
      get listDetailWorkflow() { return loop().listDetailWorkflow; },
      get moneyTable() { return loop().moneyTable; },
      get skillTools() { return loop().skillTools; },
      getMissingRequiredEvidenceTypes: () => loop().getMissingRequiredEvidenceTypes(),
    };
  })();
  readonly completionDecisionContext = new CompletionDecisionContextRuntime(this.completionContextHost);
  /**
   * The planner-validation result for the current done() decision (null
   * when no plan applied). Captured so the offline replay can stub the
   * planner stage without a model call (RFC LP-15, Phase 7a).
   */
  private lastDonePlanValidation: PlannerValidationResult | null = null;
  readonly donePlanValidation = new DonePlanValidationRuntime((() => {
    const loop = () => this;
    return {
      get taskId() { return loop().taskId; },
      get lastDonePlanValidation() { return loop().lastDonePlanValidation; },
      set lastDonePlanValidation(value: PlannerValidationResult | null) {
        loop().lastDonePlanValidation = value;
      },
      get planSubtasks() { return loop().planSubtasks; },
      get planSteps() { return loop().planSteps; },
      get context() { return loop().context; },
      get perception() { return loop().perception; },
      get stagnation() { return loop().stagnation; },
      get planner() { return loop().planner; },
      get traceRecorder() { return loop().traceRecorder; },
      get log() { return loop().log; },
      get abortController() { return loop().abortController; },
      get turnCount() { return loop().turnCount; },
      get nodeId() { return loop().nodeId; },
      get hasReadPage() { return loop().hasReadPage; },
      get originalQuery() { return loop().originalQuery; },
      get selectedSkillId() { return loop().selectedSkillId; },
      get pendingAsyncVerification() { return loop().pendingAsyncVerification; },
      set pendingAsyncVerification(value: DonePlanValidationRuntimeHost["pendingAsyncVerification"]) {
        loop().pendingAsyncVerification = value;
      },
      get moneyTable() { return loop().moneyTable; },
      getUncommittedInlineEditDoneRejection: (index: number) =>
        loop().inlineEditVerification.getUncommittedInlineEditDoneRejection(index),
      hasRecentToolEvidenceForTokens: (tokens: string[]) =>
        loop().hasRecentToolEvidenceForTokens(tokens),
      stepHandler: (step: AgentStep, update: boolean) => loop().stepHandler(step, update),
    };
  })());
  readonly completionEffectState: CompletionEffectStateHost = (() => {
    const loop = () => this;
    return {
      get doneRejections() { return loop().doneRejections; },
      set doneRejections(value: number) { loop().doneRejections = value; },
      get lastContractRejectionKind() { return loop().lastContractRejectionKind; },
      set lastContractRejectionKind(value: string | undefined) {
        loop().lastContractRejectionKind = value;
      },
      get consecutiveSameKindRejections() { return loop().consecutiveSameKindRejections; },
      set consecutiveSameKindRejections(value: number) {
        loop().consecutiveSameKindRejections = value;
      },
      get lastCompletionRejection() { return loop().lastCompletionRejection; },
      set lastCompletionRejection(value: CompletionEvaluation | null) {
        loop().lastCompletionRejection = value;
      },
      get lastCompletionRecoveryHint() { return loop().lastCompletionRecoveryHint; },
      set lastCompletionRecoveryHint(value: string | null) {
        loop().lastCompletionRecoveryHint = value;
      },
      get guardAfterDoneRejection() { return loop().guardAfterDoneRejection; },
      set guardAfterDoneRejection(value: boolean) {
        loop().guardAfterDoneRejection = value;
      },
      get context() { return loop().context; },
      get traceRecorder() { return loop().traceRecorder; },
      doneRejectionDiagnosticContent: (params) =>
        formatDoneRejectionDiagnosticContent(loop().completionContextHost, params),
      checkDoneRejectionEscalation: () => loop().checkAndSetDoneRejectionEscalation(),
      forceGroundingRefresh: (tabId, reason) => loop().forceGroundingRefresh(tabId, reason),
      runDonePlanRejection: (id, summary, rejectReason, index) =>
        runDonePlanRejection(
          loop() as unknown as DonePlanRejectionHost,
          id, summary, rejectReason, index,
          (params) => formatDoneRejectionDiagnosticContent(loop().completionContextHost, params),
        ),
    };
  })();

  /** Session telemetry: metrics, session clock, context spend, citations, turn carry. */
  readonly telemetry!: AgentTelemetryController;

  /** Record usage from a vision API call */
  public recordVisionUsage(
    usage: TokenUsage,
    llmMs: number,
    model: string,
    providerId: ProviderConfig["providerId"] = "openrouter",
    imageCount = 0,
  ): void {
    this.telemetry.recordVisionUsage(usage, llmMs, model, providerId, imageCount);
  }

  /** Get the current accumulated metrics snapshot */
  public getMetrics(): SessionMetrics {
    return this.telemetry.getMetrics();
  }

  /** Get collected citations */
  public getCitations(): Citation[] {
    return this.telemetry.getCitations();
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
      strictModelRouting?: boolean;
      plannerProviderPin?: string;
      judgeProviderPin?: string;
      writerModel?: string;
      useNitro?: boolean;
      providerMode?:
        | "openrouter"
        | "openrouter-groq"
        | "openai-groq"
        | "fireworks"
        | "fireworks-deepseek"
        | "cerebras-fireworks"
        | "moonshot"
        | "xiaomi";
      provider?: "openrouter" | "openai" | "groq"; // legacy compat
      openaiApiKey?: string;
      groqApiKey?: string;
      fireworksApiKey?: string;
      deepseekApiKey?: string;
      kimiApiKey?: string;
      xiaomiApiKey?: string;
      cerebrasApiKey?: string;
      temperature?: number;
      perceptionMode?: PerceptionRuntimeMode;
      maxImagePromptTokenEstimate?: number;
      /** Durable turn checkpoint from a prior SW lifetime — injected by orchestrator on restart. */
      turnCheckpoint?: TurnCheckpoint | null;
      /** Pending user interaction state injected by the orchestrator on resume. */
      resumeInteraction?: PendingUserInteraction | null;
    },
  ) {
    this.perception.setReceiptSink((receipt) => this.checkpoints.ledger.recordReceipt(receipt));
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
      ...providerRoutingOptions(options),
      writerModel: options?.writerModel,
      useNitro: options?.useNitro,
      providerMode: options?.providerMode,
      provider: options?.provider,
      openaiApiKey: options?.openaiApiKey,
      groqApiKey: options?.groqApiKey,
      fireworksApiKey: options?.fireworksApiKey,
      deepseekApiKey: options?.deepseekApiKey,
      kimiApiKey: options?.kimiApiKey,
      xiaomiApiKey: options?.xiaomiApiKey,
      cerebrasApiKey: options?.cerebrasApiKey,
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
      clearTurnCheckpoint: () => this.turnCheckpoint.clear(),
      broadcastPlanTermination: (outcome, summary) =>
        this.partialProgress.broadcastPlanTermination(outcome, summary),
      setRunning: (isRunning) => {
        this.isRunning = isRunning;
      },
      clearTraceRecorder: () => {
        this.traceRecorder = null;
      },
    });
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
    const partialHandoff = this.partialProgress.buildMaxTurnPartialHandoff("escalation_failed");
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

  private syncPlanStatus(
    currentIndex: number,
    traceEvent?: PlanStatusTraceEvent,
    traceData: Record<string, unknown> = {},
  ): void {
    syncPlanStatusPolicy({
      context: this.context,
      planSubtasks: this.planSubtasks,
      planSteps: this.planSteps,
      turnCount: this.turnCount,
      log: this.log,
      traceRecorder: this.traceRecorder,
    }, currentIndex, traceEvent, traceData);
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
        advanceCompletedSubtasks: () => this.planProgress.advanceCompletedSubtasks(),
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

  private completeTaskResult(
    summary: string,
    options: { saveCheckpoint?: boolean; completionCandidate?: TrustedCompletionCandidate } = {},
  ): void {
    this.completionFinalization.completeTaskResult(summary, options);
  }

  /** Expose the latest catalog tool result to the completion flow. */
  private createTrustedCompletionCandidate(params: {
    workflow: string;
    summary: string;
    reason: string;
    evidenceText?: string;
    recordId?: string;
    targetText?: string;
  }): TrustedCompletionCandidate {
    return this.completionEvidenceRuntime.createTrustedCompletionCandidate(params);
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
    const input = this.completionDecisionContext.captureCompletionDecisionInput(summary);
    const verdict = await this.handleDoneToolCallInner(
      toolCallId,
      summary,
      tabId,
    );
    try {
      recordCompletionDecisionOutcome(input, verdict, {
        plannerResult: this.lastDonePlanValidation,
        envelope: this.completedResult?.completionEnvelope,
        getEvidenceCount: () => this.completionEvidence.toArray().length,
        rejection: this.lastCompletionRejection,
        recoveryHint: this.lastCompletionRecoveryHint,
      });
    } catch (err) {
      this.log.warn("agent", "completion decision recording failed", {
        turn: this.turnCount,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return verdict;
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

    // The pure completion pipeline decides. The frozen kernel runs lazily after
    // summary and grounding so its side effects happen at the legacy point.
    // Planner rejection handling is injected; the effect host applies rejects.
    // Acceptance maps the basis to an envelope and acceptDoneToolCall.
    const snapshot = this.context.getSnapshot() ?? null;
    const completionContext = this.completionEvidenceRuntime.getActiveCompletionContext();
    const runningSubtaskIndex = this.planSubtasks.findIndex(
      (step) => step.status === "running",
    );
    const ctx = this.completionDecisionContext.buildCompletionGuardContext(
      summary,
      snapshot,
      completionContext,
      runningSubtaskIndex,
    );

    let kernelDecision: CompletionEvaluation | null = null;
    const decision = await runCompletionPipeline(ctx, {
      getKernelDecision: () => {
        kernelDecision = this.completionEvidenceRuntime.evaluateCompletionCandidate(
          "model_done",
          summary,
        );
        return kernelDecision;
      },
      isDuplicateTerminal: false, // handled inline above
      validatePlan: () => this.donePlanValidation.run(summary),
      buildKernelRejectionEffects: (decision) =>
        // Only invoked on a kernel rejection, so the evaluation is a rejection.
        buildKernelRejectionEffects(
          summary,
          decision as CompletionRejectionDecision,
          {
            turnCount: this.turnCount,
            doneRejections: this.doneRejections,
            log: this.log,
          },
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
      createCompletionEffectHost(this.completionEffectState, toolCallId, tabId),
    );

    if (decision.verdict === "reject") return false;
    return acceptFromPipelineDecision(
      {
        completionEvidenceRuntime: this.completionEvidenceRuntime,
        completionEvidence: this.completionEvidence,
        traceRecorder: this.traceRecorder,
        turnCount: this.turnCount,
        acceptDoneToolCall: (acceptedSummary, acceptedToolCallId, envelope) =>
          this.completionFinalization.acceptDoneToolCall(acceptedSummary, acceptedToolCallId, envelope),
      },
      decision,
      summary,
      toolCallId,
      kernelDecision,
    );
  }

  private async handleClarifyToolCall(
    toolCallId: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const question = (args.question as string) || "Could you clarify?";
    const suggestions = args.suggestions as string[] | undefined;
    const answer = await requestClarification(this.interactionHost(), question, suggestions);
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

  readonly formSubmitDryRun = (
    toolName: ToolName,
    args: Record<string, unknown>,
    tabId: number,
  ): Promise<DryRunClassification> => runFormSubmitDryRun({
    originalQuery: this.originalQuery,
    turnCount: this.turnCount,
    lastPlanIndex: this.lastPlanIndex,
    context: this.context,
    log: this.log,
    completionEvidence: this.completionEvidence,
    traceRecorder: this.traceRecorder,
    checkpoints: this.checkpoints,
  }, toolName, args, tabId);

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
    const approved = await requestApproval(
      this.interactionHost(),
      toolName,
      args,
      context,
      dryRun,
    );
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
    this.perception.setTraceSink(this.traceRecorder);
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
      const restored = this.turnCheckpoint.restore(cp);
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
    const warmupEntry = initialSnapshotResolution.warmupEntry;

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
      if (this.perception.getCurrentObservation()?.dom.snapshot !== snapshot) {
        const documentState =
          warmupEntry?.snapshot === snapshot
            ? warmupEntry.documentState
            : (await waitForDomReady(tabId, { timeoutMs: 50 })).documentState;
        this.acceptPageSnapshot(snapshot, documentState);
      }
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
        this.telemetry.recordCitation(
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

      const warmupResult = await adoptWarmupScreenshot(
        this.perceptionCaptureHost,
        { screenshot: warmupScreenshot, entry: warmupEntry },
      );
      if (warmupResult !== "handled") {
        if (warmupResult === "rejected") await this.refreshSnapshot(tabId);
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
          this.acceptPageSnapshot(minimalSnapshot);
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
      this.telemetry.recordUsage(
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
        return this.loop(tabId);
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
   * Called after every doneRejections++ to schedule a planner escalation when
   * the mid-point threshold is crossed.  The actual escalation happens in the
   * main loop so that escalationTier (a loop-local variable) is updated there.
   */
  private checkAndSetDoneRejectionEscalation(): void {
    if (!shouldEscalateOnDoneRejection({
      limits: this.limits,
      doneRejections: this.doneRejections,
      llm: this.llm,
    }))
      return;
    this.pendingDoneRejectionEscalation = true;
    this.traceRecorder?.recordEvent("done_rejection_escalation", {
      doneRejections: this.doneRejections,
      maxDoneRejections: this.limits.maxDoneRejections,
    } as Record<string, unknown>);
  }

  private async getWorkflowTabToolRedirect(params: {
    toolName: ToolName;
    args: Record<string, unknown>;
    currentTabId: number;
  }): Promise<string | null> {
    return routeWorkflowTabTool({
      getSnapshot: () => this.context.getSnapshot(),
      getCurrentUrl: () => this.context.getCurrentUrl(),
      getSelectedSkillId: () => this.selectedSkillId,
      getTurnCount: () => this.turnCount,
      getWorkspaceTabs: () => getWorkspaceTabs({ workspaceId: this.workspaceId }),
      recordEvent: (name, data) => this.traceRecorder?.recordEvent(name, data),
    }, params);
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
  private acceptPageSnapshot(
    snapshot: DomSnapshot,
    documentState?: PageDocumentState,
    options: {
      consistency?: "dom_only" | "inconsistent";
      consistencyReason?: string;
    } = {},
  ): void {
    this.perception.acceptDomObservation({
      snapshot,
      documentState: documentState ?? legacyDocumentState(snapshot),
      ...options,
    });
    this.context.setSnapshot(snapshot);
    this.elementResolver = buildElementResolver(snapshot.elements);
  }

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

    const sendRequest = () => requestPageSnapshot(tabId, {
      refresh: true, autoDismiss: false,
    });

    try {
      const snapResponse = await sendRequest();
      if (snapResponse?.payload?.snapshot) {
        this.acceptPageSnapshot(
          snapResponse.payload.snapshot,
          snapResponse.payload.documentState,
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
              this.acceptPageSnapshot(
                retryResponse.payload.snapshot,
                retryResponse.payload.documentState,
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
  public getActiveToolNamesForTurn(): ToolName[] {
    return [...this.activeToolNamesForTurn];
  }

  private getActivePerceptionTaskContext(): PerceptionTaskContext | undefined {
    return deriveActivePerceptionTaskContext(this.planSteps, this.planSubtasks, this.lastPlanIndex);
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
      await captureVLExecutorScreenshot(this.perceptionCaptureHost, tabId, this.vlScreenshotState);
      // Skip triagePopups — executor sees overlays in screenshot and calls dismiss_overlays.
      return;
    }
    // Text-only turn: no screenshot and no separate perception model. The
    // executor works from the DOM element summary and dismisses overlays
    // itself (via dismiss_overlays).
    this.context.setScreenshotForExecutor(null);
    this.context.setPageInterpretation(null);
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

  /** Execute a tool call via the tool registry. */
  private async executeToolCall(
    toolCall: ToolCall,
    tabId: number,
  ): Promise<string> {
    const toolName = toolCall.function.name as ToolName;
    const observationBasis = pageActionLifecycle.stageGroundedAction(
      this.perception,
      toolCall.id,
      this.modelTurnObservationBasis,
    );
    const staleResult = await pageActionLifecycle.preflightDirectPageAction({
      coordinator: this.perception,
      traceRecorder: this.traceRecorder,
      actionId: toolCall.id,
      toolName,
      basis: observationBasis,
      enforceConsistency: this.enforcePageStateConsistency,
      tabId,
    });
    if (staleResult) return staleResult;
    // LP-13: inspect_region needs loop-owned state (screenshot cache
    // metadata, zoom cap, budget, delivery) — intercept before the registry
    // so both the sequential and parallel dispatch paths are covered.
    if (toolName === ToolName.INSPECT_REGION) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        // Empty args fail validation inside with a bad_args refusal.
      }
      const result = await executeInspectRegion(
        createRegionZoomHost(
          this.perceptionCaptureHost,
          tabId,
          observationBasis,
        ),
        this.regionZoomState,
        args,
        tabId,
      );
      pageActionLifecycle.settleInspectAction({
        coordinator: this.perception,
        traceRecorder: this.traceRecorder,
        actionId: toolCall.id,
        toolName,
        basis: observationBasis,
        result,
      });
      return result;
    }
    const execution = await toolRegistry.executeDetailed(
      toolCall,
      tabId,
      this.abortController!.signal,
      pageActionLifecycle.actionExecutionContext(
        observationBasis,
        toolName,
        this.enforcePageStateConsistency,
      ),
    );
    pageActionLifecycle.settleToolAction({
      coordinator: this.perception,
      traceRecorder: this.traceRecorder,
      actionId: toolCall.id,
      toolName,
      basis: observationBasis,
      execution,
    });
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

  // Catalog-order controller delegates into the reusable catalog workflow.

  private maybeCompleteCatalogOrderFromSnapshot(): LoopResult | null {
    return maybeCompleteCatalogOrderFromSnapshot(
      this as unknown as CatalogHost,
    );
  }

  private shouldAutoSubmitConfiguredCatalogItem(params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
  }): boolean {
    return shouldAutoSubmitConfiguredCatalogItem(
      this as unknown as CatalogHost,
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
      this as unknown as CatalogHost,
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
      this as unknown as CatalogHost,
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
    const newIndex = this.planProgress.completeRemainingSubtasks(currentIndex, signal.reason);
    const completionCandidate = this.completionEvidenceRuntime.createTrustedCompletionCandidate({
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

  private readonly gatesPhaseHost: GatesPhaseHost = (() => {
    const loop = () => this;
    return {
      get isRunning() { return loop().isRunning; },
      get turnCount() { return loop().turnCount; },
      set turnCount(value: number) { loop().turnCount = value; },
      get turnsOnCurrentStep() { return loop().turnsOnCurrentStep; },
      set turnsOnCurrentStep(value: number) { loop().turnsOnCurrentStep = value; },
      get guardAfterDoneRejection() { return loop().guardAfterDoneRejection; },
      set guardAfterDoneRejection(value: boolean) { loop().guardAfterDoneRejection = value; },
      get pauseGate() { return loop().pauseGate; },
      get checkpoints() { return loop().checkpoints; },
      get middleware() { return loop().middleware; },
      get maxTurns() { return loop().maxTurns; },
      get telemetry() { return loop().telemetry; },
      get log() { return loop().log; },
      get workspaceId() { return loop().workspaceId; },
      get workerId() { return loop().workerId; },
      throwIfGracefulStopRequested: () => loop().throwIfGracefulStopRequested(),
      finishStream: () => loop().finishStream(),
      broadcast: (message: BroadcastMessage) => loop().broadcast(message),
      statusHandler: (status: AgentStatus, detail: string) => loop().statusHandler(status, detail),
    };
  })();
  private readonly prepareTurnContextHost: PrepareTurnContextHost = (() => {
    const loop = () => this;
    return {
      get turnCount() { return loop().turnCount; },
      get maxTurns() { return loop().maxTurns; },
      get traceRecorder() { return loop().traceRecorder; },
      get llm() { return loop().llm; },
      get context() { return loop().context; },
      get telemetry() { return loop().telemetry; },
      get moneyTable() { return loop().moneyTable; },
      broadcast: (message: BroadcastMessage) => loop().broadcast(message),
      maybeCompleteCatalogOrderFromSnapshot: () => loop().maybeCompleteCatalogOrderFromSnapshot(),
    };
  })();
  private async loop(initialTabId: number): Promise<LoopResult> {
    const {
      session,
      turnState,
      toolFailCounts,
      recentSuccesses,
      verifiedFinalClickBypassKeys,
      blockedActions,
      recentOutcomes,
      recentObservationProgressKeys,
      subgoalAttempts,
      esc,
      resetStepScopedActionMemory,
      resetEscalationWorkingMemory,
      beginPlannerEscalation,
    } = createLoopRunState(
      this as unknown as TurnControllerHost,
      initialTabId,
      this.lastPlanIndex,
    );
    if (esc.orientationPhase) {
      this.escalateModel(); // Start with planner model (plan phase)
    }

    while (this.isRunning && this.turnCount < this.maxTurns) {
      // Turn-scoped state, reset each iteration (RFC LP-16 Phase 3). See loop-scope.ts.
      const turn = new TurnScope();

      // Top-of-turn control gate (RFC LP-15 Phase 11): pause / graceful-stop /
      // middleware halt + counter advance + idempotency-cache clear.
      const gate = await runGatesPhase(this.gatesPhaseHost, {
        resetStepScopedActionMemory,
      });
      if (gate.kind === "end_turn") break;

      // Per-turn escalation bookkeeping: cooldown tick, one-shot investigation
      // extension, and the plan-then-act orientation handoff (tier 1→0).
      session.prevElementCount = await esc.onTurnStart({
        tabId: session.tabId,
        prevElementCount: session.prevElementCount,
      });

      runFeedbackPhase({
        pendingFeedback: this.pendingFeedback,
        clearPendingFeedback: () => { this.pendingFeedback = null; },
        turnCount: this.turnCount,
        traceRecorder: this.traceRecorder,
        context: this.context,
        escalationRescue: this.escalationRescue,
      });

      const turnContext = runPrepareTurnContextPhase(
        this.prepareTurnContextHost,
        session,
      );
      if (turnContext.kind === "end_task") return turnContext.result;

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
      if (escalationOutcome.kind === "end_task") return escalationOutcome.result;

      const preparedTurn = await runPrepareModelTurnPhase(
        this as unknown as PrepareModelTurnHost,
        session.prevElementCount,
      );
      if (preparedTurn.kind === "end_task") {
        return preparedTurn.result;
      }
      session.prevElementCount = preparedTurn.prepared.previousElementCount;
      const { response, hallucinationDetected, normalizedContent, rawContent,
        cleanContent, toolsRecoveredFromText, llmIntention } = preparedTurn.prepared;

      if (response.tool_calls && response.tool_calls.length > 0) {
        // ACTION REQUIRED. The streaming message stays open across tool-calling
        // turns (finalized when done() is called or the loop exits).
        // signalCompletedResult is shared with the completion phase, so it is
        // created here and threaded into both.
        const signalCompletedResult = createCompletionSignal(
          session,
          turn,
          (summary, options) => this.completeTaskResult(summary, options),
        );
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
        const account = await runAccountAndRefreshPhase({
          turnCount: this.turnCount, context: this.context,
          traceRecorder: this.traceRecorder, turnCheckpoint: this.turnCheckpoint,
        }, turn);
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

    return finishLoopSession({
      turnCount: this.turnCount,
      maxTurns: this.maxTurns,
      doneSummary: session.doneSummary,
      completedResult: this.completedResult,
      log: this.log,
      traceRecorder: this.traceRecorder,
      buildPartialHandoff: () => this.partialProgress.buildMaxTurnPartialHandoff(),
      broadcast: (message) => this.broadcast(message),
      finishStream: () => this.finishStream(),
      statusHandler: (status, detail) => this.statusHandler(status, detail),
      getMetrics: () => this.getMetrics(),
    });
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

    const tabId = savedState.activeTabId;

    if (newSnapshot) {
      const readiness = await waitForDomReady(tabId, { timeoutMs: 50 });
      this.acceptPageSnapshot(newSnapshot, readiness.documentState);
    }

    this.statusHandler(AgentStatus.THINKING, "Resuming after navigation...");

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
    return createNavigationLoopState(tabId, this.context.getMessages(), {
      originalQuery: this.originalQuery,
      turnCount: this.turnCount,
      maxTurns: this.maxTurns,
      workspaceId: this.workspaceId,
      workerId: this.workerId,
    });
  }
}
