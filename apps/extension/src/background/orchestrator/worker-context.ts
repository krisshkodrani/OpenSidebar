import { logger } from "../../utils";
import { getSnapshotFingerprint } from "../agent/loop-helpers";
import type { TurnCheckpoint } from "../agent/checkpoint-types";
import type { OrchestratorTask, TaskNode } from "./types";
import { isTurnCheckpointCompatible } from "./completion-envelope-verification";
import {
  buildAssumptionDriftSignal,
  buildTaskStateBrief,
  shouldUseVerificationTurnMode,
} from "./handoff";

type WorkerSnapshot = {
  title?: string;
  url?: string;
  elements?: { length: number };
  visibleContent?: string;
  pageContent?: string;
} | null | undefined;

export function prepareWorkerContext(input: {
  task: OrchestratorTask;
  node: TaskNode;
  snapshot: WorkerSnapshot;
  emitTrace: (type: string, data: Record<string, unknown>) => void;
}): {
  validatedTurnCheckpoint: TurnCheckpoint | null;
  driftSignal: string;
  driftDetected: boolean;
  taskStateBrief: string;
  verifierTaskStateBrief: string;
  verificationTurnMode: boolean;
} {
  const { task, node, snapshot, emitTrace } = input;
  const recoveredTurnCheckpoints = (
    task as OrchestratorTask & { _turnCheckpoints?: Map<string, TurnCheckpoint> }
  )._turnCheckpoints;
  const candidateTurnCheckpoint =
    recoveredTurnCheckpoints?.get(node.id) ?? null;
  let validatedTurnCheckpoint: TurnCheckpoint | null = null;
  if (candidateTurnCheckpoint) {
    recoveredTurnCheckpoints?.delete(node.id);
    if (isTurnCheckpointCompatible(candidateTurnCheckpoint, snapshot)) {
      validatedTurnCheckpoint = candidateTurnCheckpoint;
      emitTrace("checkpoint_turn_restored", {
        taskId: task.id,
        nodeId: node.id,
        checkpointTurn: candidateTurnCheckpoint.turnCount,
        pageUrl: candidateTurnCheckpoint.pageUrl,
        snapshotFingerprint: candidateTurnCheckpoint.snapshotFingerprint,
      });
      logger.info(
        "orchestrator",
        "Using durable turn checkpoint for recovered node",
        {
          taskId: task.id,
          nodeId: node.id,
          turn: candidateTurnCheckpoint.turnCount,
        },
      );
    } else {
      emitTrace("checkpoint_turn_discarded", {
        taskId: task.id,
        nodeId: node.id,
        reason: "snapshot_mismatch",
        checkpointUrl: candidateTurnCheckpoint.pageUrl,
        liveUrl: snapshot?.url ?? null,
        checkpointFingerprint: candidateTurnCheckpoint.snapshotFingerprint,
        liveFingerprint: getSnapshotFingerprint(snapshot ?? null),
      });
      logger.warn(
        "orchestrator",
        "Discarding incompatible turn checkpoint for recovered node",
        {
          taskId: task.id,
          nodeId: node.id,
          checkpointUrl: candidateTurnCheckpoint.pageUrl,
          liveUrl: snapshot?.url ?? null,
          checkpointFingerprint: candidateTurnCheckpoint.snapshotFingerprint,
          liveFingerprint: getSnapshotFingerprint(snapshot ?? null),
        },
      );
    }
  }
  const driftSignal = buildAssumptionDriftSignal(node, snapshot ?? null);
  const driftDetected = driftSignal.startsWith(
    "Potential plan-reality drift",
  );
  if (driftSignal.startsWith("Potential plan-reality drift")) {
    logger.warn("orchestrator", "Planner assumption drift detected", {
      taskId: task.id,
      nodeId: node.id,
      driftSignal,
      assumptionCount: node.assumptions.length,
    });
  }
  const taskStateBrief = buildTaskStateBrief(
    task.nodes,
    node.id,
    "executor",
    node,
    task.structuredProgress,
  );
  const verifierTaskStateBrief = buildTaskStateBrief(
    task.nodes,
    node.id,
    "verifier",
    undefined,
    task.structuredProgress,
  );
  const verificationTurnMode = shouldUseVerificationTurnMode({
    originalQuery: task.query,
  });
  return {
    validatedTurnCheckpoint,
    driftSignal,
    driftDetected,
    taskStateBrief,
    verifierTaskStateBrief,
    verificationTurnMode,
  };
}
