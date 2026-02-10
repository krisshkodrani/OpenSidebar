/**
 * Metrics Calculation
 *
 * Calculates various evaluation metrics for comparing expected vs actual results.
 */

import type {
  ExpectedToolCall,
  ActualToolCall,
  EvaluationResult,
  MetricDefinition,
} from "./types.js";

// ============================================================================
// Tool Call Accuracy
// ============================================================================

/**
 * Calculate tool call sequence accuracy
 *
 * Uses a modified Levenshtein distance to compare tool sequences,
 * accounting for:
 * - Correct tool names
 * - Correct parameter values (with fuzzy matching for text)
 * - Correct order
 * - Optional steps (marked as optional in expected)
 */
export function calculateToolAccuracy(
  expected: ExpectedToolCall[],
  actual: ActualToolCall[],
): number {
  if (expected.length === 0 && actual.length === 0) return 1.0;
  if (expected.length === 0 || actual.length === 0) return 0.0;

  // Filter out optional steps that weren't taken
  const requiredExpected = expected.filter((e) => !e.optional);

  // Calculate sequence similarity
  const maxLen = Math.max(requiredExpected.length, actual.length);
  if (maxLen === 0) return 1.0;

  const matches = countSequenceMatches(requiredExpected, actual);
  return matches / maxLen;
}

/**
 * Count matching steps between two sequences
 */
function countSequenceMatches(
  expected: ExpectedToolCall[],
  actual: ActualToolCall[],
): number {
  let matches = 0;
  let expIdx = 0;
  let actIdx = 0;

  while (expIdx < expected.length && actIdx < actual.length) {
    const exp = expected[expIdx];
    const act = actual[actIdx];

    if (toolCallsMatch(exp, act)) {
      matches++;
      expIdx++;
      actIdx++;
    } else {
      // Try to find a match by skipping in actual
      const foundMatch = findNextMatch(exp, actual, actIdx + 1);
      if (foundMatch >= 0) {
        // Found a match later, skip the extra steps
        actIdx = foundMatch;
        matches++;
      }
      expIdx++;
      actIdx++;
    }
  }

  return matches;
}

/**
 * Check if two tool calls match
 */
function toolCallsMatch(
  expected: ExpectedToolCall,
  actual: ActualToolCall,
): boolean {
  // Check tool name
  if (expected.tool !== actual.tool) return false;

  // Check parameters (allow partial matches for complex params)
  return paramsMatch(expected.params, actual.params);
}

/**
 * Check if parameter objects match (with fuzzy matching for text)
 */
function paramsMatch(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): boolean {
  for (const [key, expVal] of Object.entries(expected)) {
    const actVal = actual[key];

    // Handle text fields with fuzzy matching
    if (
      key === "text" &&
      typeof expVal === "string" &&
      typeof actVal === "string"
    ) {
      const similarity = calculateTextSimilarity(expVal, actVal);
      if (similarity < 0.8) return false; // 80% similarity threshold
    } else if (expVal !== actVal) {
      return false;
    }
  }

  return true;
}

/**
 * Find the next matching index in actual sequence
 */
function findNextMatch(
  expected: ExpectedToolCall,
  actual: ActualToolCall[],
  startIdx: number,
): number {
  for (let i = startIdx; i < actual.length; i++) {
    if (toolCallsMatch(expected, actual[i])) {
      return i;
    }
  }
  return -1;
}

// ============================================================================
// Text Similarity
// ============================================================================

/**
 * Calculate text similarity using simple token-based approach
 *
 * For production, consider using:
 * - Cosine similarity with embeddings
 * - BLEU score for structured text
 * - ROUGE for summarization tasks
 */
export function calculateTextSimilarity(text1: string, text2: string): number {
  const tokens1 = tokenize(text1.toLowerCase());
  const tokens2 = tokenize(text2.toLowerCase());

  if (tokens1.length === 0 && tokens2.length === 0) return 1.0;
  if (tokens1.length === 0 || tokens2.length === 0) return 0.0;

  // Calculate Jaccard similarity
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);

  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

/**
 * Simple tokenization (can be improved with proper NLP)
 */
function tokenize(text: string): string[] {
  return text
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Check if text matches pattern (supports wildcards)
 */
export function textMatchesPattern(text: string, pattern: string): boolean {
  // Convert pattern to regex
  const regexPattern = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$\u0026") // Escape special chars
    .replace(/\\\*/g, ".*"); // Convert * to .*

  const regex = new RegExp(regexPattern, "i");
  return regex.test(text);
}

// ============================================================================
// Step Efficiency
// ============================================================================

/**
 * Calculate step efficiency ratio
 *
 * 1.0 = perfect efficiency (exactly as many steps as expected)
 * < 1.0 = took more steps than needed
 * > 1.0 = took fewer steps (might be good or bad)
 */
export function calculateStepEfficiency(
  expectedSteps: number,
  actualSteps: number,
): number {
  if (expectedSteps === 0) return actualSteps === 0 ? 1.0 : 0.0;
  return expectedSteps / actualSteps;
}

// ============================================================================
// Outcome Validation
// ============================================================================

/**
 * Validate if actual outcome meets expected criteria
 */
export function validateOutcome(
  expected: {
    success: boolean;
    page_url_pattern?: string;
    page_contains?: string;
  },
  actual: {
    success: boolean;
    final_url?: string;
    page_content?: string;
  },
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // Check success status
  if (expected.success !== actual.success) {
    reasons.push(`Expected success=${expected.success}, got ${actual.success}`);
  }

  // Check URL pattern
  if (expected.page_url_pattern && actual.final_url) {
    const urlMatch = actual.final_url.includes(expected.page_url_pattern);
    if (!urlMatch) {
      reasons.push(
        `Expected URL to contain "${expected.page_url_pattern}", ` +
          `got "${actual.final_url}"`,
      );
    }
  }

  // Check page content
  if (expected.page_contains && actual.page_content) {
    const contentMatch = actual.page_content
      .toLowerCase()
      .includes(expected.page_contains.toLowerCase());
    if (!contentMatch) {
      reasons.push(`Expected page to contain "${expected.page_contains}"`);
    }
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

// ============================================================================
// Overall Scoring
// ============================================================================

/**
 * Calculate weighted overall score
 */
export function calculateOverallScore(
  metrics: {
    toolAccuracy: number;
    textSimilarity: number;
    outcomeMatch: boolean;
    stepEfficiency: number;
  },
  weights?: {
    toolAccuracy: number;
    textSimilarity: number;
    outcomeMatch: number;
    stepEfficiency: number;
  },
): number {
  const w = weights || {
    toolAccuracy: 0.2,
    textSimilarity: 0.1,
    outcomeMatch: 0.6,
    stepEfficiency: 0.1,
  };

  const score =
    metrics.toolAccuracy * w.toolAccuracy +
    metrics.textSimilarity * w.textSimilarity +
    (metrics.outcomeMatch ? 1.0 : 0.0) * w.outcomeMatch +
    Math.min(metrics.stepEfficiency, 1.0) * w.stepEfficiency;

  return Math.round(score * 100) / 100;
}

// ============================================================================
// Summary Statistics
// ============================================================================

/**
 * Calculate summary statistics from evaluation results
 */
export function calculateSummary(results: EvaluationResult[]) {
  const total = results.length;
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const errors = results.filter((r) => r.status === "error").length;

  const durations = results.map((r) => r.duration_ms);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / total;

  const toolAccuracies = results
    .map((r) => r.metrics.tool_accuracy)
    .filter((a): a is number => a !== undefined);
  const avgToolAccuracy =
    toolAccuracies.length > 0
      ? toolAccuracies.reduce((a, b) => a + b, 0) / toolAccuracies.length
      : undefined;

  const textSimilarities = results
    .map((r) => r.metrics.text_similarity)
    .filter((s): s is number => s !== undefined);
  const avgTextSimilarity =
    textSimilarities.length > 0
      ? textSimilarities.reduce((a, b) => a + b, 0) / textSimilarities.length
      : undefined;

  const judgeScores = results
    .map((r) => r.metrics.judge_score)
    .filter((s): s is number => s !== undefined);
  const avgJudgeScore =
    judgeScores.length > 0
      ? judgeScores.reduce((a, b) => a + b, 0) / judgeScores.length
      : undefined;

  return {
    total,
    passed,
    failed,
    errors,
    passRate: passed / total,
    avgDurationMs: Math.round(avgDuration),
    avgToolAccuracy:
      avgToolAccuracy !== undefined
        ? Math.round(avgToolAccuracy * 100) / 100
        : undefined,
    avgTextSimilarity:
      avgTextSimilarity !== undefined
        ? Math.round(avgTextSimilarity * 100) / 100
        : undefined,
    avgJudgeScore:
      avgJudgeScore !== undefined
        ? Math.round(avgJudgeScore * 100) / 100
        : undefined,
  };
}
