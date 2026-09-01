import { describe, expect, test, vi } from "vitest";
import type { DomSnapshot, PageDocumentState } from "../../src/types";
import {
  PageStateCoordinator,
  pageDocumentStatesMatch,
  sha256DataUrl,
  type PageImageObservation,
} from "../../src/background/agent/page-state";

function snapshot(url = "https://example.test/", text = "Initial"): DomSnapshot {
  return {
    title: "Example",
    url,
    elements: [],
    visibleContent: text,
    pageContent: text,
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
  };
}

function documentState(
  overrides: Partial<PageDocumentState> = {},
): PageDocumentState {
  return {
    documentInstanceId: "doc-1",
    mutationEpoch: 3,
    url: "https://example.test/",
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0 },
    ...overrides,
  };
}

async function image(
  dataUrl = "data:image/jpeg;base64,AAAA",
): Promise<PageImageObservation> {
  const sha256 = await sha256DataUrl(dataUrl);
  return {
    artifactId: `sha256:${sha256}`,
    sha256,
    width: 1280,
    height: 720,
    scaleFactor: 1,
    detail: "high",
    source: "fresh",
    capturedAt: 100,
    dataUrl,
  };
}

describe("PageStateCoordinator", () => {
  test("creates monotonic immutable DOM and multimodal observations", async () => {
    const coordinator = new PageStateCoordinator();
    const dom = coordinator.acceptDomObservation({
      snapshot: snapshot(),
      documentState: documentState(),
      capturedAt: 50,
    });
    const multimodal = coordinator.acceptImageObservation({
      baseRevision: dom.basis.observationRevision,
      image: await image(),
      postCaptureState: documentState(),
    });

    expect(dom.basis.observationRevision).toBe(1);
    expect(dom.consistency).toBe("dom_only");
    expect(multimodal.consistent).toBe(true);
    expect(multimodal.observation.basis.observationRevision).toBe(2);
    expect(multimodal.observation.consistency).toBe("consistent");
    expect(dom.image).toBeUndefined();
  });

  test("keeps screenshot bytes when the page only repainted during capture", async () => {
    const coordinator = new PageStateCoordinator();
    const dom = coordinator.acceptDomObservation({
      snapshot: snapshot(),
      documentState: documentState(),
    });
    const result = coordinator.acceptImageObservation({
      baseRevision: dom.basis.observationRevision,
      image: await image(),
      postCaptureState: documentState({ mutationEpoch: 4 }),
    });

    // A repaint leaves the frame microseconds stale but still truthful about
    // this document at this scroll position. Continuously animating pages never
    // produce an epoch-stable frame, so dropping it would blind the executor.
    expect(result.consistent).toBe(false);
    expect(result.mismatch).toBe("epoch_only");
    expect(result.observation.consistency).toBe("inconsistent");
    expect(result.observation.consistencyReason).toBe(
      "page_repainted_during_multimodal_capture",
    );
    expect(result.observation.image).toBeDefined();
    expect(coordinator.getLastScreenshot()).not.toBeNull();
  });

  test("drops screenshot bytes when capture crosses a navigation", async () => {
    const coordinator = new PageStateCoordinator();
    const dom = coordinator.acceptDomObservation({
      snapshot: snapshot(),
      documentState: documentState(),
    });
    const result = coordinator.acceptImageObservation({
      baseRevision: dom.basis.observationRevision,
      image: await image(),
      postCaptureState: documentState({
        mutationEpoch: 4,
        url: "https://example.test/somewhere-else",
      }),
    });

    // Here the frame depicts a different page, so it is misleading rather than
    // stale: DOM-only fallback still applies.
    expect(result.consistent).toBe(false);
    expect(result.mismatch).toBe("invalidating");
    expect(result.observation.consistencyReason).toBe(
      "page_replaced_during_multimodal_capture",
    );
    expect(result.observation.image).toBeUndefined();
    expect(coordinator.getLastScreenshot()).toBeNull();
  });

  test("drops screenshot bytes when the viewport scrolled during capture", async () => {
    const coordinator = new PageStateCoordinator();
    const dom = coordinator.acceptDomObservation({
      snapshot: snapshot(),
      documentState: documentState(),
    });
    const result = coordinator.acceptImageObservation({
      baseRevision: dom.basis.observationRevision,
      image: await image(),
      postCaptureState: documentState({ scroll: { x: 0, y: 640 } }),
    });

    expect(result.mismatch).toBe("invalidating");
    expect(result.observation.image).toBeUndefined();
  });

  test("binds actions to the current revision and records observed effects", async () => {
    const coordinator = new PageStateCoordinator();
    const beforeDom = coordinator.acceptDomObservation({
      snapshot: snapshot(),
      documentState: documentState(),
    });
    const before = coordinator.acceptImageObservation({
      baseRevision: beforeDom.basis.observationRevision,
      image: await image(),
      postCaptureState: documentState(),
    }).observation;
    const actionBasis = coordinator.getCurrentActionBasis({
      requireGeometryMatch: true,
    });

    expect(actionBasis).toMatchObject({
      observationRevision: before.basis.observationRevision,
      documentInstanceId: "doc-1",
      mutationEpoch: 3,
      requireGeometryMatch: true,
    });

    const afterDom = coordinator.acceptDomObservation({
      snapshot: snapshot("https://example.test/next", "Changed"),
      documentState: documentState({
        mutationEpoch: 4,
        url: "https://example.test/next",
      }),
    });
    const after = coordinator.acceptImageObservation({
      baseRevision: afterDom.basis.observationRevision,
      image: await image("data:image/jpeg;base64,BBBB"),
      postCaptureState: documentState({
        mutationEpoch: 4,
        url: "https://example.test/next",
      }),
    }).observation;
    const receipt = coordinator.recordActionReceipt({
      actionId: "call-1",
      status: "executed",
      before: before.basis,
      after,
      evidenceRefs: [after.image!.artifactId],
    });

    expect(receipt.effect).toEqual({
      documentChanged: false,
      urlChanged: true,
      domChanged: true,
      visualChanged: "changed",
    });
  });

  test("trace projections omit private screenshot bytes and browser tab ids", async () => {
    const recordEvent = vi.fn();
    const coordinator = new PageStateCoordinator();
    coordinator.setTraceSink({ recordEvent });
    const dom = coordinator.acceptDomObservation({
      snapshot: snapshot(),
      documentState: documentState(),
    });
    coordinator.acceptImageObservation({
      baseRevision: dom.basis.observationRevision,
      image: await image(),
      postCaptureState: documentState(),
    });

    const serialized = JSON.stringify(recordEvent.mock.calls);
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("tabId");
    expect(serialized).toContain("artifactId");
    expect(serialized).toContain("coordinatorMode");
  });

  test("requires viewport geometry only for coordinate-grounded comparisons", () => {
    const moved = documentState({ scroll: { x: 0, y: 300 } });
    expect(pageDocumentStatesMatch(documentState(), moved)).toBe(true);
    expect(
      pageDocumentStatesMatch(documentState(), moved, {
        requireGeometryMatch: true,
      }),
    ).toBe(false);
  });

  test("finalizes deferred actions as uncertain when post-action observation fails", () => {
    const coordinator = new PageStateCoordinator();
    const before = coordinator.acceptDomObservation({
      snapshot: snapshot(),
      documentState: documentState(),
    });
    coordinator.stageAction("call-uncertain", before.basis);
    coordinator.settleAction({
      actionId: "call-uncertain",
      status: "executed",
      deferUntilObservation: true,
    });

    const receipts = coordinator.finalizePendingAsUncertain(
      "post_action_observation_failed",
    );

    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      actionId: "call-uncertain",
      status: "uncertain",
      reason: "post_action_observation_failed",
      evidenceRefs: [],
    });
  });

  test("projects finalized receipts to a downstream mutation consumer", () => {
    const recordReceipt = vi.fn();
    const coordinator = new PageStateCoordinator();
    coordinator.setReceiptSink(recordReceipt);
    const before = coordinator.acceptDomObservation({
      snapshot: snapshot(),
      documentState: documentState(),
    });
    coordinator.stageAction("call-sink", before.basis);
    coordinator.settleAction({
      actionId: "call-sink",
      status: "executed",
      after: before,
    });

    expect(recordReceipt).toHaveBeenCalledOnce();
    expect(recordReceipt.mock.calls[0][0]).toMatchObject({
      actionId: "call-sink",
      status: "executed",
      before: { observationRevision: 1 },
      after: { observationRevision: 1 },
    });
  });
});
