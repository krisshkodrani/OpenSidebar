import {
  NodeHandoffArtifact,
  PlannerReflexionEntry,
  ReflexionEntry,
  StructuredEvidence,
  TaskNode,
} from "./types";

const MAX_HANDOFF_ARTIFACTS = 8;
const MAX_NOTE_LEN = 200;
const MAX_TASK_CONTEXT_NODES = 8;
export const MAX_HANDOFF_DEPTH = 2;
const MIN_ASSUMPTION_TOKEN_LEN = 4;

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
): string {
  if (nodes.length === 0) return "No task-level context available.";

  const relevant = nodes.filter((node) => node.id !== currentNodeId);
  if (relevant.length === 0) return "No sibling node context yet.";

  if (mode === "executor") {
    const completed = relevant.filter(
      (node) =>
        node.status === "completed" ||
        node.status === "failed" ||
        node.status === "skipped",
    );
    const sections: string[] = [];

    if (completed.length > 0) {
      sections.push(
        "Completed / prior steps:",
        ...completed.slice(-4).map((node) => {
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

  return verifierRelevant
    .map((node) => {
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
    })
    .join("\n");
}

export function buildExecutorInstruction(
  node: TaskNode,
  taskStateBrief?: string,
  realitySignal?: string,
  objectiveOverride?: string,
  originalQuery?: string,
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
    "Handoff context:",
    handoffBrief,
    "",
    "Step-scoped task context:",
    taskStateBrief || "No sibling node context yet.",
    "",
    "Reality check signal:",
    realitySignal || "No drift signal recorded.",
    "",
    "Execution policy:",
    "- Execute only the current step objective.",
    "- Treat all later steps as out of scope until this step is verified complete.",
    "- Validate planner assumptions against current page and adjust steps if reality changed.",
    "- Continue from prior context; do not repeat completed work.",
    "- Use completed-step context only to avoid duplicating prior work.",
    "- If verifier requested reroute/retry, adapt strategy before acting.",
    ...(node.reflexionLog.length > 0
      ? [
          "- CRITICAL: Prior attempts failed. Study the failure analysis above and use a fundamentally different strategy.",
          "- Call done() only when success criteria are satisfied.",
        ]
      : ["- Call done() only when success criteria are satisfied."]),
  );

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

  if (originalQuery) {
    sections.push(
      "",
      "Original user request (reference for specific values — names, emails, codes):",
      originalQuery.slice(0, 500),
    );
  }

  return sections.join("\n");
}

export function formatEvidenceChain(evidence: StructuredEvidence[]): string {
  if (evidence.length === 0) return "";
  return evidence
    .map((e) => {
      const parts = [
        `- [${e.basis}] ${normalizeNote(e.claim)} (confidence=${e.confidence.toFixed(2)})`,
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
  const sections = ["Node handoff context:", nodeHandoff];

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
const MAX_RESULT_LEN = 100;

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
    const result = (node.result || node.error || "No detail")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_RESULT_LEN);
    lines.push(`${idx}. "${normalizeNote(node.description)}" → ${result}`);
  });

  return `Steps completed (${completed.length} total):\n${lines.join("\n")}`;
}

export function createRerouteNode(
  sourceNode: TaskNode,
  rerouteObjective: string,
  rerouteReason: string,
): TaskNode {
  return {
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
