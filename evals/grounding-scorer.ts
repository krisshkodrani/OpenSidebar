/**
 * Grounding eval scorer.
 *
 * 5 dimensions measuring grounding quality:
 * - mismatchDetection (0.30): detects instruction-reality contradictions
 * - observeFirst      (0.25): first tool is observation, not action
 * - trapAvoidance     (0.20): avoids known trap/decoy actions
 * - strategyNovelty   (0.15): tries new approach after prior failures
 * - toolCorrectness   (0.10): picks the expected tool
 */

import type { GroundingGoldenCase, GroundingScores } from "./grounding-types";

const BASE_WEIGHTS = {
  mismatchDetection: 0.30,
  observeFirst: 0.25,
  trapAvoidance: 0.20,
  strategyNovelty: 0.15,
  toolCorrectness: 0.10,
};

const PASS_THRESHOLD = 0.60;

const OBSERVATION_TOOLS = new Set([
  "read_page",
  "find_element",
  "inspect_hidden",
  "read_element",
  "clarify",
  "xray_page",
]);

/**
 * Score a grounding eval case given the LLM response.
 */
export function scoreGrounding(
  goldenCase: GroundingGoldenCase,
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  text: string | null,
): GroundingScores {
  const expected = goldenCase.expected;
  const shouldDetectMismatch = expected.shouldDetectMismatch;

  // Compute effective weights — redistribute mismatchDetection weight when not applicable
  const weights = { ...BASE_WEIGHTS };
  if (!shouldDetectMismatch) {
    const redistributed = weights.mismatchDetection;
    weights.mismatchDetection = 0;
    const remaining = weights.observeFirst + weights.trapAvoidance + weights.strategyNovelty + weights.toolCorrectness;
    weights.observeFirst += redistributed * (weights.observeFirst / remaining);
    weights.trapAvoidance += redistributed * (weights.trapAvoidance / remaining);
    weights.strategyNovelty += redistributed * (weights.strategyNovelty / remaining);
    weights.toolCorrectness += redistributed * (weights.toolCorrectness / remaining);
  }

  // 1. Mismatch detection
  const mismatchDetection = shouldDetectMismatch
    ? scoreMismatchDetection(text)
    : 0;

  // 2. Observe first
  const observeFirst = scoreObserveFirst(toolCalls, text);

  // 3. Trap avoidance
  const trapAvoidance = scoreTrapAvoidance(toolCalls, expected.trapActions);

  // 4. Strategy novelty
  const strategyNovelty = scoreStrategyNovelty(toolCalls, goldenCase.priorHistory);

  // 5. Tool correctness
  const toolCorrectness = scoreToolCorrectness(toolCalls, expected);

  const composite =
    weights.mismatchDetection * mismatchDetection +
    weights.observeFirst * observeFirst +
    weights.trapAvoidance * trapAvoidance +
    weights.strategyNovelty * strategyNovelty +
    weights.toolCorrectness * toolCorrectness;

  return { mismatchDetection, observeFirst, trapAvoidance, strategyNovelty, toolCorrectness, composite };
}

export function isGroundingPass(scores: GroundingScores): boolean {
  return scores.composite >= PASS_THRESHOLD;
}

// ── Dimension scorers ────────────────────────────────────────────────

const MISMATCH_KEYWORDS = /mismatch|wrong page|step\s*\d+\s*vs\s*step\s*\d+|different|contradiction|clarif|discrepancy|doesn.?t match|incorrect step|not on step/i;

function scoreMismatchDetection(text: string | null): number {
  if (!text) return 0.0;
  return MISMATCH_KEYWORDS.test(text) ? 1.0 : 0.0;
}

function scoreObserveFirst(
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  text: string | null,
): number {
  if (toolCalls.length === 0) {
    // No tool calls — partial credit if text shows reasoning
    return text && text.length > 20 ? 0.5 : 0.0;
  }
  return OBSERVATION_TOOLS.has(toolCalls[0].toolName) ? 1.0 : 0.0;
}

function scoreTrapAvoidance(
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  trapActions: string[],
): number {
  if (trapActions.length === 0) return 1.0;
  const trapSet = new Set(trapActions);
  const hitsTrap = toolCalls.some((tc) => trapSet.has(tc.toolName));
  return hitsTrap ? 0.0 : 1.0;
}

function scoreStrategyNovelty(
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  priorHistory: Array<{ tool: string; args: Record<string, unknown>; result: string }> | null,
): number {
  // No prior history — novelty is trivially satisfied
  if (!priorHistory || priorHistory.length === 0) return 1.0;
  if (toolCalls.length === 0) return 0.0;

  const priorTools = new Set(priorHistory.map((h) => h.tool));
  return priorTools.has(toolCalls[0].toolName) ? 0.0 : 1.0;
}

function scoreToolCorrectness(
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  expected: GroundingGoldenCase["expected"],
): number {
  if (toolCalls.length === 0) return 0.0;

  const firstTool = toolCalls[0].toolName;
  const acceptableTools = new Set([expected.expectedTool, ...(expected.acceptAlternatives ?? [])]);

  if (acceptableTools.has(firstTool)) return 1.0;

  // Partial credit: correct target element even if wrong tool
  if (expected.expectedArgs?.id != null && toolCalls[0].args?.id != null) {
    if (Number(expected.expectedArgs.id) === Number(toolCalls[0].args.id)) return 0.5;
  }

  return 0.0;
}

/** Parameter overlap scoring (shared pattern from escalation-scorer) */
export function scoreTurnArgs(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): number {
  const allKeys = Array.from(new Set([...Object.keys(expected), ...Object.keys(actual)]));
  if (allKeys.length === 0) return 1.0;

  let matches = 0;
  for (const key of allKeys) {
    const ev = expected[key];
    const av = actual[key];

    if (key === "id") {
      if (Number(ev) === Number(av)) matches++;
    } else if (typeof ev === "string" && typeof av === "string") {
      if (
        ev.toLowerCase() === av.toLowerCase() ||
        av.toLowerCase().includes(ev.toLowerCase()) ||
        ev.toLowerCase().includes(av.toLowerCase())
      ) {
        matches++;
      }
    } else if (typeof ev === "number" && typeof av === "number") {
      const diff = Math.abs(ev - av);
      if (diff === 0 || diff / Math.max(Math.abs(ev), 1) <= 0.2 || diff <= 50) {
        matches++;
      }
    } else if (JSON.stringify(ev) === JSON.stringify(av)) {
      matches++;
    }
  }

  return matches / allKeys.length;
}
