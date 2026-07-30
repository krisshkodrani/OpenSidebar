import { beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { perceptionWarmup } from "../../src/background/perception-warmup";
import { clearTabReady } from "../../src/background/tab-ready";

const TAB_ID = 8_701;

describe("perception warmup safety", () => {
  beforeEach(() => {
    clearTabReady(TAB_ID);
    perceptionWarmup.invalidate(TAB_ID);
    (chrome.scripting as any).executeScript = vi.fn(() => Promise.resolve());
    (chrome.tabs as any).get = vi.fn(() =>
      Promise.resolve({ id: TAB_ID, active: false, windowId: 1 }),
    );
  });

  test("takes a non-destructive snapshot without page actions", async () => {
    (chrome.tabs as any).sendMessage = vi.fn(
      async (_tabId: number, message: any) => {
        if (message.type === "DOM_READY_PROBE") {
          return { payload: { waitedMs: 0, elementCount: 1 } };
        }
        if (message.type === "DOM_SNAPSHOT_REQUEST") {
          return {
            payload: {
              snapshot: {
                title: "Play Console",
                url: "https://play.google.com/console/",
                elements: [],
                viewport: { width: 1024, height: 768 },
                scroll: { x: 0, y: 420, maxY: 1200, viewportHeight: 768 },
              },
            },
          };
        }
        throw new Error(`Unexpected message: ${message.type}`);
      },
    );

    await perceptionWarmup.warmup(TAB_ID);

    const messages = (chrome.tabs.sendMessage as any).mock.calls.map(
      ([, message]: [number, any]) => message,
    );
    const snapshotRequest = messages.find(
      (message: any) => message.type === "DOM_SNAPSHOT_REQUEST",
    );

    expect(snapshotRequest.payload).toEqual({
      refresh: true,
      autoDismiss: false,
    });
    expect(
      messages.some((message: any) => message.type === "TOOL_EXECUTE"),
    ).toBe(false);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});
