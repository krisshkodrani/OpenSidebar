# Trace Viewer — Observability One-Pager (Dynatrace conversation)

Date: 2026-06-24

## What it is
A purpose-built observability plane for a **non-deterministic LLM browser agent**.
Captures typed, versioned, full-fidelity telemetry across three correlated streams
(orchestrator run → agent session → turn → tool/event), then runs a layered
analysis engine that turns raw traces into ranked, evidence-backed diagnoses.
SQLite warm store + hot/cold retention.

## Lead with these six (strengths)
1. **Semantic telemetry, not logs** — typed event union (`done_rejected`,
   `plan_monitor`, `circuit_breaker`, `escalation`, `safety_gate_blocked`),
   `schemaVersion` + `producer` provenance.
2. **Cross-stream correlation IDs** already exist (`correlationId`, `runId`,
   `turnId`, `executionId`, `eventId`) — the join model maps 1:1 to OTel spans.
3. **Explainable diagnosis** — every finding carries `severity`, `confidence`,
   `source` (deterministic / heuristic / llm_verifier), a `derivation`, and
   `evidence[]` pointers. Root cause *with its work shown*.
4. **Evidence integrity** — pointers resolve to `resolved / unresolved / pruned /
   load_failed`; the viewer never presents stale evidence as live.
5. **Structural validation of a parallel execution graph** — detects resource-lock
   leaks, never-finished workers, and dependency-ordering violations. (Demo this.)
6. **AI-FinOps** — input vs output cost, cached vs non-cached tokens, per-model
   fail rate, prompt-section token attribution, unpriced-request flagging.

Plus: fleet RCA with Wilson confidence intervals; a closed-loop "harness ratchet"
that turns repeated failures into layer-tagged fix suggestions; a metric-semantics
dictionary pinned to unit tests.

## The framing (say this)
> "We've solved the hard part — capturing meaningful AI-agent telemetry and
> reasoning over it. What we haven't done is speak OTLP/GenAI conventions or add
> live anomaly detection — which is exactly where Dynatrace comes in."

Complementary integration, not a competing tool.

## Pre-empt the two questions they will ask
- **"Is it OpenTelemetry?"** → Not yet, but the schema maps cleanly. See the
  `TraceEntry → gen_ai span` mapping doc; export is an adapter, not a rebuild.
- **"What about PII?"** → Traces capture DOM/screenshots/LLM messages today.
  Redaction-at-ingest is the named prerequisite on the roadmap before shipping to
  a shared backend.

## Roadmap (gaps, as forward-looking items — not failures)
1. OTLP / `gen_ai.*` exporter.
2. Live monitoring: streaming ingest + learned baselines + SLO/anomaly alerting
   (today it's post-hoc investigation with static thresholds).
3. Time-series trends & cross-release regression detection.
4. Trace-waterfall / service-flow visualization (data exists; view doesn't).
5. PII redaction layer; sampling + cardinality control for fleet scale.
