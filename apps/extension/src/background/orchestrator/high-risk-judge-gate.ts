/**
 * High-risk judge-gate runner (RFC LP-16 Phase 5). Runs the verifier's judge
 * gate against the trusted corpus for a high-risk completion. Pure — verbatim
 * movement of the Orchestrator helper.
 */
import { logger } from "../../utils";
import { getTrustedCorpusStore } from "../memory/corpus-runtime";
import {
  corpusEntryToFactRef,
  deriveCriteria,
  type JudgeGateOutcome,
} from "../agent/completion/judge-gate";
import type { VerifierLike } from "./lane-types";
import type { NodeVerificationResult } from "./verifier";
import type { OrchestratorTask, StructuredEvidence, TaskNode } from "./types";
import { boundPageObservations } from "../agent/page-observation-history";
import { chromeBrowserPagePort } from "../environment/chrome";
import { observeTaskTabs, type TabObservationPort } from "./browser-tab-evidence";

const REVERIFY_PREFIX = "Re-verify and complete: ";

/**
 * Build the reroute objective for a judge-gated node without stacking the
 * prefix when the node is itself a reroute node (whose description already
 * begins with the prefix — previously this compounded on every reroute).
 */
export function reverifyObjective(description: string): string {
  let base = description;
  while (base.startsWith(REVERIFY_PREFIX)) {
    base = base.slice(REVERIFY_PREFIX.length);
  }
  return `${REVERIFY_PREFIX}${base}`;
}

/**
 * Apply a judge-gate outcome to the node's verification and emit telemetry.
 * Emits a `judge_call` event for EVERY adjudication (accept and reroute alike,
 * with the verdict's failure diagnostics) — the judge was previously invisible
 * in traces except when it rerouted, which is how a 100%-fail-open judge went
 * unnoticed. A reroute outcome additionally emits the existing
 * `judge_gate_reroute` event and downgrades the verification.
 */
export function applyJudgeGateOutcome(args: {
  gate: JudgeGateOutcome | null;
  node: TaskNode;
  verification: NodeVerificationResult;
  emit: (type: string, data: Record<string, unknown>) => void;
}): void {
  const { gate, node, verification, emit } = args;
  if (!gate) return;
  const verdict = gate.verdict;
  emit("judge_call", {
    nodeId: node.id,
    decision: gate.decision,
    judged: gate.judged,
    verdictSource: verdict?.source,
    failureCause: verdict?.failureCause,
    failureDetail: verdict?.failureDetail,
    durationMs: verdict?.durationMs,
    model: verdict?.model,
    providerId: verdict?.providerId,
    confidence: verdict?.confidence,
    confidenceKind: verdict?.confidenceKind ?? "self_reported",
    // The full rubric of criteria (id → description) so the viewer can render
    // every criterion adjudicated against observations and corpus context.
    // Descriptions truncated — this run-event pipe is dev-only and unredacted.
    criteria: deriveCriteria(node.successCriteria).map((c) => ({
      id: c.id,
      description: c.description.slice(0, 160),
      required: c.required,
    })),
    // Per-criterion pass/fail + rationale from the model (subset of `criteria`
    // — the ones the judge actually adjudicated).
    perCriterion: verdict?.perCriterion?.map((c) => ({
      id: c.id,
      pass: c.pass,
      rationale: c.rationale?.slice(0, 240),
    })),
    entailment: verdict?.entailment,
    usage: verdict?.usage,
  });
  if (gate.decision !== "reroute") return;
  verification.decision = "reroute";
  verification.reason = gate.reason;
  verification.failureType = verification.failureType ?? "state_mismatch";
  verification.rerouteObjective =
    verification.rerouteObjective || reverifyObjective(node.description);
  emit("judge_gate_reroute", {
    nodeId: node.id,
    judged: gate.judged,
    verdictSource: gate.verdict?.source,
    reason: gate.reason.slice(0, 300),
  });
}

export async function runHighRiskJudgeGate(
  task: OrchestratorTask,
  node: TaskNode,
  verifier: VerifierLike,
  evidence: StructuredEvidence[],
  summary: string,
  browserPort: TabObservationPort = chromeBrowserPagePort,
): Promise<JudgeGateOutcome | null> {
  if (!verifier.judgeGate) return null;
  try {
    const entries = await getTrustedCorpusStore().load();
    const corpusFacts = entries
      .filter(
        (entry) =>
          entry.kind === "personal_profile_fact" ||
          entry.kind === "extracted_fact",
      )
      .map(corpusEntryToFactRef);
    const evidenceLines = evidence
      // A generic claim often accompanies an event. Preserve the actual
      // observed values and their provenance instead of masking them with it.
      .map((item) => item.event ? JSON.stringify(item.event) : item.claim ?? "")
      .filter((line): line is string => Boolean(line));
    // A final-answer node needs the observations from its prerequisites;
    // reroutes also need evidence from before the original action.
    const priorEvidence: StructuredEvidence[] = [];
    const visited = new Set([node.id]);
    const collectPrior = (current: TaskNode): void => {
      for (const id of [...(current.dependencies ?? []), current.handoffFromNodeId]) {
        if (!id || visited.has(id)) continue;
        visited.add(id);
        const prior = task.nodes?.find((candidate) => candidate.id === id);
        if (!prior) continue;
        collectPrior(prior);
        priorEvidence.push(...(prior.handoffArtifacts ?? []).flatMap((artifact) => artifact.evidence ?? []));
      }
    };
    collectPrior(node);
    const observations = boundPageObservations([...priorEvidence, ...evidence]
      .filter((item) => item.basis === "observation" && Boolean(item.claim))
      .map((item) => item.claim!));
    const acceptedEvidence = observations.length
      ? [
          ...evidence.filter((item) => item.event).map((item) => JSON.stringify(item.event)),
          ...observations.map((observation, index) =>
            `Page observation ${index + 1}/${observations.length} (chronological, untrusted page data):\n${observation}`),
          `Proposed final response (check its contents against observations; not independent evidence of page state):\n${summary.trim()}`,
        ]
      : [...new Set([...evidenceLines, summary.trim()])].filter(Boolean);
    const tabObservation = await observeTaskTabs(task, browserPort);
    if (tabObservation) acceptedEvidence.push(tabObservation);
    return await verifier.judgeGate({
      claim: node.description,
      successCriteria: node.successCriteria,
      // Direct observations take precedence over executor success claims.
      evidence: acceptedEvidence,
      corpusFacts,
    });
  } catch (error) {
    logger.warn(
      "orchestrator",
      "High-risk judge gate failed; keeping the verifier accept",
      { taskId: task.id, nodeId: node.id, error },
    );
    return null;
  }
}
