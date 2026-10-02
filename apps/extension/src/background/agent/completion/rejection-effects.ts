import type { logger, SessionScopedLogger } from "../../../utils";
import type { CompletionEffect } from "./pipeline-types";
import {
  getCompletionRejectionInstruction,
  getPendingAutocompleteCompletionEvidence,
  type CompletionRejectionDecision,
} from "./rejection-instruction";

export function formatDoneRejectionDiagnostic(params: {
  doneRejections: number;
  maxDoneRejections: number;
  summary: string;
  primaryReason: string;
  fallbackInstruction: string;
  nextStepHint?: string;
  collectIssues(summary: string): string[];
}): string {
  const nextStepHint = params.nextStepHint ?? "";
  if (params.doneRejections < 2) {
    return (
      `done() REJECTED: ${params.primaryReason}\n\n` +
      params.fallbackInstruction +
      nextStepHint
    );
  }

  const issues = params.collectIssues(params.summary);
  if (!issues.some((issue) => issue.includes(params.primaryReason))) {
    issues.unshift(params.primaryReason);
  }
  const outstanding =
    issues.length > 0
      ? issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")
      : `1. ${params.primaryReason}`;

  return (
    `done() REJECTED (attempt ${params.doneRejections}/${params.maxDoneRejections}). Outstanding:\n` +
    `${outstanding}\n\n` +
    "Fix all outstanding issues before calling done(). Take a concrete page action or call escalate() if the current approach cannot resolve them." +
    nextStepHint
  );
}

/** Build effects in their original mutation order; diagnostics render after increment. */
export function buildKernelRejectionEffects(
  summary: string,
  decision: CompletionRejectionDecision,
  state: {
    turnCount: number;
    doneRejections: number;
    log: Pick<typeof logger | SessionScopedLogger, "warn">;
  },
): CompletionEffect[] {
  state.log.warn("agent", "DONE rejected by deterministic completion kernel", {
    turn: state.turnCount,
    rejections: state.doneRejections + 1,
    status: decision.status,
    reason: decision.reason,
    contractKind: decision.contract.kind,
  });
  const effects: CompletionEffect[] = [
    { type: "record_contract_rejection", kind: decision.contract.kind },
    { type: "increment_done_rejections" },
    { type: "check_done_rejection_escalation" },
    { type: "set_last_completion_rejection", decision },
    {
      type: "emit_trace",
      event: "completion_decision",
      data: {
        turn: state.turnCount,
        status: decision.status,
        source: "model_done",
        reason: decision.reason,
        contractKind: decision.contract.kind,
        evidenceKeys: decision.evidence.map((event) => event.logicalKey),
      },
    },
  ];
  const pendingAutocomplete = getPendingAutocompleteCompletionEvidence(decision);
  if (pendingAutocomplete) {
    effects.push({
      type: "emit_trace",
      event: "done_rejected_autocomplete_suggestion_pending",
      data: {
        rejections: state.doneRejections + 1,
        inputTag: pendingAutocomplete.detail.inputElementId,
        suggestionTag: pendingAutocomplete.detail.suggestionElementId,
        value: String(pendingAutocomplete.detail.value ?? "").toLowerCase(),
      },
    });
  }
  effects.push({
    type: "post_rejection_diagnostic",
    summary,
    primaryReason: decision.reason,
    fallbackInstruction: getCompletionRejectionInstruction(decision),
  });
  return effects;
}
