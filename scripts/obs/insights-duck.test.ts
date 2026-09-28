import { strict as assert } from "node:assert";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { expect, test } from "vitest";
import type { TraceEntryLike, TraceSessionLike } from "../log-server-helpers";
import type { TraceInsightsFilters, TraceInsightsResponse, TraceInsightsSummary } from "../trace-insights";
import { buildTraceInsightsFromSqlite, insertRunTraceEventToSqlite, insertTraceTurnToSqlite, upsertTraceSessionToSqlite } from "../trace-sqlite-store";
import { buildParquetSnapshot } from "./duck";
import { readDuckSelectedSessionIds } from "./insights-filter";
import { readDuckEventRows, readDuckEventTypeFacets, readDuckFailureFacets, readDuckFailureRows, readDuckInsightsResponse, readDuckModelRows, readDuckRunRows, readDuckSessionFacets, readDuckSkillRows, readDuckSummary, readDuckToolRows, readDuckWorkflowFacets } from "./insights-duck";

function expectResponseClose(actual: unknown, expected: unknown, path: string): void {
  if (typeof actual === "number" && typeof expected === "number") {
    expect(actual, path).toBeCloseTo(expected, 10);
  } else if (Array.isArray(actual) && Array.isArray(expected)) {
    expect(actual.length, `${path}.length`).toBe(expected.length);
    actual.forEach((item, index) => expectResponseClose(item, expected[index], `${path}[${index}]`));
  } else if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    const left = actual as Record<string, unknown>;
    const right = expected as Record<string, unknown>;
    expect(Object.keys(left).sort(), `${path} keys`).toEqual(Object.keys(right).sort());
    for (const key of Object.keys(left))
      expectResponseClose(left[key], right[key], `${path}.${key}`);
  } else {
    expect(actual, path).toEqual(expected);
  }
}

test("DuckDB summary matches SQLite for all and filtered sessions", async () => {
  const root = mkdtempSync(join(tmpdir(), "opensidebar-duck-insights-"));
  assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}`));
  try {
    const spanDir = join(root, "spans");
    const dbPath = join(root, "trace-index.sqlite");
    const cases = [
      { id: "s1", runId: "r1", outcome: "completed", cost: 0.1,
        startUrl: "https://ONE.example/path",
        model: "openai/gpt-oss-120b", actualModel: "", provider: "groq",
        tools: [{ toolName: "click", success: true, durationMs: 12 },
          { toolName: "read", success: false, result: "not found", durationMs: 8 }],
        usage: { prompt_tokens: 2, completion_tokens: 1, cached_tokens: 1,
          total_tokens: 4, cost: 0.02 }, durationMs: 100, partialHandoff: null,
        turnEvents: [{ type: "escalation" },
          { type: "escalation_outcome", data: { outcome: "rescued" } }],
        sessionEvents: [] },
      { id: "s2", runId: "r2", outcome: "failed", cost: 0.2,
        startUrl: "https://one.example/other",
        model: "unknown-model", actualModel: "", provider: "unknown",
        tools: [{ toolName: "click", success: false, error: "blocked", durationMs: 5 }],
        usage: { input_tokens: 3, output_tokens: 2,
          cacheTelemetry: { cachedPromptTokens: 5 }, cost: 0.03 }, durationMs: 0,
        partialHandoff: null, turnEvents: [],
        sessionEvents: [{ type: "stuck_signal", data: { type: "escalate" } },
          { type: "escalation_outcome", data: { outcome: "failed_fast" } }] },
      { id: "s3", runId: "r3", outcome: "max_turns", cost: 0,
        startUrl: "https://two.example/",
        model: "fixture-model", actualModel: "", provider: "unknown",
        tools: [], usage: {}, durationMs: 0, partialHandoff: null,
        turnEvents: [], sessionEvents: [{ type: "escalation_outcome",
          data: { outcome: "budget_exhausted" } }] },
      { id: "s4", runId: "r4", outcome: "max_turns", cost: 0,
        startUrl: "https://two.example/next",
        model: "wrong-model", actualModel: "openai/gpt-oss-120b", provider: "",
        tools: [], usage: { prompt_tokens: 4, completion_tokens: 1,
          prompt_tokens_details: { cached_tokens: 2 } }, durationMs: 0,
        partialHandoff: { currentState: { url: "https://example.com" } },
        turnEvents: [{ type: "escalation" }, { type: "escalation" }],
        sessionEvents: [{ type: "stuck_signal", data: { type: "escalate" } }] },
      { id: "s5", runId: "r5", outcome: "max_turns", cost: 0,
        startUrl: "",
        model: "fixture-model", actualModel: "", provider: "unknown",
        tools: [], usage: {}, durationMs: 0, partialHandoff: {},
        turnEvents: [], sessionEvents: [] },
    ] as const;
    for (const item of cases) {
      const dir = join(spanDir, item.id);
      mkdirSync(dir, { recursive: true });
      const session = {
        sessionId: item.id, runId: item.runId, outcome: item.outcome,
        failureCode: item.id === "s3" ? "tool_error" : undefined,
        failureCategory: item.id === "s4" ? "category-x" : undefined,
        startUrl: item.startUrl,
        startTime: Date.UTC(2026, 8, 25), endTime: Date.UTC(2026, 8, 25, 0, 1),
        turnCount: 1, metrics: { totalCost: item.cost,
          ...(item.id === "s5" ? { modelBreakdown: { "breakdown-model": {} } } : {}) },
        models: item.id === "s1"
          ? ["accounts/fireworks/routers/openai/gpt-oss-120b:nitro"]
          : item.id === "s2" ? ["unknown-model"]
            : item.id === "s4" ? ["openai/gpt-oss-120b"] : [],
        skillToolMetrics: item.id === "s1" ? { skillId: "skill-one" } : undefined,
        planDecomposition: item.id === "s1" ? { steps: [{ selectedSkillId: "skill-one" }] }
          : item.id === "s2" ? { steps: [{ selectedSkillId: "skill-two" }] }
          : item.id === "s4" ? { steps: [{ selectedSkillId: "skill-one" }] } : undefined,
        partialHandoff: item.partialHandoff,
        events: item.sessionEvents,
      } as TraceSessionLike;
      const entry = {
        sessionId: item.id, runId: item.runId, turnNumber: 1,
        timestamp: Date.UTC(2026, 8, 25),
        llmRequest: item.id === "s5" ? undefined : { model: item.model,
          modelTier: item.id === "s1" ? "executor" : "planner" },
        llmResponse: item.id === "s5" ? undefined : {
          actualModel: item.actualModel, actualProviderId: item.provider,
          usage: item.usage, durationMs: item.durationMs,
        },
        toolExecutions: item.tools,
        events: item.turnEvents,
      } as TraceEntryLike;
      writeFileSync(join(dir, "session.json"), JSON.stringify(session));
      writeFileSync(join(dir, "T1.json"), JSON.stringify({
        v: 1, entry,
        spans: [
          { traceId: item.runId, spanId: `turn-${item.id}`,
            kind: "agent.turn", name: "agent.turn", startTimeUnixMs: entry.timestamp },
          ...item.tools.map((tool, index) => ({
            traceId: item.runId, spanId: `tool-${item.id}-${index}`,
            kind: "execute_tool", name: `execute_tool ${tool.toolName}`,
            startTimeUnixMs: entry.timestamp,
            status: { code: tool.success ? "ok" : "error" },
          })),
        ],
      }));
      upsertTraceSessionToSqlite(root, session, { dbPath });
      insertTraceTurnToSqlite(root, entry, { dbPath });
    }
    const runsDir = join(spanDir, "runs");
    mkdirSync(runsDir, { recursive: true });
    for (const event of [
      { runId: "r1", type: "task_completed",
        data: { classification: "ignored_success", success: true } },
      { runId: "r2", type: "task_completed",
        data: { classification: "auth_failure", success: false } },
      { runId: "r2", type: "task_completed", seq: 2,
        data: { classification: "auth_failure", success: false } },
      { runId: "r3", type: "task_completed",
        data: { classification: "tool_error", success: false } },
      { runId: "r5", type: "task_completed",
        data: { classification: "tool_error", success: false } },
      { runId: "orphan", type: "orphan_event" },
    ]) {
      appendFileSync(join(runsDir, `${event.runId}.jsonl`), `${JSON.stringify(event)}\n`);
      insertRunTraceEventToSqlite(root, event as TraceEntryLike, { dbPath });
    }
    const snapshot = join(root, "snapshot");
    await buildParquetSnapshot(spanDir, snapshot);
    for (const prefix of ["", "s1", "missing"]) {
      const expected = buildTraceInsightsFromSqlite(root, { sessionId: prefix }, dbPath);
      assert.ok(expected);
      const facets = await readDuckSessionFacets(snapshot, prefix);
      expect(facets, `${prefix || "all"}: session facets`).toEqual({
        runs: expected.facets.runs,
        sessions: expected.facets.sessions,
        domains: expected.facets.domains,
      });
      expect(await readDuckEventTypeFacets(snapshot, prefix),
        `${prefix || "all"}: event types`).toEqual(expected.facets.eventTypes);
      expect(await readDuckFailureFacets(snapshot, prefix),
        `${prefix || "all"}: failure labels`).toEqual(expected.facets.failures);
      const byId = <T extends { id: string }>(rows: T[]) =>
        [...rows].sort((a, b) => a.id.localeCompare(b.id));
      expect(await readDuckEventRows(snapshot, prefix),
        `${prefix || "all"}: event rows`).toEqual(expected.events);
      expect(byId(await readDuckFailureRows(snapshot, prefix)),
        `${prefix || "all"}: failure rows`).toEqual(byId(expected.failures));
      expect(byId(await readDuckSkillRows(snapshot, prefix)),
        `${prefix || "all"}: skill rows`).toEqual(byId(expected.skills));
      expect(byId(await readDuckToolRows(snapshot, prefix)),
        `${prefix || "all"}: tool rows`).toEqual(byId(expected.tools));
      const actualModels = await readDuckModelRows(snapshot, prefix);
      expect(actualModels.map((row) => row.id),
        `${prefix || "all"}: model order`).toEqual(expected.models.map((row) => row.id));
      const models = byId(actualModels);
      const expectedModels = byId(expected.models);
      expect(models.map((row) => row.id)).toEqual(expectedModels.map((row) => row.id));
      for (const [index, model] of models.entries()) {
        const expectedModel = expectedModels[index];
        expect(Object.keys(model).sort()).toEqual(Object.keys(expectedModel).sort());
        for (const key of Object.keys(model) as Array<keyof typeof model>) {
          if (typeof model[key] === "number" && typeof expectedModel[key] === "number")
            expect(model[key], `${prefix || "all"}: ${model.id}.${key}`)
              .toBeCloseTo(expectedModel[key], 10);
          else expect(model[key], `${prefix || "all"}: ${model.id}.${key}`)
            .toEqual(expectedModel[key]);
        }
      }
      expect(await readDuckWorkflowFacets(snapshot, prefix),
        `${prefix || "all"}: workflow facets`).toEqual({
        models: expected.facets.models,
        skills: expected.facets.skills,
        tools: expected.facets.tools,
      });
      const byRunId = <T extends { runId: string }>(rows: T[]) =>
        [...rows].sort((a, b) => a.runId.localeCompare(b.runId));
      expect(byRunId(await readDuckRunRows(snapshot, prefix)),
        `${prefix || "all"}: run rows`).toEqual(byRunId(expected.runs));
      const actual = await readDuckSummary(snapshot, prefix);
      expect(Object.keys(actual).sort()).toEqual(Object.keys(expected.summary).sort());
      const keys = Object.keys(actual) as Array<keyof TraceInsightsSummary>;
      for (const key of keys)
        expect(actual[key], `${prefix || "all"}: ${key}`).toBeCloseTo(expected.summary[key], 10);
      const response: TraceInsightsResponse =
        await readDuckInsightsResponse(snapshot, { sessionId: prefix });
      expectResponseClose(response, expected, `${prefix || "all"}: full response`);
    }
    for (const filters of [
      { day: "2026-09-25" }, { from: "2026-09-25", to: "2026-09-25" },
      { outcome: "max_turns" }, { domain: "ONE.EXAMPLE" }, { runId: "r2" },
      { sessionPrefix: "s3" }, { q: "other" }, { model: "openai/gpt-oss-120b" },
      { mode: "agent" }, { tier: "executor" }, { skill: "skill-one" },
      { failure: "tool_error" }, { tool: "read" }, { toolStatus: "failure" },
      { tool: "click", toolStatus: "success" }, { eventType: "task_completed" },
      { eventType: "escalation" },
      { outcome: "completed", tool: "click", eventType: "task_completed" },
    ] satisfies TraceInsightsFilters[]) {
      const expected = buildTraceInsightsFromSqlite(root, filters, dbPath);
      assert.ok(expected);
      expect(await readDuckSelectedSessionIds(snapshot, filters),
        JSON.stringify(filters)).toEqual(expected.facets.sessions);
      expectResponseClose(await readDuckInsightsResponse(snapshot, filters), expected,
        `${JSON.stringify(filters)}: full response`);
    }
    const manifestPath = join(snapshot, "snapshot.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, formatVersion: 4,
      turnUsage: undefined }));
    const legacyExpected = buildTraceInsightsFromSqlite(root, {}, dbPath);
    assert.ok(legacyExpected);
    expectResponseClose(await readDuckInsightsResponse(snapshot), legacyExpected,
      "v4 raw-turn fallback");
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, formatVersion: 3,
      toolCalls: undefined, turnUsage: undefined }));
    const legacyToolFilter = { tool: "click", toolStatus: "failure" };
    const legacyToolExpected = buildTraceInsightsFromSqlite(root, legacyToolFilter, dbPath);
    assert.ok(legacyToolExpected);
    expectResponseClose(await readDuckInsightsResponse(snapshot, legacyToolFilter),
      legacyToolExpected, "v3 tool-call fallback");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 180_000);
