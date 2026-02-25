import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import "../setup";

import { WorkspaceManager } from "../../src/background/workspaces/manager";

describe("WorkspaceManager.init()", () => {
  let consoleSpy: any;
  let groupSpy: any;
  let groupEndSpy: any;

  beforeEach(() => {
    // Suppress logger console output
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    groupSpy = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    groupEndSpy = vi.spyOn(console, "groupEnd").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleSpy?.mockRestore();
    groupSpy?.mockRestore();
    groupEndSpy?.mockRestore();
    // Wait for any pending async operations from managers
    await new Promise((r) => setTimeout(r, 100));
  });

  test("skips init in content script context", async () => {
    let getCalled = false;
    const storageLocal = {
      get: async () => {
        getCalled = true;
        return {};
      },
      set: async () => {},
    };

    const manager = new WorkspaceManager({
      isContentScript: () => true,
      storageLocal,
    });
    // Allow constructor's async init() to settle
    await new Promise((r) => setTimeout(r, 50));

    // storage.local.get should NOT have been called
    expect(getCalled).toBe(false);
  });

  test("initializes successfully in background context", async () => {
    const storageLocal = {
      get: async () => ({
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
      }),
      set: async () => {},
    };

    const manager = new WorkspaceManager({
      isContentScript: () => false,
      storageLocal,
    });
    await new Promise((r) => setTimeout(r, 50));

    const workspaces = await manager.getWorkspaces();
    expect(workspaces.length).toBe(1);
    expect(workspaces[0].name).toBe("OpenSidebar 1");
  });

  test("retries on failure with exponential backoff", async () => {
    let callCount = 0;
    const storageLocal = {
      get: async (keys: unknown) => {
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
      },
      set: async () => {},
    };

    const manager = new WorkspaceManager({
      isContentScript: () => false,
      storageLocal,
    });
    // Wait for retries: 1st attempt immediate, retry at ~1s, retry at ~2s
    await new Promise((r) => setTimeout(r, 4500));

    // Should have called storage 3 times (2 failures + 1 success)
    expect(callCount).toBe(3);

    // Should be initialized after retries
    const workspaces = await manager.getWorkspaces();
    expect(workspaces).toEqual([]);
  }, 10000);

  test("gives up after max retries", async () => {
    let callCount = 0;
    const storageLocal = {
      get: async (keys: unknown) => {
        // Only count WorkspaceManager init calls (passes array of keys)
        if (!Array.isArray(keys))
          throw new Error("Storage permanently unavailable");
        callCount++;
        throw new Error("Storage permanently unavailable");
      },
      set: async () => {},
    };

    const manager = new WorkspaceManager({
      isContentScript: () => false,
      storageLocal,
    });
    // Wait for all retries: immediate + 1s + 2s + 4s = ~7s
    await new Promise((r) => setTimeout(r, 8500));

    // Should have called storage 4 times (1 initial + 3 retries)
    expect(callCount).toBe(4);
  }, 15000);
});
