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

// ── Negative guards: any hit → run the planner ──────────────────────────────

const ENUMERATED_LIST = /(?:^|\n)\s*(?:\d+[.)]|[-*•])\s/;
const STEPS_LABEL = /\bsteps?\s*:/i;
const SEQUENCING_CONNECTIVE =
  /\b(?:then|after that|next,|afterwards|finally|once (?:done|complete|finished))\b/gi;
const ROUND_TRIP = /\b(?:return to|go(?:ing)? back|back to|come back|and back)\b/i;
const MULTI_TAB_OR_COMPARE =
  /\b(?:new tab|each tab|separate tabs?|both tabs|across tabs|side by side|compare)\b/i;
const EXHAUSTIVE_ITERATION =
  /\b(?:each|every|one by one|for all|all \d+|both\b(?! tabs))\b/i;
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
  if (!compacted || compacted.length > MAX_DIRECT_QUERY_CHARS) return false;

  // Negative guards — any multi-step signal defers to the LLM planner.
  if (ENUMERATED_LIST.test(query)) return false; // pre-compaction: needs \n
  if (STEPS_LABEL.test(compacted)) return false;
  if (countMatches(compacted, SEQUENCING_CONNECTIVE) >= 2) return false;
  if (ROUND_TRIP.test(compacted)) return false;
  if (MULTI_TAB_OR_COMPARE.test(compacted)) return false;
  if (EXHAUSTIVE_ITERATION.test(compacted)) return false;
  const urls = new Set(
    [...compacted.matchAll(URL_PATTERN)].map((m) => m[0].toLowerCase()),
  );
  if (urls.size > 1) return false;
  if (SEPARATE_UPDATES_A.test(compacted) || SEPARATE_UPDATES_B.test(compacted)) {
    return false;
  }

  // Positive shapes.
  const isCurrentPageRead =
    CURRENT_PAGE_READ.test(compacted) && !NAVIGATION_VERB.test(compacted);
  const isSingleFormFill =
    SINGLE_FORM_FILL_VERB.test(compacted) &&
    SINGLE_FORM_FILL_TARGET.test(compacted);
  const isSingleInteraction =
    SINGLE_INTERACTION_HEAD.test(compacted) &&
    countMatches(compacted, /\band\b/gi) <= 1;

  return isCurrentPageRead || isSingleFormFill || isSingleInteraction;
}
