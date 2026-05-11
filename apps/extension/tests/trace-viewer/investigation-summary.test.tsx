import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import InvestigationSummary from "../../src/trace-viewer/components/traces/InvestigationSummary";
import { useStore } from "../../src/trace-viewer/store";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

describe("InvestigationSummary", () => {
  let container: HTMLDivElement;
  let root: Root;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetStore();
    writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    window.history.replaceState(null, "", "/trace-viewer.html");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  test("copies a deep link to the first bad turn", async () => {
    useStore.getState().setCurrentEntries([
      {
        sessionId: "session-1",
        turnNumber: 3,
        snapshot: {
          url: "https://example.com",
          title: "Example",
          elementCount: 1,
          visibleContentLength: 10,
          scrollY: 0,
        },
        elements: [],
        llmRequest: {
          model: "openai/gpt-5.4-mini:nitro",
          messageCount: 1,
          toolCount: 1,
          compressionLevel: "none",
        },
        llmResponse: {
          content: null,
          toolCalls: [],
          finishReason: "stop",
          usage: null,
          durationMs: 100,
        },
        toolExecutions: [
          {
            toolCallId: "tc-1",
            toolName: "click",
            args: {},
            result: "element detached",
            success: false,
            durationMs: 25,
            riskLevel: "low",
            error: "element detached",
          },
        ],
        events: [],
        progressState: { stagnantTurns: 0, signal: null },
      } as any,
    ]);

    await act(async () => {
      root.render(
        <InvestigationSummary
          session={
            {
              sessionId: "session-1",
              startTime: 1,
              endTime: 2,
              query: "Objective: debug trace",
              startUrl: "https://example.com",
              outcome: "error",
              turnCount: 3,
              summary: "failed",
              metrics: null,
            } as any
          }
        />,
      );
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Copy link",
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(
        "/trace-viewer.html#session=session-1&view=turns&turn=3",
      ),
    );
  });
});
