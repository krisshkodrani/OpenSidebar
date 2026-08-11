import { Buffer } from "node:buffer";
import type {
  CheckpointCommitV1,
  CheckpointUploadIntentV1,
  CloudSessionMode,
  CreateCloudSessionV1,
  UpdateCloudSessionV1,
  PortableCheckpointV1,
  IssueBrowserCommandV1,
  BrowserPreconditionV1,
} from "@opensidebar/shared-types";
import {
  validatePortableBrowserAction,
  validatePortableCheckpoint,
} from "@opensidebar/shared-types";

export class SessionPolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SessionPolicyError("invalid_request");
  return value as Record<string, unknown>;
};

const exactKeys = (value: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new SessionPolicyError("invalid_request");
};

const uuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const positiveInteger = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) > 0;

const sha256 = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

const mode = (value: unknown): value is CloudSessionMode =>
  value === "cloud_checkpointed" || value === "cloud_archived";

export function parseIdempotencyKey(value: string | undefined): string {
  const key = value?.trim() ?? "";
  if (key.length < 16 || key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key))
    throw new SessionPolicyError("idempotency_key_required");
  return key;
}

export function parseExpectedRevision(value: string | undefined): number {
  const normalized = value?.replace(/^"|"$/g, "") ?? "";
  const revision = Number(normalized);
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new SessionPolicyError("if_match_required");
  return revision;
}

export function parseCreateCloudSession(input: unknown): CreateCloudSessionV1 {
  const value = record(input);
  exactKeys(value, ["schemaVersion", "title", "mode", "runtimeVersion"]);
  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (
    value.schemaVersion !== 1 ||
    !title ||
    Buffer.byteLength(title, "utf8") > 160 ||
    !mode(value.mode) ||
    typeof value.runtimeVersion !== "string" ||
    value.runtimeVersion.length < 1 ||
    value.runtimeVersion.length > 80
  )
    throw new SessionPolicyError("invalid_request");
  return {
    schemaVersion: 1,
    title,
    mode: value.mode,
    runtimeVersion: value.runtimeVersion,
  };
}

export function parseUpdateCloudSession(input: unknown): UpdateCloudSessionV1 {
  const value = record(input);
  exactKeys(value, ["schemaVersion", "title", "mode", "pinned"]);
  if (value.schemaVersion !== 1)
    throw new SessionPolicyError("invalid_request");
  const update: UpdateCloudSessionV1 = { schemaVersion: 1 };
  if ("title" in value) {
    const title = typeof value.title === "string" ? value.title.trim() : "";
    if (!title || Buffer.byteLength(title, "utf8") > 160)
      throw new SessionPolicyError("invalid_request");
    update.title = title;
  }
  if ("mode" in value) {
    if (!mode(value.mode)) throw new SessionPolicyError("invalid_request");
    update.mode = value.mode;
  }
  if ("pinned" in value) {
    if (typeof value.pinned !== "boolean")
      throw new SessionPolicyError("invalid_request");
    update.pinned = value.pinned;
  }
  if (Object.keys(update).length === 1)
    throw new SessionPolicyError("invalid_request");
  return update;
}

export function parseCheckpointUploadIntent(
  input: unknown,
): CheckpointUploadIntentV1 {
  const value = record(input);
  exactKeys(value, [
    "schemaVersion",
    "sessionId",
    "checkpointId",
    "parentCheckpointId",
    "checkpointRevision",
    "sessionRevision",
    "checkpointSchemaVersion",
    "runtimeVersion",
    "ciphertextSizeBytes",
    "ciphertextSha256",
  ]);
  if (
    value.schemaVersion !== 1 ||
    !uuid(value.sessionId) ||
    !uuid(value.checkpointId) ||
    (value.parentCheckpointId !== undefined &&
      !uuid(value.parentCheckpointId)) ||
    !positiveInteger(value.checkpointRevision) ||
    !positiveInteger(value.sessionRevision) ||
    !positiveInteger(value.checkpointSchemaVersion) ||
    typeof value.runtimeVersion !== "string" ||
    value.runtimeVersion.length < 1 ||
    value.runtimeVersion.length > 80 ||
    !positiveInteger(value.ciphertextSizeBytes) ||
    Number(value.ciphertextSizeBytes) > 10 * 1024 * 1024 ||
    !sha256(value.ciphertextSha256)
  )
    throw new SessionPolicyError("invalid_request");
  return value as unknown as CheckpointUploadIntentV1;
}

export function parseCheckpointCommit(input: unknown): CheckpointCommitV1 {
  const value = record(input);
  exactKeys(value, [
    "schemaVersion",
    "checkpointId",
    "ciphertextSizeBytes",
    "ciphertextSha256",
  ]);
  if (
    value.schemaVersion !== 1 ||
    !uuid(value.checkpointId) ||
    !positiveInteger(value.ciphertextSizeBytes) ||
    Number(value.ciphertextSizeBytes) > 10 * 1024 * 1024 ||
    !sha256(value.ciphertextSha256)
  )
    throw new SessionPolicyError("invalid_request");
  return value as unknown as CheckpointCommitV1;
}

export function plaintextSizeBucket(ciphertextSizeBytes: number): string {
  if (ciphertextSizeBytes <= 256 * 1024) return "under_256k";
  if (ciphertextSizeBytes <= 1024 * 1024) return "under_1m";
  if (ciphertextSizeBytes <= 4 * 1024 * 1024) return "under_4m";
  if (ciphertextSizeBytes <= 8 * 1024 * 1024) return "under_8m";
  return "under_10m";
}

export function parsePortableCheckpoint(input: unknown): PortableCheckpointV1 {
  const validation = validatePortableCheckpoint(input);
  if (!validation.valid) throw new SessionPolicyError("invalid_request");
  return validation.value;
}

export function parseCheckpointWriteRequest(input: unknown): {
  schemaVersion: 1;
  sessionRevision: number;
  checkpoint: PortableCheckpointV1;
} {
  const value = record(input);
  exactKeys(value, ["schemaVersion", "sessionRevision", "checkpoint"]);
  if (value.schemaVersion !== 1 || !positiveInteger(value.sessionRevision))
    throw new SessionPolicyError("invalid_request");
  return {
    schemaVersion: 1,
    sessionRevision: Number(value.sessionRevision),
    checkpoint: parsePortableCheckpoint(value.checkpoint),
  };
}

export function parseConnectionRequest(input: unknown): {
  schemaVersion: 1;
  transport: "sse" | "long_poll";
} {
  const value = record(input);
  exactKeys(value, ["schemaVersion", "transport"]);
  if (
    value.schemaVersion !== 1 ||
    (value.transport !== "sse" && value.transport !== "long_poll")
  )
    throw new SessionPolicyError("invalid_request");
  return { schemaVersion: 1, transport: value.transport };
}

export function parseLeaseAcquireRequest(input: unknown): {
  schemaVersion: 1;
  connectionId: string;
  expectedSessionRevision: number;
} {
  const value = record(input);
  exactKeys(value, [
    "schemaVersion",
    "connectionId",
    "expectedSessionRevision",
  ]);
  if (
    value.schemaVersion !== 1 ||
    !uuid(value.connectionId) ||
    !positiveInteger(value.expectedSessionRevision)
  )
    throw new SessionPolicyError("invalid_request");
  return {
    schemaVersion: 1,
    connectionId: String(value.connectionId),
    expectedSessionRevision: Number(value.expectedSessionRevision),
  };
}

export function parseLeaseMutationRequest(input: unknown): {
  schemaVersion: 1;
  connectionId: string;
  leaseId: string;
  generation: number;
  expectedSessionRevision?: number;
} {
  const value = record(input);
  exactKeys(value, [
    "schemaVersion",
    "connectionId",
    "leaseId",
    "generation",
    "expectedSessionRevision",
  ]);
  if (
    value.schemaVersion !== 1 ||
    !uuid(value.connectionId) ||
    !uuid(value.leaseId) ||
    !positiveInteger(value.generation) ||
    (value.expectedSessionRevision !== undefined &&
      !positiveInteger(value.expectedSessionRevision))
  )
    throw new SessionPolicyError("invalid_request");
  return {
    schemaVersion: 1,
    connectionId: String(value.connectionId),
    leaseId: String(value.leaseId),
    generation: Number(value.generation),
    ...(value.expectedSessionRevision !== undefined
      ? {
          expectedSessionRevision: Number(value.expectedSessionRevision),
        }
      : {}),
  };
}

export function parseIssueBrowserCommand(
  input: unknown,
): IssueBrowserCommandV1 {
  const value = record(input);
  exactKeys(value, [
    "schemaVersion",
    "leaseId",
    "leaseGeneration",
    "checkpointRevision",
    "action",
    "preconditions",
    "risk",
    "expiresInSeconds",
    "approval",
  ]);
  const action = record(value.action);
  exactKeys(action, ["kind", "target", "arguments"]);
  if (action.target !== undefined) {
    const target = record(action.target);
    exactKeys(target, [
      "description",
      "expectedRole",
      "expectedName",
      "expectedOrigin",
    ]);
    if (
      typeof target.description !== "string" ||
      target.description.length < 1 ||
      target.description.length > 500 ||
      Object.entries(target).some(
        ([key, field]) =>
          key !== "description" &&
          field !== undefined &&
          (typeof field !== "string" || field.length > 500),
      )
    )
      throw new SessionPolicyError("invalid_request");
  }
  if (!Array.isArray(value.preconditions) || value.preconditions.length > 20)
    throw new SessionPolicyError("invalid_request");
  const preconditions = value.preconditions.map((candidate) => {
    const item = record(candidate);
    exactKeys(item, ["kind", "value"]);
    if (
      ![
        "origin",
        "capability",
        "semantic_target",
        "fresh_observation",
        "local_policy",
      ].includes(String(item.kind)) ||
      typeof item.value !== "string" ||
      item.value.length < 1 ||
      item.value.length > 500
    )
      throw new SessionPolicyError("invalid_request");
    return item as unknown as BrowserPreconditionV1;
  });
  const approval =
    value.approval === undefined ? undefined : record(value.approval);
  if (approval) {
    exactKeys(approval, [
      "approvalId",
      "approvedAt",
      "expiresAt",
      "actionDigest",
    ]);
    if (
      !uuid(approval.approvalId) ||
      typeof approval.approvedAt !== "string" ||
      typeof approval.expiresAt !== "string" ||
      Number.isNaN(Date.parse(approval.approvedAt)) ||
      Date.parse(approval.expiresAt) <= Date.now() ||
      !sha256(approval.actionDigest)
    )
      throw new SessionPolicyError("invalid_request");
  }
  if (
    value.schemaVersion !== 1 ||
    !uuid(value.leaseId) ||
    !positiveInteger(value.leaseGeneration) ||
    !Number.isSafeInteger(value.checkpointRevision) ||
    Number(value.checkpointRevision) < 0 ||
    !action.arguments ||
    typeof action.arguments !== "object" ||
    Array.isArray(action.arguments) ||
    !["read", "reversible_write", "sensitive_write"].includes(
      String(value.risk),
    ) ||
    !positiveInteger(value.expiresInSeconds) ||
    Number(value.expiresInSeconds) > 300 ||
    validatePortableBrowserAction(action as never).valid === false
  )
    throw new SessionPolicyError("invalid_request");
  return {
    schemaVersion: 1,
    leaseId: String(value.leaseId),
    leaseGeneration: Number(value.leaseGeneration),
    checkpointRevision: Number(value.checkpointRevision),
    action: action as unknown as IssueBrowserCommandV1["action"],
    preconditions,
    risk: value.risk as IssueBrowserCommandV1["risk"],
    expiresInSeconds: Number(value.expiresInSeconds),
    ...(approval
      ? {
          approval: approval as unknown as NonNullable<
            IssueBrowserCommandV1["approval"]
          >,
        }
      : {}),
  };
}

export function parseCommandMutationRequest(input: unknown): {
  schemaVersion: 1;
  leaseId: string;
  leaseGeneration: number;
  outcomeCode?: "verified" | "not_achieved" | "unknown_after_interruption";
} {
  const value = record(input);
  exactKeys(value, [
    "schemaVersion",
    "leaseId",
    "leaseGeneration",
    "outcomeCode",
  ]);
  const outcomes = ["verified", "not_achieved", "unknown_after_interruption"];
  if (
    value.schemaVersion !== 1 ||
    !uuid(value.leaseId) ||
    !positiveInteger(value.leaseGeneration) ||
    (value.outcomeCode !== undefined &&
      !outcomes.includes(String(value.outcomeCode)))
  )
    throw new SessionPolicyError("invalid_request");
  return {
    schemaVersion: 1,
    leaseId: String(value.leaseId),
    leaseGeneration: Number(value.leaseGeneration),
    ...(value.outcomeCode
      ? {
          outcomeCode: value.outcomeCode as
            | "verified"
            | "not_achieved"
            | "unknown_after_interruption",
        }
      : {}),
  };
}
