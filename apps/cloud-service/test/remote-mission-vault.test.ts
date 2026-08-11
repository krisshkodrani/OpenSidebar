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
      return { Plaintext: dataKey };
    },
  };
  const vault = new RemoteMissionVault(store, "key", kms as never);
  const payload = {
    schemaVersion: 1 as const,
    missionId: identity.missionId,
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
