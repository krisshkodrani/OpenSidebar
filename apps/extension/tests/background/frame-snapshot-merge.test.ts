import { describe, expect, test } from "vitest";
import type { DomSnapshot, TaggedElement } from "../../src/types";
import {
  FrameTagNamespace,
  mergeFrameSnapshots,
  type ChildFrameSnapshot,
} from "../../src/background/perception/frame-snapshot-merge";

function element(tag: number): TaggedElement {
  return {
    tag,
    tagName: "button",
    role: "button",
    text: `Button ${tag}`,
    attributes: {},
    rect: { x: 5, y: 10, width: 20, height: 15 },
    isVisible: true,
    isDisabled: false,
  };
}

function snapshot(tags: number[], title = "Page"): DomSnapshot {
  return {
    title,
    url: `https://example.com/${title}`,
    elements: tags.map(element),
    viewport: { width: 800, height: 600 },
    scroll: { x: 0, y: 100, maxY: 1000, viewportHeight: 600 },
  };
}

function frame(frameId: number, tags: number[]): ChildFrameSnapshot {
  return {
    frameId,
    rect: { x: 40, y: 60, width: 300, height: 200 },
    visible: true,
    snapshot: { ...snapshot(tags, `Child ${frameId}`), pageContent: "Checkout form" },
  };
}

describe("frame snapshot merge", () => {
  test("namespaces same local tags and routes them to their owning frames", () => {
    const namespace = new FrameTagNamespace();
    const top = snapshot([1]);
    const first = mergeFrameSnapshots(top, [frame(7, [1]), frame(9, [1])], namespace);
    const tags = first.snapshot.elements.map((item) => item.tag);
    expect(new Set(tags).size).toBe(3);
    expect(namespace.route(tags[0])).toEqual({ frameId: 0, localTag: 1 });
    expect(namespace.route(tags[1])).toEqual({ frameId: 7, localTag: 1 });
    expect(namespace.route(tags[2])).toEqual({ frameId: 9, localTag: 1 });
    expect(first.snapshot.elements[1].rect).toMatchObject({ x: 45, y: 70, pageY: 170 });
    expect(first.snapshot.pageContent).toContain("Frame: Child 7");

    const refreshed = mergeFrameSnapshots(top, [frame(7, [1]), frame(9, [1])], namespace);
    expect(refreshed.snapshot.elements.map((item) => item.tag)).toEqual(tags);
    mergeFrameSnapshots(top, [], namespace);
    expect(namespace.route(tags[1])).toBeUndefined();
  });

  test("skips hidden frames and bounds each visible frame to 200 elements", () => {
    const namespace = new FrameTagNamespace();
    const hidden = { ...frame(3, [1]), visible: false };
    const zeroSize = { ...frame(4, [1]), rect: { x: 0, y: 0, width: 0, height: 20 } };
    const result = mergeFrameSnapshots(
      snapshot([1]),
      [hidden, zeroSize, frame(5, Array.from({ length: 250 }, (_, i) => i + 1))],
      namespace,
    );
    expect(result.skippedFrameIds).toEqual([3, 4]);
    expect(result.snapshot.elements).toHaveLength(201);
    expect(result.snapshot.overflow).toMatchObject({ shown: 201, total: 251 });
    expect(namespace.route(result.snapshot.elements.at(-1)!.tag)).toEqual({
      frameId: 5, localTag: 200,
    });
  });

  test("reserves space for frames under the 1000-element snapshot cap", () => {
    const namespace = new FrameTagNamespace();
    const top = snapshot(Array.from({ length: 1_000 }, (_, i) => i + 1));
    const result = mergeFrameSnapshots(top, [frame(5, [1, 2])], namespace);
    expect(result.snapshot.elements).toHaveLength(802);
    expect(result.snapshot.overflow).toMatchObject({ shown: 802, total: 1002 });
    expect(namespace.route(999)).toBeUndefined();
    expect(namespace.route(result.snapshot.elements.at(-1)!.tag)).toEqual({
      frameId: 5, localTag: 2,
    });
  });

  test("bounds text collected from many child frames", () => {
    const children = Array.from({ length: 12 }, (_, index) => ({
      ...frame(index + 1, []),
      snapshot: {
        ...snapshot([], `Child ${index + 1}`),
        pageContent: "x".repeat(3_000),
      },
    }));
    const result = mergeFrameSnapshots(snapshot([]), children, new FrameTagNamespace());
    expect(result.snapshot.pageContent!.length).toBeLessThanOrEqual(8_000);
  });
});
