/**
 * Pure classifiers over a ServiceNow record-form controller tool result.
 *
 * These interpret the text a `configure_servicenow_form` submit returns so the
 * record-form controller in the agent loop can decide whether a submit was
 * rejected, whether re-submitting the identical values is futile, and what
 * error to surface to the agent. They are grounded in stable ServiceNow submit
 * semantics and kept in the quarantined SN adapter (no `this`, no runtime deps).
 */

/**
 * The submit result signals a rejection — either an explicit "Submit
 * diagnostics:" block or a validation keyword. Broad on purpose: covers both
 * hard validation errors and transient "stayed on the create form" states.
 */
export function isServiceNowSubmitRejected(toolResult: string): boolean {
  return (
    /\bSubmit diagnostics:\b/i.test(toolResult) ||
    /\b(?:Invalid update|mandatory|required|cannot be blank|not submitted)\b/i.test(
      toolResult,
    )
  );
}

/**
 * A server-side validation rejection that re-submitting the identical values
 * cannot fix (a ServiceNow error banner or a missing mandatory field), as
 * opposed to a transient "submit did not leave the create form" with no error.
 */
export function isServiceNowSubmitHardRejected(toolResult: string): boolean {
  return (
    /\b(?:Invalid update|cannot be blank)\b/i.test(toolResult) ||
    /\bMissing mandatory fields?\b/i.test(toolResult) ||
    /\b(?:mandatory|required)\b[^.\n]{0,40}\b(?:field|value)\b/i.test(toolResult)
  );
}

/** Extract the ServiceNow error/mandatory diagnostics for the agent handoff. */
export function extractServiceNowSubmitDiagnostic(toolResult: string): string {
  const lines = toolResult
    .split("\n")
    .map((line) => line.replace(/^[-\s]+/, "").trim())
    .filter((line) =>
      /Invalid update|mandatory|cannot be blank|Missing mandatory|required|Error Message/i.test(
        line,
      ),
    );
  return [...new Set(lines)].slice(0, 4).join("; ");
}

/** The submit click did not navigate off the create form. */
export function isServiceNowSubmitStayedOnCreateForm(
  toolResult: string,
): boolean {
  return /\bsubmit did not leave the create form\b/i.test(toolResult);
}

/**
 * The message the record-form controller hands back to the agent when a submit
 * did not produce trusted evidence. On a hard validation rejection it surfaces
 * the ServiceNow error and directs the agent to fix the offending field rather
 * than resubmit identically (which just loops); otherwise it keeps the prior
 * "verify or submit" guidance for a merely-untrusted result.
 */
export function buildServiceNowSubmitDeferralMessage(
  toolResult: string,
  hardRejected: boolean,
): string {
  if (!hardRejected) {
    return "The ServiceNow record form controller filled the requested fields but did not get trusted submit evidence. Verify validation errors or submit the form with configure_servicenow_form({ submit: true }).";
  }
  const diagnostic = extractServiceNowSubmitDiagnostic(toolResult);
  return (
    "ServiceNow rejected the submission with a validation error" +
    (diagnostic ? ` (${diagnostic})` : "") +
    ". Resubmitting the same values will fail again. Read the on-page error banner and identify the offending field: a reference value may not have resolved (retype it and pick a matching option), a mandatory field may be blank, or a state-dependent field (such as a resolution field) may require the record's State to be set first. Correct that field with configure_servicenow_form, then submit once. If the requested value genuinely cannot be set on this record, report the constraint instead of resubmitting."
  );
}
