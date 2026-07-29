import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { InputArea } from "../../src/sidepanel/components/InputArea";
import { useStore } from "../../src/sidepanel/store";
import { DEFAULT_SETTINGS } from "../../src/sidepanel/store/settings-slice";

describe("InputArea", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    useStore.setState({
      inputText: "abcdef",
      isAgentRunning: true,
      pendingApproval: null,
      pendingEscalation: null,
      pendingClarification: null,
      settings: { ...DEFAULT_SETTINGS },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <InputArea
          onSend={vi.fn()}
          onSendFeedback={vi.fn()}
          onStop={vi.fn()}
          onOpenSettings={vi.fn()}
          onOpenPersonalProfile={vi.fn()}
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

  test("preserves the textarea and caret when the run state changes", async () => {
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    textarea!.focus();
    textarea!.setSelectionRange(3, 3);

    await act(async () => {
      useStore.getState().setAgentRunning(false);
    });

    const idleTextarea = container.querySelector("textarea");
    expect(idleTextarea).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(idleTextarea?.selectionStart).toBe(3);
    expect(idleTextarea?.selectionEnd).toBe(3);
    expect(idleTextarea?.value).toBe("abcdef");
    expect(idleTextarea?.placeholder).toBe("What can I help with?");

    await act(async () => {
      useStore.getState().setAgentRunning(true);
    });

    const runningTextarea = container.querySelector("textarea");
    expect(runningTextarea).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(runningTextarea?.selectionStart).toBe(3);
    expect(runningTextarea?.selectionEnd).toBe(3);
    expect(runningTextarea?.placeholder).toBe("Guide the agent...");
  });
});
