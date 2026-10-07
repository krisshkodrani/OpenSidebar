import type { TaskNode, OrchestratorTask } from "./types";

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function nodeTurns(node: TaskNode): number {
  return count(node.turnsUsed);
}

export function observeNodeTurns(node: TaskNode, attemptTurns: number): void {
  node.turnsUsed = Math.max(nodeTurns(node), count(node.turnAttemptBase) + count(attemptTurns));
}

export interface TurnWorker {
  nodeId: string;
  loop: { getCurrentTurn?(): number };
}

export function observeTaskTurns(task: OrchestratorTask, workers: Iterable<TurnWorker> = []): void {
  for (const worker of workers) {
    const node = task.nodes.find((candidate) => candidate.id === worker.nodeId);
    if (node) observeNodeTurns(node, worker.loop.getCurrentTurn?.() ?? 0);
  }
}

export function taskTurns(task: OrchestratorTask): number {
  return task.nodes.reduce((total, node) => total + nodeTurns(node), 0);
}

export function stopTrackedWorker(task: OrchestratorTask | undefined, worker: TurnWorker & { loop: { stop(): void } }): void {
  if (task) observeTaskTurns(task, [worker]);
  worker.loop.stop();
}

/** Checkpoint counts are cumulative within an attempt; retries start a new base. */
export async function trackNodeTurns<T extends { turnCount: number }>(
  node: TaskNode,
  loop: TurnWorker["loop"],
  checkpointTurns: number | undefined,
  resumeCheckpoint: boolean,
  persist: () => Promise<unknown>,
  start: () => Promise<T>,
): Promise<T> {
  // Even an incompatible checkpoint represents work already performed.
  if (checkpointTurns !== undefined) observeNodeTurns(node, checkpointTurns);
  node.turnAttemptBase = resumeCheckpoint ? count(node.turnAttemptBase) : nodeTurns(node);
  // Persist the base before starting, so service-worker recovery cannot count a retry twice.
  await persist();
  try {
    const result = await start();
    observeNodeTurns(node, result.turnCount);
    return result;
  } finally {
    observeNodeTurns(node, loop.getCurrentTurn?.() ?? 0);
  }
}
