import { AgentStatus, type TaskCompletionMessage } from "../../types";
import { assessTaskContractCoverage, buildTaskContract } from "../agent/task-contract";
import { hasUsefulPartialProgressHandoff } from "../agent/partial-progress-handoff";
import type { OrchestratorTask } from "./types";
import { buildProgrammaticSummary } from "./task-summary";
import { buildSubtaskResults } from "./builders";
import { isUnpenalizedGoalShortcutSkip } from "./node-heuristics";
import {
  buildTaskCompletedEventPayload,
  deriveCompletionStatus,
} from "./task-outcome-policy";
import { isUserSkippedNode } from "./utils";

/** Build the final card from observed node results and task-contract coverage. */
export function buildTaskCompletionPayload(
  task: OrchestratorTask,
): {
  completionPayload: TaskCompletionMessage["payload"];
  completionStatus: ReturnType<typeof deriveCompletionStatus>;
  completed: number;
  skipped: number;
  failed: number;
  totalDurationMs: number;
} {
  const completed = task.nodes.filter((n) => n.status === "completed").length;
  const skipped = task.nodes.filter((n) => isUserSkippedNode(n)).length;
  const failed = task.nodes.filter(
    (n) => n.status === "failed" && !isUserSkippedNode(n),
  ).length;
  const finishedAt = Date.now();

  // The final visible result is emitted only as TASK_COMPLETION so the UI does
  // not briefly show a plain assistant bubble before its completion card.
  const summary = buildProgrammaticSummary(task);
  const subtaskResults = buildSubtaskResults(task);
  const penalizedSkipped = task.nodes.filter(
    (node) =>
      node.status === "skipped" && !isUnpenalizedGoalShortcutSkip(node),
  ).length;

  let completionStatus = deriveCompletionStatus({
    completed,
    failed,
    penalizedSkipped,
    hasUsefulHandoff: hasUsefulPartialProgressHandoff(task.partialHandoff),
  });

  const contract = buildTaskContract(task.query);
  // Entity/number coverage uses all node descriptions + results.
  const coverageCorpus = [
    summary,
    ...subtaskResults.map(
      (item) => `${item.description}\n${item.result || ""}`,
    ),
  ].join("\n");
  // Return-target coverage must only check actual execution results.
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
    totalTimeMs: finishedAt - (task.startedAt || task.createdAt),
    summary,
    subtaskResults,
    urlHistory: [],
    metrics: task.sessionMetrics,
    terminationReason: task.terminationReason,
    ...(task.partialHandoff ? { partialHandoff: task.partialHandoff } : {}),
  };
  const totalDurationMs = finishedAt - (task.startedAt || task.createdAt);
  return {
    completionPayload,
    completionStatus,
    completed,
    skipped,
    failed,
    totalDurationMs,
  };
}

/** Prepare the final task card and its post-emission reporting together. */
export function buildScheduledTaskFinalization(input: {
  task: OrchestratorTask;
  budgetTerminated: boolean;
  emitRootCompleted: () => void;
  emitCompletedTrace: (
    data: ReturnType<typeof buildTaskCompletedEventPayload>,
  ) => void;
}): {
  status: "completed" | "failed";
  buildPayload: () => TaskCompletionMessage["payload"];
  agentStatus: AgentStatus;
  detail: string;
  telemetry: true;
  closeTabs: true;
  afterEmission: () => void;
} {
  const { task, budgetTerminated, emitRootCompleted, emitCompletedTrace } = input;
  const {
    completionPayload, completionStatus, completed, skipped, failed,
    totalDurationMs,
  } = buildTaskCompletionPayload(task);
  return {
    status: budgetTerminated || failed > 0 ? "failed" : "completed",
    buildPayload: () => completionPayload,
    agentStatus: AgentStatus.IDLE,
    detail: "Task complete",
    telemetry: true,
    closeTabs: true,
    afterEmission: () => {
      if (completionStatus === "completed") emitRootCompleted();
      emitCompletedTrace(buildTaskCompletedEventPayload({
        taskId: task.id, completionStatus, completed, failed, skipped,
        totalDurationMs, totalTokens: task.sessionMetrics.totalTokens,
        totalCostUsd: task.sessionMetrics.totalCost,
        terminationReason: task.terminationReason ?? null,
      }));
    },
  };
}
