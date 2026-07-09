/**
 * High-risk judge-gate runner (RFC LP-16 Phase 5). Runs the verifier's judge
 * gate against the trusted corpus for a high-risk completion. Pure — verbatim
 * movement of the Orchestrator helper.
 */
import { logger } from "../../utils";
import { getTrustedCorpusStore } from "../memory/corpus-runtime";
import {
  corpusEntryToFactRef,
  type JudgeGateOutcome,
} from "../agent/completion/judge-gate";
import type { VerifierLike } from "./lane-types";
import type { NodeVerificationResult } from "./verifier";
import type { OrchestratorTask, StructuredEvidence, TaskNode } from "./types";

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
  emit("judge_call", {
    nodeId: node.id,
    decision: gate.decision,
    judged: gate.judged,
    verdictSource: gate.verdict?.source,
    failureCause: gate.verdict?.failureCause,
    failureDetail: gate.verdict?.failureDetail,
    durationMs: gate.verdict?.durationMs,
    model: gate.verdict?.model,
    confidence: gate.verdict?.confidence,
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
      .map((item) => item.claim ?? item.event?.detail ?? item.event?.type ?? "")
      .filter((line): line is string => Boolean(line));
    return await verifier.judgeGate({
      claim: node.description,
      successCriteria: node.successCriteria,
      evidence: evidenceLines.length > 0 ? evidenceLines : [summary],
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
