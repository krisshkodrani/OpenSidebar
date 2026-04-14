import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isUsableTab,
  resolveValidTabId,
} from "../../src/background/infrastructure/tab-resolution";

// Mock workspace manager
function mockWsManager(tabIds: number[] = []) {
  return {
    getWorkspaceById: vi.fn().mockResolvedValue(
      tabIds.length > 0 ? { tabIds } : null,
    ),
  };
}

describe("isUsableTab", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true for a tab with an https URL", async () => {
    vi.spyOn(chrome.tabs, "get").mockResolvedValue({
      id: 1,
      url: "https://example.com",
    } as chrome.tabs.Tab);
    expect(await isUsableTab(1)).toBe(true);
  });

  it("returns false for tabId 0", async () => {
    expect(await isUsableTab(0)).toBe(false);
  });

  it("returns false for negative tabId", async () => {
    expect(await isUsableTab(-1)).toBe(false);
  });

  it("returns false for about:blank", async () => {
    vi.spyOn(chrome.tabs, "get").mockResolvedValue({
      id: 1,
      url: "about:blank",
    } as chrome.tabs.Tab);
    expect(await isUsableTab(1)).toBe(false);
  });

  it("returns false for about:newtab", async () => {
    vi.spyOn(chrome.tabs, "get").mockResolvedValue({
      id: 1,
      url: "about:newtab",
    } as chrome.tabs.Tab);
    expect(await isUsableTab(1)).toBe(false);
  });

  it("returns false for chrome:// URLs", async () => {
    vi.spyOn(chrome.tabs, "get").mockResolvedValue({
      id: 1,
      url: "chrome://extensions",
    } as chrome.tabs.Tab);
    expect(await isUsableTab(1)).toBe(false);
  });

  it("returns false for chrome-extension:// URLs", async () => {
    vi.spyOn(chrome.tabs, "get").mockResolvedValue({
      id: 1,
      url: "chrome-extension://abc123/index.html",
    } as chrome.tabs.Tab);
    expect(await isUsableTab(1)).toBe(false);
  });

  it("returns false when chrome.tabs.get throws", async () => {
    vi.spyOn(chrome.tabs, "get").mockRejectedValue(new Error("No tab"));
    expect(await isUsableTab(99)).toBe(false);
  });
});

describe("resolveValidTabId", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the provided tabId when it is valid", async () => {
    vi.spyOn(chrome.tabs, "get").mockResolvedValue({
      id: 5,
      url: "https://example.com",
    } as chrome.tabs.Tab);
    const result = await resolveValidTabId(5, "ws-1", mockWsManager());
    expect(result).toBe(5);
  });

  it("falls back to workspace tabs when provided tabId is 0", async () => {
    const getSpy = vi.spyOn(chrome.tabs, "get");
    // tabId 0 → isUsableTab short-circuits to false (no chrome.tabs.get call)
    // workspace tab 10 → valid
    getSpy.mockImplementation(async (id: number) => {
      if (id === 10)
        return { id: 10, url: "https://workspace-page.com" } as chrome.tabs.Tab;
      throw new Error("Unknown tab");
    });

    const result = await resolveValidTabId(0, "ws-1", mockWsManager([10, 20]));
    expect(result).toBe(10);
  });

  it("falls back to workspace tabs when tabId points to about:blank", async () => {
    const getSpy = vi.spyOn(chrome.tabs, "get");
    getSpy.mockImplementation(async (id: number) => {
      if (id === 1)
        return { id: 1, url: "about:blank" } as chrome.tabs.Tab;
      if (id === 42)
        return { id: 42, url: "https://real-page.com" } as chrome.tabs.Tab;
      throw new Error("Unknown tab");
    });

    const result = await resolveValidTabId(1, "ws-1", mockWsManager([42]));
    expect(result).toBe(42);
  });

  it("falls back to workspace tabs when tabId points to chrome://", async () => {
    const getSpy = vi.spyOn(chrome.tabs, "get");
    getSpy.mockImplementation(async (id: number) => {
      if (id === 1)
        return { id: 1, url: "chrome://settings" } as chrome.tabs.Tab;
      if (id === 7)
        return { id: 7, url: "https://app.com" } as chrome.tabs.Tab;
      throw new Error("Unknown tab");
    });

    const result = await resolveValidTabId(1, "ws-1", mockWsManager([7]));
    expect(result).toBe(7);
  });

  it("falls back to active tab query when workspace has no valid tabs", async () => {
    const getSpy = vi.spyOn(chrome.tabs, "get");
    getSpy.mockImplementation(async (id: number) => {
      if (id === 1)
        return { id: 1, url: "about:blank" } as chrome.tabs.Tab;
      if (id === 2)
        return { id: 2, url: "about:blank" } as chrome.tabs.Tab;
      if (id === 50)
        return { id: 50, url: "https://fallback.com" } as chrome.tabs.Tab;
      throw new Error("Unknown tab");
    });

    vi.spyOn(chrome.tabs, "query").mockResolvedValue([
      { id: 50, url: "https://fallback.com" } as chrome.tabs.Tab,
    ]);

    const result = await resolveValidTabId(1, "ws-1", mockWsManager([2]));
    expect(result).toBe(50);
  });

  it("returns null when all fallbacks fail", async () => {
    vi.spyOn(chrome.tabs, "get").mockResolvedValue({
      id: 1,
      url: "about:blank",
    } as chrome.tabs.Tab);
    vi.spyOn(chrome.tabs, "query").mockResolvedValue([]);

    const result = await resolveValidTabId(1, "ws-1", mockWsManager([]));
    expect(result).toBeNull();
  });

  it("falls back when chrome.tabs.get throws for provided tabId", async () => {
    const getSpy = vi.spyOn(chrome.tabs, "get");
    getSpy.mockImplementation(async (id: number) => {
      if (id === 99) throw new Error("Tab not found");
      if (id === 30)
        return { id: 30, url: "https://valid.com" } as chrome.tabs.Tab;
      throw new Error("Unknown tab");
    });

    const result = await resolveValidTabId(99, "ws-1", mockWsManager([30]));
    expect(result).toBe(30);
  });

  it("skips workspace fallback for 'default' workspace", async () => {
    const getSpy = vi.spyOn(chrome.tabs, "get");
    getSpy.mockImplementation(async (id: number) => {
      if (id === 1)
        return { id: 1, url: "about:blank" } as chrome.tabs.Tab;
      if (id === 20)
        return { id: 20, url: "https://active.com" } as chrome.tabs.Tab;
      throw new Error("Unknown tab");
    });
    vi.spyOn(chrome.tabs, "query").mockResolvedValue([
      { id: 20, url: "https://active.com" } as chrome.tabs.Tab,
    ]);

    const ws = mockWsManager([10]);
    const result = await resolveValidTabId(1, "default", ws);
    // Should NOT have called getWorkspaceById for "default"
    expect(ws.getWorkspaceById).not.toHaveBeenCalled();
    expect(result).toBe(20);
  });
});
