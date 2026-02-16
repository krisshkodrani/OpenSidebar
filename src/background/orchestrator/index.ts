import { AgentLoop } from "../agent";
import { LLMClient } from "../llm";
import {
  AgentStatus,
  AgentStep,
  MessageSource,
  SessionMetrics,
  SubtaskResult,
  SubtaskSummary,
  ToolName,
  UserSettings,
} from "../../types";
import { logger } from "../../utils";
import { workspaceManager } from "../workspaces/manager";
import { waitForContentScriptReady } from "../tab-ready";
import { OrchestratorPlanner } from "./planner";
import {
  BufferedMemory,
  NodeHandoffArtifact,
  OrchestratorCheckpoint,
  OrchestratorStartInput,
  OrchestratorTask,
  TaskNode,
  WorkerInstance,
} from "./types";
import { MemoryBuffer } from "./memory-buffer";
import { OrchestratorVerifier } from "./verifier";
import {
  buildAssumptionDriftSignal,
  buildExecutorInstruction,
  createRerouteNode,
  MAX_HANDOFF_DEPTH,
  buildTaskStateBrief,
  buildVerifierContext,
} from "./handoff";
import { buildRoleExecutionContract } from "./contracts";
import { getDependencyState, getRunnablePendingNodes } from "./scheduling";
import { decideRetryPolicy } from "./retry-policy";
import { BudgetEstimator } from "./budget-estimator";

const DEFAULT_MAX_WORKERS = 3;
const DEFAULT_MAX_REPLANS = 3;
const DEFAULT_MAX_SESSION_TIME_MS = 12 * 60 * 1000;
const DEFAULT_MAX_TOTAL_TOKENS = 75_000;
const DEFAULT_MAX_TOTAL_COST_USD = 1.5;
const CHECKPOINTS_STORAGE_KEY = "opensidebar:orchestrator:checkpoints";
const CHECKPOINT_VERSION = 1;
const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const TOOL_NAME_VALUES = new Set<string>(Object.values(ToolName));
type AgentLoopCallbacksArg = ConstructorParameters<typeof AgentLoop>[3];
type AgentLoopOptionsArg = ConstructorParameters<typeof AgentLoop>[4];

type PlannerLike = Pick<OrchestratorPlanner, "buildNodes" | "expandNode">;
type VerifierLike = Pick<OrchestratorVerifier, "verifyNode">;
type LlmLike = Pick<LLMClient, "switchToSmart" | "complete">;

type CreateAgentLoopInput = {
  openRouterApiKey: string;
  groqApiKey?: string;
  cerebrasApiKey?: string;
  callbacks?: AgentLoopCallbacksArg;
  options?: AgentLoopOptionsArg;
};

export type OrchestratorDeps = {
  createPlanner?: (
    openRouterApiKey: string,
    cerebrasApiKey?: string,
  ) => PlannerLike;
  createVerifier?: (
    openRouterApiKey: string,
    cerebrasApiKey?: string,
  ) => VerifierLike;
  createAgentLoop?: (input: CreateAgentLoopInput) => AgentLoop;
  createLlm?: (openRouterApiKey: string) => LlmLike;
  workspaceManager?: Pick<
    typeof workspaceManager,
    "getWorkspaceById" | "addTabToWorkspace"
  >;
  waitForContentScriptReady?: (
    tabId: number,
    timeoutMs: number,
  ) => Promise<boolean>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isTaskNodeStatus(value: unknown): value is TaskNode["status"] {
  return (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "skipped"
  );
}

function isTaskStatus(value: unknown): value is OrchestratorTask["status"] {
  return (
    value === "planning" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "stopped"
  );
}

function sanitizeTaskNode(raw: unknown): TaskNode | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (raw.role !== "executor") return null;
  if (typeof raw.description !== "string" || raw.description.length === 0) return null;
  if (
    typeof raw.successCriteria !== "string" ||
    raw.successCriteria.length === 0
  ) {
    return null;
  }
  if (!Array.isArray(raw.allowedTools) || raw.allowedTools.length === 0) {
    return null;
  }
  const allowedTools = raw.allowedTools.filter(
    (tool): tool is ToolName =>
      typeof tool === "string" &&
      TOOL_NAME_VALUES.has(tool),
  );
  if (allowedTools.length === 0) return null;
  if (!Array.isArray(raw.handoffArtifacts)) return null;
  const handoffArtifacts = raw.handoffArtifacts.filter(
      (artifact): artifact is NodeHandoffArtifact =>
        isRecord(artifact) &&
        (artifact.role === "planner" ||
          artifact.role === "executor" ||
          artifact.role === "verifier") &&
      (artifact.phase === "planned" ||
        artifact.phase === "planner_replan" ||
        artifact.phase === "executor_started" ||
        artifact.phase === "executor_finished" ||
        artifact.phase === "verifier_accept" ||
        artifact.phase === "verifier_retry" ||
        artifact.phase === "verifier_reroute") &&
      typeof artifact.note === "string" &&
      isNonNegativeInteger(artifact.timestamp),
  );
  if (handoffArtifacts.length !== raw.handoffArtifacts.length) return null;
  if (!isTaskNodeStatus(raw.status)) return null;
  if (!isNonNegativeInteger(raw.handoffDepth)) return null;
  if (!isNonNegativeInteger(raw.retries)) return null;
  const dependencies: string[] = [];
  if (Array.isArray(raw.dependencies)) {
    const parsedDeps = raw.dependencies.filter(
      (dep): dep is string => typeof dep === "string" && dep.length > 0,
    );
    if (parsedDeps.length !== raw.dependencies.length) return null;
    for (const dep of parsedDeps) {
      if (!dependencies.includes(dep)) dependencies.push(dep);
    }
  }
  const assumptions: string[] = [];
  if (Array.isArray(raw.assumptions)) {
    const parsedAssumptions = raw.assumptions.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    if (parsedAssumptions.length !== raw.assumptions.length) return null;
    for (const assumption of parsedAssumptions) {
      const normalized = assumption.trim();
      if (!assumptions.includes(normalized)) assumptions.push(normalized);
    }
  }

  const node: TaskNode = {
    id: raw.id,
    role: raw.role,
    description: raw.description,
    successCriteria: raw.successCriteria,
    allowedTools,
    dependencies,
    assumptions,
    handoffArtifacts,
    handoffDepth: raw.handoffDepth,
    status: raw.status,
    retries: raw.retries,
  };
  if (typeof raw.handoffFromNodeId === "string" && raw.handoffFromNodeId.length > 0) {
    node.handoffFromNodeId = raw.handoffFromNodeId;
  }
  if (typeof raw.result === "string") node.result = raw.result;
  if (typeof raw.error === "string") node.error = raw.error;
  return node;
}

function sanitizeTask(raw: unknown): OrchestratorTask | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.workspaceId !== "string" || raw.workspaceId.length === 0) return null;
  if (!isNonNegativeInteger(raw.rootTabId)) return null;
  if (typeof raw.query !== "string") return null;
  if (!isTaskStatus(raw.status)) return null;
  if (!isNonNegativeInteger(raw.createdAt)) return null;
  if (!Array.isArray(raw.nodes)) return null;
  if (!isNonNegativeInteger(raw.maxWorkers) || raw.maxWorkers < 1 || raw.maxWorkers > 8) {
    return null;
  }
  const maxReplans =
    raw.maxReplans === undefined
      ? DEFAULT_MAX_REPLANS
      : isNonNegativeInteger(raw.maxReplans)
        ? raw.maxReplans
        : null;
  if (maxReplans === null) return null;
  const replansUsed =
    raw.replansUsed === undefined
      ? 0
      : isNonNegativeInteger(raw.replansUsed)
        ? raw.replansUsed
        : null;
  if (replansUsed === null) return null;
  if (!isNonNegativeInteger(raw.currentIndex)) return null;

  const nodes = raw.nodes.map(sanitizeTaskNode);
  if (nodes.some((node) => node === null)) return null;

  const sessionMetrics =
    isRecord(raw.sessionMetrics) && typeof raw.sessionMetrics.totalTokens === "number"
      ? sanitizeSessionMetrics(raw.sessionMetrics)
      : emptySessionMetrics();
  if (!sessionMetrics) return null;

  const budget = isRecord(raw.budget)
    ? sanitizeBudget(raw.budget)
    : {
        maxSessionTimeMs: DEFAULT_MAX_SESSION_TIME_MS,
        maxTotalTokens: DEFAULT_MAX_TOTAL_TOKENS,
        maxTotalCostUsd: DEFAULT_MAX_TOTAL_COST_USD,
      };
  if (!budget) return null;

  const task: OrchestratorTask = {
    id: raw.id,
    workspaceId: raw.workspaceId,
    rootTabId: raw.rootTabId,
    query: raw.query,
    status: raw.status,
    createdAt: raw.createdAt,
    nodes: nodes as TaskNode[],
    maxWorkers: raw.maxWorkers,
    maxReplans,
    replansUsed,
    currentIndex: raw.currentIndex,
    sessionMetrics,
    budget,
  };

  if (raw.startedAt !== undefined) {
    if (!isNonNegativeInteger(raw.startedAt)) return null;
    task.startedAt = raw.startedAt;
  }
  if (raw.finishedAt !== undefined) {
    if (!isNonNegativeInteger(raw.finishedAt)) return null;
    task.finishedAt = raw.finishedAt;
  }
  if (raw.terminationReason !== undefined) {
    if (typeof raw.terminationReason !== "string") return null;
    task.terminationReason = raw.terminationReason;
  }

  return task;
}

function emptySessionMetrics(): SessionMetrics {
  return {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    totalLlmTimeMs: 0,
    totalSessionTimeMs: 0,
    llmCallCount: 0,
    totalCachedTokens: 0,
    modelBreakdown: {},
  };
}

function sanitizeSessionMetrics(raw: Record<string, unknown>): SessionMetrics | null {
  const numericKeys: Array<keyof SessionMetrics> = [
    "totalPromptTokens",
    "totalCompletionTokens",
    "totalTokens",
    "totalCost",
    "totalLlmTimeMs",
    "totalSessionTimeMs",
    "llmCallCount",
    "totalCachedTokens",
  ];
  for (const key of numericKeys) {
    const value = raw[key];
    if (typeof value !== "number" || Number.isNaN(value) || value < 0) return null;
  }
  const modelBreakdown: SessionMetrics["modelBreakdown"] = {};
  if (isRecord(raw.modelBreakdown)) {
    for (const [model, entry] of Object.entries(raw.modelBreakdown)) {
      if (!isRecord(entry)) return null;
      const promptTokens = entry.promptTokens;
      const completionTokens = entry.completionTokens;
      const cost = entry.cost;
      const calls = entry.calls;
      if (
        typeof promptTokens !== "number" ||
        typeof completionTokens !== "number" ||
        typeof cost !== "number" ||
        typeof calls !== "number"
      ) {
        return null;
      }
      modelBreakdown[model] = { promptTokens, completionTokens, cost, calls };
    }
  }

  return {
    totalPromptTokens: raw.totalPromptTokens as number,
    totalCompletionTokens: raw.totalCompletionTokens as number,
    totalTokens: raw.totalTokens as number,
    totalCost: raw.totalCost as number,
    totalLlmTimeMs: raw.totalLlmTimeMs as number,
    totalSessionTimeMs: raw.totalSessionTimeMs as number,
    llmCallCount: raw.llmCallCount as number,
    totalCachedTokens: raw.totalCachedTokens as number,
    modelBreakdown,
  };
}

function sanitizeBudget(
  raw: Record<string, unknown>,
): { maxSessionTimeMs: number; maxTotalTokens: number; maxTotalCostUsd: number } | null {
  const maxSessionTimeMs = raw.maxSessionTimeMs;
  const maxTotalTokens = raw.maxTotalTokens;
  const maxTotalCostUsd = raw.maxTotalCostUsd;
  if (
    !isNonNegativeInteger(maxSessionTimeMs) ||
    !isNonNegativeInteger(maxTotalTokens) ||
    typeof maxTotalCostUsd !== "number" ||
    Number.isNaN(maxTotalCostUsd) ||
    maxTotalCostUsd < 0
  ) {
    return null;
  }
  return {
    maxSessionTimeMs,
    maxTotalTokens,
    maxTotalCostUsd,
  };
}

function mergeSessionMetrics(
  target: SessionMetrics,
  incoming?: SessionMetrics,
): SessionMetrics {
  if (!incoming) return target;
  target.totalPromptTokens += incoming.totalPromptTokens;
  target.totalCompletionTokens += incoming.totalCompletionTokens;
  target.totalTokens += incoming.totalTokens;
  target.totalCost += incoming.totalCost;
  target.totalLlmTimeMs += incoming.totalLlmTimeMs;
  target.totalSessionTimeMs += incoming.totalSessionTimeMs;
  target.llmCallCount += incoming.llmCallCount;
  target.totalCachedTokens += incoming.totalCachedTokens;
  for (const [model, metrics] of Object.entries(incoming.modelBreakdown)) {
    const existing = target.modelBreakdown[model] || {
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
      calls: 0,
    };
    existing.promptTokens += metrics.promptTokens;
    existing.completionTokens += metrics.completionTokens;
    existing.cost += metrics.cost;
    existing.calls += metrics.calls;
    target.modelBreakdown[model] = existing;
  }
  return target;
}

function sanitizeCheckpoint(raw: unknown): OrchestratorCheckpoint | null {
  if (!isRecord(raw)) return null;
  if (!isNonNegativeInteger(raw.version)) return null;
  if (!isNonNegativeInteger(raw.savedAt)) return null;
  const task = sanitizeTask(raw.task);
  if (!task) return null;
  if (raw.version !== CHECKPOINT_VERSION) {
    // Keep version check in prune flow for central logging path.
    return {
      version: raw.version as OrchestratorCheckpoint["version"],
      savedAt: raw.savedAt,
      task,
    };
  }
  return {
    version: CHECKPOINT_VERSION,
    savedAt: raw.savedAt,
    task,
  };
}

function toSubtasks(nodes: TaskNode[]): SubtaskSummary[] {
  return nodes.map((node) => ({
    description: node.description,
    status: node.status === "completed"
      ? "completed"
      : isUserSkippedNode(node)
        ? "skipped"
        : node.status === "failed"
          ? "failed"
          : node.status === "running"
            ? "running"
            : "pending",
    turnsUsed: 0,
    turnBudget: 0,
    result: node.result || node.error,
  }));
}

function currentIndex(nodes: TaskNode[]): number {
  const running = nodes.findIndex((n) => n.status === "running");
  if (running >= 0) return running;
  const pending = nodes.findIndex((n) => n.status === "pending");
  if (pending >= 0) return pending;
  return nodes.length;
}

function isUserSkippedNode(node: Pick<TaskNode, "status">): boolean {
  return node.status === "skipped";
}

export class Orchestrator {
  private tasksByWorkspace = new Map<string, OrchestratorTask>();
  private workersByWorkspace = new Map<string, Map<string, WorkerInstance>>();
  private memoryBuffer = new MemoryBuffer();
  private budgetEstimator = new BudgetEstimator();
  private deps: Required<OrchestratorDeps>;

  constructor(deps: OrchestratorDeps = {}) {
    this.deps = {
      createPlanner:
        deps.createPlanner ??
        ((openRouterApiKey: string, cerebrasApiKey?: string) =>
          new OrchestratorPlanner(openRouterApiKey, cerebrasApiKey)),
      createVerifier:
        deps.createVerifier ??
        ((openRouterApiKey: string, cerebrasApiKey?: string) =>
          new OrchestratorVerifier(openRouterApiKey, cerebrasApiKey)),
      createAgentLoop:
        deps.createAgentLoop ??
        ((input: CreateAgentLoopInput) =>
          new AgentLoop(
            input.openRouterApiKey,
            input.groqApiKey,
            input.cerebrasApiKey,
            input.callbacks,
            input.options,
          )),
      createLlm:
        deps.createLlm ??
        ((openRouterApiKey: string) =>
          new LLMClient(openRouterApiKey, undefined, undefined)),
      workspaceManager: deps.workspaceManager ?? workspaceManager,
      waitForContentScriptReady:
        deps.waitForContentScriptReady ?? waitForContentScriptReady,
    };
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

  private async loadCheckpoints(): Promise<Record<string, OrchestratorCheckpoint>> {
    try {
      const stored = await chrome.storage.local.get(CHECKPOINTS_STORAGE_KEY);
      const raw = stored[CHECKPOINTS_STORAGE_KEY];
      if (!isRecord(raw)) return {};

      const parsed: Record<string, OrchestratorCheckpoint> = {};
      for (const [workspaceId, value] of Object.entries(raw)) {
        if (typeof workspaceId !== "string" || workspaceId.length === 0) continue;
        const cp = sanitizeCheckpoint(value);
        if (!cp) {
          logger.warn("orchestrator", "Dropping malformed checkpoint", { workspaceId });
          continue;
        }
        if (cp.task.workspaceId !== workspaceId) {
          logger.warn("orchestrator", "Dropping checkpoint with mismatched workspace", {
            keyWorkspaceId: workspaceId,
            taskWorkspaceId: cp.task.workspaceId,
          });
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
        logger.warn("orchestrator", "Dropping incompatible checkpoint version", {
          workspaceId,
          foundVersion: cp.version,
          expectedVersion: CHECKPOINT_VERSION,
        });
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
      await chrome.storage.local.set({ [CHECKPOINTS_STORAGE_KEY]: checkpoints });
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
    if (!checkpoints[workspaceId]) return;
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
    const stored = await chrome.storage.sync.get("userSettings");
    const settings = (stored.userSettings ?? {}) as UserSettings;

    const openRouterApiKey = settings.openRouterApiKey || __OPENROUTER_API_KEY__;
    if (!openRouterApiKey) {
      logger.warn("orchestrator", "Cannot resume task without OpenRouter API key", {
        workspaceId: task.workspaceId,
      });
      return null;
    }

    return {
      query: task.query,
      tabId: resumeTabId,
      workspaceId: task.workspaceId,
      settings,
      openRouterApiKey,
      groqApiKey: settings.groqApiKey || __GROQ_API_KEY__ || undefined,
      cerebrasApiKey: settings.cerebrasApiKey || __CEREBRAS_API_KEY__ || undefined,
    };
  }

  public async restoreFromCheckpoints(): Promise<void> {
    const checkpoints = await this.pruneCheckpoints(await this.loadCheckpoints());
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
        logger.warn("orchestrator", "Cannot resume checkpoint, no live workspace tab", {
          workspaceId: task.workspaceId,
          taskId: task.id,
        });
        await this.clearTaskCheckpoint(task.workspaceId);
        continue;
      }

      const resumeInput = await this.buildResumeInput(task, resumeTabId);
      if (!resumeInput) {
        await this.clearTaskCheckpoint(task.workspaceId);
        continue;
      }

      // "running" is transient; restart these nodes as pending and continue.
      task.nodes = task.nodes.map((node) =>
        node.status === "running" ? { ...node, status: "pending" } : node,
      );
      task.status = "running";
      task.currentIndex = currentIndex(task.nodes);
      this.tasksByWorkspace.set(task.workspaceId, task);
      this.workersByWorkspace.set(task.workspaceId, new Map());
      await this.persistTaskCheckpoint(task);

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
      this.sendStatus(task.workspaceId, AgentStatus.ACTING, "Recovered task, resuming...");
      this.sendProgress(task);

      // Fire-and-forget: each task resumes independently.
      this.runTask(task, resumeInput).catch(async (error) => {
        logger.error("orchestrator", "Recovered task failed", {
          workspaceId: task.workspaceId,
          taskId: task.id,
          error,
        });
        task.status = "failed";
        task.finishedAt = Date.now();
        await this.clearTaskCheckpoint(task.workspaceId);
        this.tasksByWorkspace.delete(task.workspaceId);
        this.workersByWorkspace.delete(task.workspaceId);
        this.sendStatus(task.workspaceId, AgentStatus.ERROR, "Recovered task failed");
      });
    }
  }

  hasActiveTasks(): boolean {
    return this.tasksByWorkspace.size > 0;
  }

  private applyPreflightBudget(task: OrchestratorTask): void {
    const capacity = this.budgetEstimator.estimateCapacity(task.budget);
    const estimate = this.budgetEstimator.getEstimate();
    const originalPending = task.nodes.filter((node) => node.status === "pending");
    if (originalPending.length <= capacity.maxNodesOverall) return;

    const selectedIds = new Set<string>();
    const deferred: TaskNode[] = [];
    for (const node of originalPending) {
      const depsSatisfied = node.dependencies.every((dep) => selectedIds.has(dep));
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

    logger.warn("orchestrator", "Planner preflight deferred nodes due to budget", {
      taskId: task.id,
      originalNodeCount: originalPending.length,
      keptNodeCount: selectedIds.size,
      deferredNodeCount: deferred.length,
      capacity,
      estimate,
      deferredNodeIds: deferred.map((n) => n.id),
    });

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

    const taskId = crypto.randomUUID();
    const task: OrchestratorTask = {
      id: taskId,
      workspaceId: input.workspaceId,
      rootTabId: input.tabId,
      query: input.query,
      status: "planning",
      createdAt: Date.now(),
      nodes: [],
      maxWorkers: Math.max(
        1,
        Math.min(8, input.settings.orchestratorMaxWorkers || DEFAULT_MAX_WORKERS),
      ),
      maxReplans: DEFAULT_MAX_REPLANS,
      replansUsed: 0,
      currentIndex: 0,
      sessionMetrics: emptySessionMetrics(),
      budget: {
        maxSessionTimeMs: DEFAULT_MAX_SESSION_TIME_MS,
        maxTotalTokens: DEFAULT_MAX_TOTAL_TOKENS,
        maxTotalCostUsd: DEFAULT_MAX_TOTAL_COST_USD,
      },
    };
    this.tasksByWorkspace.set(input.workspaceId, task);
    this.workersByWorkspace.set(input.workspaceId, new Map());
    await this.persistTaskCheckpoint(task);

    this.sendStatus(input.workspaceId, AgentStatus.THINKING, "Planning task...");

    let nodes: TaskNode[] = [];
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
      const planner = this.deps.createPlanner(
        input.openRouterApiKey,
        input.cerebrasApiKey,
      );
      const tab = await chrome.tabs.get(input.tabId);
      nodes = await planner.buildNodes(
        input.query,
        tab.title || "Untitled",
        tab.url || "",
      );
      this.sendMessage({
        type: "AGENT_STEP",
        workspaceId: input.workspaceId,
        payload: {
          step: {
            id: crypto.randomUUID(),
            type: "info",
            label: `Planner: generated ${nodes.length} executor subtasks`,
            status: "done",
            timestamp: Date.now(),
          },
          update: false,
        },
      });
    } catch (error: any) {
      logger.warn("orchestrator", "Planner failed, using single node", {
        error: error?.message,
      });
      nodes = [
        {
          id: crypto.randomUUID(),
          role: "executor",
          description: input.query,
          successCriteria: "The user goal is completed and verified.",
          allowedTools: Object.values(ToolName),
          dependencies: [],
          assumptions: [],
          handoffArtifacts: [
            {
              role: "planner",
              phase: "planned",
              note: "Planner fallback: single executor objective from original query.",
              timestamp: Date.now(),
            },
          ],
          handoffDepth: 0,
          status: "pending",
          retries: 0,
        },
      ];
      this.sendMessage({
        type: "AGENT_STEP",
        workspaceId: input.workspaceId,
        payload: {
          step: {
            id: crypto.randomUUID(),
            type: "info",
            label: "Planner: fallback to single subtask",
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
      this.tasksByWorkspace.delete(task.workspaceId);
      this.workersByWorkspace.delete(task.workspaceId);
      await this.clearTaskCheckpoint(task.workspaceId);
      this.sendStatus(task.workspaceId, AgentStatus.IDLE, "Stopped");
      return;
    }

    task.nodes = nodes;
    this.applyPreflightBudget(task);
    task.status = "running";
    task.startedAt = Date.now();
    await this.persistTaskCheckpoint(task);

    this.sendProgress(task);
    this.sendStatus(input.workspaceId, AgentStatus.ACTING, "Executing subtasks...");

    await this.runTask(task, input);
  }

  private async runTask(
    task: OrchestratorTask,
    input: OrchestratorStartInput,
  ): Promise<void> {
    const running = new Set<Promise<void>>();
    const verifierContract = buildRoleExecutionContract("verifier", input.settings);
    logger.debug("policy", "Role execution contract resolved", {
      role: verifierContract.role,
      modelTier: verifierContract.modelTier,
      allowedToolCount: verifierContract.allowedTools.length,
    });
    const verifier = this.deps.createVerifier(
      input.openRouterApiKey,
      input.cerebrasApiKey,
    );
    const replanner = this.deps.createPlanner(
      input.openRouterApiKey,
      input.cerebrasApiKey,
    );
    let initialTabConsumed = false;
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
      this.appendHandoffArtifact(node, {
        role: "executor",
        phase: "executor_started",
        note: `Executor started objective: ${node.description}`,
      });
      task.currentIndex = currentIndex(task.nodes);
      this.sendProgress(task);
      await this.persistTaskCheckpoint(task);

      const workerId = crypto.randomUUID();
      const tabId = initialTabConsumed
        ? await this.createWorkerTab(initialTabUrl, task.workspaceId)
        : input.tabId;
      initialTabConsumed = true;

      const snapshot = await this.getSnapshot(tabId, input.settings.showElementTags ?? false);
      const driftSignal = buildAssumptionDriftSignal(node, snapshot);
      const driftDetected = driftSignal.startsWith("Potential plan-reality drift");
      if (driftSignal.startsWith("Potential plan-reality drift")) {
        logger.warn("orchestrator", "Planner assumption drift detected", {
          taskId: task.id,
          nodeId: node.id,
          driftSignal,
          assumptionCount: node.assumptions.length,
        });
      }
      const taskStateBrief = buildTaskStateBrief(task.nodes, node.id);
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

      const loop = this.deps.createAgentLoop({
        openRouterApiKey: input.openRouterApiKey,
        groqApiKey: input.groqApiKey,
        cerebrasApiKey: input.cerebrasApiKey,
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
              logger.warn("orchestrator", "Worker emitted stale-progress signal", {
                taskId: task.id,
                nodeId: node.id,
                staleSignalCount,
                stepLabel: step.label,
                stepDetail: step.detail,
              });
            }
            this.sendMessage({
              type: "AGENT_STEP",
              workspaceId: task.workspaceId,
              payload: {
                step: {
                  ...step,
                  label: `Executor: ${step.label}`,
                },
                update,
              },
            });
          },
        },
        options: {
          maxContextTokens: input.settings.contextWindowSize || 32000,
          maxTurns: input.settings.maxTurns || 30,
          showElementTags: input.settings.showElementTags ?? false,
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
          suppressUiBroadcast: true,
          disableInternalPlanning: executorContract.disableInternalPlanning,
          bypassApprovals: input.settings.bypassApprovals ?? false,
          onMemoryAdd: (item: BufferedMemory) => {
            this.memoryBuffer.add(workerId, item);
          },
        },
      });

      const wsWorkers = this.workersByWorkspace.get(task.workspaceId)!;
      wsWorkers.set(workerId, { workerId, nodeId: node.id, tabId, loop });

      try {
        const executorInstruction = buildExecutorInstruction(
          node,
          taskStateBrief,
          driftSignal,
        );
        logger.debug("orchestrator", "Executor instruction prepared", {
          taskId: task.id,
          nodeId: node.id,
          retries: node.retries,
          handoffArtifactCount: node.handoffArtifacts.length,
          instructionChars: executorInstruction.length,
        });
        const result = await loop.start(executorInstruction, tabId, snapshot, {
          clearHistory: true,
        });
        task.sessionMetrics = mergeSessionMetrics(task.sessionMetrics, result.metrics);
        this.budgetEstimator.recordObservation({
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
          budgetEstimate: this.budgetEstimator.getEstimate(),
        });
        if (node.status !== "running") {
          this.memoryBuffer.discardWorker(workerId);
          return;
        }
        this.appendHandoffArtifact(node, {
          role: "executor",
          phase: "executor_finished",
          note: result.summary || "Executor finished without summary.",
        });
        if (result.outcome === "completed") {
          const verifierHandoffContext = buildVerifierContext(node, taskStateBrief);
          const verification = await verifier.verifyNode({
            taskQuery: task.query,
            objective: node.description,
            successCriteria: node.successCriteria,
            output: result.summary,
            handoffContext: verifierHandoffContext,
          });
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
          this.emitVerifierStep(task.workspaceId, node.id, verification.reason);

          if (verification.decision === "accept") {
            this.appendHandoffArtifact(node, {
              role: "verifier",
              phase: "verifier_accept",
              note: verification.reason,
            });
            node.status = "completed";
            node.result = result.summary;
            await this.memoryBuffer.commitWorker(workerId);
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
            this.memoryBuffer.discardWorker(workerId);
            logger.info("orchestrator", "Verifier handoff created reroute node", {
              taskId: task.id,
              fromNodeId: node.id,
              toNodeId: reroutedNode.id,
              handoffDepth: reroutedNode.handoffDepth,
              rerouteObjective: verification.rerouteObjective,
            });
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
                node.error = reason;
                this.memoryBuffer.discardWorker(workerId);
                logger.warn("orchestrator", "Replan budget exhausted; failing node", {
                  taskId: task.id,
                  nodeId: node.id,
                  replansUsed: task.replansUsed,
                  maxReplans: task.maxReplans,
                });
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
                const expandedNodes = await replanner.expandNode(
                  node,
                  snapshot?.title || "",
                  snapshot?.url || "",
                  `${verification.reason} (driftDetected=${driftDetected}; staleSignalCount=${staleSignalCount})`,
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
                  this.memoryBuffer.discardWorker(workerId);
                  replanned = true;
                  logger.info("orchestrator", "Node replanned after drift retry", {
                    taskId: task.id,
                    nodeId: node.id,
                    expandedCount: expandedNodes.length,
                    replansUsed: task.replansUsed,
                    maxReplans: task.maxReplans,
                  });
                }
              } catch (error) {
                logger.warn("orchestrator", "Dynamic replanning failed; falling back to retry", {
                  taskId: task.id,
                  nodeId: node.id,
                  error,
                });
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
                  verification.decision === "reroute" && verification.rerouteObjective
                    ? `${verification.reason} Reroute: ${verification.rerouteObjective}`
                    : `${verification.reason} (${retryDecision.rationale})`,
              });

              if (retryDecision.shouldRetry) {
                node.status = "pending";
                node.retries += 1;
                node.error = verification.reason;
                if (
                  verification.decision === "reroute" &&
                  verification.rerouteObjective
                ) {
                  node.description = verification.rerouteObjective;
                  if (node.handoffDepth >= MAX_HANDOFF_DEPTH) {
                    logger.warn("orchestrator", "Reroute depth limit reached, falling back to retry", {
                      taskId: task.id,
                      nodeId: node.id,
                      handoffDepth: node.handoffDepth,
                      maxHandoffDepth: MAX_HANDOFF_DEPTH,
                    });
                  }
                }
              } else {
                node.status = "failed";
                node.error = `Verifier ${verification.decision}: ${verification.reason} (${retryDecision.rationale})`;
              }
              this.memoryBuffer.discardWorker(workerId);
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
            node.error = `Verifier ${verification.decision}: ${verification.reason}`;
            this.memoryBuffer.discardWorker(workerId);
          }
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
            node.error = `${result.summary} (${retryDecision.rationale})`;
          } else {
            node.status = "failed";
            node.error = `${result.summary} (${retryDecision.rationale})`;
            this.memoryBuffer.discardWorker(workerId);
          }
        }
      } catch (error: any) {
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
          this.memoryBuffer.discardWorker(workerId);
        }
      } finally {
        wsWorkers.delete(workerId);
        task.currentIndex = currentIndex(task.nodes);
        this.sendProgress(task);
        await this.persistTaskCheckpoint(task);
      }
    };

    while (task.status === "running") {
      const runnable = getRunnablePendingNodes(task.nodes);
      logger.debug("orchestrator", "Scheduler cycle", {
        taskId: task.id,
        pending: task.nodes.filter((n) => n.status === "pending").length,
        running: running.size,
        completed: task.nodes.filter((n) => n.status === "completed").length,
        failed: task.nodes.filter((n) => n.status === "failed").length,
        runnable: runnable.length,
      });

      const budgetReason = getBudgetExhaustionReason();
      if (budgetReason) {
        applyBudgetTermination(budgetReason);
        break;
      }

      while (runnable.length > 0 && running.size < task.maxWorkers) {
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
      if (pendingNodes.length === 0) break;

      const nodesById = new Map<string, TaskNode>(task.nodes.map((n) => [n.id, n]));
      for (const blockedNode of pendingNodes) {
        const depState = getDependencyState(blockedNode, nodesById);
        if (depState.ready || depState.waitingOn.length > 0) continue;
        blockedNode.status = "failed";
        blockedNode.error =
          depState.failedDeps.length > 0
            ? `Blocked by failed dependencies: ${depState.failedDeps.join(", ")}`
            : `Blocked by missing dependencies: ${depState.missingDeps.join(", ")}`;
        logger.warn("orchestrator", "Node failed due to unsatisfiable dependencies", {
          taskId: task.id,
          nodeId: blockedNode.id,
          failedDeps: depState.failedDeps,
          missingDeps: depState.missingDeps,
          dependencies: blockedNode.dependencies,
        });
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
      this.tasksByWorkspace.delete(task.workspaceId);
      this.workersByWorkspace.delete(task.workspaceId);
      await this.clearTaskCheckpoint(task.workspaceId);
      this.sendStatus(task.workspaceId, AgentStatus.IDLE, "Stopped");
      return;
    }

    const completed = task.nodes.filter((n) => n.status === "completed").length;
    const skipped = task.nodes.filter((n) => isUserSkippedNode(n)).length;
    const failed = task.nodes.filter(
      (n) => n.status === "failed" && !isUserSkippedNode(n),
    ).length;
    task.finishedAt = Date.now();
    task.sessionMetrics.totalSessionTimeMs = task.finishedAt - (task.startedAt || task.createdAt);
    task.status = failed > 0 ? "failed" : "completed";

    const summary = await this.summarizeTask(task, input.openRouterApiKey);
    this.sendMessage({
      type: "STREAM_CHUNK",
      workspaceId: task.workspaceId,
      payload: { delta: summary, done: false },
    });
    this.sendMessage({
      type: "STREAM_CHUNK",
      workspaceId: task.workspaceId,
      payload: { delta: "", done: true },
    });

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

    const completionStatus: "completed" | "partial" | "failed" =
      failed > 0
        ? completed > 0 || skipped > 0
          ? "partial"
          : "failed"
        : skipped > 0
          ? "partial"
          : "completed";

    this.sendMessage({
      type: "TASK_COMPLETION",
      workspaceId: task.workspaceId,
      payload: {
        taskId: task.id,
        status: completionStatus,
        totalTurnsUsed: 0,
        totalTimeMs: task.finishedAt - (task.startedAt || task.createdAt),
        summary,
        subtaskResults,
        urlHistory: [],
        metrics: task.sessionMetrics,
        terminationReason: task.terminationReason,
      },
    });

    this.sendStatus(task.workspaceId, AgentStatus.IDLE, "Task complete");
    this.tasksByWorkspace.delete(task.workspaceId);
    this.workersByWorkspace.delete(task.workspaceId);
    await this.clearTaskCheckpoint(task.workspaceId);
  }

  async stopTask(workspaceId?: string): Promise<void> {
    if (workspaceId) {
      this.stopWorkspace(workspaceId);
      return;
    }
    for (const wsId of this.tasksByWorkspace.keys()) {
      this.stopWorkspace(wsId);
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

  injectHint(workspaceId: string, text: string): void {
    const workers = this.workersByWorkspace.get(workspaceId);
    if (!workers) return;
    for (const worker of workers.values()) {
      worker.loop.injectHint(text);
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

    const workers = this.workersByWorkspace.get(task.workspaceId);
    for (const worker of workers?.values() ?? []) {
      if (worker.nodeId !== targetNode.id) continue;
      worker.loop.stop();
      this.memoryBuffer.discardWorker(worker.workerId);
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

  private stopWorkspace(workspaceId: string): void {
    const task = this.tasksByWorkspace.get(workspaceId);
    if (!task) return;
    task.status = "stopped";
    void this.persistTaskCheckpoint(task);
    const workers = this.workersByWorkspace.get(workspaceId);
    for (const worker of workers?.values() || []) {
      worker.loop.stop();
      this.memoryBuffer.discardWorker(worker.workerId);
    }
    workers?.clear();
  }

  private pauseWorkspace(workspaceId: string): void {
    const workers = this.workersByWorkspace.get(workspaceId);
    for (const worker of workers?.values() || []) {
      worker.loop.pause();
    }
  }

  private resumeWorkspace(workspaceId: string): void {
    const workers = this.workersByWorkspace.get(workspaceId);
    for (const worker of workers?.values() || []) {
      worker.loop.resume();
    }
  }

  private async createWorkerTab(url: string, workspaceId: string): Promise<number> {
    const tab = await chrome.tabs.create({ url, active: false });
    if (!tab.id) throw new Error("Failed to create worker tab");
    await this.deps.workspaceManager.addTabToWorkspace(tab.id, workspaceId);
    return tab.id;
  }

  private async getSnapshot(tabId: number, showTags: boolean): Promise<any | undefined> {
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
        // no-op
      }
      await this.deps.waitForContentScriptReady(tabId, 2000);
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "DOM_SNAPSHOT_REQUEST",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: { includeText: true, refresh: true, showTags },
      });
      return response.payload.snapshot;
    } catch {
      return undefined;
    }
  }

  private async summarizeTask(
    task: OrchestratorTask,
    openRouterApiKey: string,
  ): Promise<string> {
    const deterministic = task.nodes
      .map((n, i) => {
        const status = n.status === "completed" ? "done" : "failed";
        const detail = n.result || n.error || "No detail";
        return `${i + 1}. [${status}] ${n.description} - ${detail}`;
      })
      .join("\n");

    try {
      const llm = this.deps.createLlm(openRouterApiKey);
      llm.switchToSmart();
      const response = await llm.complete({
        messages: [
          {
            role: "system",
            content:
              "Summarize task execution faithfully. Do not invent missing work. Mention failures explicitly.",
          },
          {
            role: "user",
            content: `Task: ${task.query}\n\nExecution log:\n${deterministic}\n\nWrite a concise completion summary.`,
          },
        ],
        max_tokens: 300,
        temperature: 0,
      });
      const content = (response.content || "").trim();
      if (content.length > 0) return content;
      return deterministic;
    } catch {
      return deterministic;
    }
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

  private sendStatus(
    workspaceId: string,
    status: AgentStatus,
    detail: string,
  ): void {
    this.sendMessage({
      type: "AGENT_STATUS",
      workspaceId,
      payload: { status, detail },
    });
  }

  private sendMessage(
    message: {
      type: string;
      payload: any;
      workspaceId?: string | null;
    },
  ): void {
    chrome.runtime
      .sendMessage({
        ...message,
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
      } as any)
      .catch((error) => {
        logger.debug("orchestrator", "Failed to send runtime message", { error });
      });
  }
}

export const orchestrator = new Orchestrator();
