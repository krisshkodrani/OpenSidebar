import type { GeneratedCompletionContract } from "./kernel-types";
import { formFillFieldsMentionedInObjective } from "./form-fill-relevance";
import { inferWorkflowConfirmationAction } from "./workflow-confirmation-analysis";

export function isContractRelevantToObjective(
  generated: GeneratedCompletionContract,
  params: {
    activeObjective?: string;
    successCriteria?: string;
    userRequest: string;
  },
): boolean {
  // Judge against the focused objective AND the original request: either may
  // hold the vocabulary (a distilled objective can drop the verb, the raw
  // request can hold the field values).
  const objective = [params.activeObjective, params.userRequest]
    .filter(Boolean)
    .join("\n");

  switch (generated.contract.kind) {
    case "quiz_selection":
      return /\b(?:quiz|exam|test|question\s*\d?|answers?|select|choose|pick|check|mark|tick)\b/i.test(
        objective,
      );

    case "form_fill":
      if (
        /\b(?:fill|enter|type|input|set|save|update|change|configure|choose|select|pick|enable|disable|toggle|apply|submit|check\s*out|checkout|log\s*in|sign\s*in|sign\s*up|register|create\s+account)\b/i.test(
          objective,
        )
      ) {
        return true;
      }
      // No data-entry verb — accept only if the contract's fields were clearly
      // inferred from the request itself (e.g. `Caller = "Joe Employee"`).
      // Contracts scraped from an incidental page form share no tokens with the
      // objective, which is the deadlock case this gate exists to block.
      return formFillFieldsMentionedInObjective(
        objective,
        generated.contract.requiredFields,
      );

    case "workflow_confirmation": {
      // A root request can mention later or explicitly prohibited mutations.
      // When a focused node exists, only its own objective may authorize a
      // workflow-confirmation contract for that node.
      if (!params.activeObjective) return true;
      const focusedText = [params.activeObjective, params.successCriteria]
        .filter(Boolean)
        .join("\n");
      return (
        inferWorkflowConfirmationAction(focusedText) ===
        generated.contract.action
      );
    }

    default:
      return true;
  }
}
