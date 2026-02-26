/**
 * Context compression eval scorer — pure functions, no API calls.
 *
 * Scores information preservation across 5 metrics after compression.
 */

import type { ContextEvalCase, ContextEvalResult } from "./types";

const WEIGHTS = {
  goalPreservation: 0.30,
  planPreservation: 0.20,
  toolResultPreservation: 0.20,
  keyFactPreservation: 0.15,
  tokenEfficiency: 0.15,
};

const PASS_COMPOSITE = 0.70;

export interface ContextScores {
  goalPreservation: number;
  planPreservation: number;
  toolResultPreservation: number;
  keyFactPreservation: number;
  tokenEfficiency: number;
  composite: number;
}

/**
 * Score context compression output against expected preservation requirements.
 */
export function scoreContext(
  evalCase: ContextEvalCase,
  compressedPrompt: string,
  metrics: {
    tokensBefore: number;
    tokensAfter: number;
    compressionLevel: string;
  },
): ContextScores {
  const gp = scoreGoalPreservation(evalCase.input.originalQuery, compressedPrompt);
  const pp = scorePlanPreservation(evalCase.expected.mustPreserve.planStatus, evalCase.input.planStatus, compressedPrompt);
  const tr = scoreToolResultPreservation(evalCase, compressedPrompt);
  const kf = scoreKeyFactPreservation(evalCase.expected.mustPreserve.keyFacts, compressedPrompt);
  const te = scoreTokenEfficiency(evalCase.expected, metrics);

  const composite =
    gp * WEIGHTS.goalPreservation +
    pp * WEIGHTS.planPreservation +
    tr * WEIGHTS.toolResultPreservation +
    kf * WEIGHTS.keyFactPreservation +
    te * WEIGHTS.tokenEfficiency;

  return {
    goalPreservation: gp,
    planPreservation: pp,
    toolResultPreservation: tr,
    keyFactPreservation: kf,
    tokenEfficiency: te,
    composite,
  };
}

/**
 * Determine pass/fail from scores.
 */
export function isContextPass(scores: ContextScores): boolean {
  return scores.composite >= PASS_COMPOSITE && scores.goalPreservation === 1.0;
}

// ── Metric functions ─────────────────────────────────────────────────

/**
 * Goal preservation: original query (or key 4-gram) found in compressed output.
 */
function scoreGoalPreservation(
  originalQuery: string,
  compressedPrompt: string,
): number {
  if (!originalQuery) return 1.0;

  const lower = compressedPrompt.toLowerCase();
  const queryLower = originalQuery.toLowerCase();

  // Check full query
  if (lower.includes(queryLower)) return 1.0;

  // Check key n-grams (4-grams)
  const words = queryLower.split(/\s+/).filter((w) => w.length > 2);
  if (words.length >= 4) {
    for (let i = 0; i <= words.length - 4; i++) {
      const ngram = words.slice(i, i + 4).join(" ");
      if (lower.includes(ngram)) return 1.0;
    }
  }

  // Check if majority of query words are present
  const found = words.filter((w) => lower.includes(w)).length;
  if (words.length > 0 && found / words.length >= 0.8) return 0.8;

  return 0.0;
}

/**
 * Plan preservation: plan block present when expected.
 */
function scorePlanPreservation(
  planExpected: boolean,
  planStatus: ContextEvalCase["input"]["planStatus"] | undefined,
  compressedPrompt: string,
): number {
  if (!planExpected) return 1.0;
  if (!planStatus) return 1.0;

  const lower = compressedPrompt.toLowerCase();

  // Check if any step descriptions appear in compressed output
  let found = 0;
  for (const subtask of planStatus.subtasks) {
    const desc = subtask.description.toLowerCase();
    // Check for significant substring (first 30 chars)
    const snippet = desc.slice(0, 30);
    if (lower.includes(snippet)) found++;
  }

  if (planStatus.subtasks.length === 0) return 1.0;
  return found / planStatus.subtasks.length;
}

/**
 * Tool result preservation: last N tool results preserved (substring match).
 */
function scoreToolResultPreservation(
  evalCase: ContextEvalCase,
  compressedPrompt: string,
): number {
  const expectedCount = evalCase.expected.mustPreserve.recentToolResults;
  if (expectedCount <= 0) return 1.0;

  const history = evalCase.input.history;
  const lower = compressedPrompt.toLowerCase();

  // Find the last N tool results
  const toolResults: string[] = [];
  for (let i = history.length - 1; i >= 0 && toolResults.length < expectedCount; i--) {
    const msg = history[i];
    if (msg.role === "tool" && msg.content) {
      toolResults.push(msg.content);
    }
  }

  if (toolResults.length === 0) return 1.0;

  let found = 0;
  for (const result of toolResults) {
    // Check for a significant substring (first 50 chars)
    const snippet = result.slice(0, 50).toLowerCase();
    if (snippet.length > 10 && lower.includes(snippet)) found++;
  }

  return found / toolResults.length;
}

/**
 * Key fact preservation: fraction of error patterns / key facts found.
 */
function scoreKeyFactPreservation(
  keyFacts: string[] | undefined,
  compressedPrompt: string,
): number {
  if (!keyFacts || keyFacts.length === 0) return 1.0;

  const lower = compressedPrompt.toLowerCase();
  let found = 0;
  for (const fact of keyFacts) {
    // Check first 40 chars of each fact
    const snippet = fact.slice(0, 40).toLowerCase();
    if (snippet.length > 5 && lower.includes(snippet)) found++;
  }

  return found / keyFacts.length;
}

/**
 * Token efficiency: 1.0 if reduction meets target, linear decay below.
 */
function scoreTokenEfficiency(
  expected: ContextEvalCase["expected"],
  metrics: { tokensBefore: number; tokensAfter: number; compressionLevel: string },
): number {
  if (expected.expectedLevel === "none") {
    // No compression expected — score 1.0 if minimal change
    return 1.0;
  }

  if (!expected.tokenReductionMin) return 1.0;

  const reduction = metrics.tokensBefore > 0
    ? 1 - metrics.tokensAfter / metrics.tokensBefore
    : 0;

  if (reduction >= expected.tokenReductionMin) return 1.0;

  // No compression when expected
  if (reduction <= 0) return 0.0;

  // Linear decay
  return reduction / expected.tokenReductionMin;
}
