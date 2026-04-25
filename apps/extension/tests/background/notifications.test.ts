import { beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";

vi.mock("../../src/utils/settings-storage", () => ({
  loadSettings: vi.fn(),
}));

vi.mock("../../src/background/workspaces/manager", () => ({
  workspaceManager: {
    getWorkspaceForTab: vi.fn(),
    getWorkspaceById: vi.fn(),
  },
}));

import { agentNotifications } from "../../src/background/notifications";
import { loadSettings } from "../../src/utils/settings-storage";
import { workspaceManager } from "../../src/background/workspaces/manager";

const mockedLoadSettings = vi.mocked(loadSettings);
const mockedWorkspaceManager = vi.mocked(workspaceManager);

describe("agentNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentNotifications.resetForTests();

    mockedLoadSettings.mockResolvedValue({
      openRouterApiKey: "",
      maxTurns: 100,
      theme: "system",
      showSessionMetrics: true,
      requireApprovals: true,
      allowNavigation: true,
      enableBrowserNotifications: true,
    });
    mockedWorkspaceManager.getWorkspaceForTab.mockResolvedValue(null);
    mockedWorkspaceManager.getWorkspaceById.mockResolvedValue({
      id: "ws-1",
      name: "OS 1",
      color: "blue",
      tabGroupId: 1,
      tabIds: [10],
    });

    (chrome.permissions.contains as any) = vi.fn(async () => true);
    (chrome.notifications.getPermissionLevel as any) = vi.fn(
      async () => "granted",
    );
    (chrome.notifications.create as any) = vi.fn(
      async (id: string, _opts: any, cb?: (createdId: string) => void) => {
        cb?.(id);
        return id;
      },
    );
    (chrome.notifications.clear as any) = vi.fn(async () => true);
    (chrome.tabs.query as any) = vi.fn(async () => [
      { id: 99, windowId: 9, url: "https://other.example" },
    ]);
    (chrome.tabs.get as any) = vi.fn(async (tabId: number) => ({
      id: tabId,
      windowId: 5,
      url: "https://workspace.example",
    }));
    (chrome.tabs.update as any) = vi.fn(async () => ({}));
    (chrome.windows.update as any) = vi.fn(async () => ({}));
    (chrome.sidePanel.setOptions as any) = vi.fn(async () => {});
    (chrome.sidePanel.open as any) = vi.fn(async () => {});
  });

  test("does nothing when browser notifications are disabled", async () => {
    mockedLoadSettings.mockResolvedValueOnce({
      openRouterApiKey: "",
      maxTurns: 100,
      theme: "system",
      showSessionMetrics: true,
      requireApprovals: true,
      allowNavigation: true,
      enableBrowserNotifications: false,
    });

    await agentNotifications.notifyAttention({
      workspaceId: "ws-1",
      taskId: "task-1",
      eventId: "approval-1",
      tabId: 10,
      reason: "Approval required",
    });

    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test("does nothing when optional permission is missing", async () => {
    (chrome.permissions.contains as any) = vi.fn(async () => false);

    await agentNotifications.notifyAttention({
      workspaceId: "ws-1",
      taskId: "task-1",
      eventId: "approval-1",
      tabId: 10,
      reason: "Approval required",
    });

    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test("suppresses notifications when focused tab is in the workspace", async () => {
    (chrome.tabs.query as any) = vi.fn(async () => [{ id: 10, windowId: 5 }]);

    await agentNotifications.notifyAttention({
      workspaceId: "ws-1",
      taskId: "task-1",
      eventId: "approval-1",
      tabId: 10,
      reason: "Approval required",
    });

    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test("creates and dedupes attention notifications when user is away", async () => {
    await agentNotifications.notifyAttention({
      workspaceId: "ws-1",
      taskId: "task-1",
      eventId: "approval-1",
      tabId: 10,
      reason: "Approval required",
      detail: "Review a high-risk action",
    });
    await agentNotifications.notifyAttention({
      workspaceId: "ws-1",
      taskId: "task-1",
      eventId: "approval-1",
      tabId: 10,
      reason: "Approval required",
      detail: "Review a high-risk action",
    });

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.stringContaining("opensidebar:ws-1:"),
      expect.objectContaining({
        title: "OpenSidebar needs your input",
        message: "Review a high-risk action",
        requireInteraction: true,
      }),
      expect.any(Function),
    );
  });

  test("clicking a notification focuses the workspace and opens the side panel", async () => {
    await agentNotifications.notifyTaskCompletion({
      workspaceId: "ws-1",
      tabId: 10,
      payload: {
        taskId: "task-1",
        status: "completed",
        totalTurnsUsed: 3,
        totalTimeMs: 1000,
        summary: "Finished the task",
        subtaskResults: [],
        urlHistory: [],
      },
    });

    const notificationId = vi.mocked(chrome.notifications.create).mock
      .calls[0][0] as string;
    await agentNotifications.handleClick(notificationId);

    expect(chrome.windows.update).toHaveBeenCalledWith(5, { focused: true });
    expect(chrome.tabs.update).toHaveBeenCalledWith(10, { active: true });
    expect(chrome.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 10,
      path: "src/sidepanel/index.html",
      enabled: true,
    });
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 10 });
    expect(chrome.notifications.clear).toHaveBeenCalledWith(notificationId);
  });
});
