import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { KMSClient, DecryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  CloudProviderId,
  CredentialCipher,
  CredentialRepository,
  EncryptedCredential,
} from "./contracts.ts";

const kms = new KMSClient({});
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

function aad(context: Readonly<Record<string, string>>): Buffer {
  return Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(context).sort())));
}

export class KmsEnvelopeCipher implements CredentialCipher {
  constructor(private readonly keyId: string) {}

  async encrypt(plaintext: string, context: Readonly<Record<string, string>>) {
    const generated = await kms.send(new GenerateDataKeyCommand({
      KeyId: this.keyId,
      KeySpec: "AES_256",
      EncryptionContext: context,
    }));
    if (!generated.Plaintext || !generated.CiphertextBlob) {
      throw new Error("KMS did not return an envelope key");
    }
    const key = Buffer.from(generated.Plaintext);
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad(context));
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const payload = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
      return {
        ciphertext: payload.toString("base64"),
        encryptedDataKey: Buffer.from(generated.CiphertextBlob).toString("base64"),
      };
    } finally {
      key.fill(0);
      Buffer.from(generated.Plaintext).fill(0);
    }
  }

  async decrypt(
    encrypted: Pick<EncryptedCredential, "ciphertext" | "encryptedDataKey">,
    context: Readonly<Record<string, string>>,
  ): Promise<string> {
    const result = await kms.send(new DecryptCommand({
      CiphertextBlob: Buffer.from(encrypted.encryptedDataKey, "base64"),
      EncryptionContext: context,
      KeyId: this.keyId,
    }));
    if (!result.Plaintext) throw new Error("KMS did not decrypt the envelope key");
    const key = Buffer.from(result.Plaintext);
    try {
      const payload = Buffer.from(encrypted.ciphertext, "base64");
      const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
      decipher.setAAD(aad(context));
      decipher.setAuthTag(payload.subarray(12, 28));
      return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
    } finally {
      key.fill(0);
      Buffer.from(result.Plaintext).fill(0);
    }
  }
}

export class DynamoCredentialRepository implements CredentialRepository {
  constructor(private readonly tableName: string) {}

  async get(accountId: string, provider: CloudProviderId) {
    const result = await documentClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { accountId, provider },
      ConsistentRead: true,
    }));
    return (result.Item as EncryptedCredential | undefined) ?? null;
  }

  async put(value: EncryptedCredential): Promise<void> {
    await documentClient.send(new PutCommand({ TableName: this.tableName, Item: value }));
  }

  async delete(accountId: string, provider: CloudProviderId): Promise<void> {
    await documentClient.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { accountId, provider },
    }));
  }
}

export { documentClient };
