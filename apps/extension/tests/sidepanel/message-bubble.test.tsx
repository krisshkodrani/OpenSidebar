import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import { MessageBubble } from "../../src/sidepanel/components/MessageBubble";
import { useStore } from "../../src/sidepanel/store";
import type { ChatEntry, TaskCompletionMessage } from "../../src/types";

function completionPayload(
  overrides: Partial<TaskCompletionMessage["payload"]> = {},
): TaskCompletionMessage["payload"] {
  return {
    taskId: "task-1",
    status: "completed",
    summary: "Final answer",
    totalTurnsUsed: 2,
    totalTimeMs: 1000,
    subtaskResults: [],
    urlHistory: [],
    ...overrides,
  };
}

function assistantMessage(overrides: Partial<ChatEntry> = {}): ChatEntry {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "",
    timestamp: 1000,
    toolCalls: [],
    isStreaming: false,
    ...overrides,
  };
}

function userMessage(overrides: Partial<ChatEntry> = {}): ChatEntry {
  return {
    id: "user-1",
    role: "user",
    content: "User prompt",
    timestamp: 1000,
    toolCalls: [],
    isStreaming: false,
    ...overrides,
  };
}

describe("MessageBubble final answer rendering", () => {
  let container: HTMLDivElement;
  let root: Root;
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    useStore.setState({
      settings: { showMessageDetailsByDefault: false },
    } as any);
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

  test("keeps the same final answer body when completion metadata arrives", async () => {
    const finalAnswer =
      "Wikipedia Homepage Summary\n\n" +
      "Overview: The Wikipedia homepage links to language editions, search, sister projects, and footer resources.";

    await act(async () => {
      root.render(
        <MessageBubble
          message={assistantMessage({
            content: finalAnswer,
            isStreaming: true,
          })}
        />,
      );
    });

    expect(container.textContent).toContain(finalAnswer);
    expect(container.textContent).not.toContain("Done");

    await act(async () => {
      root.render(
        <MessageBubble
          message={assistantMessage({
            content: finalAnswer,
            completionData: completionPayload({ summary: finalAnswer }),
          })}
        />,
      );
    });

    expect(container.textContent).toContain("Done");
    expect(container.textContent).toContain("Wikipedia Homepage Summary");
    expect(container.textContent).toContain("footer resources.");
    expect(
      (container.textContent || "").indexOf("Wikipedia Homepage Summary"),
    ).toBeLessThan((container.textContent || "").indexOf("Done"));
  });

  test("copy action uses the visible final answer body", async () => {
    const visibleAnswer = "Full visible answer with the final sentence.";

    await act(async () => {
      root.render(
        <MessageBubble
          message={assistantMessage({
            content: visibleAnswer,
            completionData: completionPayload({
              summary: "Short completion summary",
            }),
          })}
        />,
      );
    });

    const copyButton = container.querySelector(
      'button[aria-label="Copy answer"]',
    ) as HTMLButtonElement | null;
    expect(copyButton).toBeTruthy();

    await act(async () => {
      copyButton!.click();
    });

    expect(writeText).toHaveBeenCalledWith(visibleAnswer);
  });

  test("keeps completion details collapsed until requested", async () => {
    await act(async () => {
      root.render(
        <MessageBubble
          message={assistantMessage({
            content: "Task completed.",
            completionData: completionPayload({
              subtaskResults: [
                {
                  description: "Read the page",
                  result: "Page was read",
                  status: "completed",
                  turnsUsed: 1,
                },
              ],
            }),
          })}
        />,
      );
    });

    expect(container.textContent).toContain("Details (1 step)");
    expect(container.textContent).not.toContain("Read the page");

    const detailsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Details"),
    ) as HTMLButtonElement | undefined;
    expect(detailsButton).toBeTruthy();

    await act(async () => {
      detailsButton!.click();
    });

    expect(container.textContent).toContain("Read the page");
  });

  test("renders completion summary when no streamed body exists", async () => {
    await act(async () => {
      root.render(
        <MessageBubble
          message={assistantMessage({
            completionData: completionPayload({
              summary: "Only final summary arrived.",
            }),
          })}
        />,
      );
    });

    expect(container.textContent).toContain("Done");
    expect(container.textContent).toContain("Only final summary arrived.");
  });

  test("does not render hidden thinking metadata as chat text", async () => {
    await act(async () => {
      root.render(
        <MessageBubble
          message={assistantMessage({
            isStreaming: true,
            thinking: "write\n\na\n\nproper\n\nsummary",
          })}
        />,
      );
    });

    expect(container.textContent).not.toContain("write");
    expect(container.textContent).not.toContain("proper");
    expect(container.textContent).not.toContain("Thinking");
  });

  test("constrains long user prompts so they cannot consume the panel", async () => {
    const longPrompt = Array.from(
      { length: 60 },
      (_, index) => `Line ${index + 1}: keep this visible but scrollable.`,
    ).join("\n");

    await act(async () => {
      root.render(
        <MessageBubble message={userMessage({ content: longPrompt })} />,
      );
    });

    const bubble = Array.from(container.querySelectorAll("div")).find(
      (node) => node.textContent === longPrompt,
    ) as HTMLDivElement | undefined;

    expect(bubble).toBeTruthy();
    expect(bubble!.className).toContain("max-h-[30vh]");
    expect(bubble!.className).toContain("overflow-y-auto");
    expect(bubble!.className).toContain("break-words");
  });

  test("renders passive watch messages without glow shadow", async () => {
    await act(async () => {
      root.render(
        <MessageBubble
          message={assistantMessage({
            content: "Look for the option that mentions shared responsibility.",
            isPassive: true,
          })}
        />,
      );
    });

    expect(container.textContent).toContain("Watching");
    expect(container.textContent).toContain("shared responsibility");
    const passiveBubble = Array.from(container.querySelectorAll("div")).find(
      (node) =>
        node.textContent?.includes("shared responsibility") &&
        node.className.includes("border-sky"),
    ) as HTMLDivElement | undefined;
    expect(passiveBubble).toBeTruthy();
    expect(passiveBubble!.className).not.toContain("shadow-[");
  });
});
