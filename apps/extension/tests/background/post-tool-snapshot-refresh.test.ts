import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  refreshPostToolSnapshot,
  type PostToolSnapshotRefreshHost,
} from "../../src/background/agent/post-tool-snapshot-refresh";

const { waitForDomReadyMock } = vi.hoisted(() => ({
  waitForDomReadyMock: vi.fn(async () => ({
    waitedMs: 5,
    elementCount: 2,
  })),
}));

vi.mock("../../src/background/tab-ready", () => ({
  waitForDomReady: waitForDomReadyMock,
}));

const snapshot = {
  url: "https://example.test/next",
  title: "Next page",
  elements: [{ tag: 1, tagName: "button", text: "Go" }],
  visibleContent: "visible",
  pageContent: "page content",
  scroll: { y: 12 },
};

function createHost(): PostToolSnapshotRefreshHost {
  return {
    context: {
      addMessage: vi.fn(),
      setSnapshot: vi.fn(),
    },
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
    offDomainWarned: false,
    recordCitation: vi.fn(),
    refreshPerceptionAndTriage: vi.fn(),
    startingOrigin: "https://example.test",
    toolCache: {
      invalidateDom: vi.fn(),
    },
    traceRecorder: {
      recordEvent: vi.fn(),
      recordPostToolSnapshot: vi.fn(),
    },
    turnCount: 2,
    updateMoneyTableAggregateFromSnapshot: vi.fn(),
    urlHistory: ["https://example.test/start"],
  } as unknown as PostToolSnapshotRefreshHost;
}

describe("refreshPostToolSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).chrome = {
      tabs: {
        sendMessage: vi.fn(async () => ({
          payload: {
            snapshot,
            durationMs: 14,
          },
        })),
      },
    };
  });

  test("refreshes snapshot state and records post-tool trace data", async () => {
    const host = createHost();
    const recentSuccesses = [
      {
        tool: "read_page",
        args: "{}",
        result: "old",
        snapshotFingerprint: "old",
      },
    ];

    const result = await refreshPostToolSnapshot(host, {
      tabId: 7,
      prevElementCount: 1,
      visuallyModified: true,
      recentSuccesses,
    });

    expect(result.snap).toBe(snapshot);
    expect(result.prevElementCount).toBe(1);
    expect(host.context.setSnapshot).toHaveBeenCalledWith(snapshot);
    expect(host.updateMoneyTableAggregateFromSnapshot).toHaveBeenCalled();
    expect(host.toolCache.invalidateDom).toHaveBeenCalled();
    expect(host.recordCitation).toHaveBeenCalledWith(
      "https://example.test/next",
      "Next page",
      "read_page",
    );
    expect(host.traceRecorder?.recordPostToolSnapshot).toHaveBeenCalledWith({
      url: "https://example.test/next",
      title: "Next page",
      elementCount: 1,
      visibleContentLength: 7,
      pageContentLength: 12,
      scrollY: 12,
      elements: snapshot.elements,
    });
    expect(host.refreshPerceptionAndTriage).toHaveBeenCalledWith(7);
    expect(recentSuccesses).toEqual([]);
  });
});
