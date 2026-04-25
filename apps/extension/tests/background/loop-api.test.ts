import { describe, test, expect, vi, beforeEach } from "vitest";
import "../setup";
import { AgentStatus } from "../../src/types";

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
        tool_calls: undefined,
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
    resetExecutorFallback = vi.fn();
    getActiveProviderInfo = () => ({
      providerId: "fireworks",
      model: this.model,
    });
  },
  MODEL_EXECUTOR: "accounts/fireworks/routers/kimi-k2p5-turbo",
  MODEL_PLANNER: "accounts/fireworks/routers/kimi-k2p5-turbo",
  stripThinkTags: (text: string) =>
    text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
  extractThinkContent: (text: string) => {
    const blocks: string[] = [];
    const re = /<think>([\s\S]*?)<\/think>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const inner = m[1].trim();
      if (inner) blocks.push(inner);
    }
    return blocks.length > 0 ? blocks.join("\n\n") : null;
  },
}));

vi.mock("../../src/background/keepalive", () => ({
  startKeepalive: vi.fn(async () => {}),
  stopKeepalive: vi.fn(async () => {}),
}));

import { AgentLoop } from "../../src/background/agent/loop";

function createLoop(overrides?: Record<string, any>) {
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
    { maxTurns: 5, ...overrides },
  );
  return { agent, onStatus, onMessage, onStep };
}

describe("AgentLoop Public API", () => {
  beforeEach(() => {
    // Ensure chrome mocks are fully set up for loop.ts usage
    globalThis.chrome = globalThis.chrome || ({} as any);
    globalThis.chrome.runtime = {
      ...globalThis.chrome.runtime,
      sendMessage: vi.fn(async () => {}),
      onMessage: {
        addListener: () => {},
        removeListener: () => {},
      },
    } as any;
    globalThis.chrome.storage = {
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
      },
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
      },
      sync: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
      },
    } as any;
    globalThis.chrome.tabs = {
      ...globalThis.chrome.tabs,
      sendMessage: vi.fn(async () => ({
        payload: { result: "ok", success: true },
      })),
    } as any;
  });

  describe("injectFeedback", () => {
    test("stores hint text without throwing", () => {
      const { agent } = createLoop();
      expect(() =>
        agent.injectFeedback("Try clicking the submit button"),
      ).not.toThrow();
    });

    test("overwrites previous hint without throwing", () => {
      const { agent } = createLoop();
      agent.injectFeedback("first hint");
      expect(() => agent.injectFeedback("second hint")).not.toThrow();
    });
  });

  describe("getCurrentTurn / getOriginalQuery", () => {
    test("getCurrentTurn returns 0 before start", () => {
      const { agent } = createLoop();
      expect(agent.getCurrentTurn()).toBe(0);
    });

    test("getOriginalQuery returns empty string before start", () => {
      const { agent } = createLoop();
      expect(agent.getOriginalQuery()).toBe("");
    });

    test("getOriginalQuery returns the initial text after start", async () => {
      const { agent } = createLoop();
      await agent.start("Navigate to settings", 123);
      expect(agent.getOriginalQuery()).toBe("Navigate to settings");
    });

    test("getCurrentTurn is positive after loop runs", async () => {
      const { agent } = createLoop();
      await agent.start("Hello", 123);
      expect(agent.getCurrentTurn()).toBeGreaterThan(0);
    });
  });

  describe("pause / resume / isPaused", () => {
    test("isPaused is false initially", () => {
      const { agent } = createLoop();
      expect(agent.isPaused()).toBe(false);
    });

    test("pause sets isPaused to true and emits PAUSED status", () => {
      const { agent, onStatus } = createLoop();
      agent.pause();
      expect(agent.isPaused()).toBe(true);
      expect(onStatus).toHaveBeenCalledWith(
        AgentStatus.PAUSED,
        "Paused by user",
      );
    });

    test("resume clears pause gate and emits THINKING status", () => {
      const { agent, onStatus } = createLoop();
      agent.pause();
      expect(agent.isPaused()).toBe(true);

      agent.resume();
      expect(agent.isPaused()).toBe(false);
      expect(onStatus).toHaveBeenCalledWith(AgentStatus.THINKING, "Resumed");
    });

    test("resume is a no-op when not paused", () => {
      const { agent, onStatus } = createLoop();
      agent.resume();
      expect(agent.isPaused()).toBe(false);
      expect(onStatus).not.toHaveBeenCalled();
    });

    test("double pause is idempotent", () => {
      const { agent, onStatus } = createLoop();
      agent.pause();
      agent.pause();
      expect(agent.isPaused()).toBe(true);
      const pausedCalls = onStatus.mock.calls.filter(
        (c: any[]) => c[0] === AgentStatus.PAUSED,
      );
      expect(pausedCalls).toHaveLength(1);
    });
  });

  describe("stop resolves pause gate", () => {
    test("stop resolves dangling pause to prevent Promise leak", () => {
      const { agent } = createLoop();
      agent.pause();
      expect(agent.isPaused()).toBe(true);

      agent.stop();
      expect(agent.isPaused()).toBe(false);
    });
  });

  describe("LoopResult", () => {
    test("start returns LoopResult with outcome and turnCount", async () => {
      const { agent } = createLoop();
      const result = await agent.start("Hello", 123);

      expect(result).toHaveProperty("outcome");
      expect(result).toHaveProperty("turnCount");
      expect(result).toHaveProperty("summary");
      expect(typeof result.turnCount).toBe("number");
      expect(result.turnCount).toBeGreaterThan(0);
    });

    test("start returns completed or max_turns outcome when text-only LLM exhausts turn budget", async () => {
      const { agent } = createLoop();
      const result = await agent.start("Hello", 123);
      // With maxTurns=5 and text-only LLM: nudge→pivot→nudge→escalate+pivot→nudge
      // Agent runs all 5 turns without hitting give-up (needs 7), so outcome is max_turns or completed
      expect(["max_turns", "completed"]).toContain(result.outcome);
    });
  });

  describe("getStagnationMonitor", () => {
    test("returns a StagnationMonitor instance", () => {
      const { agent } = createLoop();
      const pt = agent.getStagnationMonitor();
      expect(pt).toBeDefined();
      expect(typeof pt.reset).toBe("function");
      expect(typeof pt.onSnapshotRefresh).toBe("function");
    });
  });

  describe("402 credit exhaustion", () => {
    test("returns outcome error with provider failure info on 402", async () => {
      const { agent, onStatus } = createLoop();

      // Override completeStream to throw a 402 error on first call
      const llm = (agent as any).llm;
      llm.completeStream = vi.fn(() => {
        const err = new Error("Insufficient credits") as any;
        err.status = 402;
        throw err;
      });

      const result = await agent.start("Hello", 123);

      expect(result.outcome).toBe("error");
      expect(result.failure).toBeDefined();
      expect(result.failure!.category).toBe("provider");
      expect(result.failure!.code).toBe("credits_exhausted");

      // Should have broadcast ERROR status
      const errorCalls = onStatus.mock.calls.filter(
        (c: any[]) => c[0] === AgentStatus.ERROR,
      );
      expect(errorCalls.length).toBeGreaterThan(0);
      expect(errorCalls[0][1]).toBe("Insufficient credits");

      // Should have broadcast a user-friendly stream message via chrome.runtime.sendMessage
      const sendCalls = (chrome.runtime.sendMessage as any).mock.calls;
      const streamChunks = sendCalls
        .map((c: any[]) => c[0])
        .filter((m: any) => m?.type === "STREAM_CHUNK");
      const textChunks = streamChunks
        .map((m: any) => m.payload?.delta)
        .filter(Boolean);
      const combined = textChunks.join("");
      expect(combined).toContain("fireworks.ai");
    });
  });
});
