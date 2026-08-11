import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { CheckpointObjectPort } from "./checkpoint-vault.js";

type JobRow = {
  job_id: string;
  account_id: string;
  session_id: string;
  kind: "export" | "delete";
  attempts: number;
};

const closedError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown";
  if (message.includes("missing")) return "object_missing";
  if (message.includes("kms")) return "encryption_unavailable";
  return "storage_unavailable";
};

export class SessionJobWorker {
  constructor(
    private readonly pool: Pool,
    private readonly objects: CheckpointObjectPort,
  ) {}

  async runOnce(): Promise<"idle" | "completed" | "retry_scheduled"> {
    const claimed = await this.pool.query<JobRow>(
      `UPDATE sessions.session_jobs SET state='running',attempts=attempts+1,
         claimed_at=now(),updated_at=now(),error_code=NULL
       WHERE job_id=(
         SELECT job_id FROM sessions.session_jobs
         WHERE state IN ('pending','running') AND run_after<=now()
           AND (state='pending' OR claimed_at<now()-interval '10 minutes')
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
       ) RETURNING job_id,account_id,session_id,kind,attempts`,
    );
    if (!claimed.rowCount) return "idle";
    const job = claimed.rows[0]!;
    try {
      if (job.kind === "export") await this.export(job);
      else await this.remove(job);
      return "completed";
    } catch (error) {
      const terminal = job.attempts >= 8;
      await this.pool.query(
        `UPDATE sessions.session_jobs SET state=$2,error_code=$3,
           run_after=now()+(LEAST(3600,POWER(2,attempts)::integer)*interval '1 second'),
           updated_at=now() WHERE job_id=$1`,
        [job.job_id, terminal ? "failed" : "pending", closedError(error)],
      );
      return "retry_scheduled";
    }
  }

  async cleanupExpiredArtifacts() {
    const expired = await this.pool.query<{ job_id: string; artifact_key: string }>(
      `SELECT job_id,artifact_key FROM sessions.session_jobs
       WHERE artifact_key IS NOT NULL AND artifact_expires_at<=now()
       ORDER BY artifact_expires_at LIMIT 100`,
    );
    for (const row of expired.rows) {
      await this.deleteObject(row.artifact_key);
      await this.pool.query(
        `UPDATE sessions.session_jobs SET artifact_key=NULL,artifact_sha256=NULL,
         artifact_expires_at=NULL,updated_at=now() WHERE job_id=$1`,
        [row.job_id],
      );
    }
    const checkpoints = await this.pool.query<{
      account_id: string;
      checkpoint_id: string;
      object_key: string;
    }>(
      `SELECT account_id,checkpoint_id,object_key
       FROM sessions.cloud_checkpoints checkpoint
       WHERE (state='upload_pending' AND created_at<now()-interval '30 minutes')
          OR (state='superseded' AND created_at<now()-interval '7 days'
            AND revision < (
              SELECT COALESCE(max(latest.revision),0)-1
              FROM sessions.cloud_checkpoints latest
              WHERE latest.account_id=checkpoint.account_id
                AND latest.session_id=checkpoint.session_id
                AND latest.state='committed'
            ))
       ORDER BY created_at LIMIT 100`,
    );
    for (const checkpoint of checkpoints.rows) {
      await this.deleteObject(checkpoint.object_key);
      await this.pool.query(
        `DELETE FROM sessions.cloud_checkpoints
         WHERE account_id=$1 AND checkpoint_id=$2
           AND state IN ('upload_pending','superseded')`,
        [checkpoint.account_id, checkpoint.checkpoint_id],
      );
    }
  }

  private async export(job: JobRow) {
    const source = await this.pool.query<{
      object_key: string;
      ciphertext_sha256: string;
    }>(
      `SELECT object_key,ciphertext_sha256 FROM sessions.cloud_checkpoints
       WHERE account_id=$1 AND session_id=$2 AND state='committed'
       ORDER BY revision DESC LIMIT 1`,
      [job.account_id, job.session_id],
    );
    if (!source.rowCount) throw new Error("checkpoint_object_missing");
    const body = await this.objects.get(source.rows[0]!.object_key);
    const checksum = createHash("sha256").update(body).digest("hex");
    if (checksum !== source.rows[0]!.ciphertext_sha256)
      throw new Error("checkpoint_object_checksum_mismatch");
    const key = `v1/accounts/${job.account_id}/sessions/${job.session_id}/exports/${job.job_id}.checkpoint`;
    try {
      await this.objects.put(key, body);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "checkpoint_object_exists")
        throw error;
      const existing = await this.objects.get(key);
      const existingChecksum = createHash("sha256").update(existing).digest("hex");
      if (existingChecksum !== checksum) throw new Error("export_object_conflict");
    }
    await this.pool.query(
      `UPDATE sessions.session_jobs SET state='completed',artifact_key=$2,
       artifact_sha256=$3,artifact_expires_at=now()+interval '24 hours',
       completed_at=now(),updated_at=now() WHERE job_id=$1`,
      [job.job_id, key, checksum],
    );
  }

  private async remove(job: JobRow) {
    const objects = await this.pool.query<{ object_key: string }>(
      `SELECT object_key FROM sessions.cloud_checkpoints
       WHERE account_id=$1 AND session_id=$2
       UNION SELECT artifact_key FROM sessions.session_jobs
       WHERE account_id=$1 AND session_id=$2 AND artifact_key IS NOT NULL`,
      [job.account_id, job.session_id],
    );
    for (const row of objects.rows) await this.deleteObject(row.object_key);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM sessions.cloud_sessions WHERE account_id=$1 AND session_id=$2
         AND status='deleting'`,
        [job.account_id, job.session_id],
      );
      await client.query(
        `UPDATE sessions.session_jobs SET state='completed',completed_at=now(),
         updated_at=now() WHERE job_id=$1`,
        [job.job_id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async deleteObject(key: string) {
    if (this.objects.deleteAllVersions)
      await this.objects.deleteAllVersions(key);
    else await this.objects.delete(key);
  }
}
