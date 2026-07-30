# Trace Viewer Observability

Date: 2026-07-24 (originally 2026-05-12 as a plan; the model described here is
now shipped)

Scope: Trace Viewer metrics, trace indexing, and retention.

Related: [Trace Viewer Architecture](trace-viewer.md) for how the harness is structured (pipeline, log-server API, app layout); [Trace Viewer AI Concepts](../guides/trace-viewer-ai-concepts.md) for a concise explanation of the agent concepts and how the viewer makes those concepts observable.

## Goal

The Trace Viewer should help engineers move from a failing browser-agent run to a clear diagnosis and action. SQLite is the long-lived viewer store. Raw trace files are short-lived local evidence for Codex/debugging and are retained for 7 days by default.

## Storage Model

- **The span spine (`traces/spans/`) is the authoritative read source** for
  turn entries and run events (`scripts/obs/span-store.ts`, schema in
  `packages/observability-schema/`); the log server dual-writes it on every
  trace write and reads it first (`OBS_DISABLE_SPINE_READS=1` reverts to the
  derived stores). The spine also feeds the OTLP export path — see
  [OTel Mapping](trace-viewer-otel-mapping.md).
- SQLite stores normalized trace rows plus raw JSON copies for viewer queries and copy/paste evidence.
- Raw JSONL traces stay in `traces/` only for the hot debug window.
- The viewer reads spine/SQLite first and tolerates missing raw files after pruning.
- `traces:index` remains the repair/backfill path when SQLite needs to be rebuilt from hot JSONL.

## Hot And Cold Policy

- Hot raw traces: last 7 days.
- Older raw traces: deleted by explicit CLI after SQLite coverage checks.
- SQLite sessions remain discoverable after raw JSONL and screenshots are pruned.
- Screenshots are hot debug artifacts in this phase; old sessions may show expired screenshots.

## SQLite Tables

- `trace_sessions`: session id, run id, start/end time, outcome, domain, query title, model list, cost, token totals, archive state.
- `trace_turns`: session id, turn number, model, provider, request tokens, response tokens, total tokens, cost, duration, context utilization, perception status.
- `trace_tools`: session id, turn number, tool name, success, duration, error signature.
- `trace_events`: session id or run id, turn number, event type, severity, reason/signature.
- `trace_run_manifests`: run id and raw manifest JSON.
- `trace_artifacts`: session id, artifact type, hot path, size bytes, mtime.
- `trace_index_meta`: indexed/ingested timestamps and schema version.

## Analytics Metrics

The Analytics view uses the same aggregate contract whether data comes from JSONL scanning or SQLite. Baseline metrics:

- sessions and runs
- LLM request count
- input, output, and total tokens
- estimated request cost
- average LLM latency
- total turns and average turns
- success and failure rate
- tool calls and tool failure rate
- model mix

## Retention Flow

1. Ingest trace records into SQLite as the local log server receives them.
2. Keep appending raw JSONL for short-lived debugging.
3. Run `traces:index` to backfill or repair SQLite from raw files.
4. Run `traces:delete-old` to preview raw files older than 7 days.
5. Run `traces:delete-old -- --apply` only after the SQLite coverage gate passes.

The normal maintenance command is:

```sh
pnpm run traces:index
pnpm run traces:delete-old
pnpm run traces:delete-old -- --apply
pnpm run traces:compact
```

`traces:index` backfills `.artifacts/trace-index.sqlite` from raw JSONL traces. `traces:delete-old` uses a 7-day raw-file window by default and performs a dry run unless `--apply` is passed. `traces:compact` indexes first, then deletes old raw files.

Operationally:

- Keep `traces/` and `logs/` small enough for active debugging.
- Treat `.artifacts/trace-index.sqlite` as the viewer store.
- Change the raw-file window with `pnpm run traces:delete-old -- --hot-days <days>` when needed.

## Status

The original implementation plan (viewer trust fixes, token/cost metrics,
metrics page, SQLite primary store, the 7-day delete command) has shipped in
full, and the span spine has since been layered on top as the authoritative
store. This doc now describes current behavior, not a roadmap.
