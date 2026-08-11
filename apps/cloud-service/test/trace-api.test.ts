import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Hono } from "hono";
import type {
  CloudTraceV1,
  CreateTraceUploadIntentV1,
} from "@opensidebar/shared-types";
import { createTraceApi } from "../src/trace-api.js";
import type { TraceObjectPort } from "../src/trace-object-store.js";
import type {
  TraceMutationResult,
  TraceRepository,
} from "../src/trace-repository.js";

class MemoryTraces implements TraceRepository {
  values = new Map<string, CloudTraceV1>();
  async migrate() {}
  async health() {}
  async close() {}
  async createIntent(
    accountId: string,
    input: CreateTraceUploadIntentV1,
  ): Promise<TraceMutationResult<CloudTraceV1>> {
    const key = `${accountId}:${input.traceId}`,
      existing = this.values.get(key);
    if (existing) return { kind: "exists", value: existing };
    const value: CloudTraceV1 = {
      ...input,
      schemaVersion: 1,
      state: "upload_pending",
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
    this.values.set(key, value);
    return { kind: "created", value };
  }
  async commit(
    accountId: string,
    traceId: string,
    sha256: string,
  ): Promise<TraceMutationResult<CloudTraceV1>> {
    const key = `${accountId}:${traceId}`,
      current = this.values.get(key);
    if (!current) return { kind: "not_found" };
    const value = {
      ...current,
      state: "available" as const,
      ciphertextSha256: sha256,
      uploadedAt: new Date().toISOString(),
    };
    this.values.set(key, value);
    return { kind: "created", value };
  }
  async list(accountId: string) {
    return [...this.values.entries()]
      .filter(([key]) => key.startsWith(`${accountId}:`))
      .map(([, value]) => value);
  }
  async get(accountId: string, traceId: string) {
    return this.values.get(`${accountId}:${traceId}`) ?? null;
  }
  async usage(accountId: string) {
    const values = await this.list(accountId);
    return {
      schemaVersion: 1 as const,
      usedBytes: values.reduce(
        (sum, value) => sum + value.ciphertextSizeBytes,
        0,
      ),
      quotaBytes: 500 * 1024 * 1024,
      traceCount: values.length,
    };
  }
  async markDeleting(
    accountId: string,
    traceId: string,
  ): Promise<TraceMutationResult<CloudTraceV1>> {
    const key = `${accountId}:${traceId}`;
    const value = await this.get(accountId, traceId);
    if (!value) return { kind: "not_found" };
    const deleting = { ...value, state: "deleting" as const };
    this.values.set(key, deleting);
    return { kind: "created", value: deleting };
  }
  async remove(accountId: string, traceId: string) {
    this.values.delete(`${accountId}:${traceId}`);
  }
  async cleanupExpired() {
    return [];
  }
}

class MemoryObjects implements TraceObjectPort {
  values = new Map<string, Uint8Array>();
  failNextDelete = false;
  key(accountId: string, traceId: string) {
    return `${accountId}/${traceId}`;
  }
  async put(key: string, body: Uint8Array) {
    this.values.set(key, Uint8Array.from(body));
    return this.digest(body);
  }
  async get(key: string) {
    const value = this.values.get(key);
    if (!value) throw new Error("missing");
    return value;
  }
  async sha256(key: string) {
    return this.digest(await this.get(key));
  }
  async delete(key: string) {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("s3_unavailable");
    }
    this.values.delete(key);
  }
  private digest(value: Uint8Array) {
    return createHash("sha256").update(value).digest("hex");
  }
}

const traceId = "123e4567-e89b-42d3-a456-426614174000";
function fixture(flags = { uploads: true, downloads: true }) {
  const repository = new MemoryTraces(),
    objects = new MemoryObjects();
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set(
      "principal" as never,
      {
        accountId: "account-1",
        email: "one@example.com",
        deviceId: "device-1",
        installationId: "install-1",
        cloudAccess: true,
        sessionEpoch: 1,
      } as never,
    );
    await next();
  });
  app.route("/traces", createTraceApi(repository, objects, flags));
  return { app, repository, objects };
}

test("encrypted trace lifecycle stores opaque bytes and account-scoped metadata", async () => {
  const { app, repository, objects } = fixture();
  const ciphertext = new TextEncoder().encode("OS-TRACE-1\nopaque ciphertext");
  const intent = await app.request("/traces/upload-intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      traceId,
      title: "Private run",
      createdAt: "2026-08-11T12:00:00.000Z",
      bundleSchemaVersion: "2026-05-30",
      keyFingerprint: "abcdefghijklmnop",
      entryCount: 4,
      screenshotCount: 1,
      ciphertextSizeBytes: ciphertext.byteLength,
    }),
  });
  assert.equal(intent.status, 201);
  const upload = await app.request(`/traces/${traceId}/content`, {
    method: "PUT",
    body: ciphertext,
  });
  assert.equal(upload.status, 201);
  const digest = ((await upload.json()) as { ciphertextSha256: string })
    .ciphertextSha256;
  assert.equal(
    (
      await app.request(`/traces/${traceId}/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ciphertextSha256: digest }),
      })
    ).status,
    200,
  );
  assert.deepEqual(objects.values.get(`account-1/${traceId}`), ciphertext);
  assert.equal(
    (await repository.get("account-1", traceId))?.state,
    "available",
  );
  assert.equal(await repository.get("account-2", traceId), null);
  const download = await app.request(`/traces/${traceId}/content`);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), ciphertext);
  assert.equal(
    (await app.request(`/traces/${traceId}`, { method: "DELETE" })).status,
    204,
  );
  assert.equal(objects.values.size, 0);
});

test("upload and download kill switches fail closed independently", async () => {
  const { app } = fixture({ uploads: false, downloads: false });
  assert.equal(
    (await app.request("/traces/upload-intents", { method: "POST" })).status,
    503,
  );
  assert.equal((await app.request(`/traces/${traceId}/content`)).status, 503);
});

test("an interrupted object deletion remains safely retryable", async () => {
  const { app, repository, objects } = fixture();
  repository.values.set(`account-1:${traceId}`, {
    schemaVersion: 1,
    traceId,
    title: "Encrypted trace",
    createdAt: "2026-08-11T12:00:00.000Z",
    uploadedAt: "2026-08-11T12:01:00.000Z",
    expiresAt: "2026-09-10T12:00:00.000Z",
    state: "available",
    bundleSchemaVersion: "2026-05-30",
    keyFingerprint: "abcdefghijklmnop",
    entryCount: 1,
    screenshotCount: 0,
    ciphertextSizeBytes: 6,
    ciphertextSha256: "a".repeat(64),
  });
  objects.values.set(
    `account-1/${traceId}`,
    new TextEncoder().encode("opaque"),
  );
  objects.failNextDelete = true;
  assert.equal(
    (await app.request(`/traces/${traceId}`, { method: "DELETE" })).status,
    503,
  );
  assert.equal((await repository.get("account-1", traceId))?.state, "deleting");
  assert.equal(
    (await app.request(`/traces/${traceId}`, { method: "DELETE" })).status,
    204,
  );
  assert.equal(await repository.get("account-1", traceId), null);
  assert.equal(objects.values.size, 0);
});
