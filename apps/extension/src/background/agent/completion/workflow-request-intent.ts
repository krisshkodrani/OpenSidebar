import {
  inferWorkflowConfirmationAction,
  workflowTargetActionPattern,
} from "./workflow-confirmation-analysis";
import type { WorkflowConfirmationAction } from "./workflow-confirmation-types";
import { stripProhibitedWorkflowClauses } from "./text-utils";

/**
 * Distinguish a requested action from page text that merely names a past
 * action or uses an action word as a noun (for example, "read the update").
 */
export function inferRequestedWorkflowConfirmationAction(
  value: string,
): WorkflowConfirmationAction | null {
  const text = stripProhibitedWorkflowClauses(value);
  const action = inferWorkflowConfirmationAction(text);
  if (!action) return null;

  const actionPattern = workflowTargetActionPattern(action);
  if (!actionPattern) return null;
  const requestedAction = new RegExp(
    `(?:^|[.!?;]\\s*|\\b(?:and|then|also|please)\\s+|\\b(?:can|could|would|will)\\s+you\\s+|\\b(?:need|want|ask(?:ed)?)\\s+(?:you\\s+)?to\\s+)` +
      `(?:please\\s+)?${actionPattern}\\b`,
    "i",
  );
  return requestedAction.test(text) ? action : null;
}
