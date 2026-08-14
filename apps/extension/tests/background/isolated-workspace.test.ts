import { describe, expect, test, vi } from "vitest";
import { ensureIsolatedTaskWorkspace } from "../../src/background/browser-bridge/isolated-workspace";

function deps(options: { existing?: boolean; keepGroup?: boolean } = {}) {
  const group = vi.fn().mockResolvedValue(17);
  const setOptions = vi.fn().mockResolvedValue(undefined);
  const manager = {
    getWorkspaceById: vi.fn().mockResolvedValue(
      options.existing ? { tabGroupId: 17, tabIds: [42] } : null,
    ),
    addTabToWorkspace: vi.fn().mockResolvedValue(true),
    getNextWorkspaceName: vi.fn().mockResolvedValue("OS 4"),
    getNextColor: vi.fn().mockReturnValue("blue"),
    createWorkspace: vi.fn().mockResolvedValue({
      tabGroupId: 17,
      tabIds: [42],
    }),
  };
  return {
    manager,
    tabs: {
      group,
      get: vi.fn().mockResolvedValue({
        id: 42,
        groupId: options.keepGroup === false ? -1 : 17,
      }),
    },
    sidePanel: {
      setOptions,
      getOptions: vi.fn().mockResolvedValue({
        enabled: true,
        path: "src/sidepanel/index.html",
      }),
    },
  };
}

describe("isolated remote workspace", () => {
  test("creates, reasserts, and verifies the grouped panel-enabled tab", async () => {
    const d = deps();
    await ensureIsolatedTaskWorkspace("remote-1", 42, d);

    expect(d.manager.createWorkspace).toHaveBeenCalledWith(
      "OS 4",
      "blue",
      42,
      "remote-1",
    );
    expect(d.tabs.group).toHaveBeenCalledWith({ tabIds: [42], groupId: 17 });
    expect(d.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 42,
      path: "src/sidepanel/index.html",
      enabled: true,
    });
  });

  test("reuses an existing real workspace without creating another group", async () => {
    const d = deps({ existing: true });
    await ensureIsolatedTaskWorkspace("remote-1", 42, d);

    expect(d.manager.createWorkspace).not.toHaveBeenCalled();
    expect(d.tabs.group).toHaveBeenCalledWith({ tabIds: [42], groupId: 17 });
  });

  test("fails before execution when Chrome drops group membership", async () => {
    const d = deps({ keepGroup: false });
    await expect(
      ensureIsolatedTaskWorkspace("remote-1", 42, d),
    ).rejects.toThrow("Chrome did not keep the remote task tab");
    expect(d.sidePanel.setOptions).not.toHaveBeenCalled();
  });
});
