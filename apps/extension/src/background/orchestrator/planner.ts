import { MAX_PLANNER_ASSUMPTIONS, TaskPlanner } from "../agent/planner";
import { composeCollapsedDisplayLabel } from "../agent/plan-display-label";
import {
  compactText,
  dedupeStrings,
  nodeUrlOrigins,
  unionTools,
} from "./planner-node-utils";
import type { LLMClientOptions } from "../llm";
import type { TokenUsage } from "../llm/types";
import type { Difficulty } from "../agent/constants";
import type { ToolProfile } from "../tools/metadata";
import { ToolName } from "../../types";
import { logger } from "../../utils";
import {
  buildTaskContract,
  isNavigationOnlyTask,
  repairPlanCoverage,
  synthesizeBatchedExhaustivePlan,
  synthesizePlanFromTaskContract,
} from "../agent/task-contract";
import { BuildNodesResult, PlannerAssignment, TaskNode } from "./types";
import { annotateParallelContracts } from "./parallel-contract";
// Re-exported so the ratcheted orchestrator/index.ts can import it from its
// existing "./planner" group (LP-17 P6).
export { qualifiesForDirectSingleNode } from "./planner-gate-policy";
import {
  getSkillDescriptor,
  selectPrimarySkill,
  type SkillCatalogOptions,
} from "./skills";

const EXECUTOR_DEFAULT_TOOLS: ToolName[] = [
  ToolName.CLICK_ELEMENT,
  ToolName.TYPE_TEXT,
  ToolName.SCROLL_PAGE,
  ToolName.READ_PAGE,
  ToolName.NAVIGATE,
  ToolName.OPEN_SERVICENOW_MODULE,
  ToolName.SEARCH_KNOWLEDGE_BASE,
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
  ToolName.INSPECT_CHART,
  ToolName.INSPECT_REGION,
  ToolName.INSPECT_TABLE,
  ToolName.INSPECT_FILTER_STATE,
  ToolName.APPLY_LIST_FILTER,
  ToolName.APPLY_LIST_SORT,
  ToolName.APPLY_LIST_ACTION,
  ToolName.INSPECT_CATALOG_ITEM,
  ToolName.CONFIGURE_CATALOG_ITEM,
  ToolName.CONFIGURE_SERVICENOW_FORM,
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
      // LP-17b CM-2: reasoning planners emit sprawling assumption lists
      // (take 6: ~48 items / 11.4K chars, re-billed every executor turn).
      // The first few carry the signal.
      if (assumptions.length >= MAX_PLANNER_ASSUMPTIONS) break;
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
  /** Planner-authored short display summary (UI-only, already sanitized). */
  label?: string;
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

export interface BuildNodesOptions {
  displayQuery?: string;
}

const MULTI_TAB_CHECKLIST_SKILL_ID = "multi-tab-checklist-workflow";
const PAGINATED_TABLE_SCAN_SKILL_ID = "paginated-table-scan";
const SKILL_OWNED_WORKFLOW_IDS = new Set([
  "chart-value-extraction",
  "search-answer-extraction",
  "servicenow-module-navigation",
  "servicenow-record-form",
  "list-filter-workflow",
  "list-sort-workflow",
  "list-row-action-workflow",
  "catalog-order-workflow",
  "structured-form-fill",
  "progressive-repeatable-form",
  "multi-step-form-wizard",
  "hover-reveal-navigation",
]);

function isMultiTabChecklistOpenNode(node: TaskNode): boolean {
  return (
    node.selectedSkillId === MULTI_TAB_CHECKLIST_SKILL_ID &&
    /\bopen\b/i.test(node.description) &&
    /\b(?:new|separate|another)\s+tab\b/i.test(node.description)
  );
}

function isMultiTabChecklistTargetNode(node: TaskNode): boolean {
  return (
    node.selectedSkillId === MULTI_TAB_CHECKLIST_SKILL_ID &&
    /\b(purchase|buy|review|read|capture|extract|inspect|compare|summarize)\b/i.test(
      node.description,
    )
  );
}

function isMultiTabChecklistReturnNode(node: TaskNode): boolean {
  return (
    node.selectedSkillId === MULTI_TAB_CHECKLIST_SKILL_ID &&
    /\b(check off|mark .* done|mark .* complete|mark .* reviewed|record .* reviewed|return|switch back|come back)\b/i.test(
      node.description,
    )
  );
}

function isSkillOwnedMultiTabChecklistRequest(
  query: string,
  nodes: TaskNode[],
): boolean {
  if (nodes.length < 2) return false;
  if (
    !nodes.every(
      (node) => node.selectedSkillId === MULTI_TAB_CHECKLIST_SKILL_ID,
    )
  ) {
    return false;
  }

  const corpus = compactText(
    [
      query,
      ...nodes.flatMap((node) => [node.description, node.successCriteria]),
    ].join(" "),
  );
  const hasProcurementSurface =
    /\bprocurement\s+list\b/i.test(corpus) ||
    /\b(?:store|stores|store\s+page|store\s+link)\b/i.test(corpus);
  const hasPurchaseIntent = /\b(?:buy|purchase|procure|order)\b/i.test(corpus);
  const hasExplicitTabIntent =
    /\b(?:new|separate|another|other|multiple)\s+tabs?\b|\bswitch\b[\s\S]{0,40}\btabs?\b|\bacross\s+tabs?\b/i.test(
      corpus,
    );
  const hasSourceSurface =
    /\b(?:list|checklist|rows?|items?|links?|listings?|articles?|dashboards?|reports?|job board|research)\b/i.test(
      corpus,
    );
  const hasMultipleItems =
    /\bfirst\s+(?:\w+|\d+)\s+items?\b/i.test(corpus) ||
    /\bfirst\s+(?:\w+|\d+)\s+(?:links?|listings?|articles?|dashboards?|reports?|jobs?)\b/i.test(
      corpus,
    ) ||
    /\b(?:two|three|four|five|six|seven|eight|nine|ten)\s+(?:items?|links?|listings?|articles?|dashboards?|dashboard\s+tabs?|reports?|jobs?)\b/i.test(
      corpus,
    ) ||
    /\b\d+\s+items?\b/i.test(corpus) ||
    /\b\d+\s+(?:links?|listings?|articles?|dashboards?|reports?|jobs?)\b/i.test(
      corpus,
    ) ||
    /\b(?:both|each)\b/i.test(corpus);
  const hasReturnOrMarkIntent =
    /\b(?:mark|check)\b[\s\S]{0,80}\b(?:complete|done|off)\b/i.test(corpus) ||
    /\b(?:mark|record|note)\b[\s\S]{0,80}\b(?:reviewed|captured|complete|done)\b/i.test(
      corpus,
    ) ||
    /\bcheckbox\b/i.test(corpus) ||
    /\b(?:return|switch back|come back)\b[\s\S]{0,80}\b(?:mark|check|record|source|list|board)\b/i.test(
      corpus,
    );

  return (
    ((hasProcurementSurface && hasPurchaseIntent) ||
      (hasExplicitTabIntent && hasSourceSurface)) &&
    hasMultipleItems &&
    hasReturnOrMarkIntent
  );
}

function displayQueryOrFallback(query: string, displayQuery?: string): string {
  const compactDisplayQuery = compactText(displayQuery || "");
  return compactDisplayQuery || compactText(query);
}

function collapseAllMultiTabChecklistNodes(
  query: string,
  nodes: TaskNode[],
  displayQuery?: string,
): TaskNode[] {
  const firstNode = nodes[0];
  const taskLabelQuery = displayQueryOrFallback(query, displayQuery);
  return [
    {
      ...firstNode,
      description: compactText(
        [
          `Complete the multi-tab checklist workflow for the original request: ${taskLabelQuery}`,
          ...nodes.map((node) => node.description),
        ].join(" "),
      ),
      successCriteria: compactText(
        [
          "Each requested source-list item has matching target-tab evidence and is marked, recorded, or otherwise accounted for on the source page.",
          ...nodes.map((node) => node.successCriteria),
        ].join(" "),
      ),
      allowedTools: unionTools(nodes),
      dependencies: [],
      assumptions: dedupeStrings(
        nodes.flatMap((node) => node.assumptions || []),
      ),
      handoffArtifacts: nodes.flatMap((node) => node.handoffArtifacts),
      verificationGate: nodes
        .slice()
        .reverse()
        .find((node) => node.verificationGate)?.verificationGate,
      status: "pending",
      retries: 0,
      result: undefined,
      error: undefined,
    },
  ];
}

function isSkillOwnedPaginatedAggregateScan(
  query: string,
  nodes: TaskNode[],
): boolean {
  if (nodes.length < 2) return false;
  if (
    !nodes.every(
      (node) => node.selectedSkillId === PAGINATED_TABLE_SCAN_SKILL_ID,
    )
  ) {
    return false;
  }

  const corpus = compactText(
    [
      query,
      ...nodes.flatMap((node) => [node.description, node.successCriteria]),
    ].join(" "),
  );
  const hasAggregateIntent =
    /\b(?:highest|lowest|largest|smallest|max(?:imum)?|min(?:imum)?|most|least|top|best)\b/i.test(
      corpus,
    );
  const hasPaginatedDataSurface =
    /\b(?:paginated|pagination|page\s+\d+|all\s+pages?|next\s+page|previous\s+page|table|directory|data\s+table|rows?)\b/i.test(
      corpus,
    );
  const hasValueExtraction =
    /\b(?:salary|price|amount|value|count|score|total|metric|number)\b/i.test(
      corpus,
    );

  return hasAggregateIntent && hasPaginatedDataSurface && hasValueExtraction;
}

function collapsePaginatedAggregateScanNodes(
  query: string,
  nodes: TaskNode[],
  displayQuery?: string,
): TaskNode[] {
  const firstNode = nodes[0];
  const taskLabelQuery = displayQueryOrFallback(query, displayQuery);
  return [
    {
      ...firstNode,
      description: compactText(
        `Scan the full paginated data surface for the original request and answer it: ${taskLabelQuery}`,
      ),
      successCriteria: compactText(
        [
          "All pages or visible row ranges in scope are covered before answering.",
          "The final answer identifies the requested aggregate row or record with the relevant value.",
          ...nodes.map((node) => node.successCriteria),
        ].join(" "),
      ),
      allowedTools: unionTools(nodes),
      dependencies: [...firstNode.dependencies],
      assumptions: dedupeStrings(
        nodes.flatMap((node) => node.assumptions || []),
      ),
      handoffArtifacts: nodes.flatMap((node) => node.handoffArtifacts),
      verificationGate: nodes
        .slice()
        .reverse()
        .find((node) => node.verificationGate)?.verificationGate,
      status: "pending",
      retries: 0,
      result: undefined,
      error: undefined,
    },
  ];
}

function collapseMultiTabChecklistNodes(
  nodes: TaskNode[],
  query: string,
  displayQuery?: string,
): TaskNode[] {
  if (isSkillOwnedMultiTabChecklistRequest(query, nodes)) {
    return collapseAllMultiTabChecklistNodes(query, nodes, displayQuery);
  }

  if (nodes.length < 3 || nodes.length % 3 !== 0) return nodes;

  for (let index = 0; index < nodes.length; index += 3) {
    const openNode = nodes[index];
    const purchaseNode = nodes[index + 1];
    const returnNode = nodes[index + 2];
    if (
      !openNode ||
      !purchaseNode ||
      !returnNode ||
      !isMultiTabChecklistOpenNode(openNode) ||
      !isMultiTabChecklistTargetNode(purchaseNode) ||
      !isMultiTabChecklistReturnNode(returnNode)
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

function collapsePaginatedTableScanNodes(
  nodes: TaskNode[],
  query: string,
  displayQuery?: string,
): TaskNode[] {
  return isSkillOwnedPaginatedAggregateScan(query, nodes)
    ? collapsePaginatedAggregateScanNodes(query, nodes, displayQuery)
    : nodes;
}

/**
 * LP-17b CM-3: cap for planner prose appended AFTER the verbatim original
 * request in a merged/rescoped node description. The request is the
 * contract; anything beyond this is restatement billed every turn.
 */
const MAX_APPENDED_PLANNER_PROSE = 400;

function truncateAppendedPlannerProse(text: string): string {
  const compacted = compactText(text);
  return compacted.length > MAX_APPENDED_PLANNER_PROSE
    ? compacted.slice(0, MAX_APPENDED_PLANNER_PROSE) + " […]"
    : compacted;
}

function shouldPreserveSeparateFormUpdateNodes(
  nodes: TaskNode[],
  query: string,
): boolean {
  const text = compactText(query).toLowerCase();
  if (
    !/\bseparate(?:ly)?\b.{0,40}\b(update|updates|action|actions|step|steps|task|tasks)\b/.test(
      text,
    ) &&
    !/\b(update|updates|action|actions|step|steps|task|tasks)\b.{0,40}\bseparate(?:ly)?\b/.test(
      text,
    )
  ) {
    return false;
  }
  if (!/\b(form|field|input|page|screen|record)\b/.test(text)) return false;

  return nodes.some(
    (node) =>
      node.toolProfile === "form_fill" &&
      /\bset\b.+\bto\b/i.test(node.description),
  );
}

function isFieldValueFormFillNode(node: TaskNode): boolean {
  return (
    node.toolProfile === "form_fill" &&
    /^Fill the form with the requested field values:/i.test(node.description)
  );
}

function isFieldValueSubmitNode(node: TaskNode): boolean {
  return (
    node.toolProfile === "submit_form" &&
    /^Submit the form and verify/i.test(node.description)
  );
}

/**
 * The synthesized field-value form plan is two nodes: a `form_fill` node whose
 * objective explicitly says "Do not submit the form yet" and a dependent
 * `submit_form` node. It is one atomic create-record workflow.
 */
function isFieldValueFormPlan(nodes: TaskNode[]): boolean {
  return (
    nodes.length === 2 &&
    isFieldValueFormFillNode(nodes[0]) &&
    isFieldValueSubmitNode(nodes[1])
  );
}

function collapseSkillOwnedWorkflowNodes(
  nodes: TaskNode[],
  query: string,
  pageTitle?: string,
  pageUrl?: string,
  skillCatalogOptions?: SkillCatalogOptions,
  displayQuery?: string,
): TaskNode[] {
  if (nodes.length < 2) return nodes;
  const taskLabelQuery = displayQueryOrFallback(query, displayQuery);
  if (shouldPreserveSeparateFormUpdateNodes(nodes, taskLabelQuery)) return nodes;

  const selection = selectPrimarySkill({
    query,
    objective: query,
    successCriteria: query,
    pageTitle,
    pageUrl,
    ...skillCatalogOptions,
  });
  if (!selection) return nodes;
  const selectedDescriptor = getSkillDescriptor(
    selection.id,
    skillCatalogOptions,
  );
  const skillOwns = Boolean(
    selectedDescriptor?.atomic || SKILL_OWNED_WORKFLOW_IDS.has(selection.id),
  );
  // A create-record form (field-value fill + submit) is one atomic workflow, so
  // merge it even when skill selection lands on a *generic* skill (e.g. a page
  // whose URL isn't recognized as ServiceNow). Without this, the two nodes
  // survive, and the executor completes the fill node on its "the final submit
  // action has not been clicked yet" criterion without ever submitting — the
  // create-incident stranding bug.
  const isFieldValueForm = isFieldValueFormPlan(nodes);
  if (!skillOwns && !isFieldValueForm) {
    return nodes;
  }

  const firstNode = nodes[0];
  const navigationOnly = isNavigationOnlyTask(taskLabelQuery);

  let description: string;
  let successCriteria: string;
  if (navigationOnly) {
    description = compactText(
      `Navigate according to the original request: ${taskLabelQuery}`,
    );
    successCriteria = navigationOnlySuccessCriteria();
  } else if (isFieldValueForm) {
    // Coherent single-workflow framing that drops the fill node's "do not
    // submit yet" split so the merged node can't strand after filling. Keep the
    // field readback but require the submit node's confirmation.
    description = compactText(
      `Complete the workflow for the original request: ${taskLabelQuery} Fill in each requested field, then submit the form and verify the created record or confirmation is visible.`,
    );
    const fieldReadback = firstNode.successCriteria
      .replace(/;?\s*the final submit action has not been clicked yet\.?/i, "")
      .trim();
    successCriteria = compactText(
      [
        "The original request is fully completed and verified, not merely an intermediate page, control, result, or form state.",
        fieldReadback,
        nodes[1].successCriteria,
      ]
        .filter(Boolean)
        .join(" "),
    );
  } else {
    // LP-17b CM-3: the appended per-node descriptions are planner
    // restatement — the full request is already present verbatim above.
    description = compactText(
      [
        `Complete the workflow for the original request: ${taskLabelQuery}`,
        truncateAppendedPlannerProse(
          nodes.map((node) => node.description).join(" "),
        ),
      ].join(" "),
    );
    successCriteria = compactText(
      [
        "The original request is fully completed and verified, not merely an intermediate page, control, result, or form state.",
        ...nodes.map((node) => node.successCriteria),
      ].join(" "),
    );
  }

  return [
    {
      ...firstNode,
      // Skill-owned selection wins; for a generic-skill field-value form keep
      // the fill node's planner-assigned skill (record-form on a recognized
      // ServiceNow page, generic otherwise).
      ...(skillOwns
        ? {
            selectedSkillId: selection.id,
            selectedSkillReason: selection.reason,
          }
        : {}),
      description,
      successCriteria,
      allowedTools: unionTools(nodes),
      dependencies: [...firstNode.dependencies],
      assumptions: dedupeStrings(
        nodes.flatMap((node) => node.assumptions || []),
      ),
      // For a field-value form, the source nodes' handoff notes echo the
      // discarded "Fill the form... Do not submit the form yet" split; carrying
      // them would leak that contradictory instruction into the executor.
      // Replace them with a single coherent note for the merged objective.
      handoffArtifacts: isFieldValueForm
        ? [
            {
              role: "planner" as const,
              phase: "planned" as const,
              note: `Planner assigned objective: ${description}`,
              timestamp: firstNode.handoffArtifacts[0]?.timestamp ?? 0,
            },
          ]
        : nodes.flatMap((node) => node.handoffArtifacts),
      verificationGate: nodes
        .slice()
        .reverse()
        .find((node) => node.verificationGate)?.verificationGate,
      status: "pending",
      retries: 0,
      result: undefined,
      error: undefined,
    },
  ];
}

const VERIFY_ONLY_HEAD =
  /^\s*(?:verify|confirm|check|ensure|validate|double-check)\b/i;
const VERIFY_NODE_NAVIGATION =
  /\b(?:return\w*|go(?:ing)? back|back to|navigat\w*|open\w*|visit\w*)\b/i;
const VERIFY_NODE_DELIVERABLE =
  /\b(?:report\w*|read\w*|extract\w*|record\w*|note\w*|tell\w*|answer\w*|summari[sz]\w*)\b/i;

/**
 * LP-17 P5: drop a trailing verify-only node. Live plans appended steps like
 * "Verify the page is visible" AFTER the goal was delivered — a whole extra
 * executor session (~12K+ tokens) doing no new work; the executor's done()
 * gate already verifies. Deliberately narrow: never drops return legs
 * (navigation verbs), deliverable steps (report/read/extract), URL-bearing
 * steps, write-capable steps, or anything not depending solely on its
 * predecessor. The dropped node's criteria and gate fold into the
 * predecessor so nothing observable is lost.
 */
export function dropTrailingVerifyOnlyNode(nodes: TaskNode[]): TaskNode[] {
  if (nodes.length < 2) return nodes;
  const last = nodes[nodes.length - 1];
  const prev = nodes[nodes.length - 2];
  if (!VERIFY_ONLY_HEAD.test(last.description)) return nodes;
  if (VERIFY_NODE_NAVIGATION.test(last.description)) return nodes;
  if (VERIFY_NODE_DELIVERABLE.test(last.description)) return nodes;
  if (last.toolProfile && last.toolProfile !== "read_only") return nodes;
  if (/https?:\/\//i.test(last.description)) return nodes;
  const dependsOnlyOnPrev =
    last.dependencies.length === 0 ||
    (last.dependencies.length === 1 && last.dependencies[0] === prev.id);
  if (!dependsOnlyOnPrev) return nodes;

  const merged: TaskNode = {
    ...prev,
    successCriteria: compactText(
      dedupeStrings(
        [prev.successCriteria, last.successCriteria].filter(Boolean),
      ).join(" "),
    ),
    verificationGate: last.verificationGate
      ? { ...last.verificationGate, action: "call_done" }
      : prev.verificationGate,
    status: "pending",
    retries: 0,
    result: undefined,
    error: undefined,
  };
  return [...nodes.slice(0, -2), merged];
}

const SAME_PAGE_COLLAPSE_MAX_NODES = 5;
const SAME_PAGE_COLLAPSE_MAX_DESCRIPTION_CHARS = 700;
const NODE_NAVIGATION_VERB =
  /\b(?:navigate to|go(?:ing)? to|open(?:ing)? (?:a )?new tab|visit\w*|return\w* to|back to)\b/i;
// "Buy the FIRST item" / "buy the SECOND item" — an itemwise iteration whose
// per-item navigation is implied, never spelled out. Two or more ordinal-
// target steps mean the chain spans item pages, not one page.
const ITEMWISE_ORDINAL_TARGET =
  /\b(?:first|second|third|fourth|fifth|next|another)\b[\w\s-]{0,24}\b(?:item|record|entry|row|product|listing|application|ticket|task)s?\b/i;

/**
 * LP-17 P7: merge a serialized chain of same-page, same-skill nodes into one.
 * Live plans split sequential single-page work (add-to-cart → coupon →
 * checkout) into 4-5 serialized nodes, each spawning a fresh executor
 * session (~12-35K tokens of context) and each a link in a dependency chain
 * whose failure kills everything downstream. Serialized + same page + same
 * skill = no parallelism gained, pure overhead.
 *
 * Load-bearing guard: cross-view plans always contain a navigation step (the
 * prompt's VIEW-STATE rule), so refusing to merge across navigation verbs or
 * distinct origins keeps genuinely multi-page plans intact. The user's
 * explicit "separate updates" phrasing also opts out.
 */
export function collapseSameContextSequentialNodes(
  nodes: TaskNode[],
  query: string,
  pageTitle?: string,
  pageUrl?: string,
  skillCatalogOptions?: SkillCatalogOptions,
  displayQuery?: string,
): TaskNode[] {
  if (nodes.length < 2 || nodes.length > SAME_PAGE_COLLAPSE_MAX_NODES) {
    return nodes;
  }
  const taskLabelQuery = displayQueryOrFallback(query, displayQuery);
  if (shouldPreserveSeparateFormUpdateNodes(nodes, taskLabelQuery)) {
    return nodes;
  }
  // Pure chain: each node depends exactly on its predecessor.
  for (let i = 0; i < nodes.length; i++) {
    const deps = nodes[i].dependencies;
    if (i === 0 ? deps.length !== 0 : !(deps.length === 1 && deps[0] === nodes[i - 1].id)) {
      return nodes;
    }
  }
  if (
    nodes.some(
      (node) =>
        node.toolProfile === "navigate" ||
        NODE_NAVIGATION_VERB.test(node.description),
    )
  ) {
    return nodes;
  }
  if (nodeUrlOrigins(nodes).size > 1) return nodes;
  if (
    nodes.filter((node) => ITEMWISE_ORDINAL_TARGET.test(node.description))
      .length >= 2
  ) {
    return nodes;
  }

  const description = compactText(
    `Complete these steps in order on the current page: ${nodes
      .map((node) => node.description)
      .join("; ")}`,
  );
  if (description.length > SAME_PAGE_COLLAPSE_MAX_DESCRIPTION_CHARS) {
    return nodes;
  }
  const displayLabel = composeCollapsedDisplayLabel(
    nodes.map((node) => node.displayLabel),
    nodes.length,
  );

  const firstNode = nodes[0];
  const lastGate = [...nodes]
    .reverse()
    .find((node) => node.verificationGate)?.verificationGate;
  // Per-step skill picks fragment naturally (fill steps → form skill, cart
  // step → cart skill), so re-select for the WHOLE merged workflow instead
  // of requiring homogeneity or inheriting step 1's pick.
  const mergedSkill = selectPrimarySkill({
    query,
    objective: description,
    successCriteria: description,
    pageTitle,
    pageUrl,
    ...skillCatalogOptions,
  });
  return [
    {
      ...firstNode,
      selectedSkillId: mergedSkill?.id,
      selectedSkillReason: mergedSkill?.reason,
      description,
      displayLabel,
      successCriteria: compactText(
        dedupeStrings(nodes.map((node) => node.successCriteria)).join(" "),
      ),
      allowedTools: unionTools(nodes),
      assumptions: dedupeStrings(nodes.flatMap((node) => node.assumptions)),
      handoffArtifacts: nodes.flatMap((node) => node.handoffArtifacts),
      // The merged node IS the final node: a carried gate must finish the
      // task, and no single step's toolProfile may restrict the union.
      verificationGate: lastGate
        ? { ...lastGate, action: "call_done" }
        : undefined,
      toolProfile: undefined,
      dependencies: [],
      status: "pending",
      retries: 0,
      result: undefined,
      error: undefined,
    },
  ];
}

function preserveOriginalScopeForSingleSkillOwnedNode(
  nodes: TaskNode[],
  query: string,
  pageTitle?: string,
  pageUrl?: string,
  skillCatalogOptions?: SkillCatalogOptions,
  displayQuery?: string,
): TaskNode[] {
  if (nodes.length !== 1) return nodes;

  const selection = selectPrimarySkill({
    query,
    objective: query,
    successCriteria: query,
    pageTitle,
    pageUrl,
    ...skillCatalogOptions,
  });
  if (!selection) return nodes;
  const selectedDescriptor = getSkillDescriptor(
    selection.id,
    skillCatalogOptions,
  );
  if (
    !selectedDescriptor?.atomic &&
    !SKILL_OWNED_WORKFLOW_IDS.has(selection.id)
  ) {
    return nodes;
  }

  const node = nodes[0];
  const compactQuery = displayQueryOrFallback(query, displayQuery);
  const compactDescription = compactText(node.description);
  if (!compactQuery) return nodes;
  if (compactDescription.includes(compactQuery)) {
    // LP-17b CM-3: reasoning planners often embed the query verbatim in the
    // objective and then append a large restatement tail (take 6: +4.8K
    // chars re-billed every turn). The query IS the contract — keep it,
    // trim the tail when it is disproportionate.
    if (
      compactDescription.length >
      compactQuery.length + MAX_APPENDED_PLANNER_PROSE
    ) {
      return [
        {
          ...node,
          description: compactText(
            `Complete the workflow for the original request: ${compactQuery}`,
          ),
        },
      ];
    }
    return nodes;
  }

  const navigationOnly = isNavigationOnlyTask(compactQuery);
  return [
    {
      ...node,
      selectedSkillId: selection.id,
      selectedSkillReason: selection.reason,
      description: navigationOnly
        ? compactText(
            `Navigate according to the original request: ${compactQuery}`,
          )
        : compactText(
            `Complete the workflow for the original request: ${compactQuery}`,
          ),
      successCriteria: navigationOnly
        ? navigationOnlySuccessCriteria()
        : compactText(
            [
              "The original request is fully completed and verified, not merely an intermediate page, control, result, or form state.",
              node.successCriteria,
            ].join(" "),
          ),
      assumptions: dedupeStrings([
        ...(node.assumptions || []),
        `Preserve all explicit constraints from the user's original request: ${compactQuery}`,
      ]),
      handoffArtifacts: [
        ...node.handoffArtifacts,
        {
          role: "planner",
          phase: "planned",
          note: `Skill-owned workflow scope restored to the original request: ${compactQuery}`,
          timestamp: Date.now(),
        },
      ],
    },
  ];
}

function navigationOnlySuccessCriteria(): string {
  return (
    "The current page, URL, title, heading, or tool output shows the requested " +
    "navigation destination is open; no extra data extraction or report is required."
  );
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
  const contractTargets = [
    ...contract.requiredEntities,
    ...contract.requiredNumbers,
  ]
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

  const objective =
    compactQuery.length > 0
      ? compactQuery
      : "Follow the user's exact request on the current page and report the result clearly.";

  const successCriteria = targetSummary
    ? isNavigationOnlyTask(query)
      ? navigationOnlySuccessCriteria()
      : `Page or tool output shows ${targetSummary} or the requested result needed for the final answer.`
    : exhaustiveSummary
      ? `Page or tool output shows the needed findings from the relevant ${exhaustiveSummary}.`
      : isNavigationOnlyTask(query)
        ? navigationOnlySuccessCriteria()
        : "Page or tool output shows the result needed to answer the user request.";

  return {
    objective,
    successCriteria,
    dependencies: [],
    assumptions:
      compactQuery.length > 0
        ? [
            `Preserve all explicit constraints from the user's original request: ${compactQuery}`,
          ]
        : [],
  };
}

function withDefaultSuccessCriteria(steps: DecompositionStep[]): Array<
  DecompositionStep & {
    successCriteria: string;
    dependencies: number[];
    assumptions: string[];
  }
> {
  return steps.map((step) => ({
    ...step,
    successCriteria:
      step.successCriteria ||
      `The subtask outcome for "${step.objective}" is verified on the page or in tool output.`,
    assumptions: step.assumptions || [],
    dependencies: step.dependencies || [],
  }));
}

function isReadOnlyDecompositionStep(step: DecompositionStep): boolean {
  if (
    step.toolProfile === "read_only" ||
    step.toolProfile === "inspect_hidden_state"
  ) {
    return true;
  }
  const text = `${step.objective}\n${step.successCriteria ?? ""}`;
  return (
    /\b(read|check|inspect|review|summari[sz]e|extract|compare|report|count|inventory)\b/i.test(
      text,
    ) &&
    !/\b(click|type|fill|select|submit|save|update|delete|add|order|purchase|checkout|send|post|apply)\b/i.test(
      text,
    )
  );
}

function extractIndependentStepKeys(step: DecompositionStep): string[] {
  const text = `${step.objective}\n${step.successCriteria ?? ""}`;
  const urls = [...text.matchAll(/\bhttps?:\/\/[^\s)"']+/gi)].map((match) =>
    match[0].toLowerCase().replace(/[),.;]+$/, ""),
  );
  const quoted = [...text.matchAll(/"([^"]{3,80})"|'([^']{3,80})'/g)].map(
    (match) => (match[1] || match[2] || "").toLowerCase().trim(),
  );
  return [...new Set([...urls, ...quoted])];
}

function canLeaveStepIndependent(
  steps: DecompositionStep[],
  index: number,
): boolean {
  const step = steps[index];
  if (!step || !isReadOnlyDecompositionStep(step)) return false;
  const keys = extractIndependentStepKeys(step);
  if (keys.length === 0) return false;

  for (let priorIndex = 0; priorIndex < index; priorIndex++) {
    const prior = steps[priorIndex];
    if (!prior || !isReadOnlyDecompositionStep(prior)) return false;
    const priorKeys = extractIndependentStepKeys(prior);
    if (priorKeys.length === 0) return false;
    if (keys.some((key) => priorKeys.includes(key))) return false;
  }

  return true;
}

function stepsToNodes(
  query: string,
  steps: DecompositionStep[],
  phase: "planned" | "planner_replan" = "planned",
  pageTitle?: string,
  pageUrl?: string,
  skillCatalogOptions?: SkillCatalogOptions,
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
      if (
        explicit.length === 0 &&
        index > 0 &&
        !canLeaveStepIndependent(steps, index)
      ) {
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
        pageTitle,
        pageUrl,
        ...skillCatalogOptions,
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
    ...(steps[index]?.label ? { displayLabel: steps[index].label } : {}),
    successCriteria: assignment.successCriteria,
    ...(steps[index]?.toolProfile
      ? { toolProfile: steps[index].toolProfile }
      : {}),
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

/**
 * Run the skill-owned / workflow-shape collapses that `buildNodes` applies
 * after `stepsToNodes`. Shared so the orchestrator's planner-failure fallback
 * (`buildFallbackNodes`) collapses identically — otherwise a synthesized
 * field-value form plan reaching the runtime through the fallback path keeps its
 * uncollapsed "fill (do not submit yet)" + "submit" split and strands the run.
 */
function applyWorkflowNodeCollapse(
  nodes: TaskNode[],
  query: string,
  pageTitle?: string,
  pageUrl?: string,
  skillCatalogOptions?: SkillCatalogOptions,
  displayQuery?: string,
): TaskNode[] {
  let result = collapseMultiTabChecklistNodes(nodes, query, displayQuery);
  result = collapsePaginatedTableScanNodes(result, query, displayQuery);
  result = collapseSkillOwnedWorkflowNodes(
    result,
    query,
    pageTitle,
    pageUrl,
    skillCatalogOptions,
    displayQuery,
  );
  result = dropTrailingVerifyOnlyNode(result);
  result = collapseSameContextSequentialNodes(
    result,
    query,
    pageTitle,
    pageUrl,
    skillCatalogOptions,
    displayQuery,
  );
  result = preserveOriginalScopeForSingleSkillOwnedNode(
    result,
    query,
    pageTitle,
    pageUrl,
    skillCatalogOptions,
    displayQuery,
  );
  return result;
}

export function buildFallbackNodes(
  query: string,
  phase: "planned" | "planner_replan" = "planned",
  pageTitle?: string,
  pageUrl?: string,
  skillCatalogOptions?: SkillCatalogOptions,
  displayQuery?: string,
): TaskNode[] {
  const fallbackSteps = synthesizeBatchedExhaustivePlan(query) ||
    synthesizePlanFromTaskContract(query) || [buildSingleFallbackStep(query)];
  const nodes = stepsToNodes(
    query,
    fallbackSteps,
    phase,
    pageTitle,
    pageUrl,
    skillCatalogOptions,
  );
  return annotateParallelContracts(
    applyWorkflowNodeCollapse(
      nodes,
      query,
      pageTitle,
      pageUrl,
      skillCatalogOptions,
      displayQuery,
    ),
  );
}

export function buildDirectExecutionNodes(
  query: string,
  phase: "planned" | "planner_replan" = "planned",
  pageTitle?: string,
  pageUrl?: string,
  skillCatalogOptions?: SkillCatalogOptions,
): TaskNode[] {
  return annotateParallelContracts(
    stepsToNodes(
      query,
      [buildSingleFallbackStep(query)],
      phase,
      pageTitle,
      pageUrl,
      skillCatalogOptions,
    ),
  );
}

export class OrchestratorPlanner {
  private planner: TaskPlanner;

  constructor(openRouterApiKey: string, modelOverrides?: LLMClientOptions) {
    this.planner = new TaskPlanner(openRouterApiKey, modelOverrides);
  }

  setUsageCallback(
    cb: ((usage: TokenUsage, llmMs: number, model: string, rawResponse?: string) => void) | null,
  ): void {
    this.planner.setUsageCallback(cb);
  }

  async buildNodes(
    query: string,
    pageTitle: string,
    pageUrl: string,
    skillCatalogOptions?: SkillCatalogOptions,
    signal?: AbortSignal,
    options?: BuildNodesOptions,
  ): Promise<BuildNodesResult> {
    const displayQuery = options?.displayQuery;
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
      nodes = stepsToNodes(
        query,
        repairPlanCoverage({
          query,
          steps: withDefaultSuccessCriteria(batchedExhaustiveFallback),
        }),
        "planned",
        pageTitle,
        pageUrl,
        skillCatalogOptions,
      );
      logger.info(
        "orchestrator",
        "Planner fallback replaced with compact exhaustive review graph",
        { count: nodes.length },
      );
    } else if (decomposition?.steps?.length) {
      nodes = stepsToNodes(
        query,
        repairPlanCoverage({
          query,
          steps: withDefaultSuccessCriteria(decomposition.steps),
        }),
        "planned",
        pageTitle,
        pageUrl,
        skillCatalogOptions,
      );
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
      nodes = stepsToNodes(
        query,
        repairPlanCoverage({
          query,
          steps: withDefaultSuccessCriteria(fallbackSteps),
        }),
        "planned",
        pageTitle,
        pageUrl,
        skillCatalogOptions,
      );
    } else {
      nodes = buildFallbackNodes(
        displayQueryOrFallback(query, displayQuery),
        "planned",
        pageTitle,
        pageUrl,
        skillCatalogOptions,
      );
    }

    const collapsedMultiTabNodes = collapseMultiTabChecklistNodes(
      nodes,
      query,
      displayQuery,
    );
    if (collapsedMultiTabNodes !== nodes) {
      nodes = collapsedMultiTabNodes;
      logger.info(
        "orchestrator",
        "Collapsed multi-tab checklist micro-steps into skill-owned loop nodes",
        { count: nodes.length },
      );
    }

    const collapsedPaginatedNodes = collapsePaginatedTableScanNodes(
      nodes,
      query,
      displayQuery,
    );
    if (collapsedPaginatedNodes !== nodes) {
      nodes = collapsedPaginatedNodes;
      logger.info(
        "orchestrator",
        "Collapsed paginated aggregate steps into skill-owned scan node",
        { count: nodes.length },
      );
    }

    const collapsedSkillOwnedWorkflowNodes = collapseSkillOwnedWorkflowNodes(
      nodes,
      query,
      pageTitle,
      pageUrl,
      skillCatalogOptions,
      displayQuery,
    );
    if (collapsedSkillOwnedWorkflowNodes !== nodes) {
      nodes = collapsedSkillOwnedWorkflowNodes;
      logger.info(
        "orchestrator",
        "Collapsed workflow micro-steps into skill-owned node",
        {
          count: nodes.length,
          selectedSkillId: nodes[0]?.selectedSkillId,
        },
      );
    }

    const verifyTailDropped = dropTrailingVerifyOnlyNode(nodes);
    if (verifyTailDropped !== nodes) {
      nodes = verifyTailDropped;
      logger.info(
        "orchestrator",
        "Dropped trailing verify-only node; criteria folded into predecessor",
        { count: nodes.length },
      );
    }

    const sameContextCollapsed = collapseSameContextSequentialNodes(
      nodes,
      query,
      pageTitle,
      pageUrl,
      skillCatalogOptions,
      displayQuery,
    );
    if (sameContextCollapsed !== nodes) {
      nodes = sameContextCollapsed;
      logger.info(
        "orchestrator",
        "Collapsed serialized same-page chain into a single node",
        { count: nodes.length },
      );
    }

    const originalScopedNodes = preserveOriginalScopeForSingleSkillOwnedNode(
      nodes,
      query,
      pageTitle,
      pageUrl,
      skillCatalogOptions,
      displayQuery,
    );
    if (originalScopedNodes !== nodes) {
      nodes = originalScopedNodes;
      logger.info(
        "orchestrator",
        "Restored original request scope for single skill-owned workflow node",
        {
          count: nodes.length,
          selectedSkillId: nodes[0]?.selectedSkillId,
        },
      );
    }

    nodes = annotateParallelContracts(nodes);

    logger.info("orchestrator", "Planner generated nodes", {
      count: nodes.length,
    });

    // Simple task: decomposition had no subtasks (empty array)
    const isSkillOwnedSingleNode = Boolean(
      nodes.length === 1 &&
      nodes[0]?.selectedSkillId &&
      (SKILL_OWNED_WORKFLOW_IDS.has(nodes[0].selectedSkillId) ||
        getSkillDescriptor(nodes[0].selectedSkillId, skillCatalogOptions)
          ?.atomic),
    );
    const isSingleNode =
      nodes.length === 1 &&
      (isSkillOwnedSingleNode ||
        !decomposition?.subtasks?.length ||
        decomposition.subtasks.length === 0);

    return { nodes, isSingleNode, difficulty };
  }

  async expandNode(
    node: TaskNode,
    pageTitle: string,
    pageUrl: string,
    reason: string,
    skillCatalogOptions?: SkillCatalogOptions,
    signal?: AbortSignal,
  ): Promise<TaskNode[] | null> {
    if (
      node.selectedSkillId &&
      (SKILL_OWNED_WORKFLOW_IDS.has(node.selectedSkillId) ||
        getSkillDescriptor(node.selectedSkillId, skillCatalogOptions)?.atomic)
    ) {
      logger.info(
        "orchestrator",
        "Skipped micro-step expansion for skill-owned workflow node",
        { nodeId: node.id, selectedSkillId: node.selectedSkillId },
      );
      return null;
    }

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
        ...skillCatalogOptions,
      });
      const explicitDependencies = (step.dependencies || [])
        .filter(
          (depIndex) =>
            Number.isInteger(depIndex) && depIndex >= 0 && depIndex < index,
        )
        .map((depIndex) => nodeIds[depIndex]);
      const dependencies =
        explicitDependencies.length > 0
          ? [...(index === 0 ? node.dependencies : []), ...explicitDependencies]
          : index === 0
            ? [...node.dependencies]
            : [nodeIds[index - 1]];
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
        ...(step.label ? { displayLabel: step.label } : {}),
        successCriteria:
          step.successCriteria ||
          `The subtask outcome for "${step.objective}" is verified on the page or in tool output.`,
        ...(step.toolProfile ? { toolProfile: step.toolProfile } : {}),
        allowedTools: [...node.allowedTools],
        dependencies,
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
        verificationGate: step.verifyAfter
          ? { ...step.verifyAfter }
          : undefined,
        status: "pending",
        retries: 0,
      };
    });

    logger.info("orchestrator", "Planner expanded node into subgraph", {
      sourceNodeId: node.id,
      count: expanded.length,
    });
    return annotateParallelContracts(expanded);
  }

  async planNextHorizon(
    query: string,
    completedSummary: string,
    pageTitle: string,
    pageUrl: string,
    skillCatalogOptions?: SkillCatalogOptions,
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

    const nodes = annotateParallelContracts(
      stepsToNodes(
        query,
        steps as DecompositionStep[],
        "planned",
        pageTitle,
        pageUrl,
        skillCatalogOptions,
      ),
    );

    logger.info("orchestrator", "Planner produced horizon expansion nodes", {
      count: nodes.length,
    });

    return nodes;
  }
}
