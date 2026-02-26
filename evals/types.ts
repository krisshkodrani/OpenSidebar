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
  /** Model ID as returned by the API (tracks actual model served after failover) */
  modelVersion?: string;
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

// ── Perception eval types ─────────────────────────────────────────────

export type PerceptionMode = "orientation" | "focused";

export interface PerceptionEvalCase {
  id: string;
  sourceSessionId: string;
  sourceTurn: number;
  input: {
    screenshotDataUrl: string;
    elements: { tag: number; tagName: string; text: string; role?: string; attributes: Record<string, string> }[];
    url: string;
    title: string;
    scroll: { y: number; maxY: number };
    subtask?: string;
    objective?: string;
    toolProfile?: string;
  };
  expected: {
    mode: PerceptionMode;
    requiredSections: string[];
    pageType?: string;
    blockers?: Array<{ type: "nuisance" | "relevant" | "prereq"; description: string; tagId?: number }>;
    completionSignal?: { status: "done" | "not_done" | "unclear"; scope: "subtask" | "objective" } | null;
    mustMentionElements?: number[];
    visualOnlyContent?: string[];
    hazards?: Array<{ tagId: number; reason: string }>;
    notes?: string;
  };
  reference: {
    interpretation: string;
    model: string;
    providerId?: string;
    durationMs: number;
  };
  metadata: {
    url: string;
    query: string;
    difficulty: "easy" | "medium" | "hard";
    tags: string[];
    dimension?: "accuracy" | "blockers" | "completion_signal" | "hallucination" | "hazards" | "actionability";
  };
}

export interface PerceptionEvalResult {
  caseId: string;
  timestamp: string;
  durationMs: number;
  status: "pass" | "fail" | "error";
  provider: { model: string; providerId: string };
  actual: {
    interpretation: string;
    completionSignal?: { status: string; evidence: string; scope: string } | null;
  };
  scores: {
    sectionCompleteness: number;
    signalAccuracy: number;
    blockerDetection: number;
    actionability: number;
    hallucination: number;
    composite: number;
    judge?: PerceptionJudgeScore;
  };
  error?: string;
}

export interface PerceptionJudgeScore {
  accuracy: number;
  blockerQuality: number;
  groundedness: number;
  signalCorrectness: number;
  conciseness: number;
  reasoning: string;
  promptFixSuggestion?: string;
  pass: boolean;
}

// ── Planner eval types ────────────────────────────────────────────────

export type PlannerEvalMethod = "decompose" | "validateDone";

export interface PlannerEvalCase {
  id: string;
  sourceSessionId: string;
  method: PlannerEvalMethod;
  input: {
    query: string;
    pageTitle: string;
    pageUrl: string;
    perception?: string;
    /** validateDone only */
    plan?: { description: string; status: string }[];
    doneSummary?: string;
  };
  expected: {
    /** decompose */
    difficulty?: "simple" | "moderate" | "complex" | "extreme";
    isMultiStep?: boolean;
    stepCountRange?: { min: number; max: number };
    mustCoverTopics?: string[];
    antiPatterns?: string[];
    /** Maximum acceptable step count (for length_bias detection) */
    maxSteps?: number;
    /** Tools that must NOT appear in the plan (for capability_mismatch detection) */
    forbiddenToolRefs?: string[];
    /** Per-step structured evaluation annotations */
    stepAnnotations?: StepAnnotation[];
    /** Termination condition expectations */
    terminationExpectations?: TerminationExpectations;
    /** validateDone */
    approved?: boolean;
  };
  reference: {
    decomposition?: {
      subtasks: string[];
      steps?: Array<{
        objective: string;
        successCriteria: string;
        dependencies: number[];
        verifyAfter?: { trigger: string; action: string };
        toolProfile?: string;
      }>;
      difficulty: string;
    };
    sessionOutcome: "completed" | "stopped" | "max_turns" | "error";
    sessionTurnCount: number;
    escalationCount: number;
  };
  metadata: {
    url: string;
    query: string;
    difficulty: "easy" | "medium" | "hard";
    tags: string[];
    dimension?: "difficulty_accuracy" | "step_quality" | "coverage" | "done_validation" | "capability_mismatch" | "orchestration" | "length_bias" | "step_progress" | "termination";
  };
}

export interface PlannerEvalResult {
  caseId: string;
  timestamp: string;
  durationMs: number;
  status: "pass" | "fail" | "error";
  method: PlannerEvalMethod;
  /** Model ID as returned by the API (tracks actual model served after failover) */
  modelVersion?: string;
  actual: {
    decomposition?: { subtasks: string[]; steps?: any[]; difficulty: string; isMultiStep: boolean };
    validation?: { approved: boolean; reason?: string };
  };
  scores: {
    difficultyAccuracy: number;
    stepCountScore: number;
    coverageScore: number;
    stepQualityScore: number;
    antiPatternScore: number;
    stepProgressScore?: number;
    terminationScore?: number;
    composite: number;
    judge?: PlannerJudgeScore;
  };
  error?: string;
}

export interface PlannerJudgeScore {
  planCoherence: number;
  taskAlignment: number;
  granularity: number;
  feasibility: number;
  robustness: number;
  verificationGateQuality?: number;
  terminationAwareness?: number;
  reasoning: string;
  promptFixSuggestion?: string;
  pass: boolean;
}

/** Golden annotation for a single plan step. */
export interface StepAnnotation {
  index: number;
  objectiveClarity: "high" | "medium" | "low";
  criteriaSpecificity: "high" | "medium" | "low";
  dependenciesCorrect: boolean;
  requiresVerificationGate: boolean;
  expectedGateAction?: "advance_step" | "call_done";
  notes?: string;
}

/** What termination signals should a well-formed plan include? */
export interface TerminationExpectations {
  lastStepCallsDone: boolean;
  minVerificationGates: number;
  allStepsHaveGates: boolean;
  respectsUserStopCondition: boolean | null;
  pattern?: string;
}

// ── Context compression eval types ───────────────────────────────────

export interface ContextEvalCase {
  id: string;
  sourceSessionId: string;
  sourceTurn: number;
  input: {
    history: Array<{
      role: string;
      content: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      tool_call_id?: string;
    }>;
    snapshot: { url: string; title: string; elementCount: number; scrollY: number };
    elements: Array<{ tag: number; tagName: string; text: string; role?: string; attributes: Record<string, string> }>;
    originalQuery: string;
    planStatus?: { subtasks: { description: string; status: string }[]; currentIndex: number };
    maxContextTokens: number;
    perception?: string;
  };
  expected: {
    mustPreserve: {
      originalQuery: boolean;
      planStatus: boolean;
      recentToolResults: number;
      errorPatterns?: string[];
      keyFacts?: string[];
    };
    expectedLevel: "none" | "light" | "medium" | "heavy";
    tokenReductionMin?: number;
  };
  metadata: {
    url: string;
    query: string;
    historyLength: number;
    difficulty: "easy" | "medium" | "hard";
    tags: string[];
    dimension?: "goal_amnesia" | "plan_integrity" | "tool_results" | "token_efficiency" | "trajectory_quality";
  };
}

export interface ContextEvalResult {
  caseId: string;
  timestamp: string;
  durationMs: number;
  status: "pass" | "fail" | "error";
  compressionLevel: string;
  actual: {
    promptTokensBefore: number;
    promptTokensAfter: number;
    reductionPercent: number;
    historyLengthBefore: number;
    historyLengthAfter: number;
  };
  scores: {
    goalPreservation: number;
    planPreservation: number;
    toolResultPreservation: number;
    keyFactPreservation: number;
    tokenEfficiency: number;
    composite: number;
  };
  error?: string;
}

// ── Stagnation eval types ────────────────────────────────────────────

export interface StagnationEvalCase {
  id: string;
  sourceSessionId: string;
  input: {
    snapshots: Array<{
      turnNumber: number;
      url: string;
      title: string;
      elements: Array<{ tagName: string; text: string; attributes: Record<string, string> }>;
    }>;
  };
  expected: {
    escalation: { shouldFire: boolean; expectedTurnRange?: { min: number; max: number } };
    sessionWasStuck: boolean;
  };
  reference: {
    escalationEvents: Array<{ turn: number; stagnantTurns: number }>;
    sessionOutcome: "completed" | "stopped" | "max_turns" | "error";
    sessionTurnCount: number;
  };
  metadata: {
    url: string;
    query: string;
    difficulty: "easy" | "medium" | "hard";
    tags: string[];
    dimension?: "false_positive" | "false_negative" | "timing" | "url_handling";
  };
}

export interface StagnationEvalResult {
  caseId: string;
  timestamp: string;
  durationMs: number;
  status: "pass" | "fail" | "error";
  actual: {
    escalationFired: boolean;
    escalationTurn?: number;
    stagnantTurnCounts: number[];
    totalStagnantTurns: number;
    urlChanges: number;
  };
  scores: {
    escalationAccuracy: number;
    timingAccuracy: number;
    falsePositiveRate: number;
    falseNegativeRate: number;
    composite: number;
  };
  error?: string;
}

// ── Tool eval types ──────────────────────────────────────────────────

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
