import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type {
  CloudDeviceV1,
  CloudPreferencesV1,
  CloudProviderId,
  CredentialStatusV1,
} from "@opensidebar/shared-types";
import type {
  ControlAccount,
  ControlPrincipal,
  ControlRepository,
  DeviceSessionWrite,
  EncryptedCredentialRecord,
  RelayUsage,
} from "./control-repository.js";

type AccountRow = {
  account_id: string;
  email: string;
  session_epoch: string;
  cloud_access: boolean;
};
const accountRow = (row: AccountRow): ControlAccount => ({
  accountId: row.account_id,
  email: row.email,
  sessionEpoch: Number(row.session_epoch),
  cloudAccess: row.cloud_access,
});
const deviceRow = (row: {
  id: string;
  installation_id: string;
  display_name: string;
  extension_version: string;
  created_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
}): CloudDeviceV1 => ({
  schemaVersion: 1,
  id: row.id,
  installationId: row.installation_id,
  displayName: row.display_name,
  extensionVersion: row.extension_version,
  createdAt: row.created_at.toISOString(),
  lastSeenAt: row.last_seen_at.toISOString(),
  ...(row.revoked_at ? { revokedAt: row.revoked_at.toISOString() } : {}),
});

export class PostgresControlRepository implements ControlRepository {
  readonly pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 8,
      idleTimeoutMillis: 30_000,
    });
  }
  async migrate() {
    const here = dirname(fileURLToPath(import.meta.url));
    await this.pool.query(
      await readFile(resolve(here, "../migrations/002_control.sql"), "utf8"),
    );
  }
  async health() {
    await this.pool.query("SELECT 1");
  }
  async cleanupExpired() {
    await this.pool.query(
      "DELETE FROM control.device_link_codes WHERE expires_at<=now() OR consumed_at IS NOT NULL",
    );
    await this.pool.query(
      "DELETE FROM control.device_sessions WHERE refresh_expires_at<=now() OR (revoked_at IS NOT NULL AND revoked_at<now()-interval '7 days')",
    );
    await this.pool.query(
      "DELETE FROM control.relay_request_records WHERE expires_at<=now()",
    );
  }
  async upsertAccount(accountId: string, email: string, cloudAccess: boolean) {
    const result = await this.pool.query<AccountRow>(
      `INSERT INTO control.accounts(account_id,email,cloud_access) VALUES($1,$2,$3)
      ON CONFLICT(account_id) DO UPDATE SET email=excluded.email,cloud_access=(control.accounts.cloud_access OR excluded.cloud_access),updated_at=now()
      RETURNING account_id,email,session_epoch,cloud_access`,
      [accountId, email, cloudAccess],
    );
    return accountRow(result.rows[0]!);
  }
  async account(accountId: string) {
    const result = await this.pool.query<AccountRow>(
      "SELECT account_id,email,session_epoch,cloud_access FROM control.accounts WHERE account_id=$1",
      [accountId],
    );
    return result.rows[0] ? accountRow(result.rows[0]) : null;
  }
  async upsertDevice(
    accountId: string,
    installationId: string,
    displayName: string,
    extensionVersion: string,
  ) {
    const result = await this.pool.query(
      `INSERT INTO control.devices(id,account_id,installation_id,display_name,extension_version)
      VALUES('dev_'||substr(md5(random()::text||clock_timestamp()::text),1,24),$1,$2,$3,$4)
      ON CONFLICT(account_id,installation_id) DO UPDATE SET display_name=excluded.display_name,extension_version=excluded.extension_version,last_seen_at=now(),revoked_at=NULL
      RETURNING id,installation_id,display_name,extension_version,created_at,last_seen_at,revoked_at`,
      [accountId, installationId, displayName, extensionVersion],
    );
    return deviceRow(result.rows[0]);
  }
  async createDeviceSession(value: DeviceSessionWrite) {
    await this.pool.query(
      `INSERT INTO control.device_sessions
    (id,device_id,account_id,session_epoch,access_hash,access_expires_at,refresh_hash,refresh_family,refresh_expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        value.id,
        value.deviceId,
        value.accountId,
        value.sessionEpoch,
        value.accessHash,
        value.accessExpiresAt,
        value.refreshHash,
        value.refreshFamily,
        value.refreshExpiresAt,
      ],
    );
  }
  async accessPrincipal(accessHash: string) {
    const result = await this.pool.query<
      AccountRow & {
        device_id: string;
        installation_id: string;
        refresh_family: string;
      }
    >(
      `SELECT a.account_id,a.email,a.session_epoch,a.cloud_access,d.id device_id,d.installation_id,s.refresh_family
      FROM control.device_sessions s JOIN control.accounts a ON a.account_id=s.account_id JOIN control.devices d ON d.id=s.device_id
      WHERE s.access_hash=$1 AND s.access_expires_at>now() AND s.revoked_at IS NULL AND s.session_epoch=a.session_epoch AND d.revoked_at IS NULL`,
      [accessHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    await this.pool.query(
      "UPDATE control.devices SET last_seen_at=now() WHERE id=$1",
      [row.device_id],
    );
    return {
      ...accountRow(row),
      deviceId: row.device_id,
      installationId: row.installation_id,
    };
  }
  async refreshPrincipal(refreshHash: string) {
    const result = await this.pool.query<
      AccountRow & {
        device_id: string;
        installation_id: string;
        refresh_family: string;
      }
    >(
      `SELECT a.account_id,a.email,a.session_epoch,a.cloud_access,d.id device_id,d.installation_id,s.refresh_family
      FROM control.device_sessions s JOIN control.accounts a ON a.account_id=s.account_id JOIN control.devices d ON d.id=s.device_id
      WHERE s.refresh_hash=$1 AND s.refresh_expires_at>now() AND s.session_epoch=a.session_epoch AND d.revoked_at IS NULL`,
      [refreshHash],
    );
    const row = result.rows[0];
    return row
      ? {
          ...accountRow(row),
          deviceId: row.device_id,
          installationId: row.installation_id,
          refreshFamily: row.refresh_family,
        }
      : null;
  }
  async consumeRefresh(
    refreshHash: string,
    replacement: DeviceSessionWrite,
  ): Promise<ControlPrincipal | "reused" | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<
        AccountRow & {
          id: string;
          device_id: string;
          installation_id: string;
          refresh_family: string;
          rotated_at: Date | null;
          revoked_at: Date | null;
          refresh_expires_at: Date;
        }
      >(
        `SELECT s.id,s.device_id,s.refresh_family,s.rotated_at,s.revoked_at,s.refresh_expires_at,a.account_id,a.email,a.session_epoch,a.cloud_access,d.installation_id
        FROM control.device_sessions s JOIN control.accounts a ON a.account_id=s.account_id JOIN control.devices d ON d.id=s.device_id
        WHERE s.refresh_hash=$1 FOR UPDATE`,
        [refreshHash],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      if (row.rotated_at || row.revoked_at) {
        await client.query(
          "UPDATE control.device_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE refresh_family=$1",
          [row.refresh_family],
        );
        await client.query("COMMIT");
        return "reused";
      }
      if (
        row.refresh_expires_at <= new Date() ||
        Number(row.session_epoch) !== replacement.sessionEpoch ||
        row.account_id !== replacement.accountId ||
        row.device_id !== replacement.deviceId ||
        row.refresh_family !== replacement.refreshFamily
      ) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        "UPDATE control.device_sessions SET rotated_at=now(),revoked_at=now() WHERE id=$1",
        [row.id],
      );
      await client.query(
        `INSERT INTO control.device_sessions(id,device_id,account_id,session_epoch,access_hash,access_expires_at,refresh_hash,refresh_family,refresh_expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          replacement.id,
          replacement.deviceId,
          replacement.accountId,
          replacement.sessionEpoch,
          replacement.accessHash,
          replacement.accessExpiresAt,
          replacement.refreshHash,
          replacement.refreshFamily,
          replacement.refreshExpiresAt,
        ],
      );
      await client.query("COMMIT");
      return {
        ...accountRow(row),
        deviceId: row.device_id,
        installationId: row.installation_id,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async revokeAccessSession(accessHash: string) {
    await this.pool.query(
      "UPDATE control.device_sessions SET revoked_at=now() WHERE access_hash=$1",
      [accessHash],
    );
  }
  async listDevices(accountId: string) {
    const result = await this.pool.query(
      "SELECT id,installation_id,display_name,extension_version,created_at,last_seen_at,revoked_at FROM control.devices WHERE account_id=$1 ORDER BY last_seen_at DESC",
      [accountId],
    );
    return result.rows.map(deviceRow);
  }
  async revokeDevice(accountId: string, deviceId: string) {
    const result = await this.pool.query(
      "UPDATE control.devices SET revoked_at=now() WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL",
      [deviceId, accountId],
    );
    await this.pool.query(
      "UPDATE control.device_sessions SET revoked_at=now() WHERE device_id=$1",
      [deviceId],
    );
    return result.rowCount === 1;
  }
  async logoutAll(accountId: string) {
    const result = await this.pool.query<{ session_epoch: string }>(
      "UPDATE control.accounts SET session_epoch=session_epoch+1,updated_at=now() WHERE account_id=$1 RETURNING session_epoch",
      [accountId],
    );
    await this.pool.query(
      "UPDATE control.device_sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL",
      [accountId],
    );
    return Number(result.rows[0]?.session_epoch ?? 0);
  }
  async createDeviceLink(codeHash: string, accountId: string, expiresAt: Date) {
    await this.pool.query(
      "INSERT INTO control.device_link_codes(code_hash,account_id,expires_at) VALUES($1,$2,$3)",
      [codeHash, accountId, expiresAt],
    );
  }
  async consumeDeviceLink(codeHash: string) {
    const result = await this.pool.query<AccountRow>(
      `UPDATE control.device_link_codes l SET attempts=attempts+1,consumed_at=now() FROM control.accounts a
    WHERE l.code_hash=$1 AND l.account_id=a.account_id AND l.consumed_at IS NULL AND l.expires_at>now() AND l.attempts<5
    RETURNING a.account_id,a.email,a.session_epoch,a.cloud_access`,
      [codeHash],
    );
    return result.rows[0] ? accountRow(result.rows[0]) : null;
  }
  async preferences(accountId: string) {
    const result = await this.pool.query<{ payload: CloudPreferencesV1 }>(
      "SELECT payload FROM control.preferences WHERE account_id=$1",
      [accountId],
    );
    return result.rows[0]?.payload ?? null;
  }
  async putPreferences(
    accountId: string,
    expectedRevision: number,
    preferences: CloudPreferencesV1,
  ) {
    const result = await this.pool.query<{ applied: boolean }>(
      `WITH updated AS (
        UPDATE control.preferences
        SET schema_version=1,revision=$2,payload=$3,updated_at=now()
        WHERE account_id=$1 AND revision=$4
        RETURNING 1
      ), inserted AS (
        INSERT INTO control.preferences(account_id,schema_version,revision,payload)
        SELECT $1,1,$2,$3
        WHERE $4=0
          AND NOT EXISTS (SELECT 1 FROM control.preferences WHERE account_id=$1)
        ON CONFLICT(account_id) DO NOTHING
        RETURNING 1
      )
      SELECT EXISTS(SELECT 1 FROM updated UNION ALL SELECT 1 FROM inserted) AS applied`,
      [accountId, preferences.revision, preferences, expectedRevision],
    );
    return result.rows[0]?.applied === true;
  }
  async credential(accountId: string, provider: CloudProviderId) {
    const result = await this.pool.query(
      "SELECT account_id,provider,ciphertext,encrypted_data_key,fingerprint,verification,last_verified_at,updated_at FROM control.encrypted_credentials WHERE account_id=$1 AND provider=$2",
      [accountId, provider],
    );
    const row = result.rows[0];
    return row
      ? {
          accountId: row.account_id,
          provider: row.provider,
          ciphertext: row.ciphertext,
          encryptedDataKey: row.encrypted_data_key,
          fingerprint: row.fingerprint,
          verification: row.verification,
          lastVerifiedAt: row.last_verified_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        }
      : null;
  }
  async credentialStatuses(accountId: string): Promise<CredentialStatusV1[]> {
    const result = await this.pool.query(
      "SELECT provider,fingerprint,verification,last_verified_at FROM control.encrypted_credentials WHERE account_id=$1",
      [accountId],
    );
    const found = new Map(result.rows.map((row) => [row.provider, row]));
    return (["openrouter", "fireworks"] as const).map((provider) => {
      const row = found.get(provider);
      return row
        ? {
            schemaVersion: 1,
            provider,
            configured: true,
            fingerprint: row.fingerprint,
            lastVerifiedAt: row.last_verified_at.toISOString(),
            verification: row.verification,
          }
        : {
            schemaVersion: 1,
            provider,
            configured: false,
            verification: "never",
          };
    });
  }
  async putCredential(row: EncryptedCredentialRecord) {
    await this.pool.query(
      `INSERT INTO control.encrypted_credentials(account_id,provider,ciphertext,encrypted_data_key,fingerprint,verification,last_verified_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(account_id,provider) DO UPDATE SET ciphertext=excluded.ciphertext,encrypted_data_key=excluded.encrypted_data_key,fingerprint=excluded.fingerprint,verification=excluded.verification,last_verified_at=excluded.last_verified_at,updated_at=excluded.updated_at`,
      [
        row.accountId,
        row.provider,
        row.ciphertext,
        row.encryptedDataKey,
        row.fingerprint,
        row.verification,
        row.lastVerifiedAt,
        row.updatedAt,
      ],
    );
  }
  async deleteCredential(accountId: string, provider: CloudProviderId) {
    await this.pool.query(
      "DELETE FROM control.encrypted_credentials WHERE account_id=$1 AND provider=$2",
      [accountId, provider],
    );
  }
  async relayUsage(accountId: string): Promise<RelayUsage> {
    const result = await this.pool.query(
      "SELECT requests,input_tokens,output_tokens FROM control.relay_usage WHERE account_id=$1 AND period_start=date_trunc('month',now())::date",
      [accountId],
    );
    const row = result.rows[0];
    return {
      requests: Number(row?.requests ?? 0),
      inputTokens: Number(row?.input_tokens ?? 0),
      outputTokens: Number(row?.output_tokens ?? 0),
    };
  }
  async recoverInterruptedRelayRequests(before: Date) {
    const result = await this.pool.query(
      `UPDATE control.relay_request_records
       SET status='failed',status_class=0,latency_bucket='interrupted',updated_at=now()
       WHERE status='active' AND updated_at<$1`,
      [before],
    );
    return result.rowCount ?? 0;
  }
  async beginRelayRequest(
    accountId: string,
    requestId: string,
    provider: CloudProviderId,
    modelId: string,
    requestLimit: number,
    tokenLimit: number,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        accountId,
      ]);
      const usage = await client.query(
        "SELECT requests,input_tokens,output_tokens FROM control.relay_usage WHERE account_id=$1 AND period_start=date_trunc('month',now())::date",
        [accountId],
      );
      const row = usage.rows[0];
      const current = {
        requests: Number(row?.requests ?? 0),
        inputTokens: Number(row?.input_tokens ?? 0),
        outputTokens: Number(row?.output_tokens ?? 0),
      };
      if (
        current.requests >= requestLimit ||
        current.inputTokens + current.outputTokens >= tokenLimit
      )
        throw Object.assign(new Error("relay_quota"), { code: "relay_quota" });
      await client.query(
        "INSERT INTO control.relay_request_records(account_id,request_id,provider,model_id,status,expires_at) VALUES($1,$2,$3,$4,'active',now()+interval '24 hours')",
        [accountId, requestId, provider, modelId],
      );
      await client.query(
        `INSERT INTO control.relay_usage(account_id,period_start,requests) VALUES($1,date_trunc('month',now())::date,1)
      ON CONFLICT(account_id,period_start) DO UPDATE SET requests=control.relay_usage.requests+1,updated_at=now()`,
        [accountId],
      );
      await client.query("COMMIT");
      return { ...current, requests: current.requests + 1 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async finishRelayRequest(
    accountId: string,
    requestId: string,
    status: "completed" | "failed" | "cancelled",
    statusClass: number,
    inputTokens: number,
    outputTokens: number,
    latencyBucket: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE control.relay_request_records SET status=$3,status_class=$4,input_tokens=$5,output_tokens=$6,latency_bucket=$7,updated_at=now() WHERE account_id=$1 AND request_id=$2",
        [
          accountId,
          requestId,
          status,
          statusClass,
          inputTokens,
          outputTokens,
          latencyBucket,
        ],
      );
      await client.query(
        `UPDATE control.relay_usage SET input_tokens=input_tokens+$2,output_tokens=output_tokens+$3,updated_at=now() WHERE account_id=$1 AND period_start=date_trunc('month',now())::date`,
        [accountId, inputTokens, outputTokens],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
