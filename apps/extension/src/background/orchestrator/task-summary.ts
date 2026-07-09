/**
 * Programmatic task-summary builder (RFC LP-16 Phase 5). Renders a fallback
 * completion summary from a task's node statuses. Pure — verbatim movement of
 * the AgentOrchestrator helper.
 */
import type { OrchestratorTask } from "./types";

export function buildProgrammaticSummary(task: OrchestratorTask): string {
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
