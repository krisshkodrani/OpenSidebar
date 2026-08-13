import { describe, expect, it, vi } from "vitest";
import {
  SIDEPANEL_PATH,
  belongsToVisibleWorkspace,
  hidePanelForNewUngroupedTab,
  installUngroupedTabPanelGuards,
  setWorkspacePanelVisibility,
} from "../../src/background/side-panel-visibility";

describe("workspace side-panel visibility", () => {
  it("enables the product panel only for a workspace tab", async () => {
    const setOptions = vi.fn().mockResolvedValue(undefined);

    await setWorkspacePanelVisibility({ setOptions }, 41, true);

    expect(setOptions).toHaveBeenCalledWith({
      tabId: 41,
      path: SIDEPANEL_PATH,
      enabled: true,
    });
  });

  it("disables the panel for a tab outside the workspace", async () => {
    const setOptions = vi.fn().mockResolvedValue(undefined);

    await setWorkspacePanelVisibility({ setOptions }, 42, false);

    expect(setOptions).toHaveBeenCalledWith({ tabId: 42, enabled: false });
  });

  it("hides an ungrouped tab immediately when Chrome creates it", async () => {
    const setOptions = vi.fn().mockResolvedValue(undefined);

    await hidePanelForNewUngroupedTab(
      { setOptions },
      { id: 43, groupId: chrome.tabGroups.TAB_GROUP_ID_NONE },
    );

    expect(setOptions).toHaveBeenCalledWith({ tabId: 43, enabled: false });
  });

  it("does not disable a newly created grouped tab before adoption settles", () => {
    const setOptions = vi.fn().mockResolvedValue(undefined);

    expect(
      hidePanelForNewUngroupedTab({ setOptions }, { id: 44, groupId: 7 }),
    ).toBeUndefined();
    expect(setOptions).not.toHaveBeenCalled();
  });

  it("treats Chrome group membership as authoritative over stale state", () => {
    expect(belongsToVisibleWorkspace(-1, { tabGroupId: 7 })).toBe(false);
    expect(belongsToVisibleWorkspace(7, { tabGroupId: 7 })).toBe(true);
    expect(belongsToVisibleWorkspace(8, { tabGroupId: 7 })).toBe(false);
    expect(belongsToVisibleWorkspace(-1, { tabGroupId: null })).toBe(true);
  });

  it("installs guards for both creation and later ungrouping", async () => {
    const setOptions = vi.fn().mockResolvedValue(undefined);
    let onCreated: ((tab: { id: number; groupId: number }) => void) | undefined;
    let onUpdated:
      | ((tabId: number, changeInfo: { groupId?: number }) => void)
      | undefined;
    const onError = vi.fn();
    installUngroupedTabPanelGuards(
      { setOptions },
      {
        onCreated: { addListener: vi.fn((listener) => { onCreated = listener; }) },
        onUpdated: { addListener: vi.fn((listener) => { onUpdated = listener; }) },
      } as never,
      onError,
    );

    onCreated?.({ id: 45, groupId: -1 });
    onUpdated?.(46, { groupId: -1 });
    await vi.waitFor(() => expect(setOptions).toHaveBeenCalledTimes(2));
    expect(setOptions).toHaveBeenNthCalledWith(1, { tabId: 45, enabled: false });
    expect(setOptions).toHaveBeenNthCalledWith(2, { tabId: 46, enabled: false });
    expect(onError).not.toHaveBeenCalled();
  });
});
