import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
  spyOn,
} from "bun:test";
import "../setup";

// Mock context module before importing WorkspaceManager
const mockIsContentScript = mock(() => false);
mock.module("../../src/utils/context", () => ({
  isContentScript: mockIsContentScript,
  getExecutionContext: () => "background",
  isBackground: () => true,
  isSidepanel: () => false,
  isOffscreen: () => false,
}));

import { WorkspaceManager } from "../../src/background/workspaces/manager";

describe("WorkspaceManager.init()", () => {
  let consoleSpy: any;
  let groupSpy: any;
  let groupEndSpy: any;

  beforeEach(() => {
    mockIsContentScript.mockReset();
    mockIsContentScript.mockReturnValue(false);
    // Suppress logger console output
    consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    groupSpy = spyOn(console, "groupCollapsed").mockImplementation(() => {});
    groupEndSpy = spyOn(console, "groupEnd").mockImplementation(() => {});

    // Ensure chrome.storage.local exists (setup.ts should provide it,
    // but guard against ordering issues in full suite runs)
    if (!global.chrome) (global as any).chrome = {};
    if (!global.chrome.storage) (global.chrome as any).storage = {};
    if (!global.chrome.storage.local) {
      (global.chrome.storage as any).local = {
        get: async () => ({}),
        set: async () => {},
      };
    }
  });

  afterEach(async () => {
    consoleSpy?.mockRestore();
    groupSpy?.mockRestore();
    groupEndSpy?.mockRestore();
    // Wait for any pending async operations from managers
    await new Promise((r) => setTimeout(r, 100));
  });

  test("skips init in content script context", async () => {
    mockIsContentScript.mockReturnValue(true);

    let getCalled = false;
    const origGet = chrome.storage.local.get;
    (chrome.storage.local as any).get = async () => {
      getCalled = true;
      return {};
    };

    const manager = new WorkspaceManager();
    // Allow constructor's async init() to settle
    await new Promise((r) => setTimeout(r, 50));

    // storage.local.get should NOT have been called
    expect(getCalled).toBe(false);

    (chrome.storage.local as any).get = origGet;
  });

  test("initializes successfully in background context", async () => {
    mockIsContentScript.mockReturnValue(false);

    const origGet = chrome.storage.local.get;
    (chrome.storage.local as any).get = async () => ({
      "opensidebar:workspaces": [
        {
          id: "ws1",
          name: "OpenSidebar 1",
          tabIds: [1],
          color: "blue",
          tabGroupId: null,
        },
      ],
      "opensidebar:nextWorkspaceNum": 2,
    });

    const manager = new WorkspaceManager();
    await new Promise((r) => setTimeout(r, 50));

    const workspaces = await manager.getWorkspaces();
    expect(workspaces.length).toBe(1);
    expect(workspaces[0].name).toBe("OpenSidebar 1");

    (chrome.storage.local as any).get = origGet;
  });

  test("retries on failure with exponential backoff", async () => {
    mockIsContentScript.mockReturnValue(false);

    let callCount = 0;
    const origGet = chrome.storage.local.get;
    (chrome.storage.local as any).get = async (keys: unknown) => {
      // Only count WorkspaceManager init calls (passes array of keys)
      if (!Array.isArray(keys)) return {};
      callCount++;
      if (callCount <= 2) {
        throw new Error(`Storage unavailable (attempt ${callCount})`);
      }
      return {
        "opensidebar:workspaces": [],
        "opensidebar:nextWorkspaceNum": 1,
      };
    };

    const manager = new WorkspaceManager();
    // Wait for retries: 1st attempt immediate, retry at ~1s, retry at ~2s
    await new Promise((r) => setTimeout(r, 4500));

    // Should have called storage 3 times (2 failures + 1 success)
    expect(callCount).toBe(3);

    // Should be initialized after retries
    const workspaces = await manager.getWorkspaces();
    expect(workspaces).toEqual([]);

    (chrome.storage.local as any).get = origGet;
  }, 10000);

  test("gives up after max retries", async () => {
    mockIsContentScript.mockReturnValue(false);

    let callCount = 0;
    const origGet = chrome.storage.local.get;
    (chrome.storage.local as any).get = async (keys: unknown) => {
      // Only count WorkspaceManager init calls (passes array of keys)
      if (!Array.isArray(keys))
        throw new Error("Storage permanently unavailable");
      callCount++;
      throw new Error("Storage permanently unavailable");
    };

    const manager = new WorkspaceManager();
    // Wait for all retries: immediate + 1s + 2s + 4s = ~7s
    await new Promise((r) => setTimeout(r, 8500));

    // Should have called storage 4 times (1 initial + 3 retries)
    expect(callCount).toBe(4);

    (chrome.storage.local as any).get = origGet;
  }, 15000);
});
