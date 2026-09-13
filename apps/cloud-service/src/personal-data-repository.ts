import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import type {
  PersonalDataCategory,
  PersonalDataDocumentMetadataV1,
  PersonalDataKeyRequestV1,
  PersonalDataWrappedKeyV1,
} from "@opensidebar/shared-types";

type DocumentWrite = Omit<PersonalDataDocumentMetadataV1, "schemaVersion" | "updatedAt"> & { objectKey: string };

export class PersonalDataRepository {
  constructor(readonly pool: Pool) {}
  async migrate() {
    const here = dirname(fileURLToPath(import.meta.url));
    await this.pool.query(await readFile(resolve(here, "../migrations/019_personal_data_sync.sql"), "utf8"));
  }
  async cleanupExpired() {
    await this.pool.query("DELETE FROM control.personal_data_key_requests WHERE expires_at<=now() AND state='pending'");
  }
  async keyEpoch(accountId: string) {
    const result = await this.pool.query<{ key_epoch: string }>(
      "SELECT key_epoch FROM control.personal_data_accounts WHERE account_id=$1",
      [accountId],
    );
    return Number(result.rows[0]?.key_epoch ?? 0);
  }
  async approvedDevice(accountId: string, deviceId: string) {
    const result = await this.pool.query(
      "SELECT 1 FROM control.personal_data_device_keys WHERE account_id=$1 AND device_id=$2 AND approved_at IS NOT NULL",
      [accountId, deviceId],
    );
    return Boolean(result.rowCount);
  }
  async approvedDevices(accountId: string, currentDeviceId: string) {
    const result = await this.pool.query<{
      device_id: string; display_name: string; public_key_jwk: JsonWebKey;
      key_epoch: string; approved_at: Date;
    }>(
      `SELECT k.device_id,d.display_name,k.public_key_jwk,k.key_epoch,k.approved_at
       FROM control.personal_data_device_keys k JOIN control.devices d ON d.id=k.device_id
       WHERE k.account_id=$1 AND k.approved_at IS NOT NULL AND d.revoked_at IS NULL
       ORDER BY k.approved_at`, [accountId],
    );
    return result.rows.map((row) => ({ deviceId: row.device_id, displayName: row.display_name,
      publicKeyJwk: row.public_key_jwk, keyEpoch: Number(row.key_epoch),
      approvedAt: row.approved_at.toISOString(), current: row.device_id === currentDeviceId }));
  }
  async registerDeviceKey(accountId: string, deviceId: string, publicKeyJwk: JsonWebKey) {
    return this.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");
        const account = await client.query<{ key_epoch: string }>(
          `INSERT INTO control.personal_data_accounts(account_id,key_epoch) VALUES($1,1)
           ON CONFLICT(account_id) DO UPDATE SET updated_at=now()
           RETURNING key_epoch`, [accountId]);
        const keyEpoch = Number(account.rows[0]!.key_epoch);
        const approvedCount = await client.query<{ count: string }>(
          "SELECT count(*) FROM control.personal_data_device_keys WHERE account_id=$1 AND approved_at IS NOT NULL", [accountId]);
        const bootstrap = Number(approvedCount.rows[0]!.count) === 0;
        await client.query(
          `INSERT INTO control.personal_data_device_keys(account_id,device_id,public_key_jwk,key_epoch,approved_at)
           VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(account_id,device_id) DO UPDATE SET public_key_jwk=excluded.public_key_jwk,key_epoch=excluded.key_epoch,updated_at=now()`,
          [accountId, deviceId, publicKeyJwk, keyEpoch, bootstrap ? new Date() : null],
        );
        await client.query("COMMIT");
        return { keyEpoch, approved: bootstrap || await this.approvedDevice(accountId, deviceId) };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    });
  }
  async createKeyRequest(input: { id: string; accountId: string; deviceId: string; publicKeyJwk: JsonWebKey; expiresAt: Date }) {
    await this.pool.query(
      `INSERT INTO control.personal_data_key_requests(id,account_id,requesting_device_id,public_key_jwk,state,expires_at)
       VALUES($1,$2,$3,$4,'pending',$5)`,
      [input.id, input.accountId, input.deviceId, input.publicKeyJwk, input.expiresAt],
    );
  }
  async requests(accountId: string, deviceId: string, canApprove: boolean): Promise<PersonalDataKeyRequestV1[]> {
    const result = await this.pool.query<{
      id: string; requesting_device_id: string; display_name: string; public_key_jwk: JsonWebKey;
      state: "pending" | "approved" | "denied"; wrapped_key: PersonalDataWrappedKeyV1 | null;
      created_at: Date; expires_at: Date;
    }>(
      `SELECT r.id,r.requesting_device_id,d.display_name,r.public_key_jwk,r.state,r.wrapped_key,r.created_at,r.expires_at
       FROM control.personal_data_key_requests r JOIN control.devices d ON d.id=r.requesting_device_id
       WHERE r.account_id=$1 AND ($3 OR r.requesting_device_id=$2) ORDER BY r.created_at DESC LIMIT 50`,
      [accountId, deviceId, canApprove],
    );
    return result.rows.map((row) => ({
      schemaVersion: 1,
      id: row.id,
      requestingDeviceId: row.requesting_device_id,
      requestingDeviceName: row.display_name,
      verificationCode: "",
      publicKeyJwk: row.public_key_jwk,
      state: row.expires_at.getTime() <= Date.now() && row.state === "pending" ? "expired" : row.state,
      createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(),
      ...(row.wrapped_key ? { wrappedKey: row.wrapped_key } : {}),
    }));
  }
  async decideRequest(accountId: string, id: string, state: "approved" | "denied", wrappedKey?: PersonalDataWrappedKeyV1) {
    const result = await this.pool.query<{ requesting_device_id: string }>(
      `UPDATE control.personal_data_key_requests SET state=$3,wrapped_key=$4,decided_at=now()
       WHERE account_id=$1 AND id=$2 AND state='pending' AND expires_at>now() RETURNING requesting_device_id`,
      [accountId, id, state, wrappedKey ?? null],
    );
    const deviceId = result.rows[0]?.requesting_device_id;
    if (!deviceId) return false;
    if (state === "approved") await this.pool.query(
      `UPDATE control.personal_data_device_keys SET approved_at=now(),key_epoch=$3,updated_at=now()
       WHERE account_id=$1 AND device_id=$2`, [accountId, deviceId, wrappedKey!.keyEpoch]);
    return true;
  }
  async documents(accountId: string) {
    const result = await this.pool.query<{
      category: PersonalDataCategory; revision: string; key_epoch: string; object_key: string;
      ciphertext_size_bytes: string; ciphertext_sha256: string; updated_by_device_id: string; updated_at: Date;
    }>("SELECT * FROM control.personal_data_documents WHERE account_id=$1", [accountId]);
    return result.rows.map((row) => ({
      metadata: { schemaVersion: 1 as const, category: row.category, revision: Number(row.revision),
        keyEpoch: Number(row.key_epoch), ciphertextSizeBytes: Number(row.ciphertext_size_bytes),
        ciphertextSha256: row.ciphertext_sha256, updatedByDeviceId: row.updated_by_device_id,
        updatedAt: row.updated_at.toISOString() }, objectKey: row.object_key,
    }));
  }
  async document(accountId: string, category: PersonalDataCategory) {
    return (await this.documents(accountId)).find((item) => item.metadata.category === category) ?? null;
  }
  async putDocument(accountId: string, expectedRevision: number, value: DocumentWrite) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ revision: string; object_key: string }>(
        "SELECT revision,object_key FROM control.personal_data_documents WHERE account_id=$1 AND category=$2 FOR UPDATE",
        [accountId, value.category],
      );
      if (Number(current.rows[0]?.revision ?? 0) !== expectedRevision) {
        await client.query("ROLLBACK");
        return { saved: false };
      }
      await client.query(
        `INSERT INTO control.personal_data_documents(account_id,category,revision,key_epoch,object_key,ciphertext_size_bytes,ciphertext_sha256,updated_by_device_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(account_id,category) DO UPDATE SET revision=excluded.revision,key_epoch=excluded.key_epoch,
         object_key=excluded.object_key,ciphertext_size_bytes=excluded.ciphertext_size_bytes,
         ciphertext_sha256=excluded.ciphertext_sha256,updated_by_device_id=excluded.updated_by_device_id,updated_at=now()`,
        [accountId, value.category, value.revision, value.keyEpoch, value.objectKey,
          value.ciphertextSizeBytes, value.ciphertextSha256, value.updatedByDeviceId],
      );
      const supersededKey = current.rows[0]?.object_key;
      if (supersededKey && supersededKey !== value.objectKey)
        await client.query(
          "INSERT INTO control.personal_data_object_deletions(account_id,object_key) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [accountId, supersededKey],
        );
      await client.query("COMMIT");
      return { saved: true, supersededKey };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }
  async deleteDocument(accountId: string, category: PersonalDataCategory, expectedObjectKey?: string) {
    const result = await this.pool.query<{ object_key: string }>(
      `DELETE FROM control.personal_data_documents WHERE account_id=$1 AND category=$2
       AND ($3::text IS NULL OR object_key=$3) RETURNING object_key`,
      [accountId, category, expectedObjectKey ?? null],
    );
    return result.rows[0]?.object_key ?? null;
  }
  async pendingObjectDeletions() {
    const result = await this.pool.query<{ account_id: string; object_key: string }>(
      "SELECT account_id,object_key FROM control.personal_data_object_deletions ORDER BY created_at LIMIT 100",
    );
    return result.rows.map((row) => ({ accountId: row.account_id, objectKey: row.object_key }));
  }
  async completeObjectDeletion(accountId: string, objectKey: string) {
    await this.pool.query(
      "DELETE FROM control.personal_data_object_deletions WHERE account_id=$1 AND object_key=$2",
      [accountId, objectKey],
    );
  }
  async noteObjectDeletionFailure(accountId: string, objectKey: string) {
    await this.pool.query(
      "UPDATE control.personal_data_object_deletions SET attempts=attempts+1 WHERE account_id=$1 AND object_key=$2",
      [accountId, objectKey],
    );
  }
  async reset(accountId: string, deviceId: string) {
    return this.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");
        const epoch = await client.query<{ key_epoch: string }>(
          "UPDATE control.personal_data_accounts SET key_epoch=key_epoch+1,updated_at=now() WHERE account_id=$1 RETURNING key_epoch", [accountId]);
        await client.query("DELETE FROM control.personal_data_key_requests WHERE account_id=$1", [accountId]);
        await client.query("DELETE FROM control.personal_data_device_keys WHERE account_id=$1 AND device_id<>$2", [accountId, deviceId]);
        await client.query("UPDATE control.personal_data_device_keys SET approved_at=now(),key_epoch=$3 WHERE account_id=$1 AND device_id=$2", [accountId, deviceId, Number(epoch.rows[0]!.key_epoch)]);
        await client.query("COMMIT");
        return Number(epoch.rows[0]!.key_epoch);
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    });
  }
}
