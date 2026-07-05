export type TaskRunProgressKind =
  | "reviewed-item-list"
  | "extracted-fact-map"
  | "completed-phase-list"
  | "outstanding-question-list";

export type TaskRunProgressFactValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | boolean[]
  | Record<string, unknown>;

export interface ReviewedItemListProgressInput {
  key: string;
  kind: "reviewed-item-list";
  payload: string[];
}

export interface ExtractedFactMapProgressInput {
  key: string;
  kind: "extracted-fact-map";
  payload: Record<string, TaskRunProgressFactValue>;
}

export interface CompletedPhaseListProgressInput {
  key: string;
  kind: "completed-phase-list";
  payload: string[];
}

export interface OutstandingQuestionListProgressInput {
  key: string;
  kind: "outstanding-question-list";
  payload: string[];
}

export type TaskRunProgressInput =
  | ReviewedItemListProgressInput
  | ExtractedFactMapProgressInput
  | CompletedPhaseListProgressInput
  | OutstandingQuestionListProgressInput;

export type TaskRunProgressPayload = TaskRunProgressInput["payload"];

export type PartialHandoffReason =
  | "max_turns"
  | "timeout"
  | "tool_error"
  | "provider_error"
  | "manual_stop"
  | "escalation_failed";

export type HandoffConfidence = "high" | "medium" | "low";

export interface HandoffItem {
  text: string;
  confidence: HandoffConfidence;
  source?: "tool" | "page" | "planner" | "completion_evidence" | "trace";
}

export interface HandoffEvidence {
  label: string;
  value: string;
  source:
    | "read_page"
    | "perception"
    | "tool_result"
    | "url"
    | "completion_evidence";
  url?: string;
  turn?: number;
}

export interface HandoffState {
  url?: string;
  title?: string;
  pageKind?: string;
  activeSubtask?: string;
  lastAction?: string;
}

export interface PartialProgressHandoff {
  schemaVersion: "2026-05-26";
  reason: PartialHandoffReason;
  status: "partial_handoff";
  task: string;
  generatedAt: string;
  turnsUsed: number;
  maxTurns: number;
  completed: HandoffItem[];
  evidence: HandoffEvidence[];
  currentState: HandoffState;
  remaining: HandoffItem[];
  uncertainty: HandoffItem[];
  suggestedContinuationPrompt: string;
}
