import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import PlanTab from "../../src/trace-viewer/components/traces/PlanTab";
import { useStore } from "../../src/trace-viewer/store";

function resetStore() {
  useStore.setState((useStore as any).getInitialState(), true);
}

describe("PlanTab", () => {
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

  test("shows run planner activity when the executor session has no embedded plan", async () => {
    useStore.setState({
      currentRunEvents: [
        {
          runId: "run-1",
          ts: "2026-04-28T11:35:10.488Z",
          type: "planner_llm_call",
          role: "planner",
          data: {
            phase: "plan_decomposition",
            model: "accounts/fireworks/routers/kimi-k2p5-turbo",
            durationMs: 1200,
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
              cost: 0.001,
            },
          },
        },
        {
          runId: "run-1",
          ts: "2026-04-28T11:35:10.488Z",
          type: "plan_decomposed",
          role: "planner",
          data: {
            nodeCount: 4,
            structured: true,
            difficulty: "moderate",
            skills: [
              {
                nodeId: "node-1",
                skillId: "paginated-record-lookup",
                reason: "Record lookup workflow.",
              },
            ],
          },
        },
        {
          runId: "run-1",
          ts: "2026-04-28T11:35:10.497Z",
          type: "node_started",
          role: "executor",
          data: { nodeId: "node-1", retries: 0, dependencyCount: 0 },
        },
        {
          runId: "run-1",
          ts: "2026-04-28T11:35:40.905Z",
          type: "node_verified",
          role: "verifier",
          data: {
            nodeId: "node-1",
            decision: "accept",
            confidence: 0.85,
            reason: "Evidence supports progress.",
          },
        },
      ],
    } as any);

    await act(async () => {
      root.render(
        <PlanTab
          session={
            {
              sessionId: "session-1",
              runId: "run-1",
              query: "Objective: WorkArena task",
              startUrl: "https://example.com",
              outcome: "max_turns",
              startTime: 100,
              endTime: 300,
              turnCount: 1,
              summary: "stopped",
              metrics: null,
            } as any
          }
        />,
      );
    });

    expect(container.textContent).toContain("Run Planner Activity");
    expect(container.textContent).toContain("run trace");
    expect(container.textContent).toContain("moderate");
    expect(container.textContent).toContain("Plan Nodes");
    expect(container.textContent).toContain("4");
    expect(container.textContent).toContain("Planner LLM Calls");
    expect(container.textContent).toContain("plan_decomposition");
    expect(container.textContent).toContain("kimi-k2p5-turbo");
    expect(container.textContent).toContain("paginated-record-lookup");
    expect(container.textContent).toContain("Run Event Timeline");
    expect(container.textContent).toContain("planner_llm_call");
    expect(container.textContent).toContain("plan_decomposed");
    expect(container.textContent).toContain("node_verified");
  });

  test("keeps the empty-state message when no session or run plan data exists", async () => {
    await act(async () => {
      root.render(
        <PlanTab
          session={
            {
              sessionId: "session-1",
              query: "Objective: no plan",
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

    expect(container.textContent).toContain(
      "No plan decomposition available for this session.",
    );
  });
});
