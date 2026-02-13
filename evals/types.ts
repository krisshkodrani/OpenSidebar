/**
 * Types for the trace-based evaluation pipeline.
 */

import type { ToolName } from "../src/types";
import type { LLMMessage } from "../src/background/llm/types";
import type { ToolDefinition } from "../src/types";

/** A single eval case extracted from a recorded trace */
export interface EvalCase {
  id: string;
  sourceSessionId: string;
  sourceTurn: number;
  strategy: "first-turn" | "any-turn" | "recovery" | "escalation";
  /** Input to LLM (reconstructed from trace) */
  input: {
    systemPrompt: string;
    conversationHistory: LLMMessage[];
    tools: ToolDefinition[];
    model: string;
  };
  /** Expected output (from recording) */
  expected: {
    toolCalls: { toolName: ToolName; args: Record<string, unknown> }[];
    text: string | null;
  };
  /** Context metadata */
  metadata: {
    url: string;
    query: string;
    sessionOutcome: string;
    difficulty: "easy" | "medium" | "hard";
    tags: string[];
  };
}

/** Result of running a single eval case */
export interface EvalResult {
  caseId: string;
  timestamp: string;
  durationMs: number;
  status: "pass" | "fail" | "error";
  actual: {
    toolCalls: { toolName: string; args: Record<string, unknown> }[];
    text: string | null;
  };
  scores: {
    toolNameMatch: number;
    toolParamMatch: number;
    sequenceMatch: number;
    judge?: JudgeScore;
  };
  error?: string;
}

/** LLM-as-judge qualitative assessment */
export interface JudgeScore {
  taskCompletion: number;
  toolSelection: number;
  efficiency: number;
  reasoning: string;
  pass: boolean;
}
