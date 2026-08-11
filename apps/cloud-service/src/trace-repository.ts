import type {
  CreateTraceUploadIntentV1,
  CloudTraceV1,
  TraceUsageV1,
} from "@opensidebar/shared-types";

export type TraceMutation =
  | "created"
  | "exists"
  | "not_found"
  | "quota_exceeded"
  | "conflict";
export type TraceMutationResult<T> = { kind: TraceMutation; value?: T };

export interface TraceRepository {
  migrate(): Promise<void>;
  health(): Promise<void>;
  createIntent(
    accountId: string,
    input: CreateTraceUploadIntentV1,
    objectKey: string,
  ): Promise<TraceMutationResult<CloudTraceV1>>;
  commit(
    accountId: string,
    traceId: string,
    sha256: string,
  ): Promise<TraceMutationResult<CloudTraceV1>>;
  list(accountId: string): Promise<CloudTraceV1[]>;
  get(accountId: string, traceId: string): Promise<CloudTraceV1 | null>;
  usage(accountId: string): Promise<TraceUsageV1>;
  markDeleting(
    accountId: string,
    traceId: string,
  ): Promise<TraceMutationResult<CloudTraceV1>>;
  remove(accountId: string, traceId: string): Promise<void>;
  cleanupExpired(): Promise<
    Array<{ accountId: string; traceId: string; objectKey: string }>
  >;
  close(): Promise<void>;
}
