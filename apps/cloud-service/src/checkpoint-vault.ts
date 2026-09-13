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
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { KmsPort } from "./credential-vault.js";

const ALGORITHM = "aes-256-gcm-envelope-v1";
// JSON/base64 envelope overhead must keep the stored object below LP-29's 10 MiB cap.
const MAX_PLAINTEXT_BYTES = 7_800_000;
const MAX_CIPHERTEXT_BYTES = 10 * 1024 * 1024;

export type CheckpointIdentity = {
  accountId: string;
  sessionId: string;
  checkpointId: string;
  revision: number;
};

type StoredEnvelopeV1 = {
  version: 1;
  algorithm: typeof ALGORITHM;
  encryptedDataKey: string;
  nonce: string;
  authenticationTag: string;
  ciphertext: string;
};

export type CheckpointObjectPort = {
  put(key: string, body: Uint8Array): Promise<void>;
  /** Replace the current version without a delete gap; versioned stores retain history. */
  replace?(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  deleteAllVersions?(key: string): Promise<void>;
};

const encryptionContext = (identity: CheckpointIdentity) => ({
  purpose: "opensidebar-session-checkpoint-v1",
  accountId: identity.accountId,
  sessionId: identity.sessionId,
  checkpointId: identity.checkpointId,
  revision: String(identity.revision),
});
const associatedData = (value: Record<string, string>) =>
  Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(value).sort())));

export class S3CheckpointObjectStore implements CheckpointObjectPort {
  constructor(
    private readonly bucket: string,
    private readonly s3 = new S3Client({}),
  ) {}
  async put(key: string, body: Uint8Array) {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: "application/octet-stream",
          IfNoneMatch: "*",
        }),
      );
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 412
      )
        throw new Error("checkpoint_object_exists");
      throw error;
    }
  }
  async replace(key: string, body: Uint8Array) {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "application/octet-stream",
      }),
    );
  }
  async get(key: string) {
    const result = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!result.Body) throw new Error("checkpoint_object_missing");
    return result.Body.transformToByteArray();
  }
  async delete(key: string) {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
  async deleteAllVersions(key: string) {
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    for (;;) {
      const page = await this.s3.send(
        new ListObjectVersionsCommand({
          Bucket: this.bucket,
          Prefix: key,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        }),
      );
      const objects = [
        ...(page.Versions ?? []),
        ...(page.DeleteMarkers ?? []),
      ]
        .filter((value) => value.Key === key && value.VersionId)
        .map((value) => ({ Key: value.Key!, VersionId: value.VersionId! }));
      if (objects.length)
        await this.s3.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: objects, Quiet: true },
          }),
        );
      keyMarker = page.NextKeyMarker;
      versionIdMarker = page.NextVersionIdMarker;
      if (!page.IsTruncated) break;
      if (!keyMarker && !versionIdMarker)
        throw new Error("checkpoint_version_listing_incomplete");
    }
  }
}

export class CheckpointVault {
  private readonly kms: KmsPort;
  constructor(
    private readonly objects: CheckpointObjectPort,
    private readonly keyId: string,
    kms?: KmsPort,
  ) {
    this.kms = kms ?? new KMSClient({});
  }

  objectKey(identity: CheckpointIdentity) {
    return `v1/accounts/${identity.accountId}/sessions/${identity.sessionId}/checkpoints/${identity.checkpointId}`;
  }

  async encryptAndPut(identity: CheckpointIdentity, plaintext: Uint8Array) {
    if (plaintext.byteLength < 1 || plaintext.byteLength > MAX_PLAINTEXT_BYTES)
      throw new Error("checkpoint_size_invalid");
    const context = encryptionContext(identity);
    const generated = await this.kms.send(
      new GenerateDataKeyCommand({
        KeyId: this.keyId,
        KeySpec: "AES_256",
        EncryptionContext: context,
      }),
    );
    if (!generated.Plaintext || !generated.CiphertextBlob)
      throw new Error("kms_data_key_unavailable");
    const key = Buffer.from(generated.Plaintext);
    try {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(associatedData(context));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      const envelope: StoredEnvelopeV1 = {
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
      if (body.byteLength > MAX_CIPHERTEXT_BYTES)
        throw new Error("checkpoint_size_invalid");
      const objectKey = this.objectKey(identity);
      await this.objects.put(objectKey, body);
      return {
        objectKey,
        ciphertextSizeBytes: body.byteLength,
        ciphertextSha256: createHash("sha256").update(body).digest("hex"),
      };
    } finally {
      key.fill(0);
      Buffer.from(generated.Plaintext).fill(0);
    }
  }

  async getAndDecrypt(identity: CheckpointIdentity) {
    const body = Buffer.from(await this.objects.get(this.objectKey(identity)));
    let envelope: StoredEnvelopeV1;
    try {
      envelope = JSON.parse(body.toString("utf8")) as StoredEnvelopeV1;
    } catch {
      throw new Error("checkpoint_envelope_invalid");
    }
    if (
      envelope.version !== 1 ||
      envelope.algorithm !== ALGORITHM ||
      !envelope.encryptedDataKey ||
      !envelope.nonce ||
      !envelope.authenticationTag ||
      !envelope.ciphertext
    )
      throw new Error("checkpoint_envelope_invalid");
    const context = encryptionContext(identity);
    const decrypted = await this.kms.send(
      new DecryptCommand({
        KeyId: this.keyId,
        CiphertextBlob: Buffer.from(envelope.encryptedDataKey, "base64"),
        EncryptionContext: context,
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
      decipher.setAAD(associatedData(context));
      decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]);
    } finally {
      key.fill(0);
      Buffer.from(decrypted.Plaintext).fill(0);
    }
  }

  async inspect(identity: CheckpointIdentity) {
    const body = Buffer.from(await this.objects.get(this.objectKey(identity)));
    return {
      ciphertextSizeBytes: body.byteLength,
      ciphertextSha256: createHash("sha256").update(body).digest("hex"),
    };
  }

  async delete(identity: CheckpointIdentity) {
    await this.objects.delete(this.objectKey(identity));
  }
}
