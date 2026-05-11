import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import TurnCard from "../../src/trace-viewer/components/traces/TurnCard";

describe("TurnCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  test("renders inline evidence annotations for high-signal turns", async () => {
    await act(async () => {
      root.render(
        <TurnCard
          sessionId="session-1"
          index={0}
          entry={
            {
              sessionId: "session-1",
              turnNumber: 1,
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
                contextMetrics: {
                  systemTokens: 1,
                  historyTokens: 90,
                  totalTokens: 91,
                  maxTokens: 100,
                  utilization: 0.91,
                  droppedMessageCount: 1,
                  compressionLevel: "none",
                  cachedPrefixLength: 0,
                },
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
              events: [
                {
                  type: "done_rejected",
                  timestamp: 1,
                  data: { reason: "missing evidence" },
                },
              ],
              progressState: { stagnantTurns: 0, signal: null },
              perception: {
                interpretation: "fallback only",
                model: "vision",
                durationMs: 1,
                cached: false,
                mode: "element_only",
                source: "fallback",
                fallbackReason: "no_api_key",
                screenshotStatus: "missing",
              },
            } as any
          }
        />,
      );
    });

    expect(container.textContent).toContain("Evidence");
    expect(container.textContent).toContain("Tool failed: click");
    expect(container.textContent).toContain("Completion rejected");
    expect(container.textContent).toContain("Degraded perception");
    expect(container.textContent).toContain("Context pressure");
  });
});
