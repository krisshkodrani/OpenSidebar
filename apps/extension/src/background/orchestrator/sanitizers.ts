/**
 * Orchestrator sanitizers — type guards, data validation, and checkpoint deserialization
 */

import {
  EscalationDecisionMessage,
  EscalationOption,
  EscalationPacket,
  EscalationRisk,
  SessionMetrics,
  ToolName,
} from "../../types";
import {
  NodeHandoffArtifact,
  OrchestratorCheckpoint,
  OrchestratorTask,
  PlannerReflexionEntry,
  ReflexionEntry,
  TaskNode,
} from "./types";
import type {
  PendingApprovalInteraction,
  PendingUserInteraction,
} from "../agent/loop-types";
import { clampConfidence, normalizeEscalationOptionId } from "./utils";

export const TOOL_NAME_VALUES = new Set<string>(Object.values(ToolName));
export const DEFAULT_MAX_REPLANS = 3;
export const DEFAULT_MAX_SESSION_TIME_MS = 12 * 60 * 1000;
export const DEFAULT_MAX_TOTAL_TOKENS = 1_000_000;
export const DEFAULT_MAX_TOTAL_COST_USD = 1.5;
export const CHECKPOINT_VERSION = 1;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

export function isTaskNodeStatus(value: unknown): value is TaskNode["status"] {
  return (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "skipped"
  );
}

export function isTaskStatus(
  value: unknown,
): value is OrchestratorTask["status"] {
  return (
    value === "planning" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "stopped"
  );
}

export function sanitizeTaskNode(raw: unknown): TaskNode | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (raw.role !== "executor") return null;
  if (typeof raw.description !== "string" || raw.description.length === 0)
    return null;
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
      typeof tool === "string" && TOOL_NAME_VALUES.has(tool),
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
        artifact.phase === "verifier_reroute" ||
        artifact.phase === "verifier_advisory") &&
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
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
    if (parsedAssumptions.length !== raw.assumptions.length) return null;
    for (const assumption of parsedAssumptions) {
      const normalized = assumption.trim();
      if (!assumptions.includes(normalized)) assumptions.push(normalized);
    }
  }

  const reflexionLog: ReflexionEntry[] = [];
  if (Array.isArray(raw.reflexionLog)) {
    for (const entry of raw.reflexionLog) {
      if (
        isRecord(entry) &&
        isNonNegativeInteger(entry.attempt) &&
        typeof entry.executorSummary === "string" &&
        (entry.verifierDecision === "retry" ||
          entry.verifierDecision === "reroute") &&
        typeof entry.verifierReason === "string" &&
        typeof entry.confidence === "number" &&
        isNonNegativeInteger(entry.timestamp)
      ) {
        reflexionLog.push({
          attempt: entry.attempt as number,
          executorSummary: entry.executorSummary,
          verifierDecision: entry.verifierDecision,
          verifierReason: entry.verifierReason,
          failureType:
            typeof entry.failureType === "string"
              ? entry.failureType
              : undefined,
          confidence: entry.confidence as number,
          suggestedApproach:
            typeof entry.suggestedApproach === "string"
              ? entry.suggestedApproach
              : undefined,
          timestamp: entry.timestamp as number,
        });
      }
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
    reflexionLog,
    handoffDepth: raw.handoffDepth,
    status: raw.status,
    retries: raw.retries,
  };
  if (
    typeof raw.selectedSkillId === "string" &&
    raw.selectedSkillId.length > 0
  ) {
    node.selectedSkillId = raw.selectedSkillId;
  }
  if (
    typeof raw.selectedSkillReason === "string" &&
    raw.selectedSkillReason.length > 0
  ) {
    node.selectedSkillReason = raw.selectedSkillReason;
  }
  if (
    typeof raw.handoffFromNodeId === "string" &&
    raw.handoffFromNodeId.length > 0
  ) {
    node.handoffFromNodeId = raw.handoffFromNodeId;
  }
  if (typeof raw.result === "string") node.result = raw.result;
  if (typeof raw.error === "string") node.error = raw.error;
  return node;
}

function sanitizePendingInteraction(
  raw: unknown,
): PendingUserInteraction | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "approval") {
    if (
      typeof raw.approvalId !== "string" ||
      !TOOL_NAME_VALUES.has(String(raw.toolName)) ||
      !isRecord(raw.args) ||
      typeof raw.context !== "string" ||
      !isNonNegativeInteger(raw.requestedAt) ||
      !isNonNegativeInteger(raw.timeoutMs)
    ) {
      return null;
    }
    if (raw.approved !== undefined && typeof raw.approved !== "boolean") {
      return null;
    }
    return {
      kind: "approval",
      nodeId: typeof raw.nodeId === "string" ? raw.nodeId : null,
      requestedAt: raw.requestedAt,
      approvalId: raw.approvalId,
      toolName: raw.toolName as PendingApprovalInteraction["toolName"],
      args: raw.args,
      context: raw.context,
      timeoutMs: raw.timeoutMs,
      ...(typeof raw.approved === "boolean"
        ? { approved: raw.approved }
        : {}),
    };
  }

  if (raw.kind === "clarification") {
    if (
      typeof raw.clarificationId !== "string" ||
      typeof raw.question !== "string" ||
      !isNonNegativeInteger(raw.requestedAt) ||
      !isNonNegativeInteger(raw.timeoutMs)
    ) {
      return null;
    }
    if (
      raw.suggestions !== undefined &&
      (!Array.isArray(raw.suggestions) ||
        raw.suggestions.some((item) => typeof item !== "string"))
    ) {
      return null;
    }
    if (raw.answer !== undefined && typeof raw.answer !== "string") {
      return null;
    }
    return {
      kind: "clarification",
      nodeId: typeof raw.nodeId === "string" ? raw.nodeId : null,
      requestedAt: raw.requestedAt,
      clarificationId: raw.clarificationId,
      question: raw.question,
      ...(Array.isArray(raw.suggestions)
        ? { suggestions: raw.suggestions }
        : {}),
      timeoutMs: raw.timeoutMs,
      ...(typeof raw.answer === "string" ? { answer: raw.answer } : {}),
    };
  }

  return null;
}

export function sanitizeTask(raw: unknown): OrchestratorTask | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.workspaceId !== "string" || raw.workspaceId.length === 0)
    return null;
  if (!isNonNegativeInteger(raw.rootTabId)) return null;
  if (typeof raw.query !== "string") return null;
  if (!isTaskStatus(raw.status)) return null;
  if (!isNonNegativeInteger(raw.createdAt)) return null;
  if (!Array.isArray(raw.nodes)) return null;
  if (
    !isNonNegativeInteger(raw.maxWorkers) ||
    raw.maxWorkers < 1 ||
    raw.maxWorkers > 8
  ) {
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
  const horizonExpansions = isNonNegativeInteger(raw.horizonExpansions)
    ? raw.horizonExpansions
    : 0;
  if (!isNonNegativeInteger(raw.currentIndex)) return null;

  const nodes = raw.nodes.map(sanitizeTaskNode);
  if (nodes.some((node) => node === null)) return null;

  const sessionMetrics =
    isRecord(raw.sessionMetrics) &&
    typeof raw.sessionMetrics.totalTokens === "number"
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
    runId:
      typeof raw.runId === "string" && raw.runId.length > 0
        ? raw.runId
        : undefined,
    id: raw.id,
    workspaceId: raw.workspaceId,
    rootTabId: raw.rootTabId,
    query: raw.query,
    status: raw.status,
    createdAt: raw.createdAt,
    nodes: nodes as TaskNode[],
    plannerReflexionLog: Array.isArray(raw.plannerReflexionLog)
      ? (raw.plannerReflexionLog as PlannerReflexionEntry[])
      : [],
    maxWorkers: raw.maxWorkers,
    maxReplans,
    replansUsed,
    horizonExpansions,
    currentIndex: raw.currentIndex,
    sessionMetrics,
    budget,
  };

  if (raw.pendingEscalation !== undefined) {
    if (!isRecord(raw.pendingEscalation)) return null;
    const packet = sanitizeEscalationPacket(raw.pendingEscalation.packet);
    if (!packet) return null;
    let selectedOption: EscalationDecisionMessage["payload"] | undefined;
    if (raw.pendingEscalation.selectedOption !== undefined) {
      if (!isRecord(raw.pendingEscalation.selectedOption)) return null;
      const optionId = normalizeEscalationOptionId(
        raw.pendingEscalation.selectedOption.optionId,
      );
      if (
        typeof raw.pendingEscalation.selectedOption.escalationId !== "string" ||
        !optionId
      ) {
        return null;
      }
      selectedOption = {
        escalationId: raw.pendingEscalation.selectedOption.escalationId,
        optionId,
        rerouteObjective:
          typeof raw.pendingEscalation.selectedOption.rerouteObjective ===
          "string"
            ? raw.pendingEscalation.selectedOption.rerouteObjective
            : undefined,
      };
    }
    task.pendingEscalation = { packet, selectedOption };
  }
  if (raw.pendingInteraction !== undefined) {
    const pendingInteraction = sanitizePendingInteraction(raw.pendingInteraction);
    if (!pendingInteraction) return null;
    task.pendingInteraction = pendingInteraction;
  }

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
  if (Array.isArray(raw.createdWorkerTabIds)) {
    const tabIds = raw.createdWorkerTabIds.filter((id): id is number =>
      isNonNegativeInteger(id),
    );
    if (tabIds.length > 0) task.createdWorkerTabIds = tabIds;
  }

  return task;
}

export function emptySessionMetrics(): SessionMetrics {
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

export function sanitizeSessionMetrics(
  raw: Record<string, unknown>,
): SessionMetrics | null {
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
    if (typeof value !== "number" || Number.isNaN(value) || value < 0)
      return null;
  }
  const modelBreakdown: SessionMetrics["modelBreakdown"] = {};
  if (isRecord(raw.modelBreakdown)) {
    for (const [model, entry] of Object.entries(raw.modelBreakdown)) {
      if (!isRecord(entry)) return null;
      const promptTokens = entry.promptTokens;
      const completionTokens = entry.completionTokens;
      const cost = entry.cost;
      const calls = entry.calls;
      const actualCost = entry.actualCost;
      const estimatedCost = entry.estimatedCost;
      const costMode = entry.costMode;
      if (
        typeof promptTokens !== "number" ||
        typeof completionTokens !== "number" ||
        typeof cost !== "number" ||
        typeof calls !== "number"
      ) {
        return null;
      }
      if (
        actualCost !== undefined &&
        (typeof actualCost !== "number" ||
          Number.isNaN(actualCost) ||
          actualCost < 0)
      ) {
        return null;
      }
      if (
        estimatedCost !== undefined &&
        (typeof estimatedCost !== "number" ||
          Number.isNaN(estimatedCost) ||
          estimatedCost < 0)
      ) {
        return null;
      }
      if (
        costMode !== undefined &&
        costMode !== "none" &&
        costMode !== "actual" &&
        costMode !== "estimated" &&
        costMode !== "mixed"
      ) {
        return null;
      }
      const normalizedActualCost = (actualCost as number | undefined) ?? 0;
      const normalizedEstimatedCost =
        (estimatedCost as number | undefined) ?? 0;
      const normalizedCostMode =
        (costMode as "none" | "actual" | "estimated" | "mixed" | undefined) ??
        (normalizedActualCost > 0 && normalizedEstimatedCost > 0
          ? "mixed"
          : normalizedActualCost > 0
            ? "actual"
            : normalizedEstimatedCost > 0
              ? "estimated"
              : "none");
      modelBreakdown[model] = {
        promptTokens,
        completionTokens,
        cost,
        actualCost: normalizedActualCost,
        estimatedCost: normalizedEstimatedCost,
        costMode: normalizedCostMode,
        calls,
      };
    }
  }

  const totalCostActual =
    typeof raw.totalCostActual === "number" &&
    !Number.isNaN(raw.totalCostActual) &&
    raw.totalCostActual >= 0
      ? raw.totalCostActual
      : (raw.totalCost as number);
  const totalCostEstimated =
    typeof raw.totalCostEstimated === "number" &&
    !Number.isNaN(raw.totalCostEstimated) &&
    raw.totalCostEstimated >= 0
      ? raw.totalCostEstimated
      : 0;
  const costMode =
    raw.costMode === "none" ||
    raw.costMode === "actual" ||
    raw.costMode === "estimated" ||
    raw.costMode === "mixed"
      ? raw.costMode
      : totalCostActual > 0 && totalCostEstimated > 0
        ? "mixed"
        : totalCostActual > 0
          ? "actual"
          : totalCostEstimated > 0
            ? "estimated"
            : "none";

  return {
    totalPromptTokens: raw.totalPromptTokens as number,
    totalCompletionTokens: raw.totalCompletionTokens as number,
    totalTokens: raw.totalTokens as number,
    totalCost: raw.totalCost as number,
    totalCostActual,
    totalCostEstimated,
    costMode,
    totalLlmTimeMs: raw.totalLlmTimeMs as number,
    totalSessionTimeMs: raw.totalSessionTimeMs as number,
    llmCallCount: raw.llmCallCount as number,
    totalCachedTokens: raw.totalCachedTokens as number,
    modelBreakdown,
  };
}

export function sanitizeBudget(raw: Record<string, unknown>): {
  maxSessionTimeMs: number;
  maxTotalTokens: number;
  maxTotalCostUsd: number;
} | null {
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

export function mergeSessionMetrics(
  target: SessionMetrics,
  incoming?: SessionMetrics,
): SessionMetrics {
  if (!incoming) return target;
  target.totalPromptTokens += incoming.totalPromptTokens;
  target.totalCompletionTokens += incoming.totalCompletionTokens;
  target.totalTokens += incoming.totalTokens;
  target.totalCost += incoming.totalCost;
  target.totalCostActual =
    (target.totalCostActual ?? 0) + (incoming.totalCostActual ?? 0);
  target.totalCostEstimated =
    (target.totalCostEstimated ?? 0) + (incoming.totalCostEstimated ?? 0);
  target.costMode =
    (target.totalCostActual ?? 0) > 0 && (target.totalCostEstimated ?? 0) > 0
      ? "mixed"
      : (target.totalCostActual ?? 0) > 0
        ? "actual"
        : (target.totalCostEstimated ?? 0) > 0
          ? "estimated"
          : "none";
  target.totalLlmTimeMs += incoming.totalLlmTimeMs;
  target.totalSessionTimeMs += incoming.totalSessionTimeMs;
  target.llmCallCount += incoming.llmCallCount;
  target.totalCachedTokens += incoming.totalCachedTokens;
  for (const [model, metrics] of Object.entries(incoming.modelBreakdown)) {
    const existing = target.modelBreakdown[model] || {
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
      actualCost: 0,
      estimatedCost: 0,
      costMode: "none",
      calls: 0,
    };
    existing.promptTokens += metrics.promptTokens;
    existing.completionTokens += metrics.completionTokens;
    existing.cost += metrics.cost;
    existing.actualCost =
      (existing.actualCost ?? 0) + (metrics.actualCost ?? 0);
    existing.estimatedCost =
      (existing.estimatedCost ?? 0) + (metrics.estimatedCost ?? 0);
    existing.costMode =
      (existing.actualCost ?? 0) > 0 && (existing.estimatedCost ?? 0) > 0
        ? "mixed"
        : (existing.actualCost ?? 0) > 0
          ? "actual"
          : (existing.estimatedCost ?? 0) > 0
            ? "estimated"
            : "none";
    existing.calls += metrics.calls;
    target.modelBreakdown[model] = existing;
  }
  return target;
}

export function sanitizeCheckpoint(
  raw: unknown,
): OrchestratorCheckpoint | null {
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

export function sanitizeEscalationPacket(
  raw: unknown,
): EscalationPacket | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.escalationId !== "string" || raw.escalationId.length === 0)
    return null;
  if (typeof raw.taskId !== "string" || raw.taskId.length === 0) return null;
  if (typeof raw.workspaceId !== "string" || raw.workspaceId.length === 0)
    return null;
  if (typeof raw.nodeId !== "string" || raw.nodeId.length === 0) return null;
  if (raw.risk !== "medium" && raw.risk !== "high" && raw.risk !== "critical")
    return null;
  if (typeof raw.reason !== "string") return null;
  if (typeof raw.snapshotSummary !== "string") return null;
  if (!Array.isArray(raw.options) || raw.options.length === 0) return null;
  const options = raw.options
    .map((option) => {
      if (!isRecord(option)) return null;
      const id = normalizeEscalationOptionId(option.id);
      if (!id) return null;
      if (typeof option.label !== "string" || typeof option.impact !== "string")
        return null;
      const parsed: EscalationOption = {
        id,
        label: option.label,
        impact: option.impact,
      };
      if (
        typeof option.rerouteObjective === "string" &&
        option.rerouteObjective.length > 0
      ) {
        parsed.rerouteObjective = option.rerouteObjective;
      }
      return parsed;
    })
    .filter((option): option is EscalationOption => option !== null);
  if (options.length !== raw.options.length) return null;
  const recommendedOption = normalizeEscalationOptionId(raw.recommendedOption);
  if (!recommendedOption) return null;
  if (!Array.isArray(raw.lastActions)) return null;
  if (raw.lastActions.some((entry) => typeof entry !== "string")) return null;
  if (!isRecord(raw.budgetState)) return null;
  const budgetState = raw.budgetState;
  const keys = [
    "elapsedMs",
    "maxSessionTimeMs",
    "totalTokens",
    "maxTotalTokens",
    "totalCostUsd",
    "maxTotalCostUsd",
  ] as const;
  for (const key of keys) {
    if (typeof budgetState[key] !== "number" || Number.isNaN(budgetState[key]))
      return null;
  }
  if (typeof raw.timeoutMs !== "number" || raw.timeoutMs < 0) return null;
  if (typeof raw.timestamp !== "number" || raw.timestamp < 0) return null;

  return {
    escalationId: raw.escalationId,
    taskId: raw.taskId,
    workspaceId: raw.workspaceId,
    nodeId: raw.nodeId,
    risk: raw.risk as EscalationRisk,
    confidence: clampConfidence(
      typeof raw.confidence === "number" ? raw.confidence : undefined,
    ),
    reason: raw.reason,
    options,
    recommendedOption,
    snapshotSummary: raw.snapshotSummary,
    lastActions: raw.lastActions as string[],
    budgetState: {
      elapsedMs: budgetState.elapsedMs as number,
      maxSessionTimeMs: budgetState.maxSessionTimeMs as number,
      totalTokens: budgetState.totalTokens as number,
      maxTotalTokens: budgetState.maxTotalTokens as number,
      totalCostUsd: budgetState.totalCostUsd as number,
      maxTotalCostUsd: budgetState.maxTotalCostUsd as number,
    },
    timeoutMs: raw.timeoutMs,
    timestamp: raw.timestamp,
  };
}
