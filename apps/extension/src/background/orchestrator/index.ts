import { AgentLoop } from "../agent";
import {
  AgentStatus,
  AgentStep,
  EscalationOption,
  EscalationOptionId,
  EscalationPacket,
  EscalationRisk,
  MessageSource,
  SubtaskResult,
  TaskCompletionMessage,
  ToolName,
  UserSettings,
} from "../../types";
import {
  createHttpRunTraceWriter,
  logger,
  RunManifest,
  RunTraceWriter,
} from "../../utils";
import { loadSettings } from "../../utils/settings-storage";
import { listPromptDescriptors } from "../../prompts";
import {
  buildQueryWithTurnMemory,
  buildWorkspaceTurnRecord,
  formatWorkspaceTurnMemoryForPrompt,
  loadWorkspaceTurnMemory,
  saveWorkspaceTurnRecord,
} from "../agent/memory";
import { postMemory, searchMemory, searchMemoryByDomain, formatBackendMemoriesForPrompt } from "../infrastructure/backend-client";
import {
  extractDomain,
  buildExtractionContext,
  extractSiteKnowledge as extractSiteKnowledgeLLM,
  extractSiteKnowledgeFallback,
  deduplicateSiteKnowledge,
  rankSiteKnowledgeForTask,
  formatSiteKnowledgeForPrompt,
  type SiteKnowledgeEntry,
} from "./site-knowledge";
import { LLMClient } from "../llm/client";
import { workspaceManager } from "../workspaces/manager";
import {
  updateTabGroupAppearance,
  resetTabGroupAppearance,
} from "../workspaces/tab-group-appearance";
import { waitForContentScriptReady } from "../tab-ready";
import { buildFallbackNodes, OrchestratorPlanner } from "./planner";
import { selectPrimarySkill } from "./skills";
import { inferToolProfileForStep } from "../agent/planner";
import {
  assessTaskContractCoverage,
  buildTaskContract,
} from "../agent/task-contract";
import {
  NodeHandoffArtifact,
  OrchestratorCheckpoint,
  OrchestratorStartInput,
  OrchestratorTask,
  StructuredEvidence,
  TaskNode,
  WorkerInstance,
} from "./types";
import {
  NodeVerificationResult,
  OrchestratorVerifier,
  programmaticVerify,
} from "./verifier";
import {
  buildAssumptionDriftSignal,
  buildCompletedStepsSummary,
  buildExecutorInstruction,
  createRerouteNode,
  formatPlannerReflexionContext,
  MAX_HANDOFF_DEPTH,
  buildTaskStateBrief,
  buildVerifierContext,
  shouldUseVerificationTurnMode,
} from "./handoff";
import {
  getSnapshotFingerprint,
  matchSuccessCriteria,
} from "../agent/loop-helpers";
import { buildRoleExecutionContract } from "./contracts";
import { getDependencyState, getRunnablePendingNodes } from "./scheduling";
import { decideRetryPolicy } from "./retry-policy";
import { BudgetEstimator } from "./budget-estimator";
import {
  CreateAgentLoopInput,
  DEFAULT_LANE_POLICIES,
  EscalationDecisionPayload,
  LaneBudgetPolicy,
  LaneIsolationError,
  LaneOperationInstance,
  LaneRuntimeState,
  LaneSupervisorState,
  LaneTimeoutError,
  QueuedLaneOperation,
  RuntimeLane,
  WorkspaceLanePools,
} from "./lane-types";
import type { OrchestratorDeps } from "./lane-types";
import {
  CHECKPOINT_VERSION,
  DEFAULT_MAX_REPLANS,
  DEFAULT_MAX_SESSION_TIME_MS,
  DEFAULT_MAX_TOTAL_COST_USD,
  DEFAULT_MAX_TOTAL_TOKENS,
  emptySessionMetrics,
  isRecord,
  mergeSessionMetrics,
  sanitizeCheckpoint,
} from "./sanitizers";
import {
  clampConfidence,
  clampInteger,
  currentIndex,
  deriveSuggestedApproach,
  isLaneIsolationError,
  isUserSkippedNode,
  normalizeEscalationOptionId,
  toSubtasks,
} from "./utils";
import {
  turnCheckpointKey,
  sanitizeTurnCheckpoint,
} from "../agent/checkpoint-types";
import type { SideEffectEntry, TurnCheckpoint } from "../agent/checkpoint-types";
import type { PendingUserInteraction } from "../agent/loop-types";

function isTurnCheckpointCompatible(
  checkpoint: TurnCheckpoint,
  snapshot:
    | {
        url?: string;
        elements?: { length: number };
        visibleContent?: string;
        pageContent?: string;
      }
    | null
    | undefined,
): boolean {
  if (!snapshot) return false;
  if ((snapshot.url ?? null) !== checkpoint.pageUrl) return false;
  return getSnapshotFingerprint(snapshot) === checkpoint.snapshotFingerprint;
}

function summaryOfCompletedNodes(nodes: TaskNode[]): string {
  return nodes
    .map((node) => `${node.description}\n${node.result || ""}`)
    .join("\n");
}

function isGlobalGoalShortcutSkip(node: TaskNode): boolean {
  return (
    node.status === "skipped" &&
    String(node.result || "").includes("Skipped: global goal already achieved")
  );
}

function isActionOrMutationNode(node: TaskNode): boolean {
  const text = `${node.description}\n${node.successCriteria}`.toLowerCase();
  return [
    "search",
    "submit",
    "apply",
    "type ",
    "enter ",
    "fill ",
    "click ",
    "select ",
    "remove ",
    "add ",
    "swap ",
    "replace ",
    "checkout",
    "purchase",
    "delete ",
    "save ",
    "send ",
  ].some((token) => text.includes(token));
}

function formatRecentSideEffects(entries: SideEffectEntry[] | undefined): string {
  if (!entries || entries.length === 0) return "";
  const recent = entries.slice(-3);
  return recent
    .map((entry) => {
      const result = String(entry.result || "").trim();
      return `${entry.toolName}: ${result.slice(0, 120) || "executed"}`;
    })
    .join("; ");
}

function appendRecentSideEffects(
  message: string,
  entries: SideEffectEntry[] | undefined,
): string {
  const sideEffects = formatRecentSideEffects(entries);
  if (!sideEffects) return message;
  return `${message}\nRecent side effects: ${sideEffects}`;
}

export function buildInitialPlanState(
  task: OrchestratorTask,
  activeNodeId?: string,
) {
  if (task.nodes.length === 1) {
    const synthesized = synthesizePlanStateFromSingleNode(task.nodes[0]);
    if (synthesized && synthesized.subtasks.length >= 2) {
      return synthesized;
    }
  }

  const activeIndex =
    activeNodeId != null
      ? task.nodes.findIndex((node) => node.id === activeNodeId)
      : -1;
  const runningIndex = task.nodes.findIndex(
    (node) => node.status === "running",
  );
  return {
    subtasks: task.nodes.map((node) => ({
      description: node.description,
      successCriteria: node.successCriteria,
      status: node.status,
      turnsUsed: 0,
      turnBudget: 0,
      ...(node.result ? { result: node.result } : {}),
      ...(node.verificationGate
        ? { verificationGate: node.verificationGate }
        : {}),
      ...(inferToolProfileForStep(node.description, node.successCriteria)
        ? {
            toolProfile: inferToolProfileForStep(
              node.description,
              node.successCriteria,
            ),
          }
        : {}),
      ...(node.selectedSkillId
        ? { selectedSkillId: node.selectedSkillId }
        : {}),
    })),
    currentIndex:
      activeIndex >= 0
        ? activeIndex
        : runningIndex >= 0
          ? runningIndex
          : Math.max(0, task.currentIndex),
  };
}

function isTabOccupiedByRunningNode(
  tabId: number,
  nodeTabMap: Map<string, number>,
  nodes: TaskNode[],
): boolean {
  for (const [nodeId, assignedTabId] of nodeTabMap) {
    if (assignedTabId !== tabId) continue;
    const node = nodes.find((n) => n.id === nodeId);
    if (node?.status === "running") return true;
  }
  return false;
}

function synthesizePlanStateFromSingleNode(node: TaskNode) {
  const stepPattern =
    /(?:^|\n)\s*Step\s+(\d+)\s*:\s*([\s\S]*?)(?=(?:\n\s*Step\s+\d+\s*:)|$)/gi;
  const matches = [...node.description.matchAll(stepPattern)];
  if (matches.length < 2) return null;

  const currentIndex = 0;
  const baseStatus =
    node.status === "completed" || node.status === "failed"
      ? node.status
      : "pending";

  return {
    subtasks: matches
      .map((match, index) => {
        const description = match[2]?.trim();
        if (!description) return null;
        const toolProfile = inferToolProfileForStep(
          description,
          node.successCriteria,
        );
        return {
          description,
          successCriteria: node.successCriteria,
          status:
            node.status === "completed"
              ? "completed"
              : index < currentIndex
                ? "completed"
                : index === currentIndex
                  ? node.status === "running"
                    ? "running"
                    : baseStatus
                  : "pending",
          turnsUsed: 0,
          turnBudget: 0,
          ...(index === matches.length - 1 && node.verificationGate
            ? { verificationGate: node.verificationGate }
            : {}),
          ...(toolProfile ? { toolProfile } : {}),
        };
      })
      .filter(
        (subtask): subtask is NonNullable<typeof subtask> => subtask !== null,
      ),
    currentIndex,
  };
}

export * from "./lane-types";
export * from "./sanitizers";
export * from "./utils";

const DEFAULT_MAX_WORKERS = 3;
const MAX_HORIZON_EXPANSIONS = 30;
const ESCALATION_RESPONSE_TIMEOUT_MS = 60_000;
const ESCALATION_MAX_REASON_CHARS = 220;
const CHECKPOINTS_STORAGE_KEY = "opensidebar:orchestrator:checkpoints";
const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RECENT_COMPLETION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PERSISTED_MESSAGES = 200;
const E2E_SYNTHETIC_QUERY_PREFIX = "__e2e_pending_interaction__:";
const E2E_PENDING_INTERACTION_TIMEOUT_MS = 10 * 60 * 1000;

export class Orchestrator {
  private tasksByWorkspace = new Map<string, OrchestratorTask>();
  private recentCompletion = new Map<
    string,
    {
      payload: TaskCompletionMessage["payload"];
      timestamp: number;
    }
  >();
  private completionWaiters = new Map<
    string,
    Set<(payload: TaskCompletionMessage["payload"]) => void>
  >();
  private workersByWorkspace = new Map<string, WorkspaceLanePools>();
  private budgetEstimatorsByWorkspace = new Map<string, BudgetEstimator>();
  private laneRuntimeByWorkspace = new Map<
    string,
    Record<RuntimeLane, LaneRuntimeState>
  >();
  private pendingEscalationResolvers = new Map<
    string,
    (decision: EscalationDecisionPayload) => void
  >();
  private pendingPlanConfirmationResolvers = new Map<
    string,
    (result: { decision: "approve" | "cancel"; feedback?: string }) => void
  >();
  private pendingInteractionTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private laneSupervisorsByWorkspace = new Map<
    string,
    Record<RuntimeLane, LaneSupervisorState>
  >();
  private traceWriter: RunTraceWriter = createHttpRunTraceWriter();
  private traceFallbackWriter = new RunTraceWriter(async (record) => {
    if (record.kind === "manifest") {
      logger.debug("trace", "Run trace manifest", {
        runId: record.manifest.runId,
        source: record.manifest.source,
        environment: record.manifest.environment,
        promptCount: record.manifest.promptSet.length,
        taskId: record.manifest.taskId,
        workspaceId: record.manifest.workspaceId,
      });
      return;
    }
    logger.debug("trace", "Run trace event", {
      runId: record.event.runId,
      type: record.event.type,
      role: record.event.role,
      turn: record.event.turn,
    });
  });
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

  private async emitTraceManifest(manifest: RunManifest): Promise<void> {
    try {
      await this.traceWriter.emitManifest(manifest);
    } catch (error) {
      logger.debug("trace", "Failed to emit orchestrator trace manifest", {
        error: error instanceof Error ? error.message : String(error),
      });
      await this.traceFallbackWriter.emitManifest(manifest);
    }
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
    if (!task?.runId) return;
    void this.traceWriter
      .emitEvent({
        runId: task.runId,
        correlationId: task.runId,
        type,
        role,
        data,
      })
      .catch((error) => {
        logger.debug("trace", "Failed to emit orchestrator trace event", {
          runId: task.runId,
          type,
          error: error instanceof Error ? error.message : String(error),
        });
        void this.traceFallbackWriter.emitEvent({
          runId: task.runId!,
          correlationId: task.runId,
          type,
          role,
          data,
        });
      });
  }

  private buildTaskManifest(
    task: OrchestratorTask,
    _input: OrchestratorStartInput,
  ): RunManifest {
    const promptSet = listPromptDescriptors([
      "orchestrator.verifier.system",
      "orchestrator.advisory.system",
    ]);
    return {
      runId: task.runId || task.id,
      correlationId: task.runId || task.id,
      environment: "production",
      startedAt: new Date().toISOString(),
      source: "background.orchestrator",
      promptSet,
      taskId: task.id,
      workspaceId: task.workspaceId,
    };
  }

  private buildLanePolicy(
    lane: RuntimeLane,
    maxWorkers?: number,
  ): LaneBudgetPolicy {
    const base = DEFAULT_LANE_POLICIES[lane];
    const override = this.deps.lanePolicies[lane] ?? {};
    const runtimeDefaultMaxConcurrent =
      lane === "executor" || lane === "verifier"
        ? maxWorkers || base.maxConcurrent
        : base.maxConcurrent;

    return {
      maxConcurrent: clampInteger(
        override.maxConcurrent ?? runtimeDefaultMaxConcurrent,
        1,
        8,
      ),
      maxFailuresBeforeIsolation: clampInteger(
        override.maxFailuresBeforeIsolation ?? base.maxFailuresBeforeIsolation,
        1,
      ),
      isolationCooldownMs: clampInteger(
        override.isolationCooldownMs ?? base.isolationCooldownMs,
        1_000,
      ),
      maxCallMs: clampInteger(override.maxCallMs ?? base.maxCallMs, 1_000),
    };
  }

  private createWorkspaceLanePools(): WorkspaceLanePools {
    return {
      planner: new Map<string, LaneOperationInstance>(),
      executor: new Map<string, WorkerInstance>(),
      verifier: new Map<string, LaneOperationInstance>(),
    };
  }

  private createLaneSupervisor(lane: RuntimeLane): LaneSupervisorState {
    return {
      lane,
      queue: [],
      active: 0,
      draining: false,
      restartCount: 0,
      consecutiveCrashes: 0,
      circuitOpenUntilMs: 0,
      resumeTimer: null,
    };
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
  ): void {
    this.budgetEstimatorsByWorkspace.set(workspaceId, new BudgetEstimator());
    this.workersByWorkspace.set(workspaceId, this.createWorkspaceLanePools());
    this.laneSupervisorsByWorkspace.set(workspaceId, {
      planner: this.createLaneSupervisor("planner"),
      executor: this.createLaneSupervisor("executor"),
      verifier: this.createLaneSupervisor("verifier"),
    });
    this.laneRuntimeByWorkspace.set(workspaceId, {
      planner: {
        lane: "planner",
        activeCalls: 0,
        totalCalls: 0,
        failures: 0,
        totalDurationMs: 0,
        isolatedUntilMs: 0,
        policy: this.buildLanePolicy("planner", maxWorkers),
      },
      executor: {
        lane: "executor",
        activeCalls: 0,
        totalCalls: 0,
        failures: 0,
        totalDurationMs: 0,
        isolatedUntilMs: 0,
        policy: this.buildLanePolicy("executor", maxWorkers),
      },
      verifier: {
        lane: "verifier",
        activeCalls: 0,
        totalCalls: 0,
        failures: 0,
        totalDurationMs: 0,
        isolatedUntilMs: 0,
        policy: this.buildLanePolicy("verifier", maxWorkers),
      },
    });
    logger.debug("orchestrator", "Workspace runtime isolation initialized", {
      workspaceId,
      maxWorkers,
    });
    this.emitLaneSupervisorActivity(workspaceId);
  }

  private cleanupWorkspaceRuntime(workspaceId: string): void {
    this.clearPendingInteractionTimer(workspaceId);
    const supervisors = this.laneSupervisorsByWorkspace.get(workspaceId);
    for (const lane of ["planner", "executor", "verifier"] as const) {
      const supervisor = supervisors?.[lane];
      if (supervisor?.resumeTimer) clearTimeout(supervisor.resumeTimer);
    }
    this.laneSupervisorsByWorkspace.delete(workspaceId);
    this.workersByWorkspace.delete(workspaceId);
    this.budgetEstimatorsByWorkspace.delete(workspaceId);
    this.laneRuntimeByWorkspace.delete(workspaceId);
    this.recentCompletion.delete(workspaceId);
  }

  private getBudgetEstimator(workspaceId: string): BudgetEstimator {
    let estimator = this.budgetEstimatorsByWorkspace.get(workspaceId);
    if (!estimator) {
      estimator = new BudgetEstimator();
      this.budgetEstimatorsByWorkspace.set(workspaceId, estimator);
    }
    return estimator;
  }

  private getLaneRuntimeState(
    workspaceId: string,
    lane: RuntimeLane,
  ): LaneRuntimeState {
    const runtime = this.laneRuntimeByWorkspace.get(workspaceId);
    if (!runtime) {
      this.initializeWorkspaceRuntime(workspaceId, DEFAULT_MAX_WORKERS);
      return this.laneRuntimeByWorkspace.get(workspaceId)![lane];
    }
    return runtime[lane];
  }

  private getLaneSupervisorState(
    workspaceId: string,
    lane: RuntimeLane,
  ): LaneSupervisorState {
    const supervisors = this.laneSupervisorsByWorkspace.get(workspaceId);
    if (!supervisors) {
      this.initializeWorkspaceRuntime(workspaceId, DEFAULT_MAX_WORKERS);
      return this.laneSupervisorsByWorkspace.get(workspaceId)![lane];
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
    const runtime = this.laneRuntimeByWorkspace.get(workspaceId);
    const supervisors = this.laneSupervisorsByWorkspace.get(workspaceId);
    const now = Date.now();

    const buildLane = (lane: RuntimeLane) => {
      const activeCalls = runtime?.[lane]?.activeCalls ?? 0;
      const supervisor = supervisors?.[lane];
      return {
        activeCalls,
        queueDepth: supervisor?.queue.length ?? 0,
        restartCount: supervisor?.restartCount ?? 0,
        consecutiveCrashes: supervisor?.consecutiveCrashes ?? 0,
        circuitOpenUntilMs:
          (supervisor?.circuitOpenUntilMs ?? 0) > now
            ? (supervisor?.circuitOpenUntilMs ?? 0)
            : 0,
        lastCrashError: supervisor?.lastCrashError,
      };
    };

    return {
      timestamp: now,
      lanes: {
        planner: buildLane("planner"),
        executor: buildLane("executor"),
        verifier: buildLane("verifier"),
      },
    };
  }

  private emitLaneSupervisorActivity(workspaceId: string): void {
    const task = this.tasksByWorkspace.get(workspaceId);
    const telemetry = this.buildLaneTelemetrySnapshot(workspaceId);
    const activeFromTask =
      task?.status === "running" || task?.status === "planning";
    const activeFromLanes = Object.values(telemetry.lanes).some(
      (lane) => lane.activeCalls > 0 || lane.queueDepth > 0,
    );
    this.sendMessage({
      type: "AGENT_ACTIVITY",
      workspaceId,
      payload: {
        active: Boolean(activeFromTask || activeFromLanes),
        laneTelemetry: telemetry,
      },
    });
  }

  private isLaneIsolated(state: LaneRuntimeState): boolean {
    return state.isolatedUntilMs > Date.now();
  }

  private emitLaneIsolationStep(
    workspaceId: string,
    state: LaneRuntimeState,
    detail: string,
  ): void {
    this.sendMessage({
      type: "AGENT_STEP",
      workspaceId,
      payload: {
        step: {
          id: crypto.randomUUID(),
          type: "warning",
          label: `${state.lane} lane isolated`,
          detail,
          status: "done",
          timestamp: Date.now(),
        },
        update: false,
      },
    });
  }

  private async executeLaneOperation<T>(
    task: Pick<OrchestratorTask, "id" | "workspaceId">,
    lane: RuntimeLane,
    queued: QueuedLaneOperation,
  ): Promise<T> {
    const state = this.getLaneRuntimeState(task.workspaceId, lane);
    const supervisor = this.getLaneSupervisorState(task.workspaceId, lane);
    supervisor.active += 1;
    state.activeCalls = supervisor.active;
    state.totalCalls += 1;
    const startedAt = Date.now();
    const queueLatencyMs = startedAt - queued.enqueuedAt;
    const laneOperationId =
      lane === "executor" ? null : `${lane}-op-${crypto.randomUUID()}`;
    if (laneOperationId) {
      const pools = this.getWorkspaceLanePools(task.workspaceId);
      const narrowedLane = lane as Exclude<RuntimeLane, "executor">;
      const op: LaneOperationInstance = {
        operationId: laneOperationId,
        lane: narrowedLane,
        taskId: queued.taskId,
        workspaceId: queued.workspaceId,
        startedAt,
        timeoutMs: state.policy.maxCallMs,
        label: queued.label,
        nodeId: queued.nodeId,
      };
      (pools[narrowedLane] as Map<string, LaneOperationInstance>).set(
        laneOperationId,
        op,
      );
      logger.debug("orchestrator", "Lane operation registered", {
        taskId: queued.taskId,
        workspaceId: queued.workspaceId,
        lane,
        operationId: laneOperationId,
        activeLaneOperations: pools[lane].size,
        queueLatencyMs,
      });
    }
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeout = new Promise<never>(
        (_, reject) =>
          (timeoutId = setTimeout(
            () => reject(new LaneTimeoutError(lane, state.policy.maxCallMs)),
            state.policy.maxCallMs,
          )),
      );
      const result = (await Promise.race([queued.operation(), timeout])) as T;
      state.totalDurationMs += Date.now() - startedAt;
      if (state.failures > 0) {
        state.failures = Math.max(0, state.failures - 1);
      }
      supervisor.consecutiveCrashes = 0;
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        error instanceof LaneTimeoutError &&
        lane === "executor" &&
        queued.nodeId
      ) {
        this.stopExecutorWorkerForNode(
          task.workspaceId,
          queued.nodeId,
          `Lane timeout after ${state.policy.maxCallMs}ms`,
        );
      }
      state.failures += 1;
      state.lastError = message;
      state.totalDurationMs += Date.now() - startedAt;
      supervisor.restartCount += 1;
      supervisor.consecutiveCrashes += 1;
      supervisor.lastCrashAtMs = Date.now();
      supervisor.lastCrashError = message;
      const backoffMs = Math.min(
        250 * 2 ** Math.max(0, supervisor.consecutiveCrashes - 1),
        5_000,
      );
      logger.warn("orchestrator", "Lane execution failed", {
        workspaceId: task.workspaceId,
        taskId: task.id,
        lane,
        failures: state.failures,
        maxFailuresBeforeIsolation: state.policy.maxFailuresBeforeIsolation,
        error: message,
        laneRestartCount: supervisor.restartCount,
        laneConsecutiveCrashes: supervisor.consecutiveCrashes,
        backoffMs,
      });
      if (state.failures >= state.policy.maxFailuresBeforeIsolation) {
        state.isolatedUntilMs = Date.now() + state.policy.isolationCooldownMs;
        const detail =
          `${lane} lane entered cooldown after ${state.failures} failure(s). ` +
          `Cooldown=${state.policy.isolationCooldownMs}ms. Last error: ${message}`;
        logger.warn("orchestrator", "Lane isolated", {
          workspaceId: task.workspaceId,
          taskId: task.id,
          lane,
          isolatedUntilMs: state.isolatedUntilMs,
          detail,
        });
        this.emitTraceEvent(
          task,
          "lane_isolated",
          {
            taskId: task.id,
            workspaceId: task.workspaceId,
            lane,
            failures: state.failures,
            isolatedUntilMs: state.isolatedUntilMs,
            detail,
          },
          lane,
        );
        this.emitLaneIsolationStep(task.workspaceId, state, detail);
        throw new LaneIsolationError(
          lane,
          state.policy.isolationCooldownMs,
          message,
        );
      }

      supervisor.circuitOpenUntilMs = Date.now() + backoffMs;
      logger.warn("orchestrator", "Lane supervisor backoff", {
        workspaceId: task.workspaceId,
        taskId: task.id,
        lane,
        backoffMs,
        circuitOpenUntilMs: supervisor.circuitOpenUntilMs,
        restartCount: supervisor.restartCount,
        queueDepth: supervisor.queue.length,
      });
      this.emitLaneSupervisorActivity(task.workspaceId);
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (laneOperationId) {
        const pools = this.getWorkspaceLanePools(task.workspaceId);
        pools[lane].delete(laneOperationId);
        logger.debug("orchestrator", "Lane operation released", {
          taskId: task.id,
          workspaceId: task.workspaceId,
          lane,
          operationId: laneOperationId,
          activeLaneOperations: pools[lane].size,
        });
      }
      supervisor.active = Math.max(0, supervisor.active - 1);
      state.activeCalls = supervisor.active;
      this.emitLaneSupervisorActivity(task.workspaceId);
      void this.drainLaneQueue(task.workspaceId, lane);
    }
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
        const now = Date.now();
        if (this.isLaneIsolated(runtimeState)) {
          const remainingMs = runtimeState.isolatedUntilMs - now;
          const pending = supervisor.queue.splice(0, supervisor.queue.length);
          for (const queued of pending) {
            queued.reject(
              new LaneIsolationError(lane, remainingMs, runtimeState.lastError),
            );
          }
          shouldContinue = false;
          continue;
        }

        if (supervisor.circuitOpenUntilMs > now) {
          const waitMs = supervisor.circuitOpenUntilMs - now;
          if (!supervisor.resumeTimer) {
            supervisor.resumeTimer = setTimeout(() => {
              supervisor.resumeTimer = null;
              void this.drainLaneQueue(workspaceId, lane);
            }, waitMs);
            logger.debug(
              "orchestrator",
              "Lane supervisor waiting for backoff",
              {
                workspaceId,
                lane,
                waitMs,
                queueDepth: supervisor.queue.length,
              },
            );
          }
          shouldContinue = false;
          continue;
        }

        if (
          supervisor.queue.length === 0 ||
          supervisor.active >= runtimeState.policy.maxConcurrent
        ) {
          shouldContinue = false;
          continue;
        }

        const queued = supervisor.queue.shift();
        if (!queued) {
          shouldContinue = false;
          continue;
        }

        void this.executeLaneOperation(
          { id: queued.taskId, workspaceId: queued.workspaceId },
          lane,
          queued,
        )
          .then((result) => queued.resolve(result))
          .catch((error) => queued.reject(error));
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
    const now = Date.now();
    if (this.isLaneIsolated(state)) {
      const remainingMs = state.isolatedUntilMs - now;
      return Promise.reject(
        new LaneIsolationError(lane, remainingMs, state.lastError),
      );
    }

    const operationId = `${lane}-queued-${crypto.randomUUID()}`;
    return new Promise<T>((resolve, reject) => {
      supervisor.queue.push({
        operationId,
        taskId: task.id,
        workspaceId: task.workspaceId,
        label: metadata?.label || `${lane} lane call`,
        nodeId: metadata?.nodeId,
        enqueuedAt: Date.now(),
        operation: operation as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      logger.debug("orchestrator", "Lane operation queued", {
        taskId: task.id,
        workspaceId: task.workspaceId,
        lane,
        operationId,
        nodeId: metadata?.nodeId,
        queueDepth: supervisor.queue.length,
        activeLaneCalls: supervisor.active,
      });
      this.emitLaneSupervisorActivity(task.workspaceId);
      void this.drainLaneQueue(task.workspaceId, lane);
    });
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

  private appendHandoffArtifact(
    node: TaskNode,
    artifact: Omit<NodeHandoffArtifact, "timestamp">,
  ): void {
    const entry: NodeHandoffArtifact = {
      ...artifact,
      timestamp: Date.now(),
    };
    node.handoffArtifacts.push(entry);
    logger.debug("orchestrator", "Handoff artifact appended", {
      nodeId: node.id,
      role: entry.role,
      phase: entry.phase,
      note: entry.note.slice(0, 180),
    });
  }

  private async loadCheckpoints(): Promise<
    Record<string, OrchestratorCheckpoint>
  > {
    try {
      const stored = await chrome.storage.local.get(CHECKPOINTS_STORAGE_KEY);
      const raw = stored[CHECKPOINTS_STORAGE_KEY];
      if (!isRecord(raw)) return {};

      const parsed: Record<string, OrchestratorCheckpoint> = {};
      for (const [workspaceId, value] of Object.entries(raw)) {
        if (typeof workspaceId !== "string" || workspaceId.length === 0)
          continue;
        const cp = sanitizeCheckpoint(value);
        if (!cp) {
          logger.warn("orchestrator", "Dropping malformed checkpoint", {
            workspaceId,
          });
          continue;
        }
        if (cp.task.workspaceId !== workspaceId) {
          logger.warn(
            "orchestrator",
            "Dropping checkpoint with mismatched workspace",
            {
              keyWorkspaceId: workspaceId,
              taskWorkspaceId: cp.task.workspaceId,
            },
          );
          continue;
        }
        parsed[workspaceId] = cp;
      }
      return parsed;
    } catch (error) {
      logger.warn("orchestrator", "Failed to load checkpoints", { error });
      return {};
    }
  }

  private isCheckpointFresh(checkpoint: OrchestratorCheckpoint): boolean {
    return Date.now() - checkpoint.savedAt <= CHECKPOINT_TTL_MS;
  }

  private isCheckpointCompatible(checkpoint: OrchestratorCheckpoint): boolean {
    return checkpoint.version === CHECKPOINT_VERSION;
  }

  private async pruneCheckpoints(
    checkpoints: Record<string, OrchestratorCheckpoint>,
  ): Promise<Record<string, OrchestratorCheckpoint>> {
    let mutated = false;
    const kept: Record<string, OrchestratorCheckpoint> = {};

    for (const [workspaceId, cp] of Object.entries(checkpoints)) {
      if (!this.isCheckpointCompatible(cp)) {
        mutated = true;
        logger.warn(
          "orchestrator",
          "Dropping incompatible checkpoint version",
          {
            workspaceId,
            foundVersion: cp.version,
            expectedVersion: CHECKPOINT_VERSION,
          },
        );
        continue;
      }
      if (!this.isCheckpointFresh(cp)) {
        mutated = true;
        logger.info("orchestrator", "Dropping stale checkpoint", {
          workspaceId,
          ageMs: Date.now() - cp.savedAt,
          ttlMs: CHECKPOINT_TTL_MS,
        });
        continue;
      }
      kept[workspaceId] = cp;
    }

    if (mutated) {
      await this.saveCheckpoints(kept);
    }
    return kept;
  }

  private async saveCheckpoints(
    checkpoints: Record<string, OrchestratorCheckpoint>,
  ): Promise<void> {
    try {
      await chrome.storage.local.set({
        [CHECKPOINTS_STORAGE_KEY]: checkpoints,
      });
    } catch (error) {
      logger.warn("orchestrator", "Failed to save checkpoints", { error });
    }
  }

  private async persistTaskCheckpoint(task: OrchestratorTask): Promise<void> {
    const checkpoints = await this.loadCheckpoints();
    checkpoints[task.workspaceId] = {
      version: CHECKPOINT_VERSION,
      savedAt: Date.now(),
      task: {
        ...task,
        nodes: task.nodes.map((n) => ({ ...n })),
      },
    };
    await this.saveCheckpoints(checkpoints);
  }

  private async clearTaskCheckpoint(workspaceId: string): Promise<void> {
    const checkpoints = await this.loadCheckpoints();
    const cp = checkpoints[workspaceId];
    if (!cp) return;

    // Also clean up any turn checkpoints for this task's nodes
    const turnKeys = (cp.task.nodes || []).map((n) =>
      turnCheckpointKey(workspaceId, n.id),
    );
    if (turnKeys.length > 0) {
      chrome.storage.local.remove(turnKeys).catch(() => {});
    }

    delete checkpoints[workspaceId];
    await this.saveCheckpoints(checkpoints);
  }

  private async resolveResumeTabId(
    workspaceId: string,
    preferredTabId: number,
  ): Promise<number | null> {
    // Prefer the originally bound tab if it still exists.
    try {
      const tab = await chrome.tabs.get(preferredTabId);
      if (tab?.id) return tab.id;
    } catch {
      // fall through
    }

    // Otherwise pick any live tab from the workspace.
    const ws = await this.deps.workspaceManager.getWorkspaceById(workspaceId);
    for (const tabId of ws?.tabIds ?? []) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.id) return tab.id;
      } catch {
        // skip stale tab IDs
      }
    }

    return null;
  }

  private async buildResumeInput(
    task: OrchestratorTask,
    resumeTabId: number,
  ): Promise<OrchestratorStartInput | null> {
    const settings = (await loadSettings()) ?? ({} as UserSettings);
    const mode = settings.providerMode ?? (settings.openRouterApiKey ? "openrouter" : "fireworks");
    const activeKey =
      mode === "fireworks" ? settings.fireworksApiKey :
      mode === "openai-groq" ? settings.openaiApiKey :
      settings.openRouterApiKey;
    if (!activeKey) {
      logger.warn(
        "orchestrator",
        "Cannot resume task without API key for active provider",
        {
          workspaceId: task.workspaceId,
          providerMode: mode,
        },
      );
      return null;
    }

    return {
      query: task.query,
      tabId: resumeTabId,
      workspaceId: task.workspaceId,
      settings,
      openRouterApiKey: activeKey,
    };
  }

  private getPendingInteractionRemainingMs(
    interaction: PendingUserInteraction,
  ): number {
    return Math.max(
      0,
      interaction.timeoutMs - (Date.now() - interaction.requestedAt),
    );
  }

  private isPendingInteractionResolved(
    interaction: PendingUserInteraction | undefined,
  ): boolean {
    if (!interaction) return false;
    return interaction.kind === "approval"
      ? typeof interaction.approved === "boolean"
      : typeof interaction.answer === "string";
  }

  private clearPendingInteractionTimer(workspaceId: string): void {
    const timer = this.pendingInteractionTimers.get(workspaceId);
    if (timer) clearTimeout(timer);
    this.pendingInteractionTimers.delete(workspaceId);
  }

  private emitPendingInteraction(task: OrchestratorTask): void {
    const interaction = task.pendingInteraction;
    if (!interaction || this.isPendingInteractionResolved(interaction)) return;
    const remainingMs = this.getPendingInteractionRemainingMs(interaction);
    if (remainingMs <= 0) return;

    if (interaction.kind === "approval") {
      this.sendMessage({
        type: "APPROVAL_REQUEST",
        workspaceId: task.workspaceId,
        payload: {
          approvalId: interaction.approvalId,
          toolName: interaction.toolName,
          args: interaction.args,
          risk: "high",
          context: interaction.context,
          timeoutMs: remainingMs,
        },
      });
      return;
    }

    this.sendMessage({
      type: "CLARIFICATION_REQUEST",
      workspaceId: task.workspaceId,
      payload: {
        clarificationId: interaction.clarificationId,
        question: interaction.question,
        suggestions: interaction.suggestions,
        timeoutMs: remainingMs,
      },
    });
  }

  private isSyntheticPendingInteractionTask(task: OrchestratorTask): boolean {
    return task.query.startsWith(E2E_SYNTHETIC_QUERY_PREFIX);
  }

  private buildSyntheticPendingInteractionSummary(
    interaction: PendingUserInteraction,
  ): string {
    if (interaction.kind === "approval") {
      return interaction.approved
        ? `E2E synthetic approval recovered and approved for ${interaction.toolName}.`
        : `E2E synthetic approval recovered and denied for ${interaction.toolName}.`;
    }
    const answer = String(interaction.answer || "").trim();
    return answer
      ? `E2E synthetic clarification recovered and answered: ${answer}`
      : "E2E synthetic clarification recovered without an answer.";
  }

  private async finalizeSyntheticPendingInteractionTask(
    task: OrchestratorTask,
  ): Promise<void> {
    const interaction = task.pendingInteraction;
    if (!interaction || !this.isPendingInteractionResolved(interaction)) {
      return;
    }

    const summary = this.buildSyntheticPendingInteractionSummary(interaction);
    const terminalStatus =
      interaction.kind === "approval" && interaction.approved === false
        ? "failed"
        : "completed";

    task.pendingInteraction = undefined;
    task.finishedAt = Date.now();
    task.status = terminalStatus;
    task.sessionMetrics.totalSessionTimeMs =
      task.finishedAt - (task.startedAt || task.createdAt);

    if (interaction.nodeId) {
      const targetNode = task.nodes.find((node) => node.id === interaction.nodeId);
      if (targetNode) {
        targetNode.status = terminalStatus === "completed" ? "completed" : "failed";
        targetNode.result = summary;
        if (terminalStatus === "failed") {
          targetNode.error = summary;
        }
      }
    }

    task.currentIndex = currentIndex(task.nodes);
    this.sendMessage({
      type: "STREAM_CHUNK",
      workspaceId: task.workspaceId,
      payload: { delta: "", done: false, replaceContent: summary },
    });
    this.sendMessage({
      type: "STREAM_CHUNK",
      workspaceId: task.workspaceId,
      payload: { delta: "", done: true },
    });

    const completionPayload: TaskCompletionMessage["payload"] = {
      taskId: task.id,
      status: terminalStatus === "completed" ? "completed" : "failed",
      totalTurnsUsed: 0,
      totalTimeMs: task.finishedAt - (task.startedAt || task.createdAt),
      summary,
      subtaskResults: this.buildSubtaskResults(task),
      urlHistory: [],
      metrics: task.sessionMetrics,
      terminationReason:
        terminalStatus === "failed" ? summary : undefined,
    };

    this.cacheAndPersistCompletion(task.workspaceId, completionPayload);
    this.sendMessage({
      type: "TASK_COMPLETION",
      workspaceId: task.workspaceId,
      payload: completionPayload,
    });
    this.sendStatus(
      task.workspaceId,
      AgentStatus.IDLE,
      terminalStatus === "completed" ? "Task complete" : "Task failed",
      completionPayload.status,
    );
    this.tasksByWorkspace.delete(task.workspaceId);
    this.cleanupWorkspaceRuntime(task.workspaceId);
    await this.clearTaskCheckpoint(task.workspaceId);
  }

  private async resumeTaskAfterInteraction(
    task: OrchestratorTask,
  ): Promise<void> {
    if (this.isSyntheticPendingInteractionTask(task)) {
      await this.finalizeSyntheticPendingInteractionTask(task);
      return;
    }

    const resumeTabId = await this.resolveResumeTabId(
      task.workspaceId,
      task.rootTabId,
    );
    if (!resumeTabId) {
      logger.warn(
        "orchestrator",
        "Cannot resume after pending interaction, no live workspace tab",
        {
          workspaceId: task.workspaceId,
          taskId: task.id,
        },
      );
      task.status = "failed";
      task.finishedAt = Date.now();
      task.terminationReason = "Could not resume after user interaction.";
      await this.sendTerminationCompletion(task, task.terminationReason);
      await this.clearTaskCheckpoint(task.workspaceId);
      this.tasksByWorkspace.delete(task.workspaceId);
      this.cleanupWorkspaceRuntime(task.workspaceId);
      return;
    }

    const resumeInput = await this.buildResumeInput(task, resumeTabId);
    if (!resumeInput) {
      task.status = "failed";
      task.finishedAt = Date.now();
      task.terminationReason = "Could not rebuild runtime settings after user interaction.";
      await this.sendTerminationCompletion(task, task.terminationReason);
      await this.clearTaskCheckpoint(task.workspaceId);
      this.tasksByWorkspace.delete(task.workspaceId);
      this.cleanupWorkspaceRuntime(task.workspaceId);
      return;
    }

    this.sendStatus(task.workspaceId, AgentStatus.ACTING, "Resuming...");
    this.sendProgress(task);
    this.runTask(task, resumeInput).catch(async (error) => {
      logger.error("orchestrator", "Resumed interaction task failed", {
        workspaceId: task.workspaceId,
        taskId: task.id,
        error,
      });
      task.status = "failed";
      task.finishedAt = Date.now();
      await this.sendTerminationCompletion(
        task,
        "Task failed after resuming from user interaction",
      );
      await this.clearTaskCheckpoint(task.workspaceId);
      this.tasksByWorkspace.delete(task.workspaceId);
      this.cleanupWorkspaceRuntime(task.workspaceId);
      this.sendStatus(
        task.workspaceId,
        AgentStatus.ERROR,
        "Task failed after resuming from user interaction",
      );
    });
  }

  private armPendingInteractionTimeout(task: OrchestratorTask): void {
    this.clearPendingInteractionTimer(task.workspaceId);
    const interaction = task.pendingInteraction;
    if (!interaction || this.isPendingInteractionResolved(interaction)) return;

    const remainingMs = this.getPendingInteractionRemainingMs(interaction);
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
    if (!task || !interaction || this.isPendingInteractionResolved(interaction)) {
      return;
    }

    const resolvedInteraction: PendingUserInteraction =
      interaction.kind === "approval"
        ? { ...interaction, approved: false }
        : { ...interaction, answer: "No response from user." };

    logger.warn("orchestrator", "Pending interaction timed out", {
      workspaceId,
      taskId: task.id,
      nodeId: resolvedInteraction.nodeId,
      kind: resolvedInteraction.kind,
    });
    await this.resolvePendingInteraction(task, resolvedInteraction);
  }

  private async resolvePendingInteraction(
    task: OrchestratorTask,
    interaction: PendingUserInteraction,
  ): Promise<void> {
    task.pendingInteraction = interaction;
    this.clearPendingInteractionTimer(task.workspaceId);
    if (interaction.nodeId) {
      const targetNode = task.nodes.find((node) => node.id === interaction.nodeId);
      if (targetNode?.status === "running") {
        targetNode.status = "pending";
      }
    }
    task.currentIndex = currentIndex(task.nodes);
    await this.persistTaskCheckpoint(task);
    await this.resumeTaskAfterInteraction(task);
  }

  public async restoreFromCheckpoints(): Promise<void> {
    const checkpoints = await this.pruneCheckpoints(
      await this.loadCheckpoints(),
    );
    const entries = Object.values(checkpoints);
    if (entries.length === 0) return;

    logger.info("orchestrator", "Found orchestrator checkpoints", {
      count: entries.length,
    });

    for (const cp of entries) {
      const task = cp.task;
      if (
        task.status === "completed" ||
        task.status === "failed" ||
        task.status === "stopped"
      ) {
        await this.clearTaskCheckpoint(task.workspaceId);
        continue;
      }

      const resumeTabId = await this.resolveResumeTabId(
        task.workspaceId,
        task.rootTabId,
      );
      if (!resumeTabId) {
        logger.warn(
          "orchestrator",
          "Cannot resume checkpoint, no live workspace tab",
          {
            workspaceId: task.workspaceId,
            taskId: task.id,
          },
        );
        await this.clearTaskCheckpoint(task.workspaceId);
        continue;
      }

      const resumeInput = await this.buildResumeInput(task, resumeTabId);
      if (!resumeInput) {
        await this.clearTaskCheckpoint(task.workspaceId);
        continue;
      }

      // Load durable turn checkpoints for nodes that were running when SW died.
      const turnCheckpointsByNodeId = new Map<string, TurnCheckpoint>();
      for (const node of task.nodes) {
        if (node.status === "running") {
          try {
            const cpKey = turnCheckpointKey(task.workspaceId, node.id);
            const stored = await chrome.storage.local.get(cpKey);
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
            // Best-effort — node will start fresh
          }
        }
      }

      // Stash the map on the task for the executor to consume
      (task as any)._turnCheckpoints = turnCheckpointsByNodeId;

      const hasPendingInteraction = Boolean(task.pendingInteraction);
      const pendingInteractionResolved = this.isPendingInteractionResolved(
        task.pendingInteraction,
      );

      // "running" is transient; restart these nodes as pending and continue.
      if (!hasPendingInteraction || pendingInteractionResolved) {
        task.nodes = task.nodes.map((node) =>
          node.status === "running" ? { ...node, status: "pending" } : node,
        );
      }
      if (!task.runId) {
        task.runId = crypto.randomUUID();
      }
      task.status = "running";
      task.currentIndex = currentIndex(task.nodes);
      this.tasksByWorkspace.set(task.workspaceId, task);
      this.initializeWorkspaceRuntime(task.workspaceId, task.maxWorkers);
      await this.persistTaskCheckpoint(task);
      await this.emitTraceManifest({
        ...this.buildTaskManifest(task, resumeInput),
        source: "background.orchestrator.recovery",
      });
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

      const completedSubtasks = task.nodes.filter(
        (n) => n.status === "completed",
      ).length;
      const pendingSubtasks = task.nodes.filter(
        (n) => n.status === "pending",
      ).length;
      this.sendMessage({
        type: "TASK_RECOVERY",
        workspaceId: task.workspaceId,
        payload: {
          taskId: task.id,
          totalSubtasks: task.nodes.length,
          completedSubtasks,
          pendingSubtasks,
        },
      });
      this.sendStatus(
        task.workspaceId,
        hasPendingInteraction && !pendingInteractionResolved
          ? AgentStatus.PAUSED
          : AgentStatus.ACTING,
        hasPendingInteraction && !pendingInteractionResolved
          ? "Recovered task, awaiting user input..."
          : "Recovered task, resuming...",
      );
      this.sendProgress(task);

      if (hasPendingInteraction && !pendingInteractionResolved) {
        this.emitPendingInteraction(task);
        this.armPendingInteractionTimeout(task);
        continue;
      }

      // Fire-and-forget: each task resumes independently.
      this.runTask(task, resumeInput).catch(async (error) => {
        logger.error("orchestrator", "Recovered task failed", {
          workspaceId: task.workspaceId,
          taskId: task.id,
          error,
        });
        task.status = "failed";
        task.finishedAt = Date.now();
        this.sendTerminationCompletion(task, "Recovered task failed");
        await this.clearTaskCheckpoint(task.workspaceId);
        this.tasksByWorkspace.delete(task.workspaceId);
        this.cleanupWorkspaceRuntime(task.workspaceId);
        this.sendStatus(
          task.workspaceId,
          AgentStatus.ERROR,
          "Recovered task failed",
        );
      });
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
      pendingInteraction,
    };

    this.tasksByWorkspace.set(input.workspaceId, task);
    this.initializeWorkspaceRuntime(input.workspaceId, task.maxWorkers);
    await this.persistTaskCheckpoint(task);
    this.sendStatus(
      input.workspaceId,
      AgentStatus.PAUSED,
      "Awaiting user input...",
    );
    this.sendProgress(task);
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

  /**
   * Re-broadcast the current state for a workspace so the side panel can
   * recover transient UI state after a workspace switch.
   */
  resyncWorkspaceState(workspaceId: string): void {
    const task = this.tasksByWorkspace.get(workspaceId);

    if (!task) {
      // Check for a recent completion that the panel may have missed
      const cached = this.recentCompletion.get(workspaceId);
      if (cached && Date.now() - cached.timestamp < RECENT_COMPLETION_TTL_MS) {
        this.sendMessage({
          type: "TASK_COMPLETION",
          workspaceId,
          payload: cached.payload,
        });
      }
      this.sendStatus(workspaceId, AgentStatus.IDLE, "No active task");
      return;
    }

    if (task.status === "running" || task.status === "planning") {
      // Task is in-flight — re-send current status + progress
      this.sendStatus(
        workspaceId,
        task.status === "planning"
          ? AgentStatus.THINKING
          : task.pendingInteraction
            ? AgentStatus.PAUSED
            : AgentStatus.ACTING,
        task.status === "planning"
          ? "Planning…"
          : task.pendingInteraction
            ? "Awaiting user input…"
            : "Working…",
      );
      this.sendProgress(task);
      if (task.sessionMetrics) {
        this.sendMessage({
          type: "SESSION_METRICS",
          workspaceId,
          payload: { ...task.sessionMetrics },
        });
      }
      if (task.pendingInteraction) {
        this.emitPendingInteraction(task);
        this.armPendingInteractionTimeout(task);
      }
    } else {
      // Task finished (completed / failed / stopped) — re-send completion
      const subtaskResults: SubtaskResult[] = task.nodes.map((node) => ({
        description: node.description,
        status:
          node.status === "completed"
            ? "completed"
            : isUserSkippedNode(node)
              ? "skipped"
              : "failed",
        turnsUsed: 0,
        result: node.result || node.error || "",
      }));
      const completed = subtaskResults.filter(
        (r) => r.status === "completed",
      ).length;

      this.sendMessage({
        type: "TASK_COMPLETION",
        workspaceId,
        payload: {
          taskId: task.id,
          status:
            task.status === "completed"
              ? completed === subtaskResults.length
                ? "completed"
                : "partial"
              : "failed",
          totalTurnsUsed: 0,
          totalTimeMs:
            (task.finishedAt || Date.now()) -
            (task.startedAt || task.createdAt),
          summary: this.buildProgrammaticSummary(task),
          subtaskResults,
          urlHistory: [],
          metrics: task.sessionMetrics,
          terminationReason: task.terminationReason,
        },
      });
      if (task.sessionMetrics) {
        this.sendMessage({
          type: "SESSION_METRICS",
          workspaceId,
          payload: { ...task.sessionMetrics },
        });
      }
      this.sendStatus(workspaceId, AgentStatus.IDLE, "Task finished");
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
      `Planner preflight deferred ${deferred.length} node(s): ` +
      `capacity=${capacity.maxNodesOverall}, budget(tokens/time/cost)=` +
      `${capacity.maxNodesByTokens}/${capacity.maxNodesByTime}/${capacity.maxNodesByCost}, ` +
      `estimate(tokens/time/cost-per-node)=` +
      `${estimate.tokensPerNode.toFixed(0)}/${estimate.timeMsPerNode.toFixed(0)}/${estimate.costUsdPerNode.toFixed(4)} ` +
      `(samples=${estimate.samples}).`;
    for (const node of deferred) {
      node.status = "failed";
      node.error = `Deferred by budget preflight. ${reason} Deferred objective: ${node.description}`;
      this.appendHandoffArtifact(node, {
        role: "planner",
        phase: "planner_replan",
        note: "Deferred by budget preflight.",
      });
    }

    logger.warn(
      "orchestrator",
      "Planner preflight deferred nodes due to budget",
      {
        taskId: task.id,
        originalNodeCount: originalPending.length,
        keptNodeCount: selectedIds.size,
        deferredNodeCount: deferred.length,
        capacity,
        estimate,
        deferredNodeIds: deferred.map((n) => n.id),
      },
    );

    this.sendMessage({
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

    const priorTurnMemory =
      await loadWorkspaceTurnMemory(input.workspaceId).catch(() => null);
    const priorTurnMemoryBrief =
      formatWorkspaceTurnMemoryForPrompt(priorTurnMemory);

    // Long-term memory from backend/GBrain (non-blocking, falls back to empty)
    const longTermMemories = await searchMemory(input.query, 5).catch(() => []);
    const longTermBrief = formatBackendMemoriesForPrompt(longTermMemories);

    // Site-specific knowledge by domain (non-blocking)
    let siteKnowledgeBrief = "";
    try {
      const tab = await chrome.tabs.get(input.tabId);
      const currentDomain = extractDomain(tab.url || "");
      if (currentDomain) {
        const siteMemories = await searchMemoryByDomain(currentDomain, 10).catch(() => []);
        siteKnowledgeBrief = formatSiteKnowledgeForPrompt(
          rankSiteKnowledgeForTask(
            deduplicateSiteKnowledge(siteMemories),
            input.query,
          ),
        );
      }
    } catch {
      // Tab may not be accessible — skip site knowledge
    }

    const combinedMemoryBrief = [priorTurnMemoryBrief, longTermBrief, siteKnowledgeBrief]
      .filter(Boolean)
      .join("\n\n");
    const plannerQuery = buildQueryWithTurnMemory(
      input.query,
      combinedMemoryBrief,
    );
    const turnNumber = (priorTurnMemory?.turns.length ?? 0) + 1;

    const taskId = crypto.randomUUID();
    const task: OrchestratorTask = {
      runId: crypto.randomUUID(),
      id: taskId,
      workspaceId: input.workspaceId,
      rootTabId: input.tabId,
      query: input.query,
      turnNumber,
      priorTurnMemoryBrief: priorTurnMemoryBrief || undefined,
      siteKnowledgeBrief: siteKnowledgeBrief || undefined,
      status: "planning",
      createdAt: Date.now(),
      nodes: [],
      plannerReflexionLog: [],
      maxWorkers: Math.max(1, Math.min(8, DEFAULT_MAX_WORKERS)),
      maxReplans: DEFAULT_MAX_REPLANS,
      replansUsed: 0,
      horizonExpansions: 0,
      currentIndex: 0,
      sessionMetrics: emptySessionMetrics(),
      budget: {
        maxSessionTimeMs: DEFAULT_MAX_SESSION_TIME_MS,
        maxTotalTokens: clampInteger(DEFAULT_MAX_TOTAL_TOKENS, 1),
        maxTotalCostUsd: DEFAULT_MAX_TOTAL_COST_USD,
      },
    };
    this.tasksByWorkspace.set(input.workspaceId, task);
    this.initializeWorkspaceRuntime(input.workspaceId, task.maxWorkers);
    await this.persistTaskCheckpoint(task);
    await this.emitTraceManifest(this.buildTaskManifest(task, input));
    this.emitTraceEvent(
      task,
      "task_started",
      {
        query: input.query,
        tabId: input.tabId,
        maxWorkers: task.maxWorkers,
      },
      "system",
    );

    this.sendStatus(
      input.workspaceId,
      AgentStatus.THINKING,
      "Planning task...",
    );
    updateTabGroupAppearance(input.workspaceId, {
      title: input.query,
      status: AgentStatus.THINKING,
    });

    let nodes: TaskNode[] = [];

    // ─── Plan decomposition ───
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
        useNitro: input.settings.useNitro,
        providerMode: input.settings.providerMode,
        provider: input.settings.provider,
        openaiApiKey: input.settings.openaiApiKey,
        groqApiKey: input.settings.groqApiKey,
        temperature: input.settings.temperature,
        useVLExecutor: input.settings.useVLExecutor,
        fireworksApiKey: input.settings.fireworksApiKey,
      };
      const planner = this.deps.createPlanner(
        input.openRouterApiKey,
        modelOverrides,
      );
      const tab = await chrome.tabs.get(input.tabId);
      const buildResult = await this.runInLane(task, "planner", async () =>
        planner.buildNodes(plannerQuery, tab.title || "Untitled", tab.url || ""),
      );
      nodes = buildResult.nodes;
      const selectedSkills = nodes
        .filter((node) => node.selectedSkillId)
        .map((node) => `${node.id.slice(0, 6)}:${node.selectedSkillId}`);
      task.planClassification = {
        isSingleNode: buildResult.isSingleNode,
        difficulty: buildResult.difficulty,
      };
      // Use the first node's planner-derived objective as a meaningful title
      if (nodes.length > 0) {
        updateTabGroupAppearance(input.workspaceId, {
          title: nodes[0].description,
        });
      }
      this.emitTraceEvent(
        task,
        "plan_decomposed",
        {
          nodeCount: nodes.length,
          structured: true,
          isSingleNode: buildResult.isSingleNode,
          difficulty: buildResult.difficulty,
          skills: nodes
            .filter((node) => node.selectedSkillId)
            .map((node) => ({
              nodeId: node.id,
              skillId: node.selectedSkillId,
              reason: node.selectedSkillReason,
            })),
        },
        "planner",
      );
      this.sendMessage({
        type: "AGENT_STEP",
        workspaceId: input.workspaceId,
        payload: {
          step: {
            id: crypto.randomUUID(),
            type: "info",
            label: `Planning ${nodes.length} ${nodes.length === 1 ? "step" : "steps"}`,
            ...(selectedSkills.length > 0
              ? { detail: `Skills: ${selectedSkills.join(", ")}` }
              : {}),
            status: "done",
            timestamp: Date.now(),
          },
          update: false,
        },
      });
    } catch (error: any) {
      logger.warn("orchestrator", "Planner failed, using synthesized fallback graph", {
        error: error?.message,
      });
      nodes = buildFallbackNodes(input.query);
      task.planClassification = {
        isSingleNode: nodes.length === 1,
        difficulty: "moderate",
      };
      this.emitTraceEvent(
        task,
        "plan_decomposed",
        {
          nodeCount: 1,
          structured: false,
          fallback: true,
          skills: nodes
            .filter((node) => node.selectedSkillId)
            .map((node) => ({
              nodeId: node.id,
              skillId: node.selectedSkillId,
              reason: node.selectedSkillReason,
            })),
        },
        "planner",
      );
      this.sendMessage({
        type: "AGENT_STEP",
        workspaceId: input.workspaceId,
        payload: {
          step: {
            id: crypto.randomUUID(),
            type: "info",
            label: "Planning approach",
            detail: error?.message || "Unknown planner error",
            status: "done",
            timestamp: Date.now(),
          },
          update: false,
        },
      });
    }

    if (task.status === "stopped") {
      task.finishedAt = Date.now();
      if (task.nodes.length > 0) {
        this.sendTerminationCompletion(task, "Stopped by user during planning");
      }
      this.tasksByWorkspace.delete(task.workspaceId);
      this.cleanupWorkspaceRuntime(task.workspaceId);
      await this.clearTaskCheckpoint(task.workspaceId);
      this.emitTraceEvent(
        task,
        "task_stopped",
        { taskId: task.id, phase: "planning" },
        "system",
      );
      this.sendStatus(task.workspaceId, AgentStatus.IDLE, "Stopped");
      resetTabGroupAppearance(task.workspaceId);
      return;
    }

    task.nodes = nodes;

    // --- Plan Confirmation Gate ---
    // For multi-node plans, pause and ask the user to confirm before execution
    if (
      nodes.length >= 2 &&
      input.settings.requirePlanConfirmation !== false &&
      (task.status as string) !== "stopped"
    ) {
      const confirmation = await this.requestPlanConfirmation(
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
        task.status = "stopped";
        task.finishedAt = Date.now();
        this.sendTerminationCompletion(
          task,
          "Cancelled by user during plan confirmation",
        );
        this.tasksByWorkspace.delete(task.workspaceId);
        this.cleanupWorkspaceRuntime(task.workspaceId);
        await this.clearTaskCheckpoint(task.workspaceId);
        this.emitTraceEvent(
          task,
          "plan_confirmation_cancelled",
          { taskId: task.id },
          "system",
        );
        this.sendStatus(task.workspaceId, AgentStatus.IDLE, "Plan cancelled");
        resetTabGroupAppearance(task.workspaceId);
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
              useNitro: input.settings.useNitro,
            },
          );
          const replanResult = await replanPlanner.buildNodes(
            revisedQuery,
            tab.title || "Untitled",
            tab.url || "",
          );
          if (replanResult.nodes.length > 0) {
            task.nodes = replanResult.nodes;
            nodes = replanResult.nodes;
            task.replansUsed += 1;
            this.sendProgress(task);
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

    this.sendProgress(task);
    this.sendStatus(
      input.workspaceId,
      AgentStatus.ACTING,
      "Executing subtasks...",
    );

    try {
      await this.runTask(task, input);
    } catch (error) {
      // Catch unexpected exceptions (LaneIsolationError, etc.) so the side
      // panel stream is always finalized and the task is cleaned up.
      logger.error("orchestrator", "runTask threw unexpected error", {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      task.status = "failed";
      task.finishedAt = Date.now();
      this.sendTerminationCompletion(
        task,
        `Task failed: ${error instanceof Error ? error.message : "unexpected error"}`,
      );
      this.sendStatus(input.workspaceId, AgentStatus.ERROR, "Task failed");
      resetTabGroupAppearance(input.workspaceId);
      this.tasksByWorkspace.delete(task.workspaceId);
      this.cleanupWorkspaceRuntime(task.workspaceId);
      await this.clearTaskCheckpoint(task.workspaceId);
    }
  }

  private async runTask(
    task: OrchestratorTask,
    input: OrchestratorStartInput,
  ): Promise<void> {
    const budgetEstimator = this.getBudgetEstimator(task.workspaceId);
    const running = new Set<Promise<void>>();
    const budgetWarningsEmitted = new Set<string>();
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
      useNitro: input.settings.useNitro,
    };
    const verifier = this.deps.createVerifier(
      input.openRouterApiKey,
      loopModelOverrides,
    );
    const replanner = this.deps.createPlanner(
      input.openRouterApiKey,
      loopModelOverrides,
    );
    const nodeTabMap = new Map<string, number>();
    let initialTabUrl = "about:blank";
    try {
      initialTabUrl = (await chrome.tabs.get(input.tabId)).url || "about:blank";
    } catch {
      // If the tab disappears between restore/start and execution, worker tabs still boot safely.
    }

    const getBudgetExhaustionReason = (): string | null => {
      const elapsedMs = Date.now() - (task.startedAt || task.createdAt);
      if (elapsedMs > task.budget.maxSessionTimeMs) {
        return `Global time budget exceeded (${elapsedMs}ms > ${task.budget.maxSessionTimeMs}ms)`;
      }
      if (task.sessionMetrics.totalTokens > task.budget.maxTotalTokens) {
        return `Global token budget exceeded (${task.sessionMetrics.totalTokens} > ${task.budget.maxTotalTokens})`;
      }
      if (task.sessionMetrics.totalCost > task.budget.maxTotalCostUsd) {
        return `Global cost budget exceeded ($${task.sessionMetrics.totalCost.toFixed(4)} > $${task.budget.maxTotalCostUsd.toFixed(4)})`;
      }
      return null;
    };

    const applyBudgetTermination = (reason: string): void => {
      task.terminationReason = reason;
      for (const pendingNode of task.nodes) {
        if (pendingNode.status !== "pending") continue;
        pendingNode.status = "failed";
        pendingNode.error = reason;
      }
      logger.warn("orchestrator", "Global budget exhausted; terminating task", {
        taskId: task.id,
        reason,
        totalTokens: task.sessionMetrics.totalTokens,
        totalCost: task.sessionMetrics.totalCost,
        elapsedMs: Date.now() - (task.startedAt || task.createdAt),
      });
      this.sendMessage({
        type: "AGENT_STEP",
        workspaceId: task.workspaceId,
        payload: {
          step: {
            id: crypto.randomUUID(),
            type: "warning",
            label: "Global execution budget exhausted",
            detail: reason,
            status: "done",
            timestamp: Date.now(),
          },
          update: false,
        },
      });
      task.status = "failed";
    };

    const launchWorker = async (node: TaskNode): Promise<void> => {
      if (task.status !== "running") return;
      let staleSignalCount = 0;
      const nodeStartMs = Date.now();

      node.status = "running";
      this.emitTraceEvent(
        task,
        "node_started",
        {
          nodeId: node.id,
          selectedSkillId: node.selectedSkillId,
          selectedSkillReason: node.selectedSkillReason,
          retries: node.retries,
          handoffDepth: node.handoffDepth,
          hasReflexion: node.reflexionLog.length > 0,
          dependencyCount: node.dependencies.length,
        },
        "executor",
      );
      this.appendHandoffArtifact(node, {
        role: "executor",
        phase: "executor_started",
        note: `Executor started objective: ${node.description}`,
      });
      task.currentIndex = currentIndex(task.nodes);
      this.sendProgress(task);
      await this.persistTaskCheckpoint(task);

      const workerId = crypto.randomUUID();
      let tabId: number;
      const previousTabId = nodeTabMap.get(node.id);
      if (previousTabId != null) {
        // 1. Retry: reuse tab from previous attempt (validate it still exists)
        try {
          await chrome.tabs.get(previousTabId);
          tabId = previousTabId;
        } catch {
          tabId = input.tabId; // Fallback to user's tab
        }
      } else if (nodeTabMap.size === 0) {
        // 2. First node: use the user's original tab
        tabId = input.tabId;
      } else {
        // 3. Sequential dependency: reuse the predecessor's tab
        const depTabId = node.dependencies
          .map((depId) => nodeTabMap.get(depId))
          .find((id) => id != null);
        if (depTabId != null) {
          try {
            await chrome.tabs.get(depTabId);
            tabId = depTabId;
          } catch {
            tabId = input.tabId; // Fallback to user's tab
          }
        } else if (input.settings.allowNavigation === false) {
          // allowNavigation disabled: never create new tabs
          tabId = input.tabId;
        } else if (
          isTabOccupiedByRunningNode(input.tabId, nodeTabMap, task.nodes)
        ) {
          // 4. User's tab is occupied by a running node — create if under cap
          const createdCount = task.createdWorkerTabIds?.length ?? 0;
          if (createdCount < task.maxWorkers - 1) {
            tabId = await this.createWorkerTab(initialTabUrl, task.workspaceId);
            if (!task.createdWorkerTabIds) task.createdWorkerTabIds = [];
            task.createdWorkerTabIds.push(tabId);
          } else {
            // Over cap: fallback to user's tab
            tabId = input.tabId;
          }
        } else {
          // 5. User's tab is free: reuse it
          tabId = input.tabId;
        }
      }
      nodeTabMap.set(node.id, tabId);

      const snapshot = await this.getSnapshot(tabId);
      const recoveredTurnCheckpoints = (task as any)._turnCheckpoints as
        | Map<string, TurnCheckpoint>
        | undefined;
      const candidateTurnCheckpoint =
        recoveredTurnCheckpoints?.get(node.id) ?? null;
      let validatedTurnCheckpoint: TurnCheckpoint | null = null;
      if (candidateTurnCheckpoint) {
        recoveredTurnCheckpoints?.delete(node.id);
        if (isTurnCheckpointCompatible(candidateTurnCheckpoint, snapshot)) {
          validatedTurnCheckpoint = candidateTurnCheckpoint;
          logger.info(
            "orchestrator",
            "Using durable turn checkpoint for recovered node",
            {
              taskId: task.id,
              nodeId: node.id,
              turn: candidateTurnCheckpoint.turnCount,
            },
          );
        } else {
          logger.warn(
            "orchestrator",
            "Discarding incompatible turn checkpoint for recovered node",
            {
              taskId: task.id,
              nodeId: node.id,
              checkpointUrl: candidateTurnCheckpoint.pageUrl,
              liveUrl: snapshot?.url ?? null,
              checkpointFingerprint:
                candidateTurnCheckpoint.snapshotFingerprint,
              liveFingerprint: getSnapshotFingerprint(snapshot ?? null),
            },
          );
        }
      }
      const driftSignal = buildAssumptionDriftSignal(node, snapshot);
      const driftDetected = driftSignal.startsWith(
        "Potential plan-reality drift",
      );
      if (driftSignal.startsWith("Potential plan-reality drift")) {
        logger.warn("orchestrator", "Planner assumption drift detected", {
          taskId: task.id,
          nodeId: node.id,
          driftSignal,
          assumptionCount: node.assumptions.length,
        });
      }
      const taskStateBrief = buildTaskStateBrief(
        task.nodes,
        node.id,
        "executor",
      );
      const verifierTaskStateBrief = buildTaskStateBrief(
        task.nodes,
        node.id,
        "verifier",
      );
      const executorContract = buildRoleExecutionContract(
        "executor",
        input.settings,
        node,
      );
      logger.debug("policy", "Role execution contract resolved", {
        role: executorContract.role,
        taskId: task.id,
        nodeId: node.id,
        modelTier: executorContract.modelTier,
        allowedToolCount: executorContract.allowedTools.length,
        disabledToolCount: executorContract.disabledTools.size,
        taskStateContextChars: taskStateBrief.length,
      });
      const verificationTurnMode = shouldUseVerificationTurnMode({
        originalQuery: task.query,
        priorTurnMemoryBrief: task.priorTurnMemoryBrief,
      });

      const loop = this.deps.createAgentLoop({
        openRouterApiKey: input.openRouterApiKey,
        callbacks: {
          onStatusUpdate: (_status, _detail) => {
            // Task-level status is emitted by orchestrator.
          },
          onMessage: () => {
            // Worker-level summaries are aggregated by orchestrator.
          },
          onStep: (step, update) => {
            const lowerLabel = (step.label || "").toLowerCase();
            const lowerDetail = (step.detail || "").toLowerCase();
            if (
              lowerLabel.includes("stuck") ||
              lowerDetail.includes("stuck") ||
              lowerLabel.includes("nudge") ||
              lowerDetail.includes("nudge") ||
              lowerLabel.includes("escalat") ||
              lowerDetail.includes("escalat")
            ) {
              staleSignalCount += 1;
              logger.warn(
                "orchestrator",
                "Worker emitted stale-progress signal",
                {
                  taskId: task.id,
                  nodeId: node.id,
                  staleSignalCount,
                  stepLabel: step.label,
                  stepDetail: step.detail,
                },
              );
            }
            const isSingleNode = task.planClassification?.isSingleNode === true;
            const resolvedLabel = isSingleNode ? step.label : `Executor: ${step.label}`;
            this.sendMessage({
              type: "AGENT_STEP",
              workspaceId: task.workspaceId,
              payload: {
                step: { ...step, label: resolvedLabel },
                update,
              },
            });
            // Forward step label to content script for the floating overlay
            if (tabId && step.label) {
              chrome.tabs
                .sendMessage(tabId, {
                  type: "AGENT_STEP_LABEL",
                  requestId: crypto.randomUUID(),
                  source: MessageSource.BACKGROUND,
                  payload: { label: resolvedLabel, status: step.status },
                })
                .catch(() => {});
            }
          },
        },
        options: {
          maxContextTokens: 128000,
          maxTurns: input.settings.maxTurns || 30,
          showSessionMetrics: false,
          preferredModelTier: executorContract.modelTier,
          executionContract: {
            role: executorContract.role,
            modelTier: executorContract.modelTier,
            allowedTools: executorContract.allowedTools,
          },
          disabledTools: executorContract.disabledTools,
          workspaceId: task.workspaceId,
          workerId,
          taskId: task.id,
          nodeId: node.id,
          runId: task.runId || task.id,
          correlationId: task.runId || task.id,
          suppressUiBroadcast: true,
          // For single-node tasks, forward clean content to the side panel.
          // Suppresses intermediate text deltas (raw reasoning/JSON) — the user
          // sees step progress during execution and the final summary via replaceContent.
          onStreamChunk: task.planClassification?.isSingleNode
            ? (
                delta: string,
                done: boolean,
                replaceContent?: string,
                thinking?: string,
              ) => {
                // Only forward replaceContent, done, and thinking — skip raw text deltas
                if (replaceContent !== undefined || done || thinking) {
                  this.sendMessage({
                    type: "STREAM_CHUNK",
                    workspaceId: task.workspaceId,
                    payload: {
                      delta: "",
                      done,
                      ...(replaceContent !== undefined
                        ? { replaceContent }
                        : {}),
                      ...(thinking ? { thinking } : {}),
                    },
                  });
                }
                // Track whether real content was streamed (for dedup in finalization)
                if (replaceContent !== undefined) {
                  task._streamHasContent = replaceContent.length > 0;
                }
              }
            : undefined,
          // Single-node tasks: synthesize plan state from the node description
          // so the loop's done() guards (plan completeness, validateDone) activate.
          // Multi-node tasks: pass a single-subtask plan state representing the
          // current node. This activates done() validation (the planner verifies
          // the node objective was actually met) without exposing sibling nodes.
          initialPlanState: task.planClassification?.isSingleNode
            ? (synthesizePlanStateFromSingleNode(node) ?? undefined)
            : {
                currentIndex: 0,
                subtasks: [
                  {
                    description: node.description,
                    successCriteria: node.successCriteria,
                    status: "running" as const,
                    ...(inferToolProfileForStep(
                      node.description,
                      node.successCriteria,
                    )
                      ? {
                          toolProfile: inferToolProfileForStep(
                            node.description,
                            node.successCriteria,
                          ),
                        }
                      : {}),
                  },
                ],
              },
          verificationTurnMode,
          disableInternalPlanning: executorContract.disableInternalPlanning,
          bypassApprovals: !(input.settings.requireApprovals ?? true),
          executorModel: input.settings.executorModel,
          plannerModel: input.settings.plannerModel,
          useNitro: input.settings.useNitro,
          providerMode: input.settings.providerMode,
          provider: input.settings.provider,
          openaiApiKey: input.settings.openaiApiKey,
        groqApiKey: input.settings.groqApiKey,
          fireworksApiKey: input.settings.fireworksApiKey,
          temperature: input.settings.temperature,
          useVLExecutor: input.settings.useVLExecutor,
          // Durable turn checkpoint: injected by orchestrator on SW restart recovery
          turnCheckpoint: validatedTurnCheckpoint,
          // Resumable approval/clarification state: injected after user response.
          resumeInteraction:
            task.pendingInteraction?.nodeId === node.id
              ? task.pendingInteraction
              : null,
        },
      });

      const wsPools = this.getWorkspaceLanePools(task.workspaceId);
      wsPools.executor.set(workerId, {
        workerId,
        nodeId: node.id,
        tabId,
        loop,
      });
      logger.debug("orchestrator", "Executor worker registered in lane pool", {
        taskId: task.id,
        workspaceId: task.workspaceId,
        workerId,
        nodeId: node.id,
        lane: "executor",
        activeExecutorWorkers: wsPools.executor.size,
      });

      try {
        let executorInstruction = buildExecutorInstruction(
          node,
          taskStateBrief,
          driftSignal,
          undefined, // node.description used directly
          task.query,
          task.priorTurnMemoryBrief,
          verificationTurnMode,
          task.siteKnowledgeBrief,
        );

        // Inject predecessor trajectory for same-tab sequential nodes.
        // This gives the executor awareness of what happened before (e.g.
        // "cart drawer opened after adding item") without full history.
        if (node.dependencies.length > 0) {
          const predecessorTrajectories: string[] = [];
          for (const depId of node.dependencies) {
            const depNode = task.nodes.find((n) => n.id === depId);
            if (
              depNode?.trajectory &&
              depNode.trajectory.length > 0 &&
              nodeTabMap.get(depId) === tabId // same tab
            ) {
              predecessorTrajectories.push(
                `Prior actions (${depNode.description}):\n${depNode.trajectory.join("\n")}`,
              );
            }
          }
          if (predecessorTrajectories.length > 0) {
            executorInstruction +=
              "\n\nPage history from prior steps on this tab:\n" +
              predecessorTrajectories.join("\n\n");
          }
        }

        if (
          (node.retries > 0 || node.handoffFromNodeId) &&
          verifier.advise &&
          snapshot
        ) {
          try {
            const advisory = await this.runInLane(task, "verifier", async () =>
              verifier.advise!({
                executorInstruction,
                pageTitle: snapshot.title || "",
                pageUrl: snapshot.url || "",
                visibleContent:
                  snapshot.pageContent || snapshot.visibleContent || "",
              }),
            );
            if (advisory) {
              executorInstruction += `\n\nPre-execution advisory:\n${advisory}`;
              this.appendHandoffArtifact(node, {
                role: "verifier",
                phase: "verifier_advisory",
                note: advisory.slice(0, 200),
              });
              logger.debug(
                "orchestrator",
                "Advisory appended to executor instruction",
                {
                  taskId: task.id,
                  nodeId: node.id,
                  advisoryChars: advisory.length,
                },
              );
              this.emitTraceEvent(
                task,
                "advisory_issued",
                {
                  nodeId: node.id,
                  advisoryChars: advisory.length,
                  retries: node.retries,
                  hasHandoff: Boolean(node.handoffFromNodeId),
                },
                "verifier",
              );
            }
          } catch (error) {
            if (isLaneIsolationError(error, "verifier")) {
              throw error;
            }
            logger.warn(
              "orchestrator",
              "Advisory call failed, continuing without",
              {
                taskId: task.id,
                nodeId: node.id,
                error,
              },
            );
          }
        }

        logger.debug("orchestrator", "Executor instruction prepared", {
          taskId: task.id,
          nodeId: node.id,
          retries: node.retries,
          handoffArtifactCount: node.handoffArtifacts.length,
          instructionChars: executorInstruction.length,
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
        task.sessionMetrics = mergeSessionMetrics(
          task.sessionMetrics,
          result.metrics,
        );
        budgetEstimator.recordObservation({
          tokens: result.metrics?.totalTokens ?? 0,
          costUsd: result.metrics?.totalCost ?? 0,
          timeMs: Math.max(
            result.metrics?.totalSessionTimeMs ?? 0,
            Date.now() - nodeStartMs,
          ),
        });
        logger.debug("orchestrator", "Worker metrics merged", {
          taskId: task.id,
          nodeId: node.id,
          totalTokens: task.sessionMetrics.totalTokens,
          totalCost: task.sessionMetrics.totalCost,
          totalLlmTimeMs: task.sessionMetrics.totalLlmTimeMs,
          llmCallCount: task.sessionMetrics.llmCallCount,
          budgetEstimate: budgetEstimator.getEstimate(),
        });
        // Store condensed action trajectory for same-tab handoff
        if (result.trajectory && result.trajectory.length > 0) {
          node.trajectory = result.trajectory;
        }

        if (node.status !== "running") {
          return;
        }
        if (
          result.outcome === "awaiting_approval" ||
          result.outcome === "awaiting_clarification"
        ) {
          task.pendingInteraction = result.pendingInteraction;
          this.armPendingInteractionTimeout(task);
          this.sendStatus(
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
        const executorEvidence: StructuredEvidence[] = [
          {
            claim: result.summary || "Executor finished without summary.",
            basis: "tool_output",
            confidence: result.outcome === "completed" ? 1.0 : 0.5,
          },
        ];
        this.appendHandoffArtifact(node, {
          role: "executor",
          phase: "executor_finished",
          note: result.summary || "Executor finished without summary.",
          evidence: executorEvidence,
        });
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
          {
            const verifierHandoffContext = buildVerifierContext(
              node,
              verifierTaskStateBrief,
            );
            // Capture post-execution URL/title for programmatic verification
            let currentUrl: string | undefined;
            let currentTitle: string | undefined;
            try {
              const postTab = await chrome.tabs.get(tabId);
              currentUrl = postTab.url;
              currentTitle = postTab.title;
            } catch {
              // Tab may have closed; proceed without post-execution tab info
            }
            const programmaticResult = programmaticVerify({
              output: result.summary,
              objective: node.description,
              successCriteria: node.successCriteria,
              evidence: executorEvidence,
              previousUrl: snapshot?.url,
              currentUrl,
              previousTitle: snapshot?.title,
              currentTitle,
              executorOutcome: result.outcome,
            });
            let verification: NodeVerificationResult;
            if (programmaticResult) {
              verification = programmaticResult;
              logger.debug(
                "orchestrator",
                "Programmatic verification resolved",
                {
                  taskId: task.id,
                  nodeId: node.id,
                  decision: verification.decision,
                  confidence: verification.confidence,
                },
              );
            } else {
              verification = await this.runInLane(task, "verifier", async () =>
                verifier.verifyNode({
                  taskQuery: task.query,
                  objective: node.description,
                  successCriteria: node.successCriteria,
                  output: result.summary,
                  handoffContext: verifierHandoffContext,
                  executorOutcome: result.outcome,
                  evidence: executorEvidence,
                  previousUrl: snapshot?.url,
                  currentUrl,
                  previousTitle: snapshot?.title,
                  currentTitle,
                }),
              );
            }
            const verificationConfidence =
              typeof verification.confidence === "number"
                ? verification.confidence
                : 0.5;
            const verificationFailureType = verification.failureType;
            logger.info("orchestrator", "Verifier decision", {
              taskId: task.id,
              nodeId: node.id,
              decision: verification.decision,
              reason: verification.reason,
              confidence: verificationConfidence,
              failureType: verificationFailureType,
              rerouteObjective: verification.rerouteObjective,
              handoffContextChars: verifierHandoffContext.length,
            });
            this.emitVerifierStep(
              task.workspaceId,
              node.id,
              verification.reason,
            );
            this.emitTraceEvent(
              task,
              "node_verified",
              {
                nodeId: node.id,
                decision: verification.decision,
                confidence: verificationConfidence,
                failureType: verificationFailureType,
                rerouteObjective: verification.rerouteObjective,
                reason: (verification.reason || "").slice(0, 300),
              },
              "verifier",
            );

            if (
              task.status === "running" &&
              this.shouldEscalateForDecision(task, node, verification)
            ) {
              const escalationPacket =
                task.pendingEscalation?.packet.nodeId === node.id
                  ? task.pendingEscalation.packet
                  : this.buildEscalationPacket({
                      task,
                      node,
                      verification,
                      snapshot,
                    });
              const escalationDecision = await this.requestEscalationDecision(
                task,
                escalationPacket,
              );
              task.pendingEscalation = {
                packet: escalationPacket,
                selectedOption: escalationDecision,
              };
              await this.persistTaskCheckpoint(task);
              logger.info("orchestrator", "Escalation decision received", {
                taskId: task.id,
                nodeId: node.id,
                escalationId: escalationPacket.escalationId,
                optionId: escalationDecision.optionId,
              });

              if (escalationDecision.optionId === "stop_task") {
                task.status = "stopped";
                node.status = "failed";
                node.error = "Stopped by operator escalation decision.";

                await this.clearPendingEscalation(task);
                return;
              }
              if (escalationDecision.optionId === "skip_node") {
                node.status = "skipped";
                node.error = "Skipped by operator escalation decision.";

                await this.clearPendingEscalation(task);
                return;
              }
              if (escalationDecision.optionId === "reroute_with_option") {
                verification.decision = "reroute";
                verification.rerouteObjective =
                  escalationDecision.rerouteObjective ||
                  escalationPacket.options.find(
                    (o) => o.id === "reroute_with_option",
                  )?.rerouteObjective ||
                  verification.rerouteObjective ||
                  `Use an alternate path for: ${node.description}`;
                verification.reason = `Operator reroute decision: ${verification.rerouteObjective}`;
              }
              await this.clearPendingEscalation(task);
            }

            if (verification.decision === "accept") {
              this.appendHandoffArtifact(node, {
                role: "verifier",
                phase: "verifier_accept",
                note: verification.reason,
              });
              node.status = "completed";
              node.result = result.summary;
            } else if (
              verification.decision === "reroute" &&
              verification.rerouteObjective &&
              task.status === "running" &&
              node.handoffDepth < MAX_HANDOFF_DEPTH
            ) {
              this.appendHandoffArtifact(node, {
                role: "verifier",
                phase: "verifier_reroute",
                note: `${verification.reason} Reroute: ${verification.rerouteObjective}`,
              });
              const reroutedNode = createRerouteNode(
                node,
                verification.rerouteObjective,
                verification.reason,
              );
              node.status = "completed";
              node.result = `Handed off to ${reroutedNode.id}: ${verification.reason}`;
              task.nodes.push(reroutedNode);

              logger.info(
                "orchestrator",
                "Verifier handoff created reroute node",
                {
                  taskId: task.id,
                  fromNodeId: node.id,
                  toNodeId: reroutedNode.id,
                  handoffDepth: reroutedNode.handoffDepth,
                  rerouteObjective: verification.rerouteObjective,
                },
              );
            } else if (task.status === "running") {
              let replanned = false;
              if (
                verification.decision === "retry" &&
                (driftDetected || staleSignalCount > 0)
              ) {
                if (task.replansUsed >= task.maxReplans) {
                  const reason = `Replan budget exhausted (${task.replansUsed}/${task.maxReplans}). ${verification.reason}`;
                  this.appendHandoffArtifact(node, {
                    role: "planner",
                    phase: "planner_replan",
                    note: reason,
                  });
                  node.status = "failed";
                  node.error = appendRecentSideEffects(
                    reason,
                    result.sideEffectsLog,
                  );

                  logger.warn(
                    "orchestrator",
                    "Replan budget exhausted; failing node",
                    {
                      taskId: task.id,
                      nodeId: node.id,
                      replansUsed: task.replansUsed,
                      maxReplans: task.maxReplans,
                    },
                  );
                  this.sendMessage({
                    type: "AGENT_STEP",
                    workspaceId: task.workspaceId,
                    payload: {
                      step: {
                        id: crypto.randomUUID(),
                        type: "warning",
                        label: `Planner: replan budget exhausted for node ${node.id}`,
                        detail: reason,
                        status: "done",
                        timestamp: Date.now(),
                      },
                      update: false,
                    },
                  });
                  replanned = true;
                } else {
                  try {
                    const reflexionContext = formatPlannerReflexionContext(
                      task.plannerReflexionLog,
                    );
                    const replanReason = reflexionContext
                      ? `${verification.reason} (driftDetected=${driftDetected}; staleSignalCount=${staleSignalCount})\n\nPrior failure lessons:\n${reflexionContext}`
                      : `${verification.reason} (driftDetected=${driftDetected}; staleSignalCount=${staleSignalCount})`;
                    const expandedNodes = await this.runInLane(
                      task,
                      "planner",
                      async () =>
                        replanner.expandNode(
                          node,
                          snapshot?.title || "",
                          snapshot?.url || "",
                          replanReason,
                        ),
                    );
                    if (expandedNodes && expandedNodes.length > 0) {
                      this.appendHandoffArtifact(node, {
                        role: "planner",
                        phase: "planner_replan",
                        note:
                          staleSignalCount > 0
                            ? `Planner expanded node due to stale-signal retry: ${verification.reason}`
                            : `Planner expanded node due to drift/retry: ${verification.reason}`,
                      });
                      node.status = "completed";
                      node.result = `Replanned into ${expandedNodes.length} node(s): ${verification.reason}`;
                      task.nodes.push(...expandedNodes);
                      task.replansUsed += 1;

                      replanned = true;
                      logger.info(
                        "orchestrator",
                        "Node replanned after drift retry",
                        {
                          taskId: task.id,
                          nodeId: node.id,
                          expandedCount: expandedNodes.length,
                          replansUsed: task.replansUsed,
                          maxReplans: task.maxReplans,
                        },
                      );
                    }
                  } catch (error) {
                    if (isLaneIsolationError(error, "planner")) {
                      node.status = "failed";
                      node.error = appendRecentSideEffects(
                        `Planner lane isolated during replan: ${error instanceof Error ? error.message : String(error)}`,
                        result.sideEffectsLog,
                      );

                      replanned = true;
                      logger.warn(
                        "orchestrator",
                        "Planner lane isolated, failing node without retry",
                        {
                          taskId: task.id,
                          nodeId: node.id,
                          error,
                        },
                      );
                      this.sendMessage({
                        type: "AGENT_STEP",
                        workspaceId: task.workspaceId,
                        payload: {
                          step: {
                            id: crypto.randomUUID(),
                            type: "warning",
                            label: `Planner lane isolated for node ${node.id.slice(0, 6)}`,
                            detail: node.error,
                            status: "done",
                            timestamp: Date.now(),
                          },
                          update: false,
                        },
                      });
                    }
                    if (!replanned) {
                      logger.warn(
                        "orchestrator",
                        "Dynamic replanning failed; falling back to retry",
                        {
                          taskId: task.id,
                          nodeId: node.id,
                          error,
                        },
                      );
                    }
                  }
                }
              }
              if (replanned) {
                // Replacement nodes are now pending and scheduler will pick them up.
              } else {
                const retryDecision = decideRetryPolicy(
                  {
                    source: "verifier",
                    reason: verification.reason,
                    confidence: verificationConfidence,
                    failureType: verificationFailureType,
                    driftDetected,
                    staleSignalCount,
                  },
                  node.retries,
                );

                this.appendHandoffArtifact(node, {
                  role: "verifier",
                  phase:
                    verification.decision === "reroute"
                      ? "verifier_reroute"
                      : "verifier_retry",
                  note:
                    verification.decision === "reroute" &&
                    verification.rerouteObjective
                      ? `${verification.reason} Reroute: ${verification.rerouteObjective}`
                      : `${verification.reason} (${retryDecision.rationale})`,
                });

                if (retryDecision.shouldRetry) {
                  node.reflexionLog.push({
                    attempt: node.retries + 1,
                    executorSummary: result.summary || "No executor summary.",
                    verifierDecision:
                      verification.decision === "reroute" ? "reroute" : "retry",
                    verifierReason: verification.reason,
                    failureType: verification.failureType,
                    confidence: verification.confidence,
                    suggestedApproach: deriveSuggestedApproach(verification),
                    timestamp: Date.now(),
                  });
                  this.emitTraceEvent(
                    task,
                    "reflexion_recorded",
                    {
                      nodeId: node.id,
                      attempt: node.retries + 1,
                      verifierDecision:
                        verification.decision === "reroute"
                          ? "reroute"
                          : "retry",
                      failureType: verification.failureType,
                      confidence: verification.confidence,
                      reflexionCount: node.reflexionLog.length,
                    },
                    "verifier",
                  );
                  task.plannerReflexionLog.push({
                    nodeId: node.id,
                    verifierDecision:
                      verification.decision === "reroute" ? "reroute" : "retry",
                    failureType: verification.failureType,
                    executorSummary: result.summary || "No executor summary.",
                    plannerLesson: "",
                    timestamp: Date.now(),
                  });
                  this.emitTraceEvent(
                    task,
                    "cross_role_reflexion",
                    {
                      nodeId: node.id,
                      verifierDecision:
                        verification.decision === "reroute"
                          ? "reroute"
                          : "retry",
                    },
                    "verifier",
                  );
                  node.status = "pending";
                  node.retries += 1;
                  node.error = appendRecentSideEffects(
                    verification.reason,
                    result.sideEffectsLog,
                  );
                  if (
                    verification.decision === "reroute" &&
                    verification.rerouteObjective
                  ) {
                    node.description = verification.rerouteObjective;
                    if (node.handoffDepth >= MAX_HANDOFF_DEPTH) {
                      logger.warn(
                        "orchestrator",
                        "Reroute depth limit reached, falling back to retry",
                        {
                          taskId: task.id,
                          nodeId: node.id,
                          handoffDepth: node.handoffDepth,
                          maxHandoffDepth: MAX_HANDOFF_DEPTH,
                        },
                      );
                    }
                  }
                } else {
                  node.status = "failed";
                  node.error = appendRecentSideEffects(
                    `Verifier ${verification.decision}: ${verification.reason} (${retryDecision.rationale})`,
                    result.sideEffectsLog,
                  );
                }
              }
            } else {
              this.appendHandoffArtifact(node, {
                role: "verifier",
                phase:
                  verification.decision === "reroute"
                    ? "verifier_reroute"
                    : "verifier_retry",
                note: verification.reason,
              });
              node.status = "failed";
              node.error = appendRecentSideEffects(
                `Verifier ${verification.decision}: ${verification.reason}`,
                result.sideEffectsLog,
              );
            }
          } // end verification pipeline
        } else {
          const retryDecision = decideRetryPolicy(
            {
              source: "executor",
              errorMessage: result.summary,
            },
            node.retries,
          );
          if (retryDecision.shouldRetry && task.status === "running") {
            node.status = "pending";
            node.retries += 1;
            node.error = appendRecentSideEffects(
              `${result.summary} (${retryDecision.rationale})`,
              result.sideEffectsLog,
            );
          } else {
            node.status = "failed";
            node.error = appendRecentSideEffects(
              `${result.summary} (${retryDecision.rationale})`,
              result.sideEffectsLog,
            );
          }
        }
      } catch (error: any) {
        // Race-condition guard: the agent may have called done() just before
        // the lane timeout killed the worker. Check the loop's eagerly-set
        // completedResult — if present, treat as success instead of retrying.
        // This prevents duplicate actions (e.g. adding items to cart again).
        if (loop.completedResult) {
          logger.info(
            "orchestrator",
            "Worker timed out but done() was already called — accepting result",
            {
              taskId: task.id,
              nodeId: node.id,
              summary: loop.completedResult.summary.slice(0, 120),
            },
          );
          node.status = "completed";
          node.result = loop.completedResult.summary;
          return;
        }

        if (
          isLaneIsolationError(error, "executor") ||
          isLaneIsolationError(error, "verifier") ||
          isLaneIsolationError(error, "planner")
        ) {
          node.status = "failed";
          node.error = `Critical lane isolation while executing node: ${error?.message || String(error)}`;
          logger.warn("orchestrator", "Failing node due to lane isolation", {
            taskId: task.id,
            nodeId: node.id,
            error,
          });
          return;
        }
        const retryDecision = decideRetryPolicy(
          {
            source: "system",
            errorMessage: error?.message || String(error),
          },
          node.retries,
        );
        if (retryDecision.shouldRetry && task.status === "running") {
          node.status = "pending";
          node.retries += 1;
          node.error = `${error?.message || String(error)} (${retryDecision.rationale})`;
        } else {
          node.status = "failed";
          node.error = `${error?.message || String(error)} (${retryDecision.rationale})`;
        }
      } finally {
        this.emitTraceEvent(
          task,
          "node_completed",
          {
            nodeId: node.id,
            outcome: node.status,
            summary: (node.result || node.error || "").slice(0, 300),
            retries: node.retries,
            durationMs: Date.now() - nodeStartMs,
          },
          "executor",
        );
        const wsPools = this.getWorkspaceLanePools(task.workspaceId);
        wsPools.executor.delete(workerId);
        logger.debug(
          "orchestrator",
          "Executor worker released from lane pool",
          {
            taskId: task.id,
            workspaceId: task.workspaceId,
            workerId,
            nodeId: node.id,
            lane: "executor",
            activeExecutorWorkers: wsPools.executor.size,
          },
        );
        task.currentIndex = currentIndex(task.nodes);
        this.sendProgress(task);
        await this.persistTaskCheckpoint(task);
      }
    };

    while (task.status === "running") {
      if (task.pendingInteraction && !this.isPendingInteractionResolved(task.pendingInteraction)) {
        this.sendStatus(task.workspaceId, AgentStatus.PAUSED, "Awaiting user input...");
        await this.persistTaskCheckpoint(task);
        return;
      }
      const runnable = getRunnablePendingNodes(task.nodes);
      const executorMaxConcurrent = this.getLaneRuntimeState(
        task.workspaceId,
        "executor",
      ).policy.maxConcurrent;
      const schedulerConcurrency = Math.max(
        1,
        Math.min(task.maxWorkers, executorMaxConcurrent),
      );
      logger.debug("orchestrator", "Scheduler cycle", {
        taskId: task.id,
        pending: task.nodes.filter((n) => n.status === "pending").length,
        running: running.size,
        completed: task.nodes.filter((n) => n.status === "completed").length,
        failed: task.nodes.filter((n) => n.status === "failed").length,
        runnable: runnable.length,
        schedulerConcurrency,
      });

      // Global goal gate: if a node just completed and the final node's
      // success criteria are already satisfied on the page, skip remaining nodes.
      const completedNodes = task.nodes.filter((n) => n.status === "completed");
      const remainingPending = task.nodes.filter((n) => n.status === "pending");
      // Only allow skipping when at most 1 node remains pending.
      // Prevents premature skipping after early steps when most work is still ahead.
      if (remainingPending.length === 1 && completedNodes.length > 0) {
        const finalNode = task.nodes[task.nodes.length - 1];
        if (finalNode.status === "pending" && finalNode.successCriteria) {
          try {
            const goalSnap = await this.getSnapshot(input.tabId);
            if (goalSnap) {
              const goalCheck = matchSuccessCriteria({
                successCriteria: finalNode.successCriteria,
                snapshot: goalSnap,
              });
              const contract = buildTaskContract(task.query);
              const coverageCorpus = [
                goalSnap.title,
                goalSnap.url,
                goalSnap.visibleContent,
                goalSnap.pageContent,
                ...completedNodes.map((node) => node.result || ""),
                summaryOfCompletedNodes(completedNodes),
              ]
                .filter(Boolean)
                .join("\n");
              const contractCoverage = assessTaskContractCoverage({
                contract,
                text: coverageCorpus,
                requireReturnTarget: contract.requiresRoundTrip,
              });
              const allowGlobalShortcut =
                !contract.requiresRoundTrip &&
                contract.reportTargets.length <= 1 &&
                contract.requiredEntities.length <= 1 &&
                contract.requiredNumbers.length === 0 &&
                !remainingPending.some((node) => isActionOrMutationNode(node));
              if (
                allowGlobalShortcut &&
                goalCheck.satisfied &&
                goalCheck.matchedTokens.length >= 2 &&
                contractCoverage.satisfied
              ) {
                logger.info(
                  "orchestrator",
                  "Global goal already met, skipping remaining nodes",
                  {
                    taskId: task.id,
                    matchedTokens: goalCheck.matchedTokens,
                    totalTokens: goalCheck.totalTokens,
                    remainingNodes: remainingPending.length,
                  },
                );
                for (const pending of remainingPending) {
                  pending.status = "skipped";
                  pending.result = "Skipped: global goal already achieved";
                }
                this.emitTraceEvent(
                  task,
                  "global_goal_gate",
                  {
                    matchedTokens: goalCheck.matchedTokens,
                    skippedNodes: remainingPending.length,
                  },
                  "system",
                );
                break;
              } else if (goalCheck.satisfied && !allowGlobalShortcut) {
                logger.debug(
                  "orchestrator",
                  "Global goal shortcut blocked by multi-obligation task contract",
                  {
                    taskId: task.id,
                    matchedTokens: goalCheck.matchedTokens,
                    requiresRoundTrip: contract.requiresRoundTrip,
                    reportTargetCount: contract.reportTargets.length,
                    requiredEntityCount: contract.requiredEntities.length,
                    requiredNumberCount: contract.requiredNumbers.length,
                  },
                );
              } else if (goalCheck.satisfied && !contractCoverage.satisfied) {
                logger.debug(
                  "orchestrator",
                  "Global goal shortcut blocked by task contract coverage",
                  {
                    taskId: task.id,
                    matchedTokens: goalCheck.matchedTokens,
                    missingEntities: contractCoverage.missingEntities,
                    missingNumbers: contractCoverage.missingNumbers,
                    missingReturnTarget: contractCoverage.missingReturnTarget,
                  },
                );
              }
            }
          } catch (err) {
            // Snapshot failure is non-fatal — continue normal scheduling
            logger.debug("orchestrator", "Global goal gate snapshot failed", {
              taskId: task.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      // Emit budget_warning at 80% thresholds (at most once per metric)
      const elapsedMs = Date.now() - (task.startedAt || task.createdAt);
      const timeRatio = elapsedMs / task.budget.maxSessionTimeMs;
      const tokenRatio =
        task.sessionMetrics.totalTokens / task.budget.maxTotalTokens;
      const costRatio =
        task.sessionMetrics.totalCost / task.budget.maxTotalCostUsd;
      if (timeRatio >= 0.8 && !budgetWarningsEmitted.has("time")) {
        budgetWarningsEmitted.add("time");
        this.emitTraceEvent(
          task,
          "budget_warning",
          {
            metric: "time",
            ratio: timeRatio,
            totalTokens: task.sessionMetrics.totalTokens,
            totalCost: task.sessionMetrics.totalCost,
            elapsedMs,
          },
          "system",
        );
      }
      if (tokenRatio >= 0.8 && !budgetWarningsEmitted.has("tokens")) {
        budgetWarningsEmitted.add("tokens");
        this.emitTraceEvent(
          task,
          "budget_warning",
          {
            metric: "tokens",
            ratio: tokenRatio,
            totalTokens: task.sessionMetrics.totalTokens,
            totalCost: task.sessionMetrics.totalCost,
            elapsedMs,
          },
          "system",
        );
      }
      if (costRatio >= 0.8 && !budgetWarningsEmitted.has("cost")) {
        budgetWarningsEmitted.add("cost");
        this.emitTraceEvent(
          task,
          "budget_warning",
          {
            metric: "cost",
            ratio: costRatio,
            totalTokens: task.sessionMetrics.totalTokens,
            totalCost: task.sessionMetrics.totalCost,
            elapsedMs,
          },
          "system",
        );
      }

      const budgetReason = getBudgetExhaustionReason();
      if (budgetReason) {
        applyBudgetTermination(budgetReason);
        break;
      }

      if (
        running.size === 0 &&
        runnable.length > 0 &&
        this.isLaneIsolated(
          this.getLaneRuntimeState(task.workspaceId, "executor"),
        )
      ) {
        const executorLaneState = this.getLaneRuntimeState(
          task.workspaceId,
          "executor",
        );
        const reason =
          `Executor lane isolated until ${new Date(executorLaneState.isolatedUntilMs).toISOString()} ` +
          `(lastError=${executorLaneState.lastError || "unknown"})`;
        logger.warn(
          "orchestrator",
          "Executor lane isolation blocked scheduler",
          {
            taskId: task.id,
            workspaceId: task.workspaceId,
            reason,
            runnableNodeIds: runnable.map((node) => node.id),
          },
        );
        for (const node of runnable) {
          node.status = "failed";
          node.error = reason;
        }
        break;
      }

      while (runnable.length > 0 && running.size < schedulerConcurrency) {
        const node = runnable.shift()!;
        const tracked = launchWorker(node);
        running.add(tracked);
        tracked.finally(() => running.delete(tracked));
      }

      if (running.size > 0) {
        await Promise.race(running);
        continue;
      }

      const pendingNodes = task.nodes.filter((n) => n.status === "pending");
      if (pendingNodes.length === 0) {
        const expanded = await this.tryHorizonExpansion(
          task,
          input,
          replanner as OrchestratorPlanner,
          getBudgetExhaustionReason,
        );
        if (expanded) continue;
        break;
      }

      const nodesById = new Map<string, TaskNode>(
        task.nodes.map((n) => [n.id, n]),
      );
      for (const blockedNode of pendingNodes) {
        const depState = getDependencyState(blockedNode, nodesById);
        if (depState.ready || depState.waitingOn.length > 0) continue;
        blockedNode.status = "failed";
        blockedNode.error =
          depState.failedDeps.length > 0
            ? `Blocked by failed dependencies: ${depState.failedDeps.join(", ")}`
            : `Blocked by missing dependencies: ${depState.missingDeps.join(", ")}`;
        logger.warn(
          "orchestrator",
          "Node failed due to unsatisfiable dependencies",
          {
            taskId: task.id,
            nodeId: blockedNode.id,
            failedDeps: depState.failedDeps,
            missingDeps: depState.missingDeps,
            dependencies: blockedNode.dependencies,
          },
        );
      }

      if (task.nodes.some((n) => n.status === "failed")) {
        break;
      }

      logger.warn("orchestrator", "Scheduler deadlock detected", {
        taskId: task.id,
        pendingNodeIds: pendingNodes.map((n) => n.id),
      });
      break;
    }

    if (task.status === "stopped") {
      task.finishedAt = Date.now();
      this.sendTerminationCompletion(task, "Stopped by user during execution");
      await this.closeWorkerTabs(task);
      this.tasksByWorkspace.delete(task.workspaceId);
      this.cleanupWorkspaceRuntime(task.workspaceId);
      await this.clearTaskCheckpoint(task.workspaceId);
      this.emitTraceEvent(
        task,
        "task_stopped",
        { taskId: task.id, phase: "execution" },
        "system",
      );
      this.sendStatus(task.workspaceId, AgentStatus.IDLE, "Stopped");
      resetTabGroupAppearance(task.workspaceId);
      return;
    }

    const completed = task.nodes.filter((n) => n.status === "completed").length;
    const skipped = task.nodes.filter((n) => isUserSkippedNode(n)).length;
    const failed = task.nodes.filter(
      (n) => n.status === "failed" && !isUserSkippedNode(n),
    ).length;
    task.finishedAt = Date.now();
    task.sessionMetrics.totalSessionTimeMs =
      task.finishedAt - (task.startedAt || task.createdAt);
    task.status = failed > 0 ? "failed" : "completed";

    // Build summary and replace any accumulated reasoning with the clean result.
    // Uses replaceContent to ensure a single clean bubble regardless of what was
    // streamed during execution (intermediate reasoning, tool output, etc.).
    const summary = this.buildProgrammaticSummary(task);
    if (summary && !task._streamHasContent) {
      this.sendMessage({
        type: "STREAM_CHUNK",
        workspaceId: task.workspaceId,
        payload: { delta: "", done: false, replaceContent: summary },
      });
    }
    this.sendMessage({
      type: "STREAM_CHUNK",
      workspaceId: task.workspaceId,
      payload: { delta: "", done: true },
    });

    const subtaskResults = this.buildSubtaskResults(task);
    const penalizedSkipped = task.nodes.filter(
      (node) => node.status === "skipped" && !isGlobalGoalShortcutSkip(node),
    ).length;

    let completionStatus: "completed" | "partial" | "failed" =
      failed > 0
        ? completed > 0 || penalizedSkipped > 0
          ? "partial"
          : "failed"
        : penalizedSkipped > 0
          ? "partial"
          : "completed";

    const contract = buildTaskContract(task.query);
    // Entity/number coverage uses all node descriptions + results
    const coverageCorpus = [
      summary,
      ...subtaskResults.map(
        (item) => `${item.description}\n${item.result || ""}`,
      ),
    ].join("\n");
    // Return-target coverage must only check actual execution results
    // (not plan descriptions), otherwise a planned-but-unexecuted
    // "Return to X" node would falsely satisfy the return check.
    const returnTargetCorpus = contract.requiresRoundTrip
      ? [
          summary,
          ...subtaskResults
            .filter((item) => item.status === "completed" && item.result)
            .map((item) => item.result),
        ].join("\n")
      : coverageCorpus;
    const coverage = assessTaskContractCoverage({
      contract,
      text: coverageCorpus,
    });
    // Separate return-target check against results-only corpus
    if (contract.requiresRoundTrip) {
      const returnCoverage = assessTaskContractCoverage({
        contract: {
          ...contract,
          requiredEntities: [],
          requiredNumbers: [],
        },
        text: returnTargetCorpus,
        requireReturnTarget: true,
      });
      if (returnCoverage.missingReturnTarget) {
        coverage.missingReturnTarget = true;
        coverage.satisfied = false;
      }
    }
    if (completionStatus === "completed" && !coverage.satisfied) {
      completionStatus = "partial";
      const missingParts: string[] = [];
      if (coverage.missingEntities.length > 0) {
        missingParts.push(
          `missing entities: ${coverage.missingEntities.join(", ")}`,
        );
      }
      if (coverage.missingNumbers.length > 0) {
        missingParts.push(
          `missing values: ${coverage.missingNumbers.join(", ")}`,
        );
      }
      if (coverage.missingReturnTarget) {
        missingParts.push("missing return-to target evidence");
      }
      if (coverage.missingExhaustiveCoverage) {
        missingParts.push("missing exhaustive coverage evidence");
      }
      if (coverage.missingMultiReturnCoverage) {
        missingParts.push("missing required multi-result coverage");
      }
      task.terminationReason =
        task.terminationReason ||
        (missingParts.length > 0
          ? `Task contract incomplete: ${missingParts.join("; ")}`
          : "Task contract incomplete");
    }

    const completionPayload: TaskCompletionMessage["payload"] = {
      taskId: task.id,
      status: completionStatus,
      totalTurnsUsed: 0,
      totalTimeMs: task.finishedAt - (task.startedAt || task.createdAt),
      summary,
      subtaskResults,
      urlHistory: [],
      metrics: task.sessionMetrics,
      terminationReason: task.terminationReason,
    };
    this.cacheAndPersistCompletion(task.workspaceId, completionPayload);
    await this.persistWorkspaceTurnMemory(task, completionPayload);
    this.sendMessage({
      type: "TASK_COMPLETION",
      workspaceId: task.workspaceId,
      payload: completionPayload,
    });
    const totalDurationMs =
      task.finishedAt - (task.startedAt || task.createdAt);
    this.emitTraceEvent(
      task,
      "task_completed",
      {
        taskId: task.id,
        completionStatus,
        completed,
        failed,
        skipped,
        totalDurationMs,
        totalTokens: task.sessionMetrics.totalTokens,
        totalCostUsd: task.sessionMetrics.totalCost,
        terminationReason: task.terminationReason ?? null,
      },
      "system",
    );

    this.sendStatus(
      task.workspaceId,
      AgentStatus.IDLE,
      "Task complete",
      completionStatus,
    );
    await this.closeWorkerTabs(task);
    this.tasksByWorkspace.delete(task.workspaceId);
    this.cleanupWorkspaceRuntime(task.workspaceId);
    await this.clearTaskCheckpoint(task.workspaceId);
  }

  /** Get the outcome of the most recently completed task for a workspace. */
  getRecentOutcome(
    workspaceId: string,
  ): "completed" | "failed" | "stopped" | null {
    const task = this.tasksByWorkspace.get(workspaceId);
    if (task?.status === "stopped") return "stopped";
    const recent = this.recentCompletion.get(workspaceId);
    if (!recent) return null;
    // "partial" maps to "completed" — partial success is still success at the overlay level
    return recent.payload.status === "failed" ? "failed" : "completed";
  }

  waitForTaskCompletion(
    workspaceId: string,
    timeoutMs = 60 * 60 * 1000,
  ): Promise<TaskCompletionMessage["payload"] | null> {
    const hasActiveTask = this.tasksByWorkspace.has(workspaceId);
    if (!hasActiveTask) {
      const cached = this.recentCompletion.get(workspaceId);
      return Promise.resolve(cached?.payload ?? null);
    }

    return new Promise((resolve) => {
      const listeners =
        this.completionWaiters.get(workspaceId) ?? new Set();
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const handleCompletion = (payload: TaskCompletionMessage["payload"]) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        listeners.delete(handleCompletion);
        if (listeners.size === 0) {
          this.completionWaiters.delete(workspaceId);
        }
        resolve(payload);
      };

      listeners.add(handleCompletion);
      this.completionWaiters.set(workspaceId, listeners);
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        listeners.delete(handleCompletion);
        if (listeners.size === 0) {
          this.completionWaiters.delete(workspaceId);
        }
        resolve(null);
      }, timeoutMs);
      timer.unref?.();
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
    if (!workers) return;
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
      worker.loop.stop();
      workers?.delete(worker.workerId);
    }

    targetNode.status = "skipped";
    targetNode.error = "Skipped by user from Plan Board.";
    this.appendHandoffArtifact(targetNode, {
      role: "planner",
      phase: "planner_replan",
      note: "Skipped by user from Plan Board.",
    });

    task.currentIndex = currentIndex(task.nodes);
    this.sendProgress(task);
    this.sendMessage({
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

  private async stopWorkspace(workspaceId: string): Promise<void> {
    const task = this.tasksByWorkspace.get(workspaceId);
    if (!task) return;
    this.emitTraceEvent(
      task,
      "task_stop_requested",
      {
        taskId: task.id,
        workspaceId,
      },
      "system",
    );
    task.status = "stopped";
    task.finishedAt = Date.now();
    this.clearPendingInteractionTimer(workspaceId);
    task.pendingInteraction = undefined;
    const pendingEscalationId = task.pendingEscalation?.packet.escalationId;
    if (pendingEscalationId) {
      this.pendingEscalationResolvers.delete(pendingEscalationId);
      task.pendingEscalation = undefined;
    }
    // Cancel any pending plan confirmation
    for (const [id, resolver] of this.pendingPlanConfirmationResolvers) {
      resolver({ decision: "cancel" });
      this.pendingPlanConfirmationResolvers.delete(id);
    }
    if (task.nodes.length > 0) {
      await this.sendTerminationCompletion(task, "Stopped by user");
    }
    void this.closeWorkerTabs(task);
    void this.persistTaskCheckpoint(task);
    const pools = this.workersByWorkspace.get(workspaceId);
    const workers = pools?.executor;
    for (const worker of workers?.values() || []) {
      worker.loop.stop();
    }
    workers?.clear();
    pools?.planner.clear();
    pools?.verifier.clear();
    // Immediately notify side panel so the indicator clears without waiting
    // for runTask's scheduling loop to detect the stopped status.
    this.sendStatus(workspaceId, AgentStatus.IDLE, "Stopped");
    resetTabGroupAppearance(workspaceId);
  }

  private pauseWorkspace(workspaceId: string): void {
    const workers = this.workersByWorkspace.get(workspaceId)?.executor;
    for (const worker of workers?.values() || []) {
      worker.loop.pause();
    }
    this.sendStatus(workspaceId, AgentStatus.PAUSED, "Paused by user");
  }

  private resumeWorkspace(workspaceId: string): void {
    const workers = this.workersByWorkspace.get(workspaceId)?.executor;
    for (const worker of workers?.values() || []) {
      worker.loop.resume();
    }
    this.sendStatus(workspaceId, AgentStatus.ACTING, "Resumed");
  }

  private async createWorkerTab(
    url: string,
    workspaceId: string,
  ): Promise<number> {
    const tab = await chrome.tabs.create({ url, active: false });
    if (!tab.id) throw new Error("Failed to create worker tab");
    await this.deps.workspaceManager.addTabToWorkspace(tab.id, workspaceId);
    return tab.id;
  }

  private async closeWorkerTabs(task: OrchestratorTask): Promise<void> {
    for (const tabId of task.createdWorkerTabIds ?? []) {
      if (tabId === task.rootTabId) continue;
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* tab already closed */
      }
    }
  }

  private async getSnapshot(tabId: number): Promise<any | undefined> {
    try {
      try {
        const manifest = chrome.runtime.getManifest();
        const contentScriptPath = manifest.content_scripts?.[0]?.js?.[0];
        if (contentScriptPath) {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: [contentScriptPath],
          });
        }
      } catch {
        // no-op — content script may already be injected
      }
      await this.deps.waitForContentScriptReady(tabId, 3000);
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "DOM_SNAPSHOT_REQUEST",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: { refresh: true, autoDismiss: false },
      });
      return response.payload.snapshot;
    } catch (err) {
      logger.warn(
        "orchestrator",
        "getSnapshot failed — executor will fetch its own",
        {
          tabId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return undefined;
    }
  }

  private buildProgrammaticSummary(task: OrchestratorTask): string {
    const completedNodes = task.nodes.filter((n) => n.status === "completed");
    const failed = task.nodes.filter((n) => n.status === "failed").length;
    const lastCompleted = [...task.nodes]
      .reverse()
      .find((n) => n.status === "completed");
    const lastFailed = [...task.nodes]
      .reverse()
      .find((n) => n.status === "failed" && (n.error || "").trim().length > 0);

    // Single-node completed: show executor's actual output directly
    if (
      task.planClassification?.isSingleNode &&
      failed === 0 &&
      lastCompleted?.result
    ) {
      return lastCompleted.result;
    }

    // Multi-node completed: aggregate results from all completed nodes.
    // Each node may have collected data that the final summary needs
    // (e.g. "read inventory on page A, go back, read inventory on page B,
    // report both"). Only the combined results satisfy the full task.
    if (completedNodes.length > 1 && lastCompleted?.result) {
      const nodeResults = completedNodes
        .filter((n) => n.result && n.result.trim())
        .map((n) => n.result!.trim());

      // If the last node's result already covers all prior results
      // (e.g. it explicitly mentions all key data), use it alone.
      // Otherwise combine all unique node results.
      const lastResult = lastCompleted.result;
      const priorResults = nodeResults.slice(0, -1);
      const missingPrior = priorResults.filter(
        (r) => !lastResult.includes(r.slice(0, 40)),
      );

      if (missingPrior.length > 0) {
        return nodeResults.join("\n\n");
      }
      return lastResult;
    }

    if (completedNodes.length > 0 && lastCompleted?.result) {
      return lastCompleted.result;
    }

    if (failed > 0 && lastFailed?.error) {
      return lastFailed.error;
    }

    return "";
  }

  private async tryHorizonExpansion(
    task: OrchestratorTask,
    input: OrchestratorStartInput,
    replanner: OrchestratorPlanner,
    getBudgetExhaustionReason: () => string | null,
  ): Promise<boolean> {
    if (task.planClassification?.isSingleNode) return false;
    if (task.horizonExpansions >= MAX_HORIZON_EXPANSIONS) return false;

    const completedNodes = task.nodes.filter((n) => n.status === "completed");
    if (completedNodes.length === 0) return false;

    // All nodes completed — goal achieved, no expansion needed
    if (task.nodes.every((n) => n.status === "completed")) return false;

    // Check budget near exhaustion (>90%)
    const elapsedMs = Date.now() - (task.startedAt || task.createdAt);
    const timeRatio = elapsedMs / task.budget.maxSessionTimeMs;
    const tokenRatio =
      task.sessionMetrics.totalTokens / task.budget.maxTotalTokens;
    const costRatio =
      task.sessionMetrics.totalCost / task.budget.maxTotalCostUsd;
    if (timeRatio >= 0.9 || tokenRatio >= 0.9 || costRatio >= 0.9) return false;

    if (getBudgetExhaustionReason()) return false;

    let pageTitle = "Untitled";
    let pageUrl = "";
    try {
      const tab = await chrome.tabs.get(task.rootTabId);
      pageTitle = tab.title || "Untitled";
      pageUrl = tab.url || "";
    } catch {
      // Tab may have been closed
      return false;
    }

    const summary = buildCompletedStepsSummary(task.nodes);

    let newNodes: TaskNode[] | null = null;
    try {
      newNodes = await this.runInLane(task, "planner", async () =>
        replanner.planNextHorizon(task.query, summary, pageTitle, pageUrl),
      );
    } catch (error: any) {
      logger.warn("orchestrator", "Horizon expansion planner call failed", {
        taskId: task.id,
        error: error?.message,
      });
      return false;
    }

    if (!newNodes || newNodes.length === 0) return false;

    // Set first new node's dependency on the last completed node
    const lastCompletedId = completedNodes[completedNodes.length - 1].id;
    if (newNodes[0].dependencies.length === 0) {
      newNodes[0].dependencies = [lastCompletedId];
    }

    task.nodes.push(...newNodes);
    task.horizonExpansions++;
    task.currentIndex = currentIndex(task.nodes);
    this.sendProgress(task);
    await this.persistTaskCheckpoint(task);

    this.emitTraceEvent(
      task,
      "horizon_expansion",
      {
        taskId: task.id,
        expansionNumber: task.horizonExpansions,
        newNodeCount: newNodes.length,
        totalNodes: task.nodes.length,
      },
      "planner",
    );

    logger.info("orchestrator", "Horizon expansion added new nodes", {
      taskId: task.id,
      expansionNumber: task.horizonExpansions,
      newNodeCount: newNodes.length,
      totalNodes: task.nodes.length,
    });

    return true;
  }

  private sendProgress(task: OrchestratorTask): void {
    this.sendMessage({
      type: "TASK_PROGRESS",
      workspaceId: task.workspaceId,
      payload: {
        taskId: task.id,
        subtasks: toSubtasks(task.nodes),
        currentIndex: task.currentIndex,
        totalTurnsUsed: 0,
      },
    });
  }

  /**
   * Cache a completion payload for later resync and persist the summary
   * directly to chat storage so it survives side-panel death.
   */
  private cacheAndPersistCompletion(
    workspaceId: string,
    payload: TaskCompletionMessage["payload"],
  ): void {
    // Cache for resync on panel reopen
    this.recentCompletion.set(workspaceId, {
      payload,
      timestamp: Date.now(),
    });
    const waiters = this.completionWaiters.get(workspaceId);
    if (waiters) {
      for (const resolve of waiters) resolve(payload);
      this.completionWaiters.delete(workspaceId);
    }

    // Persist summary as a chat message directly to storage (bypasses panel)
    if (payload.summary) {
      const storageKey = `chatMessages:${workspaceId}`;
      chrome.storage.local
        .get(storageKey)
        .then((result) => {
          const messages: any[] = result[storageKey] ?? [];
          messages.push({
            id: crypto.randomUUID(),
            role: "assistant",
            content: payload.summary,
            timestamp: Date.now(),
            toolCalls: [],
            isStreaming: false,
          });
          const trimmed =
            messages.length > MAX_PERSISTED_MESSAGES
              ? messages.slice(-MAX_PERSISTED_MESSAGES)
              : messages;
          return chrome.storage.local.set({ [storageKey]: trimmed });
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

  private async persistWorkspaceTurnMemory(
    task: OrchestratorTask,
    payload: TaskCompletionMessage["payload"],
  ): Promise<void> {
    try {
      let finalUrl: string | null = null;
      try {
        const tab = await chrome.tabs.get(task.rootTabId);
        finalUrl = tab.url ?? null;
      } catch {
        finalUrl = null;
      }
      await saveWorkspaceTurnRecord(
        buildWorkspaceTurnRecord({
          workspaceId: task.workspaceId,
          taskId: task.id,
          userQuery: task.query,
          completion: payload,
          completedAt: task.finishedAt ?? Date.now(),
          turnNumber: task.turnNumber ?? 1,
          finalUrl,
        }),
      );

      // Long-term memory via backend/GBrain (fire-and-forget)
      postMemory({
        category: "execution-result",
        title: `${payload.status}: ${task.query.slice(0, 80)}`,
        content: [
          `User request: ${task.query}`,
          `Outcome: ${payload.status}`,
          `Summary: ${payload.summary}`,
          finalUrl ? `Final URL: ${finalUrl}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        workspaceId: task.workspaceId,
        metadata: { taskId: task.id, outcome: payload.status },
      }).catch(() => {});

      // Site-specific knowledge extraction (fire-and-forget)
      this.extractAndStoreSiteKnowledge(task, payload, finalUrl).catch(() => {});
    } catch (error) {
      logger.debug("orchestrator", "Failed to persist workspace turn memory", {
        error,
        workspaceId: task.workspaceId,
        taskId: task.id,
      });
    }
  }

  private async extractAndStoreSiteKnowledge(
    task: OrchestratorTask,
    payload: TaskCompletionMessage["payload"],
    finalUrl: string | null,
  ): Promise<void> {
    const domain = extractDomain(finalUrl || "");
    if (!domain) return;

    const context = buildExtractionContext(task, payload, finalUrl);

    // Try LLM extraction, fall back to rule-based
    let entries: SiteKnowledgeEntry[];
    try {
      const settings = await loadSettings();
      if (!settings) throw new Error("no settings");
      const mode = settings.providerMode ?? "fireworks";
      const activeKey =
        mode === "fireworks" ? settings.fireworksApiKey :
        mode === "openai-groq" ? settings.openaiApiKey :
        settings.openRouterApiKey;
      if (!activeKey) throw new Error("no api key");

      const client = new LLMClient(activeKey, {
        providerMode: mode,
        fireworksApiKey: settings.fireworksApiKey,
      });
      entries = await extractSiteKnowledgeLLM(context, domain, client);
    } catch {
      entries = extractSiteKnowledgeFallback(task, payload, domain);
    }

    for (const entry of entries) {
      postMemory({
        category: "site-knowledge",
        title: `${entry.domain}: ${entry.tip.slice(0, 60)}`,
        content: entry.tip,
        workspaceId: task.workspaceId,
        metadata: {
          domain: entry.domain,
          tipType: entry.tipType,
          confidence: entry.confidence,
          taskId: task.id,
        },
      }).catch(() => {});
    }

    if (entries.length > 0) {
      logger.info("orchestrator", "Extracted site knowledge", {
        domain,
        count: entries.length,
        tips: entries.map((e) => e.tip.slice(0, 50)),
      });
    }
  }

  private buildSubtaskResults(task: OrchestratorTask): SubtaskResult[] {
    return task.nodes.map((node) => ({
      description: node.description,
      status:
        node.status === "completed"
          ? "completed"
          : isUserSkippedNode(node)
            ? "skipped"
            : "failed",
      turnsUsed: 0,
      result: node.result || node.error || "",
    }));
  }

  private async sendTerminationCompletion(
    task: OrchestratorTask,
    terminationReason: string,
  ): Promise<void> {
    // Finalize the stream first so the side panel exits isStreaming state.
    // Without this, the UI stays stuck showing "Thinking..." after a stop.
    this.sendMessage({
      type: "STREAM_CHUNK",
      workspaceId: task.workspaceId,
      payload: { delta: "", done: true },
    });

    const subtaskResults = this.buildSubtaskResults(task);
    const completed = subtaskResults.filter(
      (r) => r.status === "completed",
    ).length;

    const completionPayload: TaskCompletionMessage["payload"] = {
      taskId: task.id,
      status: completed > 0 ? "partial" : "failed",
      totalTurnsUsed: 0,
      totalTimeMs:
        (task.finishedAt || Date.now()) - (task.startedAt || task.createdAt),
      summary: terminationReason,
      subtaskResults,
      urlHistory: [],
      metrics: task.sessionMetrics,
      terminationReason,
    };
    this.cacheAndPersistCompletion(task.workspaceId, completionPayload);
    await this.persistWorkspaceTurnMemory(task, completionPayload);
    this.sendMessage({
      type: "TASK_COMPLETION",
      workspaceId: task.workspaceId,
      payload: completionPayload,
    });
  }

  private emitVerifierStep(
    workspaceId: string,
    nodeId: string,
    reason: string,
  ): void {
    const step: AgentStep = {
      id: crypto.randomUUID(),
      type: "info",
      label: `Verifier: checked node ${nodeId.slice(0, 6)}`,
      detail: reason,
      status: "done",
      timestamp: Date.now(),
    };
    this.sendMessage({
      type: "AGENT_STEP",
      workspaceId,
      payload: { step, update: false },
    });
  }

  private classifyEscalationRisk(
    verification: NodeVerificationResult,
    node: TaskNode,
  ): EscalationRisk {
    if (verification.failureType === "blocked") return "critical";
    if (verification.decision === "reroute") return "high";
    if (node.retries >= 2) return "high";
    return "medium";
  }

  private shouldEscalateForDecision(
    task: OrchestratorTask,
    node: TaskNode,
    verification: NodeVerificationResult,
  ): boolean {
    const confidence = clampConfidence(verification.confidence);
    const tokenRatio =
      task.budget.maxTotalTokens > 0
        ? task.sessionMetrics.totalTokens / task.budget.maxTotalTokens
        : 0;
    const costRatio =
      task.budget.maxTotalCostUsd > 0
        ? task.sessionMetrics.totalCost / task.budget.maxTotalCostUsd
        : 0;
    if (verification.failureType === "blocked") return true;
    if (verification.decision !== "accept" && confidence < 0.45) return true;
    if (verification.decision !== "accept" && node.retries >= 2) return true;
    if (
      verification.decision !== "accept" &&
      (tokenRatio >= 0.85 || costRatio >= 0.85)
    ) {
      return true;
    }
    return false;
  }

  private buildEscalationPacket(input: {
    task: OrchestratorTask;
    node: TaskNode;
    verification: NodeVerificationResult;
    snapshot?: { title?: string; url?: string };
  }): EscalationPacket {
    const { task, node, verification, snapshot } = input;
    const risk = this.classifyEscalationRisk(verification, node);
    const reason = verification.reason.slice(0, ESCALATION_MAX_REASON_CHARS);
    const options: EscalationOption[] = [
      {
        id: "approve_continue",
        label: "Continue",
        impact: "Proceed with orchestrator retry policy.",
      },
      {
        id: "reroute_with_option",
        label: "Reroute",
        impact: "Retry with an alternate objective suggested by verifier.",
        rerouteObjective:
          verification.rerouteObjective ||
          `Use an alternate path to complete: ${node.description}`,
      },
      {
        id: "skip_node",
        label: "Skip Node",
        impact: "Mark this node as skipped and continue remaining graph.",
      },
      {
        id: "stop_task",
        label: "Stop Task",
        impact: "Stop task execution immediately.",
      },
    ];
    const recommendedOption: EscalationOptionId =
      risk === "critical"
        ? "stop_task"
        : verification.decision === "reroute"
          ? "reroute_with_option"
          : "approve_continue";

    const elapsedMs = Date.now() - (task.startedAt || task.createdAt);
    return {
      escalationId: crypto.randomUUID(),
      taskId: task.id,
      workspaceId: task.workspaceId,
      nodeId: node.id,
      risk,
      confidence: clampConfidence(verification.confidence),
      reason,
      options,
      recommendedOption,
      snapshotSummary:
        `${snapshot?.title || "Unknown page"} | ${snapshot?.url || "unknown-url"}`.slice(
          0,
          240,
        ),
      lastActions: node.handoffArtifacts
        .slice(-5)
        .map((entry) => `${entry.role}/${entry.phase}: ${entry.note}`)
        .map((entry) => entry.slice(0, 180)),
      budgetState: {
        elapsedMs,
        maxSessionTimeMs: task.budget.maxSessionTimeMs,
        totalTokens: task.sessionMetrics.totalTokens,
        maxTotalTokens: task.budget.maxTotalTokens,
        totalCostUsd: task.sessionMetrics.totalCost,
        maxTotalCostUsd: task.budget.maxTotalCostUsd,
      },
      timeoutMs: ESCALATION_RESPONSE_TIMEOUT_MS,
      timestamp: Date.now(),
    };
  }

  private async requestEscalationDecision(
    task: OrchestratorTask,
    packet: EscalationPacket,
  ): Promise<EscalationDecisionPayload> {
    if (
      task.pendingEscalation?.packet.escalationId === packet.escalationId &&
      task.pendingEscalation.selectedOption
    ) {
      logger.info("orchestrator", "Using checkpointed escalation decision", {
        taskId: task.id,
        nodeId: packet.nodeId,
        escalationId: packet.escalationId,
        optionId: task.pendingEscalation.selectedOption.optionId,
      });
      return task.pendingEscalation.selectedOption;
    }

    task.pendingEscalation = { packet };
    await this.persistTaskCheckpoint(task);

    logger.warn("orchestrator", "Escalation packet created", {
      taskId: task.id,
      nodeId: packet.nodeId,
      escalationId: packet.escalationId,
      risk: packet.risk,
      recommendedOption: packet.recommendedOption,
      reason: packet.reason,
    });
    this.emitTraceEvent(
      task,
      "escalation_requested",
      {
        taskId: task.id,
        nodeId: packet.nodeId,
        escalationId: packet.escalationId,
        risk: packet.risk,
        recommendedOption: packet.recommendedOption,
        reason: packet.reason,
        timeoutMs: packet.timeoutMs,
      },
      "system",
    );
    this.sendMessage({
      type: "ESCALATION_REQUEST",
      workspaceId: task.workspaceId,
      payload: packet,
    });
    this.sendMessage({
      type: "AGENT_STEP",
      workspaceId: task.workspaceId,
      payload: {
        step: {
          id: crypto.randomUUID(),
          type: "info",
          label: `Escalation: operator decision requested for ${packet.nodeId.slice(0, 6)}`,
          detail: packet.reason,
          status: "done",
          timestamp: Date.now(),
        },
        update: false,
      },
    });

    return await new Promise<EscalationDecisionPayload>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingEscalationResolvers.delete(packet.escalationId);
        const fallback: EscalationDecisionPayload = {
          escalationId: packet.escalationId,
          optionId: "stop_task",
        };
        logger.warn("orchestrator", "Escalation decision timed out", {
          taskId: task.id,
          nodeId: packet.nodeId,
          escalationId: packet.escalationId,
          timeoutMs: packet.timeoutMs,
        });
        this.emitTraceEvent(
          task,
          "escalation_timeout",
          {
            taskId: task.id,
            nodeId: packet.nodeId,
            escalationId: packet.escalationId,
            timeoutMs: packet.timeoutMs,
          },
          "system",
        );
        resolve(fallback);
      }, packet.timeoutMs);

      this.pendingEscalationResolvers.set(packet.escalationId, (decision) => {
        clearTimeout(timeout);
        this.pendingEscalationResolvers.delete(packet.escalationId);
        this.emitTraceEvent(
          task,
          "escalation_decision_received",
          {
            taskId: task.id,
            nodeId: packet.nodeId,
            escalationId: packet.escalationId,
            optionId: decision.optionId,
          },
          "system",
        );
        resolve(decision);
      });
    });
  }

  private async clearPendingEscalation(task: OrchestratorTask): Promise<void> {
    if (!task.pendingEscalation) return;
    task.pendingEscalation = undefined;
    await this.persistTaskCheckpoint(task);
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

  public resolveApprovalResponse(
    payload: { approvalId: string; approved: boolean },
    workspaceId?: string | null,
  ): boolean {
    const task =
      (workspaceId
        ? this.tasksByWorkspace.get(workspaceId)
        : [...this.tasksByWorkspace.values()].find(
            (candidate) =>
              candidate.pendingInteraction?.kind === "approval" &&
              candidate.pendingInteraction.approvalId === payload.approvalId,
          )) ?? null;
    if (
      !task ||
      task.pendingInteraction?.kind !== "approval" ||
      task.pendingInteraction.approvalId !== payload.approvalId
    ) {
      return false;
    }
    void this.resolvePendingInteraction(task, {
      ...task.pendingInteraction,
      approved: payload.approved,
    });
    return true;
  }

  public resolveClarificationResponse(
    payload: { clarificationId: string; answer: string },
    workspaceId?: string | null,
  ): boolean {
    const task =
      (workspaceId
        ? this.tasksByWorkspace.get(workspaceId)
        : [...this.tasksByWorkspace.values()].find(
            (candidate) =>
              candidate.pendingInteraction?.kind === "clarification" &&
              candidate.pendingInteraction.clarificationId ===
                payload.clarificationId,
          )) ?? null;
    if (
      !task ||
      task.pendingInteraction?.kind !== "clarification" ||
      task.pendingInteraction.clarificationId !== payload.clarificationId
    ) {
      return false;
    }
    void this.resolvePendingInteraction(task, {
      ...task.pendingInteraction,
      answer: payload.answer,
    });
    return true;
  }

  public resolvePlanConfirmation(payload: {
    confirmationId: string;
    decision: "approve" | "cancel";
    feedback?: string;
  }): boolean {
    const resolver = this.pendingPlanConfirmationResolvers.get(
      payload.confirmationId,
    );
    if (!resolver) return false;
    resolver({
      decision: payload.decision,
      feedback: payload.feedback,
    });
    return true;
  }

  private async requestPlanConfirmation(
    task: OrchestratorTask,
    nodes: { description: string; successCriteria: string }[],
    query: string,
    difficulty?: string,
  ): Promise<{ decision: "approve" | "cancel"; feedback?: string }> {
    const confirmationId = crypto.randomUUID();

    this.sendStatus(
      task.workspaceId,
      AgentStatus.PAUSED,
      "Awaiting plan confirmation...",
    );
    this.sendMessage({
      type: "PLAN_CONFIRMATION_REQUEST",
      workspaceId: task.workspaceId,
      payload: {
        confirmationId,
        nodes: nodes.map((n) => ({
          description: n.description,
          successCriteria: n.successCriteria,
          ...(n.selectedSkillId ? { selectedSkillId: n.selectedSkillId } : {}),
        })),
        difficulty,
        query,
      },
    });

    logger.info("orchestrator", "Plan confirmation requested", {
      taskId: task.id,
      confirmationId,
      nodeCount: nodes.length,
    });

    return new Promise<{ decision: "approve" | "cancel"; feedback?: string }>(
      (resolve) => {
        this.pendingPlanConfirmationResolvers.set(confirmationId, (result) => {
          this.pendingPlanConfirmationResolvers.delete(confirmationId);
          logger.info("orchestrator", "Plan confirmation received", {
            taskId: task.id,
            confirmationId,
            decision: result.decision,
            hasFeedback: !!result.feedback,
          });
          this.emitTraceEvent(
            task,
            "plan_confirmation",
            {
              taskId: task.id,
              confirmationId,
              decision: result.decision,
              hasFeedback: !!result.feedback,
            },
            "system",
          );
          resolve(result);
        });
      },
    );
  }

  private sendStatus(
    workspaceId: string,
    status: AgentStatus,
    detail: string,
    completionStatus?: "completed" | "partial" | "failed",
  ): void {
    this.sendMessage({
      type: "AGENT_STATUS",
      workspaceId,
      payload: { status, detail },
    });
    updateTabGroupAppearance(workspaceId, { status, completionStatus });
  }

  private sendMessage(message: {
    type: string;
    payload: any;
    workspaceId?: string | null;
  }): void {
    chrome.runtime
      .sendMessage({
        ...message,
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
      } as any)
      .catch((error) => {
        logger.debug("orchestrator", "Failed to send runtime message", {
          error,
        });
      });
  }
}

export const orchestrator = new Orchestrator();
