/**
 * Completion-timing eval scorer.
 *
 * Weights:
 * - decisionCorrect   (0.50): model calls done() when expected, or continues when expected
 * - summaryQuality    (0.20): for done cases, summary cites evidence; for continue, 1.0 (N/A)
 * - nextActionQuality (0.20): for continue cases, picks productive next tool; for done, 1.0 (N/A)
 * - perceptionUsage   (0.10): model references perception / page state
 */

import type { CompletionTimingGoldenCase, CompletionTimingScores } from "./completion-timing-types";

const WEIGHTS = {
  decisionCorrect: 0.50,
  summaryQuality: 0.20,
  nextActionQuality: 0.20,
  perceptionUsage: 0.10,
};

const PASS_THRESHOLD = 0.60;

/**
 * Detect if the model emitted done() as bare JSON in text instead of via tool_calls.
 * Models sometimes output `{ "summary": "..." }` as text rather than calling the
 * done() tool through the structured API.
 */
function detectBareDoneInText(text: string | null): { summary: string } | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text.trim());
    if (typeof parsed === "object" && parsed !== null && typeof parsed.summary === "string") {
      return { summary: parsed.summary };
    }
  } catch { /* not JSON */ }
  return null;
}

/**
 * Score a completion-timing eval case given model output.
 */
export function scoreCompletionTiming(
  goldenCase: CompletionTimingGoldenCase,
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  text: string | null,
): CompletionTimingScores {
  const calledDone = toolCalls.some((tc) => tc.toolName === "done");
  const bareDone = !calledDone ? detectBareDoneInText(text) : null;
  const intendedDone = calledDone || bareDone !== null;
  const expected = goldenCase.expectedAction;

  // Decision correctness — count bare-args-as-text done as a done call
  const decisionCorrect =
    (expected === "done" && intendedDone) || (expected === "continue" && !intendedDone) ? 1.0 : 0.0;

  // Summary quality (only for "done" cases)
  let summaryQuality = 1.0;
  if (expected === "done") {
    // If done was bare JSON in text, synthesize a pseudo tool call for scoring
    const effectiveToolCalls = bareDone
      ? [{ toolName: "done", args: bareDone as Record<string, unknown> }]
      : toolCalls;
    summaryQuality = scoreSummaryQuality(effectiveToolCalls, text, goldenCase.expectedSummaryKeywords ?? []);
  }

  // Next action quality (only for "continue" cases)
  let nextActionQuality = 1.0;
  if (expected === "continue") {
    nextActionQuality = scoreNextAction(toolCalls, goldenCase.expectedNextTools ?? []);
  }

  // Perception usage — does the model reference the page state?
  const perceptionUsage = scorePerceptionUsage(goldenCase, toolCalls, text);

  const composite =
    WEIGHTS.decisionCorrect * decisionCorrect +
    WEIGHTS.summaryQuality * summaryQuality +
    WEIGHTS.nextActionQuality * nextActionQuality +
    WEIGHTS.perceptionUsage * perceptionUsage;

  return { decisionCorrect, summaryQuality, nextActionQuality, perceptionUsage, composite };
}

export function isCompletionTimingPass(scores: CompletionTimingScores): boolean {
  return scores.composite >= PASS_THRESHOLD;
}

/**
 * Naive English stemmer — strips common suffixes so that
 * "confirmed", "confirmation", "confirming" all reduce to "confirm".
 */
function stem(word: string): string {
  return word
    .replace(/ation$/, "")
    .replace(/ment$/, "")
    .replace(/ness$/, "")
    .replace(/ing$/, "")
    .replace(/tion$/, "")
    .replace(/sion$/, "")
    .replace(/ous$/, "")
    .replace(/ive$/, "")
    .replace(/able$/, "")
    .replace(/ible$/, "")
    .replace(/ful$/, "")
    .replace(/less$/, "")
    .replace(/ly$/, "")
    .replace(/ed$/, "")
    .replace(/er$/, "")
    .replace(/est$/, "")
    .replace(/es$/, "")
    .replace(/s$/, "");
}

/**
 * Check if a keyword matches anywhere in the text using stem-aware matching.
 * First tries exact substring match, then falls back to stemmed word comparison.
 */
function stemMatch(text: string, keyword: string): boolean {
  const kwLower = keyword.toLowerCase();
  // Exact substring match (fast path)
  if (text.includes(kwLower)) return true;
  // Stem-aware: check if any word in the text shares a stem with the keyword
  const kwStem = stem(kwLower);
  if (kwStem.length < 3) return false; // Avoid trivially short stems
  const words = text.split(/\s+/);
  return words.some((w) => stem(w) === kwStem);
}

/** Score summary quality for "done" cases via keyword matching */
function scoreSummaryQuality(
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  text: string | null,
  expectedKeywords: string[],
): number {
  const doneCall = toolCalls.find((tc) => tc.toolName === "done");
  const summary = doneCall?.args?.summary;

  // Gather all text the model produced
  const combined = [
    typeof summary === "string" ? summary : "",
    text ?? "",
  ].join(" ").toLowerCase();

  if (!combined.trim()) return 0.0;

  if (expectedKeywords.length === 0) {
    // No keywords specified — partial credit if summary is non-trivial
    return combined.length > 20 ? 0.8 : 0.3;
  }

  let matches = 0;
  for (const kw of expectedKeywords) {
    if (stemMatch(combined, kw)) matches++;
  }

  return matches / expectedKeywords.length;
}

/** Score next action quality for "continue" cases */
function scoreNextAction(
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  expectedNextTools: string[],
): number {
  if (toolCalls.length === 0) return 0.0;

  const firstTool = toolCalls[0].toolName;

  // If done was called when it shouldn't have been, 0.0
  if (firstTool === "done") return 0.0;

  if (expectedNextTools.length === 0) {
    // No specific tools expected — any non-done tool is acceptable
    return 0.8;
  }

  const acceptable = new Set(expectedNextTools);
  if (acceptable.has(firstTool)) return 1.0;

  // Partial credit for any productive tool
  return 0.3;
}

/**
 * Score whether the model demonstrates awareness of the page state.
 *
 * For "done" cases: checks if summary text references perception keywords.
 * For "continue" cases: if the model picks a tool that targets an element
 * mentioned in the perception, that counts — the model doesn't need to
 * produce free text echoing the perception to prove it read it.
 */
function scorePerceptionUsage(
  goldenCase: CompletionTimingGoldenCase,
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  text: string | null,
): number {
  const perception = goldenCase.perception;

  // Extract distinctive words from perception for keyword matching
  const perceptionWords = perception
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 5);
  const distinctWords = perceptionWords.slice(0, 20);

  // Gather all text from the model's output (including done summary)
  const doneCall = toolCalls.find((tc) => tc.toolName === "done");
  const summary = typeof doneCall?.args?.summary === "string" ? doneCall.args.summary : "";
  const combined = [summary, text ?? ""].join(" ").toLowerCase();

  // Text-based keyword matching
  if (combined.trim() && distinctWords.length > 0) {
    let matches = 0;
    for (const word of distinctWords) {
      if (combined.includes(word)) matches++;
    }
    const ratio = matches / distinctWords.length;
    if (ratio >= 0.3) return 1.0;
    if (ratio >= 0.1) return 0.5;
  }

  // For "continue" cases: picking the right tool targeting page elements
  // is itself evidence of perception usage — the model read the page state
  // and acted on it, even if it didn't produce free text about it.
  if (goldenCase.expectedAction === "continue" && toolCalls.length > 0) {
    const firstTool = toolCalls[0].toolName;
    if (firstTool !== "done") {
      // Check if the tool targets an element ID that exists in the golden elements
      const targetId = toolCalls[0].args?.id;
      if (targetId != null) {
        const elementExists = goldenCase.elements.some((el) => el.tag === Number(targetId));
        if (elementExists) return 1.0;
      }
      // Even without a matching element ID, picking a productive tool
      // shows the model understood the page state
      return 0.5;
    }
  }

  return 0.0;
}
