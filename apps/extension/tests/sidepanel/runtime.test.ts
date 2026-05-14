import { afterEach, describe, expect, test, vi } from "vitest";
import "../setup";
import {
  E2E_DETACHED_PANEL_TARGET_TAB_PARAM,
  E2E_DETACHED_PANEL_WORKSPACE_PARAM,
  chromeUiRuntimePort,
  getE2EDetachedPanelConfig,
  getE2EPanelConfig,
  setUiRuntimePortForTesting,
  type UiRuntimePort,
} from "../../src/sidepanel/runtime";
import { MessageSource } from "../../src/types";

describe("sidepanel runtime detached E2E panel config", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    document.getElementById("opensidebar-overlay-config")?.remove();
    vi.restoreAllMocks();
  });

  test("returns null when detached E2E params are absent", () => {
    window.history.replaceState(null, "", "/src/sidepanel/index.html");

    expect(getE2EDetachedPanelConfig()).toBeNull();
  });

  test("parses target tab and workspace params", () => {
    const params = new URLSearchParams({
      [E2E_DETACHED_PANEL_TARGET_TAB_PARAM]: "42",
      [E2E_DETACHED_PANEL_WORKSPACE_PARAM]: "e2e-workspace",
    });
    window.history.replaceState(
      null,
      "",
      `/src/sidepanel/index.html?${params.toString()}`,
    );

    expect(getE2EDetachedPanelConfig()).toEqual({
      targetTabId: 42,
      workspaceId: "e2e-workspace",
    });
  });

  test("uses detached target tab instead of the active extension page", async () => {
    const params = new URLSearchParams({
      [E2E_DETACHED_PANEL_TARGET_TAB_PARAM]: "42",
    });
    window.history.replaceState(
      null,
      "",
      `/src/sidepanel/index.html?${params.toString()}`,
    );
    const getTab = vi
      .spyOn(chrome.tabs, "get")
      .mockResolvedValue({
        id: 42,
        url: "http://127.0.0.1:3333/shop",
        title: "Shop",
        active: true,
        windowId: 7,
      } as chrome.tabs.Tab);
    const queryTabs = vi.spyOn(chrome.tabs, "query");

    await expect(chromeUiRuntimePort.getActiveTab()).resolves.toEqual({
      id: 42,
      url: "http://127.0.0.1:3333/shop",
      title: "Shop",
      active: true,
      windowId: 7,
    });
    expect(getTab).toHaveBeenCalledWith(42);
    expect(queryTabs).not.toHaveBeenCalled();
  });

  test("prefers runtime-provided E2E panel config for overlay hosts", () => {
    const restore = setUiRuntimePortForTesting({
      source: MessageSource.UI,
      e2ePanelConfig: { targetTabId: 11, workspaceId: "e2e-overlay" },
    } as UiRuntimePort);

    try {
      expect(getE2EPanelConfig()).toEqual({
        targetTabId: 11,
        workspaceId: "e2e-overlay",
      });
    } finally {
      restore();
    }
  });

  test("falls back to overlay extension base when Chrome returns an invalid main-world URL", () => {
    vi.spyOn(chrome.runtime, "getURL").mockReturnValue(
      "chrome-extension://invalid/",
    );
    const config = document.createElement("script");
    config.id = "opensidebar-overlay-config";
    config.type = "application/json";
    config.textContent = JSON.stringify({
      runtimeOptions: {
        extensionBaseUrl: "chrome-extension://real-extension-id/",
      },
    });
    document.documentElement.appendChild(config);

    expect(chromeUiRuntimePort.getUrl("public/icons/icon-128.png")).toBe(
      "chrome-extension://real-extension-id/public/icons/icon-128.png",
    );
  });
});
