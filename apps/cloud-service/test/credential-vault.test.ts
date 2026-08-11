import assert from "node:assert/strict";
import { test } from "node:test";
import { DecryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";
import { CredentialVault, type KmsPort } from "../src/credential-vault.js";
import { MemoryControlRepository } from "./memory-control-repository.js";

test("credential vault verifies then envelope-encrypts with account/provider context", async () => {
  const repository = new MemoryControlRepository();
  const key = crypto.getRandomValues(new Uint8Array(32));
  const contexts = new Map<string, string>();
  const kms: KmsPort = {
    async send(command) {
      if (command instanceof GenerateDataKeyCommand) {
        const blob = `blob-${contexts.size + 1}`;
        contexts.set(blob, JSON.stringify(command.input.EncryptionContext));
        return {
          Plaintext: key,
          CiphertextBlob: new TextEncoder().encode(blob),
        };
      }
      if (command instanceof DecryptCommand) {
        const blob = new TextDecoder().decode(command.input.CiphertextBlob);
        if (
          contexts.get(blob) !== JSON.stringify(command.input.EncryptionContext)
        )
          throw new Error("context_mismatch");
        return { Plaintext: key };
      }
      throw new Error("unexpected_command");
    },
  };
  const originalFetch = globalThis.fetch;
  const verificationUrls: string[] = [];
  globalThis.fetch = async (input) => {
    verificationUrls.push(String(input));
    return new Response("{}", { status: 200 });
  };
  try {
    const vault = new CredentialVault(repository, "test-key", kms);
    const status = await vault.put(
      "account-1",
      "openrouter",
      "sk-secret-value",
    );
    assert.equal(status.configured, true);
    const stored = await repository.credential("account-1", "openrouter");
    assert.ok(stored);
    assert.equal(stored.ciphertext.includes("sk-secret-value"), false);
    assert.equal(
      await vault.decrypt("account-1", "openrouter"),
      "sk-secret-value",
    );
    await vault.put("account-1", "openrouter", "sk-replacement-value");
    assert.equal(
      await vault.decrypt("account-1", "openrouter"),
      "sk-replacement-value",
    );
    await vault.put("account-1", "fireworks", "fw-secret-value");
    assert.equal(
      await vault.decrypt("account-1", "fireworks"),
      "fw-secret-value",
    );
    assert.ok(verificationUrls.includes("https://openrouter.ai/api/v1/key"));
    assert.ok(
      verificationUrls.includes("https://api.fireworks.ai/inference/v1/models"),
    );
    await repository.putCredential({ ...stored, accountId: "account-2" });
    await assert.rejects(
      vault.decrypt("account-2", "openrouter"),
      /context_mismatch/,
    );
    await repository.deleteCredential("account-1", "openrouter");
    await assert.rejects(
      vault.decrypt("account-1", "openrouter"),
      /credential_missing/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
