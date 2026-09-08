import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import type {
  BenchmarkAttemptV1,
  ScenarioActionV2,
  ScenarioRunV2,
} from "@opensidebar/scenario-contracts";
import {
  scenarioEngine,
  ScenarioRevisionConflict,
  type CreateScenarioRunV2,
} from "@opensidebar/scenario-engine";
import type { ModelBenchRepository } from "./modelbench-repository.js";

interface ScenarioRunRow {
  id: string;
  owner_id: string;
  case_id: string;
  scenario_id: string;
  scenario_version: number;
  lifecycle: ScenarioRunV2["lifecycle"];
  revision: string;
  state: ScenarioRunV2["state"];
  result: string | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
}

interface AttemptRow {
  attempt_id: string;
  case_id: string;
  case_version: number;
  case_content_hash: string;
  build_revision: string;
  classification: BenchmarkAttemptV1["classification"];
  score_eligible: boolean;
  started_at: Date;
  duration_ms: string;
  requested_seats: BenchmarkAttemptV1["requestedSeats"];
  resolved_seats: BenchmarkAttemptV1["resolvedSeats"];
  usage_by_role: BenchmarkAttemptV1["usageByRole"];
  validation: BenchmarkAttemptV1["validation"];
  retry_of_attempt_id: string | null;
  artifact_refs: string[];
}

function mapRun(row: ScenarioRunRow): ScenarioRunV2 {
  return {
    id: row.id,
    ownerId: row.owner_id,
    caseId: row.case_id,
    scenarioId: row.scenario_id,
    scenarioVersion: row.scenario_version,
    lifecycle: row.lifecycle,
    revision: Number(row.revision),
    state: row.state,
    result: row.result,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

function mapAttempt(row: AttemptRow): BenchmarkAttemptV1 {
  return {
    schemaVersion: 1,
    attemptId: row.attempt_id,
    caseId: row.case_id,
    caseVersion: row.case_version,
    caseContentHash: row.case_content_hash,
    buildRevision: row.build_revision,
    classification: row.classification,
    scoreEligible: row.score_eligible,
    startedAt: row.started_at.toISOString(),
    durationMs: Number(row.duration_ms),
    requestedSeats: row.requested_seats,
    resolvedSeats: row.resolved_seats,
    usageByRole: row.usage_by_role,
    validation: row.validation,
    ...(row.retry_of_attempt_id
      ? { retryOfAttemptId: row.retry_of_attempt_id }
      : {}),
    artifactRefs: row.artifact_refs,
  };
}

export class PostgresModelBenchRepository implements ModelBenchRepository {
  constructor(readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresModelBenchRepository {
    return new PostgresModelBenchRepository(
      new Pool({ connectionString, max: 6, idleTimeoutMillis: 30_000 }),
    );
  }

  async migrate(): Promise<void> {
    const here = dirname(fileURLToPath(import.meta.url));
    await this.pool.query(
      await readFile(resolve(here, "../migrations/018_modelbench.sql"), "utf8"),
    );
  }

  async create(input: CreateScenarioRunV2): Promise<ScenarioRunV2> {
    const definition = scenarioEngine.case(input.caseId);
    const state = scenarioEngine.initialize(input.caseId);
    const result = await this.pool.query<ScenarioRunRow>(
      `INSERT INTO modelbench.scenario_runs
        (id,owner_id,case_id,scenario_id,scenario_version,lifecycle,revision,state,result,created_at,updated_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$9,$10)
       RETURNING *`,
      [
        input.id,
        input.ownerId,
        definition.contract.id,
        state.scenarioId,
        state.scenarioVersion,
        state.lifecycle,
        state.revision,
        state,
        input.createdAt,
        input.expiresAt,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("ModelBench run insert returned no row.");
    return mapRun(row);
  }

  async get(id: string): Promise<ScenarioRunV2 | null> {
    const result = await this.pool.query<ScenarioRunRow>(
      "SELECT * FROM modelbench.scenario_runs WHERE id=$1",
      [id],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async createLaunch(tokenHash: string, runId: string, ownerId: string, expiresAt: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO modelbench.launch_capabilities(token_hash,run_id,owner_id,expires_at) VALUES($1,$2,$3,$4)",
      [tokenHash, runId, ownerId, expiresAt],
    );
  }

  async consumeLaunch(tokenHash: string): Promise<string | null> {
    const result = await this.pool.query<{ run_id: string }>(
      `UPDATE modelbench.launch_capabilities SET consumed_at=now()
       WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING run_id`,
      [tokenHash],
    );
    return result.rows[0]?.run_id ?? null;
  }

  async createTargetSession(sessionHash: string, runId: string, expiresAt: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO modelbench.target_sessions(session_hash,run_id,expires_at) VALUES($1,$2,$3)",
      [sessionHash, runId, expiresAt],
    );
  }

  async targetRunId(sessionHash: string): Promise<string | null> {
    const result = await this.pool.query<{ run_id: string }>(
      `SELECT run_id FROM modelbench.target_sessions
       WHERE session_hash=$1 AND revoked_at IS NULL AND expires_at>now()`,
      [sessionHash],
    );
    return result.rows[0]?.run_id ?? null;
  }

  async apply(
    id: string,
    expectedRevision: number,
    action: ScenarioActionV2,
    updatedAt: string,
  ): Promise<ScenarioRunV2> {
    return this.mutate(id, expectedRevision, async (current) => {
      const state = scenarioEngine.apply(current.state, action);
      return {
        ...current,
        revision: state.revision,
        lifecycle: state.lifecycle,
        state,
        updatedAt,
      };
    });
  }

  async expire(
    id: string,
    expectedRevision: number,
    updatedAt: string,
  ): Promise<ScenarioRunV2> {
    return this.mutate(id, expectedRevision, async (current) => ({
      ...current,
      revision: current.revision + 1,
      lifecycle: "expired",
      state: {
        ...current.state,
        revision: current.state.revision + 1,
        lifecycle: "expired",
      },
      updatedAt,
    }));
  }

  async saveAttempt(attempt: BenchmarkAttemptV1, expiresAt: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO modelbench.attempts
        (attempt_id,case_id,case_version,case_content_hash,build_revision,classification,score_eligible,started_at,duration_ms,requested_seats,resolved_seats,usage_by_role,validation,retry_of_attempt_id,artifact_refs,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        attempt.attemptId,
        attempt.caseId,
        attempt.caseVersion,
        attempt.caseContentHash,
        attempt.buildRevision,
        attempt.classification,
        attempt.scoreEligible,
        attempt.startedAt,
        attempt.durationMs,
        attempt.requestedSeats,
        attempt.resolvedSeats,
        attempt.usageByRole,
        attempt.validation,
        attempt.retryOfAttemptId ?? null,
        attempt.artifactRefs,
        expiresAt,
      ],
    );
  }

  async attempt(id: string): Promise<BenchmarkAttemptV1 | null> {
    const result = await this.pool.query<AttemptRow>(
      "SELECT * FROM modelbench.attempts WHERE attempt_id=$1",
      [id],
    );
    return result.rows[0] ? mapAttempt(result.rows[0]) : null;
  }

  async listAttempts(caseId?: string): Promise<BenchmarkAttemptV1[]> {
    const result = caseId
      ? await this.pool.query<AttemptRow>(
          "SELECT * FROM modelbench.attempts WHERE case_id=$1 ORDER BY started_at,attempt_id",
          [caseId],
        )
      : await this.pool.query<AttemptRow>(
          "SELECT * FROM modelbench.attempts ORDER BY started_at,attempt_id",
        );
    return result.rows.map(mapAttempt);
  }

  async cleanupExpired(now: string): Promise<{ runs: number; attempts: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const attempts = await client.query(
        "DELETE FROM modelbench.attempts WHERE expires_at<=$1",
        [now],
      );
      await client.query("DELETE FROM modelbench.launch_capabilities WHERE expires_at<=$1", [now]);
      await client.query("DELETE FROM modelbench.target_sessions WHERE expires_at<=$1", [now]);
      const runs = await client.query(
        "DELETE FROM modelbench.scenario_runs WHERE expires_at<=$1",
        [now],
      );
      await client.query("COMMIT");
      return { runs: runs.rowCount ?? 0, attempts: attempts.rowCount ?? 0 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async mutate(
    id: string,
    expectedRevision: number,
    update: (current: ScenarioRunV2) => Promise<ScenarioRunV2>,
  ): Promise<ScenarioRunV2> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<ScenarioRunRow>(
        "SELECT * FROM modelbench.scenario_runs WHERE id=$1 FOR UPDATE",
        [id],
      );
      const row = selected.rows[0];
      if (!row) throw new Error(`Unknown scenario run: ${id}`);
      const current = mapRun(row);
      if (current.revision !== expectedRevision) {
        throw new ScenarioRevisionConflict(id, expectedRevision, current.revision);
      }
      const next = await update(current);
      const result = await this.writeRun(client, next, expectedRevision);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async writeRun(
    client: PoolClient,
    run: ScenarioRunV2,
    expectedRevision: number,
  ): Promise<ScenarioRunV2> {
    const result = await client.query<ScenarioRunRow>(
      `UPDATE modelbench.scenario_runs
       SET lifecycle=$2,revision=$3,state=$4,result=$5,updated_at=$6
       WHERE id=$1 AND revision=$7
       RETURNING *`,
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
    const row = result.rows[0];
    if (!row) throw new ScenarioRevisionConflict(run.id, expectedRevision, -1);
    return mapRun(row);
  }
}
