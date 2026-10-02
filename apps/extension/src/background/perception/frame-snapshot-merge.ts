import type { DomSnapshot, ElementRect, PageDocumentState, TaggedElement } from "../../types";

const MAX_ELEMENTS = 1_000;
const MAX_ELEMENTS_PER_FRAME = 200;
const MAX_FRAME_RESERVATION = 600;
const MAX_FRAME_TEXT = 2_000;
const MAX_FRAME_TEXT_TOTAL = 8_000;
export const CHILD_FRAME_TAG_BASE = 1_000_000;

export interface ChildFrameSnapshot {
  frameId: number;
  /** The frame's viewport rectangle in top-frame viewport coordinates. */
  rect: ElementRect;
  visible: boolean;
  snapshot: DomSnapshot;
  /** Runtime-only identity for actions against this child observation. */
  documentState?: PageDocumentState;
}

export interface FrameTagRoute {
  frameId: number;
  localTag: number;
}

/** Frame IDs and local tags stay in this runtime-only map, outside trajectories. */
export class FrameTagNamespace {
  private readonly ids = new Map<string, number>();
  private routes = new Map<number, FrameTagRoute>();
  private nextId = CHILD_FRAME_TAG_BASE;

  begin(topTags: Iterable<number>): void {
    this.routes = new Map();
    for (const tag of topTags) this.routes.set(tag, { frameId: 0, localTag: tag });
  }

  assign(frameId: number, localTag: number): number {
    const key = `${frameId}:${localTag}`;
    let id = this.ids.get(key);
    if (id !== undefined && this.routes.get(id)?.frameId === frameId &&
        this.routes.get(id)?.localTag === localTag) return id;
    if (id === undefined || this.routes.has(id)) {
      do { id = this.nextId++; } while (this.routes.has(id));
      this.ids.set(key, id);
    }
    this.routes.set(id, { frameId, localTag });
    return id;
  }

  route(tag: number): FrameTagRoute | undefined {
    return this.routes.get(tag);
  }

  finish(): void {
    for (const [key, id] of this.ids) {
      if (!this.routes.has(id)) this.ids.delete(key);
    }
  }
}

function visibleFrame(frame: ChildFrameSnapshot): boolean {
  return frame.visible && frame.frameId > 0 &&
    frame.rect.width > 0 && frame.rect.height > 0;
}

function placeElement(
  element: TaggedElement,
  frame: ChildFrameSnapshot,
  tag: number,
  topScrollY: number,
): TaggedElement {
  const rect = {
    ...element.rect,
    x: frame.rect.x + element.rect.x,
    y: frame.rect.y + element.rect.y,
    pageY: topScrollY + frame.rect.y + element.rect.y,
  };
  const overlapsFrame = element.rect.x + element.rect.width > 0 &&
    element.rect.y + element.rect.height > 0 &&
    element.rect.x < frame.rect.width &&
    element.rect.y < frame.rect.height;
  return { ...element, tag, rect, isVisible: element.isVisible && overlapsFrame };
}

export function mergeFrameSnapshots(
  top: DomSnapshot,
  children: ChildFrameSnapshot[],
  namespace: FrameTagNamespace,
): { snapshot: DomSnapshot; skippedFrameIds: number[] } {
  const usable = children.filter(visibleFrame);
  const topLimit = MAX_ELEMENTS - Math.min(
    MAX_FRAME_RESERVATION, usable.length * MAX_ELEMENTS_PER_FRAME,
  );
  const elements = top.elements.slice(0, topLimit);
  namespace.begin(elements.map((element) => element.tag));
  const skippedFrameIds: number[] = children
    .filter((frame) => !visibleFrame(frame))
    .map((frame) => frame.frameId);
  const frameTexts: string[] = [];
  let remainingFrameText = MAX_FRAME_TEXT_TOTAL;

  for (const frame of usable) {
    if (elements.length >= MAX_ELEMENTS) {
      skippedFrameIds.push(frame.frameId);
      continue;
    }
    const contribution = frame.snapshot.elements.slice(
      0, Math.min(MAX_ELEMENTS_PER_FRAME, MAX_ELEMENTS - elements.length),
    );
    for (const element of contribution) {
      const tag = namespace.assign(frame.frameId, element.tag);
      elements.push(placeElement(element, frame, tag, top.scroll.y));
    }
    if (remainingFrameText > 0) {
      const heading = `Frame: ${frame.snapshot.title} (${frame.snapshot.url})\n`;
      const separatorLength = frameTexts.length > 0 ? 2 : 0;
      const limit = Math.max(0, Math.min(
        MAX_FRAME_TEXT, remainingFrameText - heading.length - separatorLength,
      ));
      const text = (frame.snapshot.pageContent ?? frame.snapshot.visibleContent ?? "")
        .slice(0, limit)
        .trim();
      if (text) {
        const section = `${heading}${text}`;
        frameTexts.push(section);
        remainingFrameText -= section.length + separatorLength;
      }
    }
  }

  const total = (top.overflow?.total ?? top.elements.length) +
    usable.reduce((sum, frame) =>
      sum + (frame.snapshot.overflow?.total ?? frame.snapshot.elements.length), 0);
  const snapshot: DomSnapshot = {
    ...top,
    elements,
    ...(frameTexts.length ? {
      pageContent: [top.pageContent, ...frameTexts].filter(Boolean).join("\n\n"),
    } : {}),
    ...(total > elements.length || top.overflow ? {
      overflow: {
        shown: elements.length,
        total,
        ...(top.overflow?.collapsedGroups ? {
          collapsedGroups: top.overflow.collapsedGroups,
        } : {}),
      },
    } : {}),
  };
  namespace.finish();
  return { snapshot, skippedFrameIds };
}
