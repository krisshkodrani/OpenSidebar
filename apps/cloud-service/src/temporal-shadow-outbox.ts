import { createHmac, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export const TEMPORAL_SHADOW_EVENT_TYPES = [
  "session_created",
  "session_updated",
  "checkpoint_committed",
  "device_connected",
  "lease_changed",
  "command_changed",
  "session_deleted",
] as const;
export type TemporalShadowEventType =
  (typeof TEMPORAL_SHADOW_EVENT_TYPES)[number];

export type TemporalShadowEvent = {
  schemaVersion: 1;
  eventId: string;
  accountHash: string;
  sessionId: string;
  eventType: TemporalShadowEventType;
  revision: number;
  deadlineAt?: string;
  occurredAt: string;
  claimToken: string;
};

export const temporalAccountHash = (accountId: string, key: string) =>
  createHmac("sha256", key).update(accountId).digest("hex");

export class TemporalShadowOutbox {
  constructor(private readonly pool: Pool) {}

  async migrate(sql: string) {
    await this.pool.query(sql);
  }

  async enqueue(
    input: Omit<
      TemporalShadowEvent,
      "schemaVersion" | "eventId" | "accountHash" | "occurredAt" | "claimToken"
    > & { accountId: string; hashKey: string },
  ) {
    return this.enqueueWithClient(this.pool, input);
  }

  async enqueueWithClient(
    client: Pool | PoolClient,
    input: Omit<
      TemporalShadowEvent,
      "schemaVersion" | "eventId" | "accountHash" | "occurredAt" | "claimToken"
    > & { accountId: string; hashKey: string },
  ) {
    const eventId = randomUUID();
    await client.query(
      `INSERT INTO temporal_shadow.events(event_id,account_hash,session_id,event_type,revision,deadline_at)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [
        eventId,
        temporalAccountHash(input.accountId, input.hashKey),
        input.sessionId,
        input.eventType,
        input.revision,
        input.deadlineAt ?? null,
      ],
    );
    return eventId;
  }

  async claim(limit = 25): Promise<TemporalShadowEvent[]> {
    const claimToken = randomUUID();
    const result = await this.pool.query<{
      event_id: string;
      account_hash: string;
      session_id: string;
      event_type: TemporalShadowEventType;
      revision: string;
      deadline_at: Date | null;
      occurred_at: Date;
      claim_token: string;
    }>(
      `WITH candidates AS (
         SELECT event_id FROM temporal_shadow.events
         WHERE completed_at IS NULL AND available_at<=now()
           AND (claimed_until IS NULL OR claimed_until<now())
         ORDER BY occurred_at FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE temporal_shadow.events e SET claim_token=$2, claimed_until=now()+interval '30 seconds', attempts=attempts+1
       FROM candidates c WHERE e.event_id=c.event_id
       RETURNING e.event_id,e.account_hash,e.session_id,e.event_type,e.revision,e.deadline_at,e.occurred_at,e.claim_token`,
      [Math.max(1, Math.min(limit, 100)), claimToken],
    );
    return result.rows.map((row) => ({
      schemaVersion: 1,
      eventId: row.event_id,
      accountHash: row.account_hash,
      sessionId: row.session_id,
      eventType: row.event_type,
      revision: Number(row.revision),
      deadlineAt: row.deadline_at?.toISOString(),
      occurredAt: row.occurred_at.toISOString(),
      claimToken: row.claim_token,
    }));
  }

  async complete(eventId: string, claimToken: string) {
    const result = await this.pool.query(
      `UPDATE temporal_shadow.events SET completed_at=now(),claimed_until=NULL
       WHERE event_id=$1 AND claim_token=$2 AND completed_at IS NULL`,
      [eventId, claimToken],
    );
    return result.rowCount === 1;
  }

  async retry(eventId: string, claimToken: string) {
    await this.pool.query(
      `UPDATE temporal_shadow.events SET claimed_until=NULL,claim_token=NULL,
       available_at=now()+least(attempts,60)*interval '1 second'
       WHERE event_id=$1 AND claim_token=$2 AND completed_at IS NULL`,
      [eventId, claimToken],
    );
  }
}
