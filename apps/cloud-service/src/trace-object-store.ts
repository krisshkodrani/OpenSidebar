import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface TraceObjectPort {
  key(accountId: string, traceId: string): string;
  put(key: string, body: Uint8Array): Promise<string>;
  get(key: string): Promise<Uint8Array>;
  sha256(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}

export class TraceObjectStore implements TraceObjectPort {
  constructor(
    private readonly bucket: string,
    private readonly s3 = new S3Client({}),
  ) {}
  key(accountId: string, traceId: string) {
    return `v1/accounts/${accountId}/traces/${traceId}.ostrace`;
  }
  async put(key: string, body: Uint8Array) {
    const digest = createHash("sha256").update(body).digest("hex");
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: "application/vnd.opensidebar.trace",
          IfNoneMatch: "*",
        }),
      );
      return digest;
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 412 &&
        (await this.sha256(key)) === digest
      )
        return digest;
      throw error;
    }
  }
  async get(key: string) {
    const result = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!result.Body) throw new Error("trace_object_missing");
    return result.Body.transformToByteArray();
  }
  async sha256(key: string) {
    return createHash("sha256")
      .update(await this.get(key))
      .digest("hex");
  }
  async delete(key: string) {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
