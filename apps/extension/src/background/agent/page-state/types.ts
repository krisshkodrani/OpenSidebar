import type { DomSnapshot, PageDocumentState } from "../../../types";
import type {
  TracePerceptionFreshnessReason,
  TracePerceptionMode,
  TracePerceptionScreenshotStatus,
  TracePerceptionSource,
} from "../../../types";

export interface ObservationBasis {
  observationRevision: number;
  documentInstanceId: string;
  mutationEpoch: number;
  snapshotFingerprint: string;
  url: string;
  viewport: PageDocumentState["viewport"];
  scroll: PageDocumentState["scroll"];
}

export interface PageImageObservation {
  artifactId: string;
  sha256: string;
  width: number;
  height: number;
  scaleFactor: number;
  detail: "low" | "high";
  source: "fresh" | "reused";
  capturedAt: number;
  /** Private runtime bytes. Trace projections must never include this field. */
  dataUrl: string;
}

export interface PageObservation {
  basis: ObservationBasis;
  capturedAt: number;
  url: string;
  title: string;
  dom: {
    snapshot: DomSnapshot;
    source: "fresh" | "reused";
  };
  image?: PageImageObservation;
  consistency: "consistent" | "inconsistent" | "dom_only";
  consistencyReason?: string;
}

export type ActionReceiptStatus =
  | "executed"
  | "failed"
  | "stale"
  | "uncertain";

export interface ActionReceipt {
  actionId: string;
  status: ActionReceiptStatus;
  before: ObservationBasis;
  after?: ObservationBasis;
  effect: {
    documentChanged: boolean;
    urlChanged: boolean;
    domChanged: boolean;
    visualChanged: "changed" | "unchanged" | "not_observed";
  };
  toolResultRef?: string;
  evidenceRefs: string[];
  reason?: string;
}

export interface PerceptionTraceMeta {
  mode: TracePerceptionMode;
  source: TracePerceptionSource;
  freshnessReason: TracePerceptionFreshnessReason;
  screenshotStatus: TracePerceptionScreenshotStatus;
}

export interface PerceptionTraceStats {
  model: string;
  providerId?: string;
  durationMs: number;
  cached: boolean;
}

export interface PerceptionScreenshotTrace {
  meta: PerceptionTraceMeta;
  stats: PerceptionTraceStats;
}

export interface PageStateTraceSink {
  recordEvent(type: string, data?: Record<string, unknown>): void;
}

export interface GroundedActionBasis extends PageDocumentState {
  observationRevision: number;
  requireGeometryMatch?: boolean;
}
