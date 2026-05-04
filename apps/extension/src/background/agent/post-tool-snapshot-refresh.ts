import { DomSnapshot, MessageSource, ToolName } from "../../types";
import { waitForDomReady } from "../tab-ready";
import type { RecentAction } from "./loop-helpers";

export interface PostToolSnapshotRefreshHost {
  context: {
    addMessage(message: { role: "user"; content: string }): void;
    setSnapshot(snapshot: DomSnapshot): void;
  };
  log: {
    debug(area: string, message: string, data?: Record<string, unknown>): void;
    info(area: string, message: string, data?: Record<string, unknown>): void;
    warn(area: string, message: string, data?: Record<string, unknown>): void;
  };
  offDomainWarned: boolean;
  recordCitation(url: string, title: string, toolName: ToolName): void;
  refreshPerceptionAndTriage(tabId: number): Promise<void>;
  startingOrigin: string | null;
  toolCache: { invalidateDom(): void };
  traceRecorder?: {
    recordEvent(name: string, data?: Record<string, unknown>): void;
    recordPostToolSnapshot(data: {
      url: string;
      title: string;
      elementCount: number;
      visibleContentLength: number;
      pageContentLength: number;
      scrollY: number;
      elements: DomSnapshot["elements"];
    }): void;
  } | null;
  turnCount: number;
  updateMoneyTableAggregateFromSnapshot(): void;
  urlHistory: string[];
}

export interface PostToolSnapshotRefreshResult {
  snap: DomSnapshot | null;
  prevElementCount: number;
}

export async function refreshPostToolSnapshot(
  host: PostToolSnapshotRefreshHost,
  params: {
    tabId: number;
    prevElementCount: number;
    visuallyModified: boolean;
    recentSuccesses: RecentAction[];
  },
): Promise<PostToolSnapshotRefreshResult> {
  let { prevElementCount } = params;

  const readiness = await waitForDomReady(params.tabId, {
    timeoutMs: 150,
    waitForElements: prevElementCount > 0,
  });
  host.log.debug("agent", "DOM ready probe", {
    turn: host.turnCount,
    waitedMs: readiness.waitedMs,
    elementCount: readiness.elementCount,
  });

  let snapResponse = await chrome.tabs.sendMessage(params.tabId, {
    type: "DOM_SNAPSHOT_REQUEST",
    requestId: crypto.randomUUID(),
    source: MessageSource.BACKGROUND,
    payload: {
      refresh: true,
      autoDismiss: false,
    },
  });
  let snap = snapResponse?.payload?.snapshot as DomSnapshot | undefined;

  const noChangeAfterVisualAction =
    snap &&
    snap.elements.length > 0 &&
    snap.elements.length === prevElementCount &&
    params.visuallyModified;
  if (
    (snap && snap.elements.length === 0 && prevElementCount > 0) ||
    noChangeAfterVisualAction
  ) {
    const isEmpty = snap!.elements.length === 0;
    host.log.info(
      "agent",
      isEmpty
        ? "Empty snapshot after action, waiting for elements"
        : "No DOM change after visual action, retrying snapshot",
      {
        turn: host.turnCount,
        elements: snap!.elements.length,
        prevElements: prevElementCount,
      },
    );
    if (!isEmpty) {
      host.traceRecorder?.recordEvent("snapshot_retry_no_change", {
        turn: host.turnCount,
        elements: snap!.elements.length,
      });
    }
    await waitForDomReady(params.tabId, {
      timeoutMs: isEmpty ? 500 : 300,
      waitForElements: isEmpty,
    });
    snapResponse = await chrome.tabs.sendMessage(params.tabId, {
      type: "DOM_SNAPSHOT_REQUEST",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: {
        refresh: true,
        autoDismiss: false,
      },
    });
    snap = snapResponse?.payload?.snapshot as DomSnapshot | undefined;
  }

  if (!snap) {
    return { snap: null, prevElementCount };
  }

  host.log.info("agent", "Snapshot refreshed", {
    turn: host.turnCount,
    title: snap.title?.slice(0, 60),
    url: snap.url?.slice(0, 100),
    elements: snap.elements.length,
    durationMs: snapResponse.payload.durationMs,
  });
  prevElementCount = snap.elements.length;
  host.context.setSnapshot(snap);
  host.updateMoneyTableAggregateFromSnapshot();

  host.traceRecorder?.recordPostToolSnapshot({
    url: snap.url,
    title: snap.title || "",
    elementCount: snap.elements.length,
    visibleContentLength: snap.visibleContent?.length || 0,
    pageContentLength: snap.pageContent?.length || 0,
    scrollY: snap.scroll?.y || 0,
    elements: snap.elements,
  });

  host.toolCache.invalidateDom();

  const currentUrl = snap.url;
  if (currentUrl && !host.urlHistory.includes(currentUrl)) {
    host.urlHistory.push(currentUrl);
    params.recentSuccesses.length = 0;
  }

  if (currentUrl) {
    host.recordCitation(currentUrl, snap.title || "", ToolName.READ_PAGE);
  }

  if (host.startingOrigin && snap.url) {
    try {
      const currentOrigin = new URL(snap.url).origin;
      if (currentOrigin !== host.startingOrigin) {
        if (!host.offDomainWarned) {
          host.offDomainWarned = true;
          host.log.warn("agent", "Off-domain navigation detected", {
            turn: host.turnCount,
            startingOrigin: host.startingOrigin,
            currentUrl: snap.url,
          });
          host.context.addMessage({
            role: "user",
            content: `WARNING: You navigated away from the original page (${host.startingOrigin}). If the task should be completed on the original page, navigate back immediately. Do not search for answers on other sites — solve the task using the tools available on the original page.`,
          });
        }
      } else {
        host.offDomainWarned = false;
      }
    } catch {
      // Invalid URL, skip off-domain detection.
    }
  }

  if (params.visuallyModified) {
    await host.refreshPerceptionAndTriage(params.tabId);
  }

  return { snap, prevElementCount };
}
