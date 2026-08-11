import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  canTransitionBrowserCommand,
  type BrowserCommandState,
  type DeviceCommandOutcomeCode,
  type DeviceCommandRecordV1,
} from "@opensidebar/shared-types";
import type {
  CommandMutation,
  DeviceCommandRepository,
} from "./device-command-repository.js";

type CommandRow = {
  session_id: string;
  command_id: string;
  sequence: string;
  lease_id: string;
  lease_generation: string;
  checkpoint_revision: string;
  command_kind: string;
  risk: DeviceCommandRecordV1["risk"];
  action_digest: string;
  state: BrowserCommandState;
  outcome_code: DeviceCommandOutcomeCode | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
};

const columns = `session_id,command_id,sequence,lease_id,lease_generation,
  checkpoint_revision,command_kind,risk,action_digest,state,outcome_code,
  expires_at,created_at,updated_at`;

const commandRow = (row: CommandRow): DeviceCommandRecordV1 => ({
  schemaVersion: 1,
  sessionId: row.session_id,
  commandId: row.command_id,
  sequence: Number(row.sequence),
  leaseId: row.lease_id,
  leaseGeneration: Number(row.lease_generation),
  checkpointRevision: Number(row.checkpoint_revision),
  commandKind: row.command_kind,
  risk: row.risk,
  actionDigest: row.action_digest,
  state: row.state,
  ...(row.outcome_code ? { outcomeCode: row.outcome_code } : {}),
  expiresAt: row.expires_at.toISOString(),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function transaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const value = await action(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        attempt < 2 &&
        ["40001", "40P01"].includes((error as { code?: string }).code ?? "")
      )
        continue;
      throw error;
    } finally {
      client.release();
    }
  }
  throw new Error("serializable transaction retry exhausted");
}

async function replay(
  client: PoolClient,
  accountId: string,
  operation: string,
  idempotencyHash: string,
): Promise<DeviceCommandRecordV1 | null> {
  const prior = await client.query<{ resource_id: string }>(
    `SELECT resource_id FROM sessions.idempotency_records
     WHERE account_id=$1 AND operation=$2 AND key_hash=$3 AND expires_at>now()`,
    [accountId, operation, idempotencyHash],
  );
  if (!prior.rowCount) return null;
  const found = await client.query<CommandRow>(
    `SELECT ${columns} FROM sessions.device_commands
     WHERE account_id=$1 AND command_id=$2`,
    [accountId, prior.rows[0]!.resource_id],
  );
  return found.rowCount ? commandRow(found.rows[0]!) : null;
}

async function remember(
  client: PoolClient,
  accountId: string,
  operation: string,
  idempotencyHash: string,
  commandId: string,
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
      commandId,
      revision,
      digest(`${operation}:${commandId}:${revision}`),
    ],
  );
}

export class PostgresDeviceCommandRepository implements DeviceCommandRepository {
  constructor(readonly pool: Pool) {}

  async commandByIdempotency(
    accountId: string,
    sessionId: string,
    idempotencyHash: string,
  ) {
    const result = await this.pool.query<CommandRow>(
      `SELECT ${columns} FROM sessions.device_commands
       WHERE account_id=$1 AND session_id=$2 AND command_id::text=(
         SELECT resource_id FROM sessions.idempotency_records
         WHERE account_id=$1 AND operation=$3 AND key_hash=$4 AND expires_at>now()
       )`,
      [accountId, sessionId, `command.create:${sessionId}`, idempotencyHash],
    );
    return result.rowCount ? commandRow(result.rows[0]!) : null;
  }

  async createCommand(
    input: Parameters<DeviceCommandRepository["createCommand"]>[0],
  ) {
    return transaction(this.pool, async (client): Promise<CommandMutation> => {
      const operation = `command.create:${input.sessionId}`;
      const prior = await replay(
        client,
        input.accountId,
        operation,
        input.idempotencyHash,
      );
      if (prior) return { kind: "replayed", value: prior };
      const session = await client.query(
        `SELECT 1 FROM sessions.cloud_sessions
         WHERE account_id=$1 AND session_id=$2 AND status<>'deleting' FOR UPDATE`,
        [input.accountId, input.sessionId],
      );
      if (!session.rowCount) return { kind: "not_found" };
      const lease = await client.query(
        `SELECT 1 FROM sessions.session_leases
         WHERE account_id=$1 AND session_id=$2 AND device_id=$3 AND lease_id=$4 AND generation=$5
           AND state='active' AND expires_at>now() FOR UPDATE`,
        [
          input.accountId,
          input.sessionId,
          input.deviceId,
          input.leaseId,
          input.leaseGeneration,
        ],
      );
      if (!lease.rowCount) return { kind: "lease_conflict" };
      const sequence = await client.query<{ next: string }>(
        `SELECT COALESCE(max(sequence),0)+1 AS next FROM sessions.device_commands
         WHERE account_id=$1 AND session_id=$2`,
        [input.accountId, input.sessionId],
      );
      const result = await client.query<CommandRow>(
        `INSERT INTO sessions.device_commands
         (account_id,session_id,command_id,sequence,lease_id,lease_generation,
          checkpoint_revision,command_kind,risk,action_digest,state,expires_at,
          payload_object_key,payload_ciphertext_size_bytes,payload_ciphertext_sha256)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13,$14)
         RETURNING ${columns}`,
        [
          input.accountId,
          input.sessionId,
          input.commandId,
          Number(sequence.rows[0]!.next),
          input.leaseId,
          input.leaseGeneration,
          input.checkpointRevision,
          input.commandKind,
          input.risk,
          input.actionDigest,
          input.expiresAt,
          input.payloadObjectKey ?? null,
          input.payloadCiphertextSizeBytes ?? null,
          input.payloadCiphertextSha256 ?? null,
        ],
      );
      const value = commandRow(result.rows[0]!);
      await remember(
        client,
        input.accountId,
        operation,
        input.idempotencyHash,
        input.commandId,
        value.sequence,
      );
      return { kind: "created", value };
    });
  }

  async commands(input: Parameters<DeviceCommandRepository["commands"]>[0]) {
    const lease = await this.pool.query(
      `SELECT 1 FROM sessions.session_leases
       WHERE account_id=$1 AND session_id=$2 AND device_id=$3 AND lease_id=$4
         AND generation=$5 AND state IN ('active','grace') AND grace_expires_at>now()`,
      [
        input.accountId,
        input.sessionId,
        input.deviceId,
        input.leaseId,
        input.leaseGeneration,
      ],
    );
    if (!lease.rowCount) return [];
    const result = await this.pool.query<CommandRow>(
      `SELECT ${columns} FROM sessions.device_commands
       WHERE account_id=$1 AND session_id=$2 AND lease_id=$3 AND lease_generation=$4
         AND sequence>$5 ORDER BY sequence ASC LIMIT $6`,
      [
        input.accountId,
        input.sessionId,
        input.leaseId,
        input.leaseGeneration,
        input.afterSequence,
        input.limit,
      ],
    );
    return result.rows.map(commandRow);
  }

  async transitionCommand(
    input: Parameters<DeviceCommandRepository["transitionCommand"]>[0],
  ) {
    return transaction(this.pool, async (client): Promise<CommandMutation> => {
      const operation = `command.transition:${input.commandId}:${input.to}`;
      const prior = await replay(
        client,
        input.accountId,
        operation,
        input.idempotencyHash,
      );
      if (prior) return { kind: "replayed", value: prior };
      const lease = await client.query(
        `SELECT 1 FROM sessions.session_leases
         WHERE account_id=$1 AND session_id=$2 AND device_id=$3 AND lease_id=$4
           AND generation=$5 AND state IN ('active','grace') AND grace_expires_at>now()
         FOR UPDATE`,
        [
          input.accountId,
          input.sessionId,
          input.deviceId,
          input.leaseId,
          input.leaseGeneration,
        ],
      );
      if (!lease.rowCount) return { kind: "generation_conflict" };
      const current = await client.query<CommandRow>(
        `SELECT ${columns} FROM sessions.device_commands
         WHERE account_id=$1 AND session_id=$2 AND command_id=$3
           AND lease_id=$4 AND lease_generation=$5 FOR UPDATE`,
        [
          input.accountId,
          input.sessionId,
          input.commandId,
          input.leaseId,
          input.leaseGeneration,
        ],
      );
      if (!current.rowCount) return { kind: "not_found" };
      if (!canTransitionBrowserCommand(current.rows[0]!.state, input.to))
        return { kind: "invalid_transition" };
      const terminal = ["succeeded", "failed", "outcome_unknown"].includes(
        input.to,
      );
      if (terminal !== Boolean(input.outcomeCode))
        return { kind: "state_conflict" };
      const result = await client.query<CommandRow>(
        `UPDATE sessions.device_commands SET state=$6,outcome_code=$7,updated_at=now()
         WHERE account_id=$1 AND session_id=$2 AND command_id=$3
           AND lease_id=$4 AND lease_generation=$5 AND state=$8
         RETURNING ${columns}`,
        [
          input.accountId,
          input.sessionId,
          input.commandId,
          input.leaseId,
          input.leaseGeneration,
          input.to,
          input.outcomeCode ?? null,
          current.rows[0]!.state,
        ],
      );
      if (!result.rowCount) return { kind: "state_conflict" };
      const value = commandRow(result.rows[0]!);
      await remember(
        client,
        input.accountId,
        operation,
        input.idempotencyHash,
        input.commandId,
        value.sequence,
      );
      return { kind: "updated", value };
    });
  }
}
