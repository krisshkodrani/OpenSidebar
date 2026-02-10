/**
 * Failure Analyzer
 *
 * Analyzes evaluation failures to identify root causes and prompt issues.
 */

import type {
  EvaluationResult,
  FailureAnalysis,
  FailureType,
  PromptIssue,
} from "../core/types.js";

/**
 * Analyze a failed evaluation result
 */
export function analyzeFailure(
  result: EvaluationResult,
): FailureAnalysis | undefined {
  if (result.status === "passed") return undefined;

  const failureType = determineFailureType(result);
  const rootCause = determineRootCause(result, failureType);
  const promptIssues = identifyPromptIssues(result, failureType);

  return {
    case_id: result.case_id,
    failure_type: failureType,
    severity: determineSeverity(result, failureType),
    expected: formatExpected(result),
    actual: formatActual(result),
    root_cause: rootCause,
    prompt_issues: promptIssues,
    suggestions: generateSuggestions(failureType, promptIssues),
  };
}

/**
 * Determine the type of failure
 */
function determineFailureType(result: EvaluationResult): FailureType {
  const { details, metrics } = result;

  // Check for errors first
  if (result.status === "error") {
    return "error";
  }

  // Check tool call issues
  if (details.expected_tool_calls && details.actual_tool_calls) {
    const expected = details.expected_tool_calls;
    const actual = details.actual_tool_calls;

    // Wrong tool selected
    if (actual.length > 0 && expected.length > 0) {
      if (actual[0].tool !== expected[0].tool) {
        return "wrong_tool";
      }
    }

    // Wrong parameters
    if (actual.length > 0 && expected.length > 0) {
      if (actual[0].tool === expected[0].tool) {
        const expParams = JSON.stringify(expected[0].params);
        const actParams = JSON.stringify(actual[0].params);
        if (expParams !== actParams) {
          return "wrong_params";
        }
      }
    }

    // Missing steps
    if (actual.length < expected.length) {
      return "missing_step";
    }

    // Extra steps
    if (actual.length > expected.length) {
      return "extra_step";
    }

    // Wrong order
    if (actual.length === expected.length) {
      for (let i = 0; i < actual.length; i++) {
        if (actual[i].tool !== expected[i].tool) {
          return "wrong_order";
        }
      }
    }
  }

  // Check text issues
  if (metrics.text_similarity !== undefined && metrics.text_similarity < 0.8) {
    return "wrong_text";
  }

  // Check outcome
  if (metrics.outcome_match === false) {
    return "wrong_outcome";
  }

  return "error";
}

/**
 * Determine the root cause of the failure
 */
function determineRootCause(
  result: EvaluationResult,
  failureType: FailureType,
): string {
  switch (failureType) {
    case "wrong_tool":
      return "Agent selected incorrect tool for the given context";
    case "wrong_params":
      return "Agent used correct tool but with incorrect parameters";
    case "missing_step":
      return "Agent skipped required step in the workflow";
    case "extra_step":
      return "Agent performed unnecessary extra step";
    case "wrong_order":
      return "Agent performed steps in incorrect order";
    case "wrong_text":
      return "Agent response text significantly differs from expected";
    case "wrong_outcome":
      return "Final outcome does not match expected criteria";
    case "error":
      return result.details.errors[0] || "Unknown error occurred";
    default:
      return "Unknown failure";
  }
}

/**
 * Identify issues in the prompt that may have caused the failure
 */
function identifyPromptIssues(
  result: EvaluationResult,
  failureType: FailureType,
): PromptIssue[] {
  const issues: PromptIssue[] = [];

  switch (failureType) {
    case "wrong_tool":
      issues.push({
        type: "tool_desc",
        description: "Tool descriptions may be ambiguous or unclear",
        confidence: 0.7,
      });
      issues.push({
        type: "example",
        description:
          "Missing example showing correct tool selection for this scenario",
        confidence: 0.8,
      });
      break;

    case "wrong_params":
      issues.push({
        type: "instruction",
        description: "Parameter requirements not clearly specified",
        confidence: 0.8,
      });
      break;

    case "missing_step":
      issues.push({
        type: "instruction",
        description: "Multi-step workflow guidance incomplete",
        confidence: 0.7,
      });
      break;

    case "wrong_text":
      issues.push({
        type: "clarity",
        description: "Expected response format not clearly communicated",
        confidence: 0.6,
      });
      break;

    case "wrong_outcome":
      issues.push({
        type: "instruction",
        description: "Success criteria not clearly defined",
        confidence: 0.7,
      });
      break;
  }

  return issues;
}

/**
 * Determine severity of the failure
 */
function determineSeverity(
  result: EvaluationResult,
  failureType: FailureType,
): "low" | "medium" | "high" | "critical" {
  // Critical: Complete failure or system error
  if (result.status === "error") {
    return "critical";
  }

  // High: Wrong tool or outcome
  if (failureType === "wrong_tool" || failureType === "wrong_outcome") {
    return "high";
  }

  // Medium: Wrong params or order
  if (failureType === "wrong_params" || failureType === "wrong_order") {
    return "medium";
  }

  // Low: Minor issues
  return "low";
}

/**
 * Format expected result for display
 */
function formatExpected(result: EvaluationResult): string {
  const parts: string[] = [];

  if (result.details.expected_tool_calls) {
    parts.push(
      `Tools: ${result.details.expected_tool_calls.map((t) => t.tool).join(", ")}`,
    );
  }

  if (result.details.expected_text) {
    parts.push(`Text: "${result.details.expected_text.substring(0, 50)}..."`);
  }

  if (result.details.expected_outcome) {
    parts.push(
      `Outcome: ${result.details.expected_outcome.success ? "success" : "failure"}`,
    );
  }

  return parts.join(" | ");
}

/**
 * Format actual result for display
 */
function formatActual(result: EvaluationResult): string {
  const parts: string[] = [];

  if (result.details.actual_tool_calls.length > 0) {
    parts.push(
      `Tools: ${result.details.actual_tool_calls.map((t) => t.tool).join(", ")}`,
    );
  }

  if (result.details.actual_text) {
    parts.push(`Text: "${result.details.actual_text.substring(0, 50)}..."`);
  }

  if (result.details.actual_outcome) {
    parts.push(
      `Outcome: ${result.details.actual_outcome.success ? "success" : "failure"}`,
    );
  }

  return parts.join(" | ");
}

/**
 * Generate suggestions based on failure type and issues
 */
function generateSuggestions(
  failureType: FailureType,
  issues: PromptIssue[],
): string[] {
  const suggestions: string[] = [];

  for (const issue of issues) {
    switch (issue.type) {
      case "tool_desc":
        suggestions.push("Clarify tool descriptions with specific use cases");
        suggestions.push("Add decision tree for tool selection");
        break;

      case "instruction":
        suggestions.push("Add explicit step-by-step instructions");
        suggestions.push("Include success criteria in the prompt");
        break;

      case "example":
        suggestions.push("Add few-shot examples for similar scenarios");
        suggestions.push("Include counter-examples of what NOT to do");
        break;

      case "clarity":
        suggestions.push("Restate requirements more explicitly");
        suggestions.push("Break down complex instructions into smaller steps");
        break;
    }
  }

  // Add specific suggestions based on failure type
  switch (failureType) {
    case "wrong_tool":
      suggestions.push("Review DOM element tagging strategy");
      break;
    case "wrong_params":
      suggestions.push("Add parameter validation examples");
      break;
    case "missing_step":
      suggestions.push("Add workflow checklist to prompt");
      break;
  }

  return [...new Set(suggestions)]; // Remove duplicates
}

/**
 * Analyze multiple results and cluster failures
 */
export function analyzeMultipleFailures(results: EvaluationResult[]): {
  byType: Record<FailureType, EvaluationResult[]>;
  bySeverity: Record<string, EvaluationResult[]>;
  commonIssues: string[];
} {
  const failures = results.filter((r) => r.status !== "passed");

  // Group by failure type
  const byType: Record<FailureType, EvaluationResult[]> = {} as Record<
    FailureType,
    EvaluationResult[]
  >;
  for (const result of failures) {
    const analysis = analyzeFailure(result);
    if (analysis) {
      const type = analysis.failure_type;
      byType[type] = byType[type] || [];
      byType[type].push(result);
    }
  }

  // Group by severity
  const bySeverity: Record<string, EvaluationResult[]> = {};
  for (const result of failures) {
    const analysis = analyzeFailure(result);
    if (analysis) {
      const severity = analysis.severity;
      bySeverity[severity] = bySeverity[severity] || [];
      bySeverity[severity].push(result);
    }
  }

  // Find common issues
  const issueCounts: Record<string, number> = {};
  for (const result of failures) {
    const analysis = analyzeFailure(result);
    if (analysis) {
      for (const issue of analysis.prompt_issues) {
        issueCounts[issue.description] =
          (issueCounts[issue.description] || 0) + 1;
      }
    }
  }

  const commonIssues = Object.entries(issueCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([issue]) => issue);

  return { byType, bySeverity, commonIssues };
}
