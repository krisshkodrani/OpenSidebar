// Turns a human adjudication into a regression fixture. The `EvalCase` shape is
// defined here (no prior consumer existed) — a minimal, replay-independent
// record of "for this task, a human expected THIS outcome" that the golden
// endpoint stores under evals/golden/. Pure and deterministic (no clock): the
// timestamp comes from the annotation, ids from its source.

import type { RunAnnotation } from "../store/types";
import type { TraceSession } from "../../types/traces";

export interface EvalCase {
  id: string;
  /** The task the agent was given (the session query). */
  task: string;
  startUrl?: string;
  expected: {
    /** The outcome the human affirms is correct for this task. */
    outcome: string;
    note?: string;
    /** Optional criterion descriptions the human marked as required. */
    criteria?: string[];
  };
  humanVerdict: RunAnnotation["verdict"];
  /** What the run actually computed, for drift tracking. */
  computedOutcome?: string;
  source: { sessionId: string; runId?: string; annotationId: string };
  createdAt: string;
}

/**
 * Build an EvalCase from an adjudication. When the human AGREES, the expected
 * outcome is the computed one (this run is a positive fixture); when they
 * DISAGREE, the expected outcome is their correction (a regression the harness
 * currently gets wrong). `unsure` still exports — it flags a case worth a
 * second look — carrying the computed outcome as expected.
 */
export function buildEvalCase(
  annotation: RunAnnotation,
  session: Pick<TraceSession, "query" | "startUrl">,
): EvalCase {
  const computedOutcome = annotation.computed?.outcome;
  const expectedOutcome =
    annotation.verdict === "disagree" && annotation.correctedOutcome
      ? annotation.correctedOutcome
      : (computedOutcome ?? "completed");
  const criteria = annotation.criteriaOverrides
    ?.filter((o) => o.pass)
    .map((o) => o.note || o.criterionId);
  return {
    id: `adj-${annotation.id}`,
    task: session.query ?? "",
    startUrl: session.startUrl || undefined,
    expected: {
      outcome: expectedOutcome,
      note: annotation.note,
      criteria: criteria && criteria.length ? criteria : undefined,
    },
    humanVerdict: annotation.verdict,
    computedOutcome,
    source: {
      sessionId: annotation.sessionId,
      runId: annotation.runId,
      annotationId: annotation.id,
    },
    createdAt: annotation.annotatedAt,
  };
}

/** Derive the golden filename for a batch of adjudications on a given day. */
export function goldenFileName(annotatedAtIso: string): string {
  const day = (annotatedAtIso || "").slice(0, 10) || "undated";
  return `adjudicated-${day}`;
}
