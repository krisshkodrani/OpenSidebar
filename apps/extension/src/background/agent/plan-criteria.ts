/**
 * Success-criteria hygiene for planner steps. Extracted from `planner.ts`
 * under the decomposition ratchet (the label work displaced these lines).
 */
import { tokenizeStepText } from "./loop-helpers";

/** Generic criteria patterns that have no DOM-observable tokens */
const GENERIC_CRITERIA = [
  /^the user goal is/i,
  /^the subtask outcome for/i,
  /^step .* is completed/i,
  /^step completed/i,
  /^completed and verified/i,
  /^task (is )?(completed|done|finished)/i,
];

/**
 * Ensure successCriteria contains DOM-observable tokens.
 * If the planner provides generic criteria, derive better ones from the objective.
 */
export function ensureObservableCriteria(
  criteria: string,
  objective: string,
): string {
  const isGeneric = GENERIC_CRITERIA.some((p) => p.test(criteria));
  if (!isGeneric) return criteria;

  // Derive from objective: extract meaningful tokens and rebuild
  const tokens = tokenizeStepText(objective);
  if (tokens.length === 0) return criteria; // can't improve, keep original
  return `Page shows: ${tokens.slice(0, 6).join(", ")}`;
}
