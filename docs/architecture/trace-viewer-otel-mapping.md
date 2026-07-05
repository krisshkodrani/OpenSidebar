# Trace Viewer → OpenTelemetry / GenAI Mapping

Date: 2026-06-24

Status: Design sketch (no exporter implemented yet). Purpose: show that the
existing OpenSidebar trace schema maps cleanly onto OpenTelemetry traces and the
OpenTelemetry **GenAI semantic conventions** (`gen_ai.*`), so the telemetry can be
shipped to any OTLP backend (Dynatrace, Grafana Tempo, Honeycomb, …) without a
schema rebuild.

Related: [Trace Viewer Observability](./trace-viewer-observability.md),
[Trace Viewer Metric Semantics](./trace-viewer-metric-semantics.md). Source of
truth for fields: `packages/shared-types/src/traces.ts`.

## TL;DR

We already capture the hard part — typed, correlated, full-fidelity AI-agent
telemetry with stable cross-stream IDs. What is missing is an **OTLP export layer**
that re-labels our bespoke records as OTel spans + GenAI attributes. This is a
mapping/adapter, not a re-instrumentation. Cost and a handful of AI-agent-specific
fields have no standard yet and go under an `opensidebar.*` custom namespace.

## Span hierarchy

Our four record kinds form a clean parent/child span tree. The IDs we already
emit become the OTel span/trace identifiers.

```
trace_id  = correlationId            (end-to-end across orchestrator + agent)
│
└─ span: invoke_agent "{query}"      ← orchestrator.run.manifest (runId)
   │   gen_ai.operation.name = invoke_agent
   │
   ├─ span: agent session            ← agent.session (sessionId)
   │  │   gen_ai.operation.name = invoke_agent
   │  │
   │  ├─ span: turn {turnNumber}      ← agent.turn (turnId)
   │  │  │
   │  │  ├─ span: chat {model}        ← turn.llmRequest / llmResponse
   │  │  │       gen_ai.operation.name = chat
   │  │  │
   │  │  ├─ span: execute_tool {name} ← turn.toolExecutions[] (executionId)
   │  │  │       gen_ai.operation.name = execute_tool
   │  │  │
   │  │  └─ span events               ← turn.events[]  (eventId)
   │  │
   │  └─ … more turns
   │
   └─ run-level span events           ← orchestrator.run.event
```

| OpenSidebar record | OTel span | Span/ID source |
| --- | --- | --- |
| `orchestrator.run.manifest` | root `invoke_agent` span | `runId` → span_id, `correlationId` → trace_id |
| `agent.session` | child agent span | `sessionId` → span_id, `parentRunId`/`runId` → parent |
| `agent.turn` | turn span | `turnId` → span_id |
| `turn.llmRequest` + `llmResponse` | `chat` (GenAI) span | new span_id; parent = `turnId` |
| `turn.toolExecutions[]` | `execute_tool` span | `executionId` → span_id |
| `turn.events[]` | span events on the turn span | `eventId` |
| `orchestrator.run.event` | span events on the run span | — |

Timestamps: `turn.timestamp` / `recordedAt` → span start; `+ llmResponse.durationMs`
or `toolExecution.durationMs` → span end. W3C `traceparent` is derived from
`correlationId` + the parent span id for propagation.

## The `chat` span — GenAI attribute mapping

This is the highest-value mapping: each LLM call becomes a standard GenAI span.

| OTel GenAI attribute | OpenSidebar field |
| --- | --- |
| `gen_ai.operation.name` | `"chat"` (constant) |
| `gen_ai.system` | provider from `llmResponse.actualProviderId` (e.g. `openrouter`, `openai`, `groq`) |
| `gen_ai.request.model` | `llmRequest.model` |
| `gen_ai.response.model` | `llmResponse.actualModel` (captures failover) |
| `gen_ai.response.finish_reasons` | `[llmResponse.finishReason]` |
| `gen_ai.usage.input_tokens` | `llmResponse.usage.prompt_tokens` |
| `gen_ai.usage.output_tokens` | `llmResponse.usage.completion_tokens` |
| `server.duration` / span duration | `llmResponse.durationMs` |
| (span events) `gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.assistant.message`, `gen_ai.tool.message` | `llmRequest.messages[]` (already flattened in `TraceLLMMessage`) |
| (span event) `gen_ai.choice` | `llmResponse.content` + `toolCalls` |

Custom (`opensidebar.*`) — no GenAI standard yet:

| Custom attribute | OpenSidebar field |
| --- | --- |
| `opensidebar.model.tier` | `llmRequest.modelTier` (`executor`/`planner`) |
| `opensidebar.usage.cached_tokens` | `llmResponse.usage.cached_tokens` |
| `opensidebar.usage.cache_hit_pct` | `llmResponse.usage.cacheTelemetry.cacheHitPct` |
| `opensidebar.cost.usd` | `llmResponse.usage.cost` |
| `opensidebar.context.utilization` | `llmRequest.contextMetrics.utilization` |
| `opensidebar.context.dropped_messages` | `llmRequest.contextMetrics.droppedMessageCount` |
| `opensidebar.context.compression_level` | `llmRequest.contextMetrics.compressionLevel` |

> Cost is deliberately custom: GenAI conventions do **not** standardize a cost
> attribute. Keep `costMode` (`actual`/`estimated`/`mixed`) provenance so a backend
> can distinguish billed vs. estimated spend.

## The `execute_tool` span

| OTel GenAI attribute | OpenSidebar field |
| --- | --- |
| `gen_ai.operation.name` | `"execute_tool"` (constant) |
| `gen_ai.tool.name` | `toolExecution.toolName` |
| `gen_ai.tool.call.id` | `toolExecution.toolCallId` |
| span status | `toolExecution.success` → `Ok` / `Error` |
| span status description | `toolExecution.error` |
| span duration | `toolExecution.durationMs` |
| `opensidebar.tool.risk_level` | `toolExecution.riskLevel` |

## Events → span events

Our typed `TraceEvent` union maps to span events with attributes. Examples:

| TraceEvent type | Span event name | Notable attributes |
| --- | --- | --- |
| `done_rejected` | `opensidebar.completion.rejected` | `reason`, `rejections`, `advancedTo` |
| `plan_monitor` | `opensidebar.plan.monitor` | `alignment`, `stepIndex`, `reason` |
| `plan_replan` | `opensidebar.plan.replan` | `fromIndex`, `replanNumber` |
| `escalation` | `opensidebar.escalation` | `reason`, `voluntary` |
| `circuit_breaker` | `opensidebar.circuit_breaker` | `reason`, `count` |
| `safety_gate_blocked` | `opensidebar.safety.blocked` | `tool`, `reason`, `phase` |

Setting span status to `Error` on `done_rejected`, `circuit_breaker`, and tool
failures lets a backend's error-tracking light up automatically.

## Resource attributes (set once per exporter)

| Attribute | Value |
| --- | --- |
| `service.name` | `opensidebar-agent` |
| `service.version` | extension version |
| `gen_ai.system` | default provider (overridden per `chat` span) |
| `deployment.environment` | `local` / `bench` / `e2e` |

## Metrics (OTel metrics API)

The Metrics page aggregates can be emitted as standard GenAI metric instruments,
so the same numbers show up on a dashboard without re-deriving them:

| OTel instrument | Source |
| --- | --- |
| `gen_ai.client.token.usage` (histogram, `token.type=input\|output`) | `usage.prompt_tokens` / `completion_tokens` |
| `gen_ai.client.operation.duration` (histogram) | `llmResponse.durationMs` |
| `opensidebar.session.cost` (counter, USD) | `SessionMetrics.totalCost` (+ `costMode`) |
| `opensidebar.session.turns` (histogram) | `turnCount` |
| `opensidebar.tool.failures` (counter) | tool `success === false` |

## Where the exporter would live

A new `scripts/otel-export.ts` (or a tap inside `scripts/log-server.ts` at the
`/ingest` and `/traces` POST handlers) reads each record as it lands and emits
OTLP/HTTP. Because every record already carries `correlationId` / `runId` /
`sessionId` / `turnId` / `executionId` / `eventId`, the exporter is **stateless
per record** — it never has to reconstruct parentage from scratch.

## What this does NOT cover (honest gaps)

- **PII**: spans would carry DOM text, screenshots, and LLM message bodies. A
  redaction pass at the exporter boundary is a prerequisite for shipping to a
  shared backend.
- **Live anomaly detection / baselining**: out of scope here — that is the
  backend's job (e.g. Davis AI) once the data is flowing in OTLP.
- **Sampling / cardinality control**: full-fidelity capture is fine locally;
  fleet/prod volume would need head/tail sampling and label-cardinality limits.
