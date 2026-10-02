import type { DomSnapshot } from "../../types";
import {
  assessTaskContractCoverage,
  buildTaskContract,
} from "../agent/task-contract";
import { matchSuccessCriteria } from "../agent/loop-helpers";
import {
  assessNavigationGoalCompletion,
  isNavigationOnlyRequest,
} from "./navigation-goal-heuristics";
import {
  classifyNodeEffect,
  isMutationEffect,
  isSafeToSuppressAfterRootCompletion,
} from "./node-effect-policy";
import { summaryOfCompletedNodes } from "./node-heuristics";
import {
  reconcileRootCompletion,
  type RootReconciliationDecision,
} from "./root-reconciliation";
import type { TaskNode } from "./types";

export type RootGoalDecision =
  | { gate: "navigation"; reason: string; matchedLabels: string[] }
  | { gate: "reconciliation"; reason: string }
  | { gate: "criteria"; reason: string; matchedTokens: string[] }
  | null;

export interface RootGoalAssessment {
  decision: RootGoalDecision;
  reconciliation: RootReconciliationDecision | null;
}

export function rootGoalReconciliationTrace(
  reconciliation: RootReconciliationDecision,
  nodes: TaskNode[],
) {
  const remaining = nodes.filter((node) =>
    node.status === "pending" || node.status === "running");
  return {
    decision: reconciliation.decision,
    reason: reconciliation.reason,
    remainingNodeIds: remaining.map((node) => node.id),
    remainingEffects: remaining.map((node) => ({
      nodeId: node.id,
      effect: classifyNodeEffect(node),
    })),
  };
}

function eligibleNodes(nodes: TaskNode[]) {
  const completed = nodes.filter((node) => node.status === "completed");
  const active = nodes.filter(
    (node) => node.status === "pending" || node.status === "running",
  );
  const unresolved = active.some(
    (node) =>
      node.status === "pending" &&
      (node.retries > 0 ||
        Boolean(node.error) ||
        node.handoffArtifacts.some(
          (artifact) =>
            artifact.phase === "executor_finished" &&
            artifact.evidence?.some((entry) => (entry.confidence ?? 1) < 1),
        )),
  );
  return {
    completed,
    active,
    eligible: completed.length > 0 && active.length > 0 && !unresolved,
  };
}

/** Avoid fetching a page snapshot when no root shortcut can be considered. */
export function shouldAssessRootGoal(nodes: TaskNode[]): boolean {
  return eligibleNodes(nodes).eligible;
}

/** Single, side-effect-free authority for suppressing redundant root work. */
export function assessRootGoalWithDiagnostics(input: {
  query: string;
  nodes: TaskNode[];
  snapshot: DomSnapshot | null;
}): RootGoalAssessment {
  const { query, nodes, snapshot } = input;
  const { completed, active, eligible } = eligibleNodes(nodes);
  if (!eligible) return { decision: null, reconciliation: null };

  if (isNavigationOnlyRequest(query)) {
    const navigation = assessNavigationGoalCompletion({
      query,
      snapshot: snapshot ?? undefined,
      completedNodes: completed,
    });
    if (navigation.satisfied) {
      return { decision: {
        gate: "navigation",
        reason: navigation.reason,
        matchedLabels: navigation.matchedLabels,
      }, reconciliation: null };
    }
  }

  let reconciliation: RootReconciliationDecision | null = null;
  if (
    snapshot &&
    active.every((node) =>
      isSafeToSuppressAfterRootCompletion(classifyNodeEffect(node)),
    )
  ) {
    reconciliation = reconcileRootCompletion({
      query,
      completedNodes: completed,
      remainingNodes: active,
      snapshotText: [
        snapshot.title,
        snapshot.url,
        snapshot.visibleContent,
        snapshot.pageContent,
      ]
        .filter(Boolean)
        .join("\n"),
      hasUnresolvedAttempt: false,
    });
    if (reconciliation.decision === "complete") {
      return { decision: { gate: "reconciliation", reason: reconciliation.reason },
        reconciliation };
    }
  }

  if (active.length !== 1 || !snapshot) return { decision: null, reconciliation };
  const finalNode = nodes[nodes.length - 1];
  if (!active.includes(finalNode) || !finalNode.successCriteria)
    return { decision: null, reconciliation };
  const goalCheck = matchSuccessCriteria({
    successCriteria: finalNode.successCriteria,
    snapshot,
  });
  if (!goalCheck.satisfied || goalCheck.matchedTokens.length < 2)
    return { decision: null, reconciliation };

  const contract = buildTaskContract(query);
  const coverage = assessTaskContractCoverage({
    contract,
    text: [
      snapshot.title,
      snapshot.url,
      snapshot.visibleContent,
      snapshot.pageContent,
      ...completed.map((node) => node.result || ""),
      summaryOfCompletedNodes(completed),
    ]
      .filter(Boolean)
      .join("\n"),
    requireReturnTarget: contract.requiresRoundTrip,
  });
  if (
    contract.requiresRoundTrip ||
    contract.reportTargets.length > 1 ||
    contract.requiredEntities.length > 1 ||
    contract.requiredNumbers.length > 0 ||
    active.some((node) => isMutationEffect(classifyNodeEffect(node))) ||
    !coverage.satisfied
  )
    return { decision: null, reconciliation };

  return { decision: {
    gate: "criteria",
    reason: "global_goal_already_achieved",
    matchedTokens: goalCheck.matchedTokens,
  }, reconciliation };
}

export function assessRootGoal(input: {
  query: string;
  nodes: TaskNode[];
  snapshot: DomSnapshot | null;
}): RootGoalDecision {
  return assessRootGoalWithDiagnostics(input).decision;
}
