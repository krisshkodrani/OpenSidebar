import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import type {
  CloudTraceV1,
  CreateTraceUploadIntentV1,
} from "@opensidebar/shared-types";
import type {
  TraceMutationResult,
  TraceRepository,
} from "./trace-repository.js";

const QUOTA_BYTES = 500 * 1024 * 1024;
type Row = {
  trace_id: string;
  title: string;
  bundle_schema_version: string;
  key_fingerprint: string;
  entry_count: number;
  screenshot_count: number;
  ciphertext_size_bytes: string;
  ciphertext_sha256: string | null;
  state: CloudTraceV1["state"];
  trace_created_at: Date;
  uploaded_at: Date | null;
  expires_at: Date;
  object_key: string;
};
const publicTrace = (row: Row): CloudTraceV1 => ({
  schemaVersion: 1,
  traceId: row.trace_id,
  title: row.title,
  createdAt: row.trace_created_at.toISOString(),
  ...(row.uploaded_at ? { uploadedAt: row.uploaded_at.toISOString() } : {}),
  expiresAt: row.expires_at.toISOString(),
  state: row.state,
  bundleSchemaVersion: row.bundle_schema_version,
  keyFingerprint: row.key_fingerprint,
  entryCount: row.entry_count,
  screenshotCount: row.screenshot_count,
  ciphertextSizeBytes: Number(row.ciphertext_size_bytes),
  ...(row.ciphertext_sha256 ? { ciphertextSha256: row.ciphertext_sha256 } : {}),
});

export class PostgresTraceRepository implements TraceRepository {
  readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }
  async migrate() {
    const sql = await readFile(
      fileURLToPath(
        new URL("../migrations/008_trace_sync.sql", import.meta.url),
      ),
      "utf8",
    );
    await this.pool.query(sql);
  }
  async health() {
    await this.pool.query("SELECT 1");
  }
  async createIntent(
    accountId: string,
    input: CreateTraceUploadIntentV1,
    objectKey: string,
  ): Promise<TraceMutationResult<CloudTraceV1>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `trace-quota:${accountId}`,
      ]);
      const existing = await this.find(client, accountId, input.traceId);
      if (existing) {
        await client.query("COMMIT");
        return { kind: "exists", value: publicTrace(existing) };
      }
      const usage = await client.query<{ used: string }>(
        "SELECT COALESCE(sum(ciphertext_size_bytes),0)::text AS used FROM traces.cloud_traces WHERE account_id=$1 AND state <> 'deleting'",
        [accountId],
      );
      if (
        Number(usage.rows[0]?.used ?? 0) + input.ciphertextSizeBytes >
        QUOTA_BYTES
      ) {
        await client.query("ROLLBACK");
        return { kind: "quota_exceeded" };
      }
      const result = await client.query<Row>(
        `INSERT INTO traces.cloud_traces(account_id,trace_id,title,bundle_schema_version,key_fingerprint,entry_count,screenshot_count,ciphertext_size_bytes,object_key,state,trace_created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'upload_pending',$10) RETURNING *`,
        [
          accountId,
          input.traceId,
          input.title,
          input.bundleSchemaVersion,
          input.keyFingerprint,
          input.entryCount,
          input.screenshotCount,
          input.ciphertextSizeBytes,
          objectKey,
          input.createdAt,
        ],
      );
      await client.query("COMMIT");
      return { kind: "created", value: publicTrace(result.rows[0]!) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async commit(
    accountId: string,
    traceId: string,
    sha256: string,
  ): Promise<TraceMutationResult<CloudTraceV1>> {
    const result = await this.pool.query<Row>(
      `UPDATE traces.cloud_traces SET state='available',ciphertext_sha256=$3,uploaded_at=now() WHERE account_id=$1 AND trace_id=$2 AND state='upload_pending' RETURNING *`,
      [accountId, traceId, sha256],
    );
    if (result.rows[0])
      return { kind: "created", value: publicTrace(result.rows[0]) };
    const current = await this.get(accountId, traceId);
    return current
      ? { kind: "conflict", value: current }
      : { kind: "not_found" };
  }
  async list(accountId: string) {
    const result = await this.pool.query<Row>(
      "SELECT * FROM traces.cloud_traces WHERE account_id=$1 AND state <> 'deleting' ORDER BY trace_created_at DESC LIMIT 500",
      [accountId],
    );
    return result.rows.map(publicTrace);
  }
  async get(accountId: string, traceId: string) {
    const row = await this.find(this.pool, accountId, traceId);
    return row ? publicTrace(row) : null;
  }
  async usage(accountId: string) {
    const result = await this.pool.query<{ used: string; count: string }>(
      "SELECT COALESCE(sum(ciphertext_size_bytes),0)::text AS used,count(*)::text AS count FROM traces.cloud_traces WHERE account_id=$1 AND state <> 'deleting'",
      [accountId],
    );
    return {
      schemaVersion: 1 as const,
      usedBytes: Number(result.rows[0]?.used ?? 0),
      quotaBytes: QUOTA_BYTES,
      traceCount: Number(result.rows[0]?.count ?? 0),
    };
  }
  async markDeleting(
    accountId: string,
    traceId: string,
  ): Promise<TraceMutationResult<CloudTraceV1>> {
    const result = await this.pool.query<Row>(
      "UPDATE traces.cloud_traces SET state='deleting' WHERE account_id=$1 AND trace_id=$2 RETURNING *",
      [accountId, traceId],
    );
    return result.rows[0]
      ? { kind: "created", value: publicTrace(result.rows[0]) }
      : { kind: "not_found" };
  }
  async remove(accountId: string, traceId: string) {
    await this.pool.query(
      "DELETE FROM traces.cloud_traces WHERE account_id=$1 AND trace_id=$2",
      [accountId, traceId],
    );
  }
  async cleanupExpired() {
    await this.pool.query(
      "UPDATE traces.cloud_traces SET state='deleting' WHERE expires_at < now() AND state <> 'deleting'",
    );
    const result = await this.pool.query<{
      account_id: string;
      trace_id: string;
      object_key: string;
    }>(
      "SELECT account_id,trace_id,object_key FROM traces.cloud_traces WHERE expires_at < now() AND state='deleting'",
    );
    return result.rows.map((row) => ({
      accountId: row.account_id,
      traceId: row.trace_id,
      objectKey: row.object_key,
    }));
  }
  async close() {
    await this.pool.end();
  }
  private async find(
    client: Pick<PoolClient, "query"> | Pool,
    accountId: string,
    traceId: string,
  ) {
    const result = await client.query<Row>(
      "SELECT * FROM traces.cloud_traces WHERE account_id=$1 AND trace_id=$2",
      [accountId, traceId],
    );
    return result.rows[0] ?? null;
  }
}
