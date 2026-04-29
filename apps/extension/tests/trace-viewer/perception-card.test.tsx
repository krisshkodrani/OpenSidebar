import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import PerceptionCard from "../../src/trace-viewer/components/traces/PerceptionCard";
import { useStore } from "../../src/trace-viewer/store";
import type { TraceEntry } from "../../src/types/traces";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

function entry(overrides: Partial<TraceEntry> = {}): TraceEntry {
  return {
    sessionId: "session-1",
    turnNumber: 1,
    timestamp: 1,
    snapshot: {
      url: "https://example.com",
      title: "Example",
      elementCount: 1,
      visibleContentLength: 20,
      scrollY: 0,
    },
    elements: [],
    llmRequest: {
      model: "model",
      messageCount: 1,
      toolCount: 1,
      compressionLevel: "none",
    },
    llmResponse: {
      content: null,
      toolCalls: [],
      finishReason: "stop",
      usage: null,
      durationMs: 1,
    },
    toolExecutions: [],
    events: [],
    progressState: { stagnantTurns: 0, signal: null },
    perception: {
      interpretation: "Legacy interpretation",
      model: "vision-model",
      durationMs: 10,
      cached: false,
      elementSummary: "legacy distillation",
      screenshotDataUrl: "data:image/jpeg;base64,legacy",
    },
    ...overrides,
  };
}

describe("PerceptionCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetStore();
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

  test("prefers page-state evidence over legacy perception artifacts", async () => {
    const traceEntry = entry({
      pageState: {
        preDecision: {
          url: "https://example.com",
          title: "Example",
          elementCount: 1,
          scrollY: 0,
        },
        postTool: {
          url: "https://example.com/next",
          title: "Next",
          elementCount: 2,
          scrollY: 20,
          domDistillation: "canonical DOM distillation",
          screenshots: [
            {
              kind: "viewport",
              dataUrl: "data:image/jpeg;base64,canonical",
              label: "viewport",
              scrollY: 20,
            },
          ],
        },
      },
      perception: {
        interpretation: "Observed next page",
        model: "vision-model",
        durationMs: 10,
        cached: false,
        mode: "structured",
        pageStateRef: "postTool",
        elementSummary: "legacy distillation",
        screenshotDataUrl: "data:image/jpeg;base64,legacy",
      },
    });

    await act(async () => {
      root.render(<PerceptionCard entry={traceEntry} sessionId="session-1" />);
    });

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("data:image/jpeg;base64,canonical");
    expect(container.textContent).toContain("canonical DOM distillation");
    expect(container.textContent).not.toContain("legacy distillation");
    expect(container.textContent).toContain("Page state: postTool");
    expect(container.textContent).toContain("DOM distillation");
  });
});
