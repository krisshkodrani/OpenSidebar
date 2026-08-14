import { describe, expect, test, vi } from "vitest";
import { verifyIsolatedTaskWorkspace } from "../../src/background/browser-bridge/isolated-workspace";

function deps(options: { attached?: boolean; keepGroup?: boolean } = {}) {
  const group = vi.fn().mockResolvedValue(17);
  const setOptions = vi.fn().mockResolvedValue(undefined);
  return {
    manager: {
      getWorkspaceForTab: vi.fn().mockResolvedValue(
        options.attached === false
          ? null
          : { name: "OpenSidebar 1", tabGroupId: 17, tabIds: [42] },
      ),
    },
    tabs: {
      group,
      get: vi.fn().mockResolvedValue({
        id: 42,
        windowId: 3,
        groupId: options.keepGroup === false ? -1 : 17,
        url: "https://example.com/",
        title: "Example Domain",
      }),
      query: vi.fn().mockResolvedValue([{ id: 42, windowId: 3 }]),
    },
    tabGroups: {
      get: vi.fn().mockResolvedValue({ id: 17, title: "OpenSidebar 1" }),
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
  test("verifies an existing grouped panel-enabled tab and returns bounded evidence", async () => {
    const d = deps();
    const evidence = await verifyIsolatedTaskWorkspace(
      42,
      "https://example.com/",
      true,
      d,
    );

    expect(d.tabs.group).toHaveBeenCalledWith({ tabIds: [42], groupId: 17 });
    expect(d.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 42,
      path: "src/sidepanel/index.html",
      enabled: true,
    });
    expect(evidence).toEqual({
      context: "isolated_tab",
      pageOrigin: "https://example.com",
      pageTitle: "Example Domain",
      expectedUrlMatched: true,
      windowLabel: "Window 1",
      workspaceTitle: "OpenSidebar 1",
      inWorkspace: true,
      sidePanelEnabled: true,
      createdForMission: true,
    });
  });

  test("refuses to create or infer a workspace when none owns the tab", async () => {
    await expect(
      verifyIsolatedTaskWorkspace(42, undefined, true, deps({ attached: false })),
    ).rejects.toThrow("not attached to an existing OpenSidebar workspace");
  });

  test("fails before execution when Chrome drops group membership", async () => {
    const d = deps({ keepGroup: false });
    await expect(
      verifyIsolatedTaskWorkspace(42, undefined, true, d),
    ).rejects.toThrow("Chrome did not keep the remote task tab");
    expect(d.sidePanel.setOptions).not.toHaveBeenCalled();
  });
});
