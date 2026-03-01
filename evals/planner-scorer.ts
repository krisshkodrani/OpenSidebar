/**
 * Planner eval scorer — pure functions, no API calls.
 *
 * Scores planner output across 5 metrics for decompose,
 * and binary match for validateDone.
 */

import type { PlannerEvalCase, PlannerEvalResult, StepAnnotation, TerminationExpectations } from "./types";

const WEIGHTS_LEGACY = {
  difficultyAccuracy: 0.20,
  stepCountScore: 0.15,
  coverageScore: 0.30,
  stepQualityScore: 0.20,
  antiPatternScore: 0.15,
};

const WEIGHTS_EXTENDED = {
  difficultyAccuracy: 0.15,
  stepCountScore: 0.12,
  coverageScore: 0.25,
  stepQualityScore: 0.15,
  antiPatternScore: 0.13,
  stepProgressScore: 0.10,
  terminationScore: 0.10,
};

const PASS_COMPOSITE = 0.60;

const DIFFICULTY_ORDER: string[] = ["simple", "moderate", "complex", "extreme"];

export interface PlannerScores {
  difficultyAccuracy: number;
  stepCountScore: number;
  coverageScore: number;
  stepQualityScore: number;
  antiPatternScore: number;
  stepProgressScore: number;
  terminationScore: number;
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
  const ap = scoreAntiPattern(actual, evalCase.expected);
  const sp = scoreStepProgress(evalCase.expected.stepAnnotations, actual.steps);
  const tm = scoreTermination(evalCase.expected.terminationExpectations, actual.steps);

  const hasExtended = !!(evalCase.expected.stepAnnotations || evalCase.expected.terminationExpectations);
  const w = hasExtended ? WEIGHTS_EXTENDED : WEIGHTS_LEGACY;

  let composite: number;
  if (hasExtended) {
    composite =
      da * w.difficultyAccuracy +
      sc * w.stepCountScore +
      cv * w.coverageScore +
      sq * w.stepQualityScore +
      ap * w.antiPatternScore +
      sp * (w as typeof WEIGHTS_EXTENDED).stepProgressScore +
      tm * (w as typeof WEIGHTS_EXTENDED).terminationScore;
  } else {
    composite =
      da * w.difficultyAccuracy +
      sc * w.stepCountScore +
      cv * w.coverageScore +
      sq * w.stepQualityScore +
      ap * w.antiPatternScore;
  }

  return {
    difficultyAccuracy: da,
    stepCountScore: sc,
    coverageScore: cv,
    stepQualityScore: sq,
    antiPatternScore: ap,
    stepProgressScore: sp,
    terminationScore: tm,
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
    stepProgressScore: match,
    terminationScore: match,
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

/**
 * Evaluate each step against golden StepAnnotation[].
 * Returns 1.0 when no annotations present (no penalty for unannotated cases).
 */
function scoreStepProgress(
  annotations: StepAnnotation[] | undefined,
  steps: any[] | undefined,
): number {
  if (!annotations || annotations.length === 0) return 1.0;
  if (!steps || steps.length === 0) return 0.0;

  let totalScore = 0;
  let evaluated = 0;

  for (const ann of annotations) {
    const step = steps[ann.index];
    if (!step) continue;
    evaluated++;

    let stepScore = 0;
    const checks = 4;

    // 1. Objective clarity
    const objLen = (step.objective ?? "").trim().length;
    if (ann.objectiveClarity === "high") {
      stepScore += objLen > 10 ? 1 : objLen > 0 ? 0.5 : 0;
    } else if (ann.objectiveClarity === "medium") {
      stepScore += objLen > 0 ? 1 : 0;
    } else {
      stepScore += 1; // low expectation = always pass
    }

    // 2. Criteria specificity
    const critLen = (step.successCriteria ?? "").trim().length;
    if (ann.criteriaSpecificity === "high") {
      stepScore += critLen > 10 ? 1 : critLen > 0 ? 0.5 : 0;
    } else if (ann.criteriaSpecificity === "medium") {
      stepScore += critLen > 0 ? 1 : 0;
    } else {
      stepScore += 1;
    }

    // 3. Dependencies correct
    if (ann.dependenciesCorrect) {
      stepScore += Array.isArray(step.dependencies) ? 1 : 0;
    } else {
      stepScore += 1; // no dependency expectation = pass
    }

    // 4. Verification gate
    if (ann.requiresVerificationGate) {
      if (step.verifyAfter) {
        const actionMatch = !ann.expectedGateAction || step.verifyAfter.action === ann.expectedGateAction;
        stepScore += actionMatch ? 1 : 0.5;
      } else {
        stepScore += 0;
      }
    } else {
      stepScore += 1;
    }

    totalScore += stepScore / checks;
  }

  return evaluated > 0 ? totalScore / evaluated : 0.0;
}

/**
 * Evaluate termination signal quality against TerminationExpectations.
 * Returns 1.0 when no expectations present.
 */
function scoreTermination(
  expectations: TerminationExpectations | undefined,
  steps: any[] | undefined,
): number {
  if (!expectations) return 1.0;
  if (!steps || steps.length === 0) return 0.0;

  let score = 0;
  let checks = 0;

  // 1. Last step has call_done
  if (expectations.lastStepCallsDone) {
    checks++;
    const lastStep = steps[steps.length - 1];
    if (lastStep?.verifyAfter?.action === "call_done") score++;
  }

  // 2. Minimum N steps have verification gates
  if (expectations.minVerificationGates > 0) {
    checks++;
    const gateCount = steps.filter((s: any) => s.verifyAfter).length;
    if (gateCount >= expectations.minVerificationGates) {
      score++;
    } else {
      score += gateCount / expectations.minVerificationGates;
    }
  }

  // 3. All steps have gates
  if (expectations.allStepsHaveGates) {
    checks++;
    const gateCount = steps.filter((s: any) => s.verifyAfter).length;
    score += gateCount / steps.length;
  }

  // 4. Respects user stop condition (no overshoot)
  if (expectations.respectsUserStopCondition === true && expectations.pattern) {
    checks++;
    const allText = steps.map((s: any) =>
      `${s.objective ?? ""} ${s.successCriteria ?? ""}`.toLowerCase()
    ).join(" ");
    const hasOvershoot = allText.includes(expectations.pattern.toLowerCase());
    score += hasOvershoot ? 0 : 1;
  }

  return checks > 0 ? score / checks : 1.0;
}

// Known agent tool names — plans should only reference these
const KNOWN_TOOLS = new Set([
  "click", "type", "scroll", "hover", "select", "press_key", "drag_and_drop",
  "draw_stroke", "hide_element", "find_element", "navigate_to", "go_back",
  "go_forward", "create_tab", "close_tab", "switch_tab", "inspect_hidden",
  "xray_page", "execute_js", "read_element", "read_page",
  "get_cookies", "search_history", "get_bookmarks", "transcribe_audio",
  "inspect_react", "react_set_input", "inspect_react_tree", "wait_for_react",
  "done", "escalate", "update_plan", "fast_forward",
]);

function scoreAntiPattern(
  actual: { subtasks: string[]; steps?: any[] },
  expected?: { maxSteps?: number; forbiddenToolRefs?: string[] },
): number {
  const allText = [
    ...actual.subtasks,
    ...(actual.steps ?? []).map((s: any) => `${s.objective ?? ""} ${s.successCriteria ?? ""} ${s.toolProfile ?? ""}`),
  ].join(" ");
  const textLower = allText.toLowerCase();

  const antiPatterns = [
    // Site-specific heuristics (CSS selectors, XPath, querySelector)
    () => /specific.*selector|css.*selector|xpath|queryselector/i.test(allText),
    // Too many steps (>8 hard cap)
    () => (actual.steps?.length ?? actual.subtasks.length) > 8,
    // Empty objectives
    () => (actual.steps ?? []).some((s: any) => !s.objective || s.objective.trim().length === 0),
    // Bloat: exceeds maxSteps when specified (length_bias detection)
    () => {
      if (!expected?.maxSteps) return false;
      return (actual.steps?.length ?? actual.subtasks.length) > expected.maxSteps;
    },
    // Phantom tool references: mentions tools that don't exist
    () => {
      if (!expected?.forbiddenToolRefs || expected.forbiddenToolRefs.length === 0) return false;
      return expected.forbiddenToolRefs.some((tool) => textLower.includes(tool.toLowerCase()));
    },
  ];

  let found = 0;
  for (const check of antiPatterns) {
    if (check()) found++;
  }

  return 1.0 - found / antiPatterns.length;
}
