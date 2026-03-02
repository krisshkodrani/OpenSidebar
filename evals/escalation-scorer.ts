/**
 * Escalation eval scorer.
 *
 * Weights:
 * - escalationTriggered (0.40): executor model calls `escalate`
 * - reasonQuality       (0.10): fuzzy match on escalation reason
 * - toolMatch           (0.30): planner model picks expected tool or alternative
 * - argsMatch           (0.10): parameter overlap
 * - investigationQuality(0.10): investigation tool vs repeating failed action
 */

import type { EscalationGoldenCase, EscalationScores } from "./escalation-types";

const WEIGHTS = {
  escalationTriggered: 0.40,
  reasonQuality: 0.10,
  toolMatch: 0.30,
  argsMatch: 0.10,
  investigationQuality: 0.10,
};

const PASS_THRESHOLD = 0.60;

const INVESTIGATION_TOOLS = new Set([
  "inspect_hidden",
  "xray_page",
  "execute_js",
  "read_element",
  "read_page",
  "find_element",
  "dismiss_overlays",
  "hide_element",
]);

/**
 * Score an escalation eval case given executor and planner phase results.
 */
export function scoreEscalation(
  goldenCase: EscalationGoldenCase,
  fastToolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  smartToolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  fastText: string | null,
): EscalationScores {
  // Phase 1: Did executor model call escalate?
  const escalationTriggered = fastToolCalls.some((tc) => tc.toolName === "escalate") ? 1.0 : 0.0;

  // Phase 1: Reason quality — fuzzy match on escalation reason text
  const reasonQuality = scoreReasonQuality(fastToolCalls, fastText);

  // Phase 2: Tool match — expected or alternative
  const expected = goldenCase.expectedSmartAction;
  const actualTool = smartToolCalls[0]?.toolName ?? null;
  const acceptableTools = new Set([expected.toolName, ...(expected.acceptAlternatives ?? [])]);
  const toolMatch = actualTool && acceptableTools.has(actualTool) ? 1.0 : 0.0;

  // Phase 2: Args match
  const argsMatch = toolMatch > 0 && expected.args
    ? scoreTurnArgs(expected.args, smartToolCalls[0]?.args ?? {})
    : toolMatch > 0 ? 1.0 : 0.0;

  // Phase 2: Investigation quality — does the planner model investigate vs repeat?
  const failedTools = new Set(goldenCase.fastPhase.stagnantHistory.map((h) => h.tool));
  const investigationQuality = scoreInvestigation(smartToolCalls, failedTools);

  const composite =
    WEIGHTS.escalationTriggered * escalationTriggered +
    WEIGHTS.reasonQuality * reasonQuality +
    WEIGHTS.toolMatch * toolMatch +
    WEIGHTS.argsMatch * argsMatch +
    WEIGHTS.investigationQuality * investigationQuality;

  return { escalationTriggered, reasonQuality, toolMatch, argsMatch, investigationQuality, composite };
}

export function isEscalationPass(scores: EscalationScores): boolean {
  return scores.composite >= PASS_THRESHOLD;
}

/** Score the reason quality from the escalate tool call's reason arg */
function scoreReasonQuality(
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  text: string | null,
): number {
  const escalateCall = toolCalls.find((tc) => tc.toolName === "escalate");
  const reason = escalateCall?.args?.reason;
  if (typeof reason === "string" && reason.length > 10) return 1.0;
  // Partial credit if escalation happened but reason is weak
  if (escalateCall) return 0.5;
  // Check if text mentions being stuck
  if (text && /stuck|fail|unable|can.?t|not working/i.test(text)) return 0.3;
  return 0.0;
}

/** Score whether the planner model uses investigation tools vs repeating failures */
function scoreInvestigation(
  smartToolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  failedTools: Set<string>,
): number {
  if (smartToolCalls.length === 0) return 0.0;
  const firstTool = smartToolCalls[0].toolName;
  // Best: uses an investigation tool
  if (INVESTIGATION_TOOLS.has(firstTool)) return 1.0;
  // Worst: repeats a previously failed tool
  if (failedTools.has(firstTool)) return 0.0;
  // Middle: different tool but not investigation
  return 0.5;
}

/** Parameter overlap scoring (reused pattern from e2e-multiturn-runner) */
function scoreTurnArgs(
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
