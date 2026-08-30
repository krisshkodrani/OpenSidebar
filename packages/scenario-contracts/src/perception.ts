import type { JsonObject, JsonValue } from "./json.js";
import type {
  AttemptClassification,
  RequestedSeatV1,
  ResolvedSeatV1,
  RoleUsageV1,
} from "./validation.js";

export type PerceptionImageDetail = "low" | "high" | "auto" | "unknown";

export type PerceptionDiagnosis =
  | "valid_pass"
  | "capture_failure"
  | "delivery_failure"
  | "model_perception_failure"
  | "grounding_action_failure"
  | "provider_failure"
  | "validator_disagreement"
  | "indeterminate";

export interface PerceptionImageArtifactV1 {
  schemaVersion: 1;
  path: string;
  sha256: string;
  mimeType: "image/jpeg" | "image/png";
  byteLength: number;
  width: number;
  height: number;
  detail: PerceptionImageDetail;
  turnNumber: number;
  screenshotStatus: "captured" | "cached" | "not_requested" | "unknown";
}

export interface PerceptionCaptureCheckV1 {
  id: string;
  passed: boolean;
  detail: string;
}

export interface PerceptionCaptureResultV1 {
  passed: boolean;
  checks: readonly PerceptionCaptureCheckV1[];
  image: PerceptionImageArtifactV1 | null;
}

export interface PerceptionDirectModelResultV1 {
  requested: RequestedSeatV1;
  resolved?: ResolvedSeatV1;
  imageSha256: string;
  passed: boolean;
  answer: string | null;
  evidence: string | null;
  durationMs: number;
  usage?: RoleUsageV1;
  failure?: {
    kind: "provider" | "delivery" | "indeterminate";
    reason: string;
  };
}

export interface PerceptionIntegratedResultV1 {
  attemptId: string;
  classification: AttemptClassification;
  passed: boolean;
  imagePromptObserved: boolean;
  screenshotCounts: {
    captured: number;
    reused: number;
  };
  imagePromptCounts: {
    total: number;
    low: number;
    high: number;
    auto: number;
  };
  resolvedExecutor?: ResolvedSeatV1;
}

export interface PerceptionBenchmarkCaseV1 {
  schemaVersion: 1;
  caseId: string;
  caseVersion: number;
  title: string;
  prompt: string;
  expected: JsonValue;
  visualCue: string;
}

export interface PerceptionBenchmarkResultV1 {
  schemaVersion: 1;
  benchmark: "modelbench-perception";
  case: PerceptionBenchmarkCaseV1;
  capture: PerceptionCaptureResultV1;
  direct: PerceptionDirectModelResultV1 | null;
  integrated: PerceptionIntegratedResultV1;
  diagnosis: PerceptionDiagnosis;
  diagnostics?: JsonObject;
}

export interface PerceptionMetricSliceV1 {
  attempted: number;
  passed: number;
  accuracy: number | null;
}

export interface PerceptionTelemetryTotalsV1 {
  screenshotsCaptured: number;
  screenshotsReused: number;
  imagePrompts: number;
  lowDetailImagePrompts: number;
  highDetailImagePrompts: number;
  autoDetailImagePrompts: number;
}

export interface PerceptionModelReportV1 {
  capture: PerceptionMetricSliceV1;
  direct: PerceptionMetricSliceV1;
  integrated: PerceptionMetricSliceV1;
  telemetry: PerceptionTelemetryTotalsV1;
  byDiagnosis: Record<PerceptionDiagnosis, number>;
}

export interface PerceptionBenchmarkReportV1 {
  schemaVersion: 1;
  benchmark: "modelbench-perception";
  generatedAt: string;
  cases: number;
  attempts: number;
  capture: PerceptionMetricSliceV1;
  direct: PerceptionMetricSliceV1;
  integrated: PerceptionMetricSliceV1;
  telemetry: PerceptionTelemetryTotalsV1;
  byDiagnosis: Record<PerceptionDiagnosis, number>;
  byModel: Record<string, PerceptionModelReportV1>;
  results: readonly PerceptionBenchmarkResultV1[];
}
