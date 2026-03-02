/**
 * Types for the E2E snapshot-replay evaluation pipeline.
 */

/** Shape of a curated E2E golden case (matches the JSON files in evals/golden/e2e/) */
export interface E2EGoldenCase {
  id: string;
  sourceSessionId: string;
  sourceType: "manual-recording";
  stepNumber: number;
  challengeUrl: string;
  entrySnapshot: {
    url: string;
    title: string;
    elementCount: number;
    scrollY: number;
  };
  entryElements: E2EElement[];
  solution: {
    code: string;
    codeInputId: number;
    submitButtonId: number;
  };
  puzzleInputs?: unknown[];
  actions: {
    total: number;
    exploration: number;
    solutionPhase: number;
    sequence: E2EAction[];
  };
  metrics: {
    turnRange: [number, number];
    turnCount: number;
    actionCount: number;
  };
  metadata: {
    curatedAt: string;
    curatedFrom: string;
    notes: string | null;
  };
}

export interface E2EElement {
  tag: number;
  tagName: string;
  role: string;
  text: string;
  attributes: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  isVisible: boolean;
  isDisabled: boolean;
}

export interface E2EAction {
  tool: string;
  args: Record<string, unknown>;
  elementContext?: {
    tag: number;
    tagName: string;
    role?: string;
    text: string;
    attributes?: Record<string, string>;
  };
}

/** Result of running one E2E eval case */
export interface E2EEvalResult {
  caseId: string;
  stepNumber: number;
  timestamp: string;
  durationMs: number;
  status: "pass" | "fail" | "error";
  modelVersion?: string;
  actual: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
  };
  scores: {
    codeDiscovery: number;
    toolSelection: number;
    solutionActions: number;
    actionEfficiency: number;
    elementTargeting: number;
    composite: number;
    judge?: E2EJudgeScore;
  };
  error?: string;
}

export interface E2EJudgeScore {
  puzzleSolving: number;
  codeIdentification: number;
  actionPrecision: number;
  distractorAvoidance: number;
  reasoning: string;
  promptFixSuggestion?: string;
  pass: boolean;
}

// ── Multi-turn eval types ─────────────────────────────────────────────

/** Per-turn data extracted from a trace JSONL file */
export interface TraceTurn {
  turnNumber: number;
  snapshot: { url: string; title: string; elementCount: number; scrollY: number };
  elements: E2EElement[];
  goldenToolCall: { name: string; args: Record<string, unknown> };
  goldenResult: string;
}

/** Score for a single turn in the multi-turn eval */
export interface E2ETurnScore {
  turnNumber: number;
  toolMatch: boolean;
  argsMatch: number;
  expectedTool: string;
  expectedArgs: Record<string, unknown>;
  actualTool: string | null;
  actualArgs: Record<string, unknown>;
  isSolutionPhase: boolean;
}

/** Result of running one multi-turn E2E eval case */
export interface E2EMultiturnResult {
  caseId: string;
  stepNumber: number;
  timestamp: string;
  durationMs: number;
  status: "pass" | "fail" | "error";
  modelVersion?: string;
  turnCount: number;
  turnScores: E2ETurnScore[];
  scores: {
    turnAccuracy: number;
    argAccuracy: number;
    solutionAccuracy: number;
    explorationAccuracy: number;
    composite: number;
  };
  error?: string;
}
