import type { TaskRunProgressInput } from "@shared-types/progress";
import type { OrchestratorTask, TaskNode, WorkerInstance } from "./types";
import { buildParallelRunState } from "./plan-state";

export const DEFAULT_MAX_WORKERS = 3;
export const MAX_HORIZON_EXPANSIONS = 30;
export const ESCALATION_RESPONSE_TIMEOUT_MS = 60_000;
export const ESCALATION_MAX_REASON_CHARS = 220;
export const MAX_PERSISTED_MESSAGES = 200;
export const E2E_SYNTHETIC_QUERY_PREFIX = "__e2e_pending_interaction__:";
export const E2E_PENDING_INTERACTION_TIMEOUT_MS = 10 * 60 * 1000;

/** Tasks the E2E harness synthesizes to exercise the pending-interaction path. */
export function isSyntheticPendingInteractionTask(
  task: OrchestratorTask,
): boolean {
  return task.query.startsWith(E2E_SYNTHETIC_QUERY_PREFIX);
}
export const LIST_DETAIL_REVIEW_SKILL_ID = "list-detail-review-loop";
export const NAVIGATE_READ_RETURN_SKILL_ID = "navigate-read-return";
export const MULTI_TAB_CHECKLIST_SKILL_ID = "multi-tab-checklist-workflow";
export const EXHAUSTIVE_REVIEW_MAX_TOTAL_TOKENS = 1_600_000;
const EXHAUSTIVE_REVIEW_MIN_NODES_FOR_BUDGET_BUMP = 8;

export function getFleetTelemetryRuntimeContext(): {
  eventId: string;
  extensionVersion: string;
  extensionChannel: "stable" | "dev";
  browserMajor: number;
  osFamily: string;
} {
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const browserMajor = Number(
    /(?:Chrome|Chromium)\/(\d+)/.exec(userAgent)?.[1] ?? 0,
  );
  const lowerUserAgent = userAgent.toLowerCase();
  const osFamily = lowerUserAgent.includes("windows")
    ? "windows"
    : lowerUserAgent.includes("mac os")
      ? "macos"
      : lowerUserAgent.includes("cros")
        ? "chromeos"
        : lowerUserAgent.includes("linux")
          ? "linux"
          : "other";
  return {
    eventId: crypto.randomUUID(),
    extensionVersion: chrome.runtime.getManifest().version,
    extensionChannel: __DEV__ ? "dev" : "stable",
    browserMajor,
    osFamily,
  };
}

export function cloneStructuredProgress(
  progress: Record<string, TaskRunProgressInput> | undefined,
): Record<string, TaskRunProgressInput> | undefined {
  if (!progress) return undefined;
  const entries = Object.entries(progress).map(([key, value]) => [
    key,
    JSON.parse(JSON.stringify(value)) as TaskRunProgressInput,
  ]);
  return Object.fromEntries(entries);
}

export function setStructuredProgressEntry(
  task: OrchestratorTask,
  entry: TaskRunProgressInput,
): void {
  const current = cloneStructuredProgress(task.structuredProgress) ?? {};
  current[entry.key] = JSON.parse(
    JSON.stringify(entry),
  ) as TaskRunProgressInput;
  task.structuredProgress = current;
}

export function deleteStructuredProgressEntry(
  task: OrchestratorTask,
  key: string,
): void {
  if (!task.structuredProgress?.[key]) return;
  const next = cloneStructuredProgress(task.structuredProgress) ?? {};
  delete next[key];
  task.structuredProgress = Object.keys(next).length > 0 ? next : undefined;
}

export function recordCompletedPhase(
  task: OrchestratorTask,
  phase: string,
): void {
  setStructuredProgressEntry(task, {
    key: "completed-phases",
    kind: "completed-phase-list",
    payload: [phase],
  });
}

export function recordOutstandingQuestion(
  task: OrchestratorTask,
  question: string,
): void {
  setStructuredProgressEntry(task, {
    key: "outstanding-questions",
    kind: "outstanding-question-list",
    payload: [question],
  });
}

export function clearOutstandingQuestions(task: OrchestratorTask): void {
  deleteStructuredProgressEntry(task, "outstanding-questions");
}

export function maybeRecordReviewedItem(
  task: OrchestratorTask,
  node: TaskNode,
): void {
  if (node.selectedSkillId !== LIST_DETAIL_REVIEW_SKILL_ID) return;
  setStructuredProgressEntry(task, {
    key: "reviewed-items",
    kind: "reviewed-item-list",
    payload: [node.description],
  });
}

export function isLargeExhaustiveReviewGraph(nodes: TaskNode[]): boolean {
  const reviewNodeCount = nodes.filter(
    (node) => node.selectedSkillId === LIST_DETAIL_REVIEW_SKILL_ID,
  ).length;
  return reviewNodeCount >= EXHAUSTIVE_REVIEW_MIN_NODES_FOR_BUDGET_BUMP;
}

export function ignoreSiblingsAfterRootCompletion(
  task: OrchestratorTask,
  workers: Map<string, WorkerInstance> | undefined,
  params: { reason: string; result: string },
  emitTraceEvent: (
    type: string,
    data: Record<string, unknown>,
    role: "system",
  ) => void,
): string[] {
  const siblings = task.nodes.filter(
    (node) => node.status === "pending" || node.status === "running",
  );
  if (siblings.length === 0) return [];
  const skippedNodeIds = new Set(siblings.map((node) => node.id));
  for (const node of siblings) {
    node.status = "skipped";
    node.result = params.result;
    node.error = undefined;
  }
  for (const worker of workers?.values() ?? []) {
    if (!skippedNodeIds.has(worker.nodeId)) continue;
    const node = task.nodes.find((candidate) => candidate.id === worker.nodeId);
    emitTraceEvent(
      "worker_cancelled",
      {
        taskId: task.id,
        nodeId: worker.nodeId,
        workerId: worker.workerId,
        reason: params.reason,
        resources: node?.parallelContract?.resourceHints ?? [],
        ...buildParallelRunState(task),
      },
      "system",
    );
    worker.loop.requestStop();
  }
  return [...skippedNodeIds];
}
