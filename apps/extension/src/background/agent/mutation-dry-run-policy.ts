/**
 * Mutation dry-run policy (RFC LP-15, Phase 8).
 *
 * The correctness core of dry-run → diff → approve → commit: before a form
 * submit, the agent captures the live form state (`extract_form_state`) and this
 * module diffs it against the *approved draft* — the field values the agent
 * intended to submit (a `FormFillContract.requiredFields` expectation list). A
 * clean diff on a pre-approved draft auto-approves; any mismatch or missing
 * field is an "unexpected diff" that must route to human approval with the
 * rendered diff. Pure and environment-free so it is exhaustively unit-testable.
 */

import type { FormStateCapture } from "../../types";
import type {
  CompletionEvidence,
  FormFillFieldExpectation,
} from "./completion/kernel-types";

export type FormStateDiffStatus = "match" | "mismatch" | "missing";

export interface FormStateDiffEntry {
  label: string;
  expected: string;
  /** The captured value, or null when the expected field was not found. */
  actual: string | null;
  status: FormStateDiffStatus;
}

export interface FormStateDiff {
  entries: FormStateDiffEntry[];
  /** True iff every expected field is present with a matching value. */
  clean: boolean;
  /** Stable digest of the diff — sealed with the committed mutation. */
  diffHash: string;
}

/** Key normalization for matching a draft label to a captured field name. */
function keyNorm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Value normalization: trim, collapse internal whitespace, case-fold. */
function valueNorm(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function findCapturedField(
  expected: FormFillFieldExpectation,
  fields: FormStateCapture["fields"],
): FormStateCapture["fields"][number] | null {
  const target = keyNorm(expected.label);
  if (!target) return null;
  // Exact normalized-key match first, then bidirectional containment
  // ("Full name" ↔ "fullName", "email" ↔ "emailAddress").
  return (
    fields.find((f) => keyNorm(f.name) === target) ??
    fields.find((f) => {
      const k = keyNorm(f.name);
      return k.length > 0 && (k.includes(target) || target.includes(k));
    }) ??
    null
  );
}

function djb2(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Diff a captured form state against the approved-draft field expectations.
 * Only the EXPECTED fields are checked (extra captured fields — page defaults,
 * hidden config — are not diff-breaking); a submit is "clean" iff every expected
 * field is present with a matching value.
 */
export function diffFormStateAgainstDraft(
  captured: FormStateCapture,
  expected: FormFillFieldExpectation[],
): FormStateDiff {
  const entries: FormStateDiffEntry[] = expected.map((exp) => {
    const field = findCapturedField(exp, captured.fields);
    if (!field) {
      return { label: exp.label, expected: exp.value, actual: null, status: "missing" };
    }
    const status: FormStateDiffStatus =
      valueNorm(field.value) === valueNorm(exp.value) ? "match" : "mismatch";
    return { label: exp.label, expected: exp.value, actual: field.value, status };
  });
  const clean = entries.every((e) => e.status === "match");
  const diffHash = djb2(
    `${captured.formKey}|${entries
      .map((e) => `${keyNorm(e.label)}=${valueNorm(e.expected)}:${e.status}`)
      .join(";")}`,
  );
  return { entries, clean, diffHash };
}

/**
 * Build the `form_state_captured` completion-evidence for a capture. Keyed
 * `form:${formKey}` so repeated captures of the same form dedup in the ledger
 * (latest-turn wins). Lives here (not in the frozen kernel) as a Phase 8
 * feature; the verifier reads it as a structural form-state delta.
 */
export function buildFormStateCapturedEvidence(
  captured: FormStateCapture,
  observedAtTurn: number,
): CompletionEvidence {
  return {
    type: "form_state_captured",
    confidence: "high",
    logicalKey: `form:${captured.formKey}`,
    observedAtTurn,
    detail: {
      formKey: captured.formKey,
      fields: captured.fields.map((f) => ({ name: f.name, value: f.value })),
    },
  };
}

/**
 * The dry-run decision for a pending form submit (RFC LP-15 Phase 8):
 *  - `no_draft`  → no approved field map / no capture; fall through to the
 *                  normal approval gate unchanged.
 *  - `clean`     → captured state matches the pre-approved draft; auto-approve
 *                  the submit and seal the commit.
 *  - `unexpected`→ a mismatch/missing field; route to HUMAN approval carrying
 *                  the rendered diff.
 */
export type DryRunClassification =
  | { kind: "no_draft" }
  | { kind: "clean"; diff: FormStateDiff }
  | { kind: "unexpected"; diff: FormStateDiff; rendered: string };

export function classifyFormSubmitDryRun(
  capture: FormStateCapture | null,
  draft: FormFillFieldExpectation[] | null | undefined,
): DryRunClassification {
  if (!capture || !draft || draft.length === 0) return { kind: "no_draft" };
  const diff = diffFormStateAgainstDraft(capture, draft);
  return diff.clean
    ? { kind: "clean", diff }
    : { kind: "unexpected", diff, rendered: renderFormStateDiff(diff) };
}

/** Human-readable diff for the approval prompt (only the non-matching rows). */
export function renderFormStateDiff(diff: FormStateDiff): string {
  const problems = diff.entries.filter((e) => e.status !== "match");
  if (problems.length === 0) return "No unexpected changes.";
  return problems
    .map((e) =>
      e.status === "missing"
        ? `• ${e.label}: expected "${e.expected}" but the field was not found`
        : `• ${e.label}: expected "${e.expected}" but form has "${e.actual}"`,
    )
    .join("\n");
}
