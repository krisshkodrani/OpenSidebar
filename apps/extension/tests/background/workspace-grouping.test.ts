import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { WorkspaceManager } from "../../src/background/workspaces/manager";
import type { Workspace } from "../../src/types";

type TabUpdatedListener = (
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab,
) => void;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("WorkspaceManager grouping lifecycle", () => {
  let storageState: Record<string, unknown>;
  let tabs: Map<number, chrome.tabs.Tab>;
  let groups: Map<number, chrome.tabGroups.TabGroup>;
  let nextGroupId: number;
  let onTabUpdated: TabUpdatedListener | null;
  let onGroupCreated: ((group: chrome.tabGroups.TabGroup) => void) | null;
  let onGroupRemoved: ((group: chrome.tabGroups.TabGroup) => void) | null;
  let onGroupUpdated: ((group: chrome.tabGroups.TabGroup) => void) | null;
  let onNavigationTarget:
    | ((
        details: chrome.webNavigation.WebNavigationSourceCallbackDetails,
      ) => void)
    | null;
  let originals: {
    tabs: Partial<typeof chrome.tabs>;
    tabGroups: Partial<typeof chrome.tabGroups>;
    navigationTarget: unknown;
  };

  beforeEach(() => {
    storageState = {
      "opensidebar:workspaces": [],
      "opensidebar:nextWorkspaceNum": 1,
    };
    tabs = new Map();
    groups = new Map();
    nextGroupId = 100;
    onTabUpdated = null;
    onGroupCreated = null;
    onGroupRemoved = null;
    onGroupUpdated = null;
    onNavigationTarget = null;
    originals = {
      tabs: {
        get: chrome.tabs.get,
        query: chrome.tabs.query,
        group: chrome.tabs.group,
        ungroup: chrome.tabs.ungroup,
        onRemoved: chrome.tabs.onRemoved,
        onUpdated: chrome.tabs.onUpdated,
      },
      tabGroups: {
        get: chrome.tabGroups.get,
        update: chrome.tabGroups.update,
        onCreated: chrome.tabGroups.onCreated,
        onRemoved: chrome.tabGroups.onRemoved,
        onUpdated: chrome.tabGroups.onUpdated,
      },
      navigationTarget: chrome.webNavigation.onCreatedNavigationTarget,
    };

    (chrome.tabs as any).get = vi.fn(async (tabId: number) => {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error(`No tab ${tabId}`);
      return { ...tab };
    });
    (chrome.tabs as any).query = vi.fn(async (query: chrome.tabs.QueryInfo) => {
      return [...tabs.values()]
        .filter(
          (tab) => query.groupId === undefined || tab.groupId === query.groupId,
        )
        .map((tab) => ({ ...tab }));
    });
    (chrome.tabs as any).group = vi.fn(
      async (options: chrome.tabs.GroupOptions) => {
        const tabIds = Array.isArray(options.tabIds)
          ? options.tabIds
          : [options.tabIds];
        const firstTab = tabs.get(tabIds[0]);
        if (!firstTab) throw new Error("Missing tab");
        const groupId = options.groupId ?? nextGroupId++;
        const group =
          groups.get(groupId) ??
          ({
            id: groupId,
            windowId: options.createProperties?.windowId ?? firstTab.windowId,
            title: "",
            color: "blue",
            collapsed: false,
          } as chrome.tabGroups.TabGroup);
        for (const tabId of tabIds) {
          const tab = tabs.get(tabId);
          if (!tab || tab.windowId !== group.windowId) {
            throw new Error("Tabs and group must share a window");
          }
        }
        groups.set(groupId, group);
        for (const tabId of tabIds) {
          tabs.get(tabId)!.groupId = groupId;
        }
        return groupId;
      },
    );
    (chrome.tabs as any).ungroup = vi.fn(async (tabIds: number | number[]) => {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      const affectedGroups = new Set<number>();
      for (const tabId of ids) {
        const tab = tabs.get(tabId);
        if (!tab) continue;
        if (
          tab.groupId !== undefined &&
          tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
        ) {
          affectedGroups.add(tab.groupId);
        }
        tab.groupId = chrome.tabGroups.TAB_GROUP_ID_NONE;
        onTabUpdated?.(
          tabId,
          { groupId: chrome.tabGroups.TAB_GROUP_ID_NONE },
          { ...tab },
        );
      }
      for (const groupId of affectedGroups) {
        const hasMembers = [...tabs.values()].some(
          (tab) => tab.groupId === groupId,
        );
        if (!hasMembers) {
          const group = groups.get(groupId);
          groups.delete(groupId);
          if (group) onGroupRemoved?.({ ...group });
        }
      }
    });
    (chrome.tabs as any).onRemoved = {
      addListener: () => {},
      removeListener: () => {},
    };
    (chrome.tabs as any).onUpdated = {
      addListener: (listener: TabUpdatedListener) => {
        onTabUpdated = listener;
      },
      removeListener: () => {},
    };

    (chrome.tabGroups as any).get = vi.fn(async (groupId: number) => {
      const group = groups.get(groupId);
      if (!group) throw new Error(`No group ${groupId}`);
      return { ...group };
    });
    (chrome.tabGroups as any).update = vi.fn(
      async (groupId: number, updates: chrome.tabGroups.UpdateProperties) => {
        const group = groups.get(groupId);
        if (!group) throw new Error(`No group ${groupId}`);
        Object.assign(group, updates);
        return { ...group };
      },
    );
    (chrome.tabGroups as any).onRemoved = {
      addListener: (listener: (group: chrome.tabGroups.TabGroup) => void) => {
        onGroupRemoved = listener;
      },
      removeListener: () => {},
    };
    (chrome.tabGroups as any).onCreated = {
      addListener: (listener: (group: chrome.tabGroups.TabGroup) => void) => {
        onGroupCreated = listener;
      },
      removeListener: () => {},
    };
    (chrome.tabGroups as any).onUpdated = {
      addListener: (listener: (group: chrome.tabGroups.TabGroup) => void) => {
        onGroupUpdated = listener;
      },
      removeListener: () => {},
    };
    (chrome.webNavigation as any).onCreatedNavigationTarget = {
      addListener: (
        listener: (
          details: chrome.webNavigation.WebNavigationSourceCallbackDetails,
        ) => void,
      ) => {
        onNavigationTarget = listener;
      },
      removeListener: () => {},
    };
  });

  afterEach(() => {
    Object.assign(chrome.tabs, originals.tabs);
    Object.assign(chrome.tabGroups, originals.tabGroups);
    (chrome.webNavigation as any).onCreatedNavigationTarget =
      originals.navigationTarget;
  });

  function seedWorkspace(overrides: Partial<Workspace> = {}): Workspace {
    const workspace: Workspace = {
      id: "ws-1",
      name: "OS 1",
      baseName: "OS 1",
      color: "blue",
      tabGroupId: 7,
      tabIds: [10, 11],
      ...overrides,
    };
    storageState["opensidebar:workspaces"] = [workspace];
    storageState["opensidebar:nextWorkspaceNum"] = 2;
    if (workspace.tabGroupId !== null) {
      groups.set(workspace.tabGroupId, {
        id: workspace.tabGroupId,
        windowId: 1,
        title: workspace.name,
        color: workspace.color,
        collapsed: false,
      } as chrome.tabGroups.TabGroup);
    }
    for (const tabId of workspace.tabIds) {
      tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        groupId: workspace.tabGroupId ?? chrome.tabGroups.TAB_GROUP_ID_NONE,
      } as chrome.tabs.Tab);
    }
    return workspace;
  }

  async function buildManager(): Promise<WorkspaceManager> {
    const manager = new WorkspaceManager({
      isContentScript: () => false,
      storageLocal: {
        get: async () => clone(storageState),
        set: async (items) => {
          Object.assign(storageState, clone(items));
        },
      },
    });
    await manager.getWorkspaces();
    return manager;
  }

  async function flushEvents(manager: WorkspaceManager): Promise<void> {
    await Promise.resolve();
    await manager.getWorkspaces();
  }

  test("allocates the next name after stored workspace numbers", async () => {
    seedWorkspace({
      name: "OS 7",
      baseName: "OS 7",
    });
    const manager = await buildManager();

    await expect(manager.getNextWorkspaceName()).resolves.toBe("OS 8");
  });

  test("creates and persists a titled group atomically", async () => {
    tabs.set(10, {
      id: 10,
      windowId: 1,
      groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
    } as chrome.tabs.Tab);
    const manager = await buildManager();

    const workspace = await manager.createWorkspace("OS 1", "blue", 10);

    expect(workspace.tabIds).toEqual([10]);
    expect(groups.get(workspace.tabGroupId!)?.title).toBe("OS 1");
    expect(await manager.getWorkspaceForTab(10)).toMatchObject({
      id: workspace.id,
      tabGroupId: workspace.tabGroupId,
    });
  });

  test("does not persist an empty workspace when group creation fails", async () => {
    tabs.set(10, {
      id: 10,
      windowId: 1,
      groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
    } as chrome.tabs.Tab);
    (chrome.tabs.group as any).mockRejectedValueOnce(new Error("group failed"));
    const manager = await buildManager();

    await expect(manager.createWorkspace("OS 1", "blue", 10)).rejects.toThrow(
      "group failed",
    );
    expect(await manager.getWorkspaces()).toEqual([]);
  });

  test("manual ungroup detaches the tab without regrouping it", async () => {
    seedWorkspace();
    const manager = await buildManager();

    tabs.get(11)!.groupId = chrome.tabGroups.TAB_GROUP_ID_NONE;
    onTabUpdated!(
      11,
      { groupId: chrome.tabGroups.TAB_GROUP_ID_NONE },
      { ...tabs.get(11)! },
    );
    await flushEvents(manager);

    expect((await manager.getWorkspaceById("ws-1"))?.tabIds).toEqual([10]);
    expect(chrome.tabs.group).not.toHaveBeenCalled();
  });

  test("moving an untracked tab into a workspace group adopts it", async () => {
    seedWorkspace();
    tabs.set(20, {
      id: 20,
      windowId: 1,
      groupId: 7,
    } as chrome.tabs.Tab);
    const manager = await buildManager();

    onTabUpdated!(20, { groupId: 7 }, { ...tabs.get(20)! });
    await flushEvents(manager);

    expect((await manager.getWorkspaceById("ws-1"))?.tabIds).toEqual([
      10, 11, 20,
    ]);
  });

  test("moving a tab between managed groups transfers ownership", async () => {
    seedWorkspace();
    const second = seedWorkspace({
      id: "ws-2",
      name: "OS 2",
      baseName: "OS 2",
      tabGroupId: 8,
      tabIds: [20],
    });
    storageState["opensidebar:workspaces"] = [seedWorkspace(), second];
    const manager = await buildManager();

    tabs.get(11)!.groupId = 8;
    onTabUpdated!(11, { groupId: 8 }, { ...tabs.get(11)! });
    await flushEvents(manager);

    expect((await manager.getWorkspaceById("ws-1"))?.tabIds).toEqual([10]);
    expect((await manager.getWorkspaceById("ws-2"))?.tabIds).toEqual([20, 11]);
  });

  test("does not track a tab when grouping fails", async () => {
    seedWorkspace();
    tabs.set(20, {
      id: 20,
      windowId: 1,
      groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
    } as chrome.tabs.Tab);
    (chrome.tabs.group as any).mockRejectedValueOnce(new Error("group failed"));
    const manager = await buildManager();

    await expect(manager.addTabToWorkspace(20, "ws-1")).resolves.toBe(false);
    expect((await manager.getWorkspaceById("ws-1"))?.tabIds).toEqual([10, 11]);
  });

  test("rejects cross-window grouping without tracking the tab", async () => {
    seedWorkspace();
    tabs.set(20, {
      id: 20,
      windowId: 2,
      groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
    } as chrome.tabs.Tab);
    const manager = await buildManager();

    await expect(manager.addTabToWorkspace(20, "ws-1")).resolves.toBe(false);
    expect((await manager.getWorkspaceById("ws-1"))?.tabIds).toEqual([10, 11]);
  });

  test("recreates a stale group with live same-window tabs", async () => {
    seedWorkspace();
    groups.delete(7);
    tabs.get(10)!.groupId = chrome.tabGroups.TAB_GROUP_ID_NONE;
    tabs.get(11)!.groupId = chrome.tabGroups.TAB_GROUP_ID_NONE;
    tabs.set(20, {
      id: 20,
      windowId: 1,
      groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
    } as chrome.tabs.Tab);
    const manager = await buildManager();

    await expect(manager.addTabToWorkspace(20, "ws-1")).resolves.toBe(true);

    const workspace = await manager.getWorkspaceById("ws-1");
    expect(workspace?.tabGroupId).toBe(100);
    expect(workspace?.tabIds).toEqual([10, 11, 20]);
    expect(groups.get(100)?.title).toBe("OS 1");
  });

  test("adopts only page-created navigation targets", async () => {
    seedWorkspace();
    tabs.set(20, {
      id: 20,
      windowId: 1,
      groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
    } as chrome.tabs.Tab);
    tabs.set(21, {
      id: 21,
      windowId: 1,
      groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
    } as chrome.tabs.Tab);
    const manager = await buildManager();

    // A browser-UI tab produces no navigation-target event and stays separate.
    expect((await manager.getWorkspaceById("ws-1"))?.tabIds).not.toContain(20);

    onNavigationTarget!({
      sourceTabId: 10,
      tabId: 21,
      url: "https://example.com/detail",
    } as chrome.webNavigation.WebNavigationSourceCallbackDetails);
    await flushEvents(manager);

    expect((await manager.getWorkspaceById("ws-1"))?.tabIds).toContain(21);
    expect(manager.drainSpawnedTabs("ws-1")).toMatchObject([
      { tabId: 21, openerTabId: 10 },
    ]);
  });

  test("does not restore unrelated groups with a similar prefix", async () => {
    const manager = await buildManager();
    groups.set(9, {
      id: 9,
      windowId: 1,
      title: "OS Project",
      color: "blue",
      collapsed: false,
    } as chrome.tabGroups.TabGroup);
    tabs.set(30, { id: 30, windowId: 1, groupId: 9 } as chrome.tabs.Tab);

    await expect(
      manager.restoreWorkspaceFromGroup(groups.get(9)!),
    ).resolves.toBeNull();
    expect(await manager.getWorkspaces()).toEqual([]);
  });

  test("removes closed tabs and empty tracking-only workspaces on validation", async () => {
    seedWorkspace({
      id: "run-1",
      name: "run-1",
      baseName: undefined,
      tabGroupId: null,
      tabIds: [30, 31],
    });
    tabs.delete(30);
    tabs.set(31, {
      id: 31,
      windowId: 1,
      groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
    } as chrome.tabs.Tab);
    const manager = await buildManager();

    await manager.validateWorkspaces();
    expect((await manager.getWorkspaceById("run-1"))?.tabIds).toEqual([31]);

    tabs.delete(31);
    await manager.validateWorkspaces();
    expect(await manager.getWorkspaceById("run-1")).toBeNull();
  });

  test("external group appearance changes persist as the new base name", async () => {
    seedWorkspace();
    const manager = await buildManager();
    const group = groups.get(7)!;
    group.title = "My research";
    group.color = "purple";

    onGroupUpdated!({ ...group });
    await flushEvents(manager);

    expect(await manager.getWorkspaceById("ws-1")).toMatchObject({
      name: "My research",
      baseName: "My research",
      color: "purple",
    });

    group.title = "";
    onGroupUpdated!({ ...group });
    await flushEvents(manager);
    expect(await manager.getWorkspaceById("ws-1")).toMatchObject({
      name: "",
      baseName: "",
    });
  });

  test("reconnects a group moved to another window", async () => {
    seedWorkspace({
      name: "Review invoices",
      baseName: "OS 1",
    });
    const manager = await buildManager();
    const oldGroup = { ...groups.get(7)! };

    groups.delete(7);
    onGroupRemoved!(oldGroup);
    await flushEvents(manager);

    const movedGroup = {
      ...oldGroup,
      id: 8,
      windowId: 2,
    } as chrome.tabGroups.TabGroup;
    groups.set(8, movedGroup);
    for (const tabId of [10, 11]) {
      tabs.get(tabId)!.groupId = 8;
      tabs.get(tabId)!.windowId = 2;
    }
    onGroupCreated!(movedGroup);
    await flushEvents(manager);

    expect(await manager.getWorkspaceById("ws-1")).toMatchObject({
      tabGroupId: 8,
      tabIds: [10, 11],
      baseName: "OS 1",
    });
  });

  test("deleting a workspace cannot be undone by its ungroup events", async () => {
    seedWorkspace();
    const manager = await buildManager();

    await manager.deleteWorkspace("ws-1");
    await flushEvents(manager);

    expect(await manager.getWorkspaceById("ws-1")).toBeNull();
    expect(tabs.get(10)?.groupId).toBe(chrome.tabGroups.TAB_GROUP_ID_NONE);
    expect(tabs.get(11)?.groupId).toBe(chrome.tabGroups.TAB_GROUP_ID_NONE);
  });
});
