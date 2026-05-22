# Trace Viewer Observability

Date: 2026-05-12

Scope: Trace Viewer metrics, trace indexing, and retention direction.

Related: [Trace Viewer AI Concepts](../guides/trace-viewer-ai-concepts.md) for a concise explanation of the agent concepts and how the viewer makes those concepts observable.

## Goal

The Trace Viewer should help engineers move from a failing browser-agent run to a clear diagnosis and action. SQLite is the long-lived viewer store. Raw trace files are short-lived local evidence for Codex/debugging and are retained for 7 days by default.

## Storage Model

- SQLite stores normalized trace rows plus raw JSON copies for viewer queries and copy/paste evidence.
- Raw JSONL traces stay in `traces/` only for the hot debug window.
- The viewer should read SQLite first and tolerate missing raw files after pruning.
- `traces:index` remains the repair/backfill path when SQLite needs to be rebuilt from hot JSONL.

## Hot And Cold Policy

- Hot raw traces: last 7 days.
- Older raw traces: deleted by explicit CLI after SQLite coverage checks.
- SQLite sessions remain discoverable after raw JSONL and screenshots are pruned.
- Screenshots are hot debug artifacts in this phase; old sessions may show expired screenshots.

## Suggested SQLite Tables

- `trace_sessions`: session id, run id, start/end time, outcome, domain, query title, model list, cost, token totals, archive state.
- `trace_turns`: session id, turn number, model, provider, request tokens, response tokens, total tokens, cost, duration, context utilization, perception status.
- `trace_tools`: session id, turn number, tool name, success, duration, error signature.
- `trace_events`: session id or run id, turn number, event type, severity, reason/signature.
- `trace_run_manifests`: run id and raw manifest JSON.
- `trace_artifacts`: session id, artifact type, hot path, size bytes, mtime.
- `trace_index_meta`: indexed/ingested timestamps and schema version.

## Metrics Page

The Metrics page should use the same aggregate contract whether data comes from JSONL scanning or SQLite. Required baseline metrics:

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

## Implementation Order

1. Fix viewer trust bugs so selected sessions cannot show stale evidence.
2. Add request/token/cost metrics to the current JSONL-backed insights endpoint.
3. Add the Metrics page.
4. Add SQLite as the primary store behind the same endpoint contract.
5. Add the 7-day delete command with SQLite coverage checks.
