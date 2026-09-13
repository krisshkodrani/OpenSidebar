import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { DecryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";
import { CommandVault } from "../src/command-vault.js";
import type { CheckpointObjectPort } from "../src/checkpoint-vault.js";
import type { KmsPort } from "../src/credential-vault.js";

class Objects implements CheckpointObjectPort {
  values = new Map<string, Uint8Array>();
  async put(key: string, body: Uint8Array) {
    if (this.values.has(key)) throw new Error("checkpoint_object_exists");
    this.values.set(key, Uint8Array.from(body));
  }
  async get(key: string) {
    const value = this.values.get(key);
    if (!value) throw new Error("missing");
    return value;
  }
  async delete(key: string) {
    this.values.delete(key);
  }
}
class Kms implements KmsPort {
  values = new Map<string, Uint8Array>();
  async send(command: DecryptCommand | GenerateDataKeyCommand) {
    if (command instanceof GenerateDataKeyCommand) {
      const Plaintext = randomBytes(32),
        CiphertextBlob = randomBytes(32);
      this.values.set(
        Buffer.from(CiphertextBlob).toString("base64"),
        Uint8Array.from(Plaintext),
      );
      return { Plaintext, CiphertextBlob };
    }
    return {
      Plaintext: this.values.get(
        Buffer.from(command.input.CiphertextBlob ?? []).toString("base64"),
      ),
    };
  }
}

test("command payload is encrypted and context-bound", async () => {
  const objects = new Objects();
  const vault = new CommandVault(objects, "session-key", new Kms());
  const identity = {
    accountId: "account-1",
    sessionId: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    leaseGeneration: 1,
  };
  const command = {
    schemaVersion: 1 as const,
    sessionId: identity.sessionId,
    commandId: identity.commandId,
    leaseId: crypto.randomUUID(),
    leaseGeneration: 1,
    checkpointRevision: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    action: { kind: "read_page", arguments: {} },
    preconditions: [{ kind: "origin" as const, value: "https://example.com" }],
    risk: "read" as const,
  };
  await vault.encryptAndPut(identity, command);
  const body = [...objects.values.values()][0]!;
  assert.equal(Buffer.from(body).includes(Buffer.from("read_page")), false);
  assert.deepEqual(await vault.getAndDecrypt(identity), command);
  await assert.rejects(() =>
    vault.getAndDecrypt({ ...identity, leaseGeneration: 2 }),
  );
});
