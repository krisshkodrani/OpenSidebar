import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { PersonalDataCategory } from "@opensidebar/shared-types";

export interface PersonalDataObjectPort {
  key(accountId: string, category: PersonalDataCategory, revision: number): string;
  put(key: string, body: Uint8Array): Promise<string>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export class DisabledPersonalDataObjectStore implements PersonalDataObjectPort {
  key(accountId: string, category: PersonalDataCategory, revision: number) {
    return `v1/accounts/${accountId}/personal-data/${category}/${revision}.json`;
  }
  async put(): Promise<string> { throw new Error("personal_data_object_store_disabled"); }
  async get(): Promise<Uint8Array> { throw new Error("personal_data_object_store_disabled"); }
  async delete(): Promise<void> { throw new Error("personal_data_object_store_disabled"); }
}

export class PersonalDataObjectStore implements PersonalDataObjectPort {
  constructor(private readonly bucket: string, private readonly s3 = new S3Client({})) {}
  key(accountId: string, category: PersonalDataCategory, revision: number) {
    return `v1/accounts/${accountId}/personal-data/${category}/${revision}.json`;
  }
  async put(key: string, body: Uint8Array) {
    const digest = createHash("sha256").update(body).digest("hex");
    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "application/vnd.opensidebar.personal-data+json",
        IfNoneMatch: "*",
      }));
      return digest;
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 412 &&
        createHash("sha256").update(await this.get(key)).digest("hex") === digest
      ) return digest;
      throw error;
    }
  }
  async get(key: string) {
    const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error("personal_data_object_missing");
    return result.Body.transformToByteArray();
  }
  async delete(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
