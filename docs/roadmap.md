# Roadmap

What's still planned after v0.7.6, roughly in order. Items link to their RFCs where
one exists; anything RFC-gated needs an owner Decision Stamp before
implementation ([process](./engineering/rfc-decision-process.md)). If you want
to pick one of these up, open an issue first — see
[CONTRIBUTING](../CONTRIBUTING.md) for the seam map.

## Near-term (weeks)

- **Keep generated runs out of Git** — traces and benchmark outputs belong
  under ignored `traces/` and `.artifacts/`. Removing tracked copies affects
  future commits; shrinking existing Git history is a separate operation.

- **Measure and shrink the shipped extension** — record a per-entry bundle size
  baseline, then split or remove heavy dependencies one at a time. Keep the
  generic E2E overlay out of the production build and compare packaged bytes
  after each change. Defer architectural build changes until the runtime
  refactor is stable.

- **Prepare local trace data for model experiments** — review sanitized
  executor examples under `.artifacts/`, label outcomes with task evidence,
  and keep a held-out evaluation set by workflow and site. Export only approved
  examples; compare a smaller role-specific model against the current executor
  on local fixtures before any paid or production rollout. Do not treat
  historical benchmark traces as ground truth without human review.

- **PostgreSQL cloud sessions** ([LP-29 through LP-31](./engineering/cloud-platform-roadmap.md))
  — retention/export/deletion, portable restore, and device coordination pass
  published-client reconnect/takeover UX, local and real two-profile Chrome,
  and exact-host PostgreSQL acceptance behind disabled flags. Bounded text and
  locally approved, postcondition-verified clicks now pass; staged activation
  and any future non-click sensitive actions remain.
  Default-off stage controls and a dedicated Cognito-subject tester allowlist
  are implemented; no tester account is enabled yet.
  Temporal is parked research.

- **Authenticated cloud UX normalization**
  ([cloud platform Phase 10](./engineering/cloud-platform-roadmap.md#phase-10--authenticated-cloud-ux-normalization))
  — unify the signed-in Account, Dashboard, Sessions, Settings, and Playground
  experience after named-tester acceptance. Normalize navigation and capability
  language, remove contradictory cached-auth states, and make Local key, cloud
  credential, relay, and cloud-session status clearly distinct.

- **Published benchmark numbers** ([RFC LP-1](./engineering/rfcs/lp-0001-public-benchmark-adapter.md))
  — first full Online-Mind2Web sweep with per-task receipts, published in the
  README's Measured Performance section.

## Code health (ongoing decomposition series)

[LP-16](./engineering/rfcs/lp-0016-landmine-decomposition.md) is decision
stamped; its [remainder plan](./engineering/rfcs/lp-0016-remainder-plan.md)
tracks the remaining size targets and the unverified headed E2E gate.

The repo's large files are being decomposed incrementally with
behavior-preserving moves, each guarded by a shrink-only size budget
(`scripts/loop-ratchet.mjs`; run `--report` for current numbers — the figures
below drift).

- `completion-kernel.ts` (54 lines) — the approximately 1,500-line façade
  target is reached locally. Contract logic, shared parsing, and completion
  evidence moved into `completion/`, cutting 5,657 kernel lines. The moved
  code matches the original blocks, and full working-tree `verify` passes
  with 5,701 extension tests. The large analysis modules now meet
  the kind-module target: sentence-scoped
  answer patterns and precise label-value extraction moved out of
  `read-answer-analysis.ts` (2,417 lines), and text confirmation matching moved
  out of `workflow-confirmation-analysis.ts` (2,188 lines).
- `loop.ts` (3,403 lines / 73 methods, down from ~10.3K lines) — all nine
  turn phases are extracted and `loop()` is a 193-line driver. Its numeric
  LP-16 targets are reached locally. Broad host casts remain to be retired;
  headed staged E2E and independent review remain open.
- `orchestrator/index.ts` (2,984 lines) — Phase 5 is below its approximate
  3,000-line target; confirm the exit with independent review.

Done: `tools/index.ts` is now a ~130-line barrel (`registerTools()` split per
tool family). The ServiceNow adapter has been removed.

- **`any` burndown** — `no-explicit-any` is now a lint warning. The extension
  source had 231 unsuppressed warnings on 2026-09-23; continue the typed-shim
  cleanup, including Chrome API gaps. The shared agent tool-handler host now
  types its context, runtime collaborators, and trusted tool-result inputs,
  removing 12 explicit `any` annotations from that contract.

## Perception (RFC series LP-9…LP-14, from the 2026-07-04 SOTA audit)

Screenshot pipeline engineering (LP-9), new-element marking (LP-10), the
`unified_vl` default (LP-11), closed-shadow-root reach (LP-12 Phase A), and
region zoom (LP-13) shipped in v0.3.5. Cross-origin iframe reach (LP-12
Phase B) now has a dev-on, shipped-off implementation and a passing two-origin
tag-based checkout E2E. Missing-frame, child-keyboard, and find-then-click
browser cases also pass. The local verification equivalents pass with a
four-worker test run. Live-provider staged E2E remains unrun after a prior
Fireworks account HTTP 412; shipped activation waits for CWS review. In-browser PDF
handling (LP-14) is parked and requires a new owner decision before
implementation.
An isolated local-mock checkout run later exposed a partial child-frame read
being cached while its content was temporarily unavailable. The runtime now
keeps those reads live; the focused regression test and one no-retry browser
checkout run pass. This does not replace the staged live-provider gate.

## Observability

- **Span read cutover and DuckDB analytics** ([RFC LP-7](./engineering/rfcs/lp-0007-unified-observability-engine.md),
  Stages B1–B2) — complete and verify the span-spine read cutover, then add
  day-partitioned Parquet and DuckDB analytics behind `OBS_ANALYTICS`. SQLite/JS
  remains the permanent fallback; require a `TraceInsightsResponse` parity test.
  The independent spine/legacy parity gate passes for 7,709 session entry sets,
  7,779 session records, 4,959 runs, and 2,160 manifests with zero gaps or
  mismatches. HTTP read acceptance passes for four trace sessions and three run
  traces in both spine and legacy modes, including header-only and manifest-only
  raw JSONL exports. The 2,160 legacy run manifests have been backfilled into
  the spine.
  A fresh SQLite rebuild matches JS aggregate responses across six corpus
  filters. The active SQLite index has been refreshed to the same session set.
  Cold aggregate reads still take about 26-80 seconds on this corpus, and
  the built viewer opens a trace and renders turns in both spine and legacy
  read modes (`obs:acceptance-browser`). Legacy derived-write retirement remains
  open; the live aggregate endpoints still read the derived SQLite index and
  need a fast spine-backed path before those writes can stop. The spine-direct
  JS fallback now reads turns on demand, avoiding the prior 4 GB heap crash.
  HTTP insights parity passes for a session filter and the full local corpus
  against SQLite, with floating-point values compared to 10 decimal places.
  The unfiltered spine response took about 52 seconds versus 25 seconds for
  SQLite; this is too slow for the viewer's normal aggregate path. A faster
  analytics tier and its parity gate are required before retiring derived writes.
  A local DuckDB Parquet snapshot now partitions sessions, full turn entries,
  derived spans, and run events by day. Full entries are required for the existing insights
  filters and metrics, which cannot be reconstructed from the derived spans alone.
  The v3 source-to-Parquet verifier passes for 7,783 sessions, 48,863 turn entries,
  153,307 spans, and 84,491 run events, including counts for every turn and
  full normalized JSON hashes for every run event. The first full export
  exposed 23 files with isolated UTF-16 surrogates that DuckDB rejected; the
  exporter now normalizes these only in the Parquet projection, and the local
  snapshot was repaired and verified. A verified snapshot manifest now records
  the export start time; bounded readers restore one session or run and overlay
  changed canonical turns or a newer run event file. The run event projection
  stages rows by day before Parquet export to avoid DuckDB partition-writer
  memory exhaustion on this corpus. Sealing requires the current source keys
  and counts to match the snapshot, so a concurrent write can require another
  export. An exploratory DuckDB aggregate over all
  48,863 entries took 4.5 seconds with about 10 MB of JavaScript heap; trying
  to materialize every raw entry in JavaScript ran out of memory. The insights
  path therefore needs DuckDB-side aggregation or bounded streaming. DuckDB
  now computes the complete `TraceInsightsSummary` from Parquet, including
  estimated pricing, unpriced requests, partial handoffs, and escalations.
  Every summary field matches SQLite on an all/filtered fixture with priced
  and unknown models plus turn and session escalation events,
  and the token/cost/duration full-corpus query took about 16.7 seconds with
  about 10 MB of JavaScript heap. With the handoff counters, the full snapshot
  query took about 25 seconds and exactly matched SQLite's 218 partial
  handoffs, 218 max-turn handoffs, and 581 max-turn sessions without useful
  progress across 7,783 sessions. The escalation query over that snapshot
  took about 20 seconds and returned 576 escalated sessions, 807 fires, 617
  rescues, 18 failed-fast outcomes, and 55 budget-exhausted outcomes. A direct
  SQLite event scan over the 6 GB index was stopped after several minutes, so
  full-corpus escalation parity is still unverified. The complete summary
  query over the v3 snapshot took about 38 seconds; full-corpus pricing parity
  remains unverified. DuckDB now reads the session, run, and domain facets;
  their 500/500/54 values exactly match the indexed SQLite lists on the full
  local corpus, and the DuckDB read took under one second. It also reads event
  types from turn, session, and linked run events; all 187 types match an
  independent canonical-spine scan across 4,870 linked runs, with a roughly
  five-second DuckDB read. The model, skill, and tool facets now match SQLite
  on an all/filtered/missing-session fixture. The failure facet includes both
  session labels and linked run classifications and also matches SQLite on the
  fixture. An independent canonical scan of 7,783 sessions, 48,863 turns, and
  4,870 linked runs exactly matches the full v3 DuckDB facet lists: 17 models,
  30 skills, 34 tools, and 15 failure labels. DuckDB now reads the full bounded
  200-row run table, including top tools, top skills, and authoritative run
  outcomes; every field matches SQLite on the all/filtered/missing-session
  fixture. The v3 full-corpus read took about 4.5 seconds after restricting
  breakdowns to displayed runs. A real-session SQLite response query against
  the 6 GB index was stopped after two minutes, so full-corpus run-row parity
  remains unverified. DuckDB now also reads the full failure breakdown,
  including run classifications omitted by session labels. All row fields
  match SQLite on the all/filtered/missing-session fixture, including a
  classification that matches an existing session label and one that adds to
  an existing failure row and repeated completed-run events. The v3
  full-corpus read returned 15 rows in under one second. An independent scan
  of 7,783 canonical sessions and 934 linked runs with completed outcomes
  confirms every failure row's counts, cost, and sample IDs; two runs had
  repeated identical outcomes. DuckDB skill rows match SQLite on the fixture,
  including a duplicate selected skill within one session; a canonical scan
  verifies every count, cost, and sample ID across all 30 full-corpus rows.
  A new v4 snapshot adds a day-partitioned tool-call projection. Its verifier
  matched 38,461 calls as well as all 7,783 sessions, 48,863 turns, 153,307
  spans, and 84,491 run events against the canonical files. Tool rows match
  SQLite on the fixture, including duration and sample-error fallback; an
  independent scan of all turns confirms every field across the 34 full-corpus
  rows. The v4 tool read takes about one second, down from about 52 seconds
  with raw turn-JSON expansion. The 200 run rows and workflow facets each read
  in about one second on v4 and exactly match their v3 outputs. Event rows
  now match SQLite's order and values on the all/filtered/missing-session
  fixture. A materialized event-type list avoids expanding full turn JSON;
  the v4 full read takes about four seconds. An independent scan of 7,783
  sessions, 48,863 turns, and 83,819 linked run events confirms counts, costs,
  and sample IDs for all 187 event rows. Model response rows match SQLite on
  the all/filtered/missing-session fixture, including estimated and unpriced
  costs. An independent canonical scan confirms every numeric field and
  sample ID for all 17 full-corpus model rows. The v4 model read took about
  26 seconds because it repeatedly parsed turn JSON.
  A composed `TraceInsightsResponse` now matches SQLite on the complete
  all/filtered/missing-session fixture. Tied failure and run rows have explicit
  matching sort keys in both readers. Full-response fixture parity also passes
  for date, outcome, domain, run/session prefix, text, model, mode, tier, skill,
  failure, tool/status, event-type, and combined filters. A verified v5 snapshot
  projects typed turn usage for all 48,863 turns. On that snapshot, summary
  and model reads take about four and one seconds respectively, versus 32 and
  26 seconds on v4. The unfiltered composed v5 response took 14 seconds versus
  68 seconds on v4, with zero field differences across the full corpus (numeric
  tolerance 1e-9). The first cold v4 response took 173 seconds, so latency
  remains workload-sensitive. Broad filters now reuse one temporary selected-
  session table and DuckDB connection across the response. A completed-outcome
  filter selecting 5,826 sessions fell from 42 to 14 seconds; an event-type
  filter selecting 3,906 sessions fell from 39 to 19 seconds. V3/V4 fallback
  reads and the full v5 filter fixture still match SQLite. A full-corpus
  tool-failure selection of 105 sessions also has zero v4/v5 response-field
  differences; its v5 read took 10 seconds versus 60 seconds on v4.
  The local insights HTTP route now supports opt-in `OBS_ANALYTICS=duckdb` over
  a verified v5 snapshot. It checks canonical-source freshness before and
  after the query, invalidates on server writes, and falls back to SQLite
  when the snapshot is stale or the query fails. Session-filtered HTTP payload
  parity with SQLite passed on the local corpus. A repeat request took about
  10 seconds (6.5 seconds in DuckDB and 3.5 seconds in freshness checks),
  while an earlier cold request took about four minutes; an unfiltered HTTP
  request passed in about 18 seconds. Latency is not yet certified. The viewer
  now waits for the main analytics response before loading its trend and limits
  daily trend requests to two at a time; it cancels them when the view changes.
  Headless browser acceptance passes for the default seven-day Analytics view,
  including its DuckDB-sourced main response and rendered trend chart (the main
  response took about 30 seconds). Corpus-wide hot-data union, direct
  production SQLite response parity for all filters, larger-corpus trend load
  testing, and derived-write retirement remain open. The flag stays off by
  default.
- Retire the legacy derived trace writes only after spine read parity and E2E
  acceptance. DuckDB is a separate, non-blocking analytics follow-up.

## Platform packs

- **PackPlugin interface** ([GAP-12](./engineering/contribution-seams.md)) — a
  plugin API so a new platform pack (Salesforce, SAP, Zendesk) needs zero
  core-file edits. The extracted `tools/servicenow/` adapter becomes the first
  conforming implementation. RFC-gated; actively recruited for.

## Experimental

- **Deeper brain/hands integration** — beyond the current default-off browser
  bridge (pi extension + MCP surface): richer mission protocols, grounded
  submits, cross-mission memory.
