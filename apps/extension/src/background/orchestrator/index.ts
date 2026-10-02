import { providerRoutingOptions } from "../llm/provider-routing-policy";
import { getOrchestratorSnapshot } from "./snapshot-reader";
import { chromePersistencePort } from "../environment/chrome";
import { getTrustedCorpusStore } from "../memory/corpus-runtime";
import { applyRootGoalShortcut } from "./root-goal-application";
import {
  collectSchedulerCycle,
  getExecutorLaneWait,
  queueRunnableWorkers,
  recordSchedulerStall,
  waitForExecutorLane,
} from "./scheduler-runtime";
import { extractedFactToCorpusEntry } from "../memory/trusted-corpus-migration";
import { AgentLoop } from "../agent";
import {
  AgentStatus,
  MessageSource,
  TaskCompletionMessage,
  ToolName,
} from "../../types";
import { logger } from "../../utils";
import {} from "../../utils/provider-keys";
import {
  buildPersonalProfilePlannerContext,
  EMPTY_PERSONALIZATION_STATE,
  loadPersonalizationState,
} from "../../utils/personal-profile";
import { workspaceManager } from "../workspaces/manager";
import { createWorkspaceTab } from "../workspaces/create-workspace-tab";
import { agentNotifications } from "../notifications";
import {
  updateTabGroupAppearance,
  resetTabGroupAppearance,
} from "../workspaces/tab-group-appearance";
import { waitForContentScriptReady } from "../tab-ready";
import { OrchestratorPlanner, qualifiesForDirectSingleNode } from "./planner";

import {
  OrchestratorStartInput,
  OrchestratorCheckpoint,
  OrchestratorTask,
  TaskNode,
  WorkerInstance,
} from "./types";
import { buildScheduledTaskFinalization } from "./task-completion-payload";
import { resolveRunnableTabId as recoverRunnableTabId } from "./tab-recovery";
import { assignWorkerTab } from "./worker-tab-assignment";
import { tryHorizonExpansion } from "./horizon-expansion";
import { createWorkerAgentLoop } from "./worker-loop-setup";
import { prepareWorkerContext } from "./worker-context";
import {
  recordWorkerVerificationDecision,
  resolveWorkerVerification,
} from "./worker-verification";
import { applyVerifierRetry } from "./verifier-retry";
import { maybeReplanVerifierRetry } from "./verifier-replan";
import { recordWorkerResultState } from "./worker-result-state";
import { registerWorker, releaseWorker, startWorkerNode } from "./worker-lifecycle";
import {
  recordIncompleteWorkerResult,
  recordThrownWorkerFailure,
} from "./worker-result-failure";
import { attachExecutorResultEvidence } from "./executor-result-evidence";
import { prepareExecutorInstruction } from "./executor-instruction";
import {
  applyBudgetTermination as terminateForBudget,
  emitBudgetWarnings,
  getBudgetExhaustionReason as assessBudgetExhaustion,
} from "./execution-budget";
import { applyImmediateVerifierOutcome } from "./verifier-outcome";
import { enforceToolProfile } from "./enforced-tool-profile";
import { RecentCompletionTracker } from "./recent-completion-tracker";
import { buildNewTask } from "./task-bootstrap";
import {
  recordDirectInitialPlan,
  recordFallbackInitialPlan,
  recordStructuredInitialPlan,
} from "./initial-plan-results";
import { PendingFeedbackQueue } from "./pending-feedback-queue";
import { CompletionWaiterRegistry } from "./completion-waiter-registry";
import { PendingInteractionTimers } from "./pending-interaction-timers";
import { buildResumeInput } from "./resume-input";
import {
  buildTaskManifest,
  buildSyntheticPendingInteractionSummary,
  buildSubtaskResults,
} from "./builders";
import {
  resolveVerifierEscalation,
  type EscalationInteractionHost,
} from "./escalation-interaction";
import {
  requestPlanConfirmation,
  resolvePlanConfirmation as resolvePendingPlanConfirmation,
  type PlanConfirmationHost,
} from "./plan-confirmation";
import {
  buildTaskPausedMessage,
  emitPendingInteractionMessage,
  getPendingInteractionRemainingMs,
  isPendingInteractionResolved,
} from "./pending-interaction";
import { maybeApplyHighRiskJudgeGate } from "./high-risk-judge-gate";
import {
  appendHandoffArtifact,
  notifyTaskCompletion,
  sendMessage,
  sendTaskProgress,
} from "./task-messaging";
import { sendStatus } from "./status-emitters";
import {
  executeLaneOperation,
  type LaneOperationRuntimeHost,
} from "./lane-operation-runtime";
import {
  buildParallelRunState,
} from "./plan-state";
export { buildInitialPlanState } from "./plan-state";
import {
  claimTaskTab,
  createTaskTabCoordination,
  ensureTaskTabCoordination,
  getOwnedCreatedTabIds,
  releaseTaskTab,
  selectResumeOwnedTab,
} from "./tab-coordination";
import { OrchestratorTraceEmitter } from "./trace-emitter";
import { OrchestratorVerifier } from "./verifier";
import { appendRecentSideEffects } from "./node-heuristics";
import { buildRoleExecutionContract } from "./contracts";
import { BudgetEstimator } from "./budget-estimator";
import { BudgetEstimatorRegistry } from "./budget-estimator-registry";
import { PendingResolverRegistry } from "./pending-resolver-registry";
import { LaneRegistry } from "./lane-registry";
import { WorkspaceRegistry } from "./workspace-registry";
import {
  CreateAgentLoopInput,
  EscalationDecisionPayload,
  LaneRuntimeState,
  LaneSupervisorState,
  RuntimeLane,
  WorkspaceLanePools,
} from "./lane-types";
import type { OrchestratorDeps } from "./lane-types";
import {
  buildLaneTelemetrySnapshot as buildLaneTelemetrySnapshotData,
  createWorkspaceLanePools,
  createWorkspaceLaneRuntime,
  createWorkspaceLaneSupervisors,
  enqueueLaneOperation,
  getNextLaneDrainDecision,
} from "./lane-supervisor";
import {
  resolveLaneTopologyFromSettings,
  shouldUsePlannerDecomposition,
} from "./lane-topology";
import {
  CHECKPOINT_VERSION,
  DEFAULT_MAX_SESSION_TIME_MS,
  DEFAULT_MAX_TOTAL_COST_USD,
  DEFAULT_MAX_TOTAL_TOKENS,
  emptySessionMetrics,
} from "./sanitizers";
import {
  orchestratorCheckpointStore,
} from "./checkpoint-store";
import {
  clampInteger,
  currentIndex,
  isLaneIsolationError,
  normalizeEscalationOptionId,
} from "./utils";
import {
  turnCheckpointKey,
  sanitizeTurnCheckpoint,
} from "../agent/checkpoint-types";
import type { TurnCheckpoint } from "../agent/checkpoint-types";
import type { PendingUserInteraction } from "../agent/loop-types";
import type { CompletionEnvelope } from "../agent/completion-kernel";
import type { TaskRunProgressInput } from "@shared-types/progress";
import { hasUsefulPartialProgressHandoff } from "../agent/partial-progress-handoff";
import {
  buildTaskFleetTelemetryProjectionInput,
  createTaskFleetTelemetryState,
  type TaskFleetTelemetryState,
} from "./fleet-telemetry";
import {
  collectFleetTelemetryLocally,
  projectFleetTelemetryEnvelope,
} from "../telemetry";
import {
  clearOutstandingQuestions,
  deleteStructuredProgressEntry,
  DEFAULT_MAX_WORKERS,
  E2E_PENDING_INTERACTION_TIMEOUT_MS,
  E2E_SYNTHETIC_QUERY_PREFIX,
  isSyntheticPendingInteractionTask,
  EXHAUSTIVE_REVIEW_MAX_TOTAL_TOKENS,
  getFleetTelemetryRuntimeContext,
  ignoreSiblingsAfterRootCompletion,
  isLargeExhaustiveReviewGraph,
  LIST_DETAIL_REVIEW_SKILL_ID,
  MAX_PERSISTED_MESSAGES,
  MULTI_TAB_CHECKLIST_SKILL_ID,
  NAVIGATE_READ_RETURN_SKILL_ID,
  recordOutstandingQuestion,
  setStructuredProgressEntry,
} from "./runtime-policy";

export * from "./lane-types";
export * from "./sanitizers";
export * from "./utils";

export class Orchestrator {
  private tasksByWorkspace = new WorkspaceRegistry<OrchestratorTask>();
  private recentCompletionTracker = new RecentCompletionTracker();
  private completionWaiters = new CompletionWaiterRegistry();
  private workersByWorkspace = new WorkspaceRegistry<WorkspaceLanePools>();
  private pendingFeedback = new PendingFeedbackQueue();
  private budgetEstimators = new BudgetEstimatorRegistry();
  private lanes = new LaneRegistry();
  private pendingEscalationResolvers =
    new PendingResolverRegistry<EscalationDecisionPayload>();
  private readonly escalationInteractionHost: EscalationInteractionHost = {
    persistTaskCheckpoint: (task) => this.persistTaskCheckpoint(task),
    emitTraceEvent: (task, type, data, role) =>
      this.emitTraceEvent(task, type, data, role),
    pendingEscalationResolvers: this.pendingEscalationResolvers,
  };
  private pendingPlanConfirmationResolvers = new PendingResolverRegistry<{
    decision: "approve" | "cancel";
    feedback?: string;
  }>();
  private readonly planConfirmationHost: PlanConfirmationHost = {
    pendingPlanConfirmationResolvers: this.pendingPlanConfirmationResolvers,
    emitTraceEvent: (task, type, data, role) =>
      this.emitTraceEvent(task, type, data, role),
  };
  private readonly laneOperationHost: LaneOperationRuntimeHost = {
    getLaneRuntimeState: (workspaceId, lane) =>
      this.getLaneRuntimeState(workspaceId, lane),
    getLaneSupervisorState: (workspaceId, lane) =>
      this.getLaneSupervisorState(workspaceId, lane),
    getWorkspaceLanePools: (workspaceId) => this.getWorkspaceLanePools(workspaceId),
    stopExecutorWorkerForNode: (workspaceId, nodeId, reason) =>
      this.stopExecutorWorkerForNode(workspaceId, nodeId, reason),
    emitTraceEvent: (task, type, data, role) =>
      this.emitTraceEvent(task, type, data, role),
    emitLaneSupervisorActivity: (workspaceId) =>
      this.emitLaneSupervisorActivity(workspaceId),
    drainLaneQueue: (workspaceId, lane) => this.drainLaneQueue(workspaceId, lane),
  };
  private pendingInteractionTimers = new PendingInteractionTimers();
  private fleetTelemetryByTaskId = new Map<string, TaskFleetTelemetryState>();
  private trace = new OrchestratorTraceEmitter();
  private deps: Required<OrchestratorDeps>;

  constructor(deps: OrchestratorDeps = {}) {
    this.deps = {
      createPlanner:
        deps.createPlanner ??
        ((openRouterApiKey, modelOverrides) =>
          new OrchestratorPlanner(openRouterApiKey, modelOverrides)),
      createVerifier:
        deps.createVerifier ??
        ((openRouterApiKey, modelOverrides) =>
          new OrchestratorVerifier(openRouterApiKey, modelOverrides)),
      createAgentLoop:
        deps.createAgentLoop ??
        ((input: CreateAgentLoopInput) =>
          new AgentLoop(
            input.openRouterApiKey,
            input.callbacks!,
            input.options,
          )),
      workspaceManager: deps.workspaceManager ?? workspaceManager,
      waitForContentScriptReady:
        deps.waitForContentScriptReady ?? waitForContentScriptReady,
      lanePolicies: deps.lanePolicies ?? {},
    };
  }

  private emitTraceEvent(
    task:
      | { runId?: string; id?: string; workspaceId?: string }
      | null
      | undefined,
    type: string,
    data?: Record<string, unknown>,
    role?: "planner" | "executor" | "verifier" | "system",
  ): void {
    this.trace.emitEvent(task, type, data, role);
  }

  private emitCompletionScopeTransition(
    task:
      | {
          runId?: string;
          id?: string;
          workspaceId?: string;
          nodes?: TaskNode[];
        }
      | null
      | undefined,
    data: {
      scope: "lane" | "node" | "root";
      status: "completed" | "sibling_ignored";
      nodeId?: string;
      reason: string;
      envelope?: CompletionEnvelope;
      skippedNodeIds?: string[];
    },
  ): void {
    this.trace.emitCompletionScopeTransition(task, data);
  }

  private ignoreSiblingsAfterRootCompletion(
    task: OrchestratorTask,
    params: {
      reason: string;
      result: string;
    },
  ): string[] {
    const workers = this.workersByWorkspace.get(task.workspaceId)?.executor;
    return ignoreSiblingsAfterRootCompletion(
      task,
      workers,
      params,
      (type, data, role) => this.emitTraceEvent(task, type, data, role),
    );
  }

  private attachPlannerUsageTrace(
    planner: unknown,
    task:
      | { runId?: string; id?: string; workspaceId?: string }
      | null
      | undefined,
    phase: () => string,
  ): void {
    this.trace.attachPlannerUsage(planner, task, phase);
  }

  private emitNodeFailureAttribution(
    task: OrchestratorTask,
    node: TaskNode,
    reason: string,
    detail?: Record<string, unknown>,
  ): void {
    this.trace.emitNodeFailure(task, node, reason, detail);
  }

  private emitTabCoordinationState(
    task: OrchestratorTask,
    action: string,
    detail: Record<string, unknown> = {},
  ): void {
    this.trace.emitTabCoordinationState(task, action, detail);
  }

  private createWorkspaceLanePools(): WorkspaceLanePools {
    return createWorkspaceLanePools();
  }

  private getWorkspaceLanePools(workspaceId: string): WorkspaceLanePools {
    let pools = this.workersByWorkspace.get(workspaceId);
    if (!pools) {
      pools = this.createWorkspaceLanePools();
      this.workersByWorkspace.set(workspaceId, pools);
    }
    return pools;
  }

  private initializeWorkspaceRuntime(
    workspaceId: string,
    maxWorkers: number,
    task?: Pick<OrchestratorTask, "laneTopologyMode">,
  ): void {
    const topology = resolveLaneTopologyFromSettings({
      laneTopologyMode: task?.laneTopologyMode,
    });
    this.budgetEstimators.reset(workspaceId);
    this.workersByWorkspace.set(workspaceId, this.createWorkspaceLanePools());
    this.lanes.setSupervisors(workspaceId, createWorkspaceLaneSupervisors());
    this.lanes.setRuntime(
      workspaceId,
      createWorkspaceLaneRuntime({
        maxWorkers,
        overrides: this.deps.lanePolicies,
        topology,
      }),
    );
    logger.debug("orchestrator", "Workspace runtime isolation initialized", {
      workspaceId,
      maxWorkers,
      laneTopologyMode: topology.mode,
    });
    this.emitLaneSupervisorActivity(workspaceId);
  }

  private cleanupWorkspaceRuntime(workspaceId: string): void {
    this.clearPendingInteractionTimer(workspaceId);
    this.lanes.clear(workspaceId);
    this.workersByWorkspace.delete(workspaceId);
    this.budgetEstimators.clear(workspaceId);
    this.pendingFeedback.clear(workspaceId);
  }

  private queueFeedback(workspaceId: string, text: string): void {
    const queueLength = this.pendingFeedback.enqueue(workspaceId, text);
    logger.warn("orchestrator", "Feedback queued without active executor", {
      workspaceId,
      queueLength,
    });

    const task = this.tasksByWorkspace.get(workspaceId);
    if (task) void this.persistTaskCheckpoint(task);
  }

  private drainPendingFeedbackIntoLoop(
    workspaceId: string,
    loop: WorkerInstance["loop"],
    workerId: string,
    nodeId: string,
  ): void {
    const pending = this.pendingFeedback.peek(workspaceId);
    if (!pending?.length) return;

    for (const text of pending) {
      loop.injectFeedback(text);
    }
    this.pendingFeedback.clear(workspaceId);
    logger.info("orchestrator", "Queued feedback delivered to executor", {
      workspaceId,
      workerId,
      nodeId,
      feedbackCount: pending.length,
    });

    const task = this.tasksByWorkspace.get(workspaceId);
    if (task) void this.persistTaskCheckpoint(task);
  }

  private getBudgetEstimator(workspaceId: string): BudgetEstimator {
    return this.budgetEstimators.get(workspaceId);
  }

  private getLaneRuntimeState(
    workspaceId: string,
    lane: RuntimeLane,
  ): LaneRuntimeState {
    const runtime = this.lanes.getRuntime(workspaceId);
    if (!runtime) {
      this.initializeWorkspaceRuntime(workspaceId, DEFAULT_MAX_WORKERS);
      return this.lanes.getRuntime(workspaceId)![lane];
    }
    return runtime[lane];
  }

  private getLaneSupervisorState(
    workspaceId: string,
    lane: RuntimeLane,
  ): LaneSupervisorState {
    const supervisors = this.lanes.getSupervisors(workspaceId);
    if (!supervisors) {
      this.initializeWorkspaceRuntime(workspaceId, DEFAULT_MAX_WORKERS);
      return this.lanes.getSupervisors(workspaceId)![lane];
    }
    return supervisors[lane];
  }

  private buildLaneTelemetrySnapshot(workspaceId: string): {
    timestamp: number;
    lanes: Record<
      RuntimeLane,
      {
        activeCalls: number;
        queueDepth: number;
        restartCount: number;
        consecutiveCrashes: number;
        circuitOpenUntilMs: number;
        lastCrashError?: string;
      }
    >;
  } {
    return buildLaneTelemetrySnapshotData({
      runtime: this.lanes.getRuntime(workspaceId),
      supervisors: this.lanes.getSupervisors(workspaceId),
    });
  }

  private emitLaneSupervisorActivity(workspaceId: string): void {
    const task = this.tasksByWorkspace.get(workspaceId);
    const telemetry = this.buildLaneTelemetrySnapshot(workspaceId);
    const activeFromTask =
      task?.status === "running" || task?.status === "planning";
    const activeFromLanes = Object.values(telemetry.lanes).some(
      (lane) => lane.activeCalls > 0 || lane.queueDepth > 0,
    );
    sendMessage({
      type: "AGENT_ACTIVITY",
      workspaceId,
      payload: {
        active: Boolean(activeFromTask || activeFromLanes),
        laneTelemetry: telemetry,
      },
    });
  }

  private async drainLaneQueue(
    workspaceId: string,
    lane: RuntimeLane,
  ): Promise<void> {
    const supervisor = this.getLaneSupervisorState(workspaceId, lane);
    const runtimeState = this.getLaneRuntimeState(workspaceId, lane);
    if (supervisor.draining) return;
    supervisor.draining = true;
    try {
      let shouldContinue = true;
      while (shouldContinue) {
        const decision = getNextLaneDrainDecision({
          lane,
          state: runtimeState,
          supervisor,
        });
        if (decision.action === "isolated") {
          for (const queued of decision.pending) {
            queued.reject(decision.error);
          }
          shouldContinue = false;
          continue;
        }

        if (decision.action === "wait") {
          if (!supervisor.resumeTimer) {
            supervisor.resumeTimer = setTimeout(() => {
              supervisor.resumeTimer = null;
              void this.drainLaneQueue(workspaceId, lane);
            }, decision.waitMs);
            logger.debug(
              "orchestrator",
              "Lane supervisor waiting for backoff",
              {
                workspaceId,
                lane,
                waitMs: decision.waitMs,
                queueDepth: supervisor.queue.length,
              },
            );
          }
          shouldContinue = false;
          continue;
        }

        if (decision.action !== "execute") {
          shouldContinue = false;
          continue;
        }

        void executeLaneOperation(
          this.laneOperationHost,
          {
            id: decision.queued.taskId,
            workspaceId: decision.queued.workspaceId,
          },
          lane,
          decision.queued,
        )
          .then((result) => decision.queued.resolve(result))
          .catch((error) => decision.queued.reject(error));
      }
    } finally {
      supervisor.draining = false;
    }
  }

  private runInLane<T>(
    task: OrchestratorTask,
    lane: RuntimeLane,
    operation: () => Promise<T>,
    metadata?: { label?: string; nodeId?: string },
  ): Promise<T> {
    const state = this.getLaneRuntimeState(task.workspaceId, lane);
    const supervisor = this.getLaneSupervisorState(task.workspaceId, lane);
    const operationId = `${lane}-queued-${crypto.randomUUID()}`;
    const enqueued = enqueueLaneOperation({
      taskId: task.id,
      workspaceId: task.workspaceId,
      lane,
      state,
      supervisor,
      operation,
      metadata,
      operationId,
    });

    if (enqueued.queued) {
      logger.debug("orchestrator", "Lane operation queued", {
        taskId: task.id,
        workspaceId: task.workspaceId,
        lane,
        operationId,
        nodeId: metadata?.nodeId,
        queueDepth: enqueued.queueDepth,
        activeLaneCalls: supervisor.active,
      });
      this.emitLaneSupervisorActivity(task.workspaceId);
      void this.drainLaneQueue(task.workspaceId, lane);
    }

    return enqueued.promise;
  }

  private stopExecutorWorkerForNode(
    workspaceId: string,
    nodeId: string,
    reason: string,
  ): boolean {
    const workers = this.workersByWorkspace.get(workspaceId)?.executor;
    if (!workers) return false;

    let stopped = false;
    for (const worker of workers.values()) {
      if (worker.nodeId !== nodeId) continue;
      worker.loop.stop();
      workers.delete(worker.workerId);
      stopped = true;
      logger.warn("orchestrator", "Executor worker stopped", {
        workspaceId,
        nodeId,
        workerId: worker.workerId,
        reason,
      });
    }
    return stopped;
  }

  private setStructuredProgressEntry(
    task: OrchestratorTask,
    entry: TaskRunProgressInput,
  ): void {
    setStructuredProgressEntry(task, entry);
  }

  private deleteStructuredProgressEntry(
    task: OrchestratorTask,
    key: string,
  ): void {
    deleteStructuredProgressEntry(task, key);
  }

  private maybeRecordExtractedFacts(
    task: OrchestratorTask,
    node: TaskNode,
    compactResultSummary: string,
  ): void {
    const shouldCapture =
      node.selectedSkillId === LIST_DETAIL_REVIEW_SKILL_ID ||
      node.selectedSkillId === NAVIGATE_READ_RETURN_SKILL_ID ||
      node.selectedSkillId === MULTI_TAB_CHECKLIST_SKILL_ID;
    if (!shouldCapture || compactResultSummary.length === 0) return;
    this.setStructuredProgressEntry(task, {
      key: "extracted-facts",
      kind: "extracted-fact-map",
      payload: {
        [node.id]: compactResultSummary,
      },
    });
    // RFC LP-15 Phase 9: shadow-write the extracted fact to the trusted corpus
    // WITH provenance (the checkpoint-blob map has none). Best-effort; the
    // structuredProgress entry above stays the authoritative read path for one
    // release. Never blocks node completion.
    void getTrustedCorpusStore()
      .upsert(
        extractedFactToCorpusEntry({
          taskId: task.id,
          nodeId: node.id,
          summary: compactResultSummary,
          capturedAt: Date.now(),
        }),
      )
      .catch(() => {});
  }

  /**
   * Run the high-risk judge gate for a node whose verification accepted (RFC
   * LP-15 Phase 10). Loads the relevant trusted-corpus facts, renders the
   * executor evidence, and adjudicates via the verifier's judge seat. Returns
   * null on any error so a gate failure can never block a legitimate accept —
   * the gate only ever tightens completion, never loosens it.
   */

  private async persistTaskCheckpoint(task: OrchestratorTask): Promise<void> {
    if (this.tasksByWorkspace.get(task.workspaceId) !== task) return;
    const pendingFeedback = this.pendingFeedback.peek(task.workspaceId);
    const checkpoint = structuredClone<OrchestratorCheckpoint>({
      version: CHECKPOINT_VERSION,
      savedAt: Date.now(),
      task: {
        ...task,
        nodes: task.nodes.map((n) => ({ ...n })),
      },
      ...(pendingFeedback?.length
        ? { pendingFeedback: [...pendingFeedback] }
        : {}),
    });
    await orchestratorCheckpointStore.save(checkpoint);
  }

  private async clearTaskCheckpoint(task: OrchestratorTask): Promise<void> {
    await orchestratorCheckpointStore.clear(task.workspaceId, task.id);
  }

  private async getLiveWorkspaceTabs(
    workspaceId: string,
  ): Promise<chrome.tabs.Tab[]> {
    const ws = await this.deps.workspaceManager.getWorkspaceById(workspaceId);
    const liveTabs: chrome.tabs.Tab[] = [];
    for (const tabId of ws?.tabIds ?? []) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.id) liveTabs.push(tab);
      } catch {
        // skip stale tab IDs
      }
    }
    return liveTabs;
  }

  private async resolveResumeTabId(
    taskLike: Pick<
      OrchestratorTask,
      "workspaceId" | "rootTabId" | "rootTabUrl" | "tabCoordination"
    >,
    preferredTabId: number,
  ): Promise<ReturnType<typeof selectResumeOwnedTab>> {
    const liveTabs = await this.getLiveWorkspaceTabs(taskLike.workspaceId);
    if (liveTabs.length === 0) {
      const fallbackTabIds = new Set(
        [preferredTabId, taskLike.rootTabId].filter(
          (tabId) => Number.isFinite(tabId) && tabId > 0,
        ),
      );
      for (const tabId of fallbackTabIds) {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab?.id) liveTabs.push(tab);
        } catch {
          // The durable root tab may have been closed.
        }
      }
    }
    return selectResumeOwnedTab(taskLike, liveTabs, preferredTabId);
  }

  private clearPendingInteractionTimer(workspaceId: string): void {
    this.pendingInteractionTimers.clear(workspaceId);
  }

  private emitPendingInteraction(task: OrchestratorTask): void {
    if (task.pendingInteraction?.kind === "clarification") {
      recordOutstandingQuestion(task, task.pendingInteraction.question);
    }
    const emission = emitPendingInteractionMessage(task);
    if (!emission) return;
    sendMessage(emission.message);
    void agentNotifications.notifyAttention(emission.attention);
    // Re-forward the pause over the bridge on recovery/re-emit (Phase 4).
    const paused = buildTaskPausedMessage(task);
    if (paused) sendMessage(paused);
  }

  private async finalizeSyntheticPendingInteractionTask(
    task: OrchestratorTask,
  ): Promise<void> {
    const interaction = task.pendingInteraction;
    if (!interaction || !isPendingInteractionResolved(interaction)) {
      return;
    }

    const summary = buildSyntheticPendingInteractionSummary(interaction);
    const terminalStatus =
      interaction.kind === "approval" && interaction.approved === false
        ? "failed"
        : "completed";

    clearOutstandingQuestions(task);

    if (interaction.nodeId) {
      const targetNode = task.nodes.find(
        (node) => node.id === interaction.nodeId,
      );
      if (targetNode) {
        targetNode.status =
          terminalStatus === "completed" ? "completed" : "failed";
        targetNode.result = summary;
        if (terminalStatus === "failed") {
          targetNode.error = summary;
        }
      }
    }

    task.currentIndex = currentIndex(task.nodes);
    await this.finalizeTask(task, {
      status: terminalStatus,
      buildPayload: () => ({
        taskId: task.id,
        status: terminalStatus,
        totalTurnsUsed: 0,
        totalTimeMs: task.finishedAt! - (task.startedAt || task.createdAt),
        summary,
        subtaskResults: buildSubtaskResults(task),
        urlHistory: [],
        metrics: task.sessionMetrics,
        terminationReason: terminalStatus === "failed" ? summary : undefined,
      }),
      agentStatus: AgentStatus.IDLE,
      detail: terminalStatus === "completed" ? "Task complete" : "Task failed",
    });
  }

  private async resumeTaskAfterInteraction(
    task: OrchestratorTask,
    interaction: PendingUserInteraction,
  ): Promise<void> {
    if (!this.isCurrentInteraction(task, interaction)) return;
    if (isSyntheticPendingInteractionTask(task)) {
      await this.finalizeSyntheticPendingInteractionTask(task);
      return;
    }

    const resumeSelection = await this.resolveResumeTabId(task, task.rootTabId);
    if (!this.isCurrentInteraction(task, interaction)) return;
    if (resumeSelection.status !== "safe") {
      logger.warn(
        "orchestrator",
        "Cannot resume after pending interaction, rebinding unsafe",
        {
          workspaceId: task.workspaceId,
          taskId: task.id,
          reason: resumeSelection.reason,
        },
      );
      task.terminationReason = `Could not resume after user interaction. ${resumeSelection.reason}`;
      await this.terminateTask(task, "failed", task.terminationReason, {});
      return;
    }
    const resumeTabId = resumeSelection.tabId;

    const resumeInput = await buildResumeInput(task, resumeTabId);
    if (!this.isCurrentInteraction(task, interaction)) return;
    if (!resumeInput) {
      task.terminationReason =
        "Could not rebuild runtime settings after user interaction.";
      await this.terminateTask(task, "failed", task.terminationReason, {});
      return;
    }

    sendStatus(task.workspaceId, AgentStatus.ACTING, "Resuming...");
    sendTaskProgress(task);
    this.runTask(task, resumeInput).catch(async (error) => {
      if (this.tasksByWorkspace.get(task.workspaceId) !== task ||
          task.status === "stopping" || task.status === "stopped") return;
      logger.error("orchestrator", "Resumed interaction task failed", {
        workspaceId: task.workspaceId,
        taskId: task.id,
        error,
      });
      await this.terminateTask(
        task,
        "failed",
        "Task failed after resuming from user interaction",
        { agentStatus: AgentStatus.ERROR,
          detail: "Task failed after resuming from user interaction" },
      );
    });
  }

  private armPendingInteractionTimeout(task: OrchestratorTask): void {
    this.clearPendingInteractionTimer(task.workspaceId);
    const interaction = task.pendingInteraction;
    if (!interaction || isPendingInteractionResolved(interaction)) return;

    const remainingMs = getPendingInteractionRemainingMs(interaction);
    if (remainingMs <= 0) {
      void this.handlePendingInteractionTimeout(task.workspaceId);
      return;
    }

    const timer = setTimeout(() => {
      void this.handlePendingInteractionTimeout(task.workspaceId);
    }, remainingMs);
    this.pendingInteractionTimers.set(task.workspaceId, timer);
  }

  private async handlePendingInteractionTimeout(
    workspaceId: string,
  ): Promise<void> {
    const task = this.tasksByWorkspace.get(workspaceId);
    const interaction = task?.pendingInteraction;
    if (!task || !interaction || isPendingInteractionResolved(interaction)) {
      return;
    }

    if (interaction.kind === "clarification") {
      recordOutstandingQuestion(task, interaction.question);
    }

    const resolvedInteraction: PendingUserInteraction =
      interaction.kind === "approval"
        ? { ...interaction, approved: false }
        : { ...interaction, answer: "No response from user." };

    if (!this.acceptPendingInteraction(task, interaction, resolvedInteraction)) return;
    logger.warn("orchestrator", "Pending interaction timed out", {
      workspaceId,
      taskId: task.id,
      nodeId: resolvedInteraction.nodeId,
      kind: resolvedInteraction.kind,
    });
    this.emitTraceEvent(
      task,
      "pending_interaction_timed_out",
      {
        taskId: task.id,
        nodeId: resolvedInteraction.nodeId,
        kind: resolvedInteraction.kind,
        interactionId:
          resolvedInteraction.kind === "approval"
            ? resolvedInteraction.approvalId
            : resolvedInteraction.clarificationId,
      },
      "system",
    );
  }

  private isCurrentInteraction(
    task: OrchestratorTask,
    interaction: PendingUserInteraction,
  ): boolean {
    return this.tasksByWorkspace.get(task.workspaceId) === task &&
      task.status === "running" &&
      task.pendingInteraction === interaction;
  }

  private acceptPendingInteraction(
    task: OrchestratorTask,
    expected: PendingUserInteraction,
    resolved: PendingUserInteraction,
  ): boolean {
    if (!this.isCurrentInteraction(task, expected) ||
        isPendingInteractionResolved(expected)) return false;
    task.pendingInteraction = resolved;
    this.clearPendingInteractionTimer(task.workspaceId);
    clearOutstandingQuestions(task);
    if (resolved.nodeId) {
      const targetNode = task.nodes.find(
        (node) => node.id === resolved.nodeId,
      );
      if (targetNode?.status === "running") {
        targetNode.status = "pending";
      }
    }
    task.currentIndex = currentIndex(task.nodes);
    void this.persistTaskCheckpoint(task)
      .then(() => this.resumeTaskAfterInteraction(task, resolved))
      .catch((error) => logger.error("orchestrator", "Interaction resume failed", {
        workspaceId: task.workspaceId, taskId: task.id, error,
      }));
    return true;
  }

  private async activateRecoveredTask(
    task: OrchestratorTask,
    resumeInput: OrchestratorStartInput,
    resumeTabId: number,
    source: "checkpoint" | "backend",
    options?: { loadTurnCheckpoints?: boolean },
  ): Promise<void> {
    const loadTurnCheckpoints = options?.loadTurnCheckpoints ?? false;
    const turnCheckpointsByNodeId = new Map<string, TurnCheckpoint>();
    if (loadTurnCheckpoints) {
      for (const node of task.nodes) {
        if (node.status === "running") {
          try {
            const cpKey = turnCheckpointKey(task.workspaceId, node.id);
            const stored = await chromePersistencePort.local.get(cpKey);
            const turnCp = sanitizeTurnCheckpoint(stored[cpKey]);
            if (turnCp) {
              turnCheckpointsByNodeId.set(node.id, turnCp);
              logger.info("orchestrator", "Loaded turn checkpoint for node", {
                nodeId: node.id,
                turn: turnCp.turnCount,
                ledgerEntries: turnCp.stepMutationLedger?.length ?? 0,
              });
            }
          } catch {
            // Best-effort; backend restores start without loop-local history
          }
        }
      }
    }

    (task as any)._turnCheckpoints = turnCheckpointsByNodeId;

    const hasPendingInteraction = Boolean(task.pendingInteraction);
    const pendingInteractionResolved = isPendingInteractionResolved(
      task.pendingInteraction,
    );

    if (!hasPendingInteraction || pendingInteractionResolved) {
      task.nodes = task.nodes.map((node) =>
        node.status === "running" ? { ...node, status: "pending" } : node,
      );
    }
    if (!task.runId) {
      task.runId = crypto.randomUUID();
    }
    ensureTaskTabCoordination(task, {
      primaryTabId: resumeTabId,
      primaryTabUrl: task.rootTabUrl ?? null,
    });
    try {
      const reboundTab = await chrome.tabs.get(resumeTabId);
      claimTaskTab(task, {
        tabId: resumeTabId,
        role: "primary",
        createdByTask: false,
        url: reboundTab.url ?? null,
      });
    } catch {
      claimTaskTab(task, {
        tabId: resumeTabId,
        role: "primary",
        createdByTask: false,
        url: task.rootTabUrl ?? null,
      });
    }
    task.status = "running";
    task.currentIndex = currentIndex(task.nodes);
    this.recentCompletionTracker.clear(task.workspaceId);
    this.tasksByWorkspace.set(task.workspaceId, task);
    this.initializeWorkspaceRuntime(task.workspaceId, task.maxWorkers, task);
    await this.persistTaskCheckpoint(task);
    await this.trace.emitManifest({
      ...buildTaskManifest(task, resumeInput),
      source:
        source === "backend"
          ? "background.orchestrator.backend-recovery"
          : "background.orchestrator.recovery",
    });
    this.emitTabCoordinationState(task, "rebound", {
      resumeSource: "local",
      reboundTabId: resumeTabId,
      reason: "Recovered onto a live workspace tab.",
    });
    this.emitTraceEvent(
      task,
      "task_resume_source_selected",
      {
        taskId: task.id,
        workspaceId: task.workspaceId,
        resumeTabId,
        source,
      },
      "system",
    );
    if (source === "checkpoint") {
      this.emitTraceEvent(
        task,
        "task_resumed_from_checkpoint",
        {
          taskId: task.id,
          workspaceId: task.workspaceId,
          resumeTabId,
        },
        "system",
      );
    } else {
      this.emitTraceEvent(
        task,
        "task_resume_backend_accepted",
        {
          taskId: task.id,
          workspaceId: task.workspaceId,
          resumeTabId,
        },
        "system",
      );
    }

    const completedSubtasks = task.nodes.filter(
      (n) => n.status === "completed",
    ).length;
    const pendingSubtasks = task.nodes.filter(
      (n) => n.status === "pending",
    ).length;
    sendMessage({
      type: "TASK_RECOVERY",
      workspaceId: task.workspaceId,
      payload: {
        taskId: task.id,
        totalSubtasks: task.nodes.length,
        completedSubtasks,
        pendingSubtasks,
      },
    });
    sendStatus(
      task.workspaceId,
      hasPendingInteraction && !pendingInteractionResolved
        ? AgentStatus.PAUSED
        : AgentStatus.ACTING,
      hasPendingInteraction && !pendingInteractionResolved
        ? "Recovered task, awaiting user input..."
        : "Recovered task, resuming...",
    );
    sendTaskProgress(task);

    if (hasPendingInteraction && !pendingInteractionResolved) {
      const interaction = task.pendingInteraction!;
      this.emitTraceEvent(
        task,
        source === "backend"
          ? "pending_interaction_restored_from_backend"
          : "pending_interaction_restored",
        {
          taskId: task.id,
          nodeId: interaction.nodeId,
          kind: interaction.kind,
          remainingMs: getPendingInteractionRemainingMs(interaction),
          interactionId:
            interaction.kind === "approval"
              ? interaction.approvalId
              : interaction.clarificationId,
        },
        "system",
      );
      this.emitPendingInteraction(task);
      this.armPendingInteractionTimeout(task);
      return;
    }

    if (pendingInteractionResolved && task.pendingInteraction)
      return this.resumeTaskAfterInteraction(task, task.pendingInteraction);

    this.runTask(task, resumeInput).catch(async (error) => {
      if (this.tasksByWorkspace.get(task.workspaceId) !== task) return;
      logger.error("orchestrator", "Recovered task failed", {
        workspaceId: task.workspaceId,
        taskId: task.id,
        error,
      });
      await this.terminateTask(task, "failed", "Recovered task failed", {
        agentStatus: AgentStatus.ERROR, detail: "Recovered task failed",
      });
    });
  }

  public async restoreFromCheckpoints(): Promise<void> {
    const checkpoints = await orchestratorCheckpointStore.loadAndPrune();
    const entries = Object.values(checkpoints);

    if (entries.length > 0) {
      logger.info("orchestrator", "Found orchestrator checkpoints", {
        count: entries.length,
      });
    }

    for (const cp of entries) {
      const task = cp.task;
      if (
        task.status === "completed" ||
        task.status === "failed" ||
        task.status === "stopping" ||
        task.status === "stopped"
      ) {
        await this.clearTaskCheckpoint(task);
        continue;
      }
      this.pendingFeedback.restore(task.workspaceId, cp.pendingFeedback);

      const resumeSelection = await this.resolveResumeTabId(
        task,
        task.rootTabId,
      );
      if (resumeSelection.status !== "safe") {
        logger.warn(
          "orchestrator",
          "Cannot resume checkpoint, rebinding unsafe",
          {
            workspaceId: task.workspaceId,
            taskId: task.id,
            reason: resumeSelection.reason,
          },
        );
        this.emitTraceEvent(
          task,
          "task_resume_rebinding_rejected",
          {
            taskId: task.id,
            workspaceId: task.workspaceId,
            reason: resumeSelection.reason,
          },
          "system",
        );
        await this.clearTaskCheckpoint(task);
        continue;
      }
      const resumeTabId = resumeSelection.tabId;

      const resumeInput = await buildResumeInput(task, resumeTabId);
      if (!resumeInput) {
        await this.clearTaskCheckpoint(task);
        continue;
      }

      await this.activateRecoveredTask(
        task,
        resumeInput,
        resumeTabId,
        "checkpoint",
        { loadTurnCheckpoints: true },
      );
    }
  }

  public async seedE2EPendingInteraction(input: {
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
  }): Promise<{
    taskId: string;
    workspaceId: string;
    interactionId: string;
  }> {
    const existing = this.tasksByWorkspace.get(input.workspaceId);
    if (existing) {
      await this.stopTask(input.workspaceId);
    }
    this.recentCompletionTracker.clear(input.workspaceId);

    const now = Date.now();
    const taskId = crypto.randomUUID();
    const nodeId = `e2e-pending-interaction-${taskId.slice(0, 8)}`;
    const pendingInteraction: PendingUserInteraction =
      input.interaction.kind === "approval"
        ? {
            kind: "approval",
            nodeId,
            requestedAt: now,
            approvalId: crypto.randomUUID(),
            toolName: input.interaction.toolName,
            args: input.interaction.args ?? {},
            context: input.interaction.context,
            timeoutMs: E2E_PENDING_INTERACTION_TIMEOUT_MS,
          }
        : {
            kind: "clarification",
            nodeId,
            requestedAt: now,
            clarificationId: crypto.randomUUID(),
            question: input.interaction.question,
            suggestions: input.interaction.suggestions,
            timeoutMs: E2E_PENDING_INTERACTION_TIMEOUT_MS,
          };

    const task: OrchestratorTask = {
      runId: crypto.randomUUID(),
      id: taskId,
      workspaceId: input.workspaceId,
      rootTabId: input.tabId,
      rootTabUrl: null,
      query: `${E2E_SYNTHETIC_QUERY_PREFIX}${pendingInteraction.kind}`,
      status: "running",
      createdAt: now,
      startedAt: now,
      nodes: [
        {
          id: nodeId,
          role: "executor",
          description:
            pendingInteraction.kind === "approval"
              ? `Await user approval for ${pendingInteraction.toolName}`
              : "Await user clarification",
          successCriteria:
            pendingInteraction.kind === "approval"
              ? "Approval response is captured and resumable after recovery."
              : "Clarification response is captured and resumable after recovery.",
          allowedTools:
            pendingInteraction.kind === "approval"
              ? [pendingInteraction.toolName]
              : [ToolName.DONE],
          dependencies: [],
          assumptions: [],
          handoffArtifacts: [],
          reflexionLog: [],
          handoffDepth: 0,
          status: "running",
          retries: 0,
        },
      ],
      plannerReflexionLog: [],
      maxWorkers: 1,
      maxReplans: 0,
      replansUsed: 0,
      horizonExpansions: 0,
      currentIndex: 0,
      sessionMetrics: emptySessionMetrics(),
      budget: {
        maxSessionTimeMs: DEFAULT_MAX_SESSION_TIME_MS,
        maxTotalTokens: clampInteger(DEFAULT_MAX_TOTAL_TOKENS, 1),
        maxTotalCostUsd: DEFAULT_MAX_TOTAL_COST_USD,
      },
      tabCoordination: createTaskTabCoordination(input.tabId),
      pendingInteraction,
    };

    this.tasksByWorkspace.set(input.workspaceId, task);
    this.initializeWorkspaceRuntime(input.workspaceId, task.maxWorkers);
    await this.persistTaskCheckpoint(task);
    sendStatus(input.workspaceId, AgentStatus.PAUSED, "Awaiting user input...");
    sendTaskProgress(task);
    this.emitPendingInteraction(task);
    this.armPendingInteractionTimeout(task);

    return {
      taskId,
      workspaceId: input.workspaceId,
      interactionId:
        pendingInteraction.kind === "approval"
          ? pendingInteraction.approvalId
          : pendingInteraction.clarificationId,
    };
  }

  hasActiveTasks(): boolean {
    return this.tasksByWorkspace.size > 0;
  }

  hasActiveTask(workspaceId: string | null | undefined): boolean {
    if (!workspaceId) return false;
    return this.tasksByWorkspace.has(workspaceId);
  }

  /**
   * Re-broadcast the current state for a workspace so the side panel can
   * recover transient UI state after a workspace switch.
   */
  async resyncWorkspaceState(workspaceId: string): Promise<void> {
    const task = this.tasksByWorkspace.get(workspaceId);

    if (!task) {
      // Check for a recent completion that the panel may have missed
      const cached = this.recentCompletionTracker.getCachedFresh(workspaceId);
      if (cached) {
        sendMessage({
          type: "TASK_COMPLETION",
          workspaceId,
          payload: cached.payload,
        });
      }
      sendStatus(workspaceId, AgentStatus.IDLE, "No active task");
      return;
    }

    if (task.status === "running" || task.status === "planning") {
      const awaitingInput = task.pendingInteraction &&
        !isPendingInteractionResolved(task.pendingInteraction);
      // Task is in-flight — re-send current status + progress
      sendStatus(
        workspaceId,
        task.status === "planning"
          ? AgentStatus.THINKING
          : awaitingInput
            ? AgentStatus.PAUSED
            : AgentStatus.ACTING,
        task.status === "planning"
          ? "Planning…"
          : awaitingInput
            ? "Awaiting user input…"
            : "Working…",
      );
      sendTaskProgress(task);
      if (task.sessionMetrics) {
        sendMessage({
          type: "SESSION_METRICS",
          workspaceId,
          payload: { ...task.sessionMetrics },
        });
      }
      if (awaitingInput) {
        this.emitPendingInteraction(task);
        this.armPendingInteractionTimeout(task);
      }
    } else {
      const cached = this.recentCompletionTracker.getCachedFresh(workspaceId);
      if (cached?.payload.taskId === task.id) {
        sendMessage({ type: "TASK_COMPLETION", workspaceId,
          payload: cached.payload });
        sendMessage({ type: "SESSION_METRICS", workspaceId,
          payload: { ...task.sessionMetrics } });
        sendStatus(workspaceId, AgentStatus.IDLE, "Task finished");
      } else {
        sendStatus(workspaceId, AgentStatus.ACTING, "Finishing task...");
      }
    }
  }

  private applyPreflightBudget(task: OrchestratorTask): void {
    const estimator = this.getBudgetEstimator(task.workspaceId);
    const capacity = estimator.estimateCapacity(task.budget);
    const estimate = estimator.getEstimate();
    const originalPending = task.nodes.filter(
      (node) => node.status === "pending",
    );
    if (originalPending.length <= capacity.maxNodesOverall) return;

    const selectedIds = new Set<string>();
    const deferred: TaskNode[] = [];
    for (const node of originalPending) {
      const depsSatisfied = node.dependencies.every((dep) =>
        selectedIds.has(dep),
      );
      if (selectedIds.size < capacity.maxNodesOverall && depsSatisfied) {
        selectedIds.add(node.id);
        continue;
      }
      deferred.push(node);
    }

    if (deferred.length === 0) return;
    const reason =
      `Planner preflight estimated ${deferred.length} node(s) may exceed the current budget envelope: ` +
      `capacity=${capacity.maxNodesOverall}, budget(tokens/time/cost)=` +
      `${capacity.maxNodesByTokens}/${capacity.maxNodesByTime}/${capacity.maxNodesByCost}, ` +
      `estimate(tokens/time/cost-per-node)=` +
      `${estimate.tokensPerNode.toFixed(0)}/${estimate.timeMsPerNode.toFixed(0)}/${estimate.costUsdPerNode.toFixed(4)} ` +
      `(samples=${estimate.samples}).`;

    logger.warn(
      "orchestrator",
      "Planner preflight estimated plan exceeds budget envelope",
      {
        taskId: task.id,
        originalNodeCount: originalPending.length,
        keptNodeCount: selectedIds.size,
        atRiskNodeCount: deferred.length,
        capacity,
        estimate,
        atRiskNodeIds: deferred.map((n) => n.id),
      },
    );

    sendMessage({
      type: "AGENT_STEP",
      workspaceId: task.workspaceId,
      payload: {
        step: {
          id: crypto.randomUUID(),
          type: "warning",
          label: "Planner preflight budget gate",
          detail: reason,
          status: "done",
          timestamp: Date.now(),
        },
        update: false,
      },
    });
  }

  async startTask(input: OrchestratorStartInput): Promise<void> {
    const existing = this.tasksByWorkspace.get(input.workspaceId);
    if (existing) {
      await this.stopTask(input.workspaceId);
    }

    const personalContextBrief = buildPersonalProfilePlannerContext(
      input.query,
      await loadPersonalizationState().catch(() => EMPTY_PERSONALIZATION_STATE),
    );
    const recentCompletionContext = this.recentCompletionTracker.getContext(
      input.workspaceId,
    );
    const { task, plannerQuery, laneTopology } = buildNewTask(
      input,
      personalContextBrief,
      recentCompletionContext,
    );
    this.fleetTelemetryByTaskId.set(
      task.id,
      createTaskFleetTelemetryState(input.settings),
    );
    try {
      const rootTab = await chrome.tabs.get(input.tabId);
      task.rootTabUrl = rootTab.url ?? null;
      ensureTaskTabCoordination(task, {
        primaryTabId: input.tabId,
        primaryTabUrl: rootTab.url ?? null,
      });
    } catch {
      task.rootTabUrl = null;
    }
    this.recentCompletionTracker.clear(input.workspaceId);
    this.tasksByWorkspace.set(input.workspaceId, task);
    this.initializeWorkspaceRuntime(input.workspaceId, task.maxWorkers, task);
    await this.persistTaskCheckpoint(task);
    await this.trace.emitManifest(buildTaskManifest(task, input));
    this.emitTraceEvent(
      task,
      "task_started",
      {
        query: input.query,
        tabId: input.tabId,
        maxWorkers: task.maxWorkers,
        laneTopologyMode: laneTopology.mode,
      },
      "system",
    );
    this.emitTabCoordinationState(task, "initialized");

    sendStatus(input.workspaceId, AgentStatus.THINKING, "Planning task...");
    updateTabGroupAppearance(input.workspaceId, {
      title: input.query,
      status: AgentStatus.THINKING,
    });

    const tracePlan = (plannedTask: OrchestratorTask, data: Record<string, unknown>) =>
      this.emitTraceEvent(plannedTask, "plan_decomposed", data, "planner");
    let nodes: TaskNode[] = [];
    const usePlannerDecomposition =
      shouldUsePlannerDecomposition(laneTopology) &&
      !qualifiesForDirectSingleNode(input.query); // LP-17 P6 short-circuit
    if (!usePlannerDecomposition) {
      const tab = await chrome.tabs.get(input.tabId).catch(() => null);
      nodes = recordDirectInitialPlan({
        task,
        startInput: input,
        tab,
        laneTopology,
        trace: tracePlan,
      });
    }

    // ─── Plan decomposition ───
    if (usePlannerDecomposition) {
      try {
        const plannerContract = buildRoleExecutionContract(
          "planner",
          input.settings,
        );
        logger.debug("policy", "Role execution contract resolved", {
          role: plannerContract.role,
          modelTier: plannerContract.modelTier,
          allowedToolCount: plannerContract.allowedTools.length,
        });
        const modelOverrides = {
          executorModel: input.settings.executorModel,
          plannerModel: input.settings.plannerModel,
          judgeModel: input.settings.judgeModel,
          ...providerRoutingOptions(input.settings),
          writerModel: input.settings.writerModel,
          useNitro: input.settings.useNitro,
          providerMode: input.settings.providerMode,
          provider: input.settings.provider,
          openaiApiKey: input.settings.openaiApiKey,
          groqApiKey: input.settings.groqApiKey,
          temperature: input.settings.temperature,
          perceptionMode: input.settings.perceptionMode,
          fireworksApiKey: input.settings.fireworksApiKey,
          deepseekApiKey: input.settings.deepseekApiKey,
          kimiApiKey: input.settings.kimiApiKey,
          xiaomiApiKey: input.settings.xiaomiApiKey,
          cerebrasApiKey: input.settings.cerebrasApiKey,
        };
        const planner = this.deps.createPlanner(
          input.openRouterApiKey,
          modelOverrides,
        );
        const skillCatalogOptions = {
          enabledSkillPackIds: task.enabledSkillPackIds,
        };
        this.attachPlannerUsageTrace(planner, task, () => "plan_decomposition");
        const tab = await chrome.tabs.get(input.tabId);
        const buildResult = await this.runInLane(task, "planner", async () =>
          planner.buildNodes(
            plannerQuery,
            tab.title || "Untitled",
            tab.url || "",
            skillCatalogOptions,
            undefined,
            { displayQuery: input.query },
          ),
        );
        nodes = recordStructuredInitialPlan({
          task,
          startInput: input,
          laneTopology,
          buildResult,
          trace: tracePlan,
        });
      } catch (error: any) {
        logger.warn(
          "orchestrator",
          "Planner failed, using synthesized fallback graph",
          {
            error: error?.message,
          },
        );
        // Thread the current page context and enabled packs so the fallback
        // selects the same skills buildNodes would and its
        // collapse pass merges synthesized fill/submit form plans. Without this
        // the fallback strands create-record forms on the "do not submit yet"
        // fill node.
        const fallbackTab = await chrome.tabs
          .get(input.tabId)
          .catch(() => null);
        nodes = recordFallbackInitialPlan({
          task,
          startInput: input,
          tab: fallbackTab,
          laneTopology,
          error,
          trace: tracePlan,
        });
      }
    }

    if (task.status === "stopped") return;

    nodes = enforceToolProfile(nodes, input.executionToolProfile);
    task.nodes = nodes;
    if (
      isLargeExhaustiveReviewGraph(nodes) &&
      task.budget.maxTotalTokens < EXHAUSTIVE_REVIEW_MAX_TOTAL_TOKENS
    ) {
      const previousMaxTotalTokens = task.budget.maxTotalTokens;
      task.budget.maxTotalTokens = EXHAUSTIVE_REVIEW_MAX_TOTAL_TOKENS;
      logger.info("orchestrator", "Expanded exhaustive review token budget", {
        taskId: task.id,
        nodeCount: nodes.length,
        previousMaxTotalTokens,
        maxTotalTokens: task.budget.maxTotalTokens,
      });
      this.emitTraceEvent(
        task,
        "budget_limit_adjusted",
        {
          taskId: task.id,
          reason: "large_exhaustive_review_graph",
          nodeCount: nodes.length,
          previousMaxTotalTokens,
          maxTotalTokens: task.budget.maxTotalTokens,
        },
        "system",
      );
    }

    // --- Plan Confirmation Gate ---
    // For multi-node plans, pause and ask the user to confirm before execution
    if (
      nodes.length >= 2 &&
      input.settings.requirePlanConfirmation !== false &&
      (task.status as string) !== "stopped"
    ) {
      const confirmation = await requestPlanConfirmation(
        this.planConfirmationHost,
        task,
        nodes.map((n) => ({
          description: n.description,
          successCriteria: n.successCriteria,
        })),
        input.query,
        task.planClassification?.difficulty,
      );

      if ((task.status as string) === "stopped") return; // Stopped while waiting

      if (confirmation.decision === "cancel") {
        await this.terminateTask(
          task,
          "stopped",
          "Cancelled by user during plan confirmation",
          {
            agentStatus: AgentStatus.IDLE,
            detail: "Plan cancelled",
            resetTabGroup: true,
            afterEmission: () => this.emitTraceEvent(task,
              "plan_confirmation_cancelled", { taskId: task.id }, "system"),
          },
        );
        return;
      }

      // If user provided feedback, replan with guidance appended
      if (confirmation.feedback?.trim()) {
        const revisedQuery = `${input.query}\n\nUser guidance: ${confirmation.feedback.trim()}`;
        try {
          const tab = await chrome.tabs.get(input.tabId);
          const replanPlanner = this.deps.createPlanner(
            input.openRouterApiKey,
            {
              executorModel: input.settings.executorModel,
              plannerModel: input.settings.plannerModel,
              judgeModel: input.settings.judgeModel,
              ...providerRoutingOptions(input.settings),
              useNitro: input.settings.useNitro,
              providerMode: input.settings.providerMode,
              provider: input.settings.provider,
              openaiApiKey: input.settings.openaiApiKey,
              groqApiKey: input.settings.groqApiKey,
              temperature: input.settings.temperature,
              fireworksApiKey: input.settings.fireworksApiKey,
              deepseekApiKey: input.settings.deepseekApiKey,
              kimiApiKey: input.settings.kimiApiKey,
              xiaomiApiKey: input.settings.xiaomiApiKey,
              cerebrasApiKey: input.settings.cerebrasApiKey,
            },
          );
          this.attachPlannerUsageTrace(
            replanPlanner,
            task,
            () => "plan_feedback_replan",
          );
          const replanResult = await replanPlanner.buildNodes(
            revisedQuery,
            tab.title || "Untitled",
            tab.url || "",
            { enabledSkillPackIds: task.enabledSkillPackIds },
            undefined,
            { displayQuery: revisedQuery },
          );
          if (replanResult.nodes.length > 0) {
            nodes = enforceToolProfile(replanResult.nodes, input.executionToolProfile);
            task.nodes = nodes;
            task.replansUsed += 1;
            sendTaskProgress(task);
            updateTabGroupAppearance(input.workspaceId, {
              title: nodes[0].description,
            });
          }
        } catch (err) {
          logger.warn("orchestrator", "Replan after feedback failed", {
            error: err,
          });
          // Proceed with original plan
        }
      }
    }

    if ((task.status as string) === "stopped") return;

    this.applyPreflightBudget(task);
    task.status = "running";
    task.startedAt = Date.now();
    await this.persistTaskCheckpoint(task);

    sendTaskProgress(task);
    sendStatus(input.workspaceId, AgentStatus.ACTING, "Executing subtasks...");

    try {
      await this.runTask(task, input);
    } catch (error) {
      // Catch unexpected exceptions (LaneIsolationError, etc.) so the side
      // panel stream is always finalized and the task is cleaned up.
      logger.error("orchestrator", "runTask threw unexpected error", {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.terminateTask(
        task,
        "failed",
        `Task failed: ${error instanceof Error ? error.message : "unexpected error"}`,
        { agentStatus: AgentStatus.ERROR, detail: "Task failed",
          resetTabGroup: true },
      );
    }
  }

  private async runTask(
    task: OrchestratorTask,
    input: OrchestratorStartInput,
  ): Promise<void> {
    let handedOffInteraction = false;
    const budgetEstimator = this.getBudgetEstimator(task.workspaceId);
    const running = new Set<Promise<void>>();
    const budgetWarningsEmitted = new Set<string>();
    const queuedWorkerTraceNodeIds = new Set<string>();
    const blockedResourceTraceKeys = new Set<string>();
    let nextWorkerIndex = 0;
    const verifierContract = buildRoleExecutionContract(
      "verifier",
      input.settings,
    );
    logger.debug("policy", "Role execution contract resolved", {
      role: verifierContract.role,
      modelTier: verifierContract.modelTier,
      allowedToolCount: verifierContract.allowedTools.length,
    });
    const loopModelOverrides = {
      executorModel: input.settings.executorModel,
      plannerModel: input.settings.plannerModel,
      judgeModel: input.settings.judgeModel,
      ...providerRoutingOptions(input.settings),
      writerModel: input.settings.writerModel,
      useNitro: input.settings.useNitro,
      providerMode: input.settings.providerMode,
      provider: input.settings.provider,
      openaiApiKey: input.settings.openaiApiKey,
      groqApiKey: input.settings.groqApiKey,
      temperature: input.settings.temperature,
      fireworksApiKey: input.settings.fireworksApiKey,
      deepseekApiKey: input.settings.deepseekApiKey,
      kimiApiKey: input.settings.kimiApiKey,
      xiaomiApiKey: input.settings.xiaomiApiKey,
      cerebrasApiKey: input.settings.cerebrasApiKey,
    };
    const verifier = this.deps.createVerifier(
      input.openRouterApiKey,
      loopModelOverrides,
    );
    const replanner = this.deps.createPlanner(
      input.openRouterApiKey,
      loopModelOverrides,
    );
    let plannerUsagePhase = "planner_replan";
    this.attachPlannerUsageTrace(replanner, task, () => plannerUsagePhase);
    const nodeTabMap = new Map<string, number>();
    let initialTabUrl = "about:blank";
    try {
      initialTabUrl = (await chrome.tabs.get(input.tabId)).url || "about:blank";
    } catch {
      // If the tab disappears between restore/start and execution, worker tabs still boot safely.
    }

    const resolveRunnableTabId = (
      preferredTabId: number | null | undefined,
    ): Promise<number | null> => recoverRunnableTabId({
      task,
      preferredTabId,
      fallbackTabId: input.tabId,
      initialTabUrl,
      canNavigate: () => input.settings.allowNavigation !== false,
      resolveResumeTabId: (preferred) => this.resolveResumeTabId(task, preferred),
      createWorkerTab: (url) => this.createWorkerTab(task, url),
      emitRebound: (details) => this.emitTabCoordinationState(
        task,
        "rebound",
        details,
      ),
    });

    const getBudgetExhaustionReason = (): string | null =>
      assessBudgetExhaustion(task);

    let budgetTerminated = false;
    const applyBudgetTermination = (reason: string): void => {
      budgetTerminated = true;
      terminateForBudget(task, reason);
    };

    const launchWorker = async (node: TaskNode): Promise<void> => {
      if (task.status !== "running") return;
      const workerIndex = nextWorkerIndex++;
      let staleSignalCount = 0;
      const nodeStartMs = Date.now();

      await startWorkerNode({
        task,
        node,
        emitTrace: (type, data) =>
          this.emitTraceEvent(task, type, data, "executor"),
        sendProgress: () => sendTaskProgress(task),
        persistTaskCheckpoint: () => this.persistTaskCheckpoint(task),
      });

      const workerId = crypto.randomUUID();
      const tabId = await assignWorkerTab({
        task,
        node,
        nodeTabMap,
        fallbackTabId: input.tabId,
        initialTabUrl,
        allowNavigation: input.settings.allowNavigation !== false,
        resolveRunnableTabId,
        createWorkerTab: (url) => this.createWorkerTab(task, url),
        getTab: (assignedTabId) => chrome.tabs.get(assignedTabId),
        emitNodeBound: (details) =>
          this.emitTabCoordinationState(task, "node_bound", details),
      });
      this.emitTraceEvent(
        task,
        "worker_started",
        {
          taskId: task.id,
          nodeId: node.id,
          workerId,
          workerIndex,
          assignedResources: node.parallelContract?.resourceHints ?? [],
          parallelism: node.parallelContract?.parallelism ?? "unknown",
          ...buildParallelRunState(task),
        },
        "executor",
      );

      const snapshot = await getOrchestratorSnapshot(
        tabId,
        this.deps.waitForContentScriptReady,
      );
      const {
        validatedTurnCheckpoint,
        driftSignal,
        driftDetected,
        taskStateBrief,
        verifierTaskStateBrief,
        verificationTurnMode,
      } = prepareWorkerContext({
        task,
        node,
        snapshot,
        emitTrace: (type, data) =>
          this.emitTraceEvent(task, type, data, "system"),
      });
      const loop = createWorkerAgentLoop({
        task,
        node,
        startInput: input,
        tabId,
        workerId,
        taskStateBrief,
        verificationTurnMode,
        validatedTurnCheckpoint,
        recordStaleSignal: () => ++staleSignalCount,
        sendStepLabel: (label, status) => {
          chrome.tabs
            .sendMessage(tabId, {
              type: "AGENT_STEP_LABEL",
              requestId: crypto.randomUUID(),
              source: MessageSource.BACKGROUND,
              payload: { label, status },
            })
            .catch(() => {});
        },
        createAgentLoop: (loopInput) => this.deps.createAgentLoop(loopInput),
      });

      registerWorker({
        task,
        node,
        workerId,
        tabId,
        loop,
        getWorkspaceLanePools: () => this.getWorkspaceLanePools(task.workspaceId),
        drainPendingFeedback: () =>
          this.drainPendingFeedbackIntoLoop(
            task.workspaceId,
            loop,
            workerId,
            node.id,
          ),
      });

      try {
        const executorInstruction = await prepareExecutorInstruction({
          task,
          node,
          taskStateBrief,
          driftSignal,
          verificationTurnMode,
          workerIndex,
          nodeTabMap,
          tabId,
          runAdvisory: verifier.advise && snapshot
            ? (instruction) => this.runInLane(task, "verifier", async () =>
                verifier.advise!({
                  executorInstruction: instruction,
                  pageTitle: snapshot.title || "",
                  pageUrl: snapshot.url || "",
                  visibleContent:
                    snapshot.pageContent || snapshot.visibleContent || "",
                }),
              )
            : undefined,
          emitAdvisoryTrace: (data) =>
            this.emitTraceEvent(task, "advisory_issued", data, "verifier"),
        });
        const result = await this.runInLane(
          task,
          "executor",
          async () =>
            loop.start(executorInstruction, tabId, snapshot, {
              clearHistory: true,
            }),
          {
            label: `executor node ${node.id.slice(0, 8)}`,
            nodeId: node.id,
          },
        );
        recordWorkerResultState({
          task,
          node,
          result,
          nodeStartMs,
          budgetEstimator,
          fleetTelemetryByTaskId: this.fleetTelemetryByTaskId,
        });

        if (node.status !== "running") {
          this.emitTraceEvent(
            task,
            "worker_result_ignored",
            {
              taskId: task.id,
              nodeId: node.id,
              workerId,
              currentStatus: node.status,
              executorOutcome: result.outcome,
              reason: "node_already_terminal",
              ...buildParallelRunState(task),
            },
            "system",
          );
          return;
        }
        if ((task.status as string) === "stopping") {
          this.emitTraceEvent(
            task,
            "worker_result_ignored",
            {
              taskId: task.id,
              nodeId: node.id,
              workerId,
              currentStatus: node.status,
              executorOutcome: result.outcome,
              reason: "task_stop_requested",
              ...buildParallelRunState(task),
            },
            "system",
          );
          node.status = "failed";
          node.error = appendRecentSideEffects(
            "Stopped by user",
            result.sideEffectsLog,
          );
          return;
        }
        if (
          result.outcome === "awaiting_approval" ||
          result.outcome === "awaiting_clarification"
        ) {
          const interaction = result.pendingInteraction;
          handedOffInteraction = Boolean(interaction);
          task.pendingInteraction = interaction;
          if (interaction?.kind === "clarification") {
            recordOutstandingQuestion(task, interaction.question);
          }
          this.armPendingInteractionTimeout(task);
          await this.persistTaskCheckpoint(task);
          if (!interaction || !this.isCurrentInteraction(task, interaction) ||
              isPendingInteractionResolved(interaction)) return;
          // Forward the pause over the wire (pi-backend Phase 4). Emitted after
          // pendingInteraction is set + timeout armed, so a bridge caller that
          // answers immediately finds resolvable state. Approval-only for now;
          // the sidepanel ignores TASK_PAUSED (it gets APPROVAL_REQUEST).
          const pausedMessage = buildTaskPausedMessage(task);
          if (pausedMessage) sendMessage(pausedMessage);
          sendStatus(
            task.workspaceId,
            AgentStatus.PAUSED,
            result.outcome === "awaiting_approval"
              ? "Awaiting approval..."
              : "Awaiting clarification...",
          );
          return;
        }
        if (task.pendingInteraction?.nodeId === node.id) {
          task.pendingInteraction = undefined;
          this.clearPendingInteractionTimer(task.workspaceId);
        }
        const { compactResultSummary, executorEvidence } =
          attachExecutorResultEvidence(node, result);
        this.emitTraceEvent(
          task,
          "evidence_attached",
          {
            nodeId: node.id,
            entryCount: executorEvidence.length,
          },
          "executor",
        );
        if (result.outcome === "completed") {
          this.emitCompletionScopeTransition(task, {
            scope: "lane",
            status: "completed",
            nodeId: node.id,
            reason: "executor_loop_completed",
            envelope: result.completionEnvelope,
          });
          {
            const {
              verification,
              verifierHandoffContext,
              currentUrl,
              currentTitle,
            } = await resolveWorkerVerification({
              task,
              node,
              result,
              executorEvidence,
              verifierTaskStateBrief,
              previousTab: snapshot,
              readCurrentTab: () => chrome.tabs.get(tabId),
              verifyNode: (input) =>
                this.runInLane(task, "verifier", () => verifier.verifyNode(input)),
              emitTrace: (type, data) =>
                this.emitTraceEvent(task, type, data, "verifier"),
            });
            const { proceed, confidence: verificationConfidence } =
              recordWorkerVerificationDecision({
                task,
                node,
                workerId,
                result,
                verification,
                verifierHandoffContext,
                emitSystemTrace: (type, data) =>
                  this.emitTraceEvent(task, type, data, "system"),
                emitVerifierTrace: (type, data) =>
                  this.emitTraceEvent(task, type, data, "verifier"),
              });
            if (!proceed) return;

            const escalationOutcome = await resolveVerifierEscalation({
              host: this.escalationInteractionHost,
              task,
              node,
              verification,
              snapshot,
            });
            if (escalationOutcome !== "continue") return;

            await maybeApplyHighRiskJudgeGate({
              task,
              node,
              verifier,
              evidence: executorEvidence,
              summary: result.summary,
              verification,
              emit: (type, data) =>
                this.emitTraceEvent(task, type, data, "verifier"),
            });

            const immediateOutcome = applyImmediateVerifierOutcome({
              task,
              node,
              result,
              verification,
              compactResultSummary,
              currentTitle,
              currentUrl,
              recordExtractedFacts: () =>
                this.maybeRecordExtractedFacts(task, node, compactResultSummary),
              emitCompletionScope: () =>
                this.emitCompletionScopeTransition(task, {
                  scope: "node",
                  status: "completed",
                  nodeId: node.id,
                  reason: verification.reason || "verifier_accept",
                  envelope: result.completionEnvelope,
                }),
            });
            if (immediateOutcome === "retry") {
              const replanned = await maybeReplanVerifierRetry({
                task,
                node,
                result,
                verification,
                driftDetected,
                staleSignalCount,
                expandNode: (reason) =>
                  this.runInLane(task, "planner", () =>
                    replanner.expandNode(
                      node,
                      snapshot?.title || "",
                      snapshot?.url || "",
                      reason,
                      { enabledSkillPackIds: task.enabledSkillPackIds },
                    ),
                  ),
                emitFailureAttribution: (reason, detail) =>
                  this.emitNodeFailureAttribution(task, node, reason, detail),
              });
              if (replanned) {
                // Replacement nodes are now pending and scheduler will pick them up.
              } else {
                applyVerifierRetry({
                  task,
                  node,
                  result,
                  verification,
                  verificationConfidence,
                  driftDetected,
                  staleSignalCount,
                  emitTrace: (type, data) =>
                    this.emitTraceEvent(task, type, data, "verifier"),
                });
              }
            }
          } // end verification pipeline
        } else {
          recordIncompleteWorkerResult({
            task,
            node,
            result,
            emitTrace: (type, data) =>
              this.emitTraceEvent(task, type, data, "executor"),
          });
        }
      } catch (error) {
        recordThrownWorkerFailure({
          task,
          node,
          workerId,
          error,
          completedResult: loop.completedResult,
          emitTrace: (type, data) =>
            this.emitTraceEvent(task, type, data, "system"),
          emitCompletionScope: (data) =>
            this.emitCompletionScopeTransition(task, data),
          emitFailureAttribution: (reason, detail) =>
            this.emitNodeFailureAttribution(task, node, reason, detail),
        });
      } finally {
        await releaseWorker({
          task,
          node,
          workerId,
          nodeStartMs,
          getWorkspaceLanePools: () => this.getWorkspaceLanePools(task.workspaceId),
          emitTrace: (type, data) =>
            this.emitTraceEvent(task, type, data, "executor"),
          sendProgress: () => sendTaskProgress(task),
          persistTaskCheckpoint: () => this.persistTaskCheckpoint(task),
        });
      }
    };

    let rootGoalSatisfied = false;

    while (task.status === "running" || task.status === "stopping") {
      if (task.status === "stopping") {
        if (running.size > 0) {
          await Promise.race(running);
          continue;
        }
        break;
      }
      if (handedOffInteraction) {
        if (task.pendingInteraction && !isPendingInteractionResolved(task.pendingInteraction)) {
          sendStatus(task.workspaceId, AgentStatus.PAUSED, "Awaiting user input...");
        }
        await this.persistTaskCheckpoint(task);
        return;
      }
      if (rootGoalSatisfied) {
        if (running.size > 0) {
          await Promise.race(running);
          continue;
        }
        break;
      }
      const { runnable, schedulerConcurrency } = collectSchedulerCycle({
        task,
        runningCount: running.size,
        blockedResourceTraceKeys,
        getExecutorMaxConcurrent: () =>
          this.getLaneRuntimeState(task.workspaceId, "executor").policy.maxConcurrent,
        emitTrace: (type, data) =>
          this.emitTraceEvent(task, type, data, "system"),
      });

      // The graph makes the root-goal decision; this scheduler alone applies it.
      if (await applyRootGoalShortcut({
        task,
        getSnapshot: () => getOrchestratorSnapshot(
          input.tabId,
          this.deps.waitForContentScriptReady,
        ),
        ignoreSiblings: (params) =>
          this.ignoreSiblingsAfterRootCompletion(task, params),
        emitCompletionScope: (reason, skippedNodeIds) =>
          this.emitCompletionScopeTransition(task, {
            scope: "root", status: "sibling_ignored", reason, skippedNodeIds,
          }),
        emitTrace: (type, data) =>
          this.emitTraceEvent(task, type, data, "system"),
      })) {
        rootGoalSatisfied = true;
        try {
          if (running.size > 0) {
            await Promise.race(running);
            continue;
          }
          break;
        } catch (err) {
          logger.debug("orchestrator", "Root goal policy could not assess snapshot", {
            taskId: task.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      emitBudgetWarnings(task, budgetWarningsEmitted, (data) =>
        this.emitTraceEvent(task, "budget_warning", data, "system"),
      );

      const budgetReason = getBudgetExhaustionReason();
      if (budgetReason) {
        applyBudgetTermination(budgetReason);
        break;
      }

      const executorLaneWait = getExecutorLaneWait({
        runningCount: running.size,
        runnable,
        getLaneState: () => this.getLaneRuntimeState(task.workspaceId, "executor"),
      });
      if (executorLaneWait) {
        await waitForExecutorLane({
          task,
          runnable,
          laneState: executorLaneWait,
          emitTrace: (type, data) =>
            this.emitTraceEvent(task, type, data, "system"),
        });
        continue;
      }

      queueRunnableWorkers({
        task,
        runnable,
        running,
        schedulerConcurrency,
        queuedWorkerTraceNodeIds,
        launchWorker,
        emitTrace: (type, data) =>
          this.emitTraceEvent(task, type, data, "system"),
      });

      if (running.size > 0) {
        await Promise.race(running);
        continue;
      }

      const pendingNodes = task.nodes.filter((n) => n.status === "pending");
      if (pendingNodes.length === 0) {
        plannerUsagePhase = "horizon_expansion";
        const expanded = await tryHorizonExpansion({
          task,
          replanner: replanner as OrchestratorPlanner,
          getBudgetExhaustionReason,
          getRootTab: () => chrome.tabs.get(task.rootTabId),
          runPlanner: (operation) => this.runInLane(task, "planner", operation),
          sendProgress: () => sendTaskProgress(task),
          persistTaskCheckpoint: () => this.persistTaskCheckpoint(task),
          emitHorizonTrace: (data) =>
            this.emitTraceEvent(task, "horizon_expansion", data, "planner"),
        });
        plannerUsagePhase = "planner_replan";
        if (expanded) continue;
        break;
      }

      recordSchedulerStall({
        task,
        pendingNodes,
        emitFailureAttribution: (node, reason, detail) =>
          this.emitNodeFailureAttribution(task, node, reason, detail),
        emitTrace: (type, data) =>
          this.emitTraceEvent(task, type, data, "system"),
      });
      break;
    }

    if (task.status === "stopped" || task.status === "stopping") {
      await this.finalizeStoppedTask(
        task,
        "Stopped by user during execution",
        "execution",
      );
      return;
    }

    await this.finalizeTask(task, buildScheduledTaskFinalization({
      task,
      budgetTerminated,
      emitRootCompleted: () => this.emitCompletionScopeTransition(task, {
        scope: "root", status: "completed",
        reason: "task_completion_payload_completed",
      }),
      emitCompletedTrace: (data) =>
        this.emitTraceEvent(task, "task_completed", data, "system"),
    }));
  }

  /** Get the outcome of the most recently completed task for a workspace. */
  getRecentOutcome(
    workspaceId: string,
  ): "completed" | "failed" | "stopped" | null {
    const task = this.tasksByWorkspace.get(workspaceId);
    if (task?.status === "stopped" || task?.status === "stopping") {
      return "stopped";
    }
    const recent = this.recentCompletionTracker.getCachedFresh(workspaceId);
    if (!recent) return null;
    if (recent.payload.status === "stopped") return "stopped";
    // "partial" maps to "completed" — partial success is still success at the overlay level
    return recent.payload.status === "failed" ? "failed" : "completed";
  }

  waitForTaskCompletion(
    workspaceId: string,
    timeoutMs = 60 * 60 * 1000,
  ): Promise<TaskCompletionMessage["payload"] | null> {
    const task = this.tasksByWorkspace.get(workspaceId);
    const cached = this.recentCompletionTracker.getCachedFresh(workspaceId);
    if (cached && (!task || cached.payload.taskId === task.id)) {
      return Promise.resolve(cached.payload);
    }
    if (!task) return Promise.resolve(null);

    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const handleCompletion = (payload: TaskCompletionMessage["payload"]) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.completionWaiters.remove(workspaceId, handleCompletion);
        resolve(payload);
      };

      this.completionWaiters.add(workspaceId, handleCompletion);
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.completionWaiters.remove(workspaceId, handleCompletion);
        resolve(null);
      }, timeoutMs);
      (timer as unknown as { unref?: () => void }).unref?.();
    });
  }

  async stopTask(workspaceId?: string): Promise<void> {
    if (workspaceId) {
      await this.stopWorkspace(workspaceId);
      return;
    }
    for (const wsId of this.tasksByWorkspace.keys()) {
      await this.stopWorkspace(wsId);
    }
  }

  pauseTask(workspaceId?: string): void {
    if (workspaceId) {
      this.pauseWorkspace(workspaceId);
      return;
    }
    for (const wsId of this.workersByWorkspace.keys()) {
      this.pauseWorkspace(wsId);
    }
  }

  resumeTask(workspaceId?: string): void {
    if (workspaceId) {
      this.resumeWorkspace(workspaceId);
      return;
    }
    for (const wsId of this.workersByWorkspace.keys()) {
      this.resumeWorkspace(wsId);
    }
  }

  injectFeedback(workspaceId: string, text: string): void {
    const workers = this.workersByWorkspace.get(workspaceId)?.executor;
    if (!workers || workers.size === 0) {
      this.queueFeedback(workspaceId, text);
      return;
    }
    for (const worker of workers.values()) {
      worker.loop.injectFeedback(text);
      if (worker.loop.isPaused()) worker.loop.resume();
    }
  }

  async skipSubtask(workspaceId?: string, taskId?: string): Promise<boolean> {
    let task: OrchestratorTask | undefined;
    if (workspaceId) {
      task = this.tasksByWorkspace.get(workspaceId);
    } else if (taskId) {
      for (const candidate of this.tasksByWorkspace.values()) {
        if (candidate.id === taskId) {
          task = candidate;
          break;
        }
      }
    }
    if (!task || task.status !== "running") return false;

    const targetNode =
      task.nodes.find((node) => node.status === "running") ??
      task.nodes.find((node) => node.status === "pending");
    if (!targetNode) return false;

    const workers = this.workersByWorkspace.get(task.workspaceId)?.executor;
    for (const worker of workers?.values() ?? []) {
      if (worker.nodeId !== targetNode.id) continue;
      this.emitTraceEvent(
        task,
        "worker_cancelled",
        {
          taskId: task.id,
          nodeId: worker.nodeId,
          workerId: worker.workerId,
          reason: "user_skipped_node",
          resources: targetNode.parallelContract?.resourceHints ?? [],
          ...buildParallelRunState(task),
        },
        "system",
      );
      worker.loop.stop();
      workers?.delete(worker.workerId);
    }

    targetNode.status = "skipped";
    targetNode.error = "Skipped by user from Plan Board.";
    appendHandoffArtifact(targetNode, {
      role: "planner",
      phase: "planner_replan",
      note: "Skipped by user from Plan Board.",
    });

    task.currentIndex = currentIndex(task.nodes);
    sendTaskProgress(task);
    sendMessage({
      type: "AGENT_STEP",
      workspaceId: task.workspaceId,
      payload: {
        step: {
          id: crypto.randomUUID(),
          type: "info",
          label: `Planner: skipped subtask ${targetNode.id.slice(0, 6)}`,
          detail: targetNode.description,
          status: "done",
          timestamp: Date.now(),
        },
        update: false,
      },
    });
    await this.persistTaskCheckpoint(task);
    return true;
  }

  private async finalizeStoppedTask(
    task: OrchestratorTask,
    detail: string,
    phase: "planning" | "execution" | "system" = "system",
  ): Promise<void> {
    await this.terminateTask(task, "stopped", detail, {
      agentStatus: AgentStatus.IDLE,
      detail: "Stopped",
      closeTabs: true,
      resetTabGroup: true,
      stoppedNotification: detail,
      afterEmission: () => this.emitTraceEvent(task, "task_stopped",
        { taskId: task.id, phase }, "system"),
    });
  }

  private async stopWorkspace(workspaceId: string): Promise<void> {
    const task = this.tasksByWorkspace.get(workspaceId);
    if (!task) return;
    if (task.status === "stopping" || task.status === "stopped" ||
        task.status === "completed" || task.status === "failed") return;
    this.emitTraceEvent(
      task,
      "task_stop_requested",
      {
        taskId: task.id,
        workspaceId,
      },
      "system",
    );
    const workers = this.workersByWorkspace.get(workspaceId)?.executor;
    const activeWorkerCount = workers?.size ?? 0;
    const shouldDrainActiveWorkers =
      task.status === "running" && activeWorkerCount > 0;

    this.clearPendingInteractionTimer(workspaceId);
    task.pendingInteraction = undefined;
    const pendingEscalationId = task.pendingEscalation?.packet.escalationId;
    if (pendingEscalationId) {
      this.pendingEscalationResolvers.delete(pendingEscalationId);
      task.pendingEscalation = undefined;
    }
    // Cancel any pending plan confirmation
    this.pendingPlanConfirmationResolvers.resolveAll({ decision: "cancel" });
    if (shouldDrainActiveWorkers) {
      task.status = "stopping";
      void this.persistTaskCheckpoint(task);
      const pools = this.workersByWorkspace.get(workspaceId);
      for (const worker of workers?.values() || []) {
        const node = task.nodes.find(
          (candidate) => candidate.id === worker.nodeId,
        );
        this.emitTraceEvent(
          task,
          "worker_cancelled",
          {
            taskId: task.id,
            nodeId: worker.nodeId,
            workerId: worker.workerId,
            reason: "task_stop_requested",
            resources: node?.parallelContract?.resourceHints ?? [],
            ...buildParallelRunState(task),
          },
          "system",
        );
        worker.loop.requestStop();
      }
      pools?.planner.clear();
      pools?.verifier.clear();
      sendStatus(
        workspaceId,
        AgentStatus.ACTING,
        "Stopping at next safe point...",
      );
      return;
    }

    const pools = this.workersByWorkspace.get(workspaceId);
    for (const worker of workers?.values() || []) {
      const node = task.nodes.find(
        (candidate) => candidate.id === worker.nodeId,
      );
      this.emitTraceEvent(
        task,
        "worker_cancelled",
        {
          taskId: task.id,
          nodeId: worker.nodeId,
          workerId: worker.workerId,
          reason: "task_stop_forced",
          resources: node?.parallelContract?.resourceHints ?? [],
          ...buildParallelRunState(task),
        },
        "system",
      );
      worker.loop.stop();
    }
    workers?.clear();
    pools?.planner.clear();
    pools?.verifier.clear();
    await this.finalizeStoppedTask(task, "Stopped by user",
      task.status === "planning" ? "planning" : "system");
  }

  private pauseWorkspace(workspaceId: string): void {
    const workers = this.workersByWorkspace.get(workspaceId)?.executor;
    for (const worker of workers?.values() || []) {
      worker.loop.pause();
    }
    sendStatus(workspaceId, AgentStatus.PAUSED, "Paused by user");
  }

  private resumeWorkspace(workspaceId: string): void {
    const workers = this.workersByWorkspace.get(workspaceId)?.executor;
    for (const worker of workers?.values() || []) {
      worker.loop.resume();
    }
    sendStatus(workspaceId, AgentStatus.ACTING, "Resumed");
  }

  private async createWorkerTab(
    task: OrchestratorTask,
    url: string,
  ): Promise<number> {
    const tab = await createWorkspaceTab({
      sourceTabId: task.rootTabId,
      url,
      workspaceId: task.workspaceId,
      manager: this.deps.workspaceManager,
    });
    claimTaskTab(task, {
      tabId: tab.id,
      role: "auxiliary",
      createdByTask: true,
      url: tab.url ?? url,
    });
    this.emitTabCoordinationState(task, "worker_created", {
      tabId: tab.id,
      url: tab.url ?? url,
    });
    return tab.id;
  }

  private async closeWorkerTabs(task: OrchestratorTask): Promise<void> {
    for (const tabId of getOwnedCreatedTabIds(task)) {
      if (tabId === task.rootTabId) continue;
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* tab already closed */
      }
      releaseTaskTab(task, tabId);
      this.emitTabCoordinationState(task, "worker_released", { tabId });
    }
  }

  /**
   * Cache a completion payload for later resync and persist the summary
   * directly to chat storage so it survives side-panel death.
   */
  private cacheAndPersistCompletion(
    workspaceId: string,
    payload: TaskCompletionMessage["payload"],
  ): void {
    // Cache for resync on panel reopen (+ append to the recent-completion history)
    this.recentCompletionTracker.record(workspaceId, payload);
    this.completionWaiters.resolveAll(workspaceId, payload);

    // Persist summary as a chat message directly to storage (bypasses panel)
    if (payload.summary) {
      const storageKey = `chatMessages:${workspaceId}`;
      chrome.storage.local
        .get(storageKey)
        .then((result) => {
          const messages: unknown[] = result[storageKey] ?? [];
          messages.push({
            id: crypto.randomUUID(),
            role: "assistant",
            content: payload.summary,
            timestamp: Date.now(),
            toolCalls: [],
            isStreaming: false,
            completionData: payload,
          });
          const trimmed =
            messages.length > MAX_PERSISTED_MESSAGES
              ? messages.slice(-MAX_PERSISTED_MESSAGES)
              : messages;
          return chromePersistencePort.local.set({ [storageKey]: trimmed });
        })
        .catch((e) => {
          logger.debug(
            "orchestrator",
            "Failed to persist completion to chat storage",
            { error: e },
          );
        });
    }
  }

  /** Queue a terminal summary without awaiting I/O or retaining raw task data. */
  private queueFleetTelemetry(
    task: OrchestratorTask,
    completionStatus: "completed" | "partial" | "failed" | "stopped",
  ): void {
    const state =
      this.fleetTelemetryByTaskId.get(task.id) ??
      createTaskFleetTelemetryState();
    this.fleetTelemetryByTaskId.delete(task.id);
    void collectFleetTelemetryLocally({
      storage: chromePersistencePort.local,
      project: () =>
        projectFleetTelemetryEnvelope(
          buildTaskFleetTelemetryProjectionInput({
            task,
            state,
            runtime: getFleetTelemetryRuntimeContext(),
            completionStatus,
          }),
        ),
    });
  }

  private buildTerminationCompletion(
    task: OrchestratorTask,
    terminationReason: string,
  ): TaskCompletionMessage["payload"] {
    const subtaskResults = buildSubtaskResults(task);
    const completed = subtaskResults.filter(
      (r) => r.status === "completed",
    ).length;
    const stopped = task.status === "stopped" || task.status === "stopping";

    return {
      taskId: task.id,
      status: stopped
        ? "stopped"
        : hasUsefulPartialProgressHandoff(task.partialHandoff) || completed > 0
          ? "partial"
          : "failed",
      totalTurnsUsed: 0,
      totalTimeMs:
        (task.finishedAt || Date.now()) - (task.startedAt || task.createdAt),
      summary: terminationReason,
      subtaskResults,
      urlHistory: [],
      metrics: task.sessionMetrics,
      terminationReason,
      ...(task.partialHandoff ? { partialHandoff: task.partialHandoff } : {}),
    };
  }

  private async finalizeTask(task: OrchestratorTask, options: {
    status: "completed" | "failed" | "stopped";
    buildPayload?: () => TaskCompletionMessage["payload"];
    agentStatus?: AgentStatus;
    detail?: string;
    telemetry?: boolean;
    closeTabs?: boolean;
    resetTabGroup?: boolean;
    stoppedNotification?: string;
    afterEmission?: () => void;
  }): Promise<boolean> {
    const discardStale = async (): Promise<boolean> => {
      if (options.closeTabs) await this.closeWorkerTabs(task);
      this.fleetTelemetryByTaskId.delete(task.id);
      await this.clearTaskCheckpoint(task);
      return false;
    };
    if (this.tasksByWorkspace.get(task.workspaceId) !== task) {
      return discardStale();
    }
    if (task.status === "completed" || task.status === "failed" ||
        task.status === "stopped") return false;

    task.status = options.status;
    task.finishedAt = Date.now();
    task.sessionMetrics.totalSessionTimeMs =
      task.finishedAt - (task.startedAt || task.createdAt);
    this.clearPendingInteractionTimer(task.workspaceId);
    task.pendingInteraction = undefined;
    const escalationId = task.pendingEscalation?.packet.escalationId;
    if (escalationId) this.pendingEscalationResolvers.delete(escalationId);
    task.pendingEscalation = undefined;
    const payload = options.buildPayload?.();
    if (this.tasksByWorkspace.get(task.workspaceId) !== task) {
      return discardStale();
    }
    if (payload) {
      // End the stream before the completion card, including failure/stop.
      sendMessage({ type: "STREAM_CHUNK", workspaceId: task.workspaceId,
        payload: { delta: "", done: true } });
      this.cacheAndPersistCompletion(task.workspaceId, payload);
      if (options.telemetry) this.queueFleetTelemetry(task, payload.status);
      sendMessage({ type: "TASK_COMPLETION", workspaceId: task.workspaceId,
        payload });
      notifyTaskCompletion(task, payload);
    }
    options.afterEmission?.();
    if (options.agentStatus && options.detail) {
      sendStatus(task.workspaceId, options.agentStatus, options.detail, payload?.status);
    }
    if (options.closeTabs) await this.closeWorkerTabs(task);
    if (this.tasksByWorkspace.get(task.workspaceId) === task) {
      this.tasksByWorkspace.delete(task.workspaceId);
      this.cleanupWorkspaceRuntime(task.workspaceId);
      if (options.resetTabGroup) resetTabGroupAppearance(task.workspaceId);
      if (options.stoppedNotification) {
        void agentNotifications.notifyStopped({ workspaceId: task.workspaceId,
          taskId: task.id, tabId: task.rootTabId,
          detail: options.stoppedNotification });
      }
    }
    await this.clearTaskCheckpoint(task);
    return true;
  }

  private terminateTask(
    task: OrchestratorTask,
    status: "failed" | "stopped",
    reason: string,
    presentation: {
      agentStatus?: AgentStatus;
      detail?: string;
      closeTabs?: boolean;
      resetTabGroup?: boolean;
      stoppedNotification?: string;
      afterEmission?: () => void;
    },
  ): Promise<boolean> {
    return this.finalizeTask(task, {
      status,
      buildPayload: status === "stopped" && task.nodes.length === 0
        ? undefined
        : () => this.buildTerminationCompletion(task, reason),
      telemetry: true,
      ...presentation,
    });
  }

  public resolveEscalationDecision(
    payload: EscalationDecisionPayload,
  ): boolean {
    const optionId = normalizeEscalationOptionId(payload.optionId);
    if (!optionId) return false;
    const resolver = this.pendingEscalationResolvers.get(payload.escalationId);
    if (!resolver) return false;
    resolver({
      escalationId: payload.escalationId,
      optionId,
      rerouteObjective: payload.rerouteObjective,
    });
    return true;
  }

  private findPendingInteractionTask(
    kind: PendingUserInteraction["kind"],
    id: string,
    workspaceId?: string | null,
  ): OrchestratorTask | undefined {
    const matches = (task: OrchestratorTask | undefined): boolean => {
      const interaction = task?.pendingInteraction;
      return interaction?.kind === kind &&
        (interaction.kind === "approval"
          ? interaction.approvalId
          : interaction.clarificationId) === id;
    };
    const preferred = workspaceId ? this.tasksByWorkspace.get(workspaceId) : undefined;
    if (matches(preferred)) return preferred;
    return [...this.tasksByWorkspace.values()].find(matches);
  }

  public resolveApprovalResponse(
    payload: { approvalId: string; approved: boolean },
    workspaceId?: string | null,
  ): boolean {
    const task = this.findPendingInteractionTask("approval", payload.approvalId, workspaceId);
    const interaction = task?.pendingInteraction;
    if (!task || interaction?.kind !== "approval") return false;
    return this.acceptPendingInteraction(task, interaction, {
      ...interaction, approved: payload.approved,
    });
  }

  public resolveClarificationResponse(
    payload: { clarificationId: string; answer: string },
    workspaceId?: string | null,
  ): boolean {
    const task = this.findPendingInteractionTask("clarification", payload.clarificationId, workspaceId);
    const interaction = task?.pendingInteraction;
    if (!task || interaction?.kind !== "clarification") return false;
    return this.acceptPendingInteraction(task, interaction, {
      ...interaction, answer: payload.answer,
    });
  }

  public resolvePlanConfirmation(payload: {
    confirmationId: string;
    decision: "approve" | "cancel";
    feedback?: string;
  }): boolean {
    return resolvePendingPlanConfirmation(this.planConfirmationHost, payload);
  }


}

export const orchestrator = new Orchestrator();
