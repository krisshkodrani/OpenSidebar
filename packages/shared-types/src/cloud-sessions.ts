/** Versioned contracts for LP-29 through LP-31. */

export const CLOUD_SESSION_SCHEMA_VERSION = 1 as const;
export const PORTABLE_CHECKPOINT_SCHEMA_VERSION = 1 as const;
export const DEVICE_COMMAND_SCHEMA_VERSION = 1 as const;

export type SessionId = string;
export type CheckpointId = string;
export type DeviceId = string;
export type ConnectionId = string;
export type LeaseId = string;
export type CommandId = string;
export type AttemptId = string;
export type IdempotencyKey = string;

export type CloudSessionMode = "cloud_checkpointed" | "cloud_archived";
export type CloudSessionStatus =
  | "created"
  | "active"
  | "waiting_for_user"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "deleting";

export interface CloudSessionV1 {
  schemaVersion: typeof CLOUD_SESSION_SCHEMA_VERSION;
  sessionId: SessionId;
  title: string;
  mode: CloudSessionMode;
  status: CloudSessionStatus;
  revision: number;
  latestCheckpointId?: CheckpointId;
  latestCheckpointRevision?: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  completedAt?: string;
  pinned: boolean;
  expiresAt?: string;
  runtimeVersion: string;
  checkpointSchemaVersion?: number;
  sizeBytes: number;
}

export type CloudCheckpointState =
  | "upload_pending"
  | "committed"
  | "superseded"
  | "deleting"
  | "corrupt";

export interface CloudCheckpointIndexV1 {
  schemaVersion: typeof CLOUD_SESSION_SCHEMA_VERSION;
  sessionId: SessionId;
  checkpointId: CheckpointId;
  parentCheckpointId?: CheckpointId;
  revision: number;
  createdAt: string;
  runtimeVersion: string;
  checkpointSchemaVersion: number;
  state: CloudCheckpointState;
  ciphertextSizeBytes: number;
  plaintextSizeBucket: string;
  ciphertextSha256: string;
}

export interface SessionObjectiveV1 {
  originalRequest: string;
  currentInterpretation: string;
  successCriteria: string[];
  userConstraints: string[];
}

export type ConversationRoleV1 = "user" | "assistant" | "tool" | "summary";

export interface ConversationMessageV1 {
  id: string;
  role: ConversationRoleV1;
  content: string;
  createdAt: string;
  provenance?: "user" | "model" | "tool" | "compacted";
  uncertainty?: "none" | "low" | "medium" | "high";
}

export interface ConversationProjectionV1 {
  messages: ConversationMessageV1[];
}

export interface ExecutionProjectionV1 {
  plan: Array<{
    stepId: string;
    description: string;
    status: "pending" | "in_progress" | "completed" | "blocked";
    evidenceRefs: string[];
  }>;
  completedActions: Array<{
    actionId: string;
    kind: string;
    summary: string;
    observedOutcome: string;
    evidenceType: string;
  }>;
  unresolvedFacts: Array<{
    statement: string;
    confidence: "low" | "medium" | "high";
  }>;
  partialHandoff?: {
    completed: string[];
    remaining: string[];
    uncertain: string[];
  };
}

export interface GroundingHintV1 {
  lastKnownUrl?: string;
  expectedOrigins: string[];
  pageTitle?: string;
  pageFingerprint?: string;
  userVisibleStateSummary: string;
  requiredCapabilities: Array<"navigation" | "forms" | "downloads" | "tabs">;
}

export type PendingStateV1 =
  | { kind: "none" }
  | { kind: "clarification"; question: string; askedAt: string }
  | {
      kind: "approval_required";
      actionSummary: string;
      risk: "low" | "medium" | "high";
      requestedAt: string;
      expiresAt: string;
    }
  | {
      kind: "browser_result_unknown";
      actionSummary: string;
      startedAt: string;
    };

export interface UsageProjectionV1 {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  imageTokenEstimate: number;
  turns: number;
}

export type PortableCheckpointReason =
  | "periodic"
  | "before_navigation"
  | "after_verified_action"
  | "waiting_for_user"
  | "pause"
  | "terminal";

export interface PortableCheckpointV1 {
  schemaVersion: typeof PORTABLE_CHECKPOINT_SCHEMA_VERSION;
  sessionId: SessionId;
  checkpointId: CheckpointId;
  parentCheckpointId?: CheckpointId;
  revision: number;
  createdAt: string;
  runtimeVersion: string;
  reason: PortableCheckpointReason;
  objective: SessionObjectiveV1;
  conversation: ConversationProjectionV1;
  execution: ExecutionProjectionV1;
  grounding: GroundingHintV1;
  pending: PendingStateV1;
  usage: UsageProjectionV1;
}

export type CheckpointCompatibility =
  | "compatible"
  | "migratable_previous"
  | "read_only_older"
  | "read_only_newer"
  | "runtime_incompatible"
  | "corrupt";

export type RestoreGroundingResult =
  | "matched"
  | "changed"
  | "unavailable"
  | "unauthorized";

export interface CloudDeviceRegistrationV1 {
  schemaVersion: typeof DEVICE_COMMAND_SCHEMA_VERSION;
  deviceId: DeviceId;
  displayName: string;
  extensionVersion: string;
  browserVersion: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt?: string;
  notificationCapabilities: string[];
}

export interface CloudDeviceConnectionV1 {
  schemaVersion: typeof DEVICE_COMMAND_SCHEMA_VERSION;
  connectionId: ConnectionId;
  deviceId: DeviceId;
  transport: "sse" | "long_poll";
  lastAcknowledgedSequence: number;
  connectedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export type SessionLeaseState = "active" | "grace" | "revoked" | "expired";

export interface SessionLeaseV1 {
  schemaVersion: typeof DEVICE_COMMAND_SCHEMA_VERSION;
  sessionId: SessionId;
  leaseId: LeaseId;
  deviceId: DeviceId;
  generation: number;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  checkpointRevision: number;
  state: SessionLeaseState;
}

export interface SemanticTargetV1 {
  description: string;
  expectedRole?: string;
  expectedName?: string;
  expectedOrigin?: string;
}

export type PortableActionValue =
  | null
  | boolean
  | number
  | string
  | PortableActionValue[]
  | { [key: string]: PortableActionValue };

export interface PortableBrowserActionV1 {
  kind: string;
  target?: SemanticTargetV1;
  arguments: Record<string, PortableActionValue>;
}

export interface BrowserPreconditionV1 {
  kind:
    | "origin"
    | "capability"
    | "semantic_target"
    | "fresh_observation"
    | "local_policy";
  value: string;
}

export type BrowserCommandRisk =
  | "read"
  | "reversible_write"
  | "sensitive_write";

export interface BrowserCommandV1 {
  schemaVersion: typeof DEVICE_COMMAND_SCHEMA_VERSION;
  sessionId: SessionId;
  commandId: CommandId;
  leaseId: LeaseId;
  leaseGeneration: number;
  checkpointRevision: number;
  createdAt: string;
  expiresAt: string;
  action: PortableBrowserActionV1;
  preconditions: BrowserPreconditionV1[];
  risk: BrowserCommandRisk;
  approval?: {
    approvalId: string;
    approvedAt: string;
    expiresAt: string;
    actionDigest: string;
  };
}

export interface IssueBrowserCommandV1 {
  schemaVersion: typeof DEVICE_COMMAND_SCHEMA_VERSION;
  leaseId: LeaseId;
  leaseGeneration: number;
  checkpointRevision: number;
  action: PortableBrowserActionV1;
  preconditions: BrowserPreconditionV1[];
  risk: BrowserCommandRisk;
  expiresInSeconds: number;
  approval?: BrowserCommandV1["approval"];
}

export type BrowserCommandState =
  | "pending"
  | "leased"
  | "delivered"
  | "accepted"
  | "started"
  | "succeeded"
  | "failed"
  | "outcome_unknown"
  | "expired"
  | "cancelled";

export type BrowserCommandOutcome = "succeeded" | "failed" | "outcome_unknown";
export type DeviceCommandOutcomeCode =
  | "verified"
  | "not_achieved"
  | "unknown_after_interruption";

export interface DeviceCommandRecordV1 {
  schemaVersion: typeof DEVICE_COMMAND_SCHEMA_VERSION;
  sessionId: SessionId;
  commandId: CommandId;
  sequence: number;
  leaseId: LeaseId;
  leaseGeneration: number;
  checkpointRevision: number;
  commandKind: string;
  risk: BrowserCommandRisk;
  actionDigest: string;
  state: BrowserCommandState;
  outcomeCode?: DeviceCommandOutcomeCode;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface DeliveredBrowserCommandV1 {
  schemaVersion: typeof DEVICE_COMMAND_SCHEMA_VERSION;
  record: DeviceCommandRecordV1;
  command: BrowserCommandV1;
}

export interface AttemptRecordV1 {
  commandId: CommandId;
  attemptId: AttemptId;
  actionDigest: string;
  leaseGeneration: number;
  checkpointRevision: number;
  state:
    | "accepted"
    | "started"
    | "observed_succeeded"
    | "observed_failed"
    | "unknown";
  updatedAt: number;
}

export interface CreateCloudSessionV1 {
  schemaVersion: typeof CLOUD_SESSION_SCHEMA_VERSION;
  title: string;
  mode: CloudSessionMode;
  runtimeVersion: string;
}

export interface UpdateCloudSessionV1 {
  schemaVersion: typeof CLOUD_SESSION_SCHEMA_VERSION;
  title?: string;
  mode?: CloudSessionMode;
  pinned?: boolean;
}

export interface CheckpointUploadIntentV1 {
  schemaVersion: typeof CLOUD_SESSION_SCHEMA_VERSION;
  sessionId: SessionId;
  checkpointId: CheckpointId;
  parentCheckpointId?: CheckpointId;
  checkpointRevision: number;
  sessionRevision: number;
  checkpointSchemaVersion: number;
  runtimeVersion: string;
  ciphertextSizeBytes: number;
  ciphertextSha256: string;
}

export interface CheckpointCommitV1 {
  schemaVersion: typeof CLOUD_SESSION_SCHEMA_VERSION;
  checkpointId: CheckpointId;
  ciphertextSizeBytes: number;
  ciphertextSha256: string;
}

export interface TemporalSessionWorkflowRefV1 {
  schemaVersion: 1;
  sessionId: SessionId;
  revision: number;
  leaseGeneration: number;
  state: CloudSessionStatus;
  deadline?: string;
  errorCode?: string;
}
