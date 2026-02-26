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
  strategy: "first-turn" | "any-turn" | "recovery" | "escalation" | "verifier-decision" | "lane-isolation" | "escalation-flow" | "golden";
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
    pathology?: string;
  };
  /**
   * Prompt-quality expectations for orchestration behaviors.
   * Optional to keep backward compatibility with older cases.
   */
  promptQuality?: {
    promptVersion?: string;
    track?:
      | "orchestrator_lane_isolation"
      | "verifier_critic"
      | "human_escalation"
      | "budget_and_termination"
      | "checkpoint_resume"
      | "core_task_success";
    expectedPlanShape?: string[];
    expectedLaneEvents?: string[];
    expectedEscalation?: "none" | "requested" | "decision";
    expectedVerifierDecision?: "accept" | "retry" | "reroute";
    mustNot?: string[];
    notes?: string;
  };
}

/** Result of running a single eval case */
export interface EvalResult {
  caseId: string;
  timestamp: string;
  durationMs: number;
  status: "pass" | "fail" | "error";
  promptVariant?: string;
  actual: {
    toolCalls: { toolName: string; args: Record<string, unknown> }[];
    text: string | null;
  };
  scores: {
    toolNameMatch: number;
    toolParamMatch: number;
    sequenceMatch: number;
    composite?: number;
    judge?: JudgeScore;
  };
  error?: string;
}

/** LLM-as-judge qualitative assessment */
export interface JudgeScore {
  toolSelection: number;
  parameterAccuracy: number;
  efficiency: number;
  antiPatternAvoidance: number;
  reasoningQuality: number;
  reasoning: string;
  promptFixSuggestion?: string;
  pass: boolean;
  /** @deprecated Use toolSelection instead */
  taskCompletion?: number;
}
