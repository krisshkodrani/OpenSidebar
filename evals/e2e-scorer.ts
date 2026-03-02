/**
 * E2E eval scorer.
 *
 * Five scoring dimensions (all 0–1):
 * - codeDiscovery:    Did the LLM use the solution code in a tool call?
 * - toolSelection:    Set overlap of tool names vs ground truth
 * - solutionActions:  Correct input→type→submit sequence?
 * - actionEfficiency: Ratio of useful vs wasted actions
 * - elementTargeting: Correct element IDs targeted?
 */

import type { E2EGoldenCase } from "./e2e-types";

export interface E2EScores {
  codeDiscovery: number;
  toolSelection: number;
  solutionActions: number;
  actionEfficiency: number;
  elementTargeting: number;
  composite: number;
}

const WEIGHTS = {
  codeDiscovery: 0.30,
  solutionActions: 0.25,
  toolSelection: 0.20,
  elementTargeting: 0.15,
  actionEfficiency: 0.10,
};

const PASS_THRESHOLD = 0.60;

/**
 * Score a set of actual tool calls against a golden case.
 */
export function scoreE2E(
  goldenCase: E2EGoldenCase,
  actualToolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
): E2EScores {
  const codeDiscovery = scoreCodeDiscovery(goldenCase, actualToolCalls);
  const toolSelection = scoreToolSelection(goldenCase, actualToolCalls);
  const solutionActions = scoreSolutionActions(goldenCase, actualToolCalls);
  const actionEfficiency = scoreActionEfficiency(goldenCase, actualToolCalls);
  const elementTargeting = scoreElementTargeting(goldenCase, actualToolCalls);

  const composite =
    WEIGHTS.codeDiscovery * codeDiscovery +
    WEIGHTS.solutionActions * solutionActions +
    WEIGHTS.toolSelection * toolSelection +
    WEIGHTS.elementTargeting * elementTargeting +
    WEIGHTS.actionEfficiency * actionEfficiency;

  return { codeDiscovery, toolSelection, solutionActions, actionEfficiency, elementTargeting, composite };
}

export function isPass(scores: E2EScores): boolean {
  return scores.composite >= PASS_THRESHOLD;
}

/**
 * Does any tool call contain the solution code string in its args?
 * (e.g., type_text with text: "W28XN2")
 */
function scoreCodeDiscovery(
  goldenCase: E2EGoldenCase,
  actualToolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
): number {
  const code = goldenCase.solution.code;
  for (const tc of actualToolCalls) {
    for (const val of Object.values(tc.args)) {
      if (typeof val === "string" && val.includes(code)) return 1.0;
    }
  }
  return 0.0;
}

/**
 * Set overlap of tool names used vs ground truth action sequence tool names.
 */
function scoreToolSelection(
  goldenCase: E2EGoldenCase,
  actualToolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
): number {
  const expectedNames = new Set(goldenCase.actions.sequence.map((a) => a.tool));
  if (expectedNames.size === 0) return 1.0;

  const actualNames = new Set(actualToolCalls.map((tc) => tc.toolName));
  let matches = 0;
  for (const name of expectedNames) {
    if (actualNames.has(name)) matches++;
  }
  return matches / expectedNames.size;
}

/**
 * Does the response include the critical 3-step sequence:
 * (1) target code input element, (2) type the code, (3) click submit?
 * Partial credit for 1/3 or 2/3.
 */
function scoreSolutionActions(
  goldenCase: E2EGoldenCase,
  actualToolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
): number {
  const { code, codeInputId, submitButtonId } = goldenCase.solution;
  let steps = 0;

  // Step 1: Any action targets the code input element
  const targetsCodeInput = actualToolCalls.some(
    (tc) => Number(tc.args.id) === codeInputId,
  );
  if (targetsCodeInput) steps++;

  // Step 2: type_text with the correct code
  const typesCode = actualToolCalls.some(
    (tc) =>
      tc.toolName === "type_text" &&
      typeof tc.args.text === "string" &&
      tc.args.text.includes(code),
  );
  if (typesCode) steps++;

  // Step 3: click_element on the submit button
  const clicksSubmit = actualToolCalls.some(
    (tc) =>
      tc.toolName === "click_element" &&
      Number(tc.args.id) === submitButtonId,
  );
  if (clicksSubmit) steps++;

  return steps / 3;
}

/**
 * Penalizes both too few and too many actions.
 * min(groundTruth, actual) / max(groundTruth, actual)
 */
function scoreActionEfficiency(
  goldenCase: E2EGoldenCase,
  actualToolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
): number {
  const expected = goldenCase.actions.total;
  const actual = actualToolCalls.length;
  if (expected === 0 && actual === 0) return 1.0;
  if (expected === 0 || actual === 0) return 0.0;
  return Math.min(expected, actual) / Math.max(expected, actual);
}

/**
 * For click_element/type_text calls: do the targeted id values match
 * the solution's codeInputId/submitButtonId?
 */
function scoreElementTargeting(
  goldenCase: E2EGoldenCase,
  actualToolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
): number {
  const { codeInputId, submitButtonId } = goldenCase.solution;
  const criticalIds = new Set([codeInputId, submitButtonId]);

  // Only look at tool calls that target critical elements
  const targetingCalls = actualToolCalls.filter(
    (tc) =>
      (tc.toolName === "click_element" || tc.toolName === "type_text") &&
      tc.args.id !== undefined,
  );

  if (targetingCalls.length === 0) return 0.0;

  // Check if any call targets the code input and any targets the submit button
  let hits = 0;
  const targetsInput = targetingCalls.some((tc) => Number(tc.args.id) === codeInputId);
  const targetsSubmit = targetingCalls.some((tc) => Number(tc.args.id) === submitButtonId);
  if (targetsInput) hits++;
  if (targetsSubmit) hits++;

  return hits / criticalIds.size;
}
