import type {
  OrchestratorTask,
  TaskNode,
  VerifierAcceptedResult,
} from "./types";

const MAX_ACCEPTED_RESULTS = 32;
const MAX_ACCEPTED_RESULT_CHARS = 8_000;

function nodeResult(node: TaskNode): string {
  return (node.userFacingResult || node.result || "").trim();
}

function wasVerifierAccepted(node: TaskNode): boolean {
  return node.handoffArtifacts.some(
    (artifact) => artifact.phase === "verifier_accept",
  );
}

export function recordVerifierAcceptedResult(
  task: OrchestratorTask,
  node: Pick<TaskNode, "id">,
  result: string,
  acceptedAt = Date.now(),
): void {
  const normalized = result.trim().slice(0, MAX_ACCEPTED_RESULT_CHARS);
  if (!normalized) return;

  const existing = task.verifierAcceptedResults ?? [];
  task.verifierAcceptedResults = [
    ...existing.filter((entry) => entry.nodeId !== node.id),
    { nodeId: node.id, result: normalized, acceptedAt },
  ].slice(-MAX_ACCEPTED_RESULTS);
}

/**
 * Returns accepted results in synthesis order. Results orphaned by replanning
 * come first as supporting evidence; results still represented in the current
 * graph come afterward so the latest active node remains the final answer.
 */
export function collectVerifierAcceptedResults(
  task: OrchestratorTask,
): VerifierAcceptedResult[] {
  const ledger = task.verifierAcceptedResults ?? [];
  const currentNodeIds = new Set(task.nodes.map((node) => node.id));
  const orphaned = ledger.filter((entry) => !currentNodeIds.has(entry.nodeId));
  const byNodeId = new Map(ledger.map((entry) => [entry.nodeId, entry]));
  const currentAccepted = task.nodes.flatMap((node, index) => {
    if (node.status !== "completed") return [];
    const recorded = byNodeId.get(node.id);
    if (!recorded && ledger.length > 0 && !wasVerifierAccepted(node)) return [];
    const result = nodeResult(node) || recorded?.result || "";
    if (!result) return [];
    return [
      {
        nodeId: node.id,
        result,
        acceptedAt: recorded?.acceptedAt ?? index,
      },
    ];
  });

  return [...orphaned, ...currentAccepted];
}
