import type { DomSnapshot, PageDocumentState } from "../../types";
import {
  FrameTagNamespace,
  CHILD_FRAME_TAG_BASE,
  mergeFrameSnapshots,
  type ChildFrameSnapshot,
} from "./frame-snapshot-merge";

interface TabRoutes {
  namespace: FrameTagNamespace;
  topState: PageDocumentState;
  childStates: Map<number, PageDocumentState>;
}

export interface FrameActionRoute {
  frameId: number;
  localTag: number;
  documentState: PageDocumentState;
}

export type FrameToolTarget =
  | { kind: "top" }
  | { kind: "stale" }
  | { kind: "child"; frameId: number; args: Record<string, unknown>;
      documentState: PageDocumentState };

const TAG_KEYS = ["id", "sourceId", "targetId"] as const;

/** Frame IDs and child document identities stay in background runtime memory. */
export class FrameActionRoutes {
  private readonly tabs = new Map<number, TabRoutes>();
  private readonly namespaces = new Map<number, FrameTagNamespace>();
  private readonly generations = new Map<number, number>();
  private readonly keyboardFrames = new Map<number, number>();

  beginRead(tabId: number): number {
    this.tabs.delete(tabId);
    this.generations.set(tabId, (this.generations.get(tabId) ?? 0) + 1);
    return this.generations.get(tabId)!;
  }

  isCurrentRead(tabId: number, generation: number): boolean {
    return this.generations.get(tabId) === generation;
  }

  publish(
    tabId: number,
    top: DomSnapshot,
    topState: PageDocumentState,
    children: ChildFrameSnapshot[],
  ): { snapshot: DomSnapshot; skippedFrameIds: number[] } {
    const namespace = this.namespaces.get(tabId) ?? new FrameTagNamespace();
    this.namespaces.set(tabId, namespace);
    const withIdentity = children.filter((child) => child.documentState);
    const routable = withIdentity.filter((child) =>
      child.visible && child.rect.width > 0 && child.rect.height > 0);
    const merged = mergeFrameSnapshots(top, withIdentity, namespace);
    const childStates = new Map(routable
      .map((child) => [child.frameId, child.documentState!]));
    this.tabs.set(tabId, { namespace, topState, childStates });
    return { snapshot: merged.snapshot, skippedFrameIds: [
      ...merged.skippedFrameIds,
      ...children.filter((child) => !child.documentState).map((child) => child.frameId),
    ] };
  }

  route(
    tabId: number,
    tag: number,
    observedTopState?: PageDocumentState,
  ): FrameActionRoute | null {
    const entry = this.tabs.get(tabId);
    if (!entry || (observedTopState &&
        !sameDocumentState(entry.topState, observedTopState))) return null;
    const owner = entry.namespace.route(tag);
    if (!owner) return null;
    const documentState = owner.frameId === 0
      ? entry.topState : entry.childStates.get(owner.frameId);
    return documentState ? { ...owner, documentState } : null;
  }

  target(
    tabId: number,
    args: Record<string, unknown>,
    observedTopState?: PageDocumentState,
  ): FrameToolTarget {
    const tags = TAG_KEYS.filter((key) => typeof args[key] === "number")
      .map((key) => ({ key, tag: args[key] as number }));
    const childTags = tags.filter(({ tag }) => tag >= CHILD_FRAME_TAG_BASE);
    if (childTags.length === 0) return { kind: "top" };
    const routes = childTags.map(({ tag }) =>
      this.route(tabId, tag, observedTopState));
    if (routes.some((route) => !route || route.frameId === 0) ||
        tags.length !== childTags.length ||
        routes.some((route) => route?.frameId !== routes[0]?.frameId))
      return { kind: "stale" };
    const first = routes[0]!;
    const localArgs = { ...args };
    childTags.forEach(({ key }, index) => { localArgs[key] = routes[index]!.localTag; });
    return { kind: "child", frameId: first.frameId,
      args: localArgs, documentState: first.documentState };
  }

  rememberKeyboardFrame(tabId: number, frameId: number): void {
    this.keyboardFrames.set(tabId, frameId);
  }

  childTargets(tabId: number): { frameId: number;
    documentState: PageDocumentState }[] {
    return [...(this.tabs.get(tabId)?.childStates ?? [])]
      .map(([frameId, documentState]) => ({ frameId, documentState }));
  }

  assignFoundTag(tabId: number, frameId: number, localTag: number,
    observedChildState: PageDocumentState): number | null {
    const entry = this.tabs.get(tabId);
    const currentState = entry?.childStates.get(frameId);
    if (!entry || !currentState ||
        !sameDocumentState(currentState, observedChildState))
      return null;
    return entry.namespace.assign(frameId, localTag);
  }

  keyboardTarget(
    tabId: number,
    args: Record<string, unknown>,
    observedTopState?: PageDocumentState,
  ): FrameToolTarget {
    const frameId = this.keyboardFrames.get(tabId);
    if (!frameId) return { kind: "top" };
    const entry = this.tabs.get(tabId);
    if (!entry || (observedTopState &&
        !sameDocumentState(entry.topState, observedTopState)))
      return { kind: "stale" };
    const documentState = entry.childStates.get(frameId);
    return documentState
      ? { kind: "child", frameId, args, documentState }
      : { kind: "stale" };
  }

  invalidate(tabId: number): void {
    this.tabs.delete(tabId);
    this.namespaces.delete(tabId);
    this.generations.set(tabId, (this.generations.get(tabId) ?? 0) + 1);
    this.keyboardFrames.delete(tabId);
  }
}

function sameDocumentState(a: PageDocumentState, b: PageDocumentState): boolean {
  return a.documentInstanceId === b.documentInstanceId &&
    a.mutationEpoch === b.mutationEpoch && a.url === b.url;
}

export const frameActionRoutes = new FrameActionRoutes();
