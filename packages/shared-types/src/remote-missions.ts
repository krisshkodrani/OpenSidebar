export const REMOTE_MISSION_SCHEMA_VERSION = 1 as const;

export const REMOTE_MISSION_STATES = [
  "queued",
  "accepted",
  "running",
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
  instruction: string;
  initialUrl?: string;
}

export interface CreateRemoteMissionV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  deviceId: string;
  instruction: string;
  initialUrl?: string;
  expiresInSeconds?: number;
}

export interface DeliveredRemoteMissionV1 {
  schemaVersion: typeof REMOTE_MISSION_SCHEMA_VERSION;
  mission: RemoteMissionV1;
  payload: RemoteMissionPayloadV1;
}

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
