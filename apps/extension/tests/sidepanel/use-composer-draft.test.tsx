import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import "../setup";
import { useComposerDraft } from "../../src/sidepanel/hooks/useComposerDraft";
import { uiRuntime } from "../../src/sidepanel/runtime";
import { composerDraftKey } from "../../src/sidepanel/composer-draft-storage";
import { MessageSource, type RuntimeMessage } from "../../src/types";

vi.mock("../../src/sidepanel/cloud-client", () => ({
  cloudSession: async () => null,
}));

test("an accepted task removes its saved task draft while the composer is in guidance mode", async () => {
  let listener: ((message: RuntimeMessage) => void) | undefined;
  const unsubscribe = vi.fn();
  const subscribe = vi
    .spyOn(uiRuntime, "subscribeMessages")
    .mockImplementation((fn) => {
      listener = fn;
      return unsubscribe;
    });
  const remove = vi
    .spyOn(uiRuntime.storage.local, "remove")
    .mockResolvedValue();
  const container = document.createElement("div");
  const root = createRoot(container);
  function Harness() {
    useComposerDraft({
      text: "",
      workspaceId: "ws",
      mode: "guidance",
      setText: vi.fn(),
    });
    return null;
  }
  try {
    await act(async () => {
      root.render(<Harness />);
    });
    expect(listener).toBeDefined();
    const message: RuntimeMessage = {
      type: "USER_CHAT_ACCEPTED",
      source: MessageSource.BACKGROUND,
      requestId: "ack",
      workspaceId: "ws",
      payload: {
        text: "Summarize this page",
        tabId: 1,
        workspaceId: "ws",
        messageId: "message",
        timestamp: 1,
      },
    };
    await act(async () => {
      listener!(message);
    });
    expect(remove).toHaveBeenCalledWith(
      composerDraftKey({ accountId: "local", workspaceId: "ws", mode: "task" }),
    );
    remove.mockClear();
    await act(async () => {
      listener!({
        ...message,
        payload: { ...message.payload, workspaceId: "other" },
      });
    });
    expect(remove).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      root.unmount();
    });
    expect(unsubscribe).toHaveBeenCalled();
    subscribe.mockRestore();
    remove.mockRestore();
  }
});
