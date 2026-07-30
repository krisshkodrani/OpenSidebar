import { describe, expect, test, vi } from "vitest";
import "../setup";
import type { BrowserPagePort, ContentBridgePort } from "../../src/background/environment";
import {
  isTabActive,
  takeScreenshotWithTags,
} from "../../src/background/tools/screenshot";
import {
  clearTabReady,
  ensureContentScript,
  waitForDomReady,
} from "../../src/background/tab-ready";

function pagePort(overrides: Partial<BrowserPagePort>): BrowserPagePort {
  return {
    getTab: vi.fn(),
    queryTabs: vi.fn(),
    updateTab: vi.fn(),
    createTab: vi.fn(),
    removeTab: vi.fn(),
    reloadTab: vi.fn(),
    captureVisibleTab: vi.fn(),
    ...overrides,
  } as BrowserPagePort;
}

function bridgePort(overrides: Partial<ContentBridgePort>): ContentBridgePort {
  return {
    sendMessage: vi.fn(),
    executeContentScripts: vi.fn(),
    getContentScriptFiles: vi.fn(() => []),
    onContentScriptReady: vi.fn(() => () => {}),
    onTabRemoved: vi.fn(() => () => {}),
    onBeforeNavigate: vi.fn(() => () => {}),
    ...overrides,
  } as ContentBridgePort;
}

describe("background environment ports", () => {
  test("screenshots use the injected page port", async () => {
    const port = pagePort({
      getTab: vi.fn(async () => ({
        id: 77,
        active: true,
        windowId: 5,
        url: "https://example.com",
      })),
      captureVisibleTab: vi.fn(async () => "data:image/jpeg;base64,ok"),
    });

    await expect(isTabActive(77, port)).resolves.toBe(true);
    await expect(takeScreenshotWithTags(77, undefined, port)).resolves.toEqual({
      dataUrl: "data:image/jpeg;base64,ok",
      success: true,
    });

    expect(port.getTab).toHaveBeenCalledWith(77);
    expect(port.captureVisibleTab).toHaveBeenCalledWith(5, {
      format: "jpeg",
      quality: 80,
    });
  });

  test("screenshots reject inactive tabs before capture", async () => {
    const port = pagePort({
      getTab: vi.fn(async () => ({
        id: 78,
        active: false,
        windowId: 5,
        url: "https://example.com",
      })),
      captureVisibleTab: vi.fn(async () => "data:image/jpeg;base64,wrong"),
    });

    const result = await takeScreenshotWithTags(78, undefined, port);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Tab is not active");
    expect(port.captureVisibleTab).not.toHaveBeenCalled();
  });

  test("screenshots fail cleanly when the tab has no window handle", async () => {
    const port = pagePort({
      getTab: vi.fn(async () => ({
        id: 79,
        active: true,
        url: "https://example.com",
      })),
      captureVisibleTab: vi.fn(async () => "data:image/jpeg;base64,wrong"),
    });

    const result = await takeScreenshotWithTags(79, undefined, port);

    expect(result).toEqual({
      dataUrl: "",
      success: false,
      error: "Tab window is unavailable",
    });
    expect(port.captureVisibleTab).not.toHaveBeenCalled();
  });

  test("content readiness reuses a responsive injected bridge port", async () => {
    const port = bridgePort({
      getContentScriptFiles: vi.fn(() => ["content.js"]),
      executeContentScripts: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => ({
        payload: { waitedMs: 12, elementCount: 3 },
      })),
    });
    clearTabReady(901);

    await expect(ensureContentScript(901, 20, port)).resolves.toBe(true);
    await expect(
      waitForDomReady(901, { timeoutMs: 25, waitForElements: true }, port),
    ).resolves.toEqual({ waitedMs: 12, elementCount: 3 });

    expect(port.executeContentScripts).not.toHaveBeenCalled();
    expect(port.sendMessage).toHaveBeenCalled();
  });
});
