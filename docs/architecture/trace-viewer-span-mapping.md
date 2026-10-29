# Trace Viewer → GenAI Span Mapping

Date: 2026-07-24

Status: **Shipped.** The log server maps trace entries to GenAI-shaped spans
(`ObsSpan[]`) and stores them in the local span spine. This doc describes that
mapping. Nothing exports the spans off the machine.

Related: [Trace Viewer](./trace-viewer.md) (the span spine),
[Trace Viewer Observability](./trace-viewer-observability.md),
[Metric Semantics](./trace-viewer-metric-semantics.md). Source of truth for
fields: `packages/shared-types/src/traces.ts` and
`scripts/obs/map-trace-entry.ts` (the actual on-the-wire mapping — trust it
over the tables here).

## Span hierarchy

The record kinds form a parent/child span tree; IDs we already emit become the
span identifiers.

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

| GenAI attribute | OpenSidebar field |
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

## Spine behavior worth knowing

- Synthetic no-op perception spans are dropped (GitHub #99).

## Not implemented (aspirational)

- **Metric instruments** (`gen_ai.client.token.usage`,
  `gen_ai.client.operation.duration`, cost counters): only **spans** are
  produced today; the Metrics-page aggregates are not emitted as metric
  instruments.
- **Sampling / cardinality control**: full-fidelity capture is fine locally;
  fleet-scale volume would need head/tail sampling.
