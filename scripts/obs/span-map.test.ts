import { describe, expect, it } from "vitest";

import { traceEntryToSpans } from "../../packages/observability-schema/src/index";
import type { TraceEntry } from "../../packages/shared-types/src/traces";

const entry = {
  sessionId: "sess-1",
  correlationId: "corr-1",
  turnNumber: 2,
  timestamp: 1000,
  snapshot: {
    url: "https://ex.com/x",
    title: "X",
    elementCount: 7,
    visibleContentLength: 50,
    scrollY: 0,
  },
  elements: [],
  llmRequest: {
    model: "model-a",
    modelTier: "planner",
    messageCount: 3,
    toolCount: 1,
    compressionLevel: "NONE",
  },
  llmResponse: {
    content: "ok",
    toolCalls: [],
    finishReason: "tool_calls",
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      cost: 0.002,
      cached_tokens: 64,
      cacheTelemetry: { provider: "anthropic", cacheHitPct: 64, source: "usage" },
    },
    durationMs: 300,
    actualModel: "model-a-served",
    actualProviderId: "openrouter",
  },
  toolExecutions: [
    {
      toolCallId: "tc1",
      toolName: "read_page",
      args: {},
      result: "ok",
      success: true,
      durationMs: 10,
      riskLevel: "LOW",
    },
    {
      toolCallId: "tc2",
      toolName: "click",
      args: {},
      result: "fail",
      success: false,
      error: "not found",
      durationMs: 5,
      riskLevel: "MEDIUM",
    },
  ],
  events: [{ type: "escalation" }],
  progressState: { stagnantTurns: 1, signal: null },
  perception: {
    interpretation: "a page",
    model: "vlm-x",
    durationMs: 40,
    mode: "structured",
    cached: false,
    screenshotPath: "/shots/sess-1-T2.jpg",
  },
} as unknown as TraceEntry;

describe("traceEntryToSpans", () => {
  const spans = traceEntryToSpans(entry);
  const byKind = (k: string) => spans.filter((s) => s.kind === k);

  it("emits the turn, chat, per-tool, and perception spans", () => {
    expect(byKind("agent.turn")).toHaveLength(1);
    expect(byKind("gen_ai.chat")).toHaveLength(1);
    expect(byKind("execute_tool")).toHaveLength(2);
    expect(byKind("gen_ai.perception")).toHaveLength(1);
  });

  it("links children to the turn span and the turn to the session", () => {
    const turn = byKind("agent.turn")[0];
    for (const child of spans.filter((s) => s.kind !== "agent.turn")) {
      expect(child.parentSpanId).toBe(turn.spanId);
    }
    expect(turn.parentSpanId).toBeDefined();
    expect(turn.parentSpanId).not.toBe(turn.spanId);
  });

  it("maps gen_ai usage + cost onto the chat span", () => {
    const chat = byKind("gen_ai.chat")[0];
    expect(chat.attributes["gen_ai.request.model"]).toBe("model-a");
    expect(chat.attributes["gen_ai.usage.input_tokens"]).toBe(100);
    expect(chat.attributes["gen_ai.usage.output_tokens"]).toBe(20);
    expect(chat.attributes["os.cost_usd"]).toBe(0.002);
  });

  it("exports prompt-cache usage onto the chat span for Bluebox to watch", () => {
    const chat = byKind("gen_ai.chat")[0];
    expect(chat.attributes["os.usage.cached_tokens"]).toBe(64);
    expect(chat.attributes["os.cache.hit_pct"]).toBe(64);
  });

  it("records tool success/failure as span status", () => {
    const tools = byKind("execute_tool");
    expect(tools.find((t) => t.name.includes("read_page"))?.status?.code).toBe("ok");
    const failed = tools.find((t) => t.name.includes("click"));
    expect(failed?.status?.code).toBe("error");
    expect(failed?.status?.message).toBe("not found");
  });

  it("references heavy payloads as blobs, never inline", () => {
    const turn = byKind("agent.turn")[0];
    expect(turn.blobs?.some((b) => b.kind === "dom_snapshot")).toBe(true);
    const perception = byKind("gen_ai.perception")[0];
    expect(perception.blobs?.some((b) => b.kind === "screenshot")).toBe(true);
  });

  it("is deterministic — identical span ids across calls", () => {
    const again = traceEntryToSpans(entry);
    expect(again.map((s) => s.spanId)).toEqual(spans.map((s) => s.spanId));
  });
});
