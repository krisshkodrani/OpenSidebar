import {
  assessTaskContractCoverage,
  buildTaskContract,
} from "../agent/task-contract";
import { classifyNodeEffect, isSafeToSuppressAfterRootCompletion } from "./node-effect-policy";
import type { TaskNode } from "./types";

export type RootReconciliationDecision =
  | { decision: "complete"; reason: string }
  | { decision: "continue"; reason: string };

const NEGATED_COMMIT_CLAUSE =
  /\b(?:do\s+not|don't|never|without)\b([^.;\n]*)/gi;
const COMMIT_ACTION =
  /\b(submit|send|post|publish|buy|purchase|delete|confirm|approve|finalize)\b/gi;

function prohibitedActions(query: string): string[] {
  const actions = new Set<string>();
  for (const clause of query.matchAll(NEGATED_COMMIT_CLAUSE)) {
    for (const action of clause[1].matchAll(COMMIT_ACTION)) {
      actions.add(action[1].toLowerCase());
    }
  }
  return [...actions];
}

function contradictsProhibition(corpus: string, actions: string[]): boolean {
  return actions.some((action) => {
    const completed = new RegExp(
      `\\b(?:${action}(?:ed|d)?|${action === "buy" ? "bought" : "__none__"})\\b`,
      "i",
    );
    const preserved = new RegExp(
      `\\b(?:not|never|without|un)\\w*\\s+(?:\\w+\\s+){0,3}${action}|\\bno\\s+(?:charge|purchase|submission|message)`,
      "i",
    );
    return completed.test(corpus) && !preserved.test(corpus);
  });
}

/**
 * Conservative root completion check. It only suppresses a final read-only
 * reporting/reverification node when accepted results plus the current page
 * already cover the root contract and do not contradict a prepare-only rule.
 */
export function reconcileRootCompletion(input: {
  query: string;
  completedNodes: TaskNode[];
  remainingNodes: TaskNode[];
  snapshotText: string;
  hasUnresolvedAttempt: boolean;
}): RootReconciliationDecision {
  const prohibited = prohibitedActions(input.query);
  if (prohibited.length === 0) {
    return { decision: "continue", reason: "not_prepare_only" };
  }
  if (input.completedNodes.length === 0) {
    return { decision: "continue", reason: "no_completed_evidence" };
  }
  if (input.hasUnresolvedAttempt) {
    return { decision: "continue", reason: "unresolved_attempt" };
  }
  if (
    input.remainingNodes.length === 0 ||
    input.remainingNodes.some(
      (node) =>
        !isSafeToSuppressAfterRootCompletion(classifyNodeEffect(node)),
    )
  ) {
    return { decision: "continue", reason: "remaining_mutation_work" };
  }
  if (
    !input.completedNodes.some(
      (node) => classifyNodeEffect(node) === "preparatory_write",
    )
  ) {
    return { decision: "continue", reason: "no_preparatory_completion" };
  }

  const corpus = [
    input.snapshotText,
    ...input.completedNodes.map(
      (node) => `${node.description}\n${node.result ?? ""}\n${node.userFacingResult ?? ""}`,
    ),
  ]
    .filter(Boolean)
    .join("\n");
  if (contradictsProhibition(corpus, prohibited)) {
    return { decision: "continue", reason: "prohibited_action_contradicted" };
  }

  const coverage = assessTaskContractCoverage({
    contract: buildTaskContract(input.query),
    text: corpus,
  });
  if (!coverage.satisfied) {
    return { decision: "continue", reason: "root_contract_incomplete" };
  }
  return { decision: "complete", reason: "grounded_root_contract_satisfied" };
}
