# Trace Viewer Observability

Date: 2026-05-11

Scope: Trace Viewer metrics, trace indexing, and retention direction.

## Goal

The Trace Viewer should help engineers move from a failing browser-agent run to a clear diagnosis and action. Raw trace files remain the source of truth for evidence. Queryable metrics and archives should make that evidence faster to find without weakening trust in the underlying trace.

## Storage Model

- Raw JSONL traces remain canonical evidence.
- SQLite should be a rebuildable index and metrics cache, not the only copy of trace evidence.
- The viewer should tolerate a missing or stale SQLite index by falling back to JSONL scanning.
- Archive metadata should point back to the raw trace bundle location.

## Hot And Cold Policy

- Hot traces: last 7 days.
- Cold traces: older than 7 days, moved to an archive location.
- Default behavior should archive, not delete.
- Deletion should require an explicit retention setting or command.
- Archived sessions should remain discoverable through SQLite metadata.

## Suggested SQLite Tables

- `trace_sessions`: session id, run id, start/end time, outcome, domain, query title, model list, cost, token totals, archive state.
- `trace_turns`: session id, turn number, model, provider, request tokens, response tokens, total tokens, cost, duration, context utilization, perception status.
- `trace_tools`: session id, turn number, tool name, success, duration, error signature.
- `trace_events`: session id or run id, turn number, event type, severity, reason/signature.
- `trace_artifacts`: session id, artifact type, hot path, archive path, size bytes, archived at.
- `trace_ingest_state`: source file, mtime, size, indexed at, checksum or version marker.

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

## Archive Flow

1. Index or refresh trace metadata.
2. Select sessions older than 7 days.
3. Move their raw turn files, run files, screenshots, and session logs to a dated archive folder.
4. Mark archived paths in SQLite.
5. Keep session-level rows queryable.
6. Restore/open archived raw evidence on demand when a developer drills into a cold session.

The first archive command is:

```sh
npm run traces:index
npm run traces:archive
npm run traces:archive -- --apply
```

`traces:index` builds `.artifacts/trace-index.sqlite` as a rebuildable SQLite cache from raw JSONL traces. `traces:archive` uses a 7-day hot window by default and performs a dry run unless `--apply` is passed.

## Implementation Order

1. Fix viewer trust bugs so selected sessions cannot show stale evidence.
2. Add request/token/cost metrics to the current JSONL-backed insights endpoint.
3. Add the Metrics page.
4. Add the SQLite index as a cache behind the same endpoint contract.
5. Add the 7-day archive command and cold-session restore/open path.
