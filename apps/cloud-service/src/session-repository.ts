import type {
  CheckpointUploadIntentV1,
  CloudCheckpointIndexV1,
  CloudSessionV1,
  CloudSessionStatus,
  CreateCloudSessionV1,
  UpdateCloudSessionV1,
} from "@opensidebar/shared-types";

export type SessionListCursor = {
  updatedAt: Date;
  sessionId: string;
};

export type SessionListPage = {
  sessions: CloudSessionV1[];
  nextCursor?: SessionListCursor;
};

export type RepositoryMutation<T> =
  | { kind: "created" | "updated" | "replayed"; value: T }
  | { kind: "not_found" | "revision_conflict" | "checkpoint_conflict" };

export type SessionExportJob = {
  jobId: string;
  sessionId: string;
  state: "pending" | "running" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  expiresAt?: string;
  errorCode?: string;
};

export interface SessionRepository {
  migrate(): Promise<void>;
  health(): Promise<void>;
  cleanupExpired(): Promise<void>;
  createSession(
    accountId: string,
    sessionId: string,
    idempotencyHash: string,
    input: CreateCloudSessionV1,
  ): Promise<RepositoryMutation<CloudSessionV1>>;
  listSessions(
    accountId: string,
    limit: number,
    cursor?: SessionListCursor,
    status?: CloudSessionStatus,
  ): Promise<SessionListPage>;
  session(accountId: string, sessionId: string): Promise<CloudSessionV1 | null>;
  updateSession(
    accountId: string,
    sessionId: string,
    expectedRevision: number,
    idempotencyHash: string,
    input: UpdateCloudSessionV1,
  ): Promise<RepositoryMutation<CloudSessionV1>>;
  deleteSession(
    accountId: string,
    sessionId: string,
    expectedRevision: number,
    idempotencyHash: string,
  ): Promise<RepositoryMutation<CloudSessionV1>>;
  requestExport(
    accountId: string,
    sessionId: string,
    jobId: string,
    expectedRevision: number,
    idempotencyHash: string,
  ): Promise<RepositoryMutation<SessionExportJob>>;
  exportJob(
    accountId: string,
    sessionId: string,
    jobId: string,
  ): Promise<SessionExportJob | null>;
  createCheckpointIntent(
    accountId: string,
    objectKey: string,
    idempotencyHash: string,
    input: CheckpointUploadIntentV1,
    plaintextSizeBucket: string,
  ): Promise<RepositoryMutation<CloudCheckpointIndexV1>>;
  commitCheckpoint(
    accountId: string,
    sessionId: string,
    checkpointId: string,
    expectedSessionRevision: number,
    idempotencyHash: string,
    ciphertextSizeBytes: number,
    ciphertextSha256: string,
  ): Promise<
    RepositoryMutation<{
      session: CloudSessionV1;
      checkpoint: CloudCheckpointIndexV1;
    }>
  >;
  latestCheckpoint(
    accountId: string,
    sessionId: string,
  ): Promise<CloudCheckpointIndexV1 | null>;
  checkpoint(
    accountId: string,
    sessionId: string,
    checkpointId: string,
  ): Promise<CloudCheckpointIndexV1 | null>;
  close(): Promise<void>;
}
