/**
 * Scoring logic for eval results.
 * Compares expected vs actual LLM output using multiple metrics.
 */

import { levenshteinDistance } from "./utils";

interface ToolCallInfo {
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * Score how well actual tool names match expected tool names.
 * Returns 0-1 (1 = perfect match).
 */
export function scoreToolNameMatch(
  expected: ToolCallInfo[],
  actual: ToolCallInfo[],
): number {
  if (expected.length === 0) return actual.length === 0 ? 1 : 0;

  const expectedNames = new Set(expected.map((tc) => tc.toolName));
  const actualNames = new Set(actual.map((tc) => tc.toolName));
  let matches = 0;
  for (const name of expectedNames) {
    if (actualNames.has(name)) matches++;
  }
  return matches / expectedNames.size;
}

/**
 * Score how well actual tool parameters match expected ones.
 * For matched tools, compares params with fuzzy matching.
 * Returns 0-1 (1 = all params match exactly).
 */
export function scoreToolParamMatch(
  expected: ToolCallInfo[],
  actual: ToolCallInfo[],
): number {
  if (expected.length === 0) return actual.length === 0 ? 1 : 0;

  let totalScore = 0;
  let matchedCount = 0;

  for (const exp of expected) {
    const act = actual.find((a) => a.toolName === exp.toolName);
    if (!act) continue;
    matchedCount++;
    totalScore += compareArgs(exp.args, act.args);
  }

  return matchedCount > 0 ? totalScore / expected.length : 0;
}

/**
 * Score how well the sequence of tool calls matches.
 * Uses Levenshtein distance normalized to 0-1.
 */
export function scoreSequenceMatch(
  expected: ToolCallInfo[],
  actual: ToolCallInfo[],
): number {
  const expNames = expected.map((tc) => tc.toolName);
  const actNames = actual.map((tc) => tc.toolName);
  const maxLen = Math.max(expNames.length, actNames.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(expNames, actNames);
  return 1 - distance / maxLen;
}

/**
 * Compare two argument objects with fuzzy matching.
 * - Exact match for IDs (numbers)
 * - Case-insensitive for strings
 * - 10% tolerance for numbers
 */
function compareArgs(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): number {
  const keys = Object.keys(expected);
  if (keys.length === 0) return 1;

  let matches = 0;
  for (const key of keys) {
    const expVal = expected[key];
    const actVal = actual[key];

    if (actVal === undefined) continue;

    if (typeof expVal === "number" && typeof actVal === "number") {
      // ID-like integers: exact match
      if (Number.isInteger(expVal) && key.toLowerCase().includes("id")) {
        if (expVal === actVal) matches++;
      } else {
        // Other numbers: 10% tolerance
        const tolerance = Math.abs(expVal) * 0.1 || 1;
        if (Math.abs(expVal - actVal) <= tolerance) matches++;
      }
    } else if (typeof expVal === "string" && typeof actVal === "string") {
      // Case-insensitive string comparison
      if (expVal.toLowerCase() === actVal.toLowerCase()) matches++;
    } else if (expVal === actVal) {
      matches++;
    }
  }

  return matches / keys.length;
}
