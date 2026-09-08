import type {
  CheckpointUploadIntentV1,
  CloudCheckpointIndexV1,
  CloudSessionV1,
  CloudSessionStatus,
  CreateCloudSessionV1,
  UpdateCloudSessionV1,
} from "@opensidebar/shared-types";
import type {
  SessionListCursor,
  SessionRepository,
} from "../src/session-repository.js";

export class MemorySessionRepository implements SessionRepository {
  sessions = new Map<string, CloudSessionV1 & { accountId: string }>();
  checkpoints = new Map<
    string,
    CloudCheckpointIndexV1 & { accountId: string }
  >();
  idempotency = new Map<string, string>();
  exportJobs = new Map<string, import("../src/session-repository.js").SessionExportJob & { accountId: string }>();

  private publicSession(
    value: CloudSessionV1 & { accountId: string },
  ): CloudSessionV1 {
    const { accountId: _accountId, ...session } = value;
    return session;
  }

  private publicCheckpoint(
    value: CloudCheckpointIndexV1 & { accountId: string },
  ): CloudCheckpointIndexV1 {
    const { accountId: _accountId, ...checkpoint } = value;
    return checkpoint;
  }

  async migrate() {}
  async health() {}
  async cleanupExpired() {}
  async close() {}

  private key(accountId: string, operation: string, hash: string) {
    return `${accountId}:${operation}:${hash}`;
  }

  async createSession(
    accountId: string,
    sessionId: string,
    idempotencyHash: string,
    input: CreateCloudSessionV1,
  ) {
    const key = this.key(accountId, "session.create", idempotencyHash);
    const prior = this.idempotency.get(key);
    if (prior) {
      const value = this.sessions.get(prior);
      return value
        ? { kind: "replayed" as const, value: this.publicSession(value) }
        : { kind: "not_found" as const };
    }
    const now = new Date().toISOString();
    const value = {
      schemaVersion: 1 as const,
      accountId,
      sessionId,
      title: input.title,
      mode: input.mode,
      status: "created" as const,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      pinned: false,
      runtimeVersion: input.runtimeVersion,
      sizeBytes: 0,
    };
    this.sessions.set(sessionId, value);
    this.idempotency.set(key, sessionId);
    return { kind: "created" as const, value: this.publicSession(value) };
  }

  async listSessions(
    accountId: string,
    limit: number,
    _cursor?: SessionListCursor,
    status?: CloudSessionStatus,
  ) {
    return {
      sessions: [...this.sessions.values()]
        .filter(
          (value) =>
            value.accountId === accountId &&
            (!status || value.status === status),
        )
        .slice(0, limit)
        .map((value) => this.publicSession(value)),
    };
  }

  async session(accountId: string, sessionId: string) {
    const value = this.sessions.get(sessionId);
    return value?.accountId === accountId ? this.publicSession(value) : null;
  }

  async updateSession(
    accountId: string,
    sessionId: string,
    expectedRevision: number,
    _idempotencyHash: string,
    input: UpdateCloudSessionV1,
  ) {
    const prior = this.sessions.get(sessionId);
    if (!prior || prior.accountId !== accountId)
      return { kind: "not_found" as const };
    if (prior.revision !== expectedRevision)
      return { kind: "revision_conflict" as const };
    const value = {
      ...prior,
      ...(input.title ? { title: input.title } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      revision: prior.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, value);
    return { kind: "updated" as const, value: this.publicSession(value) };
  }

  async deleteSession(
    accountId: string,
    sessionId: string,
    expectedRevision: number,
    _idempotencyHash: string,
  ) {
    const prior = this.sessions.get(sessionId);
    if (!prior || prior.accountId !== accountId)
      return { kind: "not_found" as const };
    if (prior.revision !== expectedRevision)
      return { kind: "revision_conflict" as const };
    const value = {
      ...prior,
      status: "deleting" as const,
      revision: prior.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, value);
    return { kind: "updated" as const, value: this.publicSession(value) };
  }

  async requestExport(
    accountId: string,
    sessionId: string,
    jobId: string,
    expectedRevision: number,
    idempotencyHash: string,
  ) {
    const session = this.sessions.get(sessionId);
    if (!session || session.accountId !== accountId || session.status === "deleting")
      return { kind: "not_found" as const };
    if (session.revision !== expectedRevision)
      return { kind: "revision_conflict" as const };
    const key = this.key(accountId, `session.export:${sessionId}`, idempotencyHash);
    const priorId = this.idempotency.get(key);
    const prior = priorId ? this.exportJobs.get(priorId) : undefined;
    if (prior) {
      const { accountId: _accountId, ...value } = prior;
      return { kind: "replayed" as const, value };
    }
    const value = {
      accountId,
      jobId,
      sessionId,
      state: "pending" as const,
      createdAt: new Date().toISOString(),
    };
    this.exportJobs.set(jobId, value);
    this.idempotency.set(key, jobId);
    const { accountId: _accountId, ...publicValue } = value;
    return { kind: "created" as const, value: publicValue };
  }

  async exportJob(accountId: string, sessionId: string, jobId: string) {
    const value = this.exportJobs.get(jobId);
    if (!value || value.accountId !== accountId || value.sessionId !== sessionId)
      return null;
    const { accountId: _accountId, ...publicValue } = value;
    return publicValue;
  }

  async createCheckpointIntent(
    accountId: string,
    _objectKey: string,
    _idempotencyHash: string,
    input: CheckpointUploadIntentV1,
    plaintextSizeBucket: string,
  ) {
    const value = {
      schemaVersion: 1 as const,
      accountId,
      sessionId: input.sessionId,
      checkpointId: input.checkpointId,
      ...(input.parentCheckpointId
        ? { parentCheckpointId: input.parentCheckpointId }
        : {}),
      revision: input.checkpointRevision,
      createdAt: new Date().toISOString(),
      runtimeVersion: input.runtimeVersion,
      checkpointSchemaVersion: input.checkpointSchemaVersion,
      state: "upload_pending" as const,
      ciphertextSizeBytes: input.ciphertextSizeBytes,
      plaintextSizeBucket,
      ciphertextSha256: input.ciphertextSha256,
    };
    this.checkpoints.set(input.checkpointId, value);
    return { kind: "created" as const, value: this.publicCheckpoint(value) };
  }

  async commitCheckpoint(
    accountId: string,
    sessionId: string,
    checkpointId: string,
    expectedSessionRevision: number,
    _idempotencyHash: string,
    ciphertextSizeBytes: number,
    ciphertextSha256: string,
  ) {
    const session = this.sessions.get(sessionId);
    const checkpoint = this.checkpoints.get(checkpointId);
    if (
      !session ||
      session.accountId !== accountId ||
      !checkpoint ||
      checkpoint.accountId !== accountId
    )
      return { kind: "not_found" as const };
    if (
      session.revision !== expectedSessionRevision ||
      checkpoint.ciphertextSizeBytes !== ciphertextSizeBytes ||
      checkpoint.ciphertextSha256 !== ciphertextSha256
    )
      return { kind: "checkpoint_conflict" as const };
    const committed = { ...checkpoint, state: "committed" as const };
    const updated = {
      ...session,
      latestCheckpointId: checkpointId,
      latestCheckpointRevision: checkpoint.revision,
      checkpointSchemaVersion: checkpoint.checkpointSchemaVersion,
      sizeBytes: checkpoint.ciphertextSizeBytes,
      revision: session.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    this.checkpoints.set(checkpointId, committed);
    this.sessions.set(sessionId, updated);
    return {
      kind: "updated" as const,
      value: {
        session: this.publicSession(updated),
        checkpoint: this.publicCheckpoint(committed),
      },
    };
  }

  async latestCheckpoint(accountId: string, sessionId: string) {
    const value = [...this.checkpoints.values()].find(
      (candidate) =>
        candidate.accountId === accountId &&
        candidate.sessionId === sessionId &&
        candidate.state === "committed",
    );
    return value ? this.publicCheckpoint(value) : null;
  }

  async checkpoint(accountId: string, sessionId: string, checkpointId: string) {
    const value = this.checkpoints.get(checkpointId);
    return value?.accountId === accountId && value.sessionId === sessionId
      ? this.publicCheckpoint(value)
      : null;
  }
}
