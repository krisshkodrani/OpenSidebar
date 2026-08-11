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
import type { BrowserCommandV1 } from "@opensidebar/shared-types";
import type { CheckpointObjectPort } from "./checkpoint-vault.js";
import type { KmsPort } from "./credential-vault.js";

const ALGORITHM = "aes-256-gcm-envelope-v1";
const MAX_COMMAND_BYTES = 64 * 1024;

export type CommandIdentity = {
  accountId: string;
  sessionId: string;
  commandId: string;
  leaseGeneration: number;
};

type CommandEnvelopeV1 = {
  version: 1;
  algorithm: typeof ALGORITHM;
  encryptedDataKey: string;
  nonce: string;
  authenticationTag: string;
  ciphertext: string;
};

const context = (identity: CommandIdentity) => ({
  purpose: "opensidebar-device-command-v1",
  accountId: identity.accountId,
  sessionId: identity.sessionId,
  commandId: identity.commandId,
  leaseGeneration: String(identity.leaseGeneration),
});
const aad = (value: Record<string, string>) =>
  Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(value).sort())));

export class CommandVault {
  private readonly kms: KmsPort;
  constructor(
    private readonly objects: CheckpointObjectPort,
    private readonly keyId: string,
    kms?: KmsPort,
  ) {
    this.kms = kms ?? new KMSClient({});
  }

  objectKey(identity: CommandIdentity) {
    return `v1/accounts/${identity.accountId}/sessions/${identity.sessionId}/commands/${identity.commandId}`;
  }

  async encryptAndPut(identity: CommandIdentity, command: BrowserCommandV1) {
    const plaintext = Buffer.from(JSON.stringify(command));
    if (plaintext.byteLength < 1 || plaintext.byteLength > MAX_COMMAND_BYTES)
      throw new Error("command_size_invalid");
    const encryptionContext = context(identity);
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
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad(encryptionContext));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      const envelope: CommandEnvelopeV1 = {
        version: 1,
        algorithm: ALGORITHM,
        encryptedDataKey: Buffer.from(generated.CiphertextBlob).toString(
          "base64",
        ),
        nonce: nonce.toString("base64"),
        authenticationTag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      };
      const body = Buffer.from(JSON.stringify(envelope));
      await this.objects.put(this.objectKey(identity), body);
      return {
        ciphertextSizeBytes: body.byteLength,
        ciphertextSha256: createHash("sha256").update(body).digest("hex"),
      };
    } finally {
      key.fill(0);
      Buffer.from(generated.Plaintext).fill(0);
    }
  }

  async getAndDecrypt(identity: CommandIdentity): Promise<BrowserCommandV1> {
    const body = await this.objects.get(this.objectKey(identity));
    let envelope: CommandEnvelopeV1;
    try {
      envelope = JSON.parse(
        Buffer.from(body).toString("utf8"),
      ) as CommandEnvelopeV1;
    } catch {
      throw new Error("command_envelope_invalid");
    }
    if (envelope.version !== 1 || envelope.algorithm !== ALGORITHM)
      throw new Error("command_envelope_invalid");
    const encryptionContext = context(identity);
    const decrypted = await this.kms.send(
      new DecryptCommand({
        KeyId: this.keyId,
        CiphertextBlob: Buffer.from(envelope.encryptedDataKey, "base64"),
        EncryptionContext: encryptionContext,
      }),
    );
    if (!decrypted.Plaintext) throw new Error("kms_decrypt_unavailable");
    const key = Buffer.from(decrypted.Plaintext);
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(envelope.nonce, "base64"),
      );
      decipher.setAAD(aad(encryptionContext));
      decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]);
      return JSON.parse(plaintext.toString("utf8")) as BrowserCommandV1;
    } finally {
      key.fill(0);
      Buffer.from(decrypted.Plaintext).fill(0);
    }
  }

  async delete(identity: CommandIdentity) {
    await this.objects.delete(this.objectKey(identity));
  }
}
