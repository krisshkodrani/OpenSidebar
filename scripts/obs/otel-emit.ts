/**
 * Spine → Bluebox OTLP span emitter (observability unification).
 *
 * The span spine (`traces/spans/`, see span-store.ts) is already OTel-shaped:
 * `ObsSpan` carries gen_ai.* semantic conventions, primitive attributes, and
 * CAS refs for heavy payloads. This module is the missing wire adapter — it
 * maps `ObsSpan[]` to ReadableSpan-shaped objects and hands them DIRECTLY to
 * the OTLP proto exporter (`exporter.export(spans, cb)`), bypassing the tracer
 * API so deterministic historical ids and timestamps survive:
 *
 *   - W3C traceId = sha256(spine traceId).slice(0, 32) — identical for the
 *     live hook and the backfill CLI, so re-exports carry the SAME ids.
 *   - spanId/parentSpanId: the spine's deterministic 16-hex ids, verbatim.
 *   - agent.session root = spanId(sessionId) (what turn spans parent to);
 *     orchestrator.run root = spanId(runId, "run").
 *
 * Export boundary rules (this is where data leaves the machine):
 *   - `redactPii` on every string attribute/event value and status message —
 *     the spine itself is unredacted by design.
 *   - String values capped at 4000 chars (Dynatrace attribute limits).
 *   - Blobs (screenshots/DOM/prompts) are NEVER shipped; only `os.blob.<kind>`
 *     ref attributes ride along.
 *
 * Default-off like every Bluebox surface: without OTEL_EXPORTER_OTLP_ENDPOINT
 * (or repo-root .env.otel) `initSpineOtelExport()` returns false and every
 * emit call is a cheap no-op. Emission never throws into callers — the
 * log-server drain path must be unbreakable.
 */

import { createHash } from "node:crypto";

import {
  SpanKind,
  SpanStatusCode,
  type Attributes,
  type HrTime,
} from "@opentelemetry/api";
import type { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";

import { spanId } from "../../packages/observability-schema/src/hash";
import type { ObsSpan } from "../../packages/observability-schema/src/spans";
import { defaultResourceAttributes, loadOtelEnv } from "../otel/sdk";
import { redactPiiInText } from "./redact";

export const SPINE_EXPORT_SERVICE = "opensidebar-agent-runtime";
const MAX_ATTR_CHARS = 4000;
const BATCH_SIZE = 256;
const QUEUE_CAP = 10_000;

/** The exporter's own input element type — structurally a ReadableSpan. */
type WireSpan = Parameters<OTLPTraceExporter["export"]>[0][number];

interface ExporterLike {
  export(
    spans: WireSpan[],
    resultCallback: (result: { code: number; error?: Error }) => void,
  ): void;
  shutdown(): Promise<void>;
}

/** Loose session record as stored in the spine's session.json. */
export type SpineSessionRecord = Record<string, unknown>;

let exporter: ExporterLike | null = null;
let resource: unknown = null;
let queue: WireSpan[] = [];
let dropped = 0;
let inFlight: Promise<void> = Promise.resolve();
let initialized = false;

/**
 * Initialize the export path. Returns false (and leaves every emit a no-op)
 * when Bluebox export is not configured. `opts.exporter` is an injection seam
 * for tests only.
 */
export async function initSpineOtelExport(opts?: {
  exporter?: ExporterLike;
}): Promise<boolean> {
  if (initialized && exporter) return true;
  loadOtelEnv();
  if (!opts?.exporter && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return false;

  if (opts?.exporter) {
    exporter = opts.exporter;
    resource = { attributes: defaultResourceAttributes(SPINE_EXPORT_SERVICE) };
  } else {
    if (!process.env.OTEL_EXPORTER_OTLP_PROTOCOL) {
      process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf";
    }
    // Heavy imports only on the opted-in path; `resources` via sdk-node's
    // official re-export (no direct dep on transitive packages).
    const [{ OTLPTraceExporter: Exporter }, sdkNode] = await Promise.all([
      import("@opentelemetry/exporter-trace-otlp-proto"),
      import("@opentelemetry/sdk-node"),
    ]);
    exporter = new Exporter() as unknown as ExporterLike;
    resource = sdkNode.resources.resourceFromAttributes(
      defaultResourceAttributes(SPINE_EXPORT_SERVICE),
    );
  }
  initialized = true;
  return true;
}

/** Test/shutdown helper: flush, shut the exporter down, reset module state. */
export async function resetSpineOtelExport(): Promise<void> {
  await flushSpineOtelExport();
  try {
    await exporter?.shutdown();
  } catch {
    // Shutdown failures must never propagate.
  }
  exporter = null;
  resource = null;
  queue = [];
  dropped = 0;
  initialized = false;
}

function hr(ms: number): HrTime {
  return [Math.floor(ms / 1000), Math.round((ms % 1000) * 1e6)];
}

function w3cTraceId(spineTraceId: string): string {
  return createHash("sha256").update(spineTraceId).digest("hex").slice(0, 32);
}

function clip(value: string): string {
  const redacted = redactPiiInText(value);
  return redacted.length > MAX_ATTR_CHARS
    ? `${redacted.slice(0, MAX_ATTR_CHARS)}…`
    : redacted;
}

function cleanAttributes(
  raw: Record<string, string | number | boolean | null | undefined> | undefined,
): Attributes {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === "string" ? clip(value) : value;
  }
  return out;
}

function otelKind(kind: ObsSpan["kind"]): SpanKind {
  return kind === "gen_ai.chat" || kind === "gen_ai.perception"
    ? SpanKind.CLIENT
    : SpanKind.INTERNAL;
}

function toWireSpan(span: ObsSpan): WireSpan {
  const traceId = w3cTraceId(span.traceId);
  const endMs = span.endTimeUnixMs ?? span.startTimeUnixMs;
  const attributes = cleanAttributes(span.attributes);
  for (const blob of span.blobs ?? []) {
    attributes[`os.blob.${blob.kind}`] = blob.ref;
  }
  return {
    name: span.name,
    kind: otelKind(span.kind),
    spanContext: () => ({ traceId, spanId: span.spanId, traceFlags: 1 }),
    parentSpanContext: span.parentSpanId
      ? { traceId, spanId: span.parentSpanId, traceFlags: 1 }
      : undefined,
    startTime: hr(span.startTimeUnixMs),
    endTime: hr(endMs),
    status:
      span.status?.code === "error"
        ? { code: SpanStatusCode.ERROR, message: clip(span.status.message ?? "") }
        : span.status?.code === "ok"
          ? { code: SpanStatusCode.OK }
          : { code: SpanStatusCode.UNSET },
    attributes,
    links: [],
    events: (span.events ?? []).map((event) => ({
      name: event.name,
      time: hr(event.timeUnixMs),
      attributes: cleanAttributes(event.attributes),
      droppedAttributesCount: 0,
    })),
    duration: hr(Math.max(0, endMs - span.startTimeUnixMs)),
    ended: true,
    resource,
    instrumentationScope: { name: SPINE_EXPORT_SERVICE },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as WireSpan;
}

/** Queue spans for export. No-op until initSpineOtelExport() succeeded. */
export function emitObsSpans(spans: ObsSpan[]): void {
  if (!exporter || spans.length === 0) return;
  try {
    for (const span of spans) {
      if (queue.length >= QUEUE_CAP) {
        dropped += 1;
        continue;
      }
      queue.push(toWireSpan(span));
    }
    if (dropped > 0 && dropped % 1000 === 1) {
      console.warn(`[obs] OTLP export queue full — dropped ${dropped} spans so far`);
    }
    scheduleFlush();
  } catch (error) {
    console.warn("[obs] OTLP span mapping failed:", (error as Error).message);
  }
}

/**
 * Synthesize + queue the `orchestrator.run` / `agent.session` root spans from
 * a spine session record. Turn spans (map-trace-entry.ts) parent to
 * spanId(sessionId), so the session root MUST use exactly that id.
 */
export function emitSessionRoots(session: SpineSessionRecord): void {
  if (!exporter) return;
  try {
    const sessionId = str(session.sessionId);
    if (!sessionId) return;
    const runId = str(session.runId);
    const spineTraceId = str(session.correlationId) || runId || sessionId;
    const start = num(session.startTime) ?? Date.now();
    const end = num(session.endTime) ?? start;
    const outcome = str(session.outcome);

    const roots: ObsSpan[] = [];
    if (runId) {
      roots.push({
        traceId: spineTraceId,
        spanId: spanId(runId, "run"),
        name: "orchestrator.run",
        kind: "orchestrator.run",
        startTimeUnixMs: start,
        endTimeUnixMs: end,
        attributes: {
          "os.run_id": runId,
          "os.correlation_id": spineTraceId,
        },
      });
    }
    roots.push({
      traceId: spineTraceId,
      spanId: spanId(sessionId),
      parentSpanId: runId ? spanId(runId, "run") : undefined,
      name: "agent.session",
      kind: "agent.session",
      startTimeUnixMs: start,
      endTimeUnixMs: end,
      attributes: {
        "os.session_id": sessionId,
        "os.query": str(session.query) || null,
        "os.outcome": outcome || null,
        "os.turn_count": num(session.turnCount) ?? null,
        "os.workspace_id": str(session.workspaceId) || null,
      },
      status:
        outcome === "failed"
          ? { code: "error", message: str(session.summary) || "run failed" }
          : { code: "ok" },
    });
    emitObsSpans(roots);
  } catch (error) {
    console.warn("[obs] OTLP root synthesis failed:", (error as Error).message);
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function scheduleFlush(): void {
  // Chain onto the single in-flight lane; each link drains what is queued.
  inFlight = inFlight.then(() => drain()).catch(() => {});
}

function drain(): Promise<void> {
  if (!exporter || queue.length === 0) return Promise.resolve();
  const batch = queue.splice(0, BATCH_SIZE);
  return new Promise<void>((resolve) => {
    exporter!.export(batch, (result) => {
      if (result.error) {
        console.warn("[obs] OTLP export failed:", result.error.message);
      }
      resolve();
    });
  }).then(() => (queue.length > 0 ? drain() : undefined));
}

/** Drain the queue and wait for in-flight exports. Safe when never initialized. */
export async function flushSpineOtelExport(): Promise<void> {
  scheduleFlush();
  await inFlight;
}
