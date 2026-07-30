# Trace Viewer → OpenTelemetry / GenAI Mapping

Date: 2026-07-24

Status: **Shipped.** The OTLP exporter exists and is wired into the log
server: `scripts/obs/otel-emit.ts` maps span-spine records (`ObsSpan[]`) to
OTLP and exports them (Dynatrace/Bluebox today; any OTLP backend in
principle), and `scripts/obs/export-otel.ts` is the backfill CLI
(`pnpm run obs:export-otel`). The log server calls `initSpineOtelExport()` on
boot and emits spans on every `/traces` / `/run-traces` write. Configuration
lives in `.env.otel`.

Related: [Trace Viewer](./trace-viewer.md) (the span spine),
[Trace Viewer Observability](./trace-viewer-observability.md),
[Metric Semantics](./trace-viewer-metric-semantics.md). Source of truth for
fields: `packages/shared-types/src/traces.ts` and
`scripts/obs/map-trace-entry.ts` (the actual on-the-wire mapping — trust it
over the tables here).

## Span hierarchy

The record kinds form a parent/child span tree; IDs we already emit become the
OTel identifiers. W3C trace ids are derived deterministically
(`sha256(spineTraceId)`, `otel-emit.ts`).

```
trace_id  = derived from correlationId   (end-to-end across orchestrator + agent)
│
└─ span: orchestrator.run                ← run manifest (runId)
   ├─ span: agent.session                ← sessionId
   │  ├─ span: agent.turn                ← turnId
   │  │  ├─ span: gen_ai.chat            ← llmRequest / llmResponse
   │  │  ├─ span: execute_tool {name}    ← toolExecutions[]
   │  │  ├─ span: gen_ai.perception      ← perception block (when present)
   │  │  └─ span events                  ← turn.events[]
   │  └─ … more turns
   └─ run-level span events
```

## The `gen_ai.chat` span

Standard GenAI attributes:

| OTel GenAI attribute | OpenSidebar field |
| --- | --- |
| `gen_ai.system` | `llmResponse.actualProviderId` |
| `gen_ai.request.model` | `llmRequest.model` |
| `gen_ai.response.model` | `llmResponse.actualModel` (captures failover) |
| `gen_ai.usage.input_tokens` | `usage.prompt_tokens` |
| `gen_ai.usage.output_tokens` | `usage.completion_tokens` |
| span duration | `llmResponse.durationMs` |

Custom attributes use the **`os.*` namespace** (not `opensidebar.*`):
`os.cost_usd`, `os.usage.cached_tokens`, `os.cache.hit_pct`, `os.model_tier`,
… — see `map-trace-entry.ts` for the full list. Cost is deliberately custom:
GenAI conventions do not standardize a cost attribute; `costMode`
(`actual`/`estimated`) provenance is preserved.

## The `execute_tool` span

Emits `os.tool.name`, `os.tool.success`, `os.tool.risk`, with span status
ok/error from `toolExecution.success`.

## Events → span events

Turn events attach to the `agent.turn` span using the **raw `TraceEvent.type`
string** as the event name (no per-event attribute mapping is currently
implemented).

## Export behavior worth knowing

- **PII redaction at the export boundary is implemented** —
  `redactPiiInText` (`scripts/obs/redact.ts`) runs before emit.
- Resource `service.name` is **`opensidebar-agent-runtime`**.
- Attribute values are clipped to 4,000 chars (Dynatrace limit).
- Synthetic no-op perception spans are dropped (GitHub #99).
- Backends may reject spans older than their ingest window — the backfill CLI
  documents this caveat (`export-otel.ts`).

## Not implemented (aspirational)

- **OTel metrics instruments** (`gen_ai.client.token.usage`,
  `gen_ai.client.operation.duration`, cost counters): only trace **spans**
  are exported today; the Metrics-page aggregates are not emitted as metric
  instruments.
- **Sampling / cardinality control**: full-fidelity capture is fine locally;
  fleet-scale volume would need head/tail sampling.
- **Live anomaly detection / baselining**: the backend's job once data flows.
