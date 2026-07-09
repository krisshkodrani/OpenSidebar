/**
 * High-risk judge gate (RFC LP-15, Phase 10).
 *
 * The orchestration that ties the pure entailment gate to the model judge and
 * turns the result into a completion decision adjustment. It runs ONLY for
 * high-risk nodes whose verification already decided `accept` — so it can only
 * make completion STRICTER, never looser: a passing accept is confirmed, and a
 * judge that RULES against the claim (failed criteria or a contradiction)
 * downgrades the accept to `reroute` (an existing re-plan decision). A judge
 * that is UNAVAILABLE (timeout / seat error / garbage output) fails open: the
 * verifier accept stands and the failure is loud in `judge_call` telemetry —
 * infrastructure failure must not punish the task. The human gate for the
 * risky ACTION itself remains the pre-existing consequential-action approval
 * (approval-policy.ts) at tool-execution time; this gate governs whether the
 * OUTCOME is trusted enough to mark the node done.
 *
 * Latency discipline: the entailment gate resolves criteria the corpus already
 * entails, so if the corpus knows every criterion the (paid) judge is skipped.
 */

import {
  runEntailmentGate,
  type CorpusFactRef,
} from "./entailment-gate";
import {
  runRubricJudge,
  type JudgeCriterion,
  type JudgeRubric,
  type JudgeSeat,
  type JudgeVerdict,
  type JudgeVerdictCache,
} from "./judge";
import type { TrustedCorpusEntry } from "../../memory/trusted-corpus";
import { corpusEntryToProfileDigestItem } from "../../memory/trusted-corpus-migration";

/** Flatten a corpus entry into a lexical fact ref for the entailment gate. */
export function corpusEntryToFactRef(entry: TrustedCorpusEntry): CorpusFactRef {
  let text = "";
  if (!entry.encrypted) {
    if (entry.kind === "personal_profile_fact") {
      const item = corpusEntryToProfileDigestItem(entry);
      text = item ? `${item.label} ${item.value}` : "";
    } else if (typeof entry.value === "string") {
      text = entry.value;
    }
  }
  return { claimKey: entry.claimKey, text, encrypted: entry.encrypted };
}

const MAX_CRITERIA = 8;

/**
 * Split a node's success criteria into individual outcome criteria. Each
 * non-trivial clause becomes a required criterion; a criterion asks whether an
 * end-state holds, so the whole set is `required`. Falls back to the whole
 * string as one criterion.
 */
export function deriveCriteria(successCriteria: string): JudgeCriterion[] {
  const clauses = successCriteria
    .split(/[\n;.]+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length >= 3);
  const chosen = clauses.length > 0 ? clauses : [successCriteria.trim()];
  return chosen
    .filter((description) => description.length > 0)
    .slice(0, MAX_CRITERIA)
    .map((description, index) => ({
      id: `c${index + 1}`,
      description,
      required: true,
    }));
}

export interface JudgeGateInput {
  /** The claim under adjudication — typically the node objective. */
  claim: string;
  /** Raw success-criteria text; split into criteria. */
  successCriteria: string;
  /** Rendered evidence lines the executor produced. */
  evidence: string[];
  /** Trusted-corpus facts relevant to the task. */
  corpusFacts: CorpusFactRef[];
}

export interface JudgeGateDeps {
  seat: JudgeSeat;
  cache?: JudgeVerdictCache;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface JudgeGateOutcome {
  /** `accept` — the completion stands; `reroute` — the node must re-plan. */
  decision: "accept" | "reroute";
  reason: string;
  /** False when the entailment gate resolved everything and the judge was skipped. */
  judged: boolean;
  verdict?: JudgeVerdict;
}

/**
 * Run the entailment gate, then (only for still-unresolved criteria) the judge,
 * and map the result to an accept/reroute adjustment. Never throws — the judge
 * runner already fails open.
 */
export async function runJudgeGate(
  input: JudgeGateInput,
  deps: JudgeGateDeps,
): Promise<JudgeGateOutcome> {
  const criteria = deriveCriteria(input.successCriteria);
  const gate = runEntailmentGate(
    criteria.map((c) => c.description),
    input.corpusFacts,
  );

  const unresolved = criteria.filter((c) =>
    gate.unresolved.includes(c.description),
  );
  if (unresolved.length === 0) {
    return {
      decision: "accept",
      reason: "All success criteria are entailed by the trusted corpus.",
      judged: false,
    };
  }

  const rubric: JudgeRubric = {
    claim: input.claim,
    criteria: unresolved,
    evidence: input.evidence,
    corpusFacts: input.corpusFacts
      .filter((fact) => !fact.encrypted && fact.text.length > 0)
      .map((fact) => `${fact.claimKey} = ${fact.text}`),
  };

  const verdict = await runRubricJudge(rubric, deps);

  if (verdict.source === "fail_open") {
    // Fail-open-to-human (RFC LP-15 Phase 10): when the judge itself is
    // unavailable (timeout / seat error / unparseable output) the verifier's
    // accept STANDS — the risky action was already human-gated by the
    // consequential-action approval at execution time, and the judge may only
    // make completion stricter when it actually rules. Rerouting here turned
    // every judge-infrastructure failure into a re-verify loop (observed
    // live: stacked "Re-verify and complete:" churn until the turn budget
    // died). The failure stays loud via the judge_call telemetry.
    return {
      decision: "accept",
      reason:
        "Verification judge was unavailable; verifier accept stands (action was human-gated at execution).",
      judged: true,
      verdict,
    };
  }

  const contradicted = verdict.entailment.some(
    (e) => e.label === "contradicted",
  );
  if (!verdict.pass || contradicted) {
    return {
      decision: "reroute",
      reason: contradicted
        ? "Verification judge found evidence contradicting a known fact."
        : "Verification judge did not confirm the task outcome.",
      judged: true,
      verdict,
    };
  }

  return {
    decision: "accept",
    reason: "Verification judge confirmed the task outcome.",
    judged: true,
    verdict,
  };
}
