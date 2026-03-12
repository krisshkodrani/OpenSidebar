/**
 * Types for the completion-timing eval pipeline.
 *
 * Tests whether the agent correctly decides to call `done()` (when the task
 * is complete) or continue acting (when it isn't), given page state, action
 * history, plan status, and perception output.
 */

import type { E2EElement } from "./types";

/** Shape of a curated completion-timing golden case */
export interface CompletionTimingGoldenCase {
  id: string;
  scenario: string;
  difficulty: "easy" | "medium" | "hard";

  snapshot: { url: string; title: string; elementCount: number; scrollY: number };
  elements: E2EElement[];
  objective: string;
  plan: Array<{ step: string; status: "completed" | "pending" }>;
  actionHistory: Array<{ tool: string; args: Record<string, unknown>; result: string }>;
  perception: string;

  expectedAction: "done" | "continue";

  /** For "done" cases: keywords the summary should contain */
  expectedSummaryKeywords?: string[];
  /** For "continue" cases: acceptable next tools */
  expectedNextTools?: string[];

  metadata: { curatedAt: string; notes: string | null };
}

/** Scores for a single completion-timing eval case */
export interface CompletionTimingScores {
  /** 1.0 if model makes the correct call (done vs continue), 0.0 otherwise */
  decisionCorrect: number;
  /** For done cases: does summary cite evidence? For continue: 1.0 (N/A) */
  summaryQuality: number;
  /** For continue cases: does it pick a productive next tool? For done: 1.0 (N/A) */
  nextActionQuality: number;
  /** Did model reference the perception / page state? */
  perceptionUsage: number;
  /** Weighted composite */
  composite: number;
}

/** Result of running one completion-timing eval case */
export interface CompletionTimingEvalResult {
  caseId: string;
  scenario: string;
  timestamp: string;
  durationMs: number;
  status: "pass" | "fail" | "error";
  modelVersion?: string;
  result: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
  };
  scores: CompletionTimingScores;
  judge?: CompletionTimingJudgeScore;
  error?: string;
}

/** LLM-as-judge score for completion-timing eval */
export interface CompletionTimingJudgeScore {
  completionRecognition: number;
  timingAccuracy: number;
  summarySpecificity: number;
  planAdherence: number;
  reasoning: string;
  promptFixSuggestion?: string;
  pass: boolean;
}
