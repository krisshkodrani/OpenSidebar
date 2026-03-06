/**
 * Context-efficiency eval scorer.
 *
 * 5 dimensions measuring whether optimizations preserve agent quality:
 * - behaviorPreservation (0.35): agent picks the correct tool
 * - tokenReduction       (0.25): measured token savings vs baseline
 * - planAwareness        (0.20): agent references active plan step
 * - timeAwareness        (0.10): agent shows appropriate urgency
 * - noRegression         (0.10): no trap actions triggered
 */

import type {
  ContextEfficiencyGoldenCase,
  ContextEfficiencyScores,
} from "./context-efficiency-types";

const WEIGHTS = {
  behaviorPreservation: 0.35,
  tokenReduction: 0.25,
  planAwareness: 0.20,
  timeAwareness: 0.10,
  noRegression: 0.10,
};

const PASS_THRESHOLD = 0.60;

/**
 * Score a context-efficiency eval case given the LLM response.
 */
export function scoreContextEfficiency(
  goldenCase: ContextEfficiencyGoldenCase,
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  text: string | null,
  tokenMetrics?: { systemPromptTokens: number; historyTokens: number; totalInputTokens: number },
): ContextEfficiencyScores {
  const expected = goldenCase.expected;

  const behaviorPreservation = scoreBehavior(toolCalls, expected);
  const tokenReduction = scoreTokenReduction(goldenCase, tokenMetrics);
  const planAwareness = scorePlanAwareness(goldenCase, text, toolCalls);
  const timeAwareness = scoreTimeAwareness(goldenCase, text, toolCalls);
  const noRegression = scoreTrapAvoidance(toolCalls, expected.trapActions);

  const composite =
    WEIGHTS.behaviorPreservation * behaviorPreservation +
    WEIGHTS.tokenReduction * tokenReduction +
    WEIGHTS.planAwareness * planAwareness +
    WEIGHTS.timeAwareness * timeAwareness +
    WEIGHTS.noRegression * noRegression;

  return {
    behaviorPreservation,
    tokenReduction,
    planAwareness,
    timeAwareness,
    noRegression,
    composite,
  };
}

export function isContextEfficiencyPass(scores: ContextEfficiencyScores): boolean {
  return scores.composite >= PASS_THRESHOLD;
}

// ── Dimension scorers ────────────────────────────────────────────────

function scoreBehavior(
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  expected: ContextEfficiencyGoldenCase["expected"],
): number {
  if (toolCalls.length === 0) return 0.0;

  const firstTool = toolCalls[0].toolName;
  const acceptable = new Set([
    expected.expectedTool,
    ...(expected.acceptAlternatives ?? []),
  ]);

  if (!acceptable.has(firstTool)) return 0.0;

  // If expected args specified, check overlap
  if (expected.expectedArgs && Object.keys(expected.expectedArgs).length > 0) {
    const overlap = scoreArgOverlap(expected.expectedArgs, toolCalls[0].args);
    return 0.5 + 0.5 * overlap; // 0.5 for correct tool + 0.5 for correct args
  }

  return 1.0;
}

function scoreTokenReduction(
  goldenCase: ContextEfficiencyGoldenCase,
  tokenMetrics?: { systemPromptTokens: number; historyTokens: number; totalInputTokens: number },
): number {
  // If no metrics available, neutral score
  if (!tokenMetrics) return 0.5;

  const baseline = goldenCase.metadata.baselineTokenEstimate;
  if (!baseline || baseline === 0) return 0.5;

  // Score based on how much we reduced
  const reduction = 1 - tokenMetrics.totalInputTokens / baseline;
  // Clamp to [0, 1] — negative means we increased tokens (bad)
  return Math.max(0, Math.min(1, reduction * 2)); // 50% reduction = perfect score
}

function scorePlanAwareness(
  goldenCase: ContextEfficiencyGoldenCase,
  text: string | null,
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
): number {
  // If plan awareness not tested, full credit
  if (!goldenCase.expected.shouldReferencePlan) return 1.0;
  if (!goldenCase.planStatus) return 1.0;

  const currentStep = goldenCase.planStatus.subtasks[goldenCase.planStatus.currentIndex];
  if (!currentStep) return 0.5;

  // Check if agent text or tool args reference the current plan step
  const stepDesc = currentStep.description.toLowerCase();
  const stepWords = stepDesc.split(/\s+/).filter((w) => w.length > 3);

  // Check text
  if (text) {
    const lowerText = text.toLowerCase();
    const wordMatches = stepWords.filter((w) => lowerText.includes(w)).length;
    if (wordMatches >= 2 || lowerText.includes("step") || lowerText.includes("plan")) {
      return 1.0;
    }
  }

  // Check if the tool call is aligned with the plan step
  if (toolCalls.length > 0) {
    const toolName = toolCalls[0].toolName;
    // If the expected tool matches, partial credit — agent is doing the right thing
    const acceptable = new Set([
      goldenCase.expected.expectedTool,
      ...(goldenCase.expected.acceptAlternatives ?? []),
    ]);
    if (acceptable.has(toolName)) return 0.7;
  }

  return 0.0;
}

function scoreTimeAwareness(
  goldenCase: ContextEfficiencyGoldenCase,
  text: string | null,
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
): number {
  // If time awareness not tested, full credit
  if (!goldenCase.expected.expectedUrgency) return 1.0;
  if (!goldenCase.turnContext) return 1.0;

  const urgency = goldenCase.expected.expectedUrgency;
  const firstTool = toolCalls[0]?.toolName;

  if (urgency === "escalate") {
    // Agent should call escalate or done
    if (firstTool === "escalate" || firstTool === "done") return 1.0;
    // Check text for urgency signals
    if (text?.toLowerCase().match(/stuck|escalat|give.?up|too many turns/)) return 0.5;
    return 0.0;
  }

  if (urgency === "patient") {
    // Agent should NOT escalate early
    if (firstTool === "escalate") return 0.0;
    return 1.0;
  }

  // "normal" — any tool except premature escalation is fine
  return firstTool === "escalate" ? 0.3 : 1.0;
}

function scoreTrapAvoidance(
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  trapActions?: string[],
): number {
  if (!trapActions || trapActions.length === 0) return 1.0;
  const trapSet = new Set(trapActions);
  const hitsTrap = toolCalls.some((tc) => trapSet.has(tc.toolName));
  return hitsTrap ? 0.0 : 1.0;
}

/** Parameter overlap scoring (shared pattern from other scorers) */
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
      if (Math.abs(ev - av) <= Math.max(Math.abs(ev) * 0.2, 50)) matches++;
    } else if (JSON.stringify(ev) === JSON.stringify(av)) {
      matches++;
    }
  }

  return matches / allKeys.length;
}
