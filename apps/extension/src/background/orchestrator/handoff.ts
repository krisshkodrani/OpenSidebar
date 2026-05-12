import {
  NodeHandoffArtifact,
  PlannerReflexionEntry,
  ReflexionEntry,
  StructuredEvidence,
  TaskNode,
} from "./types";
import { TaskRunProgressInput } from "@shared-types/progress";
import {
  getLoadedSkillContract,
  selectPrimarySkill,
  summarizeSkillForVerifier,
} from "./skills";
import { ToolName } from "../../types";

const MAX_HANDOFF_ARTIFACTS = 4;
const MAX_NOTE_LEN = 240;
const MAX_TASK_CONTEXT_NODES = 5;
export const MAX_HANDOFF_DEPTH = 2;
const MIN_ASSUMPTION_TOKEN_LEN = 4;
const MAX_ORIGINAL_QUERY_EXCERPT = 420;
const LIST_DETAIL_REVIEW_SKILL_ID = "list-detail-review-loop";
const CROSS_TAB_COMPARE_SKILL_ID = "cross-tab-compare";
const MULTI_TAB_CHECKLIST_SKILL_ID = "multi-tab-checklist-workflow";
const MAX_RESULT_LEN = 500;
const MAX_COMPACT_LIST_DETAIL_RESULT_LEN = 220;
const MAX_PROGRESS_LIST_ITEMS = 4;
const MAX_PROGRESS_FACTS = 4;
const VERIFICATION_TURN_QUERY_PATTERN =
  /\b(did it work|verify|check if|check whether|does it show|what('s| is) the (status|result|current)|is it there|confirm (?:the )?(?:current )?(?:status|result|state)|confirm (?:if|whether|that))\b/i;

const PHASE_LABELS: Record<NodeHandoffArtifact["phase"], string> = {
  planned: "Planner",
  planner_replan: "Planner replan",
  executor_started: "Executor start",
  executor_finished: "Executor result",
  verifier_accept: "Verifier accept",
  verifier_retry: "Verifier retry",
  verifier_reroute: "Verifier reroute",
  verifier_advisory: "Advisory",
};

function normalizeNote(note: string): string {
  return note.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_LEN);
}

function normalizeNodeResult(node: TaskNode): string {
  const detail = node.result || node.error || "No detail provided";
  return normalizeNote(detail);
}

function extractRelevantKeywords(summary: string): string[] {
  const keywordMap: Array<[RegExp, string]> = [
    [/\breact native\b/i, "React Native"],
    [/\breact\b/i, "React"],
    [/\btypescript\b/i, "TypeScript"],
    [/\bjavascript\b/i, "JavaScript"],
    [/\bnode(?:\.js)?\b/i, "Node"],
    [/\bgraphql\b/i, "GraphQL"],
    [/\bangular\b/i, "Angular"],
    [/\bfrontend\b/i, "Frontend"],
    [/\bui\b/i, "UI"],
    [/\bdevops\b/i, "DevOps"],
  ];
  const found: string[] = [];
  for (const [pattern, label] of keywordMap) {
    if (pattern.test(summary)) found.push(label);
    if (found.length >= 4) break;
  }
  return found;
}

export function compactExecutorSummaryForNode(
  node: Pick<TaskNode, "description" | "selectedSkillId" | "result" | "error">,
  summary?: string,
): string {
  const raw = (summary || node.result || node.error || "No detail")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "No detail";

  if (node.selectedSkillId !== LIST_DETAIL_REVIEW_SKILL_ID) {
    return raw.slice(0, MAX_RESULT_LEN);
  }

  const facts: string[] = [];
  const locationMatch = raw.match(/\b(remote|hybrid|on[- ]site)\b/i);
  if (locationMatch) facts.push(`location=${locationMatch[1].toLowerCase()}`);

  const salaryMatch = raw.match(
    /([$€£]\s?\d[\d,.]*(?:\s?[kK])?(?:\s*-\s*[$€£]?\s?\d[\d,.]*(?:\s?[kK])?)?(?:\s*\/\s*(?:year|yr|hour|hr))?)/,
  );
  if (salaryMatch) facts.push(`salary=${salaryMatch[1]}`);

  const keywords = extractRelevantKeywords(raw);
  if (keywords.length > 0) facts.push(`stack=${keywords.join("/")}`);

  if (/\b(returned?|back)\b.{0,40}\b(list|listings|results)\b/i.test(raw)) {
    facts.push("returned to listings");
  }

  const description = normalizeNote(node.description);
  const compact =
    facts.length > 0 ? `${description} :: ${facts.join("; ")}` : description;
  return compact.slice(0, MAX_COMPACT_LIST_DETAIL_RESULT_LEN);
}

function compactOriginalQuery(
  originalQuery: string,
  activeObjective: string,
): string {
  const raw = originalQuery.trim();
  if (raw.length <= MAX_ORIGINAL_QUERY_EXCERPT) return raw;

  const objectiveTokens = activeObjective
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_ASSUMPTION_TOKEN_LEN);

  const candidateClauses = raw
    .split(/(?<=[.!?])\s+|\s+(?=and then|then|but|while)\b/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const prioritized = candidateClauses
    .map((clause) => {
      const lower = clause.toLowerCase();
      let score = 0;
      if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(clause)) score += 4;
      if (/\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i.test(clause)) score += 4;
      if (/["'][^"']+["']/.test(clause)) score += 3;
      if (/\b(code|coupon|promo|email|name|address|phone|date|time|order)\b/i.test(lower))
        score += 2;
      if (objectiveTokens.some((token) => lower.includes(token))) score += 1;
      return { clause, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.clause);

  const source = prioritized.length > 0 ? prioritized : candidateClauses;
  return source.join(" ").slice(0, MAX_ORIGINAL_QUERY_EXCERPT);
}

function formatSkillExecutionContract(node: TaskNode): string[] {
  const loadedSkill = getLoadedSkillContract(node.selectedSkillId);
  const contract = loadedSkill?.executionContract;
  if (!loadedSkill || !contract) return [];

  const sections: string[] = [
    "Skill execution contract:",
  ];

  if (contract.sequencing?.length) {
    sections.push(
      "Sequence to preserve:",
      ...contract.sequencing.map((item) => `- ${item}`),
    );
  }

  if (contract.toolDiscipline?.length) {
    sections.push(
      "Tool discipline:",
      ...contract.toolDiscipline.map((item) => `- ${item}`),
    );
  }

  if (contract.completionChecks?.length) {
    sections.push(
      "Completion checks:",
      ...contract.completionChecks.map((item) => `- ${item}`),
    );
  }

  if (contract.failureRecovery?.length) {
    sections.push(
      "Failure recovery rules:",
      ...contract.failureRecovery.map((item) => `- ${item}`),
    );
  }

  return [...sections, ""];
}

function buildStructuredProgressSection(
  structuredProgress?: Record<string, TaskRunProgressInput>,
): string[] {
  if (!structuredProgress || Object.keys(structuredProgress).length === 0) {
    return [];
  }

  const sections: string[] = ["Structured task progress:"];

  const completedPhases = structuredProgress["completed-phases"];
  if (
    completedPhases?.kind === "completed-phase-list" &&
    completedPhases.payload.length > 0
  ) {
    sections.push(
      "Completed phases:",
      ...completedPhases.payload
        .slice(-MAX_PROGRESS_LIST_ITEMS)
        .map((item) => `- ${normalizeNote(item)}`),
    );
  }

  const reviewedItems = structuredProgress["reviewed-items"];
  if (
    reviewedItems?.kind === "reviewed-item-list" &&
    reviewedItems.payload.length > 0
  ) {
    sections.push(
      "Reviewed items:",
      ...reviewedItems.payload
        .slice(-MAX_PROGRESS_LIST_ITEMS)
        .map((item) => `- ${normalizeNote(item)}`),
    );
  }

  const extractedFacts = structuredProgress["extracted-facts"];
  if (
    extractedFacts?.kind === "extracted-fact-map" &&
    Object.keys(extractedFacts.payload).length > 0
  ) {
    sections.push(
      "Extracted facts:",
      ...Object.entries(extractedFacts.payload)
        .slice(0, MAX_PROGRESS_FACTS)
        .map(([key, value]) => `- ${normalizeNote(key)}: ${normalizeNote(String(value))}`),
    );
  }

  const outstandingQuestions = structuredProgress["outstanding-questions"];
  if (
    outstandingQuestions?.kind === "outstanding-question-list" &&
    outstandingQuestions.payload.length > 0
  ) {
    sections.push(
      "Outstanding questions:",
      ...outstandingQuestions.payload
        .slice(-MAX_PROGRESS_LIST_ITEMS)
        .map((item) => `- ${normalizeNote(item)}`),
    );
  }

  return sections.length > 1 ? [...sections, ""] : [];
}

function buildExecutorSkillSection(node: TaskNode): string[] {
  const loadedSkill = getLoadedSkillContract(node.selectedSkillId);
  if (!loadedSkill) return [];

  if (loadedSkill.id === MULTI_TAB_CHECKLIST_SKILL_ID) {
    return [
      "Selected workflow skill:",
      `- ${loadedSkill.id}: ${loadedSkill.description}`,
      ...(node.selectedSkillReason
        ? [`- Why selected: ${normalizeNote(node.selectedSkillReason)}`]
        : []),
      "Skill operating brief:",
      "- Re-read the source item only long enough to confirm the target page, requested action, and constraints.",
      "- Open or reuse the matching target page in another tab, switch into it, and complete only that source item's work.",
      "- Once target-tab evidence exists, store only compact completion facts such as item, target page, extracted fact, or confirmation number.",
      "- Switch back to the source tab and mark or record only the completed item before moving on.",
      "- Treat source-page progress markers, reviewed badges, counters, or row-complete state as sufficient evidence when they reflect the completed target work.",
      "- Avoid browser-history navigation while the source and target tabs are both available.",
      "",
    ];
  }

  if (loadedSkill.id === LIST_DETAIL_REVIEW_SKILL_ID) {
    return [
      "Selected workflow skill:",
      `- ${loadedSkill.id}: ${loadedSkill.description}`,
      ...(node.selectedSkillReason
        ? [`- Why selected: ${normalizeNote(node.selectedSkillReason)}`]
        : []),
      "Skill operating brief:",
      "- For recommendation or best-match tasks, treat the visible listings as the candidate set unless the user narrowed the scope.",
      "- Open each next visible listing detail directly from the listings page; keep the loop moving in list order.",
      "- Capture only fit-critical facts: role, company, location, salary, seniority, and core stack.",
      "- Keep compact notes per reviewed listing so the final recommendation can be synthesized from evidence instead of unverified recall.",
      "- After each review, use the page's visible listings/back-to-results control before continuing.",
      "- Avoid exploratory recovery tools while visible list actions or return controls exist.",
      "- Call done() only after the requested listing set is reviewed, the listings page is visible again, and any recommendation is grounded in the captured facts.",
      "",
    ];
  }

  if (loadedSkill.id === CROSS_TAB_COMPARE_SKILL_ID) {
    return [
      "Selected workflow skill:",
      `- ${loadedSkill.id}: ${loadedSkill.description}`,
      ...(node.selectedSkillReason
        ? [`- Why selected: ${normalizeNote(node.selectedSkillReason)}`]
        : []),
      "Skill operating brief:",
      "- Use previously gathered step results and notes as the primary evidence source for the comparison.",
      "- Synthesize only after every required comparison target has a fact set in prior completed results or fresh grounded evidence.",
      "- Treat visible page tabs such as Overview or Reports as in-page controls, not browser tabs; use browser tab tools only when the user explicitly means separate browser tabs.",
      "- Avoid browser-history navigation or page hopping unless a specific target is still missing evidence.",
      "- If one target remains unread, gather only that missing evidence and then compare.",
      "",
    ];
  }

  return [
    "Selected workflow skill:",
    `- ${loadedSkill.id}: ${loadedSkill.description}`,
    ...(node.selectedSkillReason
      ? [`- Why selected: ${normalizeNote(node.selectedSkillReason)}`]
      : []),
    "Skill procedure:",
    loadedSkill.procedureMarkdown,
    ...(loadedSkill.requiredEvidence?.length
      ? [
          "Skill evidence requirements:",
          ...loadedSkill.requiredEvidence.map((item) => `- ${item}`),
        ]
      : []),
    ...formatSkillExecutionContract(node),
  ];
}

export function formatHandoffBrief(artifacts: NodeHandoffArtifact[]): string {
  if (artifacts.length === 0) {
    return "No prior handoff context.";
  }

  const recent = artifacts.slice(-MAX_HANDOFF_ARTIFACTS);
  return recent
    .map((artifact) => {
      const label = PHASE_LABELS[artifact.phase] || artifact.phase;
      return `- ${label} (${artifact.role}): ${normalizeNote(artifact.note)}`;
    })
    .join("\n");
}

const MAX_REFLEXION_ENTRIES = 3;

export function formatReflexionContext(entries: ReflexionEntry[]): string {
  if (entries.length === 0) return "";
  const recent = entries.slice(-MAX_REFLEXION_ENTRIES);
  const lines = recent.map((entry) => {
    const parts = [
      `Attempt ${entry.attempt}: ${entry.verifierDecision}`,
      `  What was tried: ${normalizeNote(entry.executorSummary)}`,
      `  Why it failed: ${normalizeNote(entry.verifierReason)}`,
    ];
    if (entry.failureType) {
      parts.push(`  Failure type: ${entry.failureType}`);
    }
    if (entry.suggestedApproach) {
      parts.push(
        `  Suggested change: ${normalizeNote(entry.suggestedApproach)}`,
      );
    }
    return parts.join("\n");
  });
  return lines.join("\n\n");
}

export function buildTaskStateBrief(
  nodes: TaskNode[],
  currentNodeId?: string,
  mode: "executor" | "verifier" = "executor",
  currentNode?: Pick<TaskNode, "selectedSkillId">,
  structuredProgress?: Record<string, TaskRunProgressInput>,
): string {
  const structuredSections = buildStructuredProgressSection(structuredProgress);
  if (nodes.length === 0) {
    return structuredSections.length > 0
      ? structuredSections.join("\n")
      : "No task-level context available.";
  }

  const relevant = nodes.filter((node) => node.id !== currentNodeId);
  if (relevant.length === 0) {
    return structuredSections.length > 0
      ? structuredSections.join("\n")
      : "No sibling node context yet.";
  }

  if (mode === "executor") {
    const completed = relevant.filter(
      (node) =>
        node.status === "completed" ||
        node.status === "failed" ||
        node.status === "skipped",
    );
    const sections: string[] = [];

    if (structuredSections.length > 0) {
      sections.push(...structuredSections);
    }

    if (
      currentNode?.selectedSkillId === CROSS_TAB_COMPARE_SKILL_ID &&
      completed.length > 0
    ) {
      sections.push("Completed comparison evidence:", buildCompletedStepsSummary(relevant));
    } else if (completed.length > 0) {
      sections.push(
        "Completed / prior steps:",
        ...completed.slice(-2).map((node) => {
          const status =
            node.status === "completed"
              ? "completed"
              : node.status === "failed"
                ? "failed"
                : "skipped";
          return `- [${status}] ${normalizeNote(node.description)} :: ${normalizeNodeResult(node)}`;
        }),
      );
    }

    const remainingCount = relevant.filter(
      (node) => node.status === "pending" || node.status === "running",
    ).length;
    if (remainingCount > 0) {
      sections.push(
        `Remaining future steps: ${remainingCount}`,
        "Do NOT execute them until the current objective is verified complete.",
      );
    }

    return sections.join("\n");
  }

  const verifierRelevant = relevant.slice(-MAX_TASK_CONTEXT_NODES);
  const sections: string[] = [];

  if (structuredSections.length > 0) {
    sections.push(...structuredSections);
  }

  sections.push(
    ...verifierRelevant.map((node) => {
      const status =
        node.status === "completed"
          ? "completed"
          : node.status === "failed"
            ? "failed"
            : node.status === "running"
              ? "running"
              : node.status === "skipped"
                ? "skipped"
                : "pending";
      return `- [${status}] ${normalizeNote(node.description)} :: ${normalizeNodeResult(node)}`;
    }),
  );

  return sections.join("\n");
}

export function isVerificationTurnQuery(query?: string): boolean {
  if (!query) return false;
  return VERIFICATION_TURN_QUERY_PATTERN.test(query);
}

export function shouldUseVerificationTurnMode(params: {
  originalQuery?: string;
}): boolean {
  return isVerificationTurnQuery(params.originalQuery);
}

export function buildExecutorInstruction(
  node: TaskNode,
  taskStateBrief?: string,
  realitySignal?: string,
  objectiveOverride?: string,
  originalQuery?: string,
  verificationTurnMode = false,
  personalContextBrief?: string,
): string {
  const handoffBrief = formatHandoffBrief(node.handoffArtifacts);
  const reflexionContext = formatReflexionContext(node.reflexionLog);
  const assumptions =
    node.assumptions.length > 0
      ? node.assumptions.map((item) => `- ${normalizeNote(item)}`).join("\n")
      : "- No explicit assumptions from planner.";
  const sections = [
    `Objective: ${objectiveOverride || node.description}`,
    `Success criteria: ${node.successCriteria}`,
    "",
  ];
  if (reflexionContext) {
    sections.push(
      "Prior attempt analysis (DO NOT repeat these failures):",
      reflexionContext,
      "",
    );
  }
  sections.push(
    "Planner assumptions (validate against current page before acting):",
    assumptions,
    "",
    ...buildExecutorSkillSection(node),
    "Handoff context:",
    handoffBrief,
    "",
    "Execution policy:",
    "- Prioritize the current step objective, but complete every requirement stated in the Objective and Success criteria before calling done().",
    "- Treat later planner steps as sequencing context; do not call done() while an explicit requested step remains unfinished.",
    "- Validate planner assumptions against the current page before acting.",
    "- Use prior context only to avoid duplicate work or preserve requested literals.",
    "- If verifier requested reroute or retry, adapt strategy before acting.",
    ...(node.reflexionLog.length > 0
      ? [
          "- CRITICAL: Prior attempts failed. Study the failure analysis above and use a fundamentally different strategy.",
          "- Call done() only when success criteria are satisfied.",
        ]
      : ["- Call done() only when success criteria are satisfied."]),
  );

  if (personalContextBrief) {
    sections.push(
      "",
      personalContextBrief,
      "Use personal context for fit, preferences, and wording. For exact form values, call get_profile_fields instead of copying from context.",
    );
  }

  if (taskStateBrief && taskStateBrief !== "No sibling node context yet.") {
    sections.push("", "Step-scoped task context:", taskStateBrief);
  }

  if (realitySignal && realitySignal !== "No drift signal recorded.") {
    sections.push("", "Reality check signal:", realitySignal);
  }

  const activeObjective = objectiveOverride || node.description;
  const mentionsSavedProfile =
    /\b(saved profile|profile data|profile field|identity\.(?:first_name|last_name|email))\b/i.test(
      `${activeObjective}\n${originalQuery || ""}`,
    );
  const allowsProfileFields = node.allowedTools.includes(ToolName.GET_PROFILE_FIELDS);

  if (mentionsSavedProfile && allowsProfileFields) {
    sections.push(
      "",
      "PROFILE DATA POLICY:",
      "- The user's saved profile is available through get_profile_fields.",
      "- If the current step needs name, email, or other saved profile values, call get_profile_fields for the exact fields before typing or navigating away.",
      '- If the current step needs the saved CV/resume file, upload it with upload_file using profileFile: "cv".',
      "- Treat returned profile values as the source of truth; do not invent replacements when the profile is expected to provide them.",
      "- Do not leave the current checkout or form page to search for a login/profile page unless the page explicitly shows authentication is required.",
    );
  }

  if (/\b(job|application|apply|cv|resume)\b/i.test(`${activeObjective}\n${originalQuery || ""}`)) {
    sections.push(
      "",
      "JOB APPLICATION POLICY:",
      '- Use profileFile: "cv" for saved CV/resume uploads.',
      "- Fill the application and verify required fields, but do not click the final submit/apply control until explicit approval is granted.",
    );
  }

  if (node.verificationGate) {
    const gate = node.verificationGate;
    const actionText =
      gate.action === "call_done"
        ? "call done() immediately to deliver the result"
        : "advance to the next step";
    sections.push(
      "",
      "VERIFICATION CHECKPOINT:",
      `After each action, check: ${gate.trigger}`,
      `If triggered: ${actionText}.`,
      "Do NOT continue executing additional tools once this condition is met.",
    );
  }

  if (verificationTurnMode) {
    sections.push(
      "",
      "VERIFICATION TURN:",
      "The user is asking you to confirm the result of a prior action.",
      "You must complete this turn using tool calls, not plain-text narration.",
      "Rules:",
      "- If current page evidence is insufficient or stale, call read_page().",
      '- If the current grounded page state already answers the question, call done({"summary":"..."}) immediately.',
      "- Do not describe findings in plain text.",
      "- Do not repeat the prior action unless the user explicitly asked for that.",
    );
  }

  if (originalQuery) {
    const compactQuery = compactOriginalQuery(originalQuery, activeObjective);
    sections.push(
      "",
      "Original user request (reference for specific values — names, emails, codes):",
      compactQuery,
    );
  }

  return sections.join("\n");
}

export function formatEvidenceChain(evidence: StructuredEvidence[]): string {
  if (evidence.length === 0) return "";
  return evidence
    .map((e) => {
      if (e.event) {
        const parts = [
          `- [${e.event.source}] ${e.event.type} (confidence=${e.event.confidence})`,
        ];
        const detail = e.event.detail
          ? JSON.stringify(e.event.detail).slice(0, 240)
          : "";
        if (detail) parts.push(`  detail: ${detail}`);
        return parts.join("\n");
      }
      const parts = [
        `- [${e.basis ?? "tool_output"}] ${normalizeNote(e.claim ?? "")} (confidence=${(e.confidence ?? 0).toFixed(2)})`,
      ];
      if (e.sourceToolCall) parts.push(`  source: ${e.sourceToolCall}`);
      return parts.join("\n");
    })
    .join("\n");
}

export function buildVerifierContext(
  node: TaskNode,
  taskStateBrief: string,
): string {
  const nodeHandoff = formatHandoffBrief(node.handoffArtifacts);
  const loadedSkill = getLoadedSkillContract(node.selectedSkillId);
  const skillSummary = summarizeSkillForVerifier(loadedSkill);
  const sections = [
    ...(skillSummary ? ["Skill verification contract:", skillSummary, ""] : []),
    "Node handoff context:",
    nodeHandoff,
  ];

  const allEvidence = node.handoffArtifacts
    .filter((a) => a.evidence && a.evidence.length > 0)
    .flatMap((a) => a.evidence!);
  if (allEvidence.length > 0) {
    sections.push(
      "",
      "Structured evidence chain:",
      formatEvidenceChain(allEvidence),
    );
  }

  sections.push("", "Global task context:", taskStateBrief);
  return sections.join("\n");
}

const MAX_PLANNER_REFLEXION_ENTRIES = 5;

export function formatPlannerReflexionContext(
  entries: PlannerReflexionEntry[],
): string {
  if (entries.length === 0) return "";
  const recent = entries.slice(-MAX_PLANNER_REFLEXION_ENTRIES);
  return recent
    .map((e) => {
      const parts = [
        `- Node ${e.nodeId.slice(0, 8)}: verifier ${e.verifierDecision}`,
        `  Executor summary: ${normalizeNote(e.executorSummary)}`,
      ];
      if (e.failureType) parts.push(`  Failure type: ${e.failureType}`);
      if (e.plannerLesson)
        parts.push(`  Lesson: ${normalizeNote(e.plannerLesson)}`);
      return parts.join("\n");
    })
    .join("\n");
}

function tokenizeAssumption(assumption: string): string[] {
  return assumption
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_ASSUMPTION_TOKEN_LEN);
}

export function buildAssumptionDriftSignal(
  node: TaskNode,
  snapshot?: {
    title?: string;
    url?: string;
    visibleContent?: string;
    pageContent?: string;
  } | null,
): string {
  if (!snapshot || node.assumptions.length === 0) {
    return "No assumption drift evaluation available.";
  }
  const corpus =
    `${snapshot.title || ""}\n${snapshot.url || ""}\n${snapshot.pageContent || snapshot.visibleContent || ""}`.toLowerCase();
  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const assumption of node.assumptions) {
    const tokens = tokenizeAssumption(assumption);
    if (tokens.length === 0) continue;
    const hasMatch = tokens.some((token) => corpus.includes(token));
    if (hasMatch) {
      matched.push(assumption);
    } else {
      unmatched.push(assumption);
    }
  }

  if (matched.length === 0 && unmatched.length > 0) {
    return `Potential plan-reality drift: ${unmatched.length} assumption(s) unmatched. Unmatched: ${unmatched.join(" | ")}`;
  }
  if (unmatched.length === 0) {
    return `Planner assumptions validated: ${matched.length} matched.`;
  }
  return `Partial assumption drift: matched=${matched.length}, unmatched=${unmatched.length}.`;
}

const MAX_COMPLETED_SUMMARY_NODES = 10;

export function buildCompletedStepsSummary(nodes: TaskNode[]): string {
  const completed = nodes.filter((n) => n.status === "completed");
  if (completed.length === 0) return "";

  const shown = completed.slice(-MAX_COMPLETED_SUMMARY_NODES);
  const omitted = completed.length - shown.length;

  const lines: string[] = [];
  if (omitted > 0) {
    lines.push(`[${omitted} earlier steps omitted]`);
  }
  shown.forEach((node, i) => {
    const idx = omitted + i + 1;
    const result = compactExecutorSummaryForNode(node);
    lines.push(`${idx}. "${normalizeNote(node.description)}" → ${result}`);
  });

  return `Steps completed (${completed.length} total):\n${lines.join("\n")}`;
}

export function createRerouteNode(
  sourceNode: TaskNode,
  rerouteObjective: string,
  rerouteReason: string,
): TaskNode {
  const selection = selectPrimarySkill({
    query: sourceNode.description,
    objective: rerouteObjective,
    successCriteria: sourceNode.successCriteria,
  });
  return {
    ...(selection
      ? {
          selectedSkillId: selection.id,
          selectedSkillReason: selection.reason,
        }
      : {}),
    id: crypto.randomUUID(),
    role: "executor",
    description: rerouteObjective.trim(),
    successCriteria: sourceNode.successCriteria,
    allowedTools: [...sourceNode.allowedTools],
    dependencies: [sourceNode.id],
    assumptions: [...sourceNode.assumptions],
    handoffArtifacts: [
      {
        role: "verifier",
        phase: "verifier_reroute",
        note: normalizeNote(
          `Handoff from ${sourceNode.id}: ${rerouteReason}. New objective: ${rerouteObjective}`,
        ),
        timestamp: Date.now(),
      },
    ],
    reflexionLog: sourceNode.reflexionLog.slice(-MAX_REFLEXION_ENTRIES),
    handoffDepth: sourceNode.handoffDepth + 1,
    handoffFromNodeId: sourceNode.id,
    status: "pending",
    retries: 0,
  };
}
