import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import EvidenceBoard from "../../src/trace-viewer/components/traces/story/EvidenceBoard";
import { useStore } from "../../src/trace-viewer/store";
import type { TraceEntry, TraceSession } from "../../src/types/traces";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

describe("EvidenceBoard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  test("shows screenshot, exact URL, tool failure, and opens the source turn", async () => {
    const entry = {
      sessionId: "session-1",
      turnNumber: 2,
      timestamp: 2,
      snapshot: {
        url: "https://example.com/billing",
        title: "Billing settings",
        elementCount: 3,
        visibleContentLength: 20,
        scrollY: 0,
      },
      elements: [],
      pageState: {
        preDecision: {
          url: "https://example.com/billing",
          title: "Billing settings",
          elementCount: 3,
          scrollY: 0,
          screenshots: [
            {
              kind: "viewport",
              dataUrl: "data:image/png;base64,AAAA",
            },
          ],
        },
      },
      llmRequest: {
        model: "test-model",
        messageCount: 1,
        toolCount: 1,
        compressionLevel: "none",
      },
      llmResponse: {
        content: null,
        toolCalls: [],
        finishReason: "stop",
        usage: null,
        durationMs: 10,
      },
      toolExecutions: [
        {
          toolCallId: "tool-1",
          toolName: "click",
          args: {},
          result: "Button detached before click",
          error: "Button detached before click",
          success: false,
          durationMs: 5,
        },
      ],
      events: [],
      progressState: { stagnantTurns: 0, signal: null },
    } as TraceEntry;
    const session = {
      sessionId: "session-1",
      query: "Update billing settings",
      startUrl: "https://example.com",
      outcome: "error",
      startTime: 1,
      endTime: 3,
      turnCount: 2,
      metrics: null,
    } as TraceSession;
    useStore.setState({ currentEntries: [entry], currentRunEvents: [] });

    await act(async () => root.render(<EvidenceBoard session={session} />));

    expect(container.textContent).toContain("Key evidence");
    expect(container.textContent).toContain("Billing settings");
    expect(container.textContent).toContain("https://example.com/billing");
    expect(container.textContent).toContain("click: failed");
    expect(container.textContent).toContain("Button detached before click");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,AAAA",
    );

    const turnButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Turn 2",
    );
    expect(turnButton).toBeTruthy();
    await act(async () => turnButton!.click());
    expect(useStore.getState().activeSubview).toBe("turns");
    expect(useStore.getState().focusTurnNumber).toBe(2);

    const modelIOButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Model I/O",
    );
    expect(modelIOButton).toBeTruthy();
    await act(async () => modelIOButton!.click());
    expect(useStore.getState().activeSubview).toBe("prompts");
    expect(useStore.getState().modelIOFocus).toEqual({
      turnNumber: 2,
      section: "response",
    });
  });
});
