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
import {
  formatMissingProviderKeys,
  getProviderKeyStatus,
} from "../../utils/provider-keys";
import { listPromptDescriptors } from "../../prompts";
import {
  appendTaskRunSideEffects,
  deleteTaskRunProgress,
  fetchTaskRunResume,
  listTaskRuns,
  patchTaskRun,
  updateTaskRunCheckpoint,
  upsertTaskRun,
  upsertTaskRunNode,
  upsertTaskRunPendingInteraction,
  upsertTaskRunProgress,
  type DurablePendingInteractionRecord,
  type DurableTaskRunProgress,
  type DurableTaskRun,
  type DurableTaskRunSummary,
  type DurableTaskRunResumeResponse,
} from "../infrastructure/backend-client";
import {
  buildPersonalProfilePlannerContext,
  EMPTY_PERSONALIZATION_STATE,
  loadPersonalizationState,
} from "../../utils/personal-profile";
import { workspaceManager } from "../workspaces/manager";
import { agentNotifications } from "../notifications";
import { isUsableTab } from "../infrastructure/tab-resolution";
import {
  updateTabGroupAppearance,
  resetTabGroupAppearance,
} from "../workspaces/tab-group-appearance";
import { waitForContentScriptReady } from "../tab-ready";
import {
  buildDirectExecutionNodes,
  buildFallbackNodes,
  OrchestratorPlanner,
} from "./planner";
import { inferToolProfileForStep } from "../agent/planner";
import type { TokenUsage } from "../llm/types";
import type { ToolProfile } from "../tools/metadata";
import {
  assessTaskContractCoverage,
  buildTaskContract,
} from "../agent/task-contract";
import {
  NodeHandoffArtifact,
  OrchestratorStartInput,
  OrchestratorTask,
  StructuredEvidence,
  TaskNode,
  type VerificationGate,
  WorkerInstance,
} from "./types";
import {
  bindNodeToTaskTab,
  claimTaskTab,
  countOpenOwnedAuxiliaryTabs,
  createTaskTabCoordination,
  ensureTaskTabCoordination,
  getNodeBoundTabId,
  getOwnedCreatedTabIds,
  releaseTaskTab,
  selectResumeOwnedTab,
  touchTaskTab,
} from "./tab-coordination";
import { buildTabCoordinationTraceData as buildTaskTabCoordinationTraceData } from "./tab-coordination-trace";
import {
  NodeVerificationResult,
  OrchestratorVerifier,
  programmaticVerify,
} from "./verifier";
import { getLoadedSkillContract } from "./skills";
import {
  buildAssumptionDriftSignal,
  buildCompletedStepsSummary,
  buildExecutorParallelContext,
  buildExecutorInstruction,
  compactExecutorSummaryForNode,
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
import { buildPlanTraceGraph } from "./parallel-contract";
import {
  getDependencyState,
  getResourceBlockedPendingNodes,
  getRunnablePendingNodes,
} from "./scheduling";
import { decideRetryPolicy } from "./retry-policy";
import { BudgetEstimator } from "./budget-estimator";
import {
  CreateAgentLoopInput,
  EscalationDecisionPayload,
  LaneIsolationError,
  LaneRuntimeState,
  LaneSupervisorState,
  LaneTimeoutError,
  QueuedLaneOperation,
  RuntimeLane,
  WorkspaceLanePools,
} from "./lane-types";
import type { OrchestratorDeps } from "./lane-types";
import {
  beginLaneOperation,
  buildLaneTelemetrySnapshot as buildLaneTelemetrySnapshotData,
  clearLaneSupervisorTimers,
  createWorkspaceLanePools,
  createWorkspaceLaneRuntime,
  createWorkspaceLaneSupervisors,
  enqueueLaneOperation,
  getNextLaneDrainDecision,
  isLaneIsolated,
  recordLaneOperationFailure,
  recordLaneOperationSuccess,
  registerLaneOperation,
  releaseLaneOperation,
  releaseLaneOperationRegistration,
} from "./lane-supervisor";
import {
  resolveExecutorNodeConcurrency,
  resolveLaneTopology,
  resolveLaneTopologyFromSettings,
  shouldUsePlannerDecomposition,
  shouldUseVerifier,
} from "./lane-topology";
import {
  CHECKPOINT_VERSION,
  DEFAULT_MAX_REPLANS,
  DEFAULT_MAX_SESSION_TIME_MS,
  DEFAULT_MAX_TOTAL_COST_USD,
  DEFAULT_MAX_TOTAL_TOKENS,
  emptySessionMetrics,
  isRecord,
  mergeSessionMetrics,
  sanitizeSessionMetrics,
} from "./sanitizers";
import {
  loadOrchestratorCheckpoints,
  pruneOrchestratorCheckpoints,
  saveOrchestratorCheckpoints,
} from "./checkpoint-store";
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
import type { TaskRunProgressInput } from "@shared-types/progress";
import type {
  SideEffectEntry,
  TurnCheckpoint,
} from "../agent/checkpoint-types";
import type { PendingUserInteraction } from "../agent/loop-types";
import type { CompletionEnvelope } from "../agent/completion-kernel";

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

function verifyDeterministicCompletionEnvelope(
  envelope: CompletionEnvelope,
): NodeVerificationResult | null {
  if (envelope.contractKind === "legacy_done_guards") {
    return null;
  }

  if (
    envelope.status !== "completed" ||
    !envelope.resultId ||
    !envelope.contractKind ||
    !envelope.decisionReason ||
    !envelope.evidenceEpoch ||
    !Array.isArray(envelope.evidenceKeys) ||
    envelope.evidenceKeys.length === 0
  ) {
    return {
      decision: "retry",
      reason:
        "Completion envelope was present but lacked the deterministic evidence required for node acceptance.",
      confidence: 0.85,
      failureType: "insufficient_evidence",
    };
  }

  return {
    decision: "accept",
    reason: `Accepted deterministic completion envelope (${envelope.contractKind}): ${envelope.decisionReason}`,
    confidence: 0.95,
  };
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

function isNavigationGoalShortcutSkip(node: TaskNode): boolean {
  return (
    node.status === "skipped" &&
    String(node.result || "").includes(
      "Skipped: navigation goal already achieved",
    )
  );
}

function isUnpenalizedGoalShortcutSkip(node: TaskNode): boolean {
  return isGlobalGoalShortcutSkip(node) || isNavigationGoalShortcutSkip(node);
}

function normalizeNavigationText(value: string | undefined | null): string {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .replace(/[_/|>.-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeNavigationLabel(label: string): string[] {
  const stopwords = new Set([
    "the",
    "a",
    "an",
    "module",
    "page",
    "application",
    "app",
    "section",
    "screen",
    "of",
    "in",
    "to",
  ]);
  return normalizeNavigationText(label)
    .split(" ")
    .filter((token) => token.length >= 3 && !stopwords.has(token));
}

function navigationLabelMatches(label: string, corpus: string): boolean {
  const tokens = tokenizeNavigationLabel(label);
  if (tokens.length === 0) return false;
  const normalizedCorpus = ` ${normalizeNavigationText(corpus)} `;
  return tokens.every((token) => normalizedCorpus.includes(` ${token} `));
}

function cleanNavigationLabel(value: string): string {
  return value
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, " ");
}

function extractQuotedNavigationLabels(query: string): string[] {
  const labels: string[] = [];
  for (const match of query.matchAll(/"([^"]+)"|'([^']+)'/g)) {
    const label = cleanNavigationLabel(match[1] || match[2] || "");
    if (!label) continue;
    labels.push(label);
    if (label.includes(">")) {
      labels.push(
        ...label.split(">").map(cleanNavigationLabel).filter(Boolean),
      );
    }
  }
  return [...new Set(labels)];
}

function extractNavigationTargetLabels(query: string): {
  labels: string[];
  terminalLabels: string[];
} {
  const quotedLabels = extractQuotedNavigationLabels(query);
  const terminalLabels: string[] = [];
  for (const label of quotedLabels) {
    const parts = label
      .split(">")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) terminalLabels.push(parts[parts.length - 1]);
  }

  const unquotedMatch = query.match(
    /\b(?:navigate to|go to|open|visit|show|display|take me to)\s+(?:the\s+)?([^.\n]+?)(?:\s+(?:module|page|screen|section|application|app)\b|[.!?]|$)/i,
  );
  if (unquotedMatch?.[1]) {
    const label = cleanNavigationLabel(
      unquotedMatch[1].replace(
        /\b(?:of|in)\s+the\s+["'][^"']+["']\s+(?:application|app)\b/gi,
        "",
      ),
    );
    if (label) {
      quotedLabels.push(label);
      const parts = label.split(">").map(cleanNavigationLabel).filter(Boolean);
      terminalLabels.push(parts.length > 0 ? parts[parts.length - 1] : label);
    }
  }

  return {
    labels: [...new Set(quotedLabels)],
    terminalLabels: [...new Set(terminalLabels)],
  };
}

function isNavigationOnlyRequest(query: string): boolean {
  const normalized = normalizeNavigationText(query);
  if (
    !/\b(navigate to|go to|open|visit|show|display|take me to)\b/i.test(query)
  ) {
    return false;
  }

  const nonNavigationWork =
    /\b(filter|sort|search for|find|look up|answer|read|summari[sz]e|extract|report|compare|create|add|fill|submit|save|update|edit|delete|remove|order|purchase|checkout|impersonate|type|enter|select|choose)\b/i;
  if (nonNavigationWork.test(query)) return false;

  return !/\b(return|go back|then|after that|and then)\b/.test(normalized);
}

function assessNavigationGoalCompletion(input: {
  query: string;
  snapshot?: {
    title?: string;
    url?: string;
    visibleContent?: string;
    pageContent?: string;
  };
  completedNodes: TaskNode[];
}): { satisfied: boolean; matchedLabels: string[]; reason: string } {
  if (!isNavigationOnlyRequest(input.query)) {
    return {
      satisfied: false,
      matchedLabels: [],
      reason: "Original request is not navigation-only.",
    };
  }

  const { labels, terminalLabels } = extractNavigationTargetLabels(input.query);
  const targetLabels = labels.length > 0 ? labels : terminalLabels;
  if (targetLabels.length === 0 && terminalLabels.length === 0) {
    return {
      satisfied: false,
      matchedLabels: [],
      reason: "No concrete navigation target labels were detected.",
    };
  }

  const currentCorpus = [
    input.snapshot?.title,
    input.snapshot?.url,
    input.snapshot?.visibleContent,
    input.snapshot?.pageContent,
  ]
    .filter(Boolean)
    .join("\n");
  const currentLocationCorpus = [input.snapshot?.title, input.snapshot?.url]
    .filter(Boolean)
    .join("\n");
  const evidenceCorpus = [
    currentCorpus,
    ...input.completedNodes.map((node) => node.result || ""),
  ].join("\n");

  const currentMatches = (
    terminalLabels.length > 0 ? terminalLabels : targetLabels
  ).filter((label) => navigationLabelMatches(label, currentLocationCorpus));
  const evidenceMatches = targetLabels.filter((label) =>
    navigationLabelMatches(label, evidenceCorpus),
  );

  if (currentMatches.length === 0) {
    return {
      satisfied: false,
      matchedLabels: evidenceMatches,
      reason: "Current page does not match the requested destination.",
    };
  }

  const enoughEvidence =
    targetLabels.length <= 1 ||
    evidenceMatches.length >= Math.min(2, targetLabels.length);
  if (!enoughEvidence) {
    return {
      satisfied: false,
      matchedLabels: evidenceMatches,
      reason:
        "Completed evidence does not cover enough requested destination labels.",
    };
  }

  return {
    satisfied: true,
    matchedLabels: [...new Set([...currentMatches, ...evidenceMatches])],
    reason: "Navigation-only destination is already open.",
  };
}

function isActionOrMutationNode(node: TaskNode): boolean {
  const text = `${node.description}\n${node.successCriteria}`.toLowerCase();
  return [
    /\bsearch(?:ing)?\b/,
    /\bsubmit(?:ting)?\b/,
    /\bapply(?:ing)?\b/,
    /\btype\b|\btyping\b/,
    /\benter\b|\bentering\b/,
    /\bfill\b|\bfilling\b/,
    /\bclick\b|\bclicking\b/,
    /\bselect\b|\bselecting\b/,
    /\bremove\b|\bremoving\b/,
    /\badd\b|\badding\b/,
    /\bswap\b|\bswapping\b/,
    /\breplace\b|\breplacing\b/,
    /\bcheckout\b/,
    /\bpurchase\b/,
    /\bplace order\b/,
    /\bcomplete order\b/,
    /\bconfirm\b|\bconfirming\b/,
    /\bfinalize\b|\bfinalizing\b/,
    /\bdelete\b|\bdeleting\b/,
    /\bsave\b|\bsaving\b/,
    /\bsend\b|\bsending\b/,
    /\bswitch\b|\bswitching\b/,
    /\bimpersonate\b|\bimpersonating\b|\bimpersonation\b/,
  ].some((pattern) => pattern.test(text));
}

function formatRecentSideEffects(
  entries: SideEffectEntry[] | undefined,
): string {
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

function cloneTaskForDurableSync(task: OrchestratorTask): OrchestratorTask {
  const cloned = JSON.parse(JSON.stringify(task)) as OrchestratorTask;
  cloned.structuredProgress = cloneStructuredProgress(task.structuredProgress);
  return cloned;
}

function getNodeToolProfile(
  node: Pick<TaskNode, "description" | "successCriteria" | "toolProfile">,
): ToolProfile | undefined {
  return (
    node.toolProfile ??
    inferToolProfileForStep(node.description, node.successCriteria)
  );
}

function buildParallelRunState(task: OrchestratorTask): {
  activeWorkerCount: number;
  resourceLocks: Array<{
    nodeId: string;
    parallelism: string;
    resources: NonNullable<TaskNode["parallelContract"]>["resourceHints"];
  }>;
} {
  const runningNodes = task.nodes.filter((node) => node.status === "running");
  return {
    activeWorkerCount: runningNodes.length,
    resourceLocks: runningNodes.map((node) => ({
      nodeId: node.id,
      parallelism: node.parallelContract?.parallelism ?? "unknown",
      resources: node.parallelContract?.resourceHints ?? [],
    })),
  };
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
    subtasks: task.nodes.map((node) => {
      const toolProfile = getNodeToolProfile(node);
      return {
        description: node.description,
        successCriteria: node.successCriteria,
        status: node.status,
        turnsUsed: 0,
        turnBudget: 0,
        ...(node.result ? { result: node.result } : {}),
        ...(node.verificationGate
          ? { verificationGate: node.verificationGate }
          : {}),
        ...(toolProfile ? { toolProfile } : {}),
        ...(node.selectedSkillId
          ? { selectedSkillId: node.selectedSkillId }
          : {}),
      };
    }),
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

function synthesizePlanStateFromSingleNode(node: TaskNode): {
  subtasks: Array<{
    description: string;
    successCriteria: string;
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    turnsUsed: number;
    turnBudget: number;
    result?: string;
    verificationGate?: VerificationGate;
    toolProfile?: ToolProfile;
    selectedSkillId?: string;
  }>;
  currentIndex: number;
} | null {
  const stepPattern =
    /(?:^|\n)\s*Step\s+(\d+)\s*:\s*([\s\S]*?)(?=(?:\n\s*Step\s+\d+\s*:)|$)/gi;
  const matches = [...node.description.matchAll(stepPattern)];
  if (matches.length < 2) return null;

  const currentIndex = 0;
  const baseStatus: "pending" | "completed" | "failed" =
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
        const status: "pending" | "running" | "completed" | "failed" =
          node.status === "completed"
            ? "completed"
            : index < currentIndex
              ? "completed"
              : index === currentIndex
                ? node.status === "running"
                  ? "running"
                  : baseStatus
                : "pending";
        return {
          description,
          successCriteria: node.successCriteria,
          status,
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
const RECENT_COMPLETION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RECENT_COMPLETION_HISTORY = 6;
const MAX_RECENT_COMPLETION_CONTEXT_CHARS = 1400;
const MAX_RECENT_COMPLETION_LINE_CHARS = 260;
const MAX_PERSISTED_MESSAGES = 200;
const E2E_SYNTHETIC_QUERY_PREFIX = "__e2e_pending_interaction__:";
const E2E_PENDING_INTERACTION_TIMEOUT_MS = 10 * 60 * 1000;
const LIST_DETAIL_REVIEW_SKILL_ID = "list-detail-review-loop";
const NAVIGATE_READ_RETURN_SKILL_ID = "navigate-read-return";
const MULTI_TAB_CHECKLIST_SKILL_ID = "multi-tab-checklist-workflow";
const EXHAUSTIVE_REVIEW_MIN_NODES_FOR_BUDGET_BUMP = 8;
const EXHAUSTIVE_REVIEW_MAX_TOTAL_TOKENS = 1_600_000;

function cloneStructuredProgress(
  progress: Record<string, TaskRunProgressInput> | undefined,
): Record<string, TaskRunProgressInput> | undefined {
  if (!progress) return undefined;
  const entries = Object.entries(progress).map(([key, value]) => [
    key,
    JSON.parse(JSON.stringify(value)) as TaskRunProgressInput,
  ]);
  return Object.fromEntries(entries);
}

function isLargeExhaustiveReviewGraph(nodes: TaskNode[]): boolean {
  const reviewNodeCount = nodes.filter(
    (node) => node.selectedSkillId === LIST_DETAIL_REVIEW_SKILL_ID,
  ).length;
  return reviewNodeCount >= EXHAUSTIVE_REVIEW_MIN_NODES_FOR_BUDGET_BUMP;
}

export class Orchestrator {
  private tasksByWorkspace = new Map<string, OrchestratorTask>();
  private recentCompletion = new Map<
    string,
    {
      payload: TaskCompletionMessage["payload"];
      timestamp: number;
    }
  >();
  private recentCompletionHistory = new Map<
    string,
    Array<{
      payload: TaskCompletionMessage["payload"];
      timestamp: number;
    }>
  >();
  private completionWaiters = new Map<
    string,
    Set<(payload: TaskCompletionMessage["payload"]) => void>
  >();
  private workersByWorkspace = new Map<string, WorkspaceLanePools>();
  private pendingFeedbackQueue = new Map<string, string[]>();
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
  private durableControlWatermarks = new Map<
    string,
    { resumeRequestedAt?: number; stopRequestedAt?: number }
  >();
  private traceWriter: RunTraceWriter = createHttpRunTraceWriter();
  private durableRunSyncs = new Map<string, Promise<void>>();
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

  private emitCompletionScopeTransition(
    task:
      | { runId?: string; id?: string; workspaceId?: string; nodes?: TaskNode[] }
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
    this.emitTraceEvent(
      task,
      "completion_scope_transition",
      {
        taskId: task?.id,
        scope: data.scope,
        status: data.status,
        nodeId: data.nodeId,
        reason: data.reason,
        ...(data.envelope
          ? {
              resultId: data.envelope.resultId,
              source: data.envelope.source,
              contractKind: data.envelope.contractKind,
              evidenceKeys: data.envelope.evidenceKeys,
            }
          : {}),
        ...(data.skippedNodeIds ? { skippedNodeIds: data.skippedNodeIds } : {}),
        ...(task?.nodes
          ? {
              pendingNodes: task.nodes.filter(
                (node) => node.status === "pending",
              ).length,
              runningNodes: task.nodes.filter(
                (node) => node.status === "running",
              ).length,
              completedNodes: task.nodes.filter(
                (node) => node.status === "completed",
              ).length,
            }
          : {}),
      },
      "system",
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
    const maybePlanner = planner as {
      setUsageCallback?: (
        cb: ((usage: TokenUsage, llmMs: number, model: string) => void) | null,
      ) => void;
    };
    if (typeof maybePlanner.setUsageCallback !== "function") return;

    maybePlanner.setUsageCallback((usage, llmMs, model) => {
      this.emitTraceEvent(
        task,
        "planner_llm_call",
        {
          phase: phase(),
          model,
          durationMs: llmMs,
          usage: {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
            cost: usage.cost,
          },
        },
        "planner",
      );
    });
  }

  private emitNodeFailureAttribution(
    task: OrchestratorTask,
    node: TaskNode,
    reason: string,
    detail?: Record<string, unknown>,
  ): void {
    this.emitTraceEvent(
      task,
      "node_failure_attribution",
      {
        taskId: task.id,
        nodeId: node.id,
        reason,
        ...(detail ?? {}),
      },
      "system",
    );
  }

  private buildTabCoordinationTraceData(
    task: OrchestratorTask,
    detail: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return buildTaskTabCoordinationTraceData(task, detail);
  }

  private emitTabCoordinationState(
    task: OrchestratorTask,
    action: string,
    detail: Record<string, unknown> = {},
  ): void {
    this.emitTraceEvent(
      task,
      "tab_coordination_state",
      this.buildTabCoordinationTraceData(task, { action, ...detail }),
      "system",
    );
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
    this.budgetEstimatorsByWorkspace.set(workspaceId, new BudgetEstimator());
    this.workersByWorkspace.set(workspaceId, this.createWorkspaceLanePools());
    this.laneSupervisorsByWorkspace.set(
      workspaceId,
      createWorkspaceLaneSupervisors(),
    );
    this.laneRuntimeByWorkspace.set(
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
    const supervisors = this.laneSupervisorsByWorkspace.get(workspaceId);
    clearLaneSupervisorTimers(supervisors);
    this.laneSupervisorsByWorkspace.delete(workspaceId);
    this.workersByWorkspace.delete(workspaceId);
    this.budgetEstimatorsByWorkspace.delete(workspaceId);
    this.laneRuntimeByWorkspace.delete(workspaceId);
    this.recentCompletion.delete(workspaceId);
    this.pendingFeedbackQueue.delete(workspaceId);
  }

  private queueFeedback(workspaceId: string, text: string): void {
    const queue = this.pendingFeedbackQueue.get(workspaceId) ?? [];
    queue.push(text);
    this.pendingFeedbackQueue.set(workspaceId, queue);
    logger.warn("orchestrator", "Feedback queued without active executor", {
      workspaceId,
      queueLength: queue.length,
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
    const pending = this.pendingFeedbackQueue.get(workspaceId);
    if (!pending?.length) return;

    for (const text of pending) {
      loop.injectFeedback(text);
    }
    this.pendingFeedbackQueue.delete(workspaceId);
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
    return buildLaneTelemetrySnapshotData({
      runtime: this.laneRuntimeByWorkspace.get(workspaceId),
      supervisors: this.laneSupervisorsByWorkspace.get(workspaceId),
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
    return isLaneIsolated(state);
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
    beginLaneOperation(state, supervisor);
    const startedAt = Date.now();
    const laneOperationId =
      lane === "executor" ? null : `${lane}-op-${crypto.randomUUID()}`;
    const registration = laneOperationId
      ? registerLaneOperation({
          pools: this.getWorkspaceLanePools(task.workspaceId),
          lane,
          queued,
          startedAt,
          timeoutMs: state.policy.maxCallMs,
          operationId: laneOperationId,
        })
      : null;
    if (registration) {
      logger.debug("orchestrator", "Lane operation registered", {
        taskId: queued.taskId,
        workspaceId: queued.workspaceId,
        lane,
        operationId: registration.operationId,
        activeLaneOperations: registration.activeLaneOperations,
        queueLatencyMs: registration.queueLatencyMs,
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
      recordLaneOperationSuccess({
        state,
        supervisor,
        durationMs: Date.now() - startedAt,
      });
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
      const failure = recordLaneOperationFailure({
        state,
        supervisor,
        message,
        durationMs: Date.now() - startedAt,
      });
      logger.warn("orchestrator", "Lane execution failed", {
        workspaceId: task.workspaceId,
        taskId: task.id,
        lane,
        failures: state.failures,
        maxFailuresBeforeIsolation: state.policy.maxFailuresBeforeIsolation,
        error: message,
        laneRestartCount: supervisor.restartCount,
        laneConsecutiveCrashes: supervisor.consecutiveCrashes,
        backoffMs: failure.backoffMs,
      });
      if (failure.isolated) {
        logger.warn("orchestrator", "Lane isolated", {
          workspaceId: task.workspaceId,
          taskId: task.id,
          lane,
          isolatedUntilMs: state.isolatedUntilMs,
          detail: failure.detail,
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
            detail: failure.detail,
          },
          lane,
        );
        this.emitLaneIsolationStep(task.workspaceId, state, failure.detail);
        throw new LaneIsolationError(
          lane,
          state.policy.isolationCooldownMs,
          message,
        );
      }

      logger.warn("orchestrator", "Lane supervisor backoff", {
        workspaceId: task.workspaceId,
        taskId: task.id,
        lane,
        backoffMs: failure.backoffMs,
        circuitOpenUntilMs: supervisor.circuitOpenUntilMs,
        restartCount: supervisor.restartCount,
        queueDepth: supervisor.queue.length,
      });
      this.emitLaneSupervisorActivity(task.workspaceId);
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (laneOperationId) {
        const activeLaneOperations = releaseLaneOperationRegistration({
          pools: this.getWorkspaceLanePools(task.workspaceId),
          lane,
          operationId: laneOperationId,
        });
        logger.debug("orchestrator", "Lane operation released", {
          taskId: task.id,
          workspaceId: task.workspaceId,
          lane,
          operationId: laneOperationId,
          activeLaneOperations,
        });
      }
      releaseLaneOperation(state, supervisor);
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

        void this.executeLaneOperation(
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

  private buildDurableCheckpointSummary(task: OrchestratorTask): {
    currentIndex: number;
    nodeCount: number;
    turnNumber: number | null;
    activeNodeId?: string | null;
    pendingInteractionKind?: "approval" | "clarification" | null;
  } {
    const activeNode =
      task.nodes.find((node) => node.status === "running") ??
      task.nodes[task.currentIndex];
    return {
      currentIndex: task.currentIndex,
      nodeCount: task.nodes.length,
      turnNumber: task.turnNumber ?? null,
      activeNodeId: activeNode?.id ?? null,
      pendingInteractionKind: task.pendingInteraction?.kind ?? null,
    };
  }

  private buildStructuredProgressFromDurableEntries(
    progress: DurableTaskRunProgress[],
  ): Record<string, TaskRunProgressInput> | undefined {
    const entries: Array<[string, TaskRunProgressInput]> = [];
    for (const entry of progress) {
      if (
        entry.kind === "reviewed-item-list" ||
        entry.kind === "completed-phase-list" ||
        entry.kind === "outstanding-question-list"
      ) {
        if (
          Array.isArray(entry.payload) &&
          entry.payload.every((value) => typeof value === "string")
        ) {
          entries.push([
            entry.key,
            {
              key: entry.key,
              kind: entry.kind,
              payload: entry.payload,
            },
          ]);
        }
        continue;
      }
      if (
        entry.kind === "extracted-fact-map" &&
        entry.payload &&
        typeof entry.payload === "object" &&
        !Array.isArray(entry.payload)
      ) {
        entries.push([
          entry.key,
          {
            key: entry.key,
            kind: entry.kind,
            payload: entry.payload,
          },
        ]);
      }
    }
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  private setStructuredProgressEntry(
    task: OrchestratorTask,
    entry: TaskRunProgressInput,
  ): void {
    const current = cloneStructuredProgress(task.structuredProgress) ?? {};
    current[entry.key] = JSON.parse(
      JSON.stringify(entry),
    ) as TaskRunProgressInput;
    task.structuredProgress = current;
    if (!task.runId) return;
    this.queueDurableRunSync(task.runId, async () => {
      await upsertTaskRunProgress(task.runId!, entry);
    });
  }

  private deleteStructuredProgressEntry(
    task: OrchestratorTask,
    key: string,
  ): void {
    if (task.structuredProgress?.[key]) {
      const next = cloneStructuredProgress(task.structuredProgress) ?? {};
      delete next[key];
      task.structuredProgress = Object.keys(next).length > 0 ? next : undefined;
    }
    if (!task.runId) return;
    this.queueDurableRunSync(task.runId, async () => {
      await deleteTaskRunProgress(task.runId!, key);
    });
  }

  private recordCompletedPhase(task: OrchestratorTask, phase: string): void {
    this.setStructuredProgressEntry(task, {
      key: "completed-phases",
      kind: "completed-phase-list",
      payload: [phase],
    });
  }

  private recordOutstandingQuestion(
    task: OrchestratorTask,
    question: string,
  ): void {
    this.setStructuredProgressEntry(task, {
      key: "outstanding-questions",
      kind: "outstanding-question-list",
      payload: [question],
    });
  }

  private clearOutstandingQuestions(task: OrchestratorTask): void {
    this.deleteStructuredProgressEntry(task, "outstanding-questions");
  }

  private maybeRecordReviewedItem(
    task: OrchestratorTask,
    node: TaskNode,
  ): void {
    if (node.selectedSkillId !== LIST_DETAIL_REVIEW_SKILL_ID) return;
    this.setStructuredProgressEntry(task, {
      key: "reviewed-items",
      kind: "reviewed-item-list",
      payload: [node.description],
    });
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
  }

  private isDurableResumeStructurallyValid(
    resume: DurableTaskRunResumeResponse | null,
  ): resume is DurableTaskRunResumeResponse {
    if (!resume) return false;
    if (
      !resume.run ||
      !Array.isArray(resume.nodes) ||
      resume.nodes.length === 0
    ) {
      return false;
    }
    const nodeIds = new Set<string>();
    for (const node of resume.nodes) {
      if (
        typeof node.nodeId !== "string" ||
        node.nodeId.length === 0 ||
        typeof node.description !== "string" ||
        node.description.length === 0 ||
        typeof node.successCriteria !== "string" ||
        node.successCriteria.length === 0 ||
        typeof node.status !== "string" ||
        typeof node.retries !== "number"
      ) {
        return false;
      }
      nodeIds.add(node.nodeId);
    }
    for (const node of resume.nodes) {
      if (
        Array.isArray(node.dependencies) &&
        node.dependencies.some((dependency) => !nodeIds.has(dependency))
      ) {
        return false;
      }
    }
    return true;
  }

  private buildBudgetFromDurableRun(
    run: DurableTaskRun,
  ): OrchestratorTask["budget"] {
    const raw = run.budget;
    if (isRecord(raw)) {
      const maxSessionTimeMs = raw.maxSessionTimeMs;
      const maxTotalTokens = raw.maxTotalTokens;
      const maxTotalCostUsd = raw.maxTotalCostUsd;
      if (
        typeof maxSessionTimeMs === "number" &&
        typeof maxTotalTokens === "number" &&
        typeof maxTotalCostUsd === "number"
      ) {
        return {
          maxSessionTimeMs,
          maxTotalTokens,
          maxTotalCostUsd,
        };
      }
    }
    return {
      maxSessionTimeMs: DEFAULT_MAX_SESSION_TIME_MS,
      maxTotalTokens: clampInteger(DEFAULT_MAX_TOTAL_TOKENS, 1),
      maxTotalCostUsd: DEFAULT_MAX_TOTAL_COST_USD,
    };
  }

  private buildPendingInteractionFromDurableRecord(
    interaction: DurablePendingInteractionRecord | null,
    task:
      | { runId?: string; id?: string; workspaceId?: string }
      | null
      | undefined,
  ): PendingUserInteraction | undefined {
    if (!interaction || interaction.status !== "active") return undefined;
    const payload = interaction.payload;
    const now = Date.now();
    const timeoutAt = interaction.timeoutAt ?? null;
    const remainingMs = timeoutAt == null ? 0 : timeoutAt - now;
    if (remainingMs <= 0) {
      this.emitTraceEvent(
        task,
        "pending_interaction_backend_conflict",
        {
          nodeId: interaction.nodeId ?? null,
          kind: interaction.kind,
          reason: "timeout_expired_before_restore",
        },
        "system",
      );
      return undefined;
    }

    if (interaction.kind === "approval") {
      const approvalId = payload.approvalId;
      const toolName = payload.toolName;
      const args = payload.args;
      const context = payload.context;
      if (
        typeof approvalId !== "string" ||
        typeof toolName !== "string" ||
        !isRecord(args) ||
        typeof context !== "string"
      ) {
        return undefined;
      }
      return {
        kind: "approval",
        nodeId: interaction.nodeId ?? null,
        requestedAt: now,
        approvalId,
        toolName: toolName as ToolName,
        args,
        context,
        timeoutMs: remainingMs,
      };
    }

    const clarificationId = payload.clarificationId;
    const question = payload.question;
    const suggestions = payload.suggestions;
    if (
      typeof clarificationId !== "string" ||
      typeof question !== "string" ||
      (suggestions !== undefined &&
        (!Array.isArray(suggestions) ||
          suggestions.some((item) => typeof item !== "string")))
    ) {
      return undefined;
    }
    return {
      kind: "clarification",
      nodeId: interaction.nodeId ?? null,
      requestedAt: now,
      clarificationId,
      question,
      suggestions: Array.isArray(suggestions)
        ? (suggestions as string[])
        : undefined,
      timeoutMs: remainingMs,
    };
  }

  private async buildTaskFromDurableResume(
    resume: DurableTaskRunResumeResponse,
    resumeTabId: number,
  ): Promise<OrchestratorTask | null> {
    if (!this.isDurableResumeStructurallyValid(resume)) {
      return null;
    }

    const metrics =
      resume.run.sessionMetrics && isRecord(resume.run.sessionMetrics)
        ? (sanitizeSessionMetrics(resume.run.sessionMetrics) ??
          emptySessionMetrics())
        : emptySessionMetrics();

    const nodes: TaskNode[] = [];
    for (const node of resume.nodes) {
      const allowedTools = node.allowedTools.filter(
        (tool): tool is ToolName => typeof tool === "string",
      );
      if (allowedTools.length === 0) return null;
      nodes.push({
        id: node.nodeId,
        role: "executor",
        description: node.description,
        successCriteria: node.successCriteria,
        selectedSkillId: node.selectedSkillId ?? undefined,
        selectedSkillReason: node.selectedSkillReason ?? undefined,
        allowedTools,
        dependencies: [...(node.dependencies ?? [])],
        assumptions: [...(node.assumptions ?? [])],
        handoffArtifacts: [
          ...(node.handoffArtifacts ?? []),
        ] as NodeHandoffArtifact[],
        reflexionLog: [...(node.reflexionLog ?? [])] as any,
        handoffDepth: node.handoffDepth ?? 0,
        handoffFromNodeId: node.handoffFromNodeId ?? undefined,
        verificationGate: (node.verificationGate as any) ?? undefined,
        status: node.status as TaskNode["status"],
        retries: node.retries,
        result: node.result ?? undefined,
        error: node.error ?? undefined,
        trajectory: node.trajectory ?? undefined,
      });
    }

    const pendingInteraction = this.buildPendingInteractionFromDurableRecord(
      resume.pendingInteraction,
      {
        runId: resume.run.id,
        id: resume.run.clientRunId ?? undefined,
        workspaceId: resume.run.workspaceId,
      },
    );

    return {
      runId: resume.run.id,
      id: resume.run.clientRunId ?? crypto.randomUUID(),
      workspaceId: resume.run.workspaceId,
      rootTabId: resumeTabId,
      rootTabUrl: resume.run.rootTabUrl ?? undefined,
      query: resume.run.query,
      turnNumber: resume.run.turnNumber ?? undefined,
      status: resume.run.status,
      createdAt: resume.run.createdAt,
      startedAt: resume.run.startedAt ?? undefined,
      finishedAt: resume.run.finishedAt ?? undefined,
      nodes,
      plannerReflexionLog: [],
      maxWorkers: Math.max(1, Math.min(8, DEFAULT_MAX_WORKERS)),
      maxReplans: DEFAULT_MAX_REPLANS,
      replansUsed: 0,
      horizonExpansions: 0,
      currentIndex:
        resume.run.checkpointSummary?.currentIndex ?? currentIndex(nodes),
      sessionMetrics: metrics,
      budget: this.buildBudgetFromDurableRun(resume.run),
      terminationReason: resume.run.terminationReason ?? undefined,
      pendingInteraction,
      structuredProgress: this.buildStructuredProgressFromDurableEntries(
        resume.progress,
      ),
      tabCoordination: createTaskTabCoordination(resumeTabId, {
        primaryTabUrl: resume.run.rootTabUrl ?? null,
        lastReboundTabId: resumeTabId,
      }),
      durableMeta: {
        lastResumeSource: resume.run.lastResumeSource,
        lastKnownResumeSafe: resume.run.lastKnownResumeSafe,
        lastResumeSafetyCheckedAt: resume.run.lastResumeSafetyCheckedAt,
        lastKnownResumeReason: resume.run.lastKnownResumeReason,
        resumeRequestedAt: resume.run.resumeRequestedAt,
        resumeRequestedReason: resume.run.resumeRequestedReason,
        stopRequestedAt: resume.run.stopRequestedAt,
        stopRequestedReason: resume.run.stopRequestedReason,
      },
    };
  }

  private async discoverBackendRunCandidates(): Promise<DurableTaskRun[]> {
    const workspaces = await this.deps.workspaceManager.getWorkspaces();
    const discovered: DurableTaskRun[] = [];
    const seenRunIds = new Set<string>();

    for (const workspace of workspaces) {
      const localTask = this.tasksByWorkspace.get(workspace.id);
      if (localTask?.status === "running" || localTask?.status === "planning") {
        continue;
      }
      for (const status of ["running", "planning"] as const) {
        const runs = await listTaskRuns({
          workspaceId: workspace.id,
          status,
          limit: 5,
        });
        for (const run of runs) {
          if (seenRunIds.has(run.id)) continue;
          seenRunIds.add(run.id);
          discovered.push(run);
        }
      }
    }

    return discovered.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async recoverWorkspaceFromDurableState(
    workspaceId: string,
  ): Promise<boolean> {
    if (this.tasksByWorkspace.has(workspaceId)) return true;

    const candidates = (
      await Promise.all(
        (["running", "planning"] as const).map((status) =>
          listTaskRuns({
            workspaceId,
            status,
            limit: 5,
          }),
        ),
      )
    )
      .flat()
      .sort((a, b) => b.updatedAt - a.updatedAt);

    for (const run of candidates) {
      const resume = await fetchTaskRunResume(run.id);
      if (!this.isDurableResumeStructurallyValid(resume)) {
        this.emitTraceEvent(
          {
            runId: run.id,
            id: run.clientRunId ?? undefined,
            workspaceId,
          },
          "task_resume_backend_invalid",
          {
            workspaceId,
            reason: "missing_or_invalid_resume_payload",
          },
          "system",
        );
        continue;
      }

      const resumeSelection = await this.resolveResumeTabId(
        {
          workspaceId,
          rootTabId: resume.run.rootTabId ?? run.rootTabId ?? 0,
          rootTabUrl: resume.run.rootTabUrl ?? null,
          tabCoordination: undefined,
        },
        resume.run.rootTabId ?? run.rootTabId ?? 0,
      );
      if (resumeSelection.status !== "safe") {
        await patchTaskRun(run.id, {
          lastKnownResumeSafe: false,
          lastResumeSafetyCheckedAt: Date.now(),
          lastKnownResumeReason: resumeSelection.reason,
        });
        continue;
      }
      const resumeTabId = resumeSelection.tabId;

      const task = await this.buildTaskFromDurableResume(resume, resumeTabId);
      const resumeInput =
        task && (await this.buildResumeInput(task, resumeTabId));
      if (!task || !resumeInput) {
        await patchTaskRun(run.id, {
          lastKnownResumeSafe: false,
          lastResumeSafetyCheckedAt: Date.now(),
          lastKnownResumeReason: "Unable to rebuild runtime state for resume.",
        });
        continue;
      }

      await this.activateRecoveredTask(
        task,
        resumeInput,
        resumeTabId,
        "backend",
      );
      return true;
    }

    return false;
  }

  private pickDurableControlAction(
    run: DurableTaskRunSummary,
  ): { action: "resume" | "stop"; requestedAt: number } | null {
    const resumeRequestedAt = run.resumeRequestedAt ?? null;
    const stopRequestedAt = run.stopRequestedAt ?? null;
    if (resumeRequestedAt == null && stopRequestedAt == null) return null;
    if (
      stopRequestedAt != null &&
      (resumeRequestedAt == null || stopRequestedAt >= resumeRequestedAt)
    ) {
      return { action: "stop", requestedAt: stopRequestedAt };
    }
    if (resumeRequestedAt != null) {
      return { action: "resume", requestedAt: resumeRequestedAt };
    }
    return null;
  }

  private canDurableRunResume(run: DurableTaskRunSummary): boolean {
    if (run.status === "completed" || run.status === "stopped") return false;
    if (run.stopRequestedAt) return false;
    return run.lastKnownResumeSafe !== false;
  }

  private sendDurableRunStatus(
    workspaceId: string,
    run: DurableTaskRunSummary | null,
  ): void {
    this.sendMessage({
      type: "DURABLE_RUN_STATUS",
      workspaceId,
      payload: run
        ? {
            runId: run.id,
            query: run.query,
            status: run.status,
            canResume: this.canDurableRunResume(run),
            lastKnownResumeSafe: run.lastKnownResumeSafe,
            lastKnownResumeReason: run.lastKnownResumeReason,
            stopRequestedAt: run.stopRequestedAt,
            resumeRequestedAt: run.resumeRequestedAt,
          }
        : null,
    });
  }

  private async syncDurableRunStatus(workspaceId: string): Promise<void> {
    const runs = await listTaskRuns({
      workspaceId,
      includeCompleted: true,
      includeProgressSummary: true,
      limit: 10,
    });
    const candidate =
      runs.find((run) => run.stopRequestedAt != null) ??
      runs.find((run) => this.canDurableRunResume(run)) ??
      null;
    this.sendDurableRunStatus(workspaceId, candidate);
  }

  private async applyDurableStopRequest(
    run: DurableTaskRunSummary,
    requestedAt: number,
  ): Promise<void> {
    const localTask = this.tasksByWorkspace.get(run.workspaceId);
    this.sendDurableRunStatus(run.workspaceId, run);
    if (
      localTask &&
      localTask.runId === run.id &&
      (localTask.status === "running" || localTask.status === "planning")
    ) {
      this.emitTraceEvent(
        localTask,
        "durable_run_stop_requested",
        {
          runId: run.id,
          workspaceId: run.workspaceId,
          requestedAt,
        },
        "system",
      );
      localTask.durableMeta = {
        ...(localTask.durableMeta ?? {}),
        stopRequestedAt: null,
        stopRequestedReason: null,
      };
      await this.stopWorkspace(run.workspaceId);
      return;
    }

    await patchTaskRun(run.id, {
      stopRequestedAt: null,
      stopRequestedReason: null,
      status: "stopped",
      finishedAt: Date.now(),
      terminationReason:
        run.stopRequestedReason ?? "Stopped from durable control plane",
    });
    this.sendDurableRunStatus(run.workspaceId, null);
  }

  private async applyDurableResumeRequest(
    run: DurableTaskRunSummary,
    requestedAt: number,
  ): Promise<void> {
    if (this.tasksByWorkspace.has(run.workspaceId)) {
      await patchTaskRun(run.id, {
        resumeRequestedAt: null,
        resumeRequestedReason: null,
        lastKnownResumeSafe: false,
        lastResumeSafetyCheckedAt: Date.now(),
        lastKnownResumeReason: "Workspace already has an active task.",
      });
      this.sendDurableRunStatus(run.workspaceId, run);
      return;
    }

    const resume = await fetchTaskRunResume(run.id);
    if (!this.isDurableResumeStructurallyValid(resume)) {
      await patchTaskRun(run.id, {
        resumeRequestedAt: null,
        resumeRequestedReason: null,
        lastKnownResumeSafe: false,
        lastResumeSafetyCheckedAt: Date.now(),
        lastKnownResumeReason: "Missing or invalid durable resume payload.",
      });
      this.sendDurableRunStatus(run.workspaceId, {
        ...run,
        lastKnownResumeSafe: false,
        lastResumeSafetyCheckedAt: Date.now(),
        lastKnownResumeReason: "Missing or invalid durable resume payload.",
      });
      return;
    }

    const resumeSelection = await this.resolveResumeTabId(
      {
        workspaceId: run.workspaceId,
        rootTabId: resume.run.rootTabId ?? run.rootTabId ?? 0,
        rootTabUrl: resume.run.rootTabUrl ?? null,
        tabCoordination: undefined,
      },
      resume.run.rootTabId ?? run.rootTabId ?? 0,
    );
    if (resumeSelection.status !== "safe") {
      await patchTaskRun(run.id, {
        resumeRequestedAt: null,
        resumeRequestedReason: null,
        lastKnownResumeSafe: false,
        lastResumeSafetyCheckedAt: Date.now(),
        lastKnownResumeReason: resumeSelection.reason,
      });
      this.sendDurableRunStatus(run.workspaceId, {
        ...run,
        lastKnownResumeSafe: false,
        lastResumeSafetyCheckedAt: Date.now(),
        lastKnownResumeReason: resumeSelection.reason,
      });
      return;
    }
    const resumeTabId = resumeSelection.tabId;

    const task = await this.buildTaskFromDurableResume(resume, resumeTabId);
    const resumeInput =
      task && (await this.buildResumeInput(task, resumeTabId));
    if (!task || !resumeInput) {
      await patchTaskRun(run.id, {
        resumeRequestedAt: null,
        resumeRequestedReason: null,
        lastKnownResumeSafe: false,
        lastResumeSafetyCheckedAt: Date.now(),
        lastKnownResumeReason: "Unable to rebuild runtime state for resume.",
      });
      return;
    }

    await patchTaskRun(run.id, {
      resumeRequestedAt: null,
      resumeRequestedReason: null,
      lastKnownResumeSafe: true,
      lastResumeSafetyCheckedAt: Date.now(),
      lastKnownResumeReason: "Live workspace tab rebound successfully.",
      lastResumeSource: "backend",
    });
    if (task) {
      task.durableMeta = {
        ...(task.durableMeta ?? {}),
        lastResumeSource: "backend",
        lastKnownResumeSafe: true,
        lastResumeSafetyCheckedAt: Date.now(),
        lastKnownResumeReason: "Live workspace tab rebound successfully.",
        resumeRequestedAt: null,
        resumeRequestedReason: null,
      };
    }
    await this.activateRecoveredTask(task, resumeInput, resumeTabId, "backend");
    this.emitTraceEvent(
      task,
      "durable_run_resume_applied",
      {
        runId: run.id,
        workspaceId: run.workspaceId,
        requestedAt,
      },
      "system",
    );
    this.sendDurableRunStatus(run.workspaceId, null);
  }

  public async processDurableRunControlRequests(): Promise<void> {
    const runs = await listTaskRuns({
      includeCompleted: true,
      controlRequested: true,
      limit: 20,
    });
    for (const run of runs) {
      const control = this.pickDurableControlAction(run);
      if (!control) continue;
      const watermark = this.durableControlWatermarks.get(run.id) ?? {};
      if (
        (control.action === "resume" &&
          (watermark.resumeRequestedAt ?? 0) >= control.requestedAt) ||
        (control.action === "stop" &&
          (watermark.stopRequestedAt ?? 0) >= control.requestedAt)
      ) {
        continue;
      }
      this.durableControlWatermarks.set(run.id, {
        ...watermark,
        ...(control.action === "resume"
          ? { resumeRequestedAt: control.requestedAt }
          : { stopRequestedAt: control.requestedAt }),
      });

      if (control.action === "stop") {
        await this.applyDurableStopRequest(run, control.requestedAt);
      } else {
        await this.applyDurableResumeRequest(run, control.requestedAt);
      }
    }
  }

  private queueDurableRunSync(runId: string, op: () => Promise<void>): void {
    const previous = this.durableRunSyncs.get(runId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(op)
      .catch((error) => {
        logger.debug("orchestrator", "Durable run sync failed", {
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (this.durableRunSyncs.get(runId) === next) {
          this.durableRunSyncs.delete(runId);
        }
      });
    this.durableRunSyncs.set(runId, next);
  }

  private scheduleDurableTaskSync(task: OrchestratorTask): void {
    if (!task.runId) return;
    const taskSnapshot = cloneTaskForDurableSync(task);
    this.queueDurableRunSync(task.runId, async () => {
      await upsertTaskRun({
        id: taskSnapshot.runId!,
        clientRunId: taskSnapshot.id,
        workspaceId: taskSnapshot.workspaceId,
        query: taskSnapshot.query,
        rootTabId: taskSnapshot.rootTabId ?? null,
        rootTabUrl: taskSnapshot.rootTabUrl ?? null,
        turnNumber: taskSnapshot.turnNumber ?? null,
        status:
          taskSnapshot.status === "stopping" ? "running" : taskSnapshot.status,
        startedAt: taskSnapshot.startedAt ?? null,
        finishedAt: taskSnapshot.finishedAt ?? null,
        terminationReason: taskSnapshot.terminationReason ?? null,
        checkpointSummary: this.buildDurableCheckpointSummary(taskSnapshot),
        sessionMetrics: taskSnapshot.sessionMetrics as unknown as Record<
          string,
          unknown
        >,
        budget: taskSnapshot.budget as Record<string, unknown>,
        resumeStateVersion: 1,
        resumeRequestedAt: taskSnapshot.durableMeta?.resumeRequestedAt ?? null,
        resumeRequestedReason:
          taskSnapshot.durableMeta?.resumeRequestedReason ?? null,
        stopRequestedAt: taskSnapshot.durableMeta?.stopRequestedAt ?? null,
        stopRequestedReason:
          taskSnapshot.durableMeta?.stopRequestedReason ?? null,
        lastResumeSource: taskSnapshot.durableMeta?.lastResumeSource ?? null,
        lastKnownResumeSafe:
          taskSnapshot.durableMeta?.lastKnownResumeSafe ?? null,
        lastResumeSafetyCheckedAt:
          taskSnapshot.durableMeta?.lastResumeSafetyCheckedAt ?? null,
        lastKnownResumeReason:
          taskSnapshot.durableMeta?.lastKnownResumeReason ?? null,
      });

      await updateTaskRunCheckpoint(
        taskSnapshot.runId!,
        this.buildDurableCheckpointSummary(taskSnapshot),
      );

      for (const node of taskSnapshot.nodes) {
        await upsertTaskRunNode(taskSnapshot.runId!, {
          nodeId: node.id,
          description: node.description,
          successCriteria: node.successCriteria,
          selectedSkillId: node.selectedSkillId ?? null,
          selectedSkillReason: node.selectedSkillReason ?? null,
          allowedTools: [...node.allowedTools],
          dependencies: [...node.dependencies],
          assumptions: [...node.assumptions],
          verificationGate: node.verificationGate
            ? (node.verificationGate as unknown as Record<string, unknown>)
            : null,
          handoffArtifacts: [...node.handoffArtifacts],
          reflexionLog: [...node.reflexionLog],
          handoffDepth: node.handoffDepth,
          handoffFromNodeId: node.handoffFromNodeId ?? null,
          trajectory: node.trajectory ? [...node.trajectory] : null,
          status: node.status,
          retries: node.retries,
          result: node.result ?? null,
          error: node.error ?? null,
        });
      }

      const pendingInteraction = taskSnapshot.pendingInteraction;
      await upsertTaskRunPendingInteraction(
        taskSnapshot.runId!,
        pendingInteraction
          ? {
              nodeId: pendingInteraction.nodeId ?? null,
              kind: pendingInteraction.kind,
              payload: pendingInteraction as unknown as Record<string, unknown>,
              requestedAt: pendingInteraction.requestedAt,
              timeoutAt:
                pendingInteraction.timeoutMs != null
                  ? pendingInteraction.requestedAt +
                    pendingInteraction.timeoutMs
                  : null,
              status:
                pendingInteraction.kind === "approval"
                  ? pendingInteraction.approved !== undefined
                    ? "resolved"
                    : "active"
                  : pendingInteraction.answer !== undefined
                    ? "resolved"
                    : "active",
            }
          : null,
      );

      for (const progress of Object.values(
        taskSnapshot.structuredProgress ?? {},
      )) {
        await upsertTaskRunProgress(taskSnapshot.runId!, progress);
      }
    });
  }

  private async persistTaskCheckpoint(task: OrchestratorTask): Promise<void> {
    const checkpoints = await loadOrchestratorCheckpoints();
    const pendingFeedback = this.pendingFeedbackQueue.get(task.workspaceId);
    checkpoints[task.workspaceId] = {
      version: CHECKPOINT_VERSION,
      savedAt: Date.now(),
      task: {
        ...task,
        nodes: task.nodes.map((n) => ({ ...n })),
      },
      ...(pendingFeedback?.length
        ? { pendingFeedback: [...pendingFeedback] }
        : {}),
    };
    await saveOrchestratorCheckpoints(checkpoints);
    this.scheduleDurableTaskSync(task);
  }

  private async clearTaskCheckpoint(workspaceId: string): Promise<void> {
    const checkpoints = await loadOrchestratorCheckpoints();
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
    await saveOrchestratorCheckpoints(checkpoints);
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

  private async buildResumeInput(
    task: OrchestratorTask,
    resumeTabId: number,
  ): Promise<OrchestratorStartInput | null> {
    const settings = (await loadSettings()) ?? ({} as UserSettings);
    type ProviderMode = NonNullable<UserSettings["providerMode"]>;
    const pickFallbackProvider = (): {
      mode: ProviderMode;
      activeKey: string;
    } | null => {
      const candidateModes: ProviderMode[] = [
        "openrouter",
        "fireworks-deepseek",
        "fireworks",
        "moonshot",
        "xiaomi",
        "openai-groq",
      ];
      for (const mode of candidateModes) {
        const status = getProviderKeyStatus({
          ...settings,
          providerMode: mode,
        });
        if (status.hasRequiredKeys && status.activeKey) {
          return { mode, activeKey: status.activeKey };
        }
      }
      return null;
    };
    const configuredMode: ProviderMode =
      settings.providerMode ??
      (settings.openRouterApiKey
        ? "openrouter"
        : settings.fireworksApiKey && settings.deepseekApiKey
          ? "fireworks-deepseek"
          : settings.kimiApiKey
            ? "moonshot"
            : settings.xiaomiApiKey
              ? "xiaomi"
              : "fireworks");
    const configuredStatus = getProviderKeyStatus({
      ...settings,
      providerMode: configuredMode,
    });
    const provider =
      configuredStatus.hasRequiredKeys && configuredStatus.activeKey
        ? { mode: configuredMode, activeKey: configuredStatus.activeKey }
        : pickFallbackProvider();
    if (!provider) {
      logger.warn(
        "orchestrator",
        "Cannot resume task without API key for active provider",
        {
          workspaceId: task.workspaceId,
          providerMode: configuredMode,
          missingKeys: formatMissingProviderKeys(configuredStatus),
        },
      );
      return null;
    }
    const resumeSettings: UserSettings = {
      ...settings,
      providerMode: provider.mode,
    };

    return {
      query: task.query,
      tabId: resumeTabId,
      workspaceId: task.workspaceId,
      settings: resumeSettings,
      openRouterApiKey: provider.activeKey,
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

    if (interaction.kind === "clarification") {
      this.recordOutstandingQuestion(task, interaction.question);
    }

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
      void agentNotifications.notifyAttention({
        workspaceId: task.workspaceId,
        taskId: task.id,
        eventId: interaction.approvalId,
        tabId: task.rootTabId,
        reason: "Approval required",
        detail: interaction.context,
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
    void agentNotifications.notifyAttention({
      workspaceId: task.workspaceId,
      taskId: task.id,
      eventId: interaction.clarificationId,
      tabId: task.rootTabId,
      reason: "Clarification required",
      detail: interaction.question,
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
    this.clearOutstandingQuestions(task);
    task.finishedAt = Date.now();
    task.status = terminalStatus;
    task.sessionMetrics.totalSessionTimeMs =
      task.finishedAt - (task.startedAt || task.createdAt);

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
      terminationReason: terminalStatus === "failed" ? summary : undefined,
    };

    this.cacheAndPersistCompletion(task.workspaceId, completionPayload);
    await this.persistTaskCheckpoint(task);
    if (task.runId) {
      await (this.durableRunSyncs.get(task.runId) ?? Promise.resolve());
    }
    this.sendMessage({
      type: "TASK_COMPLETION",
      workspaceId: task.workspaceId,
      payload: completionPayload,
    });
    this.notifyTaskCompletion(task, completionPayload);
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

    const resumeSelection = await this.resolveResumeTabId(task, task.rootTabId);
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
      task.status = "failed";
      task.finishedAt = Date.now();
      task.terminationReason = `Could not resume after user interaction. ${resumeSelection.reason}`;
      await this.sendTerminationCompletion(task, task.terminationReason);
      await this.clearTaskCheckpoint(task.workspaceId);
      this.tasksByWorkspace.delete(task.workspaceId);
      this.cleanupWorkspaceRuntime(task.workspaceId);
      return;
    }
    const resumeTabId = resumeSelection.tabId;

    const resumeInput = await this.buildResumeInput(task, resumeTabId);
    if (!resumeInput) {
      task.status = "failed";
      task.finishedAt = Date.now();
      task.terminationReason =
        "Could not rebuild runtime settings after user interaction.";
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
    if (
      !task ||
      !interaction ||
      this.isPendingInteractionResolved(interaction)
    ) {
      return;
    }

    if (interaction.kind === "clarification") {
      this.recordOutstandingQuestion(task, interaction.question);
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
    await this.resolvePendingInteraction(task, resolvedInteraction);
  }

  private async resolvePendingInteraction(
    task: OrchestratorTask,
    interaction: PendingUserInteraction,
  ): Promise<void> {
    task.pendingInteraction = interaction;
    this.clearPendingInteractionTimer(task.workspaceId);
    this.clearOutstandingQuestions(task);
    if (interaction.nodeId) {
      const targetNode = task.nodes.find(
        (node) => node.id === interaction.nodeId,
      );
      if (targetNode?.status === "running") {
        targetNode.status = "pending";
      }
    }
    task.currentIndex = currentIndex(task.nodes);
    await this.persistTaskCheckpoint(task);
    await this.resumeTaskAfterInteraction(task);
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
            // Best-effort; backend restores start without loop-local history
          }
        }
      }
    }

    (task as any)._turnCheckpoints = turnCheckpointsByNodeId;

    const hasPendingInteraction = Boolean(task.pendingInteraction);
    const pendingInteractionResolved = this.isPendingInteractionResolved(
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
    task.durableMeta = {
      ...(task.durableMeta ?? {}),
      lastResumeSource: source === "backend" ? "backend" : "local",
      lastKnownResumeSafe: true,
      lastResumeSafetyCheckedAt: Date.now(),
      lastKnownResumeReason: "Recovered onto a live workspace tab.",
      resumeRequestedAt: null,
      resumeRequestedReason: null,
    };
    task.status = "running";
    task.currentIndex = currentIndex(task.nodes);
    this.tasksByWorkspace.set(task.workspaceId, task);
    this.initializeWorkspaceRuntime(task.workspaceId, task.maxWorkers, task);
    await this.persistTaskCheckpoint(task);
    this.sendDurableRunStatus(task.workspaceId, null);
    await this.emitTraceManifest({
      ...this.buildTaskManifest(task, resumeInput),
      source:
        source === "backend"
          ? "background.orchestrator.backend-recovery"
          : "background.orchestrator.recovery",
    });
    this.emitTabCoordinationState(task, "rebound", {
      resumeSource: source === "backend" ? "backend" : "local",
      reboundTabId: resumeTabId,
      reason: task.durableMeta.lastKnownResumeReason ?? null,
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
          remainingMs: this.getPendingInteractionRemainingMs(interaction),
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

  public async restoreFromCheckpoints(): Promise<void> {
    const checkpoints = await pruneOrchestratorCheckpoints(
      await loadOrchestratorCheckpoints(),
    );
    const entries = Object.values(checkpoints);
    const seenWorkspaceIds = new Set<string>(
      entries.map((cp) => cp.task.workspaceId),
    );

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
        await this.clearTaskCheckpoint(task.workspaceId);
        continue;
      }
      if (cp.pendingFeedback?.length) {
        this.pendingFeedbackQueue.set(task.workspaceId, [
          ...cp.pendingFeedback,
        ]);
      } else {
        this.pendingFeedbackQueue.delete(task.workspaceId);
      }

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
        await this.clearTaskCheckpoint(task.workspaceId);
        continue;
      }
      const resumeTabId = resumeSelection.tabId;

      const backendResume =
        task.runId != null ? await fetchTaskRunResume(task.runId) : null;
      const preferBackend =
        backendResume &&
        this.isDurableResumeStructurallyValid(backendResume) &&
        backendResume.run.updatedAt > cp.savedAt &&
        JSON.stringify(backendResume.pendingInteraction) !==
          JSON.stringify(task.pendingInteraction);

      if (preferBackend) {
        const restoredTask = await this.buildTaskFromDurableResume(
          backendResume!,
          resumeTabId,
        );
        const backendResumeInput =
          restoredTask &&
          (await this.buildResumeInput(restoredTask, resumeTabId));
        if (restoredTask && backendResumeInput) {
          this.emitTraceEvent(
            task,
            "task_resume_local_rejected",
            {
              taskId: task.id,
              workspaceId: task.workspaceId,
              reason: "backend_newer_conflicting_pending_interaction",
            },
            "system",
          );
          await this.activateRecoveredTask(
            restoredTask,
            backendResumeInput,
            resumeTabId,
            "backend",
          );
          continue;
        }
      }

      const resumeInput = await this.buildResumeInput(task, resumeTabId);
      if (!resumeInput) {
        await this.clearTaskCheckpoint(task.workspaceId);
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

    const discoveredRuns = await this.discoverBackendRunCandidates();
    for (const run of discoveredRuns) {
      if (seenWorkspaceIds.has(run.workspaceId)) continue;
      const resume = await fetchTaskRunResume(run.id);
      if (!this.isDurableResumeStructurallyValid(resume)) {
        this.emitTraceEvent(
          {
            runId: run.id,
            id: run.clientRunId ?? undefined,
            workspaceId: run.workspaceId,
          },
          "task_resume_backend_invalid",
          {
            workspaceId: run.workspaceId,
            reason: "missing_or_invalid_resume_payload",
          },
          "system",
        );
        continue;
      }
      const resumeSelection = await this.resolveResumeTabId(
        {
          workspaceId: run.workspaceId,
          rootTabId: resume.run.rootTabId ?? run.rootTabId ?? 0,
          rootTabUrl: resume.run.rootTabUrl ?? null,
          tabCoordination: undefined,
        },
        resume.run.rootTabId ?? run.rootTabId ?? 0,
      );
      if (resumeSelection.status !== "safe") {
        await patchTaskRun(run.id, {
          lastKnownResumeSafe: false,
          lastResumeSafetyCheckedAt: Date.now(),
          lastKnownResumeReason: resumeSelection.reason,
        });
        continue;
      }
      const resumeTabId = resumeSelection.tabId;

      const task = await this.buildTaskFromDurableResume(resume, resumeTabId);
      const resumeInput =
        task && (await this.buildResumeInput(task, resumeTabId));
      if (!task || !resumeInput) continue;

      await this.activateRecoveredTask(
        task,
        resumeInput,
        resumeTabId,
        "backend",
      );
      seenWorkspaceIds.add(run.workspaceId);
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
    this.sendDurableRunStatus(task.workspaceId, null);
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

  hasActiveTask(workspaceId: string | null | undefined): boolean {
    if (!workspaceId) return false;
    return this.tasksByWorkspace.has(workspaceId);
  }

  private getRecentCompletionContext(workspaceId: string): string {
    const now = Date.now();
    const freshEntries = (this.recentCompletionHistory.get(workspaceId) ?? [])
      .filter((entry) => now - entry.timestamp < RECENT_COMPLETION_TTL_MS)
      .slice(-MAX_RECENT_COMPLETION_HISTORY);
    if (freshEntries.length === 0) {
      this.recentCompletionHistory.delete(workspaceId);
      return "";
    }
    this.recentCompletionHistory.set(workspaceId, freshEntries);
    return freshEntries
      .map((entry, index) => {
        const summary = (entry.payload.summary || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, MAX_RECENT_COMPLETION_LINE_CHARS);
        return summary ? `- Assistant result ${index + 1}: ${summary}` : "";
      })
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_RECENT_COMPLETION_CONTEXT_CHARS);
  }

  /**
   * Re-broadcast the current state for a workspace so the side panel can
   * recover transient UI state after a workspace switch.
   */
  async resyncWorkspaceState(workspaceId: string): Promise<void> {
    const task = this.tasksByWorkspace.get(workspaceId);

    if (!task) {
      const recovered =
        await this.recoverWorkspaceFromDurableState(workspaceId);
      if (recovered) return;

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
      void this.syncDurableRunStatus(workspaceId);
      return;
    }

    this.sendDurableRunStatus(workspaceId, null);

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
      const subtaskResults: SubtaskResult[] = this.buildSubtaskResults(task);
      const completed = subtaskResults.filter(
        (r) => r.status === "completed",
      ).length;

      this.sendMessage({
        type: "TASK_COMPLETION",
        workspaceId,
        payload: {
          taskId: task.id,
          status:
            task.status === "stopped"
              ? "stopped"
              : task.status === "completed"
                ? completed === subtaskResults.length
                  ? "completed"
                  : "partial"
                : "failed",
          totalTurnsUsed: 0,
          totalTimeMs:
            (task.finishedAt || Date.now()) -
            (task.startedAt || task.createdAt),
          summary:
            task.status === "stopped"
              ? task.terminationReason || "Stopped by user"
              : this.buildProgrammaticSummary(task),
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

    const personalContextBrief = buildPersonalProfilePlannerContext(
      input.query,
      await loadPersonalizationState().catch(() => EMPTY_PERSONALIZATION_STATE),
    );
    const recentCompletionContext = this.getRecentCompletionContext(
      input.workspaceId,
    );
    const conversationContextBrief = [
      input.conversationContextBrief?.trim() || "",
      recentCompletionContext,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_RECENT_COMPLETION_CONTEXT_CHARS);

    const plannerContextSections = [
      conversationContextBrief
        ? `RECENT WORKSPACE CONVERSATION:\n${conversationContextBrief}`
        : "",
      personalContextBrief,
    ].filter(Boolean);
    const plannerQuery =
      plannerContextSections.length > 0
        ? `${plannerContextSections.join("\n\n")}\n\nCURRENT REQUEST:\n${input.query}`
        : input.query;
    const taskId = crypto.randomUUID();
    const laneTopology = resolveLaneTopologyFromSettings(input.settings);
    const task: OrchestratorTask = {
      runId: crypto.randomUUID(),
      id: taskId,
      workspaceId: input.workspaceId,
      rootTabId: input.tabId,
      rootTabUrl: null,
      query: input.query,
      turnNumber: 1,
      personalContextBrief: personalContextBrief || undefined,
      conversationContextBrief: conversationContextBrief || undefined,
      status: "planning",
      createdAt: Date.now(),
      nodes: [],
      plannerReflexionLog: [],
      maxWorkers: Math.max(
        1,
        Math.min(8, laneTopology.maxWorkers ?? DEFAULT_MAX_WORKERS),
      ),
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
      tabCoordination: createTaskTabCoordination(input.tabId),
      laneTopologyMode: laneTopology.mode,
      enabledSkillPackIds: input.settings.enabledSkillPackIds
        ? [...input.settings.enabledSkillPackIds]
        : undefined,
    };
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
    this.tasksByWorkspace.set(input.workspaceId, task);
    this.initializeWorkspaceRuntime(input.workspaceId, task.maxWorkers, task);
    await this.persistTaskCheckpoint(task);
    this.sendDurableRunStatus(task.workspaceId, null);
    await this.emitTraceManifest(this.buildTaskManifest(task, input));
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
    const usePlannerDecomposition = shouldUsePlannerDecomposition(laneTopology);
    if (!usePlannerDecomposition) {
      const tab = await chrome.tabs.get(input.tabId).catch(() => null);
      nodes = buildDirectExecutionNodes(
        input.query,
        "planned",
        tab?.title || "Untitled",
        tab?.url || "",
      );
      task.planClassification = {
        isSingleNode: nodes.length === 1,
        difficulty: "simple",
      };
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
          structured: false,
          fallback: true,
          plannerSkipped: true,
          laneTopologyMode: laneTopology.mode,
          graph: buildPlanTraceGraph(nodes),
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
            label: "Planning skipped",
            detail: "Simple lane topology selected a single executor path.",
            status: "done",
            timestamp: Date.now(),
          },
          update: false,
        },
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
          useNitro: input.settings.useNitro,
          providerMode: input.settings.providerMode,
          provider: input.settings.provider,
          openaiApiKey: input.settings.openaiApiKey,
          groqApiKey: input.settings.groqApiKey,
          temperature: input.settings.temperature,
          perceptionMode: input.settings.perceptionMode,
          useVLExecutor: input.settings.useVLExecutor,
          fireworksApiKey: input.settings.fireworksApiKey,
          deepseekApiKey: input.settings.deepseekApiKey,
          kimiApiKey: input.settings.kimiApiKey,
          xiaomiApiKey: input.settings.xiaomiApiKey,
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
            laneTopologyMode: laneTopology.mode,
            graph: buildPlanTraceGraph(nodes),
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
        logger.warn(
          "orchestrator",
          "Planner failed, using synthesized fallback graph",
          {
            error: error?.message,
          },
        );
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
            laneTopologyMode: laneTopology.mode,
            graph: buildPlanTraceGraph(nodes),
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
              providerMode: input.settings.providerMode,
              provider: input.settings.provider,
              openaiApiKey: input.settings.openaiApiKey,
              groqApiKey: input.settings.groqApiKey,
              temperature: input.settings.temperature,
              fireworksApiKey: input.settings.fireworksApiKey,
              deepseekApiKey: input.settings.deepseekApiKey,
              kimiApiKey: input.settings.kimiApiKey,
              xiaomiApiKey: input.settings.xiaomiApiKey,
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

    const getDurableRecoveryUrl = (): string | null => {
      for (const candidate of [task.rootTabUrl, initialTabUrl]) {
        if (
          candidate &&
          candidate !== "about:blank" &&
          candidate !== "about:newtab" &&
          !candidate.startsWith("chrome://") &&
          !candidate.startsWith("chrome-extension://")
        ) {
          return candidate;
        }
      }
      return null;
    };

    const resolveRunnableTabId = async (
      preferredTabId: number | null | undefined,
    ): Promise<number | null> => {
      if (
        typeof preferredTabId === "number" &&
        (await isUsableTab(preferredTabId))
      ) {
        return preferredTabId;
      }

      const rebound = await this.resolveResumeTabId(
        task,
        typeof preferredTabId === "number" ? preferredTabId : input.tabId,
      );
      if (rebound.status === "safe" && (await isUsableTab(rebound.tabId))) {
        return rebound.tabId;
      }

      const recoveryUrl = getDurableRecoveryUrl();
      if (recoveryUrl && input.settings.allowNavigation !== false) {
        const recoveredTabId = await this.createWorkerTab(task, recoveryUrl);
        claimTaskTab(task, {
          tabId: recoveredTabId,
          role: "primary",
          createdByTask: true,
          url: recoveryUrl,
        });
        this.emitTabCoordinationState(task, "rebound", {
          tabId: recoveredTabId,
          reason:
            rebound.status === "unsafe"
              ? rebound.reason
              : "Recovered onto a fresh task tab at the durable root URL.",
          recoveryUrl,
        });
        return recoveredTabId;
      }

      return null;
    };

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
      const workerIndex = nextWorkerIndex++;
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
      ensureTaskTabCoordination(task, {
        primaryTabId: task.rootTabId,
        primaryTabUrl: task.rootTabUrl ?? null,
      });
      const previousTabId =
        getNodeBoundTabId(task, node.id) ?? nodeTabMap.get(node.id);
      if (previousTabId != null) {
        // 1. Retry: reuse the previous tab only if it still has a usable page.
        tabId = (await resolveRunnableTabId(previousTabId)) ?? input.tabId;
      } else if (nodeTabMap.size === 0) {
        // 2. First node: use the user's original tab
        tabId = (await resolveRunnableTabId(input.tabId)) ?? input.tabId;
      } else {
        // 3. Sequential dependency: reuse the predecessor's tab
        const depTabId = node.dependencies
          .map((depId) => nodeTabMap.get(depId))
          .find((id) => id != null);
        if (depTabId != null) {
          tabId =
            (await resolveRunnableTabId(depTabId)) ??
            (await resolveRunnableTabId(input.tabId)) ??
            input.tabId;
        } else if (input.settings.allowNavigation === false) {
          // allowNavigation disabled: never create new tabs
          tabId = (await resolveRunnableTabId(input.tabId)) ?? input.tabId;
        } else if (
          isTabOccupiedByRunningNode(input.tabId, nodeTabMap, task.nodes)
        ) {
          // 4. User's tab is occupied by a running node — create if under cap
          const createdCount = countOpenOwnedAuxiliaryTabs(task);
          if (createdCount < task.maxWorkers - 1) {
            tabId = await this.createWorkerTab(task, initialTabUrl);
            if (!task.createdWorkerTabIds) task.createdWorkerTabIds = [];
            if (!task.createdWorkerTabIds.includes(tabId)) {
              task.createdWorkerTabIds.push(tabId);
            }
          } else {
            // Over cap: fallback to user's tab
            tabId = (await resolveRunnableTabId(input.tabId)) ?? input.tabId;
          }
        } else {
          // 5. User's tab is free: reuse it
          tabId = (await resolveRunnableTabId(input.tabId)) ?? input.tabId;
        }
      }
      nodeTabMap.set(node.id, tabId);
      try {
        const assignedTab = await chrome.tabs.get(tabId);
        bindNodeToTaskTab(task, node.id, {
          tabId,
          role: tabId === task.rootTabId ? "primary" : "auxiliary",
          createdByTask: tabId !== task.rootTabId,
          url: assignedTab.url ?? null,
        });
        touchTaskTab(task, tabId, assignedTab.url ?? null);
      } catch {
        bindNodeToTaskTab(task, node.id, {
          tabId,
          role: tabId === task.rootTabId ? "primary" : "auxiliary",
          createdByTask: tabId !== task.rootTabId,
        });
      }
      this.emitTabCoordinationState(task, "node_bound", {
        nodeId: node.id,
        tabId,
        role: tabId === task.rootTabId ? "primary" : "auxiliary",
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
          this.emitTraceEvent(
            task,
            "checkpoint_turn_restored",
            {
              taskId: task.id,
              nodeId: node.id,
              checkpointTurn: candidateTurnCheckpoint.turnCount,
              pageUrl: candidateTurnCheckpoint.pageUrl,
              snapshotFingerprint: candidateTurnCheckpoint.snapshotFingerprint,
            },
            "system",
          );
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
          this.emitTraceEvent(
            task,
            "checkpoint_turn_discarded",
            {
              taskId: task.id,
              nodeId: node.id,
              reason: "snapshot_mismatch",
              checkpointUrl: candidateTurnCheckpoint.pageUrl,
              liveUrl: snapshot?.url ?? null,
              checkpointFingerprint:
                candidateTurnCheckpoint.snapshotFingerprint,
              liveFingerprint: getSnapshotFingerprint(snapshot ?? null),
            },
            "system",
          );
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
        node,
        task.structuredProgress,
      );
      const verifierTaskStateBrief = buildTaskStateBrief(
        task.nodes,
        node.id,
        "verifier",
        undefined,
        task.structuredProgress,
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
      });
      const nodeToolProfile = getNodeToolProfile(node);

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
            const resolvedLabel = isSingleNode
              ? step.label
              : `Executor: ${step.label}`;
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
          selectedSkillId: node.selectedSkillId,
          enabledSkillPackIds: task.enabledSkillPackIds,
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
                const shouldForwardReplaceContent =
                  replaceContent !== undefined && !done;
                if (shouldForwardReplaceContent || done || thinking) {
                  this.sendMessage({
                    type: "STREAM_CHUNK",
                    workspaceId: task.workspaceId,
                    payload: {
                      delta: "",
                      done,
                      ...(shouldForwardReplaceContent
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
                    ...(nodeToolProfile
                      ? { toolProfile: nodeToolProfile }
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
          deepseekApiKey: input.settings.deepseekApiKey,
          kimiApiKey: input.settings.kimiApiKey,
          xiaomiApiKey: input.settings.xiaomiApiKey,
          temperature: input.settings.temperature,
          perceptionMode: input.settings.perceptionMode,
          maxImagePromptTokenEstimate:
            input.settings.maxImagePromptTokenEstimate,
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
      this.drainPendingFeedbackIntoLoop(
        task.workspaceId,
        loop,
        workerId,
        node.id,
      );
      logger.debug("orchestrator", "Executor worker registered in lane pool", {
        taskId: task.id,
        workspaceId: task.workspaceId,
        workerId,
        nodeId: node.id,
        lane: "executor",
        activeExecutorWorkers: wsPools.executor.size,
      });

      try {
        const parallelContext = buildExecutorParallelContext({
          node,
          allNodes: task.nodes,
          workerIndex,
        });
        let executorInstruction = buildExecutorInstruction(
          node,
          taskStateBrief,
          driftSignal,
          undefined, // node.description used directly
          task.query,
          verificationTurnMode,
          task.personalContextBrief,
          parallelContext,
        );
        if (task.conversationContextBrief) {
          executorInstruction +=
            "\n\nRecent workspace conversation:\n" +
            task.conversationContextBrief +
            "\nUse this only to resolve follow-up references and preserve facts from earlier turns; the current request remains authoritative.";
        }

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
        if (
          task.runId &&
          result.sideEffectsLog &&
          result.sideEffectsLog.length > 0
        ) {
          void appendTaskRunSideEffects(
            task.runId,
            result.sideEffectsLog.map((entry) => ({
              id: entry.id,
              nodeId: node.id,
              toolName: entry.toolName,
              args: entry.args,
              result: entry.result,
              timestamp: entry.timestamp,
              snapshotFingerprint: entry.snapshotFingerprint,
            })),
          );
        }
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
          (task.status as string) === "stopping" &&
          result.outcome !== "completed"
        ) {
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
          task.pendingInteraction = result.pendingInteraction;
          if (result.pendingInteraction?.kind === "clarification") {
            this.recordOutstandingQuestion(
              task,
              result.pendingInteraction.question,
            );
          }
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
        const compactResultSummary = compactExecutorSummaryForNode(
          node,
          result.summary,
        );
        const executorEvidence: StructuredEvidence[] = [
          {
            claim: compactResultSummary || "Executor finished without summary.",
            basis: "tool_output",
            confidence: result.outcome === "completed" ? 1.0 : 0.5,
          },
          ...(result.trajectory ?? [])
            .filter((entry) =>
              /\b(inspect_chart|read_page|read_element)\b/.test(entry),
            )
            .slice(-4)
            .map((entry) => ({
              claim: entry,
              basis: "tool_output" as const,
              confidence: result.outcome === "completed" ? 0.85 : 0.5,
              sourceToolCall: entry.match(/\bT\d+:\s*([a-z_]+)/)?.[1],
            })),
          ...(result.evidence ?? []).map((event) => ({
            event,
            claim: `${event.type} from ${event.source}`,
            basis: "tool_output" as const,
            confidence:
              event.confidence === "high"
                ? 1
                : event.confidence === "medium"
                  ? 0.75
                  : 0.4,
            sourceToolCall: event.source,
          })),
          ...(result.completionEnvelope
            ? [
                {
                  claim: `Completion envelope ${result.completionEnvelope.resultId} accepted by ${result.completionEnvelope.contractKind}: ${result.completionEnvelope.decisionReason}`,
                  basis: "tool_output" as const,
                  confidence: 1,
                },
              ]
            : []),
        ];
        this.appendHandoffArtifact(node, {
          role: "executor",
          phase: "executor_finished",
          note: compactResultSummary || "Executor finished without summary.",
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
          this.emitCompletionScopeTransition(task, {
            scope: "lane",
            status: "completed",
            nodeId: node.id,
            reason: "executor_loop_completed",
            envelope: result.completionEnvelope,
          });
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
            const requiredEvidenceTypes = getLoadedSkillContract(
              node.selectedSkillId,
              { enabledSkillPackIds: task.enabledSkillPackIds },
            )?.requiredEvidenceTypes;
            const envelopeVerification = result.completionEnvelope
              ? verifyDeterministicCompletionEnvelope(result.completionEnvelope)
              : null;
            let verification: NodeVerificationResult;
            if (envelopeVerification) {
              verification = envelopeVerification;
              this.emitTraceEvent(
                task,
                "completion_envelope_verification",
                {
                  nodeId: node.id,
                  decision: verification.decision,
                  confidence: verification.confidence,
                  resultId: result.completionEnvelope?.resultId,
                  contractKind: result.completionEnvelope?.contractKind,
                  evidenceKeys: result.completionEnvelope?.evidenceKeys ?? [],
                },
                "verifier",
              );
              logger.debug(
                "orchestrator",
                "Completion envelope verification resolved",
                {
                  taskId: task.id,
                  nodeId: node.id,
                  decision: verification.decision,
                  confidence: verification.confidence,
                  contractKind: result.completionEnvelope?.contractKind,
                },
              );
            } else {
              const programmaticResult = programmaticVerify({
                taskQuery: task.query,
                output: result.summary,
                objective: node.description,
                successCriteria: node.successCriteria,
                evidence: executorEvidence,
                requiredEvidenceTypes,
                previousUrl: snapshot?.url,
                currentUrl,
                previousTitle: snapshot?.title,
                currentTitle,
                executorOutcome: result.outcome,
              });
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
              } else if (
                !shouldUseVerifier(
                  resolveLaneTopologyFromSettings({
                    laneTopologyMode: task.laneTopologyMode,
                  }),
                )
              ) {
                verification = {
                  decision: "accept",
                  reason:
                    "Verifier skipped by lane topology after executor completion.",
                  confidence: 0.7,
                };
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
                    requiredEvidenceTypes,
                    previousUrl: snapshot?.url,
                    currentUrl,
                    previousTitle: snapshot?.title,
                    currentTitle,
                  }),
                );
              }
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
              node.result = compactResultSummary;
              node.userFacingResult = result.summary;
              this.recordCompletedPhase(task, node.description);
              this.maybeRecordReviewedItem(task, node);
              this.maybeRecordExtractedFacts(task, node, compactResultSummary);
              this.emitCompletionScopeTransition(task, {
                scope: "node",
                status: "completed",
                nodeId: node.id,
                reason: verification.reason || "verifier_accept",
                envelope: result.completionEnvelope,
              });
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
                  this.emitNodeFailureAttribution(
                    task,
                    node,
                    "replan_budget_exhausted",
                    {
                      replansUsed: task.replansUsed,
                      maxReplans: task.maxReplans,
                      verifierReason: verification.reason,
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
                          { enabledSkillPackIds: task.enabledSkillPackIds },
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
          this.emitCompletionScopeTransition(task, {
            scope: "lane",
            status: "completed",
            nodeId: node.id,
            reason: "executor_timeout_after_terminal_completion",
            envelope: loop.completedResult.completionEnvelope,
          });
          this.emitCompletionScopeTransition(task, {
            scope: "node",
            status: "completed",
            nodeId: node.id,
            reason: "accepted_terminal_completion_after_executor_timeout",
            envelope: loop.completedResult.completionEnvelope,
          });
          return;
        }

        if (
          isLaneIsolationError(error, "executor") ||
          isLaneIsolationError(error, "verifier") ||
          isLaneIsolationError(error, "planner")
        ) {
          if (
            isLaneIsolationError(error, "executor") &&
            task.status === "running"
          ) {
            const retryDecision = decideRetryPolicy(
              {
                source: "system",
                errorMessage: error?.message || String(error),
              },
              node.retries,
            );
            if (retryDecision.shouldRetry) {
              node.status = "pending";
              node.retries += 1;
              node.error = `Executor lane cooldown: ${error?.message || String(error)} (${retryDecision.rationale})`;
              logger.warn(
                "orchestrator",
                "Retrying node after executor lane isolation",
                {
                  taskId: task.id,
                  nodeId: node.id,
                  retries: node.retries,
                  error,
                },
              );
              this.emitTraceEvent(
                task,
                "scheduler_executor_lane_retry",
                {
                  nodeId: node.id,
                  retries: node.retries,
                  reason: error?.message || String(error),
                },
                "system",
              );
              return;
            }
          }
          node.status = "failed";
          node.error = `Critical lane isolation while executing node: ${error?.message || String(error)}`;
          logger.warn("orchestrator", "Failing node due to lane isolation", {
            taskId: task.id,
            nodeId: node.id,
            error,
          });
          this.emitNodeFailureAttribution(
            task,
            node,
            "executor_lane_isolation",
            {
              error: error?.message || String(error),
            },
          );
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
            ...buildParallelRunState(task),
          },
          "executor",
        );
        this.emitTraceEvent(
          task,
          "worker_released_resource",
          {
            taskId: task.id,
            nodeId: node.id,
            workerId,
            resources: node.parallelContract?.resourceHints ?? [],
            outcome: node.status,
            ...buildParallelRunState(task),
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

    while (task.status === "running" || task.status === "stopping") {
      if (task.status === "stopping") {
        if (running.size > 0) {
          await Promise.race(running);
          continue;
        }
        break;
      }
      if (
        task.pendingInteraction &&
        !this.isPendingInteractionResolved(task.pendingInteraction)
      ) {
        this.sendStatus(
          task.workspaceId,
          AgentStatus.PAUSED,
          "Awaiting user input...",
        );
        await this.persistTaskCheckpoint(task);
        return;
      }
      const runningNodes = task.nodes.filter(
        (node) => node.status === "running",
      );
      const resourceBlocked = getResourceBlockedPendingNodes(
        task.nodes,
        runningNodes,
      );
      for (const blocked of resourceBlocked) {
        const key = `${blocked.node.id}:${blocked.conflicts
          .map((node) => node.id)
          .sort()
          .join(",")}`;
        if (blockedResourceTraceKeys.has(key)) continue;
        blockedResourceTraceKeys.add(key);
        this.emitTraceEvent(
          task,
          "worker_blocked_resource",
          {
            taskId: task.id,
            nodeId: blocked.node.id,
            conflicts: blocked.conflicts.map((node) => ({
              nodeId: node.id,
              resources: node.parallelContract?.resourceHints ?? [],
            })),
            requestedResources:
              blocked.node.parallelContract?.resourceHints ?? [],
            ...buildParallelRunState(task),
          },
          "system",
        );
      }
      const runnable = getRunnablePendingNodes(task.nodes, { runningNodes });
      const executorMaxConcurrent = this.getLaneRuntimeState(
        task.workspaceId,
        "executor",
      ).policy.maxConcurrent;
      const schedulerTopology = resolveLaneTopology(task.laneTopologyMode);
      const schedulerConcurrency = resolveExecutorNodeConcurrency({
        topology: schedulerTopology,
        maxWorkers: task.maxWorkers,
        executorMaxConcurrent,
      });
      logger.debug("orchestrator", "Scheduler cycle", {
        taskId: task.id,
        pending: task.nodes.filter((n) => n.status === "pending").length,
        running: running.size,
        completed: task.nodes.filter((n) => n.status === "completed").length,
        failed: task.nodes.filter((n) => n.status === "failed").length,
        runnable: runnable.length,
        schedulerConcurrency,
        laneTopologyMode: schedulerTopology.mode,
      });

      // Global goal gate: if a node just completed and the final node's
      // success criteria are already satisfied on the page, skip remaining nodes.
      const completedNodes = task.nodes.filter((n) => n.status === "completed");
      const remainingPending = task.nodes.filter((n) => n.status === "pending");
      const hasUnresolvedAttemptedPendingNode = remainingPending.some(
        (node) =>
          node.retries > 0 ||
          Boolean(node.error) ||
          node.handoffArtifacts.some(
            (artifact) =>
              artifact.phase === "executor_finished" &&
              artifact.evidence?.some((entry) => (entry.confidence ?? 1) < 1),
          ),
      );
      if (
        remainingPending.length > 0 &&
        completedNodes.length > 0 &&
        !hasUnresolvedAttemptedPendingNode &&
        isNavigationOnlyRequest(task.query)
      ) {
        try {
          const goalSnap = await this.getSnapshot(input.tabId);
          const navigationCompletion = assessNavigationGoalCompletion({
            query: task.query,
            snapshot: goalSnap,
            completedNodes,
          });
          if (navigationCompletion.satisfied) {
            logger.info(
              "orchestrator",
              "Navigation goal already met, skipping remaining nodes",
              {
                taskId: task.id,
                matchedLabels: navigationCompletion.matchedLabels,
                remainingNodes: remainingPending.length,
              },
            );
            for (const pending of remainingPending) {
              pending.status = "skipped";
              pending.result = "Skipped: navigation goal already achieved";
            }
            this.emitCompletionScopeTransition(task, {
              scope: "root",
              status: "sibling_ignored",
              reason: "navigation_goal_already_achieved",
              skippedNodeIds: remainingPending.map((node) => node.id),
            });
            this.emitTraceEvent(
              task,
              "navigation_goal_gate",
              {
                matchedLabels: navigationCompletion.matchedLabels,
                skippedNodes: remainingPending.length,
                reason: navigationCompletion.reason,
              },
              "system",
            );
            break;
          }
          logger.debug("orchestrator", "Navigation goal gate not satisfied", {
            taskId: task.id,
            reason: navigationCompletion.reason,
            matchedLabels: navigationCompletion.matchedLabels,
          });
        } catch (err) {
          logger.debug("orchestrator", "Navigation goal gate snapshot failed", {
            taskId: task.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      // Only allow skipping when at most 1 node remains pending.
      // Prevents premature skipping after early steps when most work is still ahead.
      if (
        remainingPending.length === 1 &&
        completedNodes.length > 0 &&
        !hasUnresolvedAttemptedPendingNode
      ) {
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
                this.emitCompletionScopeTransition(task, {
                  scope: "root",
                  status: "sibling_ignored",
                  reason: "global_goal_already_achieved",
                  skippedNodeIds: remainingPending.map((node) => node.id),
                });
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
        this.emitTraceEvent(
          task,
          "scheduler_executor_lane_wait",
          {
            taskId: task.id,
            reason,
            runnableNodeIds: runnable.map((node) => node.id),
            remainingMs: Math.max(
              0,
              executorLaneState.isolatedUntilMs - Date.now(),
            ),
          },
          "system",
        );
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(
              1_000,
              Math.max(25, executorLaneState.isolatedUntilMs - Date.now()),
            ),
          ),
        );
        continue;
      }

      while (runnable.length > 0 && running.size < schedulerConcurrency) {
        const node = runnable.shift()!;
        if (!queuedWorkerTraceNodeIds.has(node.id)) {
          queuedWorkerTraceNodeIds.add(node.id);
          this.emitTraceEvent(
            task,
            "worker_queued",
            {
              taskId: task.id,
              nodeId: node.id,
              dependencyCount: node.dependencies.length,
              resources: node.parallelContract?.resourceHints ?? [],
              parallelism: node.parallelContract?.parallelism ?? "unknown",
              ...buildParallelRunState(task),
            },
            "system",
          );
        }
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
        plannerUsagePhase = "horizon_expansion";
        const expanded = await this.tryHorizonExpansion(
          task,
          input,
          replanner as OrchestratorPlanner,
          getBudgetExhaustionReason,
        );
        plannerUsagePhase = "planner_replan";
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
        this.emitNodeFailureAttribution(
          task,
          blockedNode,
          "unsatisfiable_dependencies",
          {
            failedDeps: depState.failedDeps,
            missingDeps: depState.missingDeps,
            dependencies: blockedNode.dependencies,
          },
        );
        this.emitTraceEvent(
          task,
          "scheduler_dependency_failed",
          {
            taskId: task.id,
            nodeId: blockedNode.id,
            failedDeps: depState.failedDeps,
            missingDeps: depState.missingDeps,
            dependencies: blockedNode.dependencies,
          },
          "system",
        );
      }

      if (task.nodes.some((n) => n.status === "failed")) {
        break;
      }

      logger.warn("orchestrator", "Scheduler deadlock detected", {
        taskId: task.id,
        pendingNodeIds: pendingNodes.map((n) => n.id),
      });
      this.emitTraceEvent(
        task,
        "scheduler_deadlock",
        {
          taskId: task.id,
          pendingNodeIds: pendingNodes.map((n) => n.id),
        },
        "system",
      );
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

    const completed = task.nodes.filter((n) => n.status === "completed").length;
    const skipped = task.nodes.filter((n) => isUserSkippedNode(n)).length;
    const failed = task.nodes.filter(
      (n) => n.status === "failed" && !isUserSkippedNode(n),
    ).length;
    task.finishedAt = Date.now();
    task.sessionMetrics.totalSessionTimeMs =
      task.finishedAt - (task.startedAt || task.createdAt);
    task.status = failed > 0 ? "failed" : "completed";

    // Build summary for the structured completion card. The final visible
    // result is emitted only as TASK_COMPLETION so the UI does not briefly show
    // a plain assistant bubble before converting it to a completion card.
    const summary = this.buildProgrammaticSummary(task);
    this.sendMessage({
      type: "STREAM_CHUNK",
      workspaceId: task.workspaceId,
      payload: { delta: "", done: true },
    });

    const subtaskResults = this.buildSubtaskResults(task);
    const penalizedSkipped = task.nodes.filter(
      (node) =>
        node.status === "skipped" && !isUnpenalizedGoalShortcutSkip(node),
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
    this.sendMessage({
      type: "TASK_COMPLETION",
      workspaceId: task.workspaceId,
      payload: completionPayload,
    });
    this.notifyTaskCompletion(task, completionPayload);
    const totalDurationMs =
      task.finishedAt - (task.startedAt || task.createdAt);
    if (completionStatus === "completed") {
      this.emitCompletionScopeTransition(task, {
        scope: "root",
        status: "completed",
        reason: "task_completion_payload_completed",
      });
    }
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
    if (task?.status === "stopped" || task?.status === "stopping") {
      return "stopped";
    }
    const recent = this.recentCompletion.get(workspaceId);
    if (!recent) return null;
    if (recent.payload.status === "stopped") return "stopped";
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
      const listeners = this.completionWaiters.get(workspaceId) ?? new Set();
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

  private async finalizeStoppedTask(
    task: OrchestratorTask,
    detail: string,
    phase: "planning" | "execution" | "system" = "system",
  ): Promise<void> {
    task.status = "stopped";
    task.finishedAt = Date.now();
    this.clearPendingInteractionTimer(task.workspaceId);
    task.pendingInteraction = undefined;
    const pendingEscalationId = task.pendingEscalation?.packet.escalationId;
    if (pendingEscalationId) {
      this.pendingEscalationResolvers.delete(pendingEscalationId);
      task.pendingEscalation = undefined;
    }
    if (task.nodes.length > 0) {
      await this.sendTerminationCompletion(task, detail);
    }
    if (task.runId) {
      await patchTaskRun(task.runId, {
        status: "stopped",
        finishedAt: task.finishedAt,
        terminationReason: detail,
        stopRequestedAt: null,
        stopRequestedReason: null,
        resumeRequestedAt: null,
        resumeRequestedReason: null,
      });
    }
    this.sendDurableRunStatus(task.workspaceId, null);
    await this.closeWorkerTabs(task);
    this.tasksByWorkspace.delete(task.workspaceId);
    this.cleanupWorkspaceRuntime(task.workspaceId);
    await this.clearTaskCheckpoint(task.workspaceId);
    this.emitTraceEvent(
      task,
      "task_stopped",
      { taskId: task.id, phase },
      "system",
    );
    this.sendStatus(task.workspaceId, AgentStatus.IDLE, "Stopped");
    void agentNotifications.notifyStopped({
      workspaceId: task.workspaceId,
      taskId: task.id,
      tabId: task.rootTabId,
      detail,
    });
    resetTabGroupAppearance(task.workspaceId);
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
    for (const [id, resolver] of this.pendingPlanConfirmationResolvers) {
      resolver({ decision: "cancel" });
      this.pendingPlanConfirmationResolvers.delete(id);
    }
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
      this.sendStatus(
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
    await this.finalizeStoppedTask(task, "Stopped by user", "system");
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
    task: OrchestratorTask,
    url: string,
  ): Promise<number> {
    const tab = await chrome.tabs.create({ url, active: false });
    if (!tab.id) throw new Error("Failed to create worker tab");
    await this.deps.workspaceManager.addTabToWorkspace(
      tab.id,
      task.workspaceId,
    );
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
      (lastCompleted?.userFacingResult || lastCompleted?.result)
    ) {
      return lastCompleted.userFacingResult || lastCompleted.result || "";
    }

    // Multi-node completed: aggregate results from all completed nodes.
    // Each node may have collected data that the final summary needs
    // (e.g. "read inventory on page A, go back, read inventory on page B,
    // report both"). Only the combined results satisfy the full task.
    if (completedNodes.length > 1 && lastCompleted?.result) {
      const nodeResults = completedNodes
        .map((n) => n.userFacingResult || n.result || "")
        .filter((result) => result.trim())
        .map((result) => result.trim());

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

    if (
      completedNodes.length > 0 &&
      (lastCompleted?.userFacingResult || lastCompleted?.result)
    ) {
      return lastCompleted.userFacingResult || lastCompleted.result || "";
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
        replanner.planNextHorizon(task.query, summary, pageTitle, pageUrl, {
          enabledSkillPackIds: task.enabledSkillPackIds,
        }),
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
    const payload = {
      taskId: task.id,
      subtasks: toSubtasks(task.nodes),
      currentIndex: task.currentIndex,
      totalTurnsUsed: 0,
    };
    this.sendMessage({
      type: "TASK_PROGRESS",
      workspaceId: task.workspaceId,
      payload,
    });
    chrome.tabs
      .sendMessage(task.rootTabId, {
        type: "TASK_PROGRESS",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload,
      })
      .catch(() => {});
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
    if (payload.summary) {
      const history = this.recentCompletionHistory.get(workspaceId) ?? [];
      history.push({ payload, timestamp: Date.now() });
      this.recentCompletionHistory.set(
        workspaceId,
        history.slice(-MAX_RECENT_COMPLETION_HISTORY),
      );
    }
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
            completionData: payload,
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

  private notifyTaskCompletion(
    task: OrchestratorTask,
    payload: TaskCompletionMessage["payload"],
  ): void {
    if (task.status === "stopped") return;
    void agentNotifications.notifyTaskCompletion({
      workspaceId: task.workspaceId,
      tabId: task.rootTabId,
      payload,
    });
  }

  private buildSubtaskResults(task: OrchestratorTask): SubtaskResult[] {
    const taskStopped = task.status === "stopped" || task.status === "stopping";
    return task.nodes.map((node) => ({
      description: node.description,
      status:
        node.status === "completed"
          ? "completed"
          : isUserSkippedNode(node)
            ? "skipped"
            : taskStopped &&
                (node.status !== "failed" ||
                  /(?:stopped|cancelled) by user/i.test(
                    `${node.result || ""}\n${node.error || ""}`,
                  ))
              ? "stopped"
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
    const stopped = task.status === "stopped" || task.status === "stopping";

    const completionPayload: TaskCompletionMessage["payload"] = {
      taskId: task.id,
      status: stopped ? "stopped" : completed > 0 ? "partial" : "failed",
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
    this.sendMessage({
      type: "TASK_COMPLETION",
      workspaceId: task.workspaceId,
      payload: completionPayload,
    });
    this.notifyTaskCompletion(task, completionPayload);
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
    void agentNotifications.notifyAttention({
      workspaceId: task.workspaceId,
      taskId: task.id,
      eventId: packet.escalationId,
      tabId: task.rootTabId,
      reason: "Escalation required",
      detail: packet.reason,
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
    const workspaceTask = workspaceId
      ? this.tasksByWorkspace.get(workspaceId)
      : undefined;
    const task =
      (workspaceTask?.pendingInteraction?.kind === "approval" &&
      workspaceTask.pendingInteraction.approvalId === payload.approvalId
        ? workspaceTask
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
    const workspaceTask = workspaceId
      ? this.tasksByWorkspace.get(workspaceId)
      : undefined;
    const task =
      (workspaceTask?.pendingInteraction?.kind === "clarification" &&
      workspaceTask.pendingInteraction.clarificationId ===
        payload.clarificationId
        ? workspaceTask
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
    nodes: {
      description: string;
      successCriteria: string;
      selectedSkillId?: string;
    }[],
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
    void agentNotifications.notifyAttention({
      workspaceId: task.workspaceId,
      taskId: task.id,
      eventId: confirmationId,
      tabId: task.rootTabId,
      reason: "Plan confirmation required",
      detail: query,
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
    completionStatus?: "completed" | "partial" | "failed" | "stopped",
  ): void {
    this.sendMessage({
      type: "AGENT_STATUS",
      workspaceId,
      payload: { status, detail, completionStatus },
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
