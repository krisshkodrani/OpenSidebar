/**
 * Stagnation eval scorer — pure functions, no API calls.
 *
 * Scores escalation accuracy and timing against expected behavior.
 */

import type { StagnationEvalCase, StagnationEvalResult } from "./types";

const WEIGHTS = {
  escalationAccuracy: 0.40,
  timingAccuracy: 0.30,
  falsePositiveRate: 0.15,
  falseNegativeRate: 0.15,
};

const PASS_COMPOSITE = 0.75;

export interface StagnationScores {
  escalationAccuracy: number;
  timingAccuracy: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  composite: number;
}

/**
 * Score stagnation replay against expected escalation behavior.
 */
export function scoreStagnation(
  evalCase: StagnationEvalCase,
  actual: {
    escalationFired: boolean;
    escalationTurn?: number;
    stagnantTurnCounts: number[];
    urlChanges: number;
  },
): StagnationScores {
  const ea = scoreEscalationAccuracy(evalCase.expected.escalation.shouldFire, actual.escalationFired);
  const ta = scoreTimingAccuracy(evalCase.expected.escalation, actual);
  const fp = scoreFalsePositive(evalCase.expected.sessionWasStuck, actual.escalationFired);
  const fn = scoreFalseNegative(evalCase.expected.sessionWasStuck, actual.escalationFired);

  const composite =
    ea * WEIGHTS.escalationAccuracy +
    ta * WEIGHTS.timingAccuracy +
    fp * WEIGHTS.falsePositiveRate +
    fn * WEIGHTS.falseNegativeRate;

  return {
    escalationAccuracy: ea,
    timingAccuracy: ta,
    falsePositiveRate: fp,
    falseNegativeRate: fn,
    composite,
  };
}

/**
 * Determine pass/fail from scores.
 */
export function isStagnationPass(scores: StagnationScores): boolean {
  return scores.composite >= PASS_COMPOSITE && scores.escalationAccuracy === 1.0;
}

// ── Metric functions ─────────────────────────────────────────────────

/**
 * Escalation accuracy: binary — fired matches expected.
 */
function scoreEscalationAccuracy(shouldFire: boolean, fired: boolean): number {
  return shouldFire === fired ? 1.0 : 0.0;
}

/**
 * Timing accuracy: escalation turn within expected range.
 * If no escalation expected: 1.0 if no fire.
 */
function scoreTimingAccuracy(
  expected: StagnationEvalCase["expected"]["escalation"],
  actual: { escalationFired: boolean; escalationTurn?: number },
): number {
  if (!expected.shouldFire) {
    return actual.escalationFired ? 0.0 : 1.0;
  }

  if (!actual.escalationFired || actual.escalationTurn === undefined) {
    return 0.0;
  }

  if (!expected.expectedTurnRange) {
    // No specific range expected — just check that it fired
    return actual.escalationFired ? 1.0 : 0.0;
  }

  const { min, max } = expected.expectedTurnRange;
  const turn = actual.escalationTurn;

  if (turn >= min && turn <= max) return 1.0;

  // Linear decay outside range
  const rangeWidth = Math.max(max - min, 1);
  if (turn < min) {
    return Math.max(0, 1 - (min - turn) / rangeWidth);
  }
  return Math.max(0, 1 - (turn - max) / rangeWidth);
}

/**
 * False positive: 1.0 if session wasn't stuck and no escalation fired.
 * 0.0 if escalation fired on non-stuck session.
 * 1.0 if session was stuck (not a false positive scenario).
 */
function scoreFalsePositive(sessionWasStuck: boolean, escalationFired: boolean): number {
  if (sessionWasStuck) return 1.0; // Can't be a false positive if actually stuck
  return escalationFired ? 0.0 : 1.0;
}

/**
 * False negative: 1.0 if session was stuck and escalation fired.
 * 0.0 if session was stuck but no escalation.
 * 1.0 if session wasn't stuck (not a false negative scenario).
 */
function scoreFalseNegative(sessionWasStuck: boolean, escalationFired: boolean): number {
  if (!sessionWasStuck) return 1.0; // Can't be a false negative if not stuck
  return escalationFired ? 1.0 : 0.0;
}
