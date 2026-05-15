import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import PromptsTab from "../../src/trace-viewer/components/traces/PromptsTab";
import SkillsTab from "../../src/trace-viewer/components/traces/SkillsTab";

const session = {
  sessionId: "session-1",
  startTime: 0,
  endTime: 1,
  query: "Objective",
  startUrl: "https://example.com",
  outcome: "completed",
  turnCount: 2,
  summary: "done",
  metrics: null,
} as any;

describe("trace-viewer prompt and skill tabs", () => {
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

  test("PromptsTab renders recorded messages and partial availability", async () => {
    await act(async () => {
      root.render(
        <PromptsTab
          session={session}
          entries={
            [
              {
                sessionId: "session-1",
                turnNumber: 1,
                timestamp: 10,
                llmRequest: {
                  model: "model-a",
                  modelTier: "executor",
                  messages: [{ role: "system", content: "System instructions" }],
                },
              },
              {
                sessionId: "session-1",
                turnNumber: 2,
                timestamp: 20,
                llmRequest: { model: "model-a" },
              },
            ] as any
          }
        />,
      );
    });

    expect(container.textContent).toContain("System instructions");
    expect(container.textContent).toContain("1 of 2 turns include prompt messages");
    expect(container.textContent).not.toContain("coming soon");
  });

  test("SkillsTab does not synthesize events from aggregate metrics", async () => {
    await act(async () => {
      root.render(
        <SkillsTab
          session={{
            ...session,
            skillToolMetrics: {
              skillId: "job-search",
              rankingApplications: 1,
              totalSelections: 0,
              preferredSelections: 0,
              neutralSelections: 0,
              discouragedSelections: 0,
              preferredSelectionRate: 0,
              discouragedSelectionRate: 0,
            },
          }}
          entries={[]}
        />,
      );
    });

    expect(container.textContent).toContain("No skill events recorded.");
    expect(container.textContent).not.toContain("Applied rankings for job-search");
  });
});
