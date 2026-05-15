import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import { StepTimeline } from "../../src/sidepanel/components/StepTimeline";
import type { AgentStep } from "../../src/types";

function step(overrides: Partial<AgentStep>): AgentStep {
  return {
    id: "step-1",
    type: "tool",
    label: "Executor: Read page",
    status: "done",
    timestamp: 1000,
    ...overrides,
  };
}

describe("StepTimeline", () => {
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

  test("does not render generic thinking steps", async () => {
    await act(async () => {
      root.render(
        <StepTimeline
          steps={[
            step({
              id: "thinking-1",
              type: "thinking",
              label: "Executor: Thinking...",
              status: "running",
            }),
            step({
              id: "tool-1",
              label: "Executor: Read page",
            }),
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("Scanning page");
    expect(container.textContent).not.toContain("Thinking");
  });

  test("hides completed diagnostics when user-facing steps are present", async () => {
    await act(async () => {
      root.render(
        <StepTimeline
          steps={[
            step({
              id: "tool-1",
              label: "Executor: Read page",
              toolName: undefined,
              status: "done",
            }),
            step({
              id: "tool-2",
              label: "Executor: Toggle X-ray mode",
              toolName: undefined,
              status: "done",
            }),
            step({
              id: "tool-3",
              label: 'Click "Advance" button',
              status: "done",
            }),
          ]}
        />,
      );
    });

    expect(container.textContent).toContain('Click "Advance" button');
    expect(container.textContent).toContain("2 earlier steps");
    expect(container.textContent).not.toContain("Scanning page");
    expect(container.textContent).not.toContain("X-ray");
  });
});
