import type { ContextManager } from "../context";
import { withPresenceSuspended } from "../capture-guard";
import type { RegionZoomHost } from "../region-zoom";
import type { TraceRecorder } from "../trace";
import { waitForDomReady } from "../../infrastructure/tab-ready";
import { pageDocumentStatesMatch } from "./coordinator";
import type { ObservationBasis } from "./types";

export interface RegionZoomLoopHost {
  readonly turnCount: number;
  readonly useVLExecutor: boolean;
  readonly enforcePageStateConsistency: boolean;
  readonly context: ContextManager;
  readonly traceRecorder: TraceRecorder | null;
  imagePromptBudgetAllows(count: number): boolean;
  recordImagePromptBudgetExhausted(count: number, source: string): void;
  captureVisibleTabWithRetry(
    windowId: number | undefined,
    options: { format?: "jpeg" | "png"; quality?: number },
  ): Promise<string>;
}

export function createRegionZoomHost(
  host: RegionZoomLoopHost,
  tabId: number,
  observationBasis: ObservationBasis | null,
): RegionZoomHost {
  return {
    turnCount: host.turnCount,
    useVLExecutor: host.useVLExecutor,
    getSnapshot: () => host.context.getSnapshot(),
    imagePromptBudgetAllows: (count) => host.imagePromptBudgetAllows(count),
    recordImagePromptBudgetExhausted: (count, source) =>
      host.recordImagePromptBudgetExhausted(count, source),
    observationIsCurrent: async () => {
      if (!host.enforcePageStateConsistency || !observationBasis) return true;
      const live = (await waitForDomReady(tabId, { timeoutMs: 50 })).documentState;
      return Boolean(
        live &&
          pageDocumentStatesMatch(observationBasis, live, {
            requireGeometryMatch: true,
          }),
      );
    },
    captureVisibleTab: async (options) =>
      withPresenceSuspended(tabId, async () => {
        const tab = await chrome.tabs.get(tabId);
        return host.captureVisibleTabWithRetry(tab.windowId, options);
      }),
    resolveTagRect: async (id) => {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (tagId: number) => {
            const element = document.querySelector(`[data-os-tag="${tagId}"]`);
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          },
          args: [id],
        });
        if (results?.[0]?.result) return results[0].result;
      } catch {
        // Fall through to the accepted snapshot rect.
      }
      const element = host.context
        .getSnapshot()
        ?.elements.find((candidate) => candidate.tag === id);
      return element
        ? {
            x: element.rect.x,
            y: element.rect.y,
            width: element.rect.width,
            height: element.rect.height,
          }
        : null;
    },
    recordInspectRegionEvent: (data) =>
      host.traceRecorder?.recordEvent("inspect_region", data),
    setRegionZoomForExecutor: (zoom) =>
      host.context.setRegionZoomForExecutor(zoom),
  };
}
