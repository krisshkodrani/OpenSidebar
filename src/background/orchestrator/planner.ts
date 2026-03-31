import { TaskPlanner } from "../agent/planner";
import type { LLMClientOptions } from "../llm";
import type { Difficulty } from "../agent/constants";
import { ToolName } from "../../types";
import { logger } from "../../utils";
import { resolveToolProfile, type ToolProfile } from "../tools/metadata";
import { inferToolProfileForStep } from "../agent/planner";
import { BuildNodesResult, PlannerAssignment, TaskNode } from "./types";

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
  ToolName.HOVER_ELEMENT,
  ToolName.FIND_ELEMENT,
  ToolName.SELECT_OPTION,
  ToolName.PRESS_KEY,
  ToolName.DRAG_AND_DROP,
  ToolName.HIDE_ELEMENT,
  ToolName.GO_BACK,
  ToolName.LIST_TABS,
  ToolName.RIGHT_CLICK,
  ToolName.SET_CHECKBOX,
  ToolName.CLICK_COORDINATES,
  ToolName.READ_ELEMENT,
  ToolName.INSPECT_HIDDEN,
  ToolName.XRAY_PAGE,
  ToolName.DISMISS_OVERLAYS,
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

interface DecompositionStep {
  objective: string;
  successCriteria?: string;
  dependencies?: number[];
  assumptions?: string[];
  verifyAfter?: {
    trigger: string;
    action: "call_done" | "advance_step";
    pattern?: string;
  };
  toolProfile?: string;
}

function stepsToNodes(
  steps: DecompositionStep[],
  phase: "planned" | "planner_replan" = "planned",
): TaskNode[] {
  const nodeIds = steps.map(() => crypto.randomUUID());
  const rawAssignments: PlannerAssignment[] = steps.map((step, index) => ({
    role: "executor",
    objective: step.objective,
    successCriteria:
      step.successCriteria ||
      `The subtask outcome for "${step.objective}" is verified on the page or in tool output.`,
    // Always use the full default tool set for orchestrator nodes.
    // Per-step profile filtering is handled by applyToolProfile() inside
    // the agent loop — restricting here causes permanent tool blocking
    // when the loop internally advances past the node's original objective.
    allowedTools: [...EXECUTOR_DEFAULT_TOOLS],
    dependencies: (() => {
      const explicit = (step.dependencies || [])
        .filter(
          (depIndex) =>
            Number.isInteger(depIndex) && depIndex >= 0 && depIndex < index,
        )
        .map((depIndex) => nodeIds[depIndex]);
      // If the LLM provided no valid dependencies for a non-first step,
      // default to sequential chaining (depend on previous step).
      // This prevents accidental parallel launches (e.g. "apply coupon"
      // running before "add to cart").
      if (explicit.length === 0 && index > 0) {
        return [nodeIds[index - 1]];
      }
      return explicit;
    })(),
    assumptions: step.assumptions || [],
    verificationGate: step.verifyAfter ? { ...step.verifyAfter } : undefined,
  }));

  const assignments = validatePlannerAssignments(rawAssignments);

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
        phase,
        note:
          assignment.assumptions && assignment.assumptions.length > 0
            ? `Planner assigned objective: ${assignment.objective}. Assumptions: ${assignment.assumptions.join("; ")}`
            : `Planner assigned objective: ${assignment.objective}`,
        timestamp: Date.now(),
      },
    ],
    reflexionLog: [],
    handoffDepth: 0,
    verificationGate: assignment.verificationGate,
    status: "pending" as const,
    retries: 0,
  }));
}

export class OrchestratorPlanner {
  private planner: TaskPlanner;

  constructor(openRouterApiKey: string, modelOverrides?: LLMClientOptions) {
    this.planner = new TaskPlanner(openRouterApiKey, modelOverrides);
  }

  async buildNodes(
    query: string,
    pageTitle: string,
    pageUrl: string,
    signal?: AbortSignal,
  ): Promise<BuildNodesResult> {
    const decomposition = await this.planner.decompose(
      query,
      pageTitle,
      pageUrl,
      signal,
    );

    const difficulty: Difficulty = decomposition?.difficulty ?? "moderate";

    let nodes: TaskNode[];
    if (decomposition?.steps?.length) {
      nodes = stepsToNodes(decomposition.steps);
      logger.info(
        "orchestrator",
        "Planner produced structured graph assignments",
        { count: nodes.length },
      );
    } else {
      const subtasks = decomposition?.subtasks?.length
        ? decomposition.subtasks
        : [query];
      // Chain legacy subtasks sequentially: each step depends on the previous.
      // Without this, all nodes launch in parallel (e.g. "apply coupon" runs
      // before "add to cart" finishes → empty cart failure).
      const fallbackSteps: DecompositionStep[] = subtasks.map((step, i) => ({
        objective: step,
        dependencies: i > 0 ? [i - 1] : [],
        assumptions: [],
      }));
      nodes = stepsToNodes(fallbackSteps);
    }

    logger.info("orchestrator", "Planner generated nodes", {
      count: nodes.length,
    });

    // Simple task: decomposition had no subtasks (empty array)
    const isSingleNode =
      nodes.length === 1 &&
      (!decomposition?.subtasks?.length || decomposition.subtasks.length === 0);

    return { nodes, isSingleNode, difficulty };
  }

  async expandNode(
    node: TaskNode,
    pageTitle: string,
    pageUrl: string,
    reason: string,
    signal?: AbortSignal,
  ): Promise<TaskNode[] | null> {
    const decomposition = await this.planner.decompose(
      `Replan objective: ${node.description}\nReason: ${reason}`,
      pageTitle,
      pageUrl,
      signal,
    );
    if (!decomposition) return null;

    const steps: DecompositionStep[] = decomposition.steps?.length
      ? decomposition.steps
      : decomposition.subtasks.map((step, i) => ({
          objective: step,
          successCriteria: `The subtask outcome for "${step}" is verified on the page or in tool output.`,
          dependencies: i === 0 ? [] : [i - 1],
          assumptions: [] as string[],
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
      allowedTools: resolveToolProfile(
        step.toolProfile as ToolProfile | undefined,
      ) ?? [...node.allowedTools],
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
      verificationGate: step.verifyAfter ? { ...step.verifyAfter } : undefined,
      status: "pending",
      retries: 0,
    }));

    logger.info("orchestrator", "Planner expanded node into subgraph", {
      sourceNodeId: node.id,
      count: expanded.length,
    });
    return expanded;
  }

  async planNextHorizon(
    query: string,
    completedSummary: string,
    pageTitle: string,
    pageUrl: string,
    signal?: AbortSignal,
  ): Promise<TaskNode[] | null> {
    const horizonQuery = [
      "Continue working toward the overall goal.",
      "",
      `Overall goal: ${query}`,
      "",
      completedSummary,
      "",
      "Plan the NEXT 1-3 steps from the current page state.",
      "If the goal is already achieved, return an empty plan (steps: []).",
    ].join("\n");

    const decomposition = await this.planner.decompose(
      horizonQuery,
      pageTitle,
      pageUrl,
      signal,
    );

    if (!decomposition) return null;

    const steps = decomposition.steps?.length
      ? decomposition.steps
      : decomposition.subtasks?.length
        ? decomposition.subtasks.map((step) => ({
            objective: step,
            dependencies: [],
            assumptions: [],
          }))
        : [];

    if (steps.length === 0) return null;

    const nodes = stepsToNodes(steps as DecompositionStep[], "planned");

    logger.info("orchestrator", "Planner produced horizon expansion nodes", {
      count: nodes.length,
    });

    return nodes;
  }
}
