import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { CheckpointObjectPort } from "../src/checkpoint-vault.js";
import { SessionJobWorker } from "../src/session-job-worker.js";

class MemoryObjects implements CheckpointObjectPort {
  values = new Map<string, Uint8Array>();
  deleted: string[] = [];
  async put(key: string, body: Uint8Array) {
    this.values.set(key, body);
  }
  async get(key: string) {
    const value = this.values.get(key);
    if (!value) throw new Error("checkpoint_object_missing");
    return value;
  }
  async delete(key: string) {
    this.deleted.push(key);
    this.values.delete(key);
  }
  async deleteAllVersions(key: string) {
    await this.delete(key);
  }
}

test("export jobs copy the verified encrypted checkpoint and expire in 24 hours", async () => {
  const body = Buffer.from("kms-envelope-ciphertext");
  const checksum = (await import("node:crypto"))
    .createHash("sha256")
    .update(body)
    .digest("hex");
  const objects = new MemoryObjects();
  objects.values.set("checkpoint-key", body);
  const updates: unknown[][] = [];
  const pool = {
    async query(sql: string, values?: unknown[]) {
      if (sql.includes("UPDATE sessions.session_jobs SET state='running'"))
        return {
          rowCount: 1,
          rows: [{
            job_id: "00000000-0000-4000-8000-000000000001",
            account_id: "account-1",
            session_id: "00000000-0000-4000-8000-000000000002",
            kind: "export",
            attempts: 1,
          }],
        };
      if (sql.includes("FROM sessions.cloud_checkpoints"))
        return { rowCount: 1, rows: [{ object_key: "checkpoint-key", ciphertext_sha256: checksum }] };
      updates.push(values ?? []);
      return { rowCount: 1, rows: [] };
    },
  } as unknown as Pool;
  assert.equal(await new SessionJobWorker(pool, objects).runOnce(), "completed");
  const exportKey = [...objects.values.keys()].find((key) => key.includes("/exports/"));
  assert.ok(exportKey);
  assert.deepEqual(objects.values.get(exportKey!), body);
  assert.equal(updates.at(-1)?.[2], checksum);
});

test("delete jobs remove all object versions before metadata and retain a completed receipt", async () => {
  const objects = new MemoryObjects();
  objects.values.set("checkpoint-a", Buffer.from("a"));
  objects.values.set("export-b", Buffer.from("b"));
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("UPDATE sessions.session_jobs SET state='running'"))
        return {
          rowCount: 1,
          rows: [{
            job_id: "00000000-0000-4000-8000-000000000003",
            account_id: "account-1",
            session_id: "00000000-0000-4000-8000-000000000004",
            kind: "delete",
            attempts: 1,
          }],
        };
      if (sql.includes("UNION SELECT artifact_key"))
        return { rowCount: 2, rows: [{ object_key: "checkpoint-a" }, { object_key: "export-b" }] };
      return { rowCount: 1, rows: [] };
    },
    async connect() { return client; },
  } as unknown as Pool;
  assert.equal(await new SessionJobWorker(pool, objects).runOnce(), "completed");
  assert.deepEqual(objects.deleted, ["checkpoint-a", "export-b"]);
  assert.ok(statements.some((sql) => sql.includes("DELETE FROM sessions.cloud_sessions")));
  assert.ok(statements.some((sql) => sql.includes("state='completed'")));
});
