/**
 * Plan-state construction for the orchestrator (RFC LP-16 Phase 5).
 *
 * Pure builders extracted verbatim from orchestrator/index.ts: the node
 * tool-profile resolver, the parallel-run resource-lock state, the initial
 * plan state, and the single-node plan synthesizer. No behavior change — the
 * orchestrator imports these back and re-exports buildInitialPlanState.
 */
import { inferToolProfileForStep } from "../agent/planner";
import type { ToolProfile } from "../tools/metadata";
import type { OrchestratorTask, TaskNode, VerificationGate } from "./types";

export function getNodeToolProfile(
  node: Pick<TaskNode, "description" | "successCriteria" | "toolProfile">,
): ToolProfile | undefined {
  return (
    node.toolProfile ??
    inferToolProfileForStep(node.description, node.successCriteria)
  );
}

export function buildParallelRunState(task: OrchestratorTask): {
  activeWorkerCount: number;
  resourceLocks: Array<{
    nodeId: string;
    parallelism: string;
    resources: NonNullable<TaskNode["parallelContract"]>["resourceHints"];
  }>;
} {
  const runningNodes = task.nodes.filter((node) => node.status === "running");
  return {
    activeWorkerCount: runningNodes.length,
    resourceLocks: runningNodes.map((node) => ({
      nodeId: node.id,
      parallelism: node.parallelContract?.parallelism ?? "unknown",
      resources: node.parallelContract?.resourceHints ?? [],
    })),
  };
}

export function buildInitialPlanState(
  task: OrchestratorTask,
  activeNodeId?: string,
) {
  if (task.nodes.length === 1) {
    const synthesized = synthesizePlanStateFromSingleNode(task.nodes[0]);
    if (synthesized && synthesized.subtasks.length >= 2) {
      return synthesized;
    }
  }

  const activeIndex =
    activeNodeId != null
      ? task.nodes.findIndex((node) => node.id === activeNodeId)
      : -1;
  const runningIndex = task.nodes.findIndex(
    (node) => node.status === "running",
  );
  return {
    subtasks: task.nodes.map((node) => {
      const toolProfile = getNodeToolProfile(node);
      return {
        description: node.description,
        successCriteria: node.successCriteria,
        status: node.status,
        turnsUsed: 0,
        turnBudget: 0,
        ...(node.result ? { result: node.result } : {}),
        ...(node.verificationGate
          ? { verificationGate: node.verificationGate }
          : {}),
        ...(toolProfile ? { toolProfile } : {}),
        ...(node.selectedSkillId
          ? { selectedSkillId: node.selectedSkillId }
          : {}),
      };
    }),
    currentIndex:
      activeIndex >= 0
        ? activeIndex
        : runningIndex >= 0
          ? runningIndex
          : Math.max(0, task.currentIndex),
  };
}

export function isTabOccupiedByRunningNode(
  tabId: number,
  nodeTabMap: Map<string, number>,
  nodes: TaskNode[],
): boolean {
  for (const [nodeId, assignedTabId] of nodeTabMap) {
    if (assignedTabId !== tabId) continue;
    const node = nodes.find((n) => n.id === nodeId);
    if (node?.status === "running") return true;
  }
  return false;
}

export function synthesizePlanStateFromSingleNode(node: TaskNode): {
  subtasks: Array<{
    description: string;
    successCriteria: string;
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    turnsUsed: number;
    turnBudget: number;
    result?: string;
    verificationGate?: VerificationGate;
    toolProfile?: ToolProfile;
    selectedSkillId?: string;
  }>;
  currentIndex: number;
} | null {
  const stepPattern =
    /(?:^|\n)\s*Step\s+(\d+)\s*:\s*([\s\S]*?)(?=(?:\n\s*Step\s+\d+\s*:)|$)/gi;
  const matches = [...node.description.matchAll(stepPattern)];
  if (matches.length < 2) return null;

  const currentIndex = 0;
  const baseStatus: "pending" | "completed" | "failed" =
    node.status === "completed" || node.status === "failed"
      ? node.status
      : "pending";

  return {
    subtasks: matches
      .map((match, index) => {
        const description = match[2]?.trim();
        if (!description) return null;
        const toolProfile = inferToolProfileForStep(
          description,
          node.successCriteria,
        );
        const status: "pending" | "running" | "completed" | "failed" =
          node.status === "completed"
            ? "completed"
            : index < currentIndex
              ? "completed"
              : index === currentIndex
                ? node.status === "running"
                  ? "running"
                  : baseStatus
                : "pending";
        return {
          description,
          successCriteria: node.successCriteria,
          status,
          turnsUsed: 0,
          turnBudget: 0,
          ...(index === matches.length - 1 && node.verificationGate
            ? { verificationGate: node.verificationGate }
            : {}),
          ...(toolProfile ? { toolProfile } : {}),
        };
      })
      .filter(
        (subtask): subtask is NonNullable<typeof subtask> => subtask !== null,
      ),
    currentIndex,
  };
}
