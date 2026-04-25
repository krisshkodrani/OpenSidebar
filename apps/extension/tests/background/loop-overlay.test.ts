import { describe, test, expect, vi, beforeEach } from "vitest";
import "../setup";

// Mock modules before importing AgentLoop
vi.mock("../../src/background/llm", () => ({
  LLMClient: class {
    private model = "accounts/fireworks/routers/kimi-k2p5-turbo";
    _isPlannerTier = false;
    complete = vi.fn(() =>
      Promise.resolve({
        role: "assistant",
        content: "done",
        tool_calls: undefined,
        finish_reason: "stop",
      }),
    );
    completeStream = vi.fn((_req: any, onDelta: (d: string) => void) => {
      onDelta("ok");
      return Promise.resolve({
        role: "assistant",
        content: "ok",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "done", arguments: '{"summary":"done"}' },
          },
        ],
        finish_reason: "stop",
      });
    });
    switchToPlanner = vi.fn(() => {
      this.model = "accounts/fireworks/routers/kimi-k2p5-turbo"; this._isPlannerTier = true;
    });
    switchToExecutor = vi.fn(() => {
      this.model = "accounts/fireworks/routers/kimi-k2p5-turbo"; this._isPlannerTier = false;
    });
    isPlannerTier = () => this._isPlannerTier;
    getCurrentModel = () => this.model;
    getCurrentProvider = () => "fireworks";
    setFailoverCallback = vi.fn(() => {});
    getActiveProviderInfo = () => ({
      providerId: "fireworks",
      model: this.model,
    });
  },
  MODEL_EXECUTOR: "accounts/fireworks/routers/kimi-k2p5-turbo",
  MODEL_PLANNER: "accounts/fireworks/routers/kimi-k2p5-turbo",
  stripThinkTags: (text: string) =>
    text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
  extractThinkContent: () => null,
}));

vi.mock("../../src/background/keepalive", () => ({
  startKeepalive: vi.fn(async () => {}),
  stopKeepalive: vi.fn(async () => {}),
}));

import { AgentLoop } from "../../src/background/agent/loop";

// Track chrome.tabs.sendMessage calls
let tabMessages: any[] = [];

function createLoop() {
  const onStatus = vi.fn();
  const onMessage = vi.fn();
  const onStep = vi.fn();
  const agent = new AgentLoop(
    "test-key",
    {
      onStatusUpdate: onStatus,
      onMessage: onMessage,
      onStep: onStep,
    },
    { maxTurns: 3 },
  );
  return { agent, onStatus, onMessage, onStep };
}

describe("Reactive overlay dismissal — no pre-loop DISMISS_MODALS", () => {
  beforeEach(() => {
    tabMessages = [];
    // Override chrome.tabs.sendMessage to track calls
    (chrome.tabs as any).sendMessage = vi.fn(
      async (_tabId: number, msg: any) => {
        tabMessages.push(msg);
        if (msg.type === "DOM_SNAPSHOT_REQUEST") {
          return {
            type: "DOM_SNAPSHOT_RESPONSE",
            requestId: msg.requestId,
            source: "content",
            payload: {
              snapshot: {
                title: "Test",
                url: "https://test.com",
                elements: [],
                visibleContent: "",
                viewport: { width: 1024, height: 768 },
                scroll: { x: 0, y: 0, maxY: 0 },
              },
              durationMs: 1,
            },
          };
        }
        if (msg.type === "TOOL_EXECUTE") {
          return {
            type: "TOOL_RESULT",
            requestId: msg.requestId,
            source: "content",
            payload: {
              toolCallId: msg.payload.toolCallId,
              success: true,
              result: "OK",
              navigated: false,
            },
          };
        }
        return { payload: { result: "ok" } };
      },
    );
  });

  test("loop does not send DISMISS_MODALS before the first LLM turn", async () => {
    const { agent } = createLoop();
    await agent.start("test", 123, undefined, { clearHistory: true });

    const dismissMessages = tabMessages.filter(
      (m) => m.type === "DISMISS_MODALS",
    );
    expect(dismissMessages.length).toBe(0);
  });

  test("loop completes normally without proactive overlay dismissal", async () => {
    const { agent } = createLoop();
    const result = await agent.start("click the button", 123, undefined, {
      clearHistory: true,
    });

    expect(result).toBeDefined();
    expect(result.outcome).toBeDefined();
    expect(result.turnCount).toBeGreaterThanOrEqual(1);
  });

  test("first message to content script is not DISMISS_MODALS", async () => {
    const { agent } = createLoop();
    await agent.start("test", 123, undefined, { clearHistory: true });

    // The first tab message should NOT be DISMISS_MODALS
    if (tabMessages.length > 0) {
      expect(tabMessages[0].type).not.toBe("DISMISS_MODALS");
    }
  });
});
