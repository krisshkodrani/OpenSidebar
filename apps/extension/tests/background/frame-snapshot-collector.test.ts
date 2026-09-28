import { afterEach, describe, expect, test, vi } from "vitest";
import { collectCrossOriginFrameSnapshots } from "../../src/background/perception/frame-snapshot-collector";

type Receiver = (message: unknown, sender: { tab: { id: number }; frameId: number }) => boolean;
let receiver: Receiver;

function installFrames(
  frames: { frameId: number; parentFrameId: number; url: string }[],
  missing = new Set<number>(),
  stale = new Set<number>(),
): void {
  vi.stubGlobal("chrome", {
    runtime: { onMessage: { addListener: (listener: Receiver) => { receiver = listener; } } },
    webNavigation: { getAllFrames: async () => frames },
    tabs: { sendMessage: async (_tabId: number,
      request: { requestId: string; payload: { geometryNonce: string } },
      options: { frameId: number }) => {
      if (missing.has(options.frameId)) return new Promise(() => undefined);
      const frame = frames.find((item) => item.frameId === options.frameId)!;
      queueMicrotask(() => receiver({
        type: "FRAME_GEOMETRY_REPORT",
        payload: {
          nonce: request.payload.geometryNonce,
          rect: { x: options.frameId * 10, y: options.frameId * 5,
            width: 200, height: 100 },
          visible: true,
        },
      }, { tab: { id: 8 }, frameId: frame.parentFrameId }));
      return { type: "FRAME_SNAPSHOT_RESPONSE", requestId: request.requestId,
        payload: { snapshot: {
        title: `Frame ${options.frameId}`,
        url: stale.has(options.frameId) ? "https://new.test/" : frame.url,
        elements: [],
        viewport: { width: 200, height: 100 },
        scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 100 },
      }, documentState: { documentInstanceId: "doc", mutationEpoch: 0,
        url: stale.has(options.frameId) ? "https://new.test/" : frame.url,
        viewport: { width: 200, height: 100 },
        scroll: { x: 0, y: 0 } } } };
    } },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("cross-origin frame collection", () => {
  test("positions a cross-origin grandchild through a same-origin parent", async () => {
    installFrames([
      { frameId: 0, parentFrameId: -1, url: "https://a.test/" },
      { frameId: 2, parentFrameId: 0, url: "https://a.test/inner" },
      { frameId: 3, parentFrameId: 2, url: "https://b.test/checkout" },
    ]);
    const result = await collectCrossOriginFrameSnapshots(8, 100);
    expect(result.missingFrameIds).toEqual([]);
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toMatchObject({
      frameId: 3, rect: { x: 50, y: 25 },
    });
  });

  test("returns a partial result at the deadline when a child does not answer", async () => {
    installFrames([
      { frameId: 0, parentFrameId: -1, url: "https://a.test/" },
      { frameId: 4, parentFrameId: 0, url: "https://b.test/" },
    ], new Set([4]));
    const started = performance.now();
    const result = await collectCrossOriginFrameSnapshots(8, 30);
    expect(result).toEqual({ children: [], missingFrameIds: [4] });
    expect(performance.now() - started).toBeLessThan(100);
  });

  test("drops a child that navigated after frame enumeration", async () => {
    installFrames([
      { frameId: 0, parentFrameId: -1, url: "https://a.test/" },
      { frameId: 4, parentFrameId: 0, url: "https://b.test/" },
    ], new Set(), new Set([4]));
    expect(await collectCrossOriginFrameSnapshots(8, 100)).toEqual({
      children: [], missingFrameIds: [4],
    });
  });

  test("marks frame discovery as unavailable at the deadline", async () => {
    installFrames([{ frameId: 0, parentFrameId: -1, url: "https://a.test/" }]);
    vi.spyOn(chrome.webNavigation, "getAllFrames")
      .mockImplementation(() => new Promise(() => undefined));
    const started = performance.now();
    expect(await collectCrossOriginFrameSnapshots(8, 20)).toEqual({
      children: [], missingFrameIds: [], collectionUnavailable: true,
    });
    expect(performance.now() - started).toBeLessThan(100);
  });
});
