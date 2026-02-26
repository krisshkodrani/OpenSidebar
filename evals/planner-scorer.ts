/**
 * Planner eval scorer — pure functions, no API calls.
 *
 * Scores planner output across 5 metrics for decompose,
 * and binary match for validateDone.
 */

import type { PlannerEvalCase, PlannerEvalResult } from "./types";

const WEIGHTS = {
  difficultyAccuracy: 0.20,
  stepCountScore: 0.15,
  coverageScore: 0.30,
  stepQualityScore: 0.20,
  antiPatternScore: 0.15,
};

const PASS_COMPOSITE = 0.60;

const DIFFICULTY_ORDER: string[] = ["simple", "moderate", "complex", "extreme"];

export interface PlannerScores {
  difficultyAccuracy: number;
  stepCountScore: number;
  coverageScore: number;
  stepQualityScore: number;
  antiPatternScore: number;
  composite: number;
}

/**
 * Score a decompose result against expected annotations.
 */
export function scorePlannerDecompose(
  evalCase: PlannerEvalCase,
  actual: NonNullable<PlannerEvalResult["actual"]["decomposition"]>,
): PlannerScores {
  const da = scoreDifficultyAccuracy(evalCase.expected.difficulty, actual.difficulty);
  const sc = scoreStepCount(evalCase.expected.stepCountRange, actual.subtasks?.length ?? 0);
  const cv = scoreCoverage(evalCase.expected.mustCoverTopics, actual);
  const sq = scoreStepQuality(actual.steps);
  const ap = scoreAntiPattern(actual);

  const composite =
    da * WEIGHTS.difficultyAccuracy +
    sc * WEIGHTS.stepCountScore +
    cv * WEIGHTS.coverageScore +
    sq * WEIGHTS.stepQualityScore +
    ap * WEIGHTS.antiPatternScore;

  return {
    difficultyAccuracy: da,
    stepCountScore: sc,
    coverageScore: cv,
    stepQualityScore: sq,
    antiPatternScore: ap,
    composite,
  };
}

/**
 * Score a validateDone result.
 */
export function scorePlannerValidateDone(
  evalCase: PlannerEvalCase,
  actual: NonNullable<PlannerEvalResult["actual"]["validation"]>,
): PlannerScores {
  const match = actual.approved === evalCase.expected.approved ? 1.0 : 0.0;
  return {
    difficultyAccuracy: match,
    stepCountScore: match,
    coverageScore: match,
    stepQualityScore: match,
    antiPatternScore: match,
    composite: match,
  };
}

/**
 * Determine pass/fail from scores.
 */
export function isPlannerPass(scores: PlannerScores, method: string): boolean {
  if (method === "validateDone") return scores.composite >= 1.0;
  return scores.composite >= PASS_COMPOSITE;
}

// ── Metric functions ─────────────────────────────────────────────────

function scoreDifficultyAccuracy(
  expected: string | undefined,
  actual: string,
): number {
  if (!expected) return 1.0;

  const expIdx = DIFFICULTY_ORDER.indexOf(expected);
  const actIdx = DIFFICULTY_ORDER.indexOf(actual.toLowerCase());

  if (expIdx === -1 || actIdx === -1) return 0.0;
  const distance = Math.abs(expIdx - actIdx);

  if (distance === 0) return 1.0;
  if (distance === 1) return 0.5;
  return 0.0;
}

function scoreStepCount(
  range: { min: number; max: number } | undefined,
  count: number,
): number {
  if (!range) return 1.0;

  if (count >= range.min && count <= range.max) return 1.0;

  const rangeWidth = Math.max(range.max - range.min, 1);
  if (count < range.min) {
    return Math.max(0, 1 - (range.min - count) / rangeWidth);
  }
  return Math.max(0, 1 - (count - range.max) / rangeWidth);
}

function scoreCoverage(
  mustCoverTopics: string[] | undefined,
  actual: { subtasks: string[]; steps?: any[] },
): number {
  if (!mustCoverTopics || mustCoverTopics.length === 0) return 1.0;

  // Build a searchable text from all step objectives, subtask descriptions, and success criteria
  const searchText = [
    ...(actual.subtasks ?? []),
    ...(actual.steps ?? []).map((s: any) => `${s.objective ?? ""} ${s.successCriteria ?? ""}`),
  ]
    .join(" ")
    .toLowerCase();

  let found = 0;
  for (const topic of mustCoverTopics) {
    if (searchText.includes(topic.toLowerCase())) found++;
  }
  return found / mustCoverTopics.length;
}

function scoreStepQuality(steps: any[] | undefined): number {
  if (!steps || steps.length === 0) return 0.5; // No steps = partial credit

  let totalScore = 0;
  for (const step of steps) {
    let stepScore = 0;
    if (step.objective && step.objective.trim().length > 0) stepScore += 0.4;
    if (step.successCriteria && step.successCriteria.trim().length > 0) stepScore += 0.3;
    if (Array.isArray(step.dependencies)) stepScore += 0.3;
    totalScore += stepScore;
  }
  return totalScore / steps.length;
}

function scoreAntiPattern(
  actual: { subtasks: string[]; steps?: any[] },
): number {
  const antiPatterns = [
    // Site-specific heuristics
    () => {
      const text = [...actual.subtasks, ...(actual.steps ?? []).map((s: any) => s.objective ?? "")]
        .join(" ")
        .toLowerCase();
      return /specific.*selector|css.*selector|xpath|queryselector/i.test(text);
    },
    // Too many steps (>8)
    () => (actual.steps?.length ?? actual.subtasks.length) > 8,
    // Empty objectives
    () => (actual.steps ?? []).some((s: any) => !s.objective || s.objective.trim().length === 0),
  ];

  let found = 0;
  for (const check of antiPatterns) {
    if (check()) found++;
  }

  return 1.0 - found / antiPatterns.length;
}
