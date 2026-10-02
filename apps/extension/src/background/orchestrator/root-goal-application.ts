import type { DomSnapshot } from "../../types";
import { logger } from "../../utils";
import type { OrchestratorTask } from "./types";
import {
  assessRootGoalWithDiagnostics,
  rootGoalReconciliationTrace,
  shouldAssessRootGoal,
} from "./root-goal-policy";

export async function applyRootGoalShortcut(input: {
  task: OrchestratorTask;
  getSnapshot: () => Promise<DomSnapshot | undefined>;
  ignoreSiblings: (params: { reason: string; result: string }) => string[];
  emitCompletionScope: (reason: string, skippedNodeIds: string[]) => void;
  emitTrace: (type: string, data: Record<string, unknown>) => void;
}): Promise<boolean> {
  const {
    task, getSnapshot, ignoreSiblings, emitCompletionScope, emitTrace,
  } = input;
  if (!shouldAssessRootGoal(task.nodes)) return false;
  try {
    const { decision, reconciliation } = assessRootGoalWithDiagnostics({
      query: task.query,
      nodes: task.nodes,
      snapshot: (await getSnapshot()) ?? null,
    });
    if (reconciliation) {
      emitTrace(
        "root_reconciliation",
        rootGoalReconciliationTrace(reconciliation, task.nodes),
      );
    }
    if (!decision) return false;

    const reason = decision.gate === "navigation"
      ? "navigation_goal_already_achieved" : decision.reason;
    const skippedNodeIds = ignoreSiblings({
      reason,
      result: decision.gate === "reconciliation"
        ? "Skipped: grounded root objective already achieved"
        : decision.gate === "navigation"
          ? "Skipped: navigation goal already achieved"
          : "Skipped: global goal already achieved",
    });
    emitCompletionScope(reason, skippedNodeIds);
    if (decision.gate !== "reconciliation") {
      emitTrace(
        decision.gate === "navigation"
          ? "navigation_goal_gate" : "global_goal_gate",
        {
          reason,
          skippedNodes: skippedNodeIds.length,
          ...(decision.gate === "navigation"
            ? { matchedLabels: decision.matchedLabels }
            : { matchedTokens: decision.matchedTokens }),
        },
      );
    }
    return true;
  } catch (err) {
    logger.debug("orchestrator", "Root goal policy could not assess snapshot", {
      taskId: task.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
