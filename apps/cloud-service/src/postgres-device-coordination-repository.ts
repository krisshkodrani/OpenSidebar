import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  CloudDeviceConnectionV1,
  SessionLeaseV1,
} from "@opensidebar/shared-types";
import type { DeviceCoordinationRepository } from "./device-coordination-repository.js";

type ConnectionRow = {
  connection_id: string;
  device_id: string;
  transport: "sse" | "long_poll";
  last_acknowledged_sequence: string;
  connected_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
};

type LeaseRow = {
  session_id: string;
  lease_id: string;
  device_id: string;
  generation: string;
  acquired_at: Date;
  heartbeat_at: Date;
  expires_at: Date;
  checkpoint_revision: string;
  state: SessionLeaseV1["state"];
};

const connectionColumns = `connection_id,device_id,transport,
  last_acknowledged_sequence,connected_at,last_seen_at,expires_at,revoked_at`;
const leaseColumns = `session_id,lease_id,device_id,generation,acquired_at,
  heartbeat_at,expires_at,checkpoint_revision,state`;

const connectionRow = (row: ConnectionRow): CloudDeviceConnectionV1 => ({
  schemaVersion: 1,
  connectionId: row.connection_id,
  deviceId: row.device_id,
  transport: row.transport,
  lastAcknowledgedSequence: Number(row.last_acknowledged_sequence),
  connectedAt: row.connected_at.toISOString(),
  lastSeenAt: row.last_seen_at.toISOString(),
  expiresAt: row.expires_at.toISOString(),
  ...(row.revoked_at ? { revokedAt: row.revoked_at.toISOString() } : {}),
});

const leaseRow = (row: LeaseRow): SessionLeaseV1 => ({
  schemaVersion: 1,
  sessionId: row.session_id,
  leaseId: row.lease_id,
  deviceId: row.device_id,
  generation: Number(row.generation),
  acquiredAt: row.acquired_at.toISOString(),
  heartbeatAt: row.heartbeat_at.toISOString(),
  expiresAt: row.expires_at.toISOString(),
  checkpointRevision: Number(row.checkpoint_revision),
  state: row.state,
});

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

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function priorResource(
  client: PoolClient,
  accountId: string,
  operation: string,
  idempotencyHash: string,
) {
  const result = await client.query<{ resource_id: string }>(
    `SELECT resource_id FROM sessions.idempotency_records
     WHERE account_id=$1 AND operation=$2 AND key_hash=$3 AND expires_at>now()`,
    [accountId, operation, idempotencyHash],
  );
  return result.rows[0]?.resource_id ?? null;
}

async function remember(
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

export class PostgresDeviceCoordinationRepository implements DeviceCoordinationRepository {
  constructor(readonly pool: Pool) {}

  async createConnection(
    accountId: string,
    deviceId: string,
    connectionId: string,
    transport: "sse" | "long_poll",
    expiresAt: Date,
    idempotencyHash: string,
  ) {
    try {
      return await transaction(this.pool, async (client) => {
        const operation = `connection.create:${deviceId}`;
        const prior = await priorResource(
          client,
          accountId,
          operation,
          idempotencyHash,
        );
        if (prior) {
          const found = await client.query<ConnectionRow>(
            `SELECT ${connectionColumns} FROM sessions.device_connections
             WHERE account_id=$1 AND device_id=$2 AND connection_id=$3`,
            [accountId, deviceId, prior],
          );
          return found.rowCount
            ? {
                kind: "replayed" as const,
                value: connectionRow(found.rows[0]!),
              }
            : { kind: "not_found" as const };
        }
        const result = await client.query<ConnectionRow>(
          `INSERT INTO sessions.device_connections
           (account_id,device_id,connection_id,transport,expires_at)
           VALUES($1,$2,$3,$4,$5) RETURNING ${connectionColumns}`,
          [accountId, deviceId, connectionId, transport, expiresAt],
        );
        await remember(
          client,
          accountId,
          operation,
          idempotencyHash,
          connectionId,
          1,
        );
        return {
          kind: "created" as const,
          value: connectionRow(result.rows[0]!),
        };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23503")
        return { kind: "device_mismatch" as const };
      throw error;
    }
  }

  async connection(accountId: string, deviceId: string, connectionId: string) {
    const result = await this.pool.query<ConnectionRow>(
      `SELECT ${connectionColumns} FROM sessions.device_connections
       WHERE account_id=$1 AND device_id=$2 AND connection_id=$3
         AND revoked_at IS NULL AND expires_at>now()`,
      [accountId, deviceId, connectionId],
    );
    return result.rowCount ? connectionRow(result.rows[0]!) : null;
  }

  async acquireLease(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    connectionId: string;
    leaseId: string;
    expectedSessionRevision: number;
    idempotencyHash: string;
  }) {
    try {
      return await transaction(this.pool, async (client) => {
        const operation = `lease.acquire:${input.sessionId}`;
        const priorResourceId = await priorResource(
          client,
          input.accountId,
          operation,
          input.idempotencyHash,
        );
        if (priorResourceId) {
          const found = await client.query<LeaseRow>(
            `SELECT ${leaseColumns} FROM sessions.session_leases
           WHERE account_id=$1 AND lease_id=$2`,
            [input.accountId, priorResourceId],
          );
          return found.rowCount
            ? { kind: "replayed" as const, value: leaseRow(found.rows[0]!) }
            : { kind: "not_found" as const };
        }
        const session = await client.query<{
          revision: string;
          latest_checkpoint_revision: string | null;
          status: string;
        }>(
          `SELECT revision,latest_checkpoint_revision,status
         FROM sessions.cloud_sessions WHERE account_id=$1 AND session_id=$2 FOR UPDATE`,
          [input.accountId, input.sessionId],
        );
        if (!session.rowCount) return { kind: "not_found" as const };
        if (
          Number(session.rows[0]!.revision) !== input.expectedSessionRevision ||
          session.rows[0]!.status === "deleting"
        )
          return { kind: "revision_conflict" as const };
        const connection = await client.query(
          `SELECT 1 FROM sessions.device_connections
         WHERE account_id=$1 AND device_id=$2 AND connection_id=$3
           AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`,
          [input.accountId, input.deviceId, input.connectionId],
        );
        if (!connection.rowCount) return { kind: "device_mismatch" as const };
        const prior = await client.query<LeaseRow & { grace_expires_at: Date }>(
          `SELECT ${leaseColumns},grace_expires_at FROM sessions.session_leases
         WHERE account_id=$1 AND session_id=$2
         ORDER BY generation DESC LIMIT 1 FOR UPDATE`,
          [input.accountId, input.sessionId],
        );
        if (
          prior.rowCount &&
          ["active", "grace"].includes(prior.rows[0]!.state) &&
          prior.rows[0]!.grace_expires_at > new Date()
        )
          return { kind: "lease_conflict" as const };
        const generation = prior.rowCount
          ? Number(prior.rows[0]!.generation) + 1
          : 1;
        if (
          prior.rowCount &&
          ["active", "grace"].includes(prior.rows[0]!.state)
        )
          await client.query(
            `UPDATE sessions.session_leases SET state='expired',revision=revision+1
           WHERE account_id=$1 AND lease_id=$2`,
            [input.accountId, prior.rows[0]!.lease_id],
          );
        const result = await client.query<LeaseRow>(
          `INSERT INTO sessions.session_leases
         (account_id,session_id,lease_id,device_id,connection_id,generation,
          checkpoint_revision,state,expires_at,grace_expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,'active',now()+interval '90 seconds',now()+interval '5 minutes')
         RETURNING ${leaseColumns}`,
          [
            input.accountId,
            input.sessionId,
            input.leaseId,
            input.deviceId,
            input.connectionId,
            generation,
            Number(session.rows[0]!.latest_checkpoint_revision ?? 0),
          ],
        );
        await remember(
          client,
          input.accountId,
          operation,
          input.idempotencyHash,
          input.leaseId,
          generation,
        );
        return { kind: "created" as const, value: leaseRow(result.rows[0]!) };
      });
    } catch (error) {
      if (
        (error as { code?: string; constraint?: string }).code === "23505" &&
        (error as { constraint?: string }).constraint ===
          "session_leases_one_live"
      )
        return { kind: "lease_conflict" as const };
      throw error;
    }
  }

  async heartbeatLease(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    connectionId: string;
    leaseId: string;
    generation: number;
    idempotencyHash: string;
  }) {
    return transaction(this.pool, async (client) => {
      const operation = `lease.heartbeat:${input.sessionId}:${input.generation}`;
      const prior = await priorResource(
        client,
        input.accountId,
        operation,
        input.idempotencyHash,
      );
      if (prior) {
        const found = await client.query<LeaseRow>(
          `SELECT ${leaseColumns} FROM sessions.session_leases
           WHERE account_id=$1 AND lease_id=$2`,
          [input.accountId, prior],
        );
        return found.rowCount
          ? { kind: "replayed" as const, value: leaseRow(found.rows[0]!) }
          : { kind: "not_found" as const };
      }
      const result = await client.query<LeaseRow>(
        `UPDATE sessions.session_leases SET state='active',heartbeat_at=now(),
         expires_at=now()+interval '90 seconds',grace_expires_at=now()+interval '5 minutes',revision=revision+1
         WHERE account_id=$1 AND session_id=$2 AND device_id=$3 AND connection_id=$4
           AND lease_id=$5 AND generation=$6 AND state IN ('active','grace')
           AND grace_expires_at>now()
         RETURNING ${leaseColumns}`,
        [
          input.accountId,
          input.sessionId,
          input.deviceId,
          input.connectionId,
          input.leaseId,
          input.generation,
        ],
      );
      if (!result.rowCount) return { kind: "generation_conflict" as const };
      await remember(
        client,
        input.accountId,
        operation,
        input.idempotencyHash,
        input.leaseId,
        input.generation,
      );
      return { kind: "updated" as const, value: leaseRow(result.rows[0]!) };
    });
  }

  async reconnectLease(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    connectionId: string;
    leaseId: string;
    generation: number;
    idempotencyHash: string;
  }) {
    return transaction(this.pool, async (client) => {
      const operation = `lease.reconnect:${input.sessionId}:${input.generation}`;
      const prior = await priorResource(
        client,
        input.accountId,
        operation,
        input.idempotencyHash,
      );
      if (prior) {
        const found = await client.query<LeaseRow>(
          `SELECT ${leaseColumns} FROM sessions.session_leases
           WHERE account_id=$1 AND lease_id=$2`,
          [input.accountId, prior],
        );
        return found.rowCount
          ? { kind: "replayed" as const, value: leaseRow(found.rows[0]!) }
          : { kind: "not_found" as const };
      }
      const result = await client.query<LeaseRow>(
        `UPDATE sessions.session_leases SET connection_id=$4,state='active',
         heartbeat_at=now(),expires_at=now()+interval '90 seconds',
         grace_expires_at=now()+interval '5 minutes',revision=revision+1
         WHERE account_id=$1 AND session_id=$2 AND device_id=$3
           AND lease_id=$5 AND generation=$6 AND state IN ('active','grace')
           AND grace_expires_at>now()
           AND EXISTS (
             SELECT 1 FROM sessions.device_connections
             WHERE account_id=$1 AND device_id=$3 AND connection_id=$4
               AND revoked_at IS NULL AND expires_at>now()
           )
         RETURNING ${leaseColumns}`,
        [
          input.accountId,
          input.sessionId,
          input.deviceId,
          input.connectionId,
          input.leaseId,
          input.generation,
        ],
      );
      if (!result.rowCount) return { kind: "generation_conflict" as const };
      await remember(
        client,
        input.accountId,
        operation,
        input.idempotencyHash,
        input.leaseId,
        input.generation,
      );
      return { kind: "updated" as const, value: leaseRow(result.rows[0]!) };
    });
  }

  async takeoverLease(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    connectionId: string;
    leaseId: string;
    expectedSessionRevision: number;
    expectedGeneration: number;
    idempotencyHash: string;
  }) {
    return transaction(this.pool, async (client) => {
      const operation = `lease.takeover:${input.sessionId}`;
      const priorResourceId = await priorResource(
        client,
        input.accountId,
        operation,
        input.idempotencyHash,
      );
      if (priorResourceId) {
        const found = await client.query<LeaseRow>(
          `SELECT ${leaseColumns} FROM sessions.session_leases
           WHERE account_id=$1 AND lease_id=$2`,
          [input.accountId, priorResourceId],
        );
        return found.rowCount
          ? { kind: "replayed" as const, value: leaseRow(found.rows[0]!) }
          : { kind: "not_found" as const };
      }
      const session = await client.query<{
        revision: string;
        latest_checkpoint_revision: string | null;
        status: string;
      }>(
        `SELECT revision,latest_checkpoint_revision,status FROM sessions.cloud_sessions
         WHERE account_id=$1 AND session_id=$2 FOR UPDATE`,
        [input.accountId, input.sessionId],
      );
      if (!session.rowCount) return { kind: "not_found" as const };
      if (
        Number(session.rows[0]!.revision) !== input.expectedSessionRevision ||
        session.rows[0]!.status === "deleting"
      )
        return { kind: "revision_conflict" as const };
      const connection = await client.query(
        `SELECT 1 FROM sessions.device_connections
         WHERE account_id=$1 AND device_id=$2 AND connection_id=$3
           AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`,
        [input.accountId, input.deviceId, input.connectionId],
      );
      if (!connection.rowCount) return { kind: "device_mismatch" as const };
      const prior = await client.query<LeaseRow>(
        `SELECT ${leaseColumns} FROM sessions.session_leases
         WHERE account_id=$1 AND session_id=$2 AND state IN ('active','grace')
         ORDER BY generation DESC LIMIT 1 FOR UPDATE`,
        [input.accountId, input.sessionId],
      );
      if (
        !prior.rowCount ||
        Number(prior.rows[0]!.generation) !== input.expectedGeneration
      )
        return { kind: "generation_conflict" as const };
      await client.query(
        `UPDATE sessions.session_leases SET state='revoked',revision=revision+1
         WHERE account_id=$1 AND lease_id=$2`,
        [input.accountId, prior.rows[0]!.lease_id],
      );
      const result = await client.query<LeaseRow>(
        `INSERT INTO sessions.session_leases
         (account_id,session_id,lease_id,device_id,connection_id,generation,
          checkpoint_revision,state,expires_at,grace_expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,'active',now()+interval '90 seconds',now()+interval '5 minutes')
         RETURNING ${leaseColumns}`,
        [
          input.accountId,
          input.sessionId,
          input.leaseId,
          input.deviceId,
          input.connectionId,
          input.expectedGeneration + 1,
          Number(session.rows[0]!.latest_checkpoint_revision ?? 0),
        ],
      );
      await remember(
        client,
        input.accountId,
        operation,
        input.idempotencyHash,
        input.leaseId,
        Number(result.rows[0]!.generation),
      );
      return { kind: "updated" as const, value: leaseRow(result.rows[0]!) };
    });
  }

  async releaseLease(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    leaseId: string;
    generation: number;
    idempotencyHash: string;
  }) {
    return transaction(this.pool, async (client) => {
      const operation = `lease.release:${input.sessionId}:${input.generation}`;
      const prior = await priorResource(
        client,
        input.accountId,
        operation,
        input.idempotencyHash,
      );
      if (prior) {
        const found = await client.query<LeaseRow>(
          `SELECT ${leaseColumns} FROM sessions.session_leases
           WHERE account_id=$1 AND lease_id=$2`,
          [input.accountId, prior],
        );
        return found.rowCount
          ? { kind: "replayed" as const, value: leaseRow(found.rows[0]!) }
          : { kind: "not_found" as const };
      }
      const result = await client.query<LeaseRow>(
        `UPDATE sessions.session_leases SET state='revoked',revision=revision+1
         WHERE account_id=$1 AND session_id=$2 AND device_id=$3 AND lease_id=$4
           AND generation=$5 AND state IN ('active','grace')
         RETURNING ${leaseColumns}`,
        [
          input.accountId,
          input.sessionId,
          input.deviceId,
          input.leaseId,
          input.generation,
        ],
      );
      if (!result.rowCount) return { kind: "generation_conflict" as const };
      await remember(
        client,
        input.accountId,
        operation,
        input.idempotencyHash,
        input.leaseId,
        input.generation,
      );
      return { kind: "updated" as const, value: leaseRow(result.rows[0]!) };
    });
  }

  async lease(accountId: string, sessionId: string) {
    const result = await this.pool.query<LeaseRow>(
      `SELECT ${leaseColumns} FROM sessions.session_leases
       WHERE account_id=$1 AND session_id=$2
       ORDER BY generation DESC LIMIT 1`,
      [accountId, sessionId],
    );
    return result.rowCount ? leaseRow(result.rows[0]!) : null;
  }
}
