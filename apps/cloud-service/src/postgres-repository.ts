import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import type { SandboxRun } from "@opensidebar/sandbox-contracts";
import type {
  AuthFlow,
  OwnedRun,
  PlaygroundRepository,
  SessionRecord,
  StoredEmailChallenge,
} from "./repository.js";

type RunRow = {
  id: string;
  account_id: string;
  scenario_id: SandboxRun["scenarioId"];
  scenario_version: 1;
  lifecycle: SandboxRun["lifecycle"];
  revision: string;
  state: SandboxRun["state"];
  result: SandboxRun["result"];
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
};

const mapRun = (row: RunRow): OwnedRun => ({
  id: row.id,
  accountId: row.account_id,
  scenarioId: row.scenario_id,
  scenarioVersion: row.scenario_version,
  lifecycle: row.lifecycle,
  revision: Number(row.revision),
  state: row.state,
  result: row.result,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  expiresAt: row.expires_at.toISOString(),
});

export class PostgresPlaygroundRepository implements PlaygroundRepository {
  readonly pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  async migrate(): Promise<void> {
    const here = dirname(fileURLToPath(import.meta.url));
    const sql = await readFile(
      resolve(here, "../migrations/001_playground.sql"),
      "utf8",
    );
    await this.pool.query(sql);
  }
  async health() {
    await this.pool.query("SELECT 1");
  }
  async cleanupExpired() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM playground.auth_flows WHERE expires_at<=now() OR consumed_at IS NOT NULL",
      );
      await client.query(
        "DELETE FROM playground.email_challenges WHERE expires_at<=now() OR consumed_at IS NOT NULL",
      );
      await client.query(
        "DELETE FROM playground.auth_rate_limits WHERE expires_at<=now()",
      );
      await client.query(
        "DELETE FROM playground.web_sessions WHERE expires_at<=now() OR revoked_at IS NOT NULL",
      );
      await client.query(
        "DELETE FROM playground.idempotency_keys WHERE expires_at<=now()",
      );
      await client.query(
        "DELETE FROM playground.daily_quotas WHERE expires_at<=now()",
      );
      await client.query(
        "DELETE FROM playground.launch_capabilities WHERE expires_at<=now() OR consumed_at IS NOT NULL",
      );
      await client.query(
        "DELETE FROM playground.target_sessions WHERE expires_at<=now() OR revoked_at IS NOT NULL",
      );
      await client.query(
        "DELETE FROM playground.runs WHERE expires_at<=now() OR lifecycle='expired'",
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async session(sessionHash: string): Promise<SessionRecord | null> {
    const result = await this.pool.query<{
      account_id: string;
      email: string;
      csrf_hash: string;
    }>(
      `SELECT account_id, email, csrf_hash FROM playground.web_sessions
       WHERE session_hash=$1 AND revoked_at IS NULL AND expires_at > now()`,
      [sessionHash],
    );
    const row = result.rows[0];
    return row
      ? { accountId: row.account_id, email: row.email, csrfHash: row.csrf_hash }
      : null;
  }
  async revokeSession(sessionHash: string) {
    await this.pool.query(
      "UPDATE playground.web_sessions SET revoked_at=now() WHERE session_hash=$1",
      [sessionHash],
    );
  }
  async createAuthFlow(
    stateHash: string,
    codeVerifier: string,
    returnPath: string,
    expiresAt: Date,
  ) {
    await this.pool.query(
      "INSERT INTO playground.auth_flows(state_hash,code_verifier,return_path,expires_at) VALUES($1,$2,$3,$4)",
      [stateHash, codeVerifier, returnPath, expiresAt],
    );
  }
  async consumeAuthFlow(stateHash: string): Promise<AuthFlow | null> {
    const result = await this.pool.query<{
      code_verifier: string;
      return_path: string;
    }>(
      `UPDATE playground.auth_flows SET consumed_at=now()
       WHERE state_hash=$1 AND consumed_at IS NULL AND expires_at>now()
       RETURNING code_verifier,return_path`,
      [stateHash],
    );
    const row = result.rows[0];
    return row
      ? { codeVerifier: row.code_verifier, returnPath: row.return_path }
      : null;
  }
  async consumeAuthQuota(
    subjectHash: string,
    windowSeconds: number,
    limit: number,
  ) {
    const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
    const expiresAt = new Date(((bucket + 1) * windowSeconds + 60) * 1000);
    const result = await this.pool.query(
      `INSERT INTO playground.auth_rate_limits(subject_hash,window_seconds,bucket,used,expires_at)
       VALUES($1,$2,$3,1,$5)
       ON CONFLICT(subject_hash,window_seconds,bucket) DO UPDATE
       SET used=playground.auth_rate_limits.used+1
       WHERE playground.auth_rate_limits.used < $4 RETURNING used`,
      [subjectHash, windowSeconds, bucket, limit, expiresAt],
    );
    if (!result.rowCount)
      throw Object.assign(new Error("auth_rate_limit"), {
        code: "auth_rate_limit",
      });
  }
  async createEmailChallenge(
    challengeHash: string,
    emailHash: string,
    challenge: StoredEmailChallenge,
    expiresAt: Date,
  ) {
    await this.pool.query(
      `INSERT INTO playground.email_challenges(challenge_hash,email_hash,mode,provider_session,account_id,expires_at)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        challengeHash,
        emailHash,
        challenge.mode,
        challenge.providerSession ?? null,
        challenge.accountId ?? null,
        expiresAt,
      ],
    );
  }
  async beginEmailChallenge(
    challengeHash: string,
    emailHash: string,
  ): Promise<StoredEmailChallenge | null> {
    const result = await this.pool.query<{
      mode: "signup" | "signin";
      provider_session: string | null;
      account_id: string | null;
    }>(
      `UPDATE playground.email_challenges SET attempts=attempts+1
       WHERE challenge_hash=$1 AND email_hash=$2 AND consumed_at IS NULL
         AND expires_at>now() AND attempts<5
       RETURNING mode,provider_session,account_id`,
      [challengeHash, emailHash],
    );
    const row = result.rows[0];
    return row
      ? {
          mode: row.mode,
          providerSession: row.provider_session ?? undefined,
          accountId: row.account_id ?? undefined,
        }
      : null;
  }
  async consumeEmailChallenge(challengeHash: string) {
    const result = await this.pool.query(
      `UPDATE playground.email_challenges SET consumed_at=now()
       WHERE challenge_hash=$1 AND consumed_at IS NULL AND expires_at>now()`,
      [challengeHash],
    );
    return result.rowCount === 1;
  }
  async createSession(
    hash: string,
    accountId: string,
    email: string,
    csrfHash: string,
    expiresAt: Date,
  ) {
    await this.pool.query(
      `INSERT INTO playground.web_sessions(session_hash,account_id,email,csrf_hash,expires_at)
       VALUES($1,$2,$3,$4,$5)`,
      [hash, accountId, email, csrfHash, expiresAt],
    );
  }
  async listRuns(accountId: string) {
    const result = await this.pool.query<RunRow>(
      `SELECT * FROM playground.runs
       WHERE account_id=$1 AND lifecycle<>'expired' AND expires_at>now()
       ORDER BY updated_at DESC, id DESC LIMIT 25`,
      [accountId],
    );
    return result.rows.map(mapRun);
  }
  async findIdempotentRun(accountId: string, keyHash: string) {
    const result = await this.pool.query<{ response_body: OwnedRun }>(
      `SELECT response_body FROM playground.idempotency_keys
       WHERE account_id=$1 AND operation='playground.create_run' AND key_hash=$2 AND expires_at>now()`,
      [accountId, keyHash],
    );
    return result.rows[0]?.response_body ?? null;
  }
  async createRun(run: OwnedRun, quotaSubjectHash: string, keyHash: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.consumeDailyQuota(client, quotaSubjectHash, 25);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        run.accountId,
      ]);
      const active = await client.query<{ count: string }>(
        `SELECT count(*) FROM playground.runs
         WHERE account_id=$1 AND lifecycle <> 'expired' AND expires_at > now()`,
        [run.accountId],
      );
      if (Number(active.rows[0]?.count ?? 0) >= 3)
        throw Object.assign(new Error("concurrent_run_limit"), {
          code: "concurrent_run_limit",
        });
      await client.query(
        `INSERT INTO playground.runs
         (id,account_id,scenario_id,scenario_version,lifecycle,revision,state,result,created_at,updated_at,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          run.id,
          run.accountId,
          run.scenarioId,
          run.scenarioVersion,
          run.lifecycle,
          run.revision,
          run.state,
          run.result,
          run.createdAt,
          run.updatedAt,
          run.expiresAt,
        ],
      );
      await client.query(
        `INSERT INTO playground.idempotency_keys(account_id,operation,key_hash,response_status,response_body,expires_at)
         VALUES($1,'playground.create_run',$2,201,$3,now()+interval '24 hours')`,
        [run.accountId, keyHash, JSON.stringify(run)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async consumeDailyQuota(
    client: PoolClient,
    subjectHash: string,
    limit: number,
  ) {
    const result = await client.query(
      `INSERT INTO playground.daily_quotas(subject_hash,quota_day,used,expires_at)
       VALUES ($1,current_date,1,current_date + interval '2 days')
       ON CONFLICT(subject_hash,quota_day) DO UPDATE SET used=playground.daily_quotas.used+1
       WHERE playground.daily_quotas.used < $2 RETURNING used`,
      [subjectHash, limit],
    );
    if (!result.rowCount)
      throw Object.assign(new Error("daily_run_limit"), {
        code: "daily_run_limit",
      });
  }
  async getRun(runId: string) {
    const result = await this.pool.query<RunRow>(
      "SELECT * FROM playground.runs WHERE id=$1",
      [runId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }
  async updateRun(run: OwnedRun, expectedRevision: number) {
    const result = await this.pool.query(
      `UPDATE playground.runs SET lifecycle=$2,revision=$3,state=$4,result=$5,updated_at=$6
       WHERE id=$1 AND revision=$7`,
      [
        run.id,
        run.lifecycle,
        run.revision,
        run.state,
        run.result,
        run.updatedAt,
        expectedRevision,
      ],
    );
    return result.rowCount === 1;
  }
  async expireRun(accountId: string, runId: string) {
    const result = await this.pool.query(
      "DELETE FROM playground.runs WHERE id=$1 AND account_id=$2",
      [runId, accountId],
    );
    return result.rowCount === 1;
  }
  async createLaunch(
    hash: string,
    runId: string,
    accountId: string,
    expiresAt: Date,
  ) {
    await this.pool.query(
      "INSERT INTO playground.launch_capabilities(token_hash,run_id,account_id,expires_at) VALUES($1,$2,$3,$4)",
      [hash, runId, accountId, expiresAt],
    );
  }
  async consumeLaunch(hash: string) {
    const result = await this.pool.query<{ run_id: string }>(
      `UPDATE playground.launch_capabilities SET consumed_at=now()
       WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING run_id`,
      [hash],
    );
    return result.rows[0]?.run_id ?? null;
  }
  async createTargetSession(hash: string, runId: string, expiresAt: Date) {
    await this.pool.query(
      "INSERT INTO playground.target_sessions(session_hash,run_id,expires_at) VALUES($1,$2,$3)",
      [hash, runId, expiresAt],
    );
  }
  async targetRunId(hash: string) {
    const result = await this.pool.query<{ run_id: string }>(
      `SELECT run_id FROM playground.target_sessions
       WHERE session_hash=$1 AND revoked_at IS NULL AND expires_at>now()`,
      [hash],
    );
    return result.rows[0]?.run_id ?? null;
  }
  async close() {
    await this.pool.end();
  }
}
