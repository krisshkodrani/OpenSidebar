import { afterEach, describe, expect, test, vi } from "vitest";
import { ToolName, type PageDocumentState } from "../../src/types";
import { requestPageSnapshot } from "../../src/background/perception/frame-snapshot-runtime";
import { frameActionRoutes } from "../../src/background/perception/frame-action-routes";
import { executeContentTool } from "../../src/background/tools/bridge";
import { findElementAcrossFrames } from "../../src/background/tools/frame-find-element";

const topState: PageDocumentState = {
  documentInstanceId: "top-doc", mutationEpoch: 1, url: "https://a.test/",
  viewport: { width: 800, height: 600 }, scroll: { x: 0, y: 0 },
};
const childState: PageDocumentState = {
  documentInstanceId: "child-doc", mutationEpoch: 1, url: "https://b.test/checkout",
  viewport: { width: 200, height: 100 }, scroll: { x: 0, y: 0 },
};

function snapshot(state: PageDocumentState) {
  return { title: "Checkout", url: state.url,
    elements: [{ tag: 1, tagName: "button", role: "button", text: "Continue",
      attributes: {}, rect: { x: 5, y: 5, width: 80, height: 25 },
      isVisible: true, isDisabled: false }],
    viewport: state.viewport,
    scroll: { ...state.scroll, maxY: 0, viewportHeight: state.viewport.height },
  };
}

afterEach(() => {
  frameActionRoutes.invalidate(7);
  vi.unstubAllGlobals();
});

describe("frame-aware snapshot and action bridge", () => {
  test("routes a merged child tag to its frame-local tag and observation", async () => {
    let report: (message: unknown, sender: { tab: { id: number }; frameId: number }) => boolean;
    let enabled = true;
    const sends: { type: string; frameId?: number; args?: Record<string, unknown>;
      basis?: PageDocumentState }[] = [];
    vi.stubGlobal("chrome", {
      storage: { sync: { get: async () => ({ userSettings: {
        crossOriginFramesEnabled: enabled,
      } }) } },
      runtime: { onMessage: { addListener: (listener: typeof report) => {
        report = listener;
      } } },
      webNavigation: { getAllFrames: async () => [
        { frameId: 0, parentFrameId: -1, url: topState.url },
        { frameId: 3, parentFrameId: 0, url: childState.url },
      ] },
      tabs: {
        TAB_ID_NONE: -1,
        sendMessage: async (_tabId: number, message: {
          type: string; requestId: string; payload: Record<string, unknown> },
        options?: { frameId: number }) => {
          sends.push({ type: message.type, frameId: options?.frameId,
            args: message.payload.args as Record<string, unknown> | undefined,
            basis: message.payload.observationBasis as PageDocumentState | undefined });
          if (message.type === "DOM_SNAPSHOT_REQUEST") return {
            type: "DOM_SNAPSHOT_RESPONSE", requestId: message.requestId,
            payload: { snapshot: snapshot(topState), documentState: topState,
              durationMs: 1 },
          };
          if (message.type === "FRAME_SNAPSHOT_REQUEST") {
            queueMicrotask(() => report!({ type: "FRAME_GEOMETRY_REPORT",
              payload: { nonce: message.payload.geometryNonce,
                rect: { x: 40, y: 50, width: 200, height: 100 },
                visible: true } }, { tab: { id: 7 }, frameId: 0 }));
            return { type: "FRAME_SNAPSHOT_RESPONSE", requestId: message.requestId,
              payload: { snapshot: snapshot(childState), documentState: childState } };
          }
          if (message.payload.toolName === ToolName.FIND_ELEMENT) return {
            type: "TOOL_RESULT", requestId: message.requestId,
            payload: options?.frameId ? {
              toolCallId: "find", success: true,
              result: 'Found "Promo" near [2] <button> "Promo". Use tag [2] to interact with it.',
              navigated: false,
            } : { toolCallId: "find", success: true,
              result: 'Found "Promo" but could not locate a container element',
              navigated: false },
          };
          return { type: "TOOL_RESULT", payload: {
            toolCallId: "call", success: true, result: "Clicked", navigated: false,
          } };
        },
      },
    });

    const response = await requestPageSnapshot(7, { refresh: true });
    expect(response.payload.snapshot.elements).toHaveLength(2);
    const childTag = response.payload.snapshot.elements[1].tag;
    expect(childTag).toBeGreaterThanOrEqual(1_000_000);
    expect(await executeContentTool(ToolName.CLICK_ELEMENT,
      { id: childTag }, 7, undefined, "call",
      { ...topState, observationRevision: 1 })).toBe("Clicked");
    expect(sends.at(-1)).toMatchObject({ type: "FRAME_TOOL_EXECUTE",
      frameId: 3, args: { id: 1 }, basis: childState });
    expect(await executeContentTool(ToolName.PRESS_KEY,
      { key: "Enter" }, 7, undefined, "press",
      { ...topState, observationRevision: 1 })).toBe("Clicked");
    expect(sends.at(-1)).toMatchObject({ type: "FRAME_TOOL_EXECUTE",
      frameId: 3, args: { key: "Enter" }, basis: childState });

    const found = await findElementAcrossFrames({ text: "Promo" }, 7);
    expect(typeof found).toBe("string");
    const foundTag = /near \[(\d+)\]/.exec(String(found))?.[1];
    expect(Number(foundTag)).toBeGreaterThanOrEqual(1_000_000);
    expect(await executeContentTool(ToolName.CLICK_ELEMENT,
      { id: Number(foundTag) }, 7)).toBe("Clicked");
    expect(sends.at(-1)).toMatchObject({ type: "FRAME_TOOL_EXECUTE",
      frameId: 3, args: { id: 2 }, basis: childState });
    expect(await executeContentTool(ToolName.EXTRACT_FORM_STATE,
      { id: childTag }, 7)).toBe("Clicked");
    expect(sends.at(-1)).toMatchObject({ type: "FRAME_TOOL_EXECUTE",
      frameId: 3, args: { id: 1 }, basis: childState });

    enabled = false;
    const topOnly = await requestPageSnapshot(7, { refresh: true });
    expect(topOnly.payload.snapshot.elements).toHaveLength(1);
    expect(frameActionRoutes.target(7, { id: childTag }, topState))
      .toEqual({ kind: "stale" });
  });
});
