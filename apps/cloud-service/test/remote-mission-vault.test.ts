import assert from "node:assert/strict";
import test from "node:test";
import { RemoteMissionVault } from "../src/remote-mission-vault.js";

const identity = {
  accountId: "account-1",
  deviceId: "123e4567-e89b-42d3-a456-426614174000",
  missionId: "123e4567-e89b-42d3-a456-426614174001",
};

test("encrypts mission content at rest and binds it to device identity", async () => {
  const objects = new Map<string, Uint8Array>();
  const store = {
    async put(key: string, body: Uint8Array) {
      objects.set(key, body);
    },
    async get(key: string) {
      const body = objects.get(key);
      if (!body) throw new Error("missing");
      return body;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  const dataKey = Buffer.alloc(32, 7);
  const kms = {
    async send(command: { input?: { EncryptionContext?: Record<string, string> } }) {
      if (command.constructor.name === "GenerateDataKeyCommand")
        return { Plaintext: dataKey, CiphertextBlob: Buffer.from("wrapped") };
      assert.equal(
        command.input?.EncryptionContext?.deviceId,
        identity.deviceId,
      );
      assert.equal(
        command.input?.EncryptionContext?.purpose,
        "opensidebar-remote-mission-v1",
      );
      return { Plaintext: dataKey };
    },
  };
  const vault = new RemoteMissionVault(store, "key", kms as never);
  const payload = {
    schemaVersion: 1 as const,
    missionId: identity.missionId,
    executionClass: "read_only" as const,
    instruction: "Summarize the signed-in dashboard",
  };
  await vault.encryptAndPut(identity, payload);
  const raw = Buffer.from(objects.values().next().value!).toString("utf8");
  assert.equal(raw.includes(payload.instruction), false);
  assert.deepEqual(await vault.getAndDecrypt(identity), payload);
  await assert.rejects(() =>
    vault.getAndDecrypt({ ...identity, deviceId: crypto.randomUUID() }),
  );
});

test("deletion removes all object versions when the object port supports it", async () => {
  const deleted: string[] = [];
  const vault = new RemoteMissionVault(
    {
      async put() {},
      async get() { return new Uint8Array(); },
      async delete() { throw new Error("single-version deletion must not be used"); },
      async deleteAllVersions(key: string) { deleted.push(key); },
    },
    "key",
    { async send() { throw new Error("unused"); } } as never,
  );
  await vault.delete(identity);
  assert.deepEqual(deleted, [
    vault.objectKey(identity),
    vault.progressObjectKey(identity),
    vault.progressObjectKey(identity, "accepted"),
    vault.progressObjectKey(identity, "running"),
    vault.progressObjectKey(identity, "target_selection_required"),
    vault.progressObjectKey(identity, "supervision_required"),
    vault.progressObjectKey(identity, "approval_required"),
    vault.resultObjectKey(identity),
    vault.approvalDecisionObjectKey(identity),
    vault.targetDecisionObjectKey(identity),
    vault.supervisorDecisionObjectKey(identity),
    vault.resultObjectKey(identity, "completed"),
    vault.resultObjectKey(identity, "not_achieved"),
    vault.resultObjectKey(identity, "cancelled"),
    vault.resultObjectKey(identity, "unknown"),
  ]);
});

test("stores an approval decision separately and encrypted", async () => {
  const objects = new Map<string, Uint8Array>();
  const dataKey = Buffer.alloc(32, 5);
  const vault = new RemoteMissionVault(
    {
      async put(key, body) { objects.set(key, body); },
      async get(key) {
        const body = objects.get(key);
        if (!body) throw new Error("missing");
        return body;
      },
      async delete(key) { objects.delete(key); },
    },
    "key",
    {
      async send(command: { constructor: { name: string } }) {
        return command.constructor.name === "GenerateDataKeyCommand"
          ? { Plaintext: dataKey, CiphertextBlob: Buffer.from("wrapped") }
          : { Plaintext: dataKey };
      },
    } as never,
  );
  const decision = {
    schemaVersion: 1 as const,
    missionId: identity.missionId,
    approvalId: "approval-1",
    actionDigest: "digest-1",
    approved: true,
    decidedAt: "2026-08-13T08:00:00.000Z",
  };
  await vault.encryptApprovalDecisionAndPut(identity, decision);
  const raw = Buffer.from(
    objects.get(vault.approvalDecisionObjectKey(identity))!,
  ).toString("utf8");
  assert.equal(raw.includes(decision.approvalId), false);
  assert.deepEqual(await vault.getApprovalDecisionAndDecrypt(identity), decision);
});

test("stores terminal result separately and encrypted", async () => {
  const objects = new Map<string, Uint8Array>();
  const dataKey = Buffer.alloc(32, 9);
  const vault = new RemoteMissionVault(
    {
      async put(key, body) { objects.set(key, body); },
      async get(key) {
        const body = objects.get(key);
        if (!body) throw new Error("missing");
        return body;
      },
      async delete(key) { objects.delete(key); },
    },
    "key",
    {
      async send(command: {
        constructor: { name: string };
        input?: { EncryptionContext?: Record<string, string> };
      }) {
        assert.equal(
          command.input?.EncryptionContext?.purpose,
          "opensidebar-remote-mission-result-v1",
        );
        return command.constructor.name === "GenerateDataKeyCommand"
          ? { Plaintext: dataKey, CiphertextBlob: Buffer.from("wrapped") }
          : { Plaintext: dataKey };
      },
    } as never,
  );
  const result = {
    schemaVersion: 1 as const,
    missionId: identity.missionId,
    outcome: "not_achieved" as const,
    createdAt: "2026-08-12T20:00:00.000Z",
    diagnostic: "Planner could not create a read-only step.",
  };
  await vault.encryptResultAndPut(identity, result);
  const raw = Buffer.from(
    objects.get(vault.resultObjectKey(identity, "not_achieved"))!,
  ).toString("utf8");
  assert.equal(raw.includes(result.diagnostic), false);
  assert.deepEqual(
    await vault.getResultAndDecrypt(identity, "not_achieved"),
    result,
  );
});

test("outcome-addressed result objects cannot overwrite each other", async () => {
  const objects = new Map<string, Uint8Array>();
  const dataKey = Buffer.alloc(32, 3);
  const vault = new RemoteMissionVault(
    {
      async put(key, body) { objects.set(key, body); },
      async get(key) {
        const body = objects.get(key);
        if (!body) throw new Error("missing");
        return body;
      },
      async delete(key) { objects.delete(key); },
    },
    "key",
    {
      async send(command: { constructor: { name: string } }) {
        return command.constructor.name === "GenerateDataKeyCommand"
          ? { Plaintext: dataKey, CiphertextBlob: Buffer.from("wrapped") }
          : { Plaintext: dataKey };
      },
    } as never,
  );
  const base = {
    schemaVersion: 1 as const,
    missionId: identity.missionId,
    createdAt: "2026-08-13T08:00:00.000Z",
  };
  await vault.encryptResultAndPut(identity, { ...base, outcome: "cancelled" });
  await vault.encryptResultAndPut(identity, { ...base, outcome: "completed" });
  assert.deepEqual(
    (await vault.getResultAndDecrypt(identity, "cancelled")).outcome,
    "cancelled",
  );
  assert.deepEqual(
    (await vault.getResultAndDecrypt(identity, "completed")).outcome,
    "completed",
  );
});

test("replaces current supervision evidence without a delete gap", async () => {
  const objects = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const replaced: string[] = [];
  const dataKey = Buffer.alloc(32, 4);
  const vault = new RemoteMissionVault(
    {
      async put(key, body) { objects.set(key, body); },
      async replace(key, body) { replaced.push(key); objects.set(key, body); },
      async get(key) {
        const body = objects.get(key);
        if (!body) throw new Error("missing");
        return body;
      },
      async delete(key) { deleted.push(key); objects.delete(key); },
    },
    "key",
    {
      async send(command: { constructor: { name: string } }) {
        return command.constructor.name === "GenerateDataKeyCommand"
          ? { Plaintext: dataKey, CiphertextBlob: Buffer.from("wrapped") }
          : { Plaintext: dataKey };
      },
    } as never,
  );
  const progress = (attemptId: string) => ({
    schemaVersion: 1 as const,
    missionId: identity.missionId,
    state: "supervision_required" as const,
    updatedAt: new Date().toISOString(),
    evidence: {
      schemaVersion: 1 as const,
      missionId: identity.missionId,
      stepId: "step-1",
      attemptId,
      planRevision: 1,
      outcome: "achieved" as const,
      claims: [],
      effects: [],
      uncertainties: [],
    },
    pendingStep: {
      schemaVersion: 1 as const,
      missionId: identity.missionId,
      stepId: "step-1",
      planRevision: 1,
      risk: "read_only" as const,
      objective: "Read the page",
      successCriteria: ["Return the heading"],
    },
  });
  await vault.replaceSupervisionProgressAndPut(identity, progress("attempt-1"));
  await vault.replaceSupervisionProgressAndPut(identity, progress("attempt-2"));
  assert.deepEqual(replaced, [
    vault.progressObjectKey(identity, "supervision_required"),
    vault.progressObjectKey(identity, "supervision_required"),
  ]);
  assert.equal(deleted.includes(vault.progressObjectKey(identity, "supervision_required")), false);
  assert.equal(
    (await vault.getProgressAndDecrypt(identity, "supervision_required")).evidence?.attemptId,
    "attempt-2",
  );
});
