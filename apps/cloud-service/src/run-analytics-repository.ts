import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import type { AccountRunAnalyticsV1, RunAnalyticsSnapshotV1 } from "@opensidebar/shared-types";

export interface RunAnalyticsStore {
  consent(accountId: string): Promise<string | null>;
  setConsent(accountId: string, enabled: boolean): Promise<string | null>;
  list(accountId: string): Promise<AccountRunAnalyticsV1["runs"]>;
  upsert(accountId: string, deviceId: string, snapshot: RunAnalyticsSnapshotV1): Promise<"saved" | "stale" | "disabled">;
}

export class PostgresRunAnalyticsRepository implements RunAnalyticsStore {
  constructor(private readonly pool: Pool) {}

  async migrate() {
    const here = dirname(fileURLToPath(import.meta.url));
    await this.pool.query(await readFile(resolve(here, "../migrations/022_run_analytics.sql"), "utf8"));
  }

  async cleanupExpired() {
    await this.pool.query("DELETE FROM control.run_analytics WHERE started_at < now() - interval '90 days'");
  }

  async consent(accountId: string) {
    const result = await this.pool.query<{ enabled_at: Date | null }>(
      "SELECT enabled_at FROM control.run_analytics_consent WHERE account_id=$1", [accountId],
    );
    return result.rows[0]?.enabled_at?.toISOString() ?? null;
  }

  async setConsent(accountId: string, enabled: boolean) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // The same row lock is used by upsert, so opt-out cannot race a late write.
      await client.query("INSERT INTO control.run_analytics_consent(account_id) VALUES($1) ON CONFLICT DO NOTHING", [accountId]);
      const updated = await client.query<{ enabled_at: Date | null }>(
        "UPDATE control.run_analytics_consent SET enabled_at=CASE WHEN $2 THEN COALESCE(enabled_at,now()) ELSE NULL END WHERE account_id=$1 RETURNING enabled_at",
        [accountId, enabled],
      );
      const enabledAt = updated.rows[0]?.enabled_at ?? null;
      if (!enabled) await client.query("DELETE FROM control.run_analytics WHERE account_id=$1", [accountId]);
      await client.query("COMMIT");
      return enabledAt?.toISOString() ?? null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async list(accountId: string) {
    const result = await this.pool.query<{ device_id: string; payload: RunAnalyticsSnapshotV1 }>(
      "SELECT device_id,payload FROM control.run_analytics WHERE account_id=$1 AND started_at>=now()-interval '90 days' ORDER BY started_at DESC LIMIT 100", [accountId],
    );
    return result.rows.map((row) => ({ ...row.payload, deviceId: row.device_id }));
  }

  async upsert(accountId: string, deviceId: string, snapshot: RunAnalyticsSnapshotV1): Promise<"saved" | "stale" | "disabled"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const consent = await client.query<{ enabled_at: Date | null }>(
        "SELECT enabled_at FROM control.run_analytics_consent WHERE account_id=$1 FOR UPDATE", [accountId],
      );
      const enabledAt = consent.rows[0]?.enabled_at;
      if (!enabledAt || Date.parse(snapshot.startedAt) < enabledAt.getTime() ||
        Date.parse(snapshot.startedAt) < Date.now() - 90 * 86_400_000) {
        await client.query("COMMIT");
        return "disabled";
      }
      const result = await client.query(
        `INSERT INTO control.run_analytics(account_id,run_id,device_id,sequence,started_at,observed_at,payload)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(account_id,run_id) DO UPDATE SET
           sequence=excluded.sequence,observed_at=excluded.observed_at,payload=excluded.payload
         WHERE control.run_analytics.device_id=excluded.device_id
           AND control.run_analytics.started_at=excluded.started_at
           AND (control.run_analytics.payload->>'state'='running' OR excluded.payload->>'state'<>'running')
           AND control.run_analytics.sequence<excluded.sequence`,
        [accountId, snapshot.runId, deviceId, snapshot.sequence, snapshot.startedAt,
          snapshot.observedAt, snapshot],
      );
      await client.query("COMMIT");
      return result.rowCount ? "saved" : "stale";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
