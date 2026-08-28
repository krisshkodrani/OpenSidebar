import { inferRequestedWorkflowConfirmationAction } from "../agent/completion/workflow-request-intent";

/**
 * Planner-gate policy (LP-17 P6): pre-LLM single-node short-circuit.
 *
 * Live traces (docs/engineering/token-and-planner-analysis-2026-07-18.md)
 * showed 74% of structured plans end single-node, yet every plan paid a
 * glm-5p2 decompose call (p50 8.2s, p90 39s, max 62s) — the take-5 refurbed
 * run spent 53s "planning" a plan that came out as one node.
 *
 * qualifiesForDirectSingleNode is a deliberately HIGH-PRECISION / low-recall
 * heuristic: a query routes past the planner only when it fails every
 * multi-step signal AND matches a known single-node shape. A false positive
 * is soft — the query runs as one node with its full turn budget (exactly
 * the tested "simple" lane-topology path), and failure/escalation still
 * reaches the full LLM replanner.
 */

const MAX_DIRECT_QUERY_CHARS = 240;
/**
 * LP-17b CM-1: value-laden form-fill prompts are long ONLY because they carry
 * literal field values ("First Name: Kris\nEmail: …"). Take 6 measured the
 * cost of routing one to the planner anyway: 54s of glm-5p2 deciding
 * nodeCount:1 while restating the input ~3x into a 22K-char node prompt that
 * was then re-billed every turn. This tier gets its own generous cap.
 */
const MAX_FORM_FILL_QUERY_CHARS = 8000;
/** "Label: value" lines — the field-list shape (URLs in values are expected). */
const FIELD_VALUE_LINE = /^\s*[A-Z][^:\n]{0,48}:\s*\S/gm;
const MIN_FIELD_VALUE_LINES = 3;

// ── Negative guards: any hit → run the planner ──────────────────────────────

const ENUMERATED_LIST = /(?:^|\n)\s*(?:\d+[.)]|[-*•])\s/;
const STEPS_LABEL = /\bsteps?\s*:/i;
const SEQUENCING_CONNECTIVE =
  /\b(?:then|after that|next,|afterwards|finally|once (?:done|complete|finished))\b/gi;
const ROUND_TRIP =
  /\b(?:return to|go(?:ing)? back|back to|come back|and back)\b/i;
const MULTI_TAB_OR_COMPARE =
  /\b(?:new tab|each tab|separate tabs?|both tabs|across tabs|side by side|compare)\b/i;
// Cross-ITEM iteration only (LP-17b CM-1): "update every record" is a real
// multi-step signal; "fill each field once" / "select BOTH options" is
// same-page phrasing that lives inside single-form-fill prompts (the take-6
// kit literally contains both). Iteration words only count when aimed at a
// cross-item noun.
const EXHAUSTIVE_ITERATION =
  /\b(?:each|every|both|one by one|for all)\b[\w\s]{0,16}\b(?:page|tab|item|record|entry|row|listing|application|product|result|link)s?\b|\ball \d+\b/i;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
// Mirrors shouldPreserveSeparateFormUpdateNodes (orchestrator/planner.ts) —
// a user asking for "separate" updates is explicitly asking for structure.
const SEPARATE_UPDATES_A =
  /\bseparate(?:ly)?\b.{0,40}\b(update|updates|action|actions|step|steps|task|tasks)\b/i;
const SEPARATE_UPDATES_B =
  /\b(update|updates|action|actions|step|steps|task|tasks)\b.{0,40}\bseparate(?:ly)?\b/i;

// ── Positive shapes: at least one must match ────────────────────────────────

const NAVIGATION_VERB = /\b(?:navigate|go to|open|visit|browse to)\b/i;
const CURRENT_PAGE_READ =
  /\b(?:summari[sz]e|extract|read|list|report|find|what(?:'s| is| are)|tell me)\b/i;
const SINGLE_FORM_FILL_VERB = /\b(?:fill(?: in| out)?|enter|complete|type)\b/i;
const SINGLE_FORM_FILL_TARGET =
  /\b(?:forms?|fields?|applications?|details|information|values?)\b/i;
const SINGLE_INTERACTION_HEAD =
  /^\s*(?:click|press|select|choose|pick|check|uncheck|toggle|enable|disable|set)\b/i;

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

export function qualifiesForDirectSingleNode(query: string): boolean {
  const compacted = query.replace(/\s+/g, " ").trim();
  if (!compacted) return false;

  // Negative guards — any multi-step signal defers to the LLM planner.
  // (The >1-URL guard is tier-specific: see below.)
  if (ENUMERATED_LIST.test(query)) return false; // pre-compaction: needs \n
  if (STEPS_LABEL.test(compacted)) return false;
  if (countMatches(compacted, SEQUENCING_CONNECTIVE) >= 2) return false;
  if (ROUND_TRIP.test(compacted)) return false;
  if (MULTI_TAB_OR_COMPARE.test(compacted)) return false;
  if (EXHAUSTIVE_ITERATION.test(compacted)) return false;
  if (
    SEPARATE_UPDATES_A.test(compacted) ||
    SEPARATE_UPDATES_B.test(compacted)
  ) {
    return false;
  }
  if (
    CURRENT_PAGE_READ.test(compacted) &&
    inferRequestedWorkflowConfirmationAction(compacted)
  ) {
    return false;
  }

  const isSingleFormFill =
    SINGLE_FORM_FILL_VERB.test(compacted) &&
    SINGLE_FORM_FILL_TARGET.test(compacted);

  // Tier 2 (LP-17b CM-1): value-laden form fill. Long is fine when the length
  // comes from "Label: value" lines, and URLs are expected AS VALUES (a
  // LinkedIn profile, a CV file URL) — so the multi-URL guard is waived here.
  // FIELD_VALUE_LINE runs on the RAW query: compaction destroys line starts.
  if (
    isSingleFormFill &&
    compacted.length <= MAX_FORM_FILL_QUERY_CHARS &&
    countMatches(query, FIELD_VALUE_LINE) >= MIN_FIELD_VALUE_LINES
  ) {
    return true;
  }

  // Tier 1: short single-node shapes.
  if (compacted.length > MAX_DIRECT_QUERY_CHARS) return false;
  const urls = new Set(
    [...compacted.matchAll(URL_PATTERN)].map((m) => m[0].toLowerCase()),
  );
  if (urls.size > 1) return false;

  const isCurrentPageRead =
    CURRENT_PAGE_READ.test(compacted) && !NAVIGATION_VERB.test(compacted);
  const isSingleInteraction =
    SINGLE_INTERACTION_HEAD.test(compacted) &&
    countMatches(compacted, /\band\b/gi) <= 1;

  return isCurrentPageRead || isSingleFormFill || isSingleInteraction;
}
