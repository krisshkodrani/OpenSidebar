/**
 * Types for the escalation eval pipeline.
 *
 * Two-phase eval: executor model recognizes when to escalate,
 * planner model recovers using distilled context.
 */

import type { E2EElement } from "./types";

/** Shape of a curated escalation golden case */
export interface EscalationGoldenCase {
  id: string;
  scenario: string;
  difficulty: "easy" | "medium" | "hard";

  /** Phase 1: Executor model context — stagnant history leading to escalation */
  fastPhase: {
    snapshot: { url: string; title: string; elementCount: number; scrollY: number };
    elements: E2EElement[];
    objective: string;
    stagnantHistory: Array<{ tool: string; args: Record<string, unknown>; result: string }>;
  };
  expectedFastAction: "escalate";

  /** Phase 2: Planner model context — distilled trajectory + fresh snapshot */
  smartPhase: {
    snapshot: { url: string; title: string; elementCount: number; scrollY: number };
    elements: E2EElement[];
    escalationReason: string;
  };
  expectedSmartAction: {
    toolName: string;
    args?: Record<string, unknown>;
    acceptAlternatives?: string[];
  };

  metadata: { curatedAt: string; notes: string | null };
}

/** Scores for a single escalation eval case */
export interface EscalationScores {
  /** 1.0 if executor model calls escalate, 0.0 otherwise */
  escalationTriggered: number;
  /** Fuzzy match on escalation reason */
  reasonQuality: number;
  /** 1.0 if planner model picks expected tool or alternative */
  toolMatch: number;
  /** Parameter overlap score */
  argsMatch: number;
  /** 1.0 if investigation tool, 0.0 if repeats a failed action */
  investigationQuality: number;
  /** Weighted composite */
  composite: number;
}

/** Result of running one escalation eval case */
export interface EscalationEvalResult {
  caseId: string;
  scenario: string;
  timestamp: string;
  durationMs: number;
  status: "pass" | "fail" | "error";
  plannerModel: string;
  fastPhaseResult: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
    modelVersion?: string;
  };
  smartPhaseResult: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
    modelVersion?: string;
  };
  scores: EscalationScores;
  judge?: EscalationJudgeScore;
  error?: string;
}

/** LLM-as-judge score for escalation eval */
export interface EscalationJudgeScore {
  stuckRecognition: number;
  strategyShift: number;
  investigationDepth: number;
  contextUsage: number;
  reasoning: string;
  promptFixSuggestion?: string;
  pass: boolean;
}
