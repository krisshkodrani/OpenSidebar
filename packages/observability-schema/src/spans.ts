/**
 * Canonical OpenTelemetry-GenAI-aligned span shape for OpenSidebar traces
 * (RFC LP-7, Stage B0). Pure types — no runtime, no platform deps — so the
 * server (scripts), the MCP layer, and the browser viewer can all share them.
 *
 * The hierarchy mirrors a run: orchestrator.run -> agent.session -> agent.turn
 * -> { gen_ai.chat, gen_ai.perception, execute_tool }. Standard fields use the
 * `gen_ai.*` semantic-convention keys; everything domain-specific uses `os.*`.
 * Heavy/opaque payloads (screenshots, DOM snapshots) are referenced by hash via
 * `ObsBlobRef`, never inlined as attributes.
 */

export type ObsSpanKind =
  | "orchestrator.run"
  | "agent.session"
  | "agent.turn"
  | "gen_ai.chat"
  | "gen_ai.perception"
  | "execute_tool";

/** Attribute values are primitives only (OTel constraint). */
export type ObsAttrValue = string | number | boolean | null;

/** A content-addressed reference to a heavy payload stored outside the span. */
export interface ObsBlobRef {
  /** Stable key — becomes a CAS `sha256:` ref once Stage B1 writes the blob. */
  ref: string;
  kind: "screenshot" | "dom_snapshot" | "prompt_sections" | "event_data" | "raw";
  bytes?: number;
  mime?: string;
}

export interface ObsSpanEvent {
  name: string;
  timeUnixMs: number;
  attributes?: Record<string, ObsAttrValue>;
}

export interface ObsSpanStatus {
  code: "ok" | "error";
  message?: string;
}

export interface ObsSpan {
  /** Trace id = the run's `correlationId` (falls back to runId/sessionId). */
  traceId: string;
  /** Deterministic span id (see `spanId`). */
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: ObsSpanKind;
  startTimeUnixMs: number;
  endTimeUnixMs?: number;
  /** `gen_ai.*` standard keys + `os.*` domain keys, primitives only. */
  attributes: Record<string, ObsAttrValue>;
  events?: ObsSpanEvent[];
  blobs?: ObsBlobRef[];
  status?: ObsSpanStatus;
}

/** OpenTelemetry GenAI semantic-convention attribute keys. */
export const GenAiAttr = {
  operationName: "gen_ai.operation.name",
  system: "gen_ai.system",
  requestModel: "gen_ai.request.model",
  responseModel: "gen_ai.response.model",
  responseFinishReasons: "gen_ai.response.finish_reasons",
  usageInputTokens: "gen_ai.usage.input_tokens",
  usageOutputTokens: "gen_ai.usage.output_tokens",
  usageTotalTokens: "gen_ai.usage.total_tokens",
} as const;
