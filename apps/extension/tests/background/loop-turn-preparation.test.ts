import { describe, expect, test, vi } from "vitest";
import { ToolName, type ToolDefinition } from "../../src/types";
import { CompressionLevel } from "../../src/background/agent/context-types";
import { prepareLlmTurnRequest } from "../../src/background/agent/loop-turn-preparation";
import type { LLMMessage } from "../../src/background/llm/types";

function makeTool(name: ToolName): ToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description: name,
      parameters: { type: "object", properties: {}, required: [] },
    },
  };
}

const messages: LLMMessage[] = [
  { role: "system", content: "System\n## Page Context\n..." },
  { role: "user", content: "Do it" },
];

const metrics = {
  systemTokens: 120,
  historyTokens: 30,
  totalTokens: 150,
  maxTokens: 1000,
  utilization: 0.15,
  elementCount: 3,
  compressionLevel: CompressionLevel.NONE,
};

function makeContext(overrides = {}) {
  return {
    getPrompt: vi.fn(() => messages),
    getPromptMetricsFrom: vi.fn(() => metrics),
    getSnapshot: vi.fn(() => ({
      url: "https://example.test/page",
      title: "Example",
      visibleContent: "Visible text",
      pageContent: "Full page text",
      scroll: { y: 12 },
      elements: [
        {
          tag: 1,
          tagName: "button",
          text: "Submit",
          role: "button",
          attributes: {},
          isVisible: true,
          isInteractive: true,
        },
      ],
    })),
    getHistoryLength: vi.fn(() => 4),
    consumePrefixReset: vi.fn(() => null),
    ...overrides,
  };
}

function makePerception(overrides = {}) {
  return {
    getInterpretation: vi.fn(() => null),
    getLastTraceMeta: vi.fn(() => ({
      mode: "structured",
      source: "fresh",
      freshnessReason: "new_fingerprint",
      screenshotStatus: "captured",
    })),
    getLastTraceStats: vi.fn(() => ({
      model: "accounts/fireworks/routers/kimi-k2p6-turbo",
      providerId: "fireworks",
      durationMs: 1234,
      cached: false,
    })),
    getLastScreenshot: vi.fn(() => null),
    ...overrides,
  };
}

describe("prepareLlmTurnRequest", () => {
  test("builds prompt, selects tools, logs metrics, and initializes previous element count", async () => {
    const allTools = [
      makeTool(ToolName.READ_PAGE),
      makeTool(ToolName.CLICK_ELEMENT),
    ];
    const log = { info: vi.fn() };

    const result = await prepareLlmTurnRequest({
      turnCount: 2,
      previousElementCount: -1,
      context: makeContext() as never,
      allTools,
      selectTools: (tools) => tools.slice(1),
      llm: {
        getCurrentModel: () => "executor-model",
        isPlannerTier: () => false,
      },
      perception: makePerception() as never,
      log,
      traceRecorder: null,
    });

    expect(result.messages).not.toBe(messages);
    // #107: the catalog is volatile (its bytes change with the tool SET), so it
    // goes LAST. It used to sit at the end of message 0, ahead of all history,
    // where one tool-set change invalidated the whole cached history prefix.
    const catalogMessage = result.messages[result.messages.length - 1];
    expect(catalogMessage.content).toContain("## Available Tool Capabilities");
    expect(catalogMessage.content).toContain("click_elements: click_element");
    // The system message must stay free of it — that is the whole point.
    expect(result.messages[0]?.content).not.toContain(
      "## Available Tool Capabilities",
    );
    expect(result.messages[1]).toBe(messages[1]);
    expect(result.tools).toEqual([allTools[1]]);
    expect(result.previousElementCount).toBe(3);
    expect(log.info).toHaveBeenCalledWith(
      "agent",
      "Context metrics",
      expect.objectContaining({
        turn: 2,
        totalTokens: 150,
        utilization: "15%",
        elements: 3,
        toolCount: 1,
      }),
    );
  });

  test("starts trace turn and backfills first-turn perception", async () => {
    const traceRecorder = {
      startTurn: vi.fn(),
      recordPerception: vi.fn(async () => {}),
    };
    const perception = makePerception({
      getInterpretation: vi.fn(() => "The page is ready."),
      getLastScreenshot: vi.fn(() => "data:image/jpeg;base64,abc"),
    });

    await prepareLlmTurnRequest({
      turnCount: 1,
      previousElementCount: 9,
      context: makeContext() as never,
      allTools: [makeTool(ToolName.READ_PAGE)],
      selectTools: (tools) => tools,
      llm: {
        getCurrentModel: () => "planner-model",
        isPlannerTier: () => true,
      },
      perception: perception as never,
      log: { info: vi.fn() },
      traceRecorder: traceRecorder as never,
    });

    expect(traceRecorder.startTurn).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        url: "https://example.test/page",
        title: "Example",
        elementCount: 3,
        visibleContentLength: 12,
        pageContentLength: 14,
        scrollY: 12,
      }),
      expect.any(Array),
      150,
      1,
      "planner-model",
      "none",
      expect.any(Array),
      expect.objectContaining({
        totalTokens: 150,
        droppedMessageCount: 3,
        // Turn 1: nothing was cached yet, so the stable-prefix length is 0.
        cachedPrefixLength: 0,
        promptPrefix: expect.objectContaining({
          firstDivergenceRegion: "none",
          firstDivergenceOffset: null,
        }),
        // Populations built from different prompt templates are not comparable,
        // so every turn records which template produced it.
        promptTemplate: expect.objectContaining({
          id: "agent.system",
          version: expect.any(String),
          hash: expect.any(String),
        }),
      }),
      "planner",
    );
    expect(traceRecorder.recordPerception).toHaveBeenCalledWith(
      expect.objectContaining({
        interpretation: "The page is ready.",
        model: "accounts/fireworks/routers/kimi-k2p6-turbo",
        providerId: "fireworks",
        durationMs: 1234,
        cached: false,
        mode: "structured",
      }),
      "data:image/jpeg;base64,abc",
      expect.stringContaining("1 buttons"),
    );
  });
});
