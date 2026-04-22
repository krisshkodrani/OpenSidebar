import { TaskPlanner } from "../agent/planner";
import type { LLMClientOptions } from "../llm";
import type { Difficulty } from "../agent/constants";
import type { ToolProfile } from "../tools/metadata";
import { ToolName } from "../../types";
import { logger } from "../../utils";
import {
  buildTaskContract,
  synthesizeBatchedExhaustivePlan,
  synthesizePlanFromTaskContract,
} from "../agent/task-contract";
import { BuildNodesResult, PlannerAssignment, TaskNode } from "./types";
import { selectPrimarySkill } from "./skills";

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
  ToolName.GET_PROFILE_FIELDS,
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
    action: "call_done" | "advance_step" | "retry_step";
    maxRetries?: number;
    pattern?: string;
  };
  toolProfile?: ToolProfile;
}

const PROCUREMENT_SKILL_ID = "multi-tab-procurement-loop";

function unionTools(groups: TaskNode[]): ToolName[] {
  const tools: ToolName[] = [];
  for (const node of groups) {
    for (const tool of node.allowedTools) {
      if (!tools.includes(tool)) tools.push(tool);
    }
  }
  return tools;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isProcurementOpenNode(node: TaskNode): boolean {
  return (
    node.selectedSkillId === PROCUREMENT_SKILL_ID &&
    /\bopen\b/i.test(node.description) &&
    /\bnew tab\b/i.test(node.description)
  );
}

function isProcurementPurchaseNode(node: TaskNode): boolean {
  return (
    node.selectedSkillId === PROCUREMENT_SKILL_ID &&
    /\b(purchase|buy)\b/i.test(node.description)
  );
}

function isProcurementReturnNode(node: TaskNode): boolean {
  return (
    node.selectedSkillId === PROCUREMENT_SKILL_ID &&
    /\b(check off|mark .* done|return)\b/i.test(node.description)
  );
}

function collapseProcurementLoopNodes(nodes: TaskNode[]): TaskNode[] {
  if (nodes.length < 3 || nodes.length % 3 !== 0) return nodes;

  for (let index = 0; index < nodes.length; index += 3) {
    const openNode = nodes[index];
    const purchaseNode = nodes[index + 1];
    const returnNode = nodes[index + 2];
    if (
      !openNode ||
      !purchaseNode ||
      !returnNode ||
      !isProcurementOpenNode(openNode) ||
      !isProcurementPurchaseNode(purchaseNode) ||
      !isProcurementReturnNode(returnNode)
    ) {
      return nodes;
    }
  }

  const collapsed: TaskNode[] = [];
  for (let index = 0; index < nodes.length; index += 3) {
    const openNode = nodes[index];
    const purchaseNode = nodes[index + 1];
    const returnNode = nodes[index + 2];
    const collapsedId = openNode.id;
    const priorCollapsedId = collapsed[collapsed.length - 1]?.id;
    collapsed.push({
      ...openNode,
      id: collapsedId,
      description: compactText(
        `${openNode.description}; ${purchaseNode.description}; ${returnNode.description}`,
      ),
      successCriteria: compactText(
        [
          openNode.successCriteria,
          purchaseNode.successCriteria,
          returnNode.successCriteria,
        ]
          .filter(Boolean)
          .join("; "),
      ),
      allowedTools: unionTools([openNode, purchaseNode, returnNode]),
      dependencies: priorCollapsedId ? [priorCollapsedId] : [],
      assumptions: dedupeStrings([
        ...(openNode.assumptions || []),
        ...(purchaseNode.assumptions || []),
        ...(returnNode.assumptions || []),
      ]),
      handoffArtifacts: [
        ...openNode.handoffArtifacts,
        ...purchaseNode.handoffArtifacts,
        ...returnNode.handoffArtifacts,
      ],
      verificationGate:
        returnNode.verificationGate ||
        purchaseNode.verificationGate ||
        openNode.verificationGate,
      status: "pending",
      retries: 0,
      result: undefined,
      error: undefined,
    });
  }

  return collapsed;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractFallbackNamedTargets(query: string): string[] {
  const blacklist = new Set([
    "please",
    "summarize",
    "summary",
    "find",
    "report",
    "read",
    "review",
    "check",
    "compare",
    "revise",
    "draft",
    "hover",
    "menu",
    "this",
    "that",
    "page",
  ]);
  const matches = [
    ...query.matchAll(
      /\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}|[A-Z]{2,}(?:\s+[A-Z][a-z]+)*)\b/g,
    ),
  ]
    .map((match) => compactText(match[0] || ""))
    .filter((value) => value.length >= 4)
    .filter((value) => !blacklist.has(value.toLowerCase()));

  return [...new Set(matches)].slice(0, 3);
}

function buildSingleFallbackStep(query: string): DecompositionStep {
  const contract = buildTaskContract(query);
  const compactQuery = compactText(query);
  const contractTargets = [...contract.requiredEntities, ...contract.requiredNumbers]
    .filter(Boolean)
    .slice(0, 3);
  const shouldSynthesizeTargetedFallback =
    contractTargets.length > 0 ||
    (/(find|tell me|exact|inventory|count|price|number|value|result)/i.test(
      query,
    ) &&
      extractFallbackNamedTargets(query).length > 0);
  const namedTargets = shouldSynthesizeTargetedFallback
    ? [...contractTargets, ...extractFallbackNamedTargets(query)].slice(0, 3)
    : [];
  const targetSummary =
    namedTargets.length > 0 ? namedTargets.join(" and ") : null;
  const exhaustiveSummary =
    contract.exhaustiveScopeLabel && contract.exhaustiveScopeCount
      ? `${contract.exhaustiveScopeCount} ${contract.exhaustiveScopeLabel}`
      : null;

  const objective = compactQuery.length > 0
    ? compactQuery
    : "Follow the user's exact request on the current page and report the result clearly.";

  const successCriteria = targetSummary
    ? `Page or tool output shows ${targetSummary} or the requested result needed for the final answer.`
    : exhaustiveSummary
      ? `Page or tool output shows the needed findings from the relevant ${exhaustiveSummary}.`
      : "Page or tool output shows the result needed to answer the user request.";

  return {
    objective,
    successCriteria,
    dependencies: [],
    assumptions:
      compactQuery.length > 0
        ? [`Preserve all explicit constraints from the user's original request: ${compactQuery}`]
        : [],
  };
}

function stepsToNodes(
  query: string,
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
    ...(() => {
      const selection = selectPrimarySkill({
        query,
        objective: assignment.objective,
        successCriteria: assignment.successCriteria,
      });
      return selection
        ? {
            selectedSkillId: selection.id,
            selectedSkillReason: selection.reason,
          }
        : {};
    })(),
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

export function buildFallbackNodes(
  query: string,
  phase: "planned" | "planner_replan" = "planned",
): TaskNode[] {
  const fallbackSteps =
    synthesizeBatchedExhaustivePlan(query) ||
    synthesizePlanFromTaskContract(query) ||
    [buildSingleFallbackStep(query)];
  return stepsToNodes(query, fallbackSteps, phase);
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
    const batchedExhaustiveFallback = synthesizeBatchedExhaustivePlan(query);

    const difficulty: Difficulty = decomposition?.difficulty ?? "moderate";

    let nodes: TaskNode[];
    const shouldUseBatchedFallback =
      batchedExhaustiveFallback &&
      (!decomposition ||
        (decomposition.steps?.length ?? 0) === 0 ||
        ((decomposition.subtasks?.length ?? 0) <= 1 &&
          !(decomposition.steps?.length ?? 0)));
    if (shouldUseBatchedFallback) {
      nodes = stepsToNodes(query, batchedExhaustiveFallback);
      logger.info(
        "orchestrator",
        "Planner fallback replaced with compact exhaustive review graph",
        { count: nodes.length },
      );
    } else if (decomposition?.steps?.length) {
      nodes = stepsToNodes(query, decomposition.steps);
      logger.info(
        "orchestrator",
        "Planner produced structured graph assignments",
        { count: nodes.length },
      );
    } else if (decomposition?.subtasks?.length) {
      const subtasks = decomposition?.subtasks?.length
        ? decomposition.subtasks
        : [];
      // Chain legacy subtasks sequentially: each step depends on the previous.
      // Without this, all nodes launch in parallel (e.g. "apply coupon" runs
      // before "add to cart" finishes → empty cart failure).
      const fallbackSteps: DecompositionStep[] = subtasks.map((step, i) => ({
        objective: step,
        dependencies: i > 0 ? [i - 1] : [],
        assumptions: [],
      }));
      nodes = stepsToNodes(query, fallbackSteps);
    } else {
      nodes = buildFallbackNodes(query);
    }

    const collapsedProcurementNodes = collapseProcurementLoopNodes(nodes);
    if (collapsedProcurementNodes !== nodes) {
      nodes = collapsedProcurementNodes;
      logger.info(
        "orchestrator",
        "Collapsed procurement micro-steps into skill-owned loop nodes",
        { count: nodes.length },
      );
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
    const expanded: TaskNode[] = steps.map((step, index) => {
      const selection = selectPrimarySkill({
        query: node.description,
        objective: step.objective,
        successCriteria: step.successCriteria,
        pageTitle,
        pageUrl,
      });
      return {
        ...(selection
          ? {
              selectedSkillId: selection.id,
              selectedSkillReason: selection.reason,
            }
          : {}),
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
      verificationGate: step.verifyAfter ? { ...step.verifyAfter } : undefined,
      status: "pending",
      retries: 0,
      };
    });

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

    const nodes = stepsToNodes(query, steps as DecompositionStep[], "planned");

    logger.info("orchestrator", "Planner produced horizon expansion nodes", {
      count: nodes.length,
    });

    return nodes;
  }
}
