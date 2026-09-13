import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  DecryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
} from "@aws-sdk/client-kms";
import type {
  CloudProviderId,
  CredentialStatusV1,
} from "@opensidebar/shared-types";
import { credentialValue, ControlPolicyError } from "./control-policy.js";
import type {
  ControlRepository,
  EncryptedCredentialRecord,
} from "./control-repository.js";

export type KmsPort = {
  send(
    command: DecryptCommand | GenerateDataKeyCommand,
  ): Promise<{ Plaintext?: Uint8Array; CiphertextBlob?: Uint8Array }>;
};
const context = (accountId: string, provider: CloudProviderId) => ({
  accountId,
  provider,
  purpose: "opensidebar-provider-credential",
  version: "1",
});
const aad = (value: Record<string, string>) =>
  Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(value).sort())));

export class CredentialVault {
  private readonly kms: KmsPort;
  constructor(
    private readonly repository: ControlRepository,
    private readonly keyId: string,
    kms?: KmsPort,
  ) {
    this.kms = kms ?? new KMSClient({});
  }
  async verify(provider: CloudProviderId, credential: string) {
    const url =
      provider === "openrouter"
        ? "https://openrouter.ai/api/v1/key"
        : "https://api.fireworks.ai/inference/v1/models";
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${credential}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!response?.ok) throw new ControlPolicyError("verification_failed");
    await response.body?.cancel();
  }
  async put(
    accountId: string,
    provider: CloudProviderId,
    input: unknown,
  ): Promise<CredentialStatusV1> {
    const plaintext = credentialValue(input);
    await this.verify(provider, plaintext);
    const encryptionContext = context(accountId, provider);
    const generated = await this.kms.send(
      new GenerateDataKeyCommand({
        KeyId: this.keyId,
        KeySpec: "AES_256",
        EncryptionContext: encryptionContext,
      }),
    );
    if (!generated.Plaintext || !generated.CiphertextBlob)
      throw new Error("kms_data_key_unavailable");
    const key = Buffer.from(generated.Plaintext);
    try {
      const nonce = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad(encryptionContext));
      const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      const ciphertext = Buffer.concat([
        nonce,
        cipher.getAuthTag(),
        encrypted,
      ]).toString("base64");
      const now = new Date().toISOString();
      const record: EncryptedCredentialRecord = {
        accountId,
        provider,
        ciphertext,
        encryptedDataKey: Buffer.from(generated.CiphertextBlob).toString(
          "base64",
        ),
        fingerprint: createHash("sha256")
          .update(plaintext)
          .digest("hex")
          .slice(-8),
        verification: "valid",
        lastVerifiedAt: now,
        updatedAt: now,
      };
      await this.repository.putCredential(record);
      return {
        schemaVersion: 1,
        provider,
        configured: true,
        fingerprint: record.fingerprint,
        lastVerifiedAt: now,
        verification: "valid",
      };
    } finally {
      key.fill(0);
      Buffer.from(generated.Plaintext).fill(0);
    }
  }
  async decrypt(accountId: string, provider: CloudProviderId): Promise<string> {
    const record = await this.repository.credential(accountId, provider);
    if (!record) throw new ControlPolicyError("credential_missing");
    const encryptionContext = context(accountId, provider);
    const result = await this.kms.send(
      new DecryptCommand({
        KeyId: this.keyId,
        CiphertextBlob: Buffer.from(record.encryptedDataKey, "base64"),
        EncryptionContext: encryptionContext,
      }),
    );
    if (!result.Plaintext) throw new Error("kms_decrypt_unavailable");
    const key = Buffer.from(result.Plaintext);
    try {
      const payload = Buffer.from(record.ciphertext, "base64");
      if (payload.length < 29) throw new Error("credential_ciphertext_invalid");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        payload.subarray(0, 12),
      );
      decipher.setAAD(aad(encryptionContext));
      decipher.setAuthTag(payload.subarray(12, 28));
      return Buffer.concat([
        decipher.update(payload.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
    } finally {
      key.fill(0);
      Buffer.from(result.Plaintext).fill(0);
    }
  }
}
