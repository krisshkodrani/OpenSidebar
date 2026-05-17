import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import { useComposerActions } from "../../src/sidepanel/hooks/useComposerActions";
import { useStore } from "../../src/sidepanel/store";
import { DEFAULT_SETTINGS } from "../../src/sidepanel/store/settings-slice";
import { AgentStatus } from "../../src/types";

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
});
