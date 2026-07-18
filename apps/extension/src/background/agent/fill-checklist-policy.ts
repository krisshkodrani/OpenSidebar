/**
 * Fill-checklist policy (LP-17 Phase 1): truthful feedback that stops the
 * form-fill verification tail.
 *
 * Live traces (docs/engineering/token-and-planner-analysis-2026-07-18.md)
 * showed ~24% of a long form-fill run spent re-reading fields that were
 * already confirmed filled — each redundant turn costing a full ~23K-token
 * prompt. The existing guards miss the pattern: assessReadElementSameIdNudge
 * only fires on consecutive same-id reads (alternating re-reads across a
 * field set never trip it), and the tool cache saves the DOM round-trip but
 * not the turn.
 *
 * Philosophy (same as the custom-combobox fix): give the agent truthful
 * feedback, don't change its reasoning. Nothing here blocks a read — we
 * track which fields hold confirmed values and SAY so, in two channels:
 *  - a per-snapshot "Form status" line in the system prompt, and
 *  - a note appended to a read_element result when that exact field was
 *    already read and its value has not changed since.
 */
import { ToolName } from "../../types";
import type { DomSnapshot } from "../../types";
import {
  extractFormFieldObservations,
  findFormFieldObservationByElementId,
} from "./completion/form-field-analysis";
import type { FormFieldObservation } from "./completion/kernel-types";
import { djb2 } from "./loop-helpers";

export interface FieldReadRecord {
  /** Turn on which the field was first read at this value. */
  turn: number;
  /** djb2 of the field value at read time — a changed value voids the record. */
  valueHash: number;
}

/** Keyed by formFieldStableKey. */
export type FieldReadLedger = Map<string, FieldReadRecord>;

export interface FillChecklistStatus {
  totalFields: number;
  filledCount: number;
  filledLabels: string[];
  emptyLabels: string[];
  /** Changes iff the set of filled fields changes — used to dedupe feedback. */
  signature: string;
  /** Human-readable status line, or null when the page is not form-like. */
  line: string | null;
}

/** Below this many tracked fields the checklist is noise, not signal. */
const MIN_FIELDS_FOR_CHECKLIST = 3;
/** Cap label enumerations so the line stays one line. */
const MAX_LISTED_LABELS = 8;

/**
 * A field "holds a confirmed value" when the snapshot itself shows one:
 * non-empty text/select value, or a checked checkbox/radio. This is
 * snapshot-scoped truth — off-screen fields are simply not counted.
 */
function fieldHoldsValue(field: FormFieldObservation): boolean {
  if (field.kind === "checkbox" || field.kind === "radio") {
    return field.value === "true";
  }
  return field.value.trim().length > 0;
}

/**
 * This policy runs inside the system-prompt build — it must never throw, even
 * on a malformed/partial snapshot. A snapshot we can't analyze simply yields
 * no checklist.
 */
function safeExtractFormFieldObservations(
  snapshot: DomSnapshot,
): FormFieldObservation[] {
  try {
    return extractFormFieldObservations(snapshot);
  } catch {
    return [];
  }
}

function listLabels(labels: string[]): string {
  if (labels.length <= MAX_LISTED_LABELS) return labels.join(", ");
  const shown = labels.slice(0, MAX_LISTED_LABELS);
  return `${shown.join(", ")} +${labels.length - shown.length} more`;
}

export function computeFillChecklistStatus(
  snapshot: DomSnapshot | null | undefined,
): FillChecklistStatus {
  const empty: FillChecklistStatus = {
    totalFields: 0,
    filledCount: 0,
    filledLabels: [],
    emptyLabels: [],
    signature: "0/0",
    line: null,
  };
  if (!snapshot) return empty;

  const fields = safeExtractFormFieldObservations(snapshot);
  if (fields.length === 0) return empty;

  // The snapshot is the ground truth for "filled" — the ledger only feeds the
  // re-read note (it can never promote an empty field to confirmed).
  const filled: FormFieldObservation[] = [];
  const unfilled: FormFieldObservation[] = [];
  for (const field of fields) {
    (fieldHoldsValue(field) ? filled : unfilled).push(field);
  }

  const filledLabels = filled.map((f) => f.label);
  const emptyLabels = unfilled.map((f) => f.label);
  const signature = `${filled.length}/${fields.length}|${djb2(
    filled
      .map((f) => f.stableKey)
      .sort()
      .join("|"),
  )}`;

  let line: string | null = null;
  if (fields.length >= MIN_FIELDS_FOR_CHECKLIST && filled.length >= 1) {
    const filledPart =
      `Form status: ${filled.length}/${fields.length} fields hold confirmed ` +
      `values (${listLabels(filledLabels)}) — do not re-read or re-type them.`;
    const emptyPart =
      emptyLabels.length > 0
        ? ` Still empty: ${listLabels(emptyLabels)}.`
        : " No tracked fields remain empty — finish the remaining task steps or call done().";
    line = filledPart + emptyPart;
  }

  return {
    totalFields: fields.length,
    filledCount: filled.length,
    filledLabels,
    emptyLabels,
    signature,
    line,
  };
}

export interface FieldReReadAssessment {
  /** Note to APPEND to the real tool result (never replaces it). */
  note: string | null;
  /** stableKey to record after a successful read, or null when not a form field. */
  recordedKey: string | null;
  /** Element's current value hash (for the caller's ledger update). */
  valueHash: number;
}

export function assessFieldReReadNudge(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  snapshot: DomSnapshot | null | undefined;
  ledger: ReadonlyMap<string, FieldReadRecord>;
}): FieldReReadAssessment {
  const none: FieldReReadAssessment = {
    note: null,
    recordedKey: null,
    valueHash: 0,
  };
  if (params.toolName !== ToolName.READ_ELEMENT) return none;
  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return none;

  let field: FormFieldObservation | null;
  try {
    field = findFormFieldObservationByElementId(params.snapshot ?? null, id);
  } catch {
    return none; // malformed snapshot — feedback only, never break the read
  }
  if (!field) return none;

  const valueHash = djb2(field.value);
  const record = params.ledger.get(field.stableKey);
  let note: string | null = null;
  if (record && record.valueHash === valueHash && fieldHoldsValue(field)) {
    const status = computeFillChecklistStatus(params.snapshot);
    const counts =
      status.totalFields > 0
        ? ` ${status.filledCount}/${status.totalFields} fields hold confirmed values.`
        : "";
    note =
      `[note] You already read "${field.label}" on turn ${record.turn} and ` +
      `its value is unchanged.${counts} Do not re-verify confirmed fields — ` +
      `act on the remaining fields or call done().`;
  }

  return { note, recordedKey: field.stableKey, valueHash };
}

/**
 * One-call wrapper for the dispatch sites: appends the re-read note to the
 * tool result (when warranted) and records the read in the ledger. The read
 * itself always executes/caches normally — this is feedback, not a gate.
 */
export function applyFieldReReadTracking(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  snapshot: DomSnapshot | null | undefined;
  ledger: FieldReadLedger;
  turn: number;
}): string {
  const assessment = assessFieldReReadNudge(params);
  if (assessment.recordedKey) {
    const existing = params.ledger.get(assessment.recordedKey);
    // Keep the original read turn while the value is unchanged, so the note's
    // "on turn N" stays truthful; re-stamp when the value changed.
    if (!existing || existing.valueHash !== assessment.valueHash) {
      params.ledger.set(assessment.recordedKey, {
        turn: params.turn,
        valueHash: assessment.valueHash,
      });
    }
  }
  return assessment.note ? `${params.result}\n${assessment.note}` : params.result;
}
