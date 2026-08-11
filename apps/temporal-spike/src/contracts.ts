export const SPIKE_FIXTURES = [
  "normal",
  "disconnect",
  "lost_commit_response",
  "approval_timeout",
  "takeover_race",
  "continue_as_new",
  "account_delete",
] as const;

export const SPIKE_OPERATIONAL_FIXTURES = ["stuck_operation"] as const;
export type SpikeFixture =
  | (typeof SPIKE_FIXTURES)[number]
  | (typeof SPIKE_OPERATIONAL_FIXTURES)[number];
export type SpikeState =
  | "waiting_device"
  | "command_issued"
  | "waiting_result"
  | "waiting_approval"
  | "checkpointing"
  | "completed"
  | "cancelled"
  | "deleted";

export interface SyntheticWorkflowInputV1 {
  schemaVersion: 1;
  fixture: SpikeFixture;
  sessionId: string;
  commandId: string;
  revision: number;
  leaseGeneration: number;
  iteration: number;
  deadlineEpochMs: number;
}

export interface SyntheticWorkflowSnapshotV1 {
  schemaVersion: 1;
  sessionId: string;
  revision: number;
  leaseGeneration: number;
  iteration: number;
  state: SpikeState;
  commandId?: string;
  errorCode?: "approval_timeout" | "cancelled" | "deleted";
}

export const SHADOW_EVENT_TYPES = [
  "session_created",
  "session_updated",
  "checkpoint_committed",
  "device_connected",
  "lease_changed",
  "command_changed",
  "session_deleted",
] as const;
export type ShadowEventType = (typeof SHADOW_EVENT_TYPES)[number];
export interface ShadowEventV1 {
  schemaVersion: 1;
  eventId: string;
  accountHash: string;
  sessionId: string;
  eventType: ShadowEventType;
  revision: number;
  occurredAt: string;
  deadlineAt?: string;
}

export function validateShadowEvent(value: ShadowEventV1): void {
  const allowed = new Set([
    "schemaVersion",
    "eventId",
    "accountHash",
    "sessionId",
    "eventType",
    "revision",
    "occurredAt",
    "deadlineAt",
  ]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    value.schemaVersion !== 1 ||
    !uuid(value.eventId) ||
    !uuid(value.sessionId) ||
    !/^[a-f0-9]{64}$/.test(value.accountHash) ||
    !(SHADOW_EVENT_TYPES as readonly string[]).includes(value.eventType) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    Number.isNaN(Date.parse(value.occurredAt)) ||
    (value.deadlineAt && Number.isNaN(Date.parse(value.deadlineAt)))
  )
    throw new Error("invalid_shadow_event");
}

export type SyntheticSignalV1 =
  | { type: "device_connected"; leaseGeneration: number }
  | {
      type: "command_acknowledged";
      commandId: string;
      leaseGeneration: number;
    }
  | {
      type: "command_result";
      commandId: string;
      leaseGeneration: number;
      outcome: "succeeded" | "failed" | "outcome_unknown";
    }
  | { type: "approval_received"; approved: boolean }
  | { type: "takeover"; leaseGeneration: number }
  | { type: "cancel" }
  | { type: "account_delete" };

const uuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

export function validateSyntheticWorkflowInput(
  value: SyntheticWorkflowInputV1,
): void {
  const allowed = new Set([
    "schemaVersion",
    "fixture",
    "sessionId",
    "commandId",
    "revision",
    "leaseGeneration",
    "iteration",
    "deadlineEpochMs",
  ]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    value.schemaVersion !== 1 ||
    !(
      [...SPIKE_FIXTURES, ...SPIKE_OPERATIONAL_FIXTURES] as readonly string[]
    ).includes(value.fixture) ||
    !uuid(value.sessionId) ||
    !uuid(value.commandId) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Number.isSafeInteger(value.leaseGeneration) ||
    value.leaseGeneration < 0 ||
    !Number.isSafeInteger(value.iteration) ||
    value.iteration < 0 ||
    !Number.isSafeInteger(value.deadlineEpochMs)
  )
    throw new Error("invalid_synthetic_workflow_input");
}
