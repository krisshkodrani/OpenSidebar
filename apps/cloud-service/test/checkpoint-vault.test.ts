import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { DecryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";
import {
  CheckpointVault,
  type CheckpointObjectPort,
} from "../src/checkpoint-vault.js";
import type { KmsPort } from "../src/credential-vault.js";

class MemoryObjects implements CheckpointObjectPort {
  values = new Map<string, Uint8Array>();
  async put(key: string, body: Uint8Array) {
    if (this.values.has(key)) throw new Error("checkpoint_object_exists");
    this.values.set(key, Uint8Array.from(body));
  }
  async get(key: string) {
    const value = this.values.get(key);
    if (!value) throw new Error("missing");
    return Uint8Array.from(value);
  }
  async delete(key: string) {
    this.values.delete(key);
  }
}

class MemoryKms implements KmsPort {
  readonly wrapped = new Map<string, Uint8Array>();
  async send(command: DecryptCommand | GenerateDataKeyCommand) {
    if (command instanceof GenerateDataKeyCommand) {
      const plaintext = randomBytes(32);
      const ciphertext = randomBytes(32);
      this.wrapped.set(
        Buffer.from(ciphertext).toString("base64"),
        Uint8Array.from(plaintext),
      );
      return { Plaintext: plaintext, CiphertextBlob: ciphertext };
    }
    const key = this.wrapped.get(
      Buffer.from(command.input.CiphertextBlob ?? []).toString("base64"),
    );
    return { Plaintext: key ? Uint8Array.from(key) : undefined };
  }
}

const identity = {
  accountId: "account-one",
  sessionId: "1bd0c891-8ddb-468f-8f02-e47a0e430176",
  checkpointId: "f0341e58-3989-41ac-bd85-99aca119dd86",
  revision: 1,
};

test("checkpoint envelope round-trips without storing plaintext", async () => {
  const objects = new MemoryObjects();
  const vault = new CheckpointVault(objects, "session-key", new MemoryKms());
  const plaintext = Buffer.from('{"originalRequest":"private canary"}');
  const stored = await vault.encryptAndPut(identity, plaintext);
  const object = objects.values.get(stored.objectKey)!;

  assert.equal(Buffer.from(object).includes(plaintext), false);
  assert.match(stored.ciphertextSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await vault.getAndDecrypt(identity), plaintext);
});

test("identical checkpoints encrypt differently and tampering fails closed", async () => {
  const objects = new MemoryObjects();
  const vault = new CheckpointVault(objects, "session-key", new MemoryKms());
  const plaintext = Buffer.from("same checkpoint");
  const first = await vault.encryptAndPut(identity, plaintext);
  const firstBody = Uint8Array.from(objects.values.get(first.objectKey)!);
  const secondIdentity = { ...identity, checkpointId: crypto.randomUUID() };
  const second = await vault.encryptAndPut(secondIdentity, plaintext);
  const secondBody = objects.values.get(second.objectKey)!;
  assert.notDeepEqual(secondBody, firstBody);

  const envelope = JSON.parse(Buffer.from(secondBody).toString("utf8")) as {
    ciphertext: string;
  };
  envelope.ciphertext = `${envelope.ciphertext[0] === "A" ? "B" : "A"}${envelope.ciphertext.slice(1)}`;
  objects.values.set(second.objectKey, Buffer.from(JSON.stringify(envelope)));
  await assert.rejects(() => vault.getAndDecrypt(secondIdentity));
});

test("encryption context prevents cross-checkpoint restore", async () => {
  const objects = new MemoryObjects();
  const vault = new CheckpointVault(objects, "session-key", new MemoryKms());
  const stored = await vault.encryptAndPut(identity, Buffer.from("checkpoint"));
  const other = { ...identity, checkpointId: crypto.randomUUID() };
  objects.values.set(
    vault.objectKey(other),
    objects.values.get(stored.objectKey)!,
  );
  await assert.rejects(() => vault.getAndDecrypt(other));
});
