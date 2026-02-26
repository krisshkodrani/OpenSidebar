/**
 * Perception eval scorer — pure functions, no API calls.
 *
 * Scores perception output against expected annotations across 5 metrics.
 */

import type { PerceptionEvalCase, PerceptionEvalResult } from "./types";

const WEIGHTS = {
  sectionCompleteness: 0.20,
  signalAccuracy: 0.25,
  blockerDetection: 0.20,
  actionability: 0.15,
  hallucination: 0.20,
};

const PASS_COMPOSITE = 0.70;
const PASS_SIGNAL = 0.5;

export interface PerceptionScores {
  sectionCompleteness: number;
  signalAccuracy: number;
  blockerDetection: number;
  actionability: number;
  hallucination: number;
  composite: number;
}

/**
 * Score a perception output against expected annotations.
 */
export function scorePerception(
  evalCase: PerceptionEvalCase,
  interpretation: string,
  completionSignal?: { status: string; evidence: string; scope: string } | null,
): PerceptionScores {
  const sc = scoreSectionCompleteness(evalCase.expected.requiredSections, interpretation);
  const sa = scoreSignalAccuracy(evalCase.expected.completionSignal, completionSignal);
  const bd = scoreBlockerDetection(evalCase.expected.blockers, interpretation);
  const ac = scoreActionability(evalCase.expected.mustMentionElements, interpretation, evalCase.expected.mode);
  const ha = scoreHallucination(evalCase.input.elements, interpretation);

  const composite =
    sc * WEIGHTS.sectionCompleteness +
    sa * WEIGHTS.signalAccuracy +
    bd * WEIGHTS.blockerDetection +
    ac * WEIGHTS.actionability +
    ha * WEIGHTS.hallucination;

  return {
    sectionCompleteness: sc,
    signalAccuracy: sa,
    blockerDetection: bd,
    actionability: ac,
    hallucination: ha,
    composite,
  };
}

/**
 * Determine pass/fail from scores.
 */
export function isPass(scores: PerceptionScores): boolean {
  return scores.composite >= PASS_COMPOSITE && scores.signalAccuracy >= PASS_SIGNAL;
}

/**
 * Section completeness: ratio of required sections found in output.
 */
export function scoreSectionCompleteness(
  requiredSections: string[],
  interpretation: string,
): number {
  if (requiredSections.length === 0) return 1.0;
  let found = 0;
  for (const section of requiredSections) {
    const pattern = new RegExp(`\\d+\\.\\s*${escapeRegex(section)}\\s*:`, "i");
    if (pattern.test(interpretation)) found++;
  }
  return found / requiredSections.length;
}

/**
 * Signal accuracy: match expected completion signal status.
 * Exact match = 1.0, partial credit for "unclear" when expected "not_done" = 0.5.
 * No expected signal = default 1.0.
 */
export function scoreSignalAccuracy(
  expected?: { status: string; scope: string } | null,
  actual?: { status: string; scope: string } | null,
): number {
  if (!expected) return 1.0; // No signal expected → vacuously correct
  if (!actual) return 0.0;   // Expected but missing

  if (expected.status === actual.status) return 1.0;

  // Partial credit: "unclear" when expected "not_done" (conservative hedge)
  if (expected.status === "not_done" && actual.status === "unclear") return 0.5;
  // Partial credit: "unclear" when expected "done" (less forgiving)
  if (expected.status === "done" && actual.status === "unclear") return 0.3;

  return 0.0;
}

/**
 * Blocker detection: fuzzy match expected blockers in BLOCKERS section.
 * Checks both type keyword and description substring.
 */
export function scoreBlockerDetection(
  expectedBlockers: PerceptionEvalCase["expected"]["blockers"],
  interpretation: string,
): number {
  if (!expectedBlockers || expectedBlockers.length === 0) return 1.0;

  const upper = interpretation.toUpperCase();
  let matched = 0;

  for (const blocker of expectedBlockers) {
    const typeFound = upper.includes(blocker.type.toUpperCase());
    // Check if the description (or a significant substring) appears
    const descWords = blocker.description
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);
    const descFound =
      descWords.length === 0 ||
      descWords.some((w) => upper.includes(w.toUpperCase()));

    if (typeFound && descFound) matched++;
    else if (typeFound || descFound) matched += 0.5;
  }

  return matched / expectedBlockers.length;
}

/**
 * Actionability: check if must-mention element tag IDs appear in ACTIONABLE section.
 * Only applies to focused mode; default 1.0 for orientation mode.
 */
export function scoreActionability(
  mustMentionElements: number[] | undefined,
  interpretation: string,
  mode: string,
): number {
  if (mode !== "focused") return 1.0;
  if (!mustMentionElements || mustMentionElements.length === 0) return 1.0;

  // Extract the ACTIONABLE section
  const actionableMatch = interpretation.match(
    /\d+\.\s*ACTIONABLE\s*:([\s\S]*?)(?=\d+\.\s*[A-Z]|\z)/i,
  );
  const section = actionableMatch?.[1] ?? interpretation;

  let found = 0;
  for (const tagId of mustMentionElements) {
    // Match [N] pattern
    if (new RegExp(`\\[${tagId}\\]`).test(section)) found++;
  }

  return found / mustMentionElements.length;
}

/**
 * Hallucination: penalize phantom tag IDs not present in the element list.
 * Extracts all [N] references from output and checks against known IDs.
 * Score = 1 - (phantom ratio). Capped: up to 3 phantoms is mild penalty.
 */
export function scoreHallucination(
  elements: { tag: number }[],
  interpretation: string,
): number {
  const validIds = new Set(elements.map((el) => el.tag));
  const tagRefs = interpretation.matchAll(/\[(\d+)\]/g);
  const referencedIds = new Set<number>();

  for (const match of tagRefs) {
    referencedIds.add(parseInt(match[1], 10));
  }

  if (referencedIds.size === 0) return 1.0;

  let phantoms = 0;
  for (const id of referencedIds) {
    if (!validIds.has(id)) phantoms++;
  }

  // Penalty: each phantom costs ~0.2, capped at full penalty
  const penalty = Math.min(1.0, phantoms * 0.2);
  return 1.0 - penalty;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
