import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { PersonalDataCategory, PersonalDataDocumentMetadataV1 } from "@opensidebar/shared-types";
import { createPersonalDataApi } from "../src/personal-data-api.js";
import type { PersonalDataObjectPort } from "../src/personal-data-object-store.js";
import type { PersonalDataRepository } from "../src/personal-data-repository.js";

const principal = { accountId: "account-a", email: "a@example.com", sessionEpoch: 0,
  cloudAccess: true, deviceId: "device-a", installationId: "installation-a" };
class MemoryObjects implements PersonalDataObjectPort {
  values = new Map<string, Uint8Array>();
  key(accountId: string, category: PersonalDataCategory, revision: number) { return `${accountId}/${category}/${revision}`; }
  async put(key: string, body: Uint8Array) { this.values.set(key, body); return "a".repeat(64); }
  async get(key: string) { const value = this.values.get(key); if (!value) throw new Error("missing"); return value; }
  async delete(key: string) { this.values.delete(key); }
}
class MemoryRepository {
  epoch = 1;
  approved = false;
  docs = new Map<PersonalDataCategory, { metadata: PersonalDataDocumentMetadataV1; objectKey: string }>();
  async documents() { return [...this.docs.values()]; }
  async document(_accountId: string, category: PersonalDataCategory) { return this.docs.get(category) ?? null; }
  async keyEpoch() { return this.epoch; }
  async approvedDevice() { return this.approved; }
  async approvedDevices() { return this.approved ? [{ deviceId: "device-a", displayName: "This browser",
    publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" }, keyEpoch: this.epoch,
    approvedAt: new Date().toISOString(), current: true }] : []; }
  async registerDeviceKey() { this.approved = true; return { approved: true, keyEpoch: this.epoch }; }
  async requests() { return []; }
  async createKeyRequest() {}
  async decideRequest() { return true; }
  async putDocument(_accountId: string, expected: number, value: any) {
    const current = this.docs.get(value.category);
    if ((current?.metadata.revision ?? 0) !== expected) return { saved: false };
    this.docs.set(value.category, { objectKey: value.objectKey, metadata: { schemaVersion: 1,
      category: value.category, revision: value.revision, keyEpoch: value.keyEpoch,
      ciphertextSizeBytes: value.ciphertextSizeBytes, ciphertextSha256: value.ciphertextSha256,
      updatedByDeviceId: value.updatedByDeviceId, updatedAt: new Date().toISOString() } });
    return { saved: true, supersededKey: current?.objectKey };
  }
  async deleteDocument(_accountId: string, category: PersonalDataCategory) {
    const key = this.docs.get(category)?.objectKey ?? null; this.docs.delete(category); return key;
  }
  async reset() { return ++this.epoch; }
  async completeObjectDeletion() {}
  async noteObjectDeletionFailure() {}
}
function app(flags = { readsEnabled: true, writesEnabled: true, profileEnabled: false }) {
  const repository = new MemoryRepository();
  const objects = new MemoryObjects();
  const root = new Hono<any>();
  root.use("*", async (c, next) => { c.set("principal", principal); await next(); });
  root.route("/personal-data", createPersonalDataApi({ repository: repository as unknown as PersonalDataRepository,
    objects, ...flags, testerSubjects: new Set([principal.accountId]) }));
  return { root, repository, objects };
}

test("personal-data capability is default-deniable and Profile stays separately gated", async () => {
  const disabled = app({ readsEnabled: false, writesEnabled: false, profileEnabled: false });
  const status = await disabled.root.request("/personal-data/status");
  assert.equal(status.status, 200);
  assert.equal((await status.json()).capabilities.writes, false);
  assert.equal((await disabled.root.request("/personal-data/device-key", { method: "PUT", body: "{}" })).status, 503);

  const enabled = app();
  await enabled.root.request("/personal-data/device-key", { method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" } }) });
  assert.equal((await enabled.root.request("/personal-data/documents/profile")).status, 404);
});

test("encrypted document writes are revisioned and retain no plaintext metadata", async () => {
  const { root, repository, objects } = app();
  await root.request("/personal-data/device-key", { method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" } }) });
  const envelope = { schemaVersion: 1, algorithm: "AES-256-GCM", category: "saved_prompts",
    revision: 1, keyEpoch: 1, nonce: "opaque-nonce", ciphertext: "opaque-ciphertext" };
  const written = await root.request("/personal-data/documents/saved_prompts", { method: "PUT",
    headers: { "content-type": "application/json", "if-match": "0" }, body: JSON.stringify(envelope) });
  assert.equal(written.status, 200);
  assert.equal(repository.docs.get("saved_prompts")?.metadata.revision, 1);
  assert.equal(JSON.stringify([...repository.docs.values()]).includes("private sentinel"), false);
  assert.equal(new TextDecoder().decode([...objects.values.values()][0]), JSON.stringify(envelope));
  assert.equal((await root.request("/personal-data/documents/saved_prompts", { method: "PUT",
    headers: { "content-type": "application/json", "if-match": "0" }, body: JSON.stringify(envelope) })).status, 409);
});
