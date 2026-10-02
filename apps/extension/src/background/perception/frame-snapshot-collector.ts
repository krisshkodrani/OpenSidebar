import { MessageSource, type FrameSnapshotResponse } from "../../types";
import type { ChildFrameSnapshot } from "./frame-snapshot-merge";
import { expectFrameGeometry, type FrameGeometry } from "./frame-geometry-registry";

const FRAME_COLLECTION_TIMEOUT_MS = 150;

function origin(url: string): string | null {
  try { return new URL(url).origin; } catch { return null; }
}

function within<T>(work: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  if (timeoutMs <= 0) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

interface FramePart {
  frameId: number;
  parentFrameId: number;
  geometry: FrameGeometry;
  response: FrameSnapshotResponse;
}

/** Reads frame geometry along every ancestry path, then returns cross-origin contributions. */
export async function collectCrossOriginFrameSnapshots(
  tabId: number,
  timeoutMs = FRAME_COLLECTION_TIMEOUT_MS,
  expectedTopUrl?: string,
): Promise<{ children: ChildFrameSnapshot[]; missingFrameIds: number[];
  collectionUnavailable?: true }> {
  const deadline = performance.now() + timeoutMs;
  const frames = await within(
    chrome.webNavigation.getAllFrames({ tabId }), timeoutMs, null,
  );
  const top = frames?.find((frame) => frame.frameId === 0);
  if (!frames || !top || (expectedTopUrl && top.url !== expectedTopUrl))
    return { children: [], missingFrameIds: [], collectionUnavailable: true };
  const byId = new Map(frames.map((frame) => [frame.frameId, frame]));
  const candidates = frames.filter((frame) => frame.frameId !== 0 &&
    byId.has(frame.parentFrameId));
  const crossOrigin = new Set(candidates.filter((frame) => {
    const parent = byId.get(frame.parentFrameId);
    const childOrigin = origin(frame.url);
    const parentOrigin = parent && origin(parent.url);
    return Boolean(childOrigin && parentOrigin && childOrigin !== parentOrigin);
  }).map((frame) => frame.frameId));
  const parts = await Promise.all(candidates.map(async (frame): Promise<FramePart | null> => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return null;
    const geometry = expectFrameGeometry(tabId, frame.parentFrameId, remaining);
    const requestId = crypto.randomUUID();
    const response = within(
      chrome.tabs.sendMessage(tabId, {
        type: "FRAME_SNAPSHOT_REQUEST",
        requestId,
        source: MessageSource.BACKGROUND,
        payload: { refresh: true, geometryNonce: geometry.nonce },
      }, { frameId: frame.frameId }) as Promise<FrameSnapshotResponse>,
      remaining, null,
    );
    const [snapshot, rect] = await Promise.all([response, geometry.result]);
    if (snapshot?.type !== "FRAME_SNAPSHOT_RESPONSE" ||
        snapshot.requestId !== requestId ||
        snapshot.payload.snapshot.url !== frame.url ||
        snapshot.payload.documentState.url !== frame.url || !rect) return null;
    return { frameId: frame.frameId, parentFrameId: frame.parentFrameId,
      geometry: rect, response: snapshot };
  }));

  const resolved = new Map(parts.filter((part): part is FramePart => part !== null)
    .map((part) => [part.frameId, part]));
  const absolute = (part: FramePart, seen = new Set<number>()): ChildFrameSnapshot | null => {
    if (seen.has(part.frameId)) return null;
    seen.add(part.frameId);
    const parent = part.parentFrameId === 0 ? null : resolved.get(part.parentFrameId);
    if (part.parentFrameId !== 0 && !parent) return null;
    const parentSnapshot = parent ? absolute(parent, seen) : null;
    if (parent && !parentSnapshot) return null;
    return {
      frameId: part.frameId,
      rect: {
        ...part.geometry.rect,
        x: (parentSnapshot?.rect.x ?? 0) + part.geometry.rect.x,
        y: (parentSnapshot?.rect.y ?? 0) + part.geometry.rect.y,
      },
      visible: part.geometry.visible && (parentSnapshot?.visible ?? true),
      snapshot: part.response.payload.snapshot,
      documentState: part.response.payload.documentState,
    };
  };
  const children: ChildFrameSnapshot[] = [];
  const missingFrameIds: number[] = [];
  for (const [index, frame] of candidates.entries()) {
    if (!crossOrigin.has(frame.frameId)) continue;
    const part = parts[index];
    const child = part && absolute(part);
    if (child) children.push(child);
    else missingFrameIds.push(frame.frameId);
  }
  return { children, missingFrameIds };
}
