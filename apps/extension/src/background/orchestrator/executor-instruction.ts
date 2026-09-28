import { logger } from "../../utils";
import type { OrchestratorTask, TaskNode } from "./types";
import {
  buildExecutorInstruction,
  buildExecutorParallelContext,
} from "./handoff";
import { appendHandoffArtifact } from "./task-messaging";
import { isLaneIsolationError } from "./utils";

export async function prepareExecutorInstruction(input: {
  task: OrchestratorTask;
  node: TaskNode;
  taskStateBrief: string;
  driftSignal: string;
  verificationTurnMode: boolean;
  workerIndex: number;
  nodeTabMap: Map<string, number>;
  tabId: number;
  runAdvisory?: (instruction: string) => Promise<string | null>;
  emitAdvisoryTrace: (data: Record<string, unknown>) => void;
}): Promise<string> {
  const {
    task, node, taskStateBrief, driftSignal, verificationTurnMode,
    workerIndex, nodeTabMap, tabId, runAdvisory, emitAdvisoryTrace,
  } = input;
  const parallelContext = buildExecutorParallelContext({
    node,
    allNodes: task.nodes,
    workerIndex,
  });
  let executorInstruction = buildExecutorInstruction(
    node,
    taskStateBrief,
    driftSignal,
    undefined, // node.description used directly
    task.query,
    verificationTurnMode,
    task.personalContextBrief,
    parallelContext,
  );
  if (task.conversationContextBrief) {
    executorInstruction +=
      "\n\nRecent workspace conversation:\n" +
      task.conversationContextBrief +
      "\nUse this only to resolve follow-up references and preserve facts from earlier turns; the current request remains authoritative.";
  }

  // Inject predecessor trajectory for same-tab sequential nodes.
  if (node.dependencies.length > 0) {
    const predecessorTrajectories: string[] = [];
    for (const depId of node.dependencies) {
      const depNode = task.nodes.find((n) => n.id === depId);
      if (
        depNode?.trajectory &&
        depNode.trajectory.length > 0 &&
        nodeTabMap.get(depId) === tabId
      ) {
        predecessorTrajectories.push(
          `Prior actions (${depNode.description}):\n${depNode.trajectory.join("\n")}`,
        );
      }
    }
    if (predecessorTrajectories.length > 0) {
      executorInstruction +=
        "\n\nPage history from prior steps on this tab:\n" +
        predecessorTrajectories.join("\n\n");
    }
  }

  if ((node.retries > 0 || node.handoffFromNodeId) && runAdvisory) {
    try {
      const advisory = await runAdvisory(executorInstruction);
      if (advisory) {
        executorInstruction += `\n\nPre-execution advisory:\n${advisory}`;
        appendHandoffArtifact(node, {
          role: "verifier",
          phase: "verifier_advisory",
          note: advisory.slice(0, 200),
        });
        logger.debug("orchestrator", "Advisory appended to executor instruction", {
          taskId: task.id,
          nodeId: node.id,
          advisoryChars: advisory.length,
        });
        emitAdvisoryTrace({
          nodeId: node.id,
          advisoryChars: advisory.length,
          retries: node.retries,
          hasHandoff: Boolean(node.handoffFromNodeId),
        });
      }
    } catch (error) {
      if (isLaneIsolationError(error, "verifier")) {
        throw error;
      }
      logger.warn("orchestrator", "Advisory call failed, continuing without", {
        taskId: task.id,
        nodeId: node.id,
        error,
      });
    }
  }

  logger.debug("orchestrator", "Executor instruction prepared", {
    taskId: task.id,
    nodeId: node.id,
    retries: node.retries,
    handoffArtifactCount: node.handoffArtifacts.length,
    instructionChars: executorInstruction.length,
  });
  return executorInstruction;
}
