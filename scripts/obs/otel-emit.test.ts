import { afterEach, describe, expect, it } from "vitest";

import { spanId } from "../../packages/observability-schema/src/hash";
import type { ObsSpan } from "../../packages/observability-schema/src/spans";
import {
  emitObsSpans,
  emitSessionRoots,
  flushSpineOtelExport,
  initSpineOtelExport,
  resetSpineOtelExport,
} from "./otel-emit";
import { selectSessions } from "./export-otel";

/** Structural stand-in for the wire span shape the fake exporter receives. */
interface CapturedSpan {
  name: string;
  kind: number;
  spanContext: () => { traceId: string; spanId: string };
  parentSpanContext?: { traceId: string; spanId: string };
  startTime: [number, number];
  endTime: [number, number];
  status: { code: number; message?: string };
  attributes: Record<string, unknown>;
  events: Array<{ name: string; attributes: Record<string, unknown> }>;
  ended: boolean;
}

function fakeExporter() {
  const batches: CapturedSpan[][] = [];
  return {
    batches,
    all: () => batches.flat(),
    export(spans: unknown[], cb: (r: { code: number }) => void) {
      batches.push(spans as CapturedSpan[]);
      cb({ code: 0 });
    },
    async shutdown() {},
  };
}

function obsSpan(over: Partial<ObsSpan> = {}): ObsSpan {
  return {
    traceId: "corr-123",
    spanId: spanId("s1", "turn", 1),
    parentSpanId: spanId("s1"),
    name: "agent.turn",
    kind: "agent.turn",
    startTimeUnixMs: 1_700_000_000_123,
    endTimeUnixMs: 1_700_000_001_500,
    attributes: { "os.session_id": "s1", "os.turn_number": 1 },
    ...over,
  };
}

async function setup() {
  const exporter = fakeExporter();
  await initSpineOtelExport({ exporter });
  return exporter;
}

afterEach(async () => {
  await resetSpineOtelExport();
});

describe("otel-emit span mapping", () => {
  it("remaps the spine traceId to a deterministic 32-hex W3C id", async () => {
    const exporter = await setup();
    emitObsSpans([obsSpan(), obsSpan({ spanId: spanId("s1", "turn", 2) })]);
    emitObsSpans([obsSpan({ traceId: "other-corr", spanId: spanId("x") })]);
    await flushSpineOtelExport();

    const spans = exporter.all();
    const first = spans[0].spanContext().traceId;
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(spans[1].spanContext().traceId).toBe(first);
    expect(spans[2].spanContext().traceId).not.toBe(first);
  });

  it("preserves spine span/parent ids verbatim", async () => {
    const exporter = await setup();
    emitObsSpans([obsSpan()]);
    await flushSpineOtelExport();

    const [span] = exporter.all();
    expect(span.spanContext().spanId).toBe(spanId("s1", "turn", 1));
    expect(span.parentSpanContext?.spanId).toBe(spanId("s1"));
  });

  it("converts epoch ms to HrTime and marks spans ended", async () => {
    const exporter = await setup();
    emitObsSpans([obsSpan()]);
    await flushSpineOtelExport();

    const [span] = exporter.all();
    expect(span.startTime).toEqual([1_700_000_000, 123_000_000]);
    expect(span.endTime).toEqual([1_700_000_001, 500_000_000]);
    expect(span.ended).toBe(true);
  });

  it("redacts PII in string attributes, events, and status messages", async () => {
    const exporter = await setup();
    emitObsSpans([
      obsSpan({
        attributes: { "os.title": "contact kris@example.com today" },
        events: [
          {
            name: "note",
            timeUnixMs: 1_700_000_000_500,
            attributes: { detail: "call 030-123-4567 x" },
          },
        ],
        status: { code: "error", message: "failed for kris@example.com" },
      }),
    ]);
    await flushSpineOtelExport();

    const [span] = exporter.all();
    expect(span.attributes["os.title"]).toContain("[redacted:email]");
    expect(String(span.events[0].attributes.detail)).not.toContain("030-123");
    expect(span.status.message).toContain("[redacted:email]");
  });

  it("ships blob refs as attributes, never blob payloads", async () => {
    const exporter = await setup();
    emitObsSpans([
      obsSpan({
        blobs: [{ ref: "sha256:abc", kind: "screenshot", bytes: 12345 }],
      }),
    ]);
    await flushSpineOtelExport();

    const [span] = exporter.all();
    expect(span.attributes["os.blob.screenshot"]).toBe("sha256:abc");
    expect(JSON.stringify(span)).not.toContain("12345");
  });

  it("maps kinds and error status", async () => {
    const exporter = await setup();
    emitObsSpans([
      obsSpan({ kind: "gen_ai.chat", name: "gen_ai.chat" }),
      obsSpan({
        kind: "execute_tool",
        name: "execute_tool click",
        spanId: spanId("t"),
        status: { code: "error", message: "boom" },
      }),
    ]);
    await flushSpineOtelExport();

    const [chat, tool] = exporter.all();
    expect(chat.kind).not.toBe(tool.kind); // CLIENT vs INTERNAL
    expect(tool.status.code).toBe(2); // SpanStatusCode.ERROR
  });

  it("drops synthetic no-op perception spans but keeps real ones (#99)", async () => {
    const exporter = await setup();
    emitObsSpans([
      obsSpan({
        kind: "gen_ai.perception",
        name: "gen_ai.perception",
        spanId: spanId("p-noop"),
        attributes: { "gen_ai.request.model": "none (unified VL)" },
      }),
      obsSpan({
        kind: "gen_ai.perception",
        name: "gen_ai.perception",
        spanId: spanId("p-budget"),
        attributes: { "gen_ai.request.model": "none (image budget)" },
      }),
      obsSpan({
        kind: "gen_ai.perception",
        name: "gen_ai.perception",
        spanId: spanId("p-real"),
        attributes: { "gen_ai.request.model": "gemma-4-31b" },
      }),
    ]);
    await flushSpineOtelExport();

    const models = exporter
      .all()
      .map((s) => s.attributes["gen_ai.request.model"]);
    expect(models).toEqual(["gemma-4-31b"]);
  });

  it("caps oversized string attributes", async () => {
    const exporter = await setup();
    emitObsSpans([obsSpan({ attributes: { "os.query": "x".repeat(9000) } })]);
    await flushSpineOtelExport();

    const [span] = exporter.all();
    expect(String(span.attributes["os.query"]).length).toBeLessThanOrEqual(4001);
  });

  it("exports in batches of at most 256 spans", async () => {
    const exporter = await setup();
    emitObsSpans(
      Array.from({ length: 600 }, (_, i) => obsSpan({ spanId: spanId("b", i) })),
    );
    await flushSpineOtelExport();

    expect(exporter.all()).toHaveLength(600);
    for (const batch of exporter.batches) {
      expect(batch.length).toBeLessThanOrEqual(256);
    }
  });

  it("is a no-op when never initialized", async () => {
    // No setup() — module state was reset by afterEach.
    emitObsSpans([obsSpan()]);
    emitSessionRoots({ sessionId: "s1", startTime: 1 });
    await flushSpineOtelExport(); // must not hang or throw
  });
});

describe("otel-emit session roots", () => {
  it("synthesizes run and session roots with the ids turn spans parent to", async () => {
    const exporter = await setup();
    emitSessionRoots({
      sessionId: "s1",
      runId: "r1",
      correlationId: "corr-123",
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_009_000,
      query: "book a table",
      outcome: "completed",
      turnCount: 4,
    });
    await flushSpineOtelExport();

    const [run, session] = exporter.all();
    expect(run.name).toBe("orchestrator.run");
    expect(run.spanContext().spanId).toBe(spanId("r1", "run"));
    expect(session.name).toBe("agent.session");
    // MUST equal what map-trace-entry parents turn spans to.
    expect(session.spanContext().spanId).toBe(spanId("s1"));
    expect(session.parentSpanContext?.spanId).toBe(spanId("r1", "run"));
    // Same remapped trace id as a turn span with correlationId "corr-123".
    expect(session.spanContext().traceId).toBe(run.spanContext().traceId);
  });

  it("omits the run root and parent when the session has no runId", async () => {
    const exporter = await setup();
    emitSessionRoots({ sessionId: "s1", startTime: 1, outcome: "failed" });
    await flushSpineOtelExport();

    const spans = exporter.all();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("agent.session");
    expect(spans[0].parentSpanContext).toBeUndefined();
    expect(spans[0].status.code).toBe(2); // failed → ERROR
  });
});

describe("export-otel session selection", () => {
  const sessions = [
    { sessionId: "a", runId: "r1", outcome: "completed", startTime: 100 },
    { sessionId: "b", runId: "r2", outcome: "failed", startTime: 200 },
    { sessionId: "c", outcome: "completed", startTime: 300 },
  ];

  it("filters by session, run, outcome, and time range", () => {
    expect(selectSessions(sessions, { session: "b", limit: 10 })).toHaveLength(1);
    expect(selectSessions(sessions, { run: "r1", limit: 10 })[0].sessionId).toBe("a");
    expect(
      selectSessions(sessions, { outcome: "completed", limit: 10 }).map(
        (s) => s.sessionId,
      ),
    ).toEqual(["c", "a"]);
    expect(
      selectSessions(sessions, { from: 150, to: 250, limit: 10 })[0].sessionId,
    ).toBe("b");
  });

  it("sorts newest-first and applies the limit", () => {
    const picked = selectSessions(sessions, { limit: 2 });
    expect(picked.map((s) => s.sessionId)).toEqual(["c", "b"]);
  });
});
