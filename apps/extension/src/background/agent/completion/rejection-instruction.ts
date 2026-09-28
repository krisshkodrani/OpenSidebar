import type { CompletionEvaluation } from "../completion-kernel";

export type CompletionRejectionDecision = Extract<
  CompletionEvaluation,
  { status: "rejected" | "needs_verification" }
>;

type CompletionValidationErrorEvidence = Extract<
  CompletionRejectionDecision["evidence"][number],
  { type: "validation_error" }
>;

export function getPendingAutocompleteCompletionEvidence(
  decision: CompletionRejectionDecision,
): CompletionValidationErrorEvidence | undefined {
  return decision.evidence.find(
    (event): event is CompletionValidationErrorEvidence =>
      event.type === "validation_error" &&
      event.logicalKey.startsWith("form:autocomplete_pending:"),
  );
}

export function getCompletionRejectionInstruction(
  decision: CompletionRejectionDecision,
): string {
  if (decision.status === "needs_verification") {
    return decision.hint;
  }

  const pendingAutocomplete =
    getPendingAutocompleteCompletionEvidence(decision);
  const suggestionTag = pendingAutocomplete?.detail.suggestionElementId;
  if (typeof suggestionTag === "number") {
    return `YOUR NEXT ACTION: click_element({"id": ${suggestionTag}}), then verify the selected value is visible.`;
  }

  switch (decision.contract.kind) {
    case "quiz_selection":
      return "Verify the current page state, repair the selected options if needed, then call done() again.";
    case "form_fill":
      return "Verify the current form state, select or repair the required field values, then call done() again.";
    case "draft_only":
      return `The draft is not ready: ${decision.reason} Re-read the subject, message, and any validation hint. Check that the intended recipient or organization and every user-requested fact appear in the draft itself, then call done() again only when the page shows a ready unsent draft.`;
    case "navigation":
      return "Navigate to the requested page or verify the current URL, then call done() again.";
    case "read_answer":
      return "Read or verify the current page evidence, repair the answer summary if needed, then call done() again.";
    case "workflow_confirmation":
      return "Verify the requested workflow result is visible or structurally confirmed, repair any missing action, then call done() again.";
    default:
      return "Verify the current page state, repair the missing completion evidence, then call done() again.";
  }
}
