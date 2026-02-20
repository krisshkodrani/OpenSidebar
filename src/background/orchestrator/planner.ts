import { PlanGuardian } from "../agent/guardian";
import { ToolName } from "../../types";
import { logger } from "../../utils";
import {
  PlannerAssignment,
  TaskNode,
} from "./types";

const EXECUTOR_DEFAULT_TOOLS: ToolName[] = [
  ToolName.CLICK_ELEMENT,
  ToolName.TYPE_TEXT,
  ToolName.SCROLL_PAGE,
  ToolName.READ_PAGE,
  ToolName.NAVIGATE,
  ToolName.CREATE_TAB,
  ToolName.CLOSE_TAB,
  ToolName.SWITCH_TAB,
  ToolName.WAIT,
  ToolName.TAKE_SCREENSHOT,
  ToolName.HOVER_ELEMENT,
  ToolName.FIND_ELEMENT,
  ToolName.SELECT_OPTION,
  ToolName.PRESS_KEY,
  ToolName.DRAG_AND_DROP,
  ToolName.DRAW_STROKE,
  ToolName.HIDE_ELEMENT,
  ToolName.GO_BACK,
  ToolName.GO_FORWARD,
  ToolName.LIST_TABS,
  ToolName.RIGHT_CLICK,
  ToolName.SET_CHECKBOX,
  ToolName.CLICK_COORDINATES,
  ToolName.READ_ELEMENT,
  ToolName.INSPECT_HIDDEN,
  ToolName.XRAY_PAGE,
  ToolName.FAST_FORWARD,
  ToolName.DISMISS_OVERLAYS,
  ToolName.MEMORY_SEARCH,
  ToolName.MEMORY_ADD,
  ToolName.MEMORY_UPDATE,
  ToolName.MEMORY_DELETE,
  ToolName.MEMORY_LIST_CATEGORIES,
  ToolName.ESCALATE,
  ToolName.DONE,
];

const TOOL_NAMES = new Set<string>(Object.values(ToolName));

function sanitizePlannerAssignment(raw: unknown): PlannerAssignment | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (obj.role !== "executor") return null;
  if (typeof obj.objective !== "string" || obj.objective.trim().length === 0)
    return null;
  if (
    typeof obj.successCriteria !== "string" ||
    obj.successCriteria.trim().length === 0
  ) {
    return null;
  }
  if (!Array.isArray(obj.allowedTools) || obj.allowedTools.length === 0)
    return null;

  const tools: ToolName[] = [];
  for (const tool of obj.allowedTools) {
    if (typeof tool !== "string" || !TOOL_NAMES.has(tool)) return null;
    if (!tools.includes(tool as ToolName)) {
      tools.push(tool as ToolName);
    }
  }
  if (!tools.includes(ToolName.DONE)) {
    tools.push(ToolName.DONE);
  }
  const dependencies: string[] = [];
  if (Array.isArray(obj.dependencies)) {
    for (const dep of obj.dependencies) {
      if (typeof dep !== "string" || dep.trim().length === 0) return null;
      const normalized = dep.trim();
      if (!dependencies.includes(normalized)) dependencies.push(normalized);
    }
  }
  const assumptions: string[] = [];
  if (Array.isArray(obj.assumptions)) {
    for (const assumption of obj.assumptions) {
      if (typeof assumption !== "string") return null;
      const normalized = assumption.trim();
      if (normalized.length === 0) continue;
      if (!assumptions.includes(normalized)) assumptions.push(normalized);
    }
  }

  return {
    role: "executor",
    objective: obj.objective.trim(),
    successCriteria: obj.successCriteria.trim(),
    allowedTools: tools,
    dependencies,
    assumptions,
  };
}

export function validatePlannerAssignments(raw: unknown): PlannerAssignment[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Planner returned empty or non-array assignments.");
  }

  const sanitized = raw.map(sanitizePlannerAssignment);
  const invalidIndex = sanitized.findIndex((a) => a === null);
  if (invalidIndex >= 0) {
    throw new Error(`Planner assignment at index ${invalidIndex} is invalid.`);
  }
  return sanitized as PlannerAssignment[];
}

export class OrchestratorPlanner {
  private guardian: PlanGuardian;

  constructor(openRouterApiKey: string, cerebrasApiKey?: string) {
    this.guardian = new PlanGuardian(openRouterApiKey, cerebrasApiKey);
  }

  async buildNodes(
    query: string,
    pageTitle: string,
    pageUrl: string,
    signal?: AbortSignal,
  ): Promise<TaskNode[]> {
    const decomposition = await this.guardian.decompose(
      query,
      pageTitle,
      pageUrl,
      signal,
    );

    let rawAssignments: PlannerAssignment[] = [];
    let nodeIds: string[] = [];
    if (decomposition?.steps?.length) {
      nodeIds = decomposition.steps.map(() => crypto.randomUUID());
      rawAssignments = decomposition.steps.map((step, index) => ({
        role: "executor",
        objective: step.objective,
        successCriteria:
          step.successCriteria ||
          `The subtask outcome for "${step.objective}" is verified on the page or in tool output.`,
        allowedTools: [...EXECUTOR_DEFAULT_TOOLS],
        dependencies: (step.dependencies || [])
          .filter(
            (depIndex) =>
              Number.isInteger(depIndex) && depIndex >= 0 && depIndex < index,
          )
          .map((depIndex) => nodeIds[depIndex]),
        assumptions: step.assumptions || [],
      }));
      logger.info(
        "orchestrator",
        "Planner produced structured graph assignments",
        {
          count: rawAssignments.length,
        },
      );
    } else {
      const subtasks = decomposition?.subtasks?.length
        ? decomposition.subtasks
        : [query];
      rawAssignments = subtasks.map((step) => ({
        role: "executor",
        objective: step,
        successCriteria: `The subtask outcome for "${step}" is verified on the page or in tool output.`,
        allowedTools: [...EXECUTOR_DEFAULT_TOOLS],
        dependencies: [],
        assumptions: [],
      }));
      nodeIds = rawAssignments.map(() => crypto.randomUUID());
    }

    const assignments = validatePlannerAssignments(rawAssignments);

    logger.info("orchestrator", "Planner generated nodes", {
      count: assignments.length,
    });

    return assignments.map((assignment, index) => ({
      id: nodeIds[index],
      role: assignment.role,
      description: assignment.objective,
      successCriteria: assignment.successCriteria,
      allowedTools: assignment.allowedTools,
      dependencies: (assignment.dependencies || []).filter(
        (dep) => dep.length > 0,
      ),
      assumptions: assignment.assumptions || [],
      handoffArtifacts: [
        {
          role: "planner",
          phase: "planned",
          note:
            assignment.assumptions && assignment.assumptions.length > 0
              ? `Planner assigned objective: ${assignment.objective}. Assumptions: ${assignment.assumptions.join("; ")}`
              : `Planner assigned objective: ${assignment.objective}`,
          timestamp: Date.now(),
        },
      ],
      reflexionLog: [],
      handoffDepth: 0,
      status: "pending" as const,
      retries: 0,
    }));
  }

  async expandNode(
    node: TaskNode,
    pageTitle: string,
    pageUrl: string,
    reason: string,
    signal?: AbortSignal,
  ): Promise<TaskNode[] | null> {
    const decomposition = await this.guardian.decompose(
      `Replan objective: ${node.description}\nReason: ${reason}`,
      pageTitle,
      pageUrl,
      signal,
    );
    if (!decomposition) return null;

    const steps = decomposition.steps?.length
      ? decomposition.steps
      : decomposition.subtasks.map((step, i) => ({
          objective: step,
          successCriteria: `The subtask outcome for "${step}" is verified on the page or in tool output.`,
          dependencies: i === 0 ? [] : [i - 1],
          assumptions: [],
        }));
    if (steps.length < 2) return null;

    const nodeIds = steps.map(() => crypto.randomUUID());
    const expanded: TaskNode[] = steps.map((step, index) => ({
      id: nodeIds[index],
      role: "executor",
      description: step.objective,
      successCriteria:
        step.successCriteria ||
        `The subtask outcome for "${step.objective}" is verified on the page or in tool output.`,
      allowedTools: [...node.allowedTools],
      dependencies: [
        ...(index === 0 ? node.dependencies : []),
        ...(step.dependencies || [])
          .filter(
            (depIndex) =>
              Number.isInteger(depIndex) && depIndex >= 0 && depIndex < index,
          )
          .map((depIndex) => nodeIds[depIndex]),
      ],
      assumptions: step.assumptions || [],
      handoffArtifacts: [
        {
          role: "planner",
          phase: "planner_replan",
          note: `Planner replanned from node ${node.id}: ${step.objective}`,
          timestamp: Date.now(),
        },
      ],
      reflexionLog: [],
      handoffDepth: node.handoffDepth,
      handoffFromNodeId: node.id,
      status: "pending",
      retries: 0,
    }));

    logger.info("orchestrator", "Planner expanded node into subgraph", {
      sourceNodeId: node.id,
      count: expanded.length,
    });
    return expanded;
  }

}
