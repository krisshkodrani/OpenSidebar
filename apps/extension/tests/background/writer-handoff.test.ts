import "../setup";
import { describe, test, expect, vi } from "vitest";
import {
  isAuthoredProse,
  isFreeTextField,
  runWriterHandoff,
} from "../../src/background/agent/writer-handoff";
import type { AgentLoopToolHandlerHost } from "../../src/background/agent/loop-tool-handlers";
import { ToolName } from "../../src/types";

function el(overrides: Record<string, unknown> = {}) {
  return {
    tag: 5,
    tagName: "textarea",
    role: "textbox",
    text: "",
    attributes: {},
    rect: { x: 0, y: 0, width: 0, height: 0 },
    isVisible: true,
    isDisabled: false,
    ...overrides,
  } as any;
}

describe("writer scope detection", () => {
  test("isFreeTextField: textarea / contenteditable / multiline textbox are in scope", () => {
    expect(isFreeTextField(el({ tagName: "textarea" }))).toBe(true);
    expect(
      isFreeTextField(el({ tagName: "div", attributes: { contenteditable: "true" } })),
    ).toBe(true);
    expect(
      isFreeTextField(
        el({ tagName: "div", role: "textbox", attributes: { "aria-multiline": "true" } }),
      ),
    ).toBe(true);
  });

  test("isFreeTextField: short structured inputs are out of scope", () => {
    expect(isFreeTextField(el({ tagName: "input", attributes: { type: "text" } }))).toBe(
      false,
    );
    expect(isFreeTextField(el({ tagName: "select" }))).toBe(false);
    expect(isFreeTextField(null)).toBe(false);
  });

  test("isAuthoredProse: only substantial multi-word text qualifies", () => {
    expect(isAuthoredProse("ok")).toBe(false);
    expect(isAuthoredProse("noSpacesButQuiteLongStringWithoutAnyWhitespaceAtAll1234567890")).toBe(
      false,
    );
    expect(
      isAuthoredProse(
        "I am genuinely excited about this role because it matches my experience.",
      ),
    ).toBe(true);
    expect(isAuthoredProse(123)).toBe(false);
  });
});

function makeHost(opts: {
  composed?: string;
  composeThrows?: boolean;
  attributes?: Record<string, string>;
} = {}) {
  const typed: Array<{ id: number; text: string }> = [];
  const composeText = opts.composeThrows
    ? vi.fn(async () => {
        throw new Error("writer down");
      })
    : vi.fn(async () => ({
        text: opts.composed ?? "Because I am passionate about the work.",
        model: "writer/x",
        providerId: "openrouter",
      }));
  const host = {
    originalQuery: "Apply for the role",
    turnCount: 3,
    context: {
      getSnapshot: () => ({
        elements: [
          el({
            tag: 5,
            attributes: {
              label: "Why do you want this job?",
              ...(opts.attributes ?? {}),
            },
          }),
        ],
      }),
    },
    llm: { composeText },
    executeToolCall: vi.fn(async (tc: any) => {
      typed.push(JSON.parse(tc.function.arguments));
      return "Typed.";
    }),
    refreshSnapshotWithRetry: vi.fn(async () => 1),
    refreshPerceptionAndTriage: vi.fn(async () => {}),
    stepHandler: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn() },
    traceRecorder: { recordEvent: vi.fn() },
  } as unknown as AgentLoopToolHandlerHost;
  return { host, typed, composeText };
}

describe("runWriterHandoff", () => {
  test("composes prose and types it into the target field", async () => {
    const { host, typed, composeText } = makeHost();
    const result = await runWriterHandoff(host, 1, {
      id: 5,
      instructions: "Answer the question",
    });

    expect(composeText).toHaveBeenCalledTimes(1);
    // The field question and task should reach the writer brief.
    const brief = composeText.mock.calls[0][0].userPrompt as string;
    expect(brief).toContain("Why do you want this job?");
    expect(brief).toContain("Apply for the role");

    expect(typed).toEqual([
      { id: 5, text: "Because I am passionate about the work." },
    ]);

    const tc = (host.executeToolCall as any).mock.calls[0][0];
    expect(tc.function.name).toBe(ToolName.TYPE_TEXT);

    expect(result).toContain("[5]");
    expect(result).toContain("Do NOT retype");
  });

  test("falls back to the executor when composition fails (no type performed)", async () => {
    const { host, typed } = makeHost({ composeThrows: true });
    const result = await runWriterHandoff(host, 1, { id: 5, instructions: "x" });
    expect(typed).toHaveLength(0);
    expect(result.toLowerCase()).toContain("writer unavailable");
  });

  test("enforces a field maxlength by truncating overflowing output", async () => {
    const long = "x".repeat(50);
    const { host, typed } = makeHost({
      composed: long,
      attributes: { maxlength: "10" },
    });
    await runWriterHandoff(host, 1, { id: 5, instructions: "x" });
    expect(typed[0].text.length).toBe(10);
  });
});
