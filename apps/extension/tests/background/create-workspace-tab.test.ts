import { afterEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { createWorkspaceTab } from "../../src/background/workspaces/create-workspace-tab";

describe("createWorkspaceTab", () => {
  const originalGet = chrome.tabs.get;
  const originalCreate = chrome.tabs.create;
  const originalRemove = chrome.tabs.remove;

  afterEach(() => {
    (chrome.tabs as any).get = originalGet;
    (chrome.tabs as any).create = originalCreate;
    (chrome.tabs as any).remove = originalRemove;
  });

  test("creates an inactive tab in the source workspace window", async () => {
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 10,
      windowId: 4,
    }));
    (chrome.tabs as any).create = vi.fn(async () => ({
      id: 20,
      windowId: 4,
    }));
    const manager = {
      addTabToWorkspace: vi.fn(async () => true),
    };

    await createWorkspaceTab({
      sourceTabId: 10,
      url: "https://example.com",
      workspaceId: "ws-1",
      manager,
    });

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: "https://example.com",
      active: false,
      windowId: 4,
    });
    expect(manager.addTabToWorkspace).toHaveBeenCalledWith(20, "ws-1");
  });

  test("closes a new tab when workspace adoption fails", async () => {
    (chrome.tabs as any).get = vi.fn(async () => ({
      id: 10,
      windowId: 4,
    }));
    (chrome.tabs as any).create = vi.fn(async () => ({
      id: 20,
      windowId: 4,
    }));
    (chrome.tabs as any).remove = vi.fn(async () => undefined);

    await expect(
      createWorkspaceTab({
        sourceTabId: 10,
        url: "https://example.com",
        workspaceId: "ws-1",
        manager: {
          addTabToWorkspace: vi.fn(async () => false),
        },
      }),
    ).rejects.toThrow("Could not add new tab 20 to workspace ws-1");
    expect(chrome.tabs.remove).toHaveBeenCalledWith(20);
  });
});
