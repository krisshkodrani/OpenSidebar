/**
 * Tool-confusion eval scorer.
 *
 * 4 dimensions measuring tool discrimination quality:
 * - correctToolPicked    (0.40): chose the right tool for the scenario
 * - avoidedAntiPattern   (0.30): avoided the confusable wrong tool
 * - parameterCorrectness (0.15): correct args for the chosen tool
 * - reasoningQuality     (0.15): quality of reasoning (from judge, defaults to 0.5)
 */

import type { ToolConfusionGoldenCase, ToolConfusionScores } from "./tool-confusion-types";

const WEIGHTS = {
  correctToolPicked: 0.40,
  avoidedAntiPattern: 0.30,
  parameterCorrectness: 0.15,
  reasoningQuality: 0.15,
};

const PASS_THRESHOLD = 0.65;

/**
 * Score a tool-confusion eval case given the LLM response.
 */
export function scoreToolConfusion(
  goldenCase: ToolConfusionGoldenCase,
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  _text: string | null,
  reasoningScore?: number,
): ToolConfusionScores {
  const expected = goldenCase.expected;

  const correctToolPicked = scoreCorrectTool(toolCalls, expected);
  const avoidedAntiPattern = scoreAntiPatternAvoidance(toolCalls, expected.antiPatternTools);
  const parameterCorrectness = scoreParameters(toolCalls, expected);
  const reasoningQuality = reasoningScore ?? 0.5;

  const composite =
    WEIGHTS.correctToolPicked * correctToolPicked +
    WEIGHTS.avoidedAntiPattern * avoidedAntiPattern +
    WEIGHTS.parameterCorrectness * parameterCorrectness +
    WEIGHTS.reasoningQuality * reasoningQuality;

  return { correctToolPicked, avoidedAntiPattern, parameterCorrectness, reasoningQuality, composite };
}

export function isToolConfusionPass(scores: ToolConfusionScores): boolean {
  return scores.composite >= PASS_THRESHOLD;
}

// ── Dimension scorers ────────────────────────────────────────────────

function scoreCorrectTool(
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  expected: ToolConfusionGoldenCase["expected"],
): number {
  if (toolCalls.length === 0) return 0.0;

  const firstTool = toolCalls[0].toolName;
  const acceptableTools = new Set([
    expected.correctTool,
    ...(expected.acceptAlternatives ?? []),
  ]);

  return acceptableTools.has(firstTool) ? 1.0 : 0.0;
}

function scoreAntiPatternAvoidance(
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  antiPatternTools: string[],
): number {
  if (antiPatternTools.length === 0) return 1.0;
  const antiSet = new Set(antiPatternTools);
  const hitsAntiPattern = toolCalls.some((tc) => antiSet.has(tc.toolName));
  return hitsAntiPattern ? 0.0 : 1.0;
}

function scoreParameters(
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  expected: ToolConfusionGoldenCase["expected"],
): number {
  if (toolCalls.length === 0) return 0.0;
  if (!expected.correctArgs || Object.keys(expected.correctArgs).length === 0) {
    // No expected args specified — full credit if correct tool was picked
    const acceptableTools = new Set([
      expected.correctTool,
      ...(expected.acceptAlternatives ?? []),
    ]);
    return acceptableTools.has(toolCalls[0].toolName) ? 1.0 : 0.0;
  }

  return scoreArgOverlap(expected.correctArgs, toolCalls[0].args);
}

/** Parameter overlap scoring (shared pattern) */
function scoreArgOverlap(
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

// ── Confusion matrix builder ─────────────────────────────────────────

export interface ConfusionMatrixEntry {
  pair: string;
  toolA: string;
  toolB: string;
  total: number;
  correctToolRate: number;
  antiPatternRate: number;
  avgComposite: number;
}

/**
 * Build a per-pair confusion matrix from eval results.
 */
export function buildConfusionMatrix(
  cases: ToolConfusionGoldenCase[],
  results: Array<{ caseId: string; scores: ToolConfusionScores }>,
): ConfusionMatrixEntry[] {
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const buckets = new Map<string, {
    toolA: string;
    toolB: string;
    total: number;
    correctCount: number;
    antiPatternCount: number;
    compSum: number;
  }>();

  for (const r of results) {
    const gc = caseById.get(r.caseId);
    if (!gc) continue;

    const pair = gc.confusionPair.label;
    let b = buckets.get(pair);
    if (!b) {
      b = {
        toolA: gc.confusionPair.toolA,
        toolB: gc.confusionPair.toolB,
        total: 0,
        correctCount: 0,
        antiPatternCount: 0,
        compSum: 0,
      };
      buckets.set(pair, b);
    }

    b.total++;
    if (r.scores.correctToolPicked === 1.0) b.correctCount++;
    if (r.scores.avoidedAntiPattern === 0.0) b.antiPatternCount++;
    b.compSum += r.scores.composite;
  }

  return Array.from(buckets.entries()).map(([pair, b]) => ({
    pair,
    toolA: b.toolA,
    toolB: b.toolB,
    total: b.total,
    correctToolRate: b.total > 0 ? b.correctCount / b.total : 0,
    antiPatternRate: b.total > 0 ? b.antiPatternCount / b.total : 0,
    avgComposite: b.total > 0 ? b.compSum / b.total : 0,
  }));
}
