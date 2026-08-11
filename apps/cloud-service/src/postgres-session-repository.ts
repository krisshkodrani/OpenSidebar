import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import type {
  CheckpointUploadIntentV1,
  CloudCheckpointIndexV1,
  CloudSessionV1,
  CloudSessionStatus,
  CreateCloudSessionV1,
  UpdateCloudSessionV1,
} from "@opensidebar/shared-types";
import type {
  RepositoryMutation,
  SessionListCursor,
  SessionExportJob,
  SessionRepository,
} from "./session-repository.js";
import {
  TemporalShadowOutbox,
  type TemporalShadowEventType,
} from "./temporal-shadow-outbox.js";

type SessionRow = {
  session_id: string;
  title: string;
  mode: CloudSessionV1["mode"];
  status: CloudSessionV1["status"];
  revision: string;
  latest_checkpoint_id: string | null;
  latest_checkpoint_revision: string | null;
  created_at: Date;
  updated_at: Date;
  last_activity_at: Date;
  completed_at: Date | null;
  pinned: boolean;
  expires_at: Date | null;
  runtime_version: string;
  checkpoint_schema_version: number | null;
  size_bytes: string;
};

type CheckpointRow = {
  session_id: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  revision: string;
  created_at: Date;
  runtime_version: string;
  checkpoint_schema_version: number;
  state: CloudCheckpointIndexV1["state"];
  ciphertext_size_bytes: string;
  plaintext_size_bucket: string;
  ciphertext_sha256: string;
};

const sessionColumns = `session_id,title,mode,status,revision,
  latest_checkpoint_id,latest_checkpoint_revision,created_at,updated_at,
  last_activity_at,completed_at,pinned,expires_at,runtime_version,
  checkpoint_schema_version,size_bytes`;
const checkpointColumns = `session_id,checkpoint_id,parent_checkpoint_id,
  revision,created_at,runtime_version,checkpoint_schema_version,state,
  ciphertext_size_bytes,plaintext_size_bucket,ciphertext_sha256`;

const sessionRow = (row: SessionRow): CloudSessionV1 => ({
  schemaVersion: 1,
  sessionId: row.session_id,
  title: row.title,
  mode: row.mode,
  status: row.status,
  revision: Number(row.revision),
  ...(row.latest_checkpoint_id
    ? { latestCheckpointId: row.latest_checkpoint_id }
    : {}),
  ...(row.latest_checkpoint_revision
    ? { latestCheckpointRevision: Number(row.latest_checkpoint_revision) }
    : {}),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  lastActivityAt: row.last_activity_at.toISOString(),
  ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}),
  pinned: row.pinned,
  ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
  runtimeVersion: row.runtime_version,
  ...(row.checkpoint_schema_version
    ? { checkpointSchemaVersion: row.checkpoint_schema_version }
    : {}),
  sizeBytes: Number(row.size_bytes),
});

const checkpointRow = (row: CheckpointRow): CloudCheckpointIndexV1 => ({
  schemaVersion: 1,
  sessionId: row.session_id,
  checkpointId: row.checkpoint_id,
  ...(row.parent_checkpoint_id
    ? { parentCheckpointId: row.parent_checkpoint_id }
    : {}),
  revision: Number(row.revision),
  createdAt: row.created_at.toISOString(),
  runtimeVersion: row.runtime_version,
  checkpointSchemaVersion: row.checkpoint_schema_version,
  state: row.state,
  ciphertextSizeBytes: Number(row.ciphertext_size_bytes),
  plaintextSizeBucket: row.plaintext_size_bucket,
  ciphertextSha256: row.ciphertext_sha256,
});

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class PostgresSessionRepository implements SessionRepository {
  readonly pool: Pool;
  readonly temporalShadowOutbox?: TemporalShadowOutbox;
  private readonly temporalShadow?: {
    hashKey: string;
    accounts: ReadonlySet<string>;
  };

  constructor(
    connectionString: string,
    temporalShadow?: { hashKey: string; accounts: ReadonlySet<string> },
  ) {
    this.pool = new Pool({
      connectionString,
      max: 6,
      idleTimeoutMillis: 30_000,
    });
    this.temporalShadow = temporalShadow;
    this.temporalShadowOutbox = temporalShadow
      ? new TemporalShadowOutbox(this.pool)
      : undefined;
  }

  async migrate() {
    const here = dirname(fileURLToPath(import.meta.url));
    await this.pool.query(
      await readFile(resolve(here, "../migrations/003_sessions.sql"), "utf8"),
    );
    await this.pool.query(
      await readFile(
        resolve(here, "../migrations/004_command_payloads.sql"),
        "utf8",
      ),
    );
    await this.pool.query(
      await readFile(
        resolve(here, "../migrations/006_postgres_durability_maintenance.sql"),
        "utf8",
      ),
    );
    await this.pool.query(
      await readFile(resolve(here, "../migrations/007_session_jobs.sql"), "utf8"),
    );
    await this.pool.query(
      await readFile(resolve(here, "../migrations/009_remote_missions.sql"), "utf8"),
    );
    if (this.temporalShadowOutbox)
      await this.temporalShadowOutbox.migrate(
        await readFile(
          resolve(here, "../migrations/005_temporal_shadow_outbox.sql"),
          "utf8",
        ),
      );
  }

  private async shadow(
    client: PoolClient,
    accountId: string,
    sessionId: string,
    eventType: TemporalShadowEventType,
    revision: number,
  ) {
    if (
      !this.temporalShadow ||
      !this.temporalShadowOutbox ||
      !this.temporalShadow.accounts.has(accountId)
    )
      return;
    await this.temporalShadowOutbox.enqueueWithClient(client, {
      accountId,
      hashKey: this.temporalShadow.hashKey,
      sessionId,
      eventType,
      revision,
    });
  }

  async health() {
    await this.pool.query("SELECT 1 FROM sessions.schema_migrations LIMIT 1");
  }

  async cleanupExpired() {
    await this.pool.query(
      "DELETE FROM sessions.idempotency_records WHERE expires_at<=now()",
    );
    await this.pool.query(
      "UPDATE sessions.session_leases SET state='expired' WHERE state IN ('active','grace') AND grace_expires_at<=now()",
    );
    await this.pool.query(
      "UPDATE sessions.device_connections SET revoked_at=now() WHERE revoked_at IS NULL AND expires_at<=now()",
    );
    await this.pool.query(
      "UPDATE sessions.device_commands SET state='expired',updated_at=now() WHERE state IN ('pending','leased','delivered') AND expires_at<=now()",
    );
    await this.pool.query(
      `WITH expired AS (
         UPDATE sessions.cloud_sessions SET status='deleting',revision=revision+1,
           updated_at=now() WHERE status<>'deleting' AND pinned=false
           AND mode='cloud_checkpointed' AND expires_at<=now()
         RETURNING account_id,session_id
       )
       INSERT INTO sessions.session_jobs(job_id,account_id,session_id,kind,state)
       SELECT gen_random_uuid(),account_id,session_id,'delete','pending' FROM expired
       WHERE NOT EXISTS (
         SELECT 1 FROM sessions.session_jobs job
         WHERE job.account_id=expired.account_id AND job.session_id=expired.session_id
           AND job.kind='delete' AND job.state IN ('pending','running','completed')
       )`,
    );
  }

  private exportJobRow(row: {
    job_id: string;
    session_id: string;
    state: SessionExportJob["state"];
    created_at: Date;
    completed_at: Date | null;
    artifact_expires_at: Date | null;
    error_code: string | null;
  }): SessionExportJob {
    return {
      jobId: row.job_id,
      sessionId: row.session_id,
      state: row.state,
      createdAt: row.created_at.toISOString(),
      ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}),
      ...(row.artifact_expires_at ? { expiresAt: row.artifact_expires_at.toISOString() } : {}),
      ...(row.error_code ? { errorCode: row.error_code } : {}),
    };
  }

  private async replay<T>(
    client: PoolClient,
    accountId: string,
    operation: string,
    idempotencyHash: string,
    load: (resourceId: string) => Promise<T | null>,
  ): Promise<RepositoryMutation<T> | null> {
    const prior = await client.query<{ resource_id: string }>(
      `SELECT resource_id FROM sessions.idempotency_records
       WHERE account_id=$1 AND operation=$2 AND key_hash=$3 AND expires_at>now()`,
      [accountId, operation, idempotencyHash],
    );
    if (!prior.rowCount) return null;
    const value = await load(prior.rows[0]!.resource_id);
    return value ? { kind: "replayed", value } : { kind: "not_found" };
  }

  private async remember(
    client: PoolClient,
    accountId: string,
    operation: string,
    idempotencyHash: string,
    resourceId: string,
    revision: number,
  ) {
    await client.query(
      `INSERT INTO sessions.idempotency_records
       (account_id,operation,key_hash,resource_id,response_revision,response_digest,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,now()+interval '24 hours')`,
      [
        accountId,
        operation,
        idempotencyHash,
        resourceId,
        revision,
        digest(`${operation}:${resourceId}:${revision}`),
      ],
    );
  }

  async createSession(
    accountId: string,
    sessionId: string,
    idempotencyHash: string,
    input: CreateCloudSessionV1,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const replay = await this.replay(
        client,
        accountId,
        "session.create",
        idempotencyHash,
        async (id) => {
          const row = await client.query<SessionRow>(
            `SELECT ${sessionColumns} FROM sessions.cloud_sessions WHERE account_id=$1 AND session_id=$2`,
            [accountId, id],
          );
          return row.rowCount ? sessionRow(row.rows[0]!) : null;
        },
      );
      if (replay) {
        await client.query("COMMIT");
        return replay;
      }
      const result = await client.query<SessionRow>(
        `INSERT INTO sessions.cloud_sessions
         (account_id,session_id,title,mode,status,runtime_version,expires_at)
         VALUES($1,$2,$3,$4,'created',$5,
           CASE WHEN $4='cloud_checkpointed' THEN now()+interval '30 days' ELSE NULL END)
         RETURNING ${sessionColumns}`,
        [accountId, sessionId, input.title, input.mode, input.runtimeVersion],
      );
      const value = sessionRow(result.rows[0]!);
      await this.remember(
        client,
        accountId,
        "session.create",
        idempotencyHash,
        sessionId,
        value.revision,
      );
      await this.shadow(
        client,
        accountId,
        sessionId,
        "session_created",
        value.revision,
      );
      await client.query("COMMIT");
      return { kind: "created" as const, value };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async requestExport(
    accountId: string,
    sessionId: string,
    jobId: string,
    expectedRevision: number,
    idempotencyHash: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const operation = `session.export:${sessionId}`;
      const prior = await client.query<{
        job_id: string;
        session_id: string;
        state: SessionExportJob["state"];
        created_at: Date;
        completed_at: Date | null;
        artifact_expires_at: Date | null;
        error_code: string | null;
      }>(
        `SELECT job_id,session_id,state,created_at,completed_at,artifact_expires_at,error_code
         FROM sessions.session_jobs WHERE account_id=$1 AND job_id=(
           SELECT resource_id::uuid FROM sessions.idempotency_records
           WHERE account_id=$1 AND operation=$2 AND key_hash=$3 AND expires_at>now()
         )`,
        [accountId, operation, idempotencyHash],
      );
      if (prior.rowCount) {
        await client.query("COMMIT");
        return { kind: "replayed" as const, value: this.exportJobRow(prior.rows[0]!) };
      }
      const session = await client.query<{ revision: string }>(
        `SELECT revision FROM sessions.cloud_sessions
         WHERE account_id=$1 AND session_id=$2 AND status<>'deleting' FOR UPDATE`,
        [accountId, sessionId],
      );
      if (!session.rowCount) {
        await client.query("ROLLBACK");
        return { kind: "not_found" as const };
      }
      if (Number(session.rows[0]!.revision) !== expectedRevision) {
        await client.query("ROLLBACK");
        return { kind: "revision_conflict" as const };
      }
      const inserted = await client.query<{
        job_id: string;
        session_id: string;
        state: SessionExportJob["state"];
        created_at: Date;
        completed_at: Date | null;
        artifact_expires_at: Date | null;
        error_code: string | null;
      }>(
        `INSERT INTO sessions.session_jobs(job_id,account_id,session_id,kind,state)
         VALUES($1,$2,$3,'export','pending')
         RETURNING job_id,session_id,state,created_at,completed_at,artifact_expires_at,error_code`,
        [jobId, accountId, sessionId],
      );
      await this.remember(client, accountId, operation, idempotencyHash, jobId, expectedRevision);
      await client.query("COMMIT");
      return { kind: "created" as const, value: this.exportJobRow(inserted.rows[0]!) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async exportJob(accountId: string, sessionId: string, jobId: string) {
    const result = await this.pool.query<{
      job_id: string;
      session_id: string;
      state: SessionExportJob["state"];
      created_at: Date;
      completed_at: Date | null;
      artifact_expires_at: Date | null;
      error_code: string | null;
    }>(
      `SELECT job_id,session_id,state,created_at,completed_at,artifact_expires_at,error_code
       FROM sessions.session_jobs WHERE account_id=$1 AND session_id=$2
         AND job_id=$3 AND kind='export'`,
      [accountId, sessionId, jobId],
    );
    return result.rowCount ? this.exportJobRow(result.rows[0]!) : null;
  }

  async listSessions(
    accountId: string,
    limit: number,
    cursor?: SessionListCursor,
    status?: CloudSessionStatus,
  ) {
    const result = await this.pool.query<SessionRow>(
      `SELECT ${sessionColumns} FROM sessions.cloud_sessions
       WHERE account_id=$1
         AND ($2::timestamptz IS NULL OR (updated_at,session_id)<($2,$3::uuid))
         AND ($4::text IS NULL OR status=$4)
       ORDER BY updated_at DESC,session_id DESC LIMIT $5`,
      [
        accountId,
        cursor?.updatedAt ?? null,
        cursor?.sessionId ?? null,
        status ?? null,
        limit + 1,
      ],
    );
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      sessions: rows.map(sessionRow),
      ...(result.rows.length > limit && last
        ? {
            nextCursor: {
              updatedAt: last.updated_at,
              sessionId: last.session_id,
            },
          }
        : {}),
    };
  }

  async session(accountId: string, sessionId: string) {
    const result = await this.pool.query<SessionRow>(
      `SELECT ${sessionColumns} FROM sessions.cloud_sessions WHERE account_id=$1 AND session_id=$2`,
      [accountId, sessionId],
    );
    return result.rowCount ? sessionRow(result.rows[0]!) : null;
  }

  async updateSession(
    accountId: string,
    sessionId: string,
    expectedRevision: number,
    idempotencyHash: string,
    input: UpdateCloudSessionV1,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const replay = await this.replay(
        client,
        accountId,
        `session.update:${sessionId}`,
        idempotencyHash,
        async () => {
          const row = await client.query<SessionRow>(
            `SELECT ${sessionColumns} FROM sessions.cloud_sessions WHERE account_id=$1 AND session_id=$2`,
            [accountId, sessionId],
          );
          return row.rowCount ? sessionRow(row.rows[0]!) : null;
        },
      );
      if (replay) {
        await client.query("COMMIT");
        return replay;
      }
      const result = await client.query<SessionRow>(
        `UPDATE sessions.cloud_sessions SET
          title=COALESCE($4,title),mode=COALESCE($5,mode),pinned=COALESCE($6,pinned),
          revision=revision+1,updated_at=now(),last_activity_at=now(),
          expires_at=CASE WHEN COALESCE($5,mode)='cloud_archived' OR COALESCE($6,pinned)
            THEN NULL ELSE COALESCE(expires_at,now()+interval '30 days') END
         WHERE account_id=$1 AND session_id=$2 AND revision=$3 AND status<>'deleting'
         RETURNING ${sessionColumns}`,
        [
          accountId,
          sessionId,
          expectedRevision,
          input.title ?? null,
          input.mode ?? null,
          input.pinned ?? null,
        ],
      );
      if (!result.rowCount) {
        const exists = await client.query(
          "SELECT 1 FROM sessions.cloud_sessions WHERE account_id=$1 AND session_id=$2",
          [accountId, sessionId],
        );
        await client.query("ROLLBACK");
        return {
          kind: exists.rowCount ? "revision_conflict" : "not_found",
        } as const;
      }
      const value = sessionRow(result.rows[0]!);
      await this.remember(
        client,
        accountId,
        `session.update:${sessionId}`,
        idempotencyHash,
        sessionId,
        value.revision,
      );
      await this.shadow(
        client,
        accountId,
        sessionId,
        "session_updated",
        value.revision,
      );
      await client.query("COMMIT");
      return { kind: "updated" as const, value };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteSession(
    accountId: string,
    sessionId: string,
    expectedRevision: number,
    idempotencyHash: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const operation = `session.delete:${sessionId}`;
      const replay = await this.replay(
        client,
        accountId,
        operation,
        idempotencyHash,
        async () => {
          const row = await client.query<SessionRow>(
            `SELECT ${sessionColumns} FROM sessions.cloud_sessions WHERE account_id=$1 AND session_id=$2`,
            [accountId, sessionId],
          );
          return row.rowCount ? sessionRow(row.rows[0]!) : null;
        },
      );
      if (replay) {
        await client.query("COMMIT");
        return replay;
      }
      const result = await client.query<SessionRow>(
        `UPDATE sessions.cloud_sessions SET status='deleting',revision=revision+1,
         updated_at=now(),last_activity_at=now()
         WHERE account_id=$1 AND session_id=$2 AND revision=$3 AND status<>'deleting'
         RETURNING ${sessionColumns}`,
        [accountId, sessionId, expectedRevision],
      );
      if (!result.rowCount) {
        const exists = await client.query(
          "SELECT 1 FROM sessions.cloud_sessions WHERE account_id=$1 AND session_id=$2",
          [accountId, sessionId],
        );
        await client.query("ROLLBACK");
        return {
          kind: exists.rowCount ? "revision_conflict" : "not_found",
        } as const;
      }
      const value = sessionRow(result.rows[0]!);
      await this.remember(
        client,
        accountId,
        operation,
        idempotencyHash,
        sessionId,
        value.revision,
      );
      await this.shadow(
        client,
        accountId,
        sessionId,
        "session_deleted",
        value.revision,
      );
      await client.query(
        `INSERT INTO sessions.session_jobs(job_id,account_id,session_id,kind,state)
         VALUES($1,$2,$3,'delete','pending')`,
        [crypto.randomUUID(), accountId, sessionId],
      );
      await client.query("COMMIT");
      return { kind: "updated" as const, value };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createCheckpointIntent(
    accountId: string,
    objectKey: string,
    idempotencyHash: string,
    input: CheckpointUploadIntentV1,
    plaintextSizeBucket: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const replay = await this.replay(
        client,
        accountId,
        `checkpoint.intent:${input.sessionId}`,
        idempotencyHash,
        async (id) => {
          const row = await client.query<CheckpointRow>(
            `SELECT ${checkpointColumns} FROM sessions.cloud_checkpoints WHERE account_id=$1 AND checkpoint_id=$2`,
            [accountId, id],
          );
          return row.rowCount ? checkpointRow(row.rows[0]!) : null;
        },
      );
      if (replay) {
        await client.query("COMMIT");
        return replay;
      }
      const locked = await client.query<{
        revision: string;
        latest_checkpoint_id: string | null;
        latest_checkpoint_revision: string | null;
        status: string;
      }>(
        `SELECT revision,latest_checkpoint_id,latest_checkpoint_revision,status
         FROM sessions.cloud_sessions WHERE account_id=$1 AND session_id=$2 FOR UPDATE`,
        [accountId, input.sessionId],
      );
      if (!locked.rowCount) {
        await client.query("ROLLBACK");
        return { kind: "not_found" as const };
      }
      const session = locked.rows[0]!;
      const parentMatches =
        input.checkpointRevision === 1
          ? !input.parentCheckpointId && !session.latest_checkpoint_id
          : input.parentCheckpointId === session.latest_checkpoint_id &&
            input.checkpointRevision ===
              Number(session.latest_checkpoint_revision ?? 0) + 1;
      if (
        session.status === "deleting" ||
        Number(session.revision) !== input.sessionRevision ||
        !parentMatches
      ) {
        await client.query("ROLLBACK");
        return { kind: "checkpoint_conflict" as const };
      }
      const result = await client.query<CheckpointRow>(
        `INSERT INTO sessions.cloud_checkpoints
         (account_id,session_id,checkpoint_id,parent_checkpoint_id,revision,
          session_revision,runtime_version,checkpoint_schema_version,object_key,
          state,ciphertext_size_bytes,plaintext_size_bucket,ciphertext_sha256)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'upload_pending',$10,$11,$12)
         RETURNING ${checkpointColumns}`,
        [
          accountId,
          input.sessionId,
          input.checkpointId,
          input.parentCheckpointId ?? null,
          input.checkpointRevision,
          input.sessionRevision,
          input.runtimeVersion,
          input.checkpointSchemaVersion,
          objectKey,
          input.ciphertextSizeBytes,
          plaintextSizeBucket,
          input.ciphertextSha256,
        ],
      );
      const value = checkpointRow(result.rows[0]!);
      await this.remember(
        client,
        accountId,
        `checkpoint.intent:${input.sessionId}`,
        idempotencyHash,
        input.checkpointId,
        value.revision,
      );
      await client.query("COMMIT");
      return { kind: "created" as const, value };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async commitCheckpoint(
    accountId: string,
    sessionId: string,
    checkpointId: string,
    expectedSessionRevision: number,
    idempotencyHash: string,
    ciphertextSizeBytes: number,
    ciphertextSha256: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const locked = await client.query<SessionRow>(
        `SELECT ${sessionColumns} FROM sessions.cloud_sessions
         WHERE account_id=$1 AND session_id=$2 FOR UPDATE`,
        [accountId, sessionId],
      );
      if (!locked.rowCount) {
        await client.query("ROLLBACK");
        return { kind: "not_found" as const };
      }
      const checkpoint = await client.query<
        CheckpointRow & { session_revision: string }
      >(
        `SELECT ${checkpointColumns},session_revision FROM sessions.cloud_checkpoints
         WHERE account_id=$1 AND session_id=$2 AND checkpoint_id=$3 FOR UPDATE`,
        [accountId, sessionId, checkpointId],
      );
      if (!checkpoint.rowCount) {
        await client.query("ROLLBACK");
        return { kind: "not_found" as const };
      }
      const cp = checkpoint.rows[0]!;
      if (cp.state === "committed") {
        const value = {
          session: sessionRow(locked.rows[0]!),
          checkpoint: checkpointRow(cp),
        };
        await client.query("COMMIT");
        return { kind: "replayed" as const, value };
      }
      if (
        cp.state !== "upload_pending" ||
        Number(locked.rows[0]!.revision) !== expectedSessionRevision ||
        Number(cp.session_revision) !== expectedSessionRevision ||
        Number(cp.ciphertext_size_bytes) !== ciphertextSizeBytes ||
        cp.ciphertext_sha256 !== ciphertextSha256
      ) {
        await client.query("ROLLBACK");
        return { kind: "checkpoint_conflict" as const };
      }
      await client.query(
        `UPDATE sessions.cloud_checkpoints SET state='superseded'
         WHERE account_id=$1 AND session_id=$2 AND state='committed'`,
        [accountId, sessionId],
      );
      const committed = await client.query<CheckpointRow>(
        `UPDATE sessions.cloud_checkpoints SET state='committed',committed_at=now()
         WHERE account_id=$1 AND checkpoint_id=$2 RETURNING ${checkpointColumns}`,
        [accountId, checkpointId],
      );
      const updated = await client.query<SessionRow>(
        `UPDATE sessions.cloud_sessions SET latest_checkpoint_id=$3,
          latest_checkpoint_revision=$4,checkpoint_schema_version=$5,
          size_bytes=$6,revision=revision+1,updated_at=now(),last_activity_at=now()
         WHERE account_id=$1 AND session_id=$2 RETURNING ${sessionColumns}`,
        [
          accountId,
          sessionId,
          checkpointId,
          Number(cp.revision),
          cp.checkpoint_schema_version,
          ciphertextSizeBytes,
        ],
      );
      await this.remember(
        client,
        accountId,
        `checkpoint.commit:${sessionId}:${checkpointId}`,
        idempotencyHash,
        checkpointId,
        Number(updated.rows[0]!.revision),
      );
      await this.shadow(
        client,
        accountId,
        sessionId,
        "checkpoint_committed",
        Number(updated.rows[0]!.revision),
      );
      await client.query("COMMIT");
      return {
        kind: "updated" as const,
        value: {
          session: sessionRow(updated.rows[0]!),
          checkpoint: checkpointRow(committed.rows[0]!),
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async latestCheckpoint(accountId: string, sessionId: string) {
    const result = await this.pool.query<CheckpointRow>(
      `SELECT ${checkpointColumns} FROM sessions.cloud_checkpoints
       WHERE account_id=$1 AND session_id=$2 AND state='committed'
       ORDER BY revision DESC LIMIT 1`,
      [accountId, sessionId],
    );
    return result.rowCount ? checkpointRow(result.rows[0]!) : null;
  }

  async checkpoint(accountId: string, sessionId: string, checkpointId: string) {
    const result = await this.pool.query<CheckpointRow>(
      `SELECT ${checkpointColumns} FROM sessions.cloud_checkpoints
       WHERE account_id=$1 AND session_id=$2 AND checkpoint_id=$3`,
      [accountId, sessionId, checkpointId],
    );
    return result.rowCount ? checkpointRow(result.rows[0]!) : null;
  }

  async close() {
    await this.pool.end();
  }
}
