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

    expect(container.textContent).toContain("Executor: Read page");
    expect(container.textContent).not.toContain("Thinking");
  });
});
