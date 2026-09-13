import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { tokenHash } from "./crypto.js";
import type {
  PlaygroundRunRecordV2,
  PlaygroundV2Repository,
} from "./playground-v2-repository.js";

export class PostgresPlaygroundV2Repository implements PlaygroundV2Repository {
  constructor(private readonly pool: Pool) {}

  async migrate() {
    await this.pool.query(
      await readFile(
        new URL("../migrations/021_public_scenarios.sql", import.meta.url),
        "utf8",
      ),
    );
  }
  async cleanupExpired() {
    await this.pool.query(
      "DELETE FROM playground.scenario_runs_v2 WHERE expires_at<=now()",
    );
    await this.pool.query(
      "DELETE FROM playground.scenario_launches_v2 WHERE expires_at<=now() OR consumed_at IS NOT NULL",
    );
    await this.pool.query(
      "DELETE FROM playground.scenario_sessions_v2 WHERE expires_at<=now()",
    );
  }
  async list(ownerId: string) {
    const result = await this.pool.query<{ record: PlaygroundRunRecordV2 }>(
      "SELECT record FROM playground.scenario_runs_v2 WHERE owner_id=$1 AND expires_at>now() ORDER BY created_at DESC,id DESC LIMIT 25",
      [ownerId],
    );
    return result.rows.map((row) => row.record);
  }
  async get(id: string) {
    const result = await this.pool.query<{ record: PlaygroundRunRecordV2 }>(
      "SELECT record FROM playground.scenario_runs_v2 WHERE id=$1",
      [id],
    );
    return result.rows[0]?.record ?? null;
  }
  async create(run: PlaygroundRunRecordV2, keyHash: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Share the existing account lock and quota with v1 while old runs drain.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        run.ownerId,
      ]);
      await client.query(
        "DELETE FROM playground.idempotency_keys WHERE account_id=$1 AND operation='playground.v2.create' AND key_hash=$2 AND expires_at<=now()",
        [run.ownerId, keyHash],
      );
      const prior = await client.query<{
        response_body: PlaygroundRunRecordV2;
      }>(
        "SELECT response_body FROM playground.idempotency_keys WHERE account_id=$1 AND operation='playground.v2.create' AND key_hash=$2 AND expires_at>now()",
        [run.ownerId, keyHash],
      );
      if (prior.rows[0]) {
        const existing = prior.rows[0].response_body;
        if (existing.scenarioId !== run.scenarioId)
          throw Object.assign(
            new Error("Idempotency key belongs to a different scenario"),
            { code: "idempotency_conflict" },
          );
        await client.query("COMMIT");
        return existing;
      }
      const active = await client.query<{ count: string }>(
        `SELECT ((SELECT count(*) FROM playground.runs WHERE account_id=$1 AND lifecycle<>'expired' AND expires_at>now()) +
          (SELECT count(*) FROM playground.scenario_runs_v2 WHERE owner_id=$1 AND expires_at>now())) AS count`,
        [run.ownerId],
      );
      if (Number(active.rows[0]?.count ?? 0) >= 3)
        throw Object.assign(new Error("Playground run allowance reached"), {
          code: "concurrent_run_limit",
        });
      const quota = await client.query(
        `INSERT INTO playground.daily_quotas(subject_hash,quota_day,used,expires_at) VALUES($1,current_date,1,current_date+interval '2 days')
         ON CONFLICT(subject_hash,quota_day) DO UPDATE SET used=playground.daily_quotas.used+1 WHERE playground.daily_quotas.used<25 RETURNING used`,
        [tokenHash(run.ownerId)],
      );
      if (!quota.rowCount)
        throw Object.assign(new Error("Daily Playground allowance reached"), {
          code: "daily_run_limit",
        });
      await client.query(
        "INSERT INTO playground.scenario_runs_v2(id,owner_id,scenario_id,record,revision,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          run.id,
          run.ownerId,
          run.scenarioId,
          run,
          run.revision,
          run.createdAt,
          run.expiresAt,
        ],
      );
      await client.query(
        "INSERT INTO playground.idempotency_keys(account_id,operation,key_hash,response_status,response_body,expires_at) VALUES($1,'playground.v2.create',$2,201,$3,$4)",
        [run.ownerId, keyHash, run, run.expiresAt],
      );
      await client.query("COMMIT");
      return run;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async update(run: PlaygroundRunRecordV2, expectedRevision: number) {
    const result = await this.pool.query(
      "UPDATE playground.scenario_runs_v2 SET record=$2,revision=$3 WHERE id=$1 AND owner_id=$4 AND revision=$5 AND expires_at>now()",
      [run.id, run, run.revision, run.ownerId, expectedRevision],
    );
    return result.rowCount === 1;
  }
  async remove(id: string, ownerId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        ownerId,
      ]);
      const result = await client.query(
        "DELETE FROM playground.scenario_runs_v2 WHERE id=$1 AND owner_id=$2",
        [id, ownerId],
      );
      await client.query(
        "DELETE FROM playground.idempotency_keys WHERE account_id=$1 AND operation='playground.v2.create' AND response_body->>'id'=$2",
        [ownerId, id],
      );
      await client.query("COMMIT");
      return result.rowCount === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async createLaunch(hash: string, id: string, expiresAt: string) {
    await this.pool.query(
      "INSERT INTO playground.scenario_launches_v2(token_hash,run_id,expires_at) VALUES($1,$2,$3)",
      [hash, id, expiresAt],
    );
  }
  async consumeLaunch(hash: string) {
    const result = await this.pool.query<{ run_id: string }>(
      "UPDATE playground.scenario_launches_v2 SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING run_id",
      [hash],
    );
    return result.rows[0]?.run_id ?? null;
  }
  async createTargetSession(hash: string, id: string, expiresAt: string) {
    await this.pool.query(
      "INSERT INTO playground.scenario_sessions_v2(token_hash,run_id,expires_at) VALUES($1,$2,$3)",
      [hash, id, expiresAt],
    );
  }
  async targetRunId(hash: string) {
    const result = await this.pool.query<{ run_id: string }>(
      "SELECT run_id FROM playground.scenario_sessions_v2 WHERE token_hash=$1 AND expires_at>now()",
      [hash],
    );
    return result.rows[0]?.run_id ?? null;
  }
}
