# RFC 0004 - Canonical Aggregate Contract (JSONL <-> SQLite Parity)

Status: Implemented
Date: 2026-05-30
Scope: `scripts/log-server.ts` (`/api/trace-insights`, `/api/traces/*` aggregates), `scripts/trace-sqlite-index.ts`, `analysis/fleet.ts`, viewer `api.ts` / `hooks/useInsightsData.ts`

## Problem

The Observability doc requires the Metrics/Insights pages to "use the same
aggregate contract whether data comes from JSONL scanning or SQLite." Today the
JSONL path and the SQLite path compute aggregates independently, with nothing
pinning them to the same definition. As SQLite becomes the primary store, the two
paths will silently diverge (different rounding, inclusion rules, model-id
normalization, etc.).

## Motivation (both lenses)

- **AI engineer:** Divergent aggregates mean the dashboard's numbers depend on
  which storage tier answered; a correctness/trust bug that is invisible until
  someone cross-checks.
- **AI researcher:** Metrics must mean the same thing across runs and over time,
  or longitudinal/ablation comparisons are invalid. A storage migration must not
  shift the numbers.

## Proposal

1. Define a canonical aggregate **output contract** (sessions, runs, request
   count, in/out/total tokens, est. cost, avg latency, total/avg turns,
   success/failure rate, tool calls + failure rate, model mix: the doc's
   baseline list).
2. Keep SQLite free to compute that contract in SQL for performance, and keep
   JSONL free to compute it in JS for the hot-debug repair path. A parity test
   pins both outputs against the same fixture.
3. Share scalar semantics across both paths: model-id normalization, success
   outcome classification, rate/interval calculation, and denominator naming.
   Put these helpers in a server-safe shared module rather than importing
   browser-side `analysis/fleet.ts` into scripts.

## Alternatives

- Snapshot-test each path independently: catches drift after the fact but
  doesn't prevent it; the shared function prevents it by construction.
- Make SQLite authoritative and drop the JSONL aggregate path: viable long-term,
  but the doc still wants JSONL for the hot-debug repair path, so keep parity.

## Testing

- Parity test (Coverage Plan Tier 3): feed the same fixture trace set through the
  JSONL path and the SQLite path; assert identical aggregate output.
- Unit: edge cases (no sessions, missing usage, failover `actualModel`) handled
  identically.

## Rollout

Medium: a contract/parity refactor plus shared scalar helpers. No data-model
change for existing consumers; additive statistical fields are allowed.
