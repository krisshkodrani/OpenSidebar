import { Pool, type PoolClient } from "pg";
import type {
  RemoteMissionState,
  RemoteMissionV1,
} from "@opensidebar/shared-types";
import type {
  RemoteMissionMutation,
  RemoteMissionRepository,
} from "./remote-mission-repository.js";

type MissionRow = {
  mission_id: string;
  device_id: string;
  sequence: string;
  state: RemoteMissionState;
  result_code: RemoteMissionV1["resultCode"] | null;
  created_at: Date;
  expires_at: Date;
  payload_object_key?: string;
};

const columns =
  "mission_id,device_id,sequence,state,result_code,created_at,expires_at";
const publicMission = (row: MissionRow): RemoteMissionV1 => ({
  schemaVersion: 1,
  missionId: row.mission_id,
  deviceId: row.device_id,
  sequence: Number(row.sequence),
  state: row.state,
  createdAt: row.created_at.toISOString(),
  expiresAt: row.expires_at.toISOString(),
  ...(row.result_code ? { resultCode: row.result_code } : {}),
});

export class PostgresRemoteMissionRepository
  implements RemoteMissionRepository
{
  constructor(readonly pool: Pool) {}

  private async transaction<T>(action: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async missionByIdempotency(accountId: string, idempotencyHash: string) {
    const result = await this.pool.query<MissionRow>(
      `SELECT ${columns} FROM sessions.remote_missions
       WHERE account_id=$1 AND idempotency_hash=$2`,
      [accountId, idempotencyHash],
    );
    return result.rowCount ? publicMission(result.rows[0]!) : null;
  }

  async createMission(
    input: Parameters<RemoteMissionRepository["createMission"]>[0],
  ): Promise<RemoteMissionMutation> {
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${input.accountId}:${input.deviceId}`,
      ]);
      const replay = await client.query<MissionRow>(
        `SELECT ${columns} FROM sessions.remote_missions
         WHERE account_id=$1 AND idempotency_hash=$2`,
        [input.accountId, input.idempotencyHash],
      );
      if (replay.rowCount)
        return { kind: "replayed", value: publicMission(replay.rows[0]!) };
      const result = await client.query<MissionRow>(
        `INSERT INTO sessions.remote_missions
         (account_id,mission_id,device_id,sequence,state,idempotency_hash,
          payload_object_key,payload_ciphertext_size_bytes,
          payload_ciphertext_sha256,created_at,updated_at,expires_at)
         SELECT $1,$2,$3,
           COALESCE(MAX(sequence),0)+1,'queued',$4,$5,$6,$7,$8,$8,$9
         FROM sessions.remote_missions WHERE account_id=$1 AND device_id=$3
         RETURNING ${columns}`,
        [
          input.accountId,
          input.missionId,
          input.deviceId,
          input.idempotencyHash,
          input.payloadObjectKey,
          input.payloadCiphertextSizeBytes,
          input.payloadCiphertextSha256,
          input.createdAt,
          input.expiresAt,
        ],
      );
      return { kind: "created", value: publicMission(result.rows[0]!) };
    });
  }

  async mission(accountId: string, missionId: string) {
    const result = await this.pool.query<MissionRow>(
      `SELECT ${columns} FROM sessions.remote_missions
       WHERE account_id=$1 AND mission_id=$2`,
      [accountId, missionId],
    );
    return result.rowCount ? publicMission(result.rows[0]!) : null;
  }

  async missions(input: Parameters<RemoteMissionRepository["missions"]>[0]) {
    const result = await this.pool.query<MissionRow>(
      `SELECT ${columns} FROM sessions.remote_missions
       WHERE account_id=$1 AND device_id=$2 AND sequence>$3
         AND expires_at>now()
       ORDER BY sequence ASC LIMIT $4`,
      [input.accountId, input.deviceId, input.afterSequence, input.limit],
    );
    return result.rows.map(publicMission);
  }

  async transition(
    input: Parameters<RemoteMissionRepository["transition"]>[0],
  ): Promise<RemoteMissionMutation> {
    const result = await this.pool.query<MissionRow>(
      `UPDATE sessions.remote_missions SET state=$1,result_code=$2,updated_at=now()
       WHERE account_id=$3 AND mission_id=$4 AND device_id=$5 AND state=$6
         AND expires_at>now()
       RETURNING ${columns}`,
      [
        input.to,
        input.resultCode ?? null,
        input.accountId,
        input.missionId,
        input.deviceId,
        input.from,
      ],
    );
    if (result.rowCount)
      return { kind: "updated", value: publicMission(result.rows[0]!) };
    const current = await this.mission(input.accountId, input.missionId);
    return current ? { kind: "state_conflict" } : { kind: "not_found" };
  }

  async payloadObjectKey(accountId: string, missionId: string) {
    const result = await this.pool.query<MissionRow>(
      `SELECT payload_object_key FROM sessions.remote_missions
       WHERE account_id=$1 AND mission_id=$2`,
      [accountId, missionId],
    );
    return result.rows[0]?.payload_object_key ?? null;
  }
}
