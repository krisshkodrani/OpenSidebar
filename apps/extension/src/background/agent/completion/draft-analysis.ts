/**
 * Draft-state completion analysis for draft-only tasks (RFC LP-16 Phase 1).
 * Extracts unsent-draft evidence from form-field observations and derives
 * draft_state completion evidence. Verbatim movement from completion-kernel.ts.
 */
import type { DomSnapshot } from "../../../types";
import type {
  CompletionConfidence,
  CompletionEvidence,
  FormFieldObservation,
} from "./kernel-types";
import { cleanLabel, compactKey, normalizeText } from "./text-utils";
import { extractFormFieldObservations } from "./form-field-analysis";

export function draftStateEvidence(
  params: FormFieldObservation & {
    confidence: CompletionConfidence;
    observedAtTurn: number;
  },
): Extract<CompletionEvidence, { type: "draft_state" }> {
  const target = params.label || params.stableKey || `tag-${params.elementId}`;
  const targetKey = compactKey(target) || `tag-${params.elementId}`;
  const identityKey =
    compactKey(params.stableKey) || compactKey(params.label) || targetKey;
  return {
    type: "draft_state",
    confidence: params.confidence,
    logicalKey: `draft:${targetKey}:${identityKey}`,
    observedAtTurn: params.observedAtTurn,
    detail: {
      target,
      text: params.value,
      submitted: false,
    },
  };
}

export function extractDraftEvidence(
  snapshot: DomSnapshot,
  turn: number,
): CompletionEvidence[] {
  return extractFormFieldObservations(snapshot)
    .filter(isLikelyDraftEditorField)
    .filter((field) => cleanLabel(field.value).length > 0)
    .map((field) =>
      draftStateEvidence({
        ...field,
        confidence: "medium",
        observedAtTurn: turn,
      }),
    );
}

export function isLikelyDraftEditorField(field: FormFieldObservation): boolean {
  if (field.kind !== "text") return false;
  return isLikelyDraftEditorIdentity(field.label, field.stableKey);
}

export function isLikelyDraftEditorIdentity(
  label: string | undefined,
  stableKey: string | undefined,
): boolean {
  const labelText = normalizeText([label, stableKey].join(" "));
  return /\b(?:reply|response|message|comment|body|compose|draft|editor|post)\b/i.test(
    labelText,
  );
}

export function extractReadElementValueEvidenceText(params: {
  args: Record<string, unknown>;
  result: string;
}): string | null {
  const attribute = params.args.attribute;
  if (typeof attribute === "string" && attribute.toLowerCase() !== "value") {
    return null;
  }
  const valueMatch = params.result.match(/\bvalue="([\s\S]*)"\s*$/);
  if (valueMatch) return valueMatch[1];
  return null;
}
