import type { DomSnapshot, PageDocumentState } from "../../../types";
import { getSnapshotFingerprint } from "../loop-helpers";
import type {
  ActionReceipt,
  ActionReceiptStatus,
  GroundedActionBasis,
  ObservationBasis,
  PageImageObservation,
  PageObservation,
  PageStateTraceSink,
  PerceptionScreenshotTrace,
  PerceptionTraceMeta,
  PerceptionTraceStats,
} from "./types";
import { PAGE_STATE_COORDINATOR_MODE } from "./mode";

const DEFAULT_TRACE_META: PerceptionTraceMeta = {
  mode: "element_only",
  source: "fallback",
  freshnessReason: "dom_fallback",
  screenshotStatus: "not_requested",
};

const DEFAULT_TRACE_STATS: PerceptionTraceStats = {
  model: "none",
  durationMs: 0,
  cached: false,
};

export function pageDocumentStatesMatch(
  left: PageDocumentState,
  right: PageDocumentState,
  options: { requireGeometryMatch?: boolean } = {},
): boolean {
  const identityMatches =
    left.documentInstanceId === right.documentInstanceId &&
    left.mutationEpoch === right.mutationEpoch &&
    left.url === right.url;
  if (!identityMatches || !options.requireGeometryMatch) {
    return identityMatches;
  }
  return (
    left.viewport.width === right.viewport.width &&
    left.viewport.height === right.viewport.height &&
    left.scroll.x === right.scroll.x &&
    left.scroll.y === right.scroll.y
  );
}

function basisFrom(
  revision: number,
  snapshot: DomSnapshot,
  documentState: PageDocumentState,
): ObservationBasis {
  return {
    observationRevision: revision,
    documentInstanceId: documentState.documentInstanceId,
    mutationEpoch: documentState.mutationEpoch,
    snapshotFingerprint: getSnapshotFingerprint(snapshot),
    url: documentState.url,
    viewport: { ...documentState.viewport },
    scroll: { ...documentState.scroll },
  };
}

export function legacyDocumentState(snapshot: DomSnapshot): PageDocumentState {
  return {
    documentInstanceId: `legacy:${snapshot.url || "unknown"}`,
    mutationEpoch: -1,
    url: snapshot.url,
    viewport: { ...snapshot.viewport },
    scroll: { x: snapshot.scroll?.x ?? 0, y: snapshot.scroll?.y ?? 0 },
  };
}

function traceObservation(observation: PageObservation): Record<string, unknown> {
  return {
    coordinatorMode: PAGE_STATE_COORDINATOR_MODE,
    observationRevision: observation.basis.observationRevision,
    documentInstanceId: observation.basis.documentInstanceId,
    mutationEpoch: observation.basis.mutationEpoch,
    snapshotFingerprint: observation.basis.snapshotFingerprint,
    url: observation.url,
    consistency: observation.consistency,
    ...(observation.consistencyReason
      ? { consistencyReason: observation.consistencyReason }
      : {}),
    ...(observation.image
      ? {
          image: {
            artifactId: observation.image.artifactId,
            sha256: observation.image.sha256,
            width: observation.image.width,
            height: observation.image.height,
            scaleFactor: observation.image.scaleFactor,
            detail: observation.image.detail,
            source: observation.image.source,
          },
        }
      : {}),
  };
}

function traceReceipt(receipt: ActionReceipt): Record<string, unknown> {
  return {
    actionId: receipt.actionId,
    status: receipt.status,
    beforeRevision: receipt.before.observationRevision,
    afterRevision: receipt.after?.observationRevision,
    effect: receipt.effect,
    evidenceRefs: receipt.evidenceRefs,
    ...(receipt.toolResultRef ? { toolResultRef: receipt.toolResultRef } : {}),
    ...(receipt.reason ? { reason: receipt.reason } : {}),
  };
}

export async function sha256DataUrl(dataUrl: string): Promise<string> {
  const bytes = new TextEncoder().encode(dataUrl);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Canonical, model-free owner of the page state used by one AgentLoop run.
 * AgentContext and completion consumers receive projections of these immutable
 * observations; they are not independent state authorities.
 */
export class PageStateCoordinator {
  private revision = 0;
  private current: PageObservation | null = null;
  private observations = new Map<number, PageObservation>();
  private receipts: ActionReceipt[] = [];
  private pendingActions = new Map<
    string,
    {
      before: ObservationBasis;
      status: ActionReceiptStatus;
      toolResultRef?: string;
      reason?: string;
    }
  >();
  private traceSink: PageStateTraceSink | null = null;
  private receiptSink: ((receipt: ActionReceipt) => void) | null = null;
  private lastTraceMeta: PerceptionTraceMeta = DEFAULT_TRACE_META;
  private lastTraceStats: PerceptionTraceStats = DEFAULT_TRACE_STATS;

  setTraceSink(traceSink: PageStateTraceSink | null): void {
    this.traceSink = traceSink;
  }

  setReceiptSink(sink: ((receipt: ActionReceipt) => void) | null): void {
    this.receiptSink = sink;
  }

  getCurrentObservation(): PageObservation | null {
    return this.current;
  }

  getCurrentActionBasis(
    options: { requireGeometryMatch?: boolean } = {},
  ): GroundedActionBasis | undefined {
    if (
      !this.current ||
      this.current.basis.mutationEpoch < 0 ||
      this.current.basis.documentInstanceId.startsWith("legacy:")
    ) {
      return undefined;
    }
    return {
      observationRevision: this.current.basis.observationRevision,
      documentInstanceId: this.current.basis.documentInstanceId,
      mutationEpoch: this.current.basis.mutationEpoch,
      url: this.current.basis.url,
      viewport: { ...this.current.basis.viewport },
      scroll: { ...this.current.basis.scroll },
      ...(options.requireGeometryMatch ? { requireGeometryMatch: true } : {}),
    };
  }

  acceptDomObservation(input: {
    snapshot: DomSnapshot;
    documentState: PageDocumentState;
    source?: "fresh" | "reused";
    consistency?: "dom_only" | "inconsistent";
    consistencyReason?: string;
    capturedAt?: number;
  }): PageObservation {
    const revision = ++this.revision;
    const observation: PageObservation = {
      basis: basisFrom(revision, input.snapshot, input.documentState),
      capturedAt: input.capturedAt ?? Date.now(),
      url: input.snapshot.url,
      title: input.snapshot.title,
      dom: {
        snapshot: input.snapshot,
        source: input.source ?? "fresh",
      },
      consistency: input.consistency ?? "dom_only",
      ...(input.consistencyReason
        ? { consistencyReason: input.consistencyReason }
        : {}),
    };
    this.current = observation;
    this.observations.set(revision, observation);
    this.traceSink?.recordEvent("page_observation", traceObservation(observation));
    return observation;
  }

  acceptImageObservation(input: {
    baseRevision: number;
    image: PageImageObservation;
    postCaptureState: PageDocumentState;
  }): { observation: PageObservation; consistent: boolean } {
    const base = this.current;
    if (!base || base.basis.observationRevision !== input.baseRevision) {
      throw new Error("Cannot attach an image to a superseded page observation");
    }
    const expected: PageDocumentState = {
      documentInstanceId: base.basis.documentInstanceId,
      mutationEpoch: base.basis.mutationEpoch,
      url: base.basis.url,
      viewport: base.basis.viewport,
      scroll: base.basis.scroll,
    };
    const consistent = pageDocumentStatesMatch(expected, input.postCaptureState, {
      requireGeometryMatch: true,
    });
    const revision = ++this.revision;
    const observation: PageObservation = {
      ...base,
      basis: {
        ...base.basis,
        observationRevision: revision,
      },
      capturedAt: input.image.capturedAt,
      ...(consistent ? { image: input.image } : {}),
      consistency: consistent ? "consistent" : "inconsistent",
      ...(consistent
        ? {}
        : { consistencyReason: "page_changed_during_multimodal_capture" }),
    };
    this.current = observation;
    this.observations.set(revision, observation);
    this.traceSink?.recordEvent("page_observation", traceObservation(observation));
    return { observation, consistent };
  }

  recordActionReceipt(input: {
    actionId: string;
    status: ActionReceiptStatus;
    before: ObservationBasis;
    after?: PageObservation | null;
    toolResultRef?: string;
    evidenceRefs?: string[];
    reason?: string;
  }): ActionReceipt {
    const after = input.after?.basis;
    const beforeObservation = this.observations.get(
      input.before.observationRevision,
    );
    const beforeImageHash = beforeObservation?.image?.sha256;
    const afterImageHash = input.after?.image?.sha256;
    const receipt: ActionReceipt = {
      actionId: input.actionId,
      status: input.status,
      before: input.before,
      ...(after ? { after } : {}),
      effect: {
        documentChanged: Boolean(
          after && after.documentInstanceId !== input.before.documentInstanceId,
        ),
        urlChanged: Boolean(after && after.url !== input.before.url),
        domChanged: Boolean(
          after && after.snapshotFingerprint !== input.before.snapshotFingerprint,
        ),
        visualChanged:
          beforeImageHash && afterImageHash
            ? beforeImageHash === afterImageHash
              ? "unchanged"
              : "changed"
            : "not_observed",
      },
      ...(input.toolResultRef ? { toolResultRef: input.toolResultRef } : {}),
      evidenceRefs: [...(input.evidenceRefs ?? [])],
      ...(input.reason ? { reason: input.reason } : {}),
    };
    this.receipts.push(receipt);
    this.receiptSink?.(receipt);
    this.traceSink?.recordEvent("action_receipt", traceReceipt(receipt));
    return receipt;
  }

  stageAction(actionId: string, before: ObservationBasis): void {
    this.pendingActions.set(actionId, {
      before,
      status: "uncertain",
    });
  }

  settleAction(input: {
    actionId: string;
    status: ActionReceiptStatus;
    toolResultRef?: string;
    reason?: string;
    after?: PageObservation | null;
    deferUntilObservation?: boolean;
  }): ActionReceipt | null {
    const pending = this.pendingActions.get(input.actionId);
    if (!pending) return null;
    const settled = {
      ...pending,
      status: input.status,
      ...(input.toolResultRef ? { toolResultRef: input.toolResultRef } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    };
    if (input.deferUntilObservation) {
      this.pendingActions.set(input.actionId, settled);
      return null;
    }
    this.pendingActions.delete(input.actionId);
    const after = input.after ?? this.current;
    return this.recordActionReceipt({
      actionId: input.actionId,
      ...settled,
      after,
      evidenceRefs: after
        ? [
            `observation:${after.basis.observationRevision}`,
            ...(after.image ? [after.image.artifactId] : []),
          ]
        : [],
    });
  }

  finalizePendingActions(after: PageObservation): ActionReceipt[] {
    const receipts: ActionReceipt[] = [];
    for (const [actionId, pending] of this.pendingActions) {
      this.pendingActions.delete(actionId);
      receipts.push(
        this.recordActionReceipt({
          actionId,
          ...pending,
          after,
          evidenceRefs: [
            `observation:${after.basis.observationRevision}`,
            ...(after.image ? [after.image.artifactId] : []),
          ],
        }),
      );
    }
    return receipts;
  }

  finalizePendingAsUncertain(reason: string): ActionReceipt[] {
    const receipts: ActionReceipt[] = [];
    for (const [actionId, pending] of this.pendingActions) {
      this.pendingActions.delete(actionId);
      receipts.push(
        this.recordActionReceipt({
          actionId,
          ...pending,
          status: "uncertain",
          after: this.current,
          reason,
          evidenceRefs: [],
        }),
      );
    }
    return receipts;
  }

  getLastActionReceipt(): ActionReceipt | null {
    return this.receipts.at(-1) ?? null;
  }

  getActionReceipts(): readonly ActionReceipt[] {
    return this.receipts;
  }

  getInterpretation(): string | null {
    return null;
  }

  getLastScreenshot(): string | null {
    return this.current?.image?.dataUrl ?? null;
  }

  getLastTraceMeta(): PerceptionTraceMeta {
    return this.lastTraceMeta;
  }

  getLastTraceStats(): PerceptionTraceStats {
    return this.lastTraceStats;
  }

  setScreenshotTrace(trace: PerceptionScreenshotTrace): void {
    this.lastTraceMeta = trace.meta;
    this.lastTraceStats = trace.stats;
  }

  invalidateCache(): void {}

  reset(): void {
    this.revision = 0;
    this.current = null;
    this.observations.clear();
    this.receipts = [];
    this.pendingActions.clear();
    this.lastTraceMeta = DEFAULT_TRACE_META;
    this.lastTraceStats = DEFAULT_TRACE_STATS;
  }
}
