/**
 * Core type definitions for the evaluation system
 */

import type { ToolCall, ToolName } from "../../src/types/index.js";

// ============================================================================
// Golden Dataset Types
// ============================================================================

export interface GoldenCase {
  id: string;
  version: string;
  created_at: string;
  updated_at?: string;
  description?: string;

  input: {
    url: string;
    dom_snapshot: string;
    user_query: string;
    viewport?: { width: number; height: number };
  };

  expected: {
    tool_calls?: ExpectedToolCall[];
    assistant_text?: string;
    assistant_text_pattern?: string;
    outcome?: ExpectedOutcome;
  };

  metadata: {
    tags: string[];
    difficulty: "easy" | "medium" | "hard";
    expected_steps?: number;
    category?: string;
  };

  /**
   * Mock memory entries to populate the memory system for this test case.
   * Allows testing memory-dependent scenarios without requiring real embeddings.
   */
  mock_memory?: MockMemoryEntry[];
}

export interface MockMemoryEntry {
  id: string;
  content: string;
  category: string;
  sourceUrl: string;
  createdAt: number;
}

export interface ExpectedToolCall {
  tool: ToolName;
  params: Record<string, unknown>;
  reasoning?: string;
  optional?: boolean;
}

export interface ExpectedOutcome {
  success: boolean;
  page_url_pattern?: string;
  page_contains?: string;
  custom_validator?: string;
}

// ============================================================================
// Judge Types
// ============================================================================

export interface JudgeVerdict {
  task_completion: number; // 0-10: Did the agent accomplish the user's goal?
  tool_selection: number; // 0-10: Were the right tools used?
  efficiency: number; // 0-10: Was the approach efficient?
  reasoning: string; // Free-text explanation of the verdict
  issues: string[]; // Specific issues found
  overall_pass: boolean; // Judge's pass/fail decision
}

// ============================================================================
// Evaluation Results Types
// ============================================================================

export interface EvaluationResult {
  case_id: string;
  timestamp: string;
  duration_ms: number;
  status: "passed" | "failed" | "error";

  metrics: {
    tool_accuracy?: number;
    text_similarity?: number;
    outcome_match?: boolean;
    steps_taken: number;
    expected_steps?: number;
    judge_score?: number; // Average of judge dimensions (0-10)
    judge_pass?: boolean; // Judge's overall pass/fail
  };

  details: {
    actual_tool_calls: ActualToolCall[];
    expected_tool_calls?: ExpectedToolCall[];
    actual_text?: string;
    expected_text?: string;
    actual_outcome: ActualOutcome;
    expected_outcome?: ExpectedOutcome;
    errors: string[];
    judge_verdict?: JudgeVerdict; // Full judge output
  };

  analysis?: FailureAnalysis;
}

export interface ActualToolCall {
  tool: ToolName;
  params: Record<string, unknown>;
  success: boolean;
  error?: string;
}

export interface ActualOutcome {
  success: boolean;
  final_url?: string;
  page_content?: string;
  error?: string;
}

// ============================================================================
// Failure Analysis Types
// ============================================================================

export interface FailureAnalysis {
  case_id: string;
  failure_type: FailureType;
  severity: "low" | "medium" | "high" | "critical";

  expected: string;
  actual: string;

  root_cause: string;
  prompt_issues: PromptIssue[];
  suggestions: string[];
}

export type FailureType =
  | "wrong_tool"
  | "wrong_params"
  | "missing_step"
  | "extra_step"
  | "wrong_order"
  | "wrong_text"
  | "wrong_outcome"
  | "timeout"
  | "error";

export interface PromptIssue {
  type: "clarity" | "example" | "instruction" | "tool_desc" | "other";
  description: string;
  confidence: number;
}

// ============================================================================
// Prompt Optimization Types
// ============================================================================

export interface PromptSuggestion {
  id: string;
  timestamp: string;

  title: string;
  description: string;
  current_prompt_excerpt: string;
  proposed_change: string;

  impact: {
    affected_cases: string[];
    expected_improvement: number;
    confidence: "low" | "medium" | "high";
  };

  applied: boolean;
  applied_at?: string;
  results?: {
    before_metrics: Record<string, number>;
    after_metrics: Record<string, number>;
  };
}

export interface PromptVersion {
  version: string;
  content: string;
  created_at: string;
  metrics?: {
    golden_success_rate: number;
    avg_latency_ms: number;
    total_evaluations: number;
  };
  parent_version?: string;
  change_description?: string;
}

// ============================================================================
// Evaluation Run Types
// ============================================================================

export interface EvaluationRun {
  id: string;
  timestamp: string;
  config: EvaluationConfig;
  results: EvaluationResult[];
  summary: EvaluationSummary;
}

export interface EvaluationConfig {
  categories?: string[];
  tags?: string[];
  difficulty?: string[];
  case_ids?: string[];
  model?: string;
  max_concurrent?: number;
  timeout_ms?: number;
}

export interface EvaluationSummary {
  total_cases: number;
  passed: number;
  failed: number;
  errors: number;

  avg_duration_ms: number;
  avg_tool_accuracy?: number;
  avg_text_similarity?: number;
  avg_judge_score?: number;

  by_category: Record<string, { passed: number; failed: number }>;
  by_difficulty: Record<string, { passed: number; failed: number }>;
}

// ============================================================================
// Comparison Types
// ============================================================================

export interface ComparisonResult {
  baseline_id: string;
  current_id: string;

  overall_change: {
    success_rate_delta: number;
    avg_duration_delta_ms: number;
  };

  regressions: Regression[];
  improvements: Improvement[];
  unchanged: string[];
}

export interface Regression {
  case_id: string;
  baseline_status: "passed";
  current_status: "failed" | "error";
  change_description: string;
}

export interface Improvement {
  case_id: string;
  baseline_status: "failed" | "error";
  current_status: "passed";
  improvement_description: string;
}

// ============================================================================
// Reporter Types
// ============================================================================

export type ReportFormat = "json" | "markdown" | "html" | "csv";

export interface ReportConfig {
  format: ReportFormat;
  output_path?: string;
  include_details?: boolean;
  include_analysis?: boolean;
}

// ============================================================================
// Metric Types
// ============================================================================

export interface MetricDefinition {
  name: string;
  description: string;
  type: "percentage" | "number" | "duration" | "boolean";
  higher_is_better: boolean;
}

export const METRICS: Record<string, MetricDefinition> = {
  tool_accuracy: {
    name: "Tool Call Accuracy",
    description: "Percentage of tool calls matching expected sequence",
    type: "percentage",
    higher_is_better: true,
  },
  text_similarity: {
    name: "Text Response Similarity",
    description: "Semantic similarity between expected and actual text",
    type: "percentage",
    higher_is_better: true,
  },
  outcome_match: {
    name: "Outcome Match",
    description: "Whether the final outcome matches expected",
    type: "boolean",
    higher_is_better: true,
  },
  steps_efficiency: {
    name: "Step Efficiency",
    description: "Ratio of expected steps to actual steps taken",
    type: "percentage",
    higher_is_better: true,
  },
  duration_ms: {
    name: "Execution Duration",
    description: "Time taken to complete evaluation",
    type: "duration",
    higher_is_better: false,
  },
};
