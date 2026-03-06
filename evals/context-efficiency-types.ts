/**
 * Types for the context-efficiency eval pipeline.
 *
 * Measures whether prompt optimizations (observation masking, attribute pruning,
 * plan persistence, time awareness) preserve agent behavior while reducing tokens.
 * Supports A/B comparison: baseline prompt vs optimized prompt on the same case.
 */

import type { E2EElement } from "./e2e-types";

/** Shape of a curated context-efficiency golden case */
export interface ContextEfficiencyGoldenCase {
  id: string;
  scenario:
    | "observation_masking"
    | "attribute_pruning"
    | "plan_persistence"
    | "time_awareness";
  difficulty: "easy" | "medium" | "hard";

  snapshot: { url: string; title: string; elementCount: number; scrollY: number };
  elements: E2EElement[];
  pageContent: string;
  instruction: string;

  /** Conversation history to inject (for masking/compression scenarios) */
  priorHistory: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: string;
  }> | null;

  /** Active plan state (for plan-persistence scenarios) */
  planStatus?: {
    subtasks: Array<{ description: string; status: "done" | "running" | "pending" }>;
    currentIndex: number;
  };

  /** Turn/time metadata (for time-awareness scenarios) */
  turnContext?: {
    turnCount: number;
    maxTurns: number;
    elapsedSeconds: number;
  };

  expected: {
    /** The tool the agent should call */
    expectedTool: string;
    expectedArgs?: Record<string, unknown>;
    acceptAlternatives?: string[];
    /** Agent should reference the current plan step (for plan-persistence) */
    shouldReferencePlan?: boolean;
    /** Agent should show urgency or patience based on time context */
    expectedUrgency?: "escalate" | "normal" | "patient";
    /** Tools the agent should NOT call */
    trapActions?: string[];
  };

  /** Optional: only expose a subset of tools to reduce noise */
  toolSubset?: string[];

  metadata: {
    curatedAt: string;
    notes: string | null;
    /** Approximate token count for the baseline system prompt */
    baselineTokenEstimate?: number;
  };
}

/** Scores for a single context-efficiency eval case */
export interface ContextEfficiencyScores {
  /** 1.0 if agent picks the expected tool (or alternative) */
  behaviorPreservation: number;
  /** 0-1 ratio of token reduction vs baseline estimate */
  tokenReduction: number;
  /** 1.0 if agent correctly references current plan step */
  planAwareness: number;
  /** 1.0 if agent shows appropriate urgency for the turn/time context */
  timeAwareness: number;
  /** 1.0 if no trap actions triggered */
  noRegression: number;
  /** Weighted composite */
  composite: number;
}

/** Result of running one context-efficiency eval case */
export interface ContextEfficiencyEvalResult {
  caseId: string;
  scenario: string;
  timestamp: string;
  durationMs: number;
  status: "pass" | "fail" | "error";
  model: string;
  promptVariant: "baseline" | "optimized";
  result: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
  };
  tokenMetrics?: {
    systemPromptTokens: number;
    historyTokens: number;
    totalInputTokens: number;
  };
  scores: ContextEfficiencyScores;
  error?: string;
}
