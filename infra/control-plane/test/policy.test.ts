import assert from "node:assert/strict";
import test from "node:test";
import type { CredentialRepository } from "../src/contracts.ts";
import {
  PolicyError,
  parseSafePreferences,
  validateRelayEnvelope,
  verifyAndStoreCredential,
} from "../src/policy.ts";

test("verifies before storing ciphertext and never stores plaintext", async () => {
  let stored: Parameters<CredentialRepository["put"]>[0] | undefined;
  const repository: CredentialRepository = {
    get: async () => null,
    put: async (value) => { stored = value; },
    delete: async () => undefined,
  };
  const result = await verifyAndStoreCredential({
    accountId: "user-1",
    provider: "openrouter",
    credential: " secret-value ",
    cipher: {
      encrypt: async (plaintext, context) => {
        assert.equal(plaintext, "secret-value");
        assert.equal(context.accountId, "user-1");
        return { ciphertext: "ciphertext", encryptedDataKey: "encrypted-dek" };
      },
      decrypt: async () => "secret-value",
    },
    repository,
    verifier: { verify: async () => undefined },
    now: new Date("2026-08-07T12:00:00.000Z"),
  });
  assert.equal(stored?.ciphertext, "ciphertext");
  assert.equal(JSON.stringify(stored).includes("secret-value"), false);
  assert.equal(result.verifiedAt, "2026-08-07T12:00:00.000Z");
});

test("does not replace a credential when verification fails", async () => {
  let writes = 0;
  await assert.rejects(
    verifyAndStoreCredential({
      accountId: "user-1",
      provider: "fireworks",
      credential: "bad",
      cipher: { encrypt: async () => assert.fail(), decrypt: async () => assert.fail() },
      repository: {
        get: async () => null,
        put: async () => { writes += 1; },
        delete: async () => undefined,
      },
      verifier: { verify: async () => { throw new Error("upstream detail"); } },
    }),
    (error: unknown) => error instanceof PolicyError && error.code === "verification_failed",
  );
  assert.equal(writes, 0);
});

test("cloud preferences reject device-local safety controls", () => {
  assert.throws(
    () => parseSafePreferences({
      schemaVersion: 1,
      revision: 0,
      providerMode: "openrouter",
      theme: "system",
      showSessionMetrics: true,
      requireApprovals: false,
    }),
    /device-local/,
  );
});

test("relay contract cannot select an upstream URL, header, or credential", () => {
  const valid = {
    schemaVersion: 1,
    requestId: "request-1",
    provider: "openrouter",
    model: "openai/gpt-oss-120b",
    messages: [],
  };
  validateRelayEnvelope(valid, 100);
  for (const field of ["url", "headers", "apiKey", "credential"]) {
    assert.throws(() => validateRelayEnvelope({ ...valid, [field]: "attacker" }, 100));
  }
});
