import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import { useComposerActions } from "../../src/sidepanel/hooks/useComposerActions";
import {
  setUiRuntimePortForTesting,
  type UiRuntimePort,
} from "../../src/sidepanel/runtime";
import { useStore } from "../../src/sidepanel/store";
import { DEFAULT_SETTINGS } from "../../src/sidepanel/store/settings-slice";
import { AgentStatus, MessageSource } from "../../src/types";

type ComposerActions = ReturnType<typeof useComposerActions>;

function HookHarness({
  onReady,
  onSendStarted,
}: {
  onReady: (actions: ComposerActions) => void;
  onSendStarted: () => void;
}) {
  const actions = useComposerActions({ onSendStarted });
  onReady(actions);
  return null;
}

describe("useComposerActions /new command", () => {
  let container: HTMLDivElement;
  let root: Root;
  let actions: ComposerActions;
  let onSendStarted: ReturnType<typeof vi.fn>;
  let restoreRuntime: (() => void) | null = null;

  beforeEach(async () => {
    (chrome.runtime.sendMessage as any) = vi.fn(async () => ({ ok: true }));
    (chrome.storage.local.set as any) = vi.fn(async () => {});
    onSendStarted = vi.fn();

    useStore.setState({
      activeWorkspaceId: "ws-test",
      messages: [],
      inputText: "",
      isAgentRunning: false,
      agentStatus: AgentStatus.IDLE,
      statusDetail: "Ready",
      taskProgress: null,
      taskCompletion: null,
      stagnationState: null,
      turnProgress: null,
      pendingApproval: null,
      pendingEscalation: null,
      pendingPlanConfirmation: null,
      pendingClarification: null,
      taskRecovery: null,
      sessionMetrics: null,
      laneTelemetry: null,
      latestStepLabel: null,
      passiveStatus: null,
      passiveStatusDetail: null,
      passiveLastObservationAt: null,
      passiveSessionId: null,
      error: null,
      errorPersistent: false,
      settings: DEFAULT_SETTINGS,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <HookHarness
          onReady={(nextActions) => {
            actions = nextActions;
          }}
          onSendStarted={onSendStarted}
        />,
      );
    });
  });

  afterEach(async () => {
    restoreRuntime?.();
    restoreRuntime = null;
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  test("starts a new chat without requiring provider keys", async () => {
    useStore.getState().addMessage({
      id: "msg-1",
      role: "user",
      content: "Old chat",
      timestamp: 1,
      toolCalls: [],
      isStreaming: false,
    });
    useStore.getState().setTaskCompletion({
      taskId: "task-1",
      status: "completed",
      summary: "done",
      totalTurnsUsed: 1,
      subtaskResults: [],
    });

    await act(async () => {
      await actions.handleSend("  /new  ");
    });

    expect(useStore.getState().messages).toEqual([]);
    expect(useStore.getState().taskCompletion).toBeNull();
    expect(useStore.getState().statusDetail).toBe("Ready");
    expect(onSendStarted).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      "chatMessages:ws-test": [],
      "agentState:ws-test": {
        isRunning: false,
        status: AgentStatus.IDLE,
        detail: "Ready",
      },
    });
  });

  test("blocks /new while an agent run is active", async () => {
    useStore.setState({
      isAgentRunning: true,
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "Working",
          timestamp: 1,
          toolCalls: [],
          isStreaming: true,
        },
      ],
    });

    await act(async () => {
      await actions.handleSendFeedback("/new");
    });

    expect(useStore.getState().messages).toHaveLength(1);
    expect(useStore.getState().error).toBe(
      "Stop the active run or watch mode before starting a new chat.",
    );
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith({
      "chatMessages:ws-test": [],
      "agentState:ws-test": {
        isRunning: false,
        status: AgentStatus.IDLE,
        detail: "Ready",
      },
    });
  });

  test("blocks /new while watch mode is active", async () => {
    useStore.setState({
      passiveStatus: "watching",
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "Watching",
          timestamp: 1,
          toolCalls: [],
          isStreaming: false,
        },
      ],
    });

    await act(async () => {
      await actions.handleSend("/new");
    });

    expect(useStore.getState().messages).toHaveLength(1);
    expect(useStore.getState().error).toBe(
      "Stop the active run or watch mode before starting a new chat.",
    );
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test("blocks normal sends without a configured provider key", async () => {
    await act(async () => {
      await actions.handleSend("Summarize the page");
    });

    expect(useStore.getState().messages).toEqual([]);
    expect(useStore.getState().error).toBe(
      "Please add your OpenRouter API key in Settings to get started.",
    );
    expect(onSendStarted).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test("lets E2E panel sends reach the runtime without exposing provider keys", async () => {
    const sendMessage = vi.fn(async () => ({ ok: true }));
    restoreRuntime = setUiRuntimePortForTesting({
      source: MessageSource.UI,
      e2ePanelConfig: { targetTabId: 42, workspaceId: "e2e-panel" },
      getUrl: (path: string) => path,
      sendMessage,
      subscribeMessages: () => () => {},
      connectKeepalive: () => null,
      getActiveTab: async () => ({ id: 42, windowId: 7 }),
      getTab: async () => null,
      getCurrentWindow: async () => ({ id: 7 }),
      onActiveTabChanged: () => () => {},
      createTab: async (url: string) => ({ id: 43, url }),
      requestPermissions: async () => false,
      storage: {
        local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
        sync: { get: async () => ({}), set: async () => {}, remove: async () => {} },
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      },
    } as UiRuntimePort);
    useStore.getState().setActiveWorkspaceId("e2e-panel");

    await act(async () => {
      await actions.handleSend("Summarize the page");
    });

    expect(onSendStarted).toHaveBeenCalledTimes(1);
    expect(useStore.getState().messages).toHaveLength(1);
    expect(useStore.getState().error).toBeNull();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "USER_CHAT",
        source: MessageSource.UI,
        payload: expect.objectContaining({
          text: "Summarize the page",
          tabId: 42,
          workspaceId: "e2e-panel",
        }),
      }),
    );

    useStore.setState({ isAgentRunning: false, inputText: "" });
    sendMessage.mockRejectedValueOnce(new Error("runtime unavailable"));
    await act(async () => {
      await actions.handleSend("Keep this draft");
    });
    expect(useStore.getState().inputText).toBe("Keep this draft");
    expect(useStore.getState().error).toBe("Failed to communicate with the agent.");
  });
});
