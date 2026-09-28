import { describe, expect, test } from "vitest";
import type { DomSnapshot, PageDocumentState } from "../../src/types";
import { FrameActionRoutes } from "../../src/background/perception/frame-action-routes";

const state = (url: string, epoch = 1): PageDocumentState => ({
  documentInstanceId: url,
  mutationEpoch: epoch,
  url,
  viewport: { width: 800, height: 600 },
  scroll: { x: 0, y: 0 },
});

const snapshot = (url: string): DomSnapshot => ({
  title: "Checkout", url,
  viewport: { width: 800, height: 600 },
  scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 600 },
  elements: [{ tag: 1, tagName: "button", role: "button", text: "Continue",
    attributes: {}, rect: { x: 0, y: 0, width: 40, height: 20 },
    isVisible: true, isDisabled: false }],
});

describe("frame action routes", () => {
  test("routes duplicate tags to their observed frame and rejects stale bases", () => {
    const routes = new FrameActionRoutes();
    const topState = state("https://a.test/");
    const childState = state("https://b.test/");
    const merged = routes.publish(9, snapshot(topState.url), topState, [{
      frameId: 4, rect: { x: 20, y: 30, width: 200, height: 100 },
      visible: true, snapshot: snapshot(childState.url), documentState: childState,
    }]);
    const childTag = merged.snapshot.elements[1].tag;
    expect(routes.route(9, 1, topState)).toMatchObject({ frameId: 0, localTag: 1 });
    expect(routes.route(9, childTag, topState)).toEqual({
      frameId: 4, localTag: 1, documentState: childState,
    });
    expect(routes.target(9, { id: childTag, text: "hello" }, topState))
      .toEqual({ kind: "child", frameId: 4, args: { id: 1, text: "hello" },
        documentState: childState });
    expect(routes.target(9, { sourceId: childTag, targetId: 1 }, topState))
      .toEqual({ kind: "stale" });
    expect(routes.assignFoundTag(9, 4, 2, state(childState.url, 2)))
      .toBeNull();
    expect(routes.assignFoundTag(9, 4, 2, childState))
      .toBeGreaterThanOrEqual(1_000_000);
    routes.rememberKeyboardFrame(9, 4);
    expect(routes.keyboardTarget(9, { key: "Enter" }, topState)).toEqual({
      kind: "child", frameId: 4, args: { key: "Enter" },
      documentState: childState,
    });
    expect(routes.route(9, childTag, state(topState.url, 2))).toBeNull();
    expect(routes.target(9, { id: childTag }, state(topState.url, 2)))
      .toEqual({ kind: "stale" });
    routes.invalidate(9);
    expect(routes.route(9, childTag, topState)).toBeNull();
    expect(routes.keyboardTarget(9, { key: "Enter" }, topState))
      .toEqual({ kind: "top" });
  });

  test("a new snapshot removes child routes when its frame disappears", () => {
    const routes = new FrameActionRoutes();
    const topState = state("https://a.test/");
    const child = { frameId: 4, rect: { x: 20, y: 30, width: 200, height: 100 },
      visible: true, snapshot: snapshot("https://b.test/"),
      documentState: state("https://b.test/") };
    const first = routes.publish(9, snapshot(topState.url), topState, [child]);
    const childTag = first.snapshot.elements[1].tag;
    routes.publish(9, snapshot(topState.url), topState, []);
    expect(routes.route(9, childTag, topState)).toBeNull();
  });

  test("child tags remain bound to their frame when read order changes", () => {
    const routes = new FrameActionRoutes();
    const top = state("https://a.test/");
    const child = (frameId: number) => ({ frameId,
      rect: { x: frameId * 10, y: 30, width: 200, height: 100 },
      visible: true, snapshot: snapshot(`https://child${frameId}.test/`),
      documentState: state(`https://child${frameId}.test/`) });
    routes.beginRead(9);
    const first = routes.publish(9, snapshot(top.url), top,
      [child(4), child(5)]).snapshot.elements;
    const firstTags = first.slice(1).map((element) => element.tag);
    routes.beginRead(9);
    const second = routes.publish(9, snapshot(top.url), top,
      [child(5), child(4)]).snapshot.elements;
    expect(second.slice(1).map((element) => element.tag))
      .toEqual([firstTags[1], firstTags[0]]);
    expect(routes.route(9, firstTags[0], top)?.frameId).toBe(4);
  });

  test("does not expose child tags without an action observation basis", () => {
    const routes = new FrameActionRoutes();
    const topState = state("https://a.test/");
    const result = routes.publish(9, snapshot(topState.url), topState, [{
      frameId: 4, rect: { x: 20, y: 30, width: 200, height: 100 },
      visible: true, snapshot: snapshot("https://b.test/"),
    }]);
    expect(result.snapshot.elements).toHaveLength(1);
    expect(result.skippedFrameIds).toEqual([4]);
  });

  test("navigation and newer reads invalidate in-flight collection generations", () => {
    const routes = new FrameActionRoutes();
    const first = routes.beginRead(9);
    expect(routes.isCurrentRead(9, first)).toBe(true);
    const second = routes.beginRead(9);
    expect(routes.isCurrentRead(9, first)).toBe(false);
    expect(routes.isCurrentRead(9, second)).toBe(true);
    routes.invalidate(9);
    expect(routes.isCurrentRead(9, second)).toBe(false);
  });
});
