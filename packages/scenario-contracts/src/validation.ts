import type { JsonObject, JsonValue } from "./json.js";

export type ValidationVerdict = "pass" | "fail" | "invalid";

export interface ValidationAssertionV1 {
  id: string;
  passed: boolean;
  expected: JsonValue;
  actual: JsonValue | undefined;
  evidence: string;
}

export interface ValidationResultV1 {
  schemaVersion: 1;
  caseId: string;
  caseVersion: number;
  validatorId: string;
  validatorVersion: number;
  verdict: ValidationVerdict;
  assertions: readonly ValidationAssertionV1[];
  unexpectedMutations: readonly string[];
  finalStateHash: string;
  details?: JsonObject;
}

export type AttemptClassification =
  | "valid_pass"
  | "valid_model_failure"
  | "harness_failure"
  | "provider_failure"
  | "validator_disagreement"
  | "indeterminate";

export type ModelSeat = "executor" | "planner" | "perception" | "judge";

export interface RequestedSeatV1 {
  provider: string;
  providerPin?: string;
  model: string;
}

export interface ResolvedSeatV1 extends RequestedSeatV1 {
  resolvedProvider: string;
  resolvedModel: string;
}

export interface RoleUsageV1 {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costUsd: number;
  llmTimeMs: number;
}

export interface BenchmarkAttemptV1 {
  schemaVersion: 1;
  attemptId: string;
  caseId: string;
  caseVersion: number;
  caseContentHash: string;
  buildRevision: string;
  startedAt: string;
  durationMs: number;
  classification: AttemptClassification;
  scoreEligible: boolean;
  requestedSeats: Partial<Record<ModelSeat, RequestedSeatV1>>;
  resolvedSeats: Partial<Record<ModelSeat, ResolvedSeatV1>>;
  usageByRole: Partial<Record<ModelSeat, RoleUsageV1>>;
  validation: ValidationResultV1 | null;
  retryOfAttemptId?: string;
  artifactRefs: readonly string[];
}

export interface MetricSliceV1 {
  requested: number;
  valid: number;
  passed: number;
  passAt1: number | null;
}

export interface BenchmarkReportV1 {
  schemaVersion: 1;
  benchmark: "modelbench-100";
  generatedAt: string;
  rankable: boolean;
  coverage: number;
  overall: MetricSliceV1;
  byRole: Record<string, MetricSliceV1>;
  byFamily: Record<string, MetricSliceV1>;
  byDifficulty: Record<string, MetricSliceV1>;
  byCharacter: Record<string, MetricSliceV1>;
  invalidRunRate: number;
  retryRate: number;
  judgeDisagreementRate: number | null;
  medianDurationMs: number | null;
  p95DurationMs: number | null;
  totalCostUsd: number;
  costPerRequestedTaskUsd: number | null;
  costPerSuccessfulTaskUsd: number | null;
}
