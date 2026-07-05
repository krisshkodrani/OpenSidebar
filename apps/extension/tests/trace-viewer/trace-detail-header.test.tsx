import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import TraceDetailHeader from "../../src/trace-viewer/components/traces/TraceDetailHeader";
import { useStore } from "../../src/trace-viewer/store";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

describe("TraceDetailHeader", () => {
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

  test("renders per-session skill policy metrics when present", async () => {
    useStore.setState({
      currentEntries: [],
    } as any);

    await act(async () => {
      root.render(
        <TraceDetailHeader
          session={
            {
              sessionId: "session-1",
              query: "Objective: clear overlays",
              startUrl: "https://example.com",
              outcome: "completed",
              startTime: 100,
              endTime: 300,
              turnCount: 2,
              summary: "done",
              metrics: { totalCost: 0.1 },
              skillToolMetrics: {
                skillId: "modal-overlay-recovery",
                rankingApplications: 2,
                totalSelections: 5,
                preferredSelections: 2,
                neutralSelections: 1,
                discouragedSelections: 2,
                preferredSelectionRate: 0.4,
                discouragedSelectionRate: 0.4,
              },
            } as any
          }
        />,
      );
    });

    const detailsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Show details",
    ) as HTMLButtonElement | undefined;
    expect(detailsButton).toBeTruthy();

    await act(async () => {
      detailsButton!.click();
    });

    expect(container.textContent).toContain("Skill Policy");
    expect(container.textContent).toContain("modal-overlay-recovery");
    expect(container.textContent).toContain("2 rankings");
    expect(container.textContent).toContain("5 picks");
    expect(container.textContent).toContain("Preferred");
    expect(container.textContent).toContain("40%");
    expect(container.textContent).toContain("Discouraged");
    expect(container.textContent).toContain("middle-path picks");
  });

  test("renders coordination state and workflow redirects", async () => {
    useStore.setState({
      currentEntries: [
        {
          sessionId: "session-1",
          turnNumber: 1,
          timestamp: 100,
          snapshot: {
            url: "https://example.com/list",
            title: "List",
            elementCount: 3,
            visibleContentLength: 10,
            scrollY: 0,
          },
          elements: [],
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
          toolExecutions: [],
          events: [
            {
              type: "workflow_tab_redirect",
              timestamp: 110,
              data: {
                controllerId: "cross-tab-compare",
                toolName: "create_tab",
              },
            },
          ],
          progressState: { stagnantTurns: 0, signal: null },
        },
      ],
      currentRunEvents: [
        {
          runId: "run-1",
          ts: "2026-04-23T10:00:00.000Z",
          type: "tab_coordination_state",
          data: {
            action: "node_bound",
            primaryTabId: 10,
            lastReboundTabId: 10,
            ownedTabCount: 2,
            nodeBindingCount: 1,
            ownedTabs: [
              { tabId: 10, role: "primary", createdByTask: false },
              { tabId: 11, role: "comparison", createdByTask: true },
            ],
          },
        },
        {
          runId: "run-1",
          ts: "2026-04-23T10:01:00.000Z",
          type: "task_resume_rebinding_rejected",
          data: { reason: "Multiple live workspace tabs match." },
        },
      ],
    } as any);

    await act(async () => {
      root.render(
        <TraceDetailHeader
          session={
            {
              sessionId: "session-1",
              runId: "run-1",
              query: "Objective: compare pages",
              startUrl: "https://example.com",
              outcome: "completed",
              startTime: 100,
              endTime: 300,
              turnCount: 1,
              summary: "done",
              metrics: null,
            } as any
          }
        />,
      );
    });

    const detailsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Show details",
    ) as HTMLButtonElement | undefined;
    expect(detailsButton).toBeTruthy();

    await act(async () => {
      detailsButton!.click();
    });

    expect(container.textContent).toContain("Coordination");
    expect(container.textContent).toContain("1 state events");
    expect(container.textContent).toContain("1 redirects");
    expect(container.textContent).toContain("1 unsafe rebinds");
    expect(container.textContent).toContain("cross-tab-compare: 1");
    expect(container.textContent).toContain(
      "Multiple live workspace tabs match.",
    );
  });

  test("renders session-level partial handoff summary", async () => {
    useStore.setState({
      currentEntries: [],
    } as any);

    await act(async () => {
      root.render(
        <TraceDetailHeader
          session={
            {
              sessionId: "session-partial",
              query: "Objective: summarize page",
              startUrl: "https://example.com/article",
              outcome: "max_turns",
              startTime: 100,
              endTime: 300,
              turnCount: 2,
              summary: "partial",
              metrics: null,
              partialHandoff: {
                schemaVersion: "2026-05-26",
                reason: "max_turns",
                status: "partial_handoff",
                task: "Summarize page",
                generatedAt: "2026-05-26T00:00:00.000Z",
                turnsUsed: 2,
                maxTurns: 2,
                completed: [],
                evidence: [
                  {
                    label: "Page evidence",
                    value: "Attention and positional encoding were observed.",
                    source: "read_page",
                    turn: 1,
                  },
                ],
                currentState: {
                  title: "Transformer Architecture",
                  url: "https://example.com/article",
                },
                remaining: [
                  {
                    text: "Finish the summary.",
                    confidence: "medium",
                    source: "planner",
                  },
                ],
                uncertainty: [],
                suggestedContinuationPrompt: "Continue from the handoff.",
              },
            } as any
          }
        />,
      );
    });

    expect(container.textContent).toContain("partial_handoff");
    expect(container.textContent).toContain("max_turns after 2/2 turns");
    expect(container.textContent).toContain("Page evidence");
    expect(container.textContent).toContain("Finish the summary");
  });
});
