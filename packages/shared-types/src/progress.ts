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
