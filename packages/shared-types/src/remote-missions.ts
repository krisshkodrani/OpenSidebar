export const REMOTE_MISSION_SCHEMA_VERSION = 1 as const;

export const REMOTE_MISSION_STATES = [
  "queued",
  "accepted",
  "running",
  "target_selection_required",
  "approval_required",
  "succeeded",
  "failed",
  "cancelled",
  "outcome_unknown",
] as const;

export type RemoteMissionState = (typeof REMOTE_MISSION_STATES)[number];

export interface RemoteMissionV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  missionId: string;
  deviceId: string;
  createdAt: string;
  expiresAt: string;
  state: RemoteMissionState;
  sequence: number;
  resultCode?: "completed" | "not_achieved" | "cancelled" | "unknown";
}

/** Plaintext delivery body. Services must not log or persist this unencrypted. */
export interface RemoteMissionPayloadV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  missionId: string;
  executionClass: "read_only";
  instruction: string;
  initialUrl?: string;
  /** Selects an existing visible tab or an isolated task tab on the device. */
  targetContext?: "active_tab" | "existing_tab" | "isolated_tab";
}

/** Encrypted-at-rest, bounded terminal artifact returned to the coordinator. */
export interface RemoteMissionResultV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  missionId: string;
  outcome: "completed" | "not_achieved" | "cancelled" | "unknown";
  createdAt: string;
  summary?: string;
  diagnostic?: string;
}

/** Bounded encrypted live state; never includes raw page or tool output. */
export interface RemoteMissionProgressV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  missionId: string;
  state: "accepted" | "running" | "target_selection_required" | "approval_required";
  updatedAt: string;
  summary?: string;
  approval?: RemoteMissionApprovalV1;
  targetSelection?: RemoteMissionTargetSelectionV1;
}

export interface RemoteMissionTargetCandidateV1 {
  targetHandle: string;
  pageTitle: string;
  groupTitle?: string;
  windowLabel?: string;
}

export interface RemoteMissionTargetSelectionV1 {
  expiresAt: string;
  candidates: RemoteMissionTargetCandidateV1[];
}

export interface RemoteMissionTargetDecisionV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  missionId: string;
  targetHandle: string;
  decidedAt: string;
}

/** Immutable encrypted account decision consumed only by the selected device. */
export interface RemoteMissionApprovalDecisionV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  missionId: string;
  approvalId: string;
  actionDigest: string;
  approved: boolean;
  decidedAt: string;
}

export interface RemoteMissionStatusV1 extends RemoteMissionV1 {
  progress?: RemoteMissionProgressV1;
  result?: RemoteMissionResultV1;
}

export type RemoteMissionEvidenceOutcome =
  | "achieved"
  | "not_achieved"
  | "approval_required"
  | "unknown";

export interface MissionStepV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  missionId: string;
  stepId: string;
  planRevision: number;
  risk: "read_only" | "reversible" | "consequential";
  objective: string;
  successCriteria: string[];
  constraints?: string[];
  prohibitedEffects?: string[];
}

export interface MissionSpecV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  missionId: string;
  deviceId: string;
  objective: string;
  successCriteria: string[];
  constraints?: string[];
  prohibitedEffects?: string[];
  planRevision: number;
  steps: MissionStepV1[];
  expiresAt: string;
  targetContext?: "active_tab" | "existing_tab" | "isolated_tab";
}

export interface MissionEvidenceClaimV1 {
  claim: string;
  source:
    | "page_observation"
    | "form_field_readback"
    | "navigation"
    | "download"
    | "agent_summary";
}

export interface MissionEvidenceV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  missionId: string;
  stepId: string;
  attemptId: string;
  planRevision: number;
  outcome: RemoteMissionEvidenceOutcome;
  page?: { origin: string; title?: string };
  claims: MissionEvidenceClaimV1[];
  effects: Array<{ type: string; consequential: boolean }>;
  uncertainties: string[];
  approval?: RemoteMissionApprovalV1;
}

export type SupervisorDecisionKind =
  | "continue"
  | "retry"
  | "replace_remaining_plan"
  | "request_evidence"
  | "request_user_input"
  | "request_approval"
  | "select_target"
  | "complete"
  | "stop";

export interface SupervisorDecisionV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  decisionId: string;
  missionId: string;
  stepId: string;
  expectedPlanRevision: number;
  kind: SupervisorDecisionKind;
  guidance?: string;
  replacementSteps?: MissionStepV1[];
  outcome?: "completed" | "not_achieved" | "cancelled" | "unknown";
  targetHandle?: string;
}

export interface MissionAttemptV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  missionId: string;
  stepId: string;
  attemptId: string;
  planRevision: number;
  state: "accepted" | "running" | "target_selection_required" | "approval_required" | "terminal";
  mayHaveConsequentialEffect: boolean;
  updatedAt: string;
}

export interface CreateRemoteMissionV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  deviceId: string;
  instruction: string;
  initialUrl?: string;
  targetContext?: "active_tab" | "existing_tab" | "isolated_tab";
  expiresInSeconds?: number;
}

export interface DeliveredRemoteMissionV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  mission: RemoteMissionV1;
  payload: RemoteMissionPayloadV1;
}

export interface RemoteMissionApprovalV1 {
  approvalId: string;
  question: string;
  expiresAt: string;
  actionDigest?: string;
}

export type RemoteMissionRunResultV1 =
  | { state: "succeeded"; summary?: string }
  | { state: "approval_required"; summary?: string; approval: RemoteMissionApprovalV1 }
  | { state: "target_selection_required"; targetSelection: RemoteMissionTargetSelectionV1 }
  | { state: "failed"; summary?: string }
  | { state: "outcome_unknown"; summary?: string };

export interface RemoteMissionTransitionV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  to: Exclude<RemoteMissionState, "queued">;
  resultCode?: RemoteMissionV1["resultCode"];
}

export const isRemoteMissionTerminal = (state: RemoteMissionState) =>
  state === "succeeded" ||
  state === "failed" ||
  state === "cancelled" ||
  state === "outcome_unknown";
