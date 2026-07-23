/**
 * Plan display labels — the planner-authored, UI-only step summaries
 * (owner decision 2026-07-23; see decompose_system.md v7).
 *
 * `description`/`objective` stays the precise executor instruction and is
 * never shortened for the model; everything here exists so humans get one
 * glanceable line instead of five wrapped ones. Extracted from the two
 * planner landmines per the decomposition ratchet.
 */

/** Display labels stay one glanceable line; longer output is model overrun. */
export const MAX_PLAN_LABEL_CHARS = 60;

/**
 * Normalize a planner-emitted display label: single line, unquoted, capped.
 * Returns undefined for anything unusable — the UI then falls back to
 * clamping the objective, which is always safe.
 */
export function sanitizePlanLabel(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const label = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.\s]+$/, "");
  if (label.length === 0) return undefined;
  if (label.length > MAX_PLAN_LABEL_CHARS) {
    // Cut at a word boundary rather than mid-word; a truncated label is
    // still better than the full instruction, but never mislead with "…".
    const cut = label.slice(0, MAX_PLAN_LABEL_CHARS);
    const lastSpace = cut.lastIndexOf(" ");
    return `${lastSpace > 20 ? cut.slice(0, lastSpace) : cut}…`;
  }
  return label;
}

/**
 * Display label for a same-page collapse: all step labels when they exist and
 * fit on one line, else the first plus a count, else nothing (the UI clamp
 * owns unlabelled plans). The merged *description* is executor material and
 * reads terribly in the UI — that is exactly the case this feature fixes.
 */
export function composeCollapsedDisplayLabel(
  stepLabels: Array<string | undefined>,
  totalSteps: number,
): string | undefined {
  const labels = stepLabels.filter((label): label is string => !!label);
  if (labels.length === 0) return undefined;
  const joined = labels.join(" · ");
  if (labels.length === totalSteps && joined.length <= MAX_PLAN_LABEL_CHARS) {
    return joined;
  }
  return `${labels[0]} +${totalSteps - 1} more`;
}
