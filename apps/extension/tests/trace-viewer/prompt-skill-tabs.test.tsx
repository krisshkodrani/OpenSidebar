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
    expect(container.textContent).toContain("1/2 requests");
    expect(container.textContent).toContain("0/2 responses");
    expect(container.textContent).toContain("2 incomplete");
    expect(container.textContent).not.toContain("coming soon");
  });

  test("PromptsTab groups repeated system prompts and keeps details available", async () => {
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
                  messages: [
                    { role: "system", content: "System instructions ".repeat(20) },
                    { role: "user", content: "Do the thing" },
                  ],
                },
              },
              {
                sessionId: "session-1",
                turnNumber: 2,
                timestamp: 20,
                llmRequest: {
                  model: "model-a",
                  modelTier: "executor",
                  messages: [
                    { role: "system", content: "System instructions ".repeat(20) },
                    { role: "user", content: "Do the thing" },
                  ],
                },
              },
            ] as any
          }
        />,
      );
    });

    expect(container.textContent).toContain("T1–T2");
    expect(container.textContent).toContain("Full system prompt");
    expect(container.textContent).toContain("Full request (2 messages)");
  });

  test("PromptsTab renders tokenized think blocks as readable content", async () => {
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
                  messages: [
                    {
                      role: "assistant",
                      content:
                        "<think>The</think><think> user</think><think> wants</think> me to click.",
                    },
                  ],
                },
              },
            ] as any
          }
        />,
      );
    });

    expect(container.textContent).toContain("Thinking: The user wants");
    const fullRequest = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Full request (1 messages)"),
    );
    await act(async () => {
      fullRequest!.click();
    });
    expect(container.textContent).toContain("Recorded reasoning");
    expect(container.textContent).not.toContain("<think>");
  });

  test("PromptsTab pairs exact requests, responses, tool calls, and outcomes", async () => {
    await act(async () => {
      root.render(
        <PromptsTab
          session={session}
          entries={
            [
              {
                sessionId: "session-1",
                turnNumber: 4,
                timestamp: 10,
                llmRequest: {
                  model: "model-a",
                  modelTier: "executor",
                  messageCount: 2,
                  toolCount: 1,
                  compressionLevel: "LIGHT",
                  messages: [
                    { role: "system", content: "Use recorded evidence." },
                    { role: "user", content: "Find the annual hiring number." },
                  ],
                },
                llmResponse: {
                  content: "I will read the article.",
                  toolCalls: [
                    {
                      id: "call-1",
                      function: {
                        name: "read_page",
                        arguments: '{"query":"annual hires"}',
                      },
                    },
                  ],
                  finishReason: "tool_calls",
                  usage: {
                    prompt_tokens: 100,
                    completion_tokens: 20,
                    total_tokens: 120,
                    cost: 0.002,
                  },
                  durationMs: 900,
                },
                toolExecutions: [
                  {
                    toolCallId: "call-1",
                    toolName: "read_page",
                    args: { query: "annual hires" },
                    result: "The company hires 100 people each year.",
                    success: true,
                    durationMs: 30,
                    riskLevel: "read-only",
                  },
                ],
              },
            ] as any
          }
        />,
      );
    });

    expect(container.textContent).toContain("Request");
    expect(container.textContent).toContain("Response");
    expect(container.textContent).toContain("Find the annual hiring number.");
    expect(container.textContent).toContain("I will read the article.");
    expect(container.textContent).toContain("read_page");
    expect(container.textContent).toContain(
      "The company hires 100 people each year.",
    );
    expect(container.textContent).toContain("Recorded tool outcomes");
  });

  test("PromptsTab mounts large request bodies only when opened", async () => {
    const longPrompt = `${"System rule. ".repeat(40)}UNIQUE_PROMPT_TAIL`;
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
                  messages: [{ role: "system", content: longPrompt }],
                },
                llmResponse: {
                  content: "done",
                  toolCalls: [],
                  finishReason: "stop",
                  usage: null,
                  durationMs: 10,
                },
                toolExecutions: [],
              },
            ] as any
          }
        />,
      );
    });

    expect(container.textContent).not.toContain("UNIQUE_PROMPT_TAIL");
    const fullRequest = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Full request (1 messages)"),
    );
    expect(fullRequest).toBeTruthy();

    await act(async () => {
      fullRequest!.click();
    });

    expect(container.textContent).toContain("UNIQUE_PROMPT_TAIL");
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
