import { beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { ToolName } from "../../src/types";
import { createWorkspaceTab } from "../../src/background/workspaces/create-workspace-tab";
import {
  handleSwitchTabToolCall,
  handleCreateTabToolCall,
  handleCloseTabToolCall,
  type AgentLoopToolHandlerHost,
} from "../../src/background/agent/loop-tool-handlers";

vi.mock("../../src/background/workspaces/create-workspace-tab", () => ({
  createWorkspaceTab: vi.fn(async () => ({ id: 30 })),
}));

function host(): AgentLoopToolHandlerHost {
  return {
    context: { addMessage: vi.fn(), hasSpawnedTabs: () => false },
    shouldBlockTabClosing: () => true,
    originalQuery: "Compare the reports.",
    workspaceId: "reports",
    getWorkspaceTabIds: async () => [10, 20],
    replayMutationSensitiveAction: () => false,
    recordMutationSensitiveAction: vi.fn(),
    refreshSnapshotWithRetry: vi.fn(async () => 7),
    refreshPerceptionAndTriage: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn() },
    turnCount: 1,
  } as unknown as AgentLoopToolHandlerHost;
}

describe("model-chosen tab actions", () => {
  beforeEach(() => vi.clearAllMocks());

  test("switches to an existing workspace tab without a tab-management request", async () => {
    const loop = host();
    const get = vi
      .spyOn(chrome.tabs, "get")
      .mockResolvedValue({
        id: 20,
        url: "https://example.test/report",
      } as chrome.tabs.Tab);
    const update = vi
      .spyOn(chrome.tabs, "update")
      .mockResolvedValue({ id: 20 } as chrome.tabs.Tab);
    try {
      expect(
        await handleSwitchTabToolCall(loop, "switch", { tabId: 20 }, 10, 2),
      ).toEqual({ tabId: 20, prevElementCount: 7 });
      expect(update).toHaveBeenCalledWith(20, { active: true });
      expect(loop.refreshSnapshotWithRetry).toHaveBeenCalledWith(20, 2);
    } finally {
      get.mockRestore();
      update.mockRestore();
    }
  });

  test("creates a workspace tab without a tab-management request", async () => {
    const loop = host();
    await handleCreateTabToolCall(
      loop,
      "create",
      ToolName.CREATE_TAB,
      { url: "https://example.test/report" },
      10,
    );
    expect(createWorkspaceTab).toHaveBeenCalledWith({
      sourceTabId: 10,
      url: "https://example.test/report",
      workspaceId: "reports",
    });
    expect(loop.recordMutationSensitiveAction).toHaveBeenCalled();
  });

  test("still rejects switching outside the workspace", async () => {
    const loop = host();
    const update = vi.spyOn(chrome.tabs, "update");
    try {
      expect(
        await handleSwitchTabToolCall(loop, "switch", { tabId: 99 }, 10, 2),
      ).toEqual({ tabId: 10, prevElementCount: 2 });
      expect(update).not.toHaveBeenCalled();
      expect(loop.context.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("not in this workspace"),
        }),
      );
    } finally {
      update.mockRestore();
    }
  });

  test("still rejects internal browser tabs", async () => {
    const loop = host();
    const get = vi
      .spyOn(chrome.tabs, "get")
      .mockResolvedValue({
        id: 20,
        url: "chrome://settings",
      } as chrome.tabs.Tab);
    const update = vi.spyOn(chrome.tabs, "update");
    try {
      await handleSwitchTabToolCall(loop, "switch", { tabId: 20 }, 10, 2);
      expect(update).not.toHaveBeenCalled();
      expect(loop.context.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Cannot switch"),
        }),
      );
    } finally {
      get.mockRestore();
      update.mockRestore();
    }
  });

  test("still rejects unsafe URLs before creating a tab", async () => {
    const loop = host();
    await handleCreateTabToolCall(
      loop,
      "create",
      ToolName.CREATE_TAB,
      { url: "javascript:alert(1)" },
      10,
    );
    expect(createWorkspaceTab).not.toHaveBeenCalled();
    expect(loop.context.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Error:") }),
    );
  });

  test("does not recreate a tab when the mutation ledger replays its result", async () => {
    const loop = host();
    loop.replayMutationSensitiveAction = () => true;
    await handleCreateTabToolCall(
      loop,
      "create",
      ToolName.CREATE_TAB,
      { url: "https://example.test/report" },
      10,
    );
    expect(createWorkspaceTab).not.toHaveBeenCalled();
  });

  test("retains the separate gate against closing existing tabs", async () => {
    const loop = host();
    const remove = vi.spyOn(chrome.tabs, "remove");
    try {
      await handleCloseTabToolCall(
        loop,
        "close",
        ToolName.CLOSE_TAB,
        { tabId: 20 },
        10,
      );
      expect(remove).not.toHaveBeenCalled();
      expect(loop.context.addMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Blocked: close_tab"),
        }),
      );
    } finally {
      remove.mockRestore();
    }
  });
});
