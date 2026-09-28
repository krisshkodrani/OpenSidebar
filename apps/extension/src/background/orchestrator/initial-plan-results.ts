import { buildDirectExecutionNodes, buildFallbackNodes, type OrchestratorPlanner } from "./planner";
import type { OrchestratorStartInput, OrchestratorTask, TaskNode } from "./types";
import type { resolveLaneTopologyFromSettings } from "./lane-topology";
import { updateTabGroupAppearance } from "../workspaces/tab-group-appearance";
import { buildPlanTraceGraph } from "./parallel-contract";
import { sendMessage } from "./task-messaging";
import { emitPlanningSkipped } from "./task-bootstrap";

type LaneTopology = ReturnType<typeof resolveLaneTopologyFromSettings>;
type TabContext = { title?: string; url?: string } | null;
type PlanTrace = (
  task: OrchestratorTask,
  data: Record<string, unknown>,
) => void;

export function recordDirectInitialPlan(input: {
  task: OrchestratorTask;
  startInput: OrchestratorStartInput;
  tab: TabContext;
  laneTopology: LaneTopology;
  trace: PlanTrace;
}): TaskNode[] {
  const { task, startInput, tab, laneTopology, trace } = input;
  const nodes = buildDirectExecutionNodes(
    startInput.query,
    "planned",
    tab?.title || "Untitled",
    tab?.url || "",
    { enabledSkillPackIds: task.enabledSkillPackIds },
  );
  task.planClassification = {
    isSingleNode: nodes.length === 1,
    difficulty: "simple",
  };
  if (nodes.length > 0) {
    updateTabGroupAppearance(startInput.workspaceId, {
      title: nodes[0].description,
    });
  }
  trace(task, {
    nodeCount: nodes.length,
    structured: false,
    fallback: true,
    plannerSkipped: true,
    laneTopologyMode: laneTopology.mode,
    graph: buildPlanTraceGraph(nodes),
    skills: nodes
      .filter((node) => node.selectedSkillId)
      .map((node) => ({
        nodeId: node.id,
        skillId: node.selectedSkillId,
        reason: node.selectedSkillReason,
      })),
  });
  emitPlanningSkipped(startInput.workspaceId);
  return nodes;
}

export function recordStructuredInitialPlan(input: {
  task: OrchestratorTask;
  startInput: OrchestratorStartInput;
  laneTopology: LaneTopology;
  buildResult: Awaited<ReturnType<OrchestratorPlanner["buildNodes"]>>;
  trace: PlanTrace;
}): TaskNode[] {
  const { task, startInput, laneTopology, buildResult, trace } = input;
  const nodes = buildResult.nodes;
  const selectedSkills = nodes
    .filter((node) => node.selectedSkillId)
    .map((node) => `${node.id.slice(0, 6)}:${node.selectedSkillId}`);
  task.planClassification = {
    isSingleNode: buildResult.isSingleNode,
    difficulty: buildResult.difficulty,
  };
  // Use the first node's planner-derived objective as a meaningful title.
  if (nodes.length > 0) {
    updateTabGroupAppearance(startInput.workspaceId, {
      title: nodes[0].description,
    });
  }
  trace(task, {
    nodeCount: nodes.length,
    structured: true,
    isSingleNode: buildResult.isSingleNode,
    difficulty: buildResult.difficulty,
    laneTopologyMode: laneTopology.mode,
    graph: buildPlanTraceGraph(nodes),
    skills: nodes
      .filter((node) => node.selectedSkillId)
      .map((node) => ({
        nodeId: node.id,
        skillId: node.selectedSkillId,
        reason: node.selectedSkillReason,
      })),
  });
  sendMessage({
    type: "AGENT_STEP",
    workspaceId: startInput.workspaceId,
    payload: {
      step: {
        id: crypto.randomUUID(),
        type: "info",
        label: `Planning ${nodes.length} ${nodes.length === 1 ? "step" : "steps"}`,
        ...(selectedSkills.length > 0
          ? { detail: `Skills: ${selectedSkills.join(", ")}` }
          : {}),
        status: "done",
        timestamp: Date.now(),
      },
      update: false,
    },
  });
  return nodes;
}

export function recordFallbackInitialPlan(input: {
  task: OrchestratorTask;
  startInput: OrchestratorStartInput;
  tab: TabContext;
  laneTopology: LaneTopology;
  error: { message?: string } | null | undefined;
  trace: PlanTrace;
}): TaskNode[] {
  const { task, startInput, tab, laneTopology, error, trace } = input;
  const nodes = buildFallbackNodes(
    startInput.query,
    "planned",
    tab?.title || "Untitled",
    tab?.url || "",
    { enabledSkillPackIds: task.enabledSkillPackIds },
  );
  task.planClassification = {
    isSingleNode: nodes.length === 1,
    difficulty: "moderate",
  };
  trace(task, {
    nodeCount: 1,
    structured: false,
    fallback: true,
    laneTopologyMode: laneTopology.mode,
    graph: buildPlanTraceGraph(nodes),
    skills: nodes
      .filter((node) => node.selectedSkillId)
      .map((node) => ({
        nodeId: node.id,
        skillId: node.selectedSkillId,
        reason: node.selectedSkillReason,
      })),
  });
  sendMessage({
    type: "AGENT_STEP",
    workspaceId: startInput.workspaceId,
    payload: {
      step: {
        id: crypto.randomUUID(),
        type: "info",
        label: "Planning approach",
        detail: error?.message || "Unknown planner error",
        status: "done",
        timestamp: Date.now(),
      },
      update: false,
    },
  });
  return nodes;
}
