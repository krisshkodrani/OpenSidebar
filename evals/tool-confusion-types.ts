/**
 * Types for the tool-confusion eval pipeline.
 *
 * Evaluates whether the agent can discriminate between confusable tools
 * (e.g. click_element vs click_coordinates, dismiss_overlays vs hide_element).
 */

import type { E2EElement } from "./types";

/** Shape of a curated tool-confusion golden case */
export interface ToolConfusionGoldenCase {
  id: string;
  confusionPair: { toolA: string; toolB: string; label: string };
  scenario: string;
  difficulty: "easy" | "medium" | "hard";

  snapshot: { url: string; title: string; elementCount: number; scrollY: number };
  elements: E2EElement[];
  pageContent: string;
  instruction: string;
  priorHistory: Array<{ tool: string; args: Record<string, unknown>; result: string }> | null;

  expected: {
    correctTool: string;
    correctArgs?: Record<string, unknown>;
    acceptAlternatives?: string[];
    antiPatternTools: string[];
    rationale: string;
  };

  toolSubset?: string[];

  metadata: {
    curatedAt: string;
    notes: string | null;
  };
}

/** Scores for a single tool-confusion eval case */
export interface ToolConfusionScores {
  /** 1.0 if first tool call is the correct tool (or acceptable alternative) */
  correctToolPicked: number;
  /** 1.0 if no tool calls match anti-pattern tools */
  avoidedAntiPattern: number;
  /** 0.0–1.0 parameter overlap with expected args */
  parameterCorrectness: number;
  /** 0.0–1.0 from LLM-as-judge reasoning assessment */
  reasoningQuality: number;
  /** Weighted composite */
  composite: number;
}

/** Result of running one tool-confusion eval case */
export interface ToolConfusionEvalResult {
  caseId: string;
  confusionPair: string;
  scenario: string;
  timestamp: string;
  durationMs: number;
  status: "pass" | "fail" | "error";
  model: string;
  result: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
  };
  scores: ToolConfusionScores;
  judge?: ToolConfusionJudgeScore;
  error?: string;
}

/** LLM-as-judge score for tool-confusion eval */
export interface ToolConfusionJudgeScore {
  toolDiscrimination: number;
  contextualReasoning: number;
  parameterPrecision: number;
  antiPatternAwareness: number;
  reasoning: string;
  promptFixSuggestion?: string;
  pass: boolean;
}
