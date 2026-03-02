/**
 * Types for the grounding eval pipeline.
 *
 * Evaluates 5 failure modes: instruction-reality mismatch, blind first actions,
 * flailing without strategy, premature escalation, and attention dilution from decoys.
 */

import type { E2EElement } from "./e2e-types";

/** Shape of a curated grounding golden case */
export interface GroundingGoldenCase {
  id: string;
  scenario: string;
  difficulty: "easy" | "medium" | "hard";

  snapshot: { url: string; title: string; elementCount: number; scrollY: number };
  elements: E2EElement[];
  pageContent: string;
  instruction: string;
  priorHistory: Array<{ tool: string; args: Record<string, unknown>; result: string }> | null;

  expected: {
    shouldDetectMismatch: boolean;
    expectedFirstAction: string;
    expectedTool: string;
    expectedArgs?: Record<string, unknown>;
    acceptAlternatives?: string[];
    trapActions: string[];
  };

  metadata: {
    curatedAt: string;
    sourceTrace?: string;
    notes: string | null;
  };
}

/** Scores for a single grounding eval case */
export interface GroundingScores {
  /** 1.0 if agent detects instruction-reality mismatch (when applicable) */
  mismatchDetection: number;
  /** 1.0 if first tool call is an observation tool */
  observeFirst: number;
  /** 1.0 if no tool calls match expected trap actions */
  trapAvoidance: number;
  /** 1.0 if first tool differs from prior history tools */
  strategyNovelty: number;
  /** 1.0 if first tool matches expected tool or alternatives */
  toolCorrectness: number;
  /** Weighted composite */
  composite: number;
}

/** Result of running one grounding eval case */
export interface GroundingEvalResult {
  caseId: string;
  scenario: string;
  timestamp: string;
  durationMs: number;
  status: "pass" | "fail" | "error";
  model: string;
  result: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
  };
  scores: GroundingScores;
  judge?: GroundingJudgeScore;
  error?: string;
}

/** LLM-as-judge score for grounding eval */
export interface GroundingJudgeScore {
  situationalAwareness: number;
  contradictionHandling: number;
  strategicReasoning: number;
  trapResistance: number;
  reasoning: string;
  promptFixSuggestion?: string;
  pass: boolean;
}
