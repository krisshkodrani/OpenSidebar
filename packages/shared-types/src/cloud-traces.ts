export type CloudTraceState =
  | "upload_pending"
  | "available"
  | "deleting"
  | "failed";

export type CloudTraceV1 = {
  schemaVersion: 1;
  traceId: string;
  title: string;
  createdAt: string;
  uploadedAt?: string;
  expiresAt: string;
  state: CloudTraceState;
  bundleSchemaVersion: string;
  keyFingerprint: string;
  entryCount: number;
  screenshotCount: number;
  ciphertextSizeBytes: number;
  ciphertextSha256?: string;
};

export type CreateTraceUploadIntentV1 = Omit<
  CloudTraceV1,
  "schemaVersion" | "uploadedAt" | "expiresAt" | "state" | "ciphertextSha256"
>;

export type TraceUsageV1 = {
  schemaVersion: 1;
  usedBytes: number;
  quotaBytes: number;
  traceCount: number;
};
