import { describe, expect, test } from "vitest";
import "../setup";
import {
  getSessionModels,
  matchesTraceFilters,
  normalizeAgentSessionRecord,
  serializeTraceSearchSession,
} from "../../../../scripts/log-server-helpers";

describe("log-server helpers", () => {
  test("normalizeAgentSessionRecord backfills correlation and models from metrics", () => {
    const normalized = normalizeAgentSessionRecord({
      sessionId: "session-1",
      runId: "run-1",
      startTime: Date.UTC(2026, 3, 15, 9, 30, 0),
      endTime: Date.UTC(2026, 3, 15, 9, 31, 0),
      query: "Objective: verify trace normalization",
      startUrl: "https://example.com",
      outcome: "completed",
      turnCount: 3,
      summary: "done",
      metrics: {
        modelBreakdown: {
          "openai/gpt-5.4-mini:nitro": { calls: 2 },
        },
      },
    });

    expect(normalized.correlationId).toBe("run-1");
    expect(normalized.parentRunId).toBe("run-1");
    expect(normalized.models).toEqual(["openai/gpt-5.4-mini"]);
    expect(normalized.recordedAt).toBe("2026-04-15T09:31:00.000Z");
  });

  test("getSessionModels merges stored and derived models without duplicates", () => {
    expect(
      getSessionModels({
        models: ["manual", "openai/gpt-5.4-mini:nitro"],
        metrics: {
          modelBreakdown: {
            "openai/gpt-5.4-mini:nitro": { calls: 2 },
            "openai/gpt-5.4": { calls: 1 },
          },
        },
      } as any),
    ).toEqual(["manual", "openai/gpt-5.4-mini", "openai/gpt-5.4"]);
  });

  test("matchesTraceFilters combines domain, mode, model, tier, runId, and query", () => {
    const session = normalizeAgentSessionRecord({
      sessionId: "session-1",
      runId: "run-123",
      startTime: Date.UTC(2026, 3, 15, 9, 30, 0),
      endTime: Date.UTC(2026, 3, 15, 9, 31, 0),
      query: "Objective: Check billing page",
      startUrl: "https://app.example.com/billing",
      outcome: "completed",
      turnCount: 4,
      summary: "done",
      skillToolMetrics: { skillId: "form-fill" },
      metrics: {
        modelBreakdown: {
          "openai/gpt-5.4-mini:nitro": { calls: 4 },
        },
      },
    });
    const entries = [
      { llmRequest: { modelTier: "planner" } },
      { llmRequest: { modelTier: "executor" } },
    ];

    expect(
      matchesTraceFilters(
        session,
        {
          from: "2026-04-10",
          to: "2026-04-15",
          domain: "example.com",
          outcome: "completed",
          mode: "agent",
          model: "openai/gpt-5.4-mini:nitro",
          skill: "form-fill",
          tier: "planner",
          runId: "run-12",
          q: "billing",
        },
        entries as any,
      ),
    ).toBe(true);

    expect(
      matchesTraceFilters(session, { skill: "catalog-order" }, entries as any),
    ).toBe(false);

    expect(
      matchesTraceFilters(
        session,
        {
          model: "openai/gpt-5.4",
          tier: "planner",
        },
        entries as any,
      ),
    ).toBe(false);

    expect(
      matchesTraceFilters(
        {
          ...session,
          models: ["manual"],
        },
        {
          mode: "agent",
        },
        entries as any,
      ),
    ).toBe(false);
  });

  test("serializeTraceSearchSession strips hydrated entries before API responses", () => {
    const serialized = serializeTraceSearchSession({
      sessionId: "session-1",
      startTime: Date.UTC(2026, 3, 15, 9, 30, 0),
      startUrl: "https://app.example.com/billing",
      outcome: "completed",
      _entries: [{ llmRequest: { modelTier: "planner" } }],
    });

    expect(serialized.day).toBe("2026-04-15");
    expect(serialized.domain).toBe("app.example.com");
    expect("_entries" in serialized).toBe(false);
  });
});
