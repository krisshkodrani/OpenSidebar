# RFC LP-7 — Unified Observability Engine (agent-callable trace search)

Lifecycle status: Decision stamped
Date: 2026-06-27
Decision date: 2026-06-27 (owner directed implementation via `/goal implement RFC LP-0007`)
Scope: new `scripts/obs/` MCP server (stdio; part of the existing `tools` nx project), new `packages/observability-schema/` (canonical span types + mappers), `scripts/log-server.ts` + `scripts/log-server-helpers.ts` (ingest projection, reuse of `matchesTraceFilters`), `scripts/trace-sqlite-store.ts` (`buildInsightsSql`) and `scripts/trace-insights.ts` (`buildTraceInsights`) (analytics; DuckDB tier is a non-blocking follow-up), `apps/extension/src/trace-viewer/` (read layer `api.ts`, trajectory tab, reuse of `analysis/trajectory.ts`). Out of scope: DuckDB on the critical path, the Streamable-HTTP `/mcp` mount, dev-server containerization (Docker — parked pending a local-environment-run overview), in-extension IndexedDB durability, and in-service-worker OTLP emission (all deferred — dev-tool only, follow-ups).
Related: OpenClaw RL Guidelines v5 (2026-06-11, `.artifacts/openclaw rl.pdf`) — the 1–5 trajectory grading rubric ("grade to the lowest dimension across all rubrics"; 1–2 Fail / 3–4 Non-Fail / 5 all-fives) that the reward signal reuses; **LP-1** (frozen trace archive / published numbers); **LP-4** (`finalStateSnapshot`, advisory judge — the verifier score that becomes trajectory reward); **LP-6** (silver-trajectory pairs + `NodeVerificationResult` justification shape)

## Problem

The trace/trajectory data layer works but is fragmented, and it has no
agent-callable surface.

- **No agent-callable interface.** The dev log-server (`scripts/log-server.ts`,
  port 7589) exposes a rich HTTP search API (`/api/traces/search`,
  `/api/trace-insights`, `/api/run-traces/:id`) consumed only by the React
  trace-viewer (`apps/extension/src/trace-viewer/api.ts`). An agent such as
  Claude Code cannot search traces without shelling out to
  `scripts/trace-query.ts` or hand-crafting localhost HTTP calls and parsing the
  responses. "Why did session X fail, and how did the silver run differ?" is not
  a question an agent can ask the system today.
- **Two parallel sources of truth.** Every ingest double-writes append-only
  JSONL (`traces/*.jsonl`) *and* a `better-sqlite3` index
  (`.artifacts/trace-index.sqlite`, `scripts/trace-sqlite-store.ts`). The JSONL
  is canonical; the SQLite is a rebuilt index. Any drift between them is a silent
  bug, and the recorder emits two bespoke wire shapes — `TraceEntry`
  (`packages/shared-types/src/traces.ts`) for agent turns and `RunTraceEvent`
  (`apps/extension/src/utils/run-trace.ts`) for orchestrator events — with no
  unifying model, so correlating a trajectory to its turns to its metrics means
  joining across `sessionId` / `runId` / `correlationId` by hand.
- **Duplicated aggregation.** Insights are computed twice — hand-rolled JS in
  `scripts/trace-insights.ts` (`buildTraceInsights`) and SQL in
  `scripts/trace-sqlite-store.ts` (`buildInsightsSql`) — each behind its own
  cache (30s server, 60s viewer in `trace-viewer/insights-cache.ts`). Two code
  paths must stay byte-compatible by hand.
- **Trajectory is informal.** `task_run_nodes.trajectory_json`
  (`apps/backend/src/db.ts`) stores a flat `string[]`; the richer scorecard
  (`apps/extension/src/trace-viewer/analysis/trajectory.ts`,
  `TrajectoryScorecard` — 1–5, min across `task_completion`/`tool_use`/
  `reliability`/`safety`) is computed in the viewer only. The OpenClaw RL unit of
  data is a graded `(state, action, reward)` trajectory; we have the grading
  shape but it is not a first-class, exportable artifact.

## Proposal

One canonical, OpenTelemetry-GenAI-shaped **span spine** becomes the source of
truth, read by three lenses — the **viewer** (observe), an **MCP server** (agent
search), and an **exporter** (RL trajectory / dataset). Projection happens
**server-side** in the ingest path, so the extension keeps emitting today's wire
types unchanged (no MV3 service-worker work). The agent-callable surface ships
**first**, over the store that already exists; the storage rework lands
underneath a stable MCP/HTTP contract.

### Stage A — MCP server (ships first, over the existing store)

Lives in `scripts/obs/` (the existing `tools` nx project) using
`@modelcontextprotocol/sdk@1.29.0` (**already a dependency**). Placement note: a
standalone `apps/observability-mcp` would need fragile composite TS project-refs
into extension internals; `scripts/obs/` is the proven home — `scripts/trace-query.ts`
already imports the same analysis + store modules, the `tools` project only needs
to pass eslint (no `typecheck`/`test` target), and the B-stage scripts
(`scripts/obs/duck.ts`, …) live here too. Transport: **stdio** for v1 (Claude Code
spawns it via `.mcp.json`); a Streamable-HTTP `/mcp` mount on the dev server is a
non-blocking follow-up for browser/remote clients. A shared `scripts/obs/core.ts`
reads the store **directly** through the **same** functions the HTTP routes use —
so it works whether or not the log-server (port 7589) is running, and adds no
query logic (it imports no MCP SDK, so it is unit-testable in isolation). Reuse:

- `matchesTraceFilters` / filter helpers in `scripts/log-server-helpers.ts`;
- `buildTraceInsights` (`scripts/trace-insights.ts`) or `buildInsightsSql`
  (`scripts/trace-sqlite-store.ts`);
- `buildTrajectoryScorecard`, `compareTraceSessions`, `analyzeTraceSession`,
  `buildHarnessRatchetCandidates` (`apps/extension/src/trace-viewer/analysis/`).

Tools (input/output schemas mirror the existing `TraceFilters` /
`TraceInsightsResponse`): `search_traces`, `get_trace`, `get_run`,
`get_trajectory`, `query_insights`, `find_failures`, `compare_runs`,
`list_tool_usage`, `get_blob`, `get_span`. Registered via a repo-root `.mcp.json`;
started with `pnpm run mcp` (tsx). **Outcome of this stage alone:** Claude Code
searches traces. Everything below happens behind this surface.

### Stage B0 — Canonical span schema

New `packages/observability-schema/` (pure types + deterministic mappers; depends
on `shared-types`; importable by scripts, MCP, viewer). Kept **separate** from
`packages/shared-types/src/traces.ts`, which stays the legacy recorder contract.
OTel-GenAI shape: `traceId = correlationId`; hierarchy `orchestrator.run →
agent.session → agent.turn → {gen_ai.chat, gen_ai.perception, execute_tool}`.
Standard `gen_ai.*` attributes (model, token usage, cost) for the known fields;
custom `os.*` for the rest. Span ids derive deterministically from
`turnId`/`executionId`/`eventId` so backfill is idempotent. Mappers cover every
`TraceEntry` / `TraceSession` / `RunManifest` / `RunTraceEvent` field → span
attribute, span-event, or **content-addressed blob ref** (`traces/obs/blobs/<sha256>`).
Heavy/open-ended fields go to blobs: screenshots, DOM snapshots,
`contextMetrics.promptSections`, generic `event.data`. Derived artifacts
(`TrajectoryScorecard`, `skillToolMetrics`) are **not** stored raw — they are
projections (Stage B3).

### Stage B1 — Single source of truth (server-side projection)

In `scripts/log-server.ts` ingest, project incoming wire types → spans and write
the spine once: append-only **NDJSON** (hot, human-readable) + **Parquet**
(compacted, day-partitioned) + the CAS blob store. This single write replaces the
current JSONL+SQLite double-write. Migration is non-breaking: dual-write spans
alongside the old store → dual-read parity check → cutover reads → retire old
writes. An idempotent `scripts/obs/backfill-spans.ts` reuses the B0 mappers to
convert historical `traces/*.jsonl`. `better-sqlite3` is retained **only** for the
mutable backend ledger (`apps/backend/src/db.ts`); the span spine is
immutable/read-only.

### Stage B2 — DuckDB analytics tier

`scripts/obs/duck.ts` (lazy `@duckdb/node-api`, views over Parquet ∪ hot NDJSON)
and `scripts/obs/insights-duck.ts` port `buildInsightsSql` / `buildTraceInsights`
to emit the **identical** `TraceInsightsResponse` so the viewer and MCP are
untouched — collapsing the two duplicated aggregation paths into one. DuckDB is a
columnar OLAP engine (analytics) complementing `better-sqlite3`'s OLTP role
(live state); it reads the Parquet exports directly, letting the insights caches
be retired once it is the default. **This stage is non-blocking:** Stage A and the
B1 cutover ship on the existing SQLite/JS aggregation, which is kept as a
**permanent fallback** (never removed); DuckDB slots in over the Parquet spine
later without changing the contract. Native-module/arch risk is therefore bounded
by lazy-load behind an `OBS_ANALYTICS` flag with that fallback; it is **never**
bundled into the extension.

### Stage B3 — RL trajectory projection

Pure `apps/extension/src/trace-viewer/analysis/rl-trajectory.ts` derives ordered
`(state, action, reward)` steps from spans: `state` = DOM-snapshot + perception
blob refs; `action` = the tool-call span; `reward` = the verifier/judge score
(`verification_gate_json` / LP-4 `NodeVerificationResult`), shaped by the OpenClaw
1–5 rubric — reusing the action-tier and "grade to the lowest dimension"
scorecard logic already in `analysis/trajectory.ts`. The trajectory is a
**derived view**, never a sidecar store (avoids reintroducing the
`trajectory_json` drift). Surfaces: a viewer `TrajectoryTab`,
`GET /api/traces/:id/trajectory`, MCP `get_trajectory`, and
`scripts/obs/export-trajectories.ts` (SFT/DPO/bench export). This makes the trace
store the eval+training asset the OpenClaw flow assumes, and dovetails with LP-6
silver pairs.

### Stage B4 — Viewer migration

`apps/extension/src/trace-viewer/api.ts` is already endpoint-based; preserving
response **shapes** means the viewer "just works." Only addition: `fetchTrajectory`.
The dual JSONL/SQLite read fallbacks are deleted only at the end, once span reads
are proven at parity.

## Risks and guardrails

- **MV3 ephemeral service worker.** Avoided entirely: projection is server-side,
  so the extension wire format is unchanged. Direct in-SW OTLP emission is
  explicitly out of scope; if later wanted it gets its own RFC.
- **DuckDB native module under tsx (arch mismatch).** Lazy-load behind
  `OBS_ANALYTICS` with a fallback to the existing SQLite/JS aggregation; pin the
  native arch; never ship it in the extension bundle.
- **Source-of-truth cutover / historical drift.** Additive dual-write then
  dual-read parity before any retire; idempotent backfill (run twice → identical
  spans and blob hashes). The old store is removed only after parity holds.
- **Schema sprawl in `os.*` attributes.** OTel attributes are primitives/arrays
  only; fat nested state must not live on spans. Guardrail: heavy/open-ended
  fields are blob refs by rule, validated by a field-coverage test.
- **MCP becoming a second query engine.** Guardrail: `core.ts` may only call
  existing filter/insight/analysis functions; a lint/test asserts no bespoke
  SQL or filtering lives in the MCP package.

## Alternatives

- **Adopt Langfuse / Arize Phoenix wholesale and retire the viewer.** Rejected: a
  generic LLM-trace UI cannot render DOM snapshots, perception modes, or the
  AFFORDANCES/`os.*` domain data the viewer is built around. We standardize the
  data model (OTel-GenAI) under our own domain viewer instead, keeping optional
  OTLP export as a future bonus.
- **In-extension IndexedDB durability (works for real end-users without 7589).**
  Deferred: out of the dev-tool scope chosen here, and it reintroduces the MV3
  ephemeral-worker flush problem. A separate RFC if production capture is wanted.
- **Keep the dual JSONL+SQLite store; just add the MCP server.** This is exactly
  Stage A, and it ships first — but stopping there leaves the drift and duplicated
  aggregation in place. The B-stages are the cleanup the MCP surface makes safe.
- **Store the RL trajectory as a new persisted table.** Rejected: recreates the
  `trajectory_json` sidecar-drift problem. The trajectory is a projection.
- **Do nothing.** Agents stay unable to search traces; the store stays
  double-written and double-aggregated. Rejected.

## Testing

- **Stage A (MCP):** vitest unit tests for the core query functions
  (`scripts/obs/core.test.ts`, node env, run via `pnpm run obs:test`) asserting
  results match the existing filter/insight/analysis functions on a fixture
  session; manual check — `pnpm run mcp`, call `search_traces` / `get_trajectory`
  from Claude Code, confirm parity with the viewer.
- **Stage B0/B1 (projection + source of truth):** field-coverage test that every
  `TraceEntry` / `RunTraceEvent` field maps to a span attr, span-event, or blob
  ref; dual-read parity test (span-projected reads equal current JSONL/SQLite
  reads for a fixture); backfill idempotency test (run twice → identical spans /
  blob hashes).
- **Stage B2 (DuckDB):** parity test — DuckDB `TraceInsightsResponse` equals the
  SQLite/JS output for a fixture set; fallback test with `OBS_ANALYTICS` off.
- **Stage B3 (trajectory):** every span folds into a `(state, action, reward)`
  step; reward matches the OpenClaw grade-to-lowest scorecard on a fixture;
  export produces valid SFT/DPO records.
- **Stage B4 (viewer):** `pnpm run verify`; viewer renders sessions / turns /
  insights / screenshots plus the new Trajectory tab against the new read API.
- Respect the vitest env split: node env for scripts / MCP / backend, happy-dom
  for viewer / extension.

## Rollout

Large, but front-loaded for value. **Stage A is independently shippable (~2–3
days)** and delivers the headline agent-search capability over the current store;
it can land and be used while the B-stages proceed. B0→B1→B2 are additive
(dual-write/dual-read) until a single read cutover; B3 and B4 follow. No stage
breaks the viewer because response shapes are preserved throughout. Changing the
chosen scope (introducing in-extension durability or in-SW OTLP) would need a new
stamp.

## Recommended Decision

> This is an agent recommendation, not an owner Decision Stamp. Per
> `rfc-decision-process.md`, no implementation may begin until the owner records
> a `## Decision` stamp (copy the recommended stamp below into a `## Decision`
> section and validate with `pnpm rfcs:check -- <path>`).

Recommended status: **Approved**

Chosen path (recommended):

- Ship Stage A first: a **stdio** MCP server (`apps/observability-mcp/`) over the
  existing store, reading it through the same `core.ts` functions the HTTP routes
  use (works with or without the log-server running); reuse `matchesTraceFilters`
  / insight / analysis functions; register via `.mcp.json`.
- Introduce `packages/observability-schema/` (OTel-GenAI spans + deterministic
  mappers) and project server-side in `scripts/log-server.ts`; migrate to a single
  NDJSON+Parquet+CAS spine via dual-write → dual-read → cutover.
- Derive the RL `(state, action, reward)` trajectory from spans (reward from the
  LP-4 verifier score, shaped by the OpenClaw 1–5 grade-to-lowest rubric) as a
  viewer tab, an MCP tool, and a dataset export.
- Keep the engine dev-only; exclude in-extension IndexedDB and in-SW OTLP.

Required edits before implementation:

- None.

Recommended non-blocking follow-ups:

- DuckDB analytics tier (Stage B2): adopt `@duckdb/node-api` over the Parquet
  spine behind `OBS_ANALYTICS`, keeping the existing SQLite/JS aggregation as a
  permanent fallback. Off the critical path — Stage A and the B1 cutover do not
  depend on it, and it does not change `TraceInsightsResponse`.
- Streamable-HTTP `/mcp` transport on the dev server, for browser/remote MCP
  clients.
- Dev-server containerization (Docker) is **parked, not scheduled** — revisit only
  after a holistic local-environment-run overview (`nx run tools:dev-stack` /
  `tools:local-server`) exists. DuckDB stays an embedded library regardless.

Recommended do-not-do:

- Do not emit OTLP from the MV3 service worker or add in-extension IndexedDB in
  this RFC.
- Do not add query/filter/SQL logic inside the MCP package — it may only wrap
  existing functions.
- Do not persist the trajectory as a new table — it is a projection.

Recommended evidence before merge:

- Stage A: per-tool MCP parity tests vs the HTTP API; a live `get_trajectory`
  against a recorded session.
- Stage B: field-coverage test, dual-read parity test, backfill idempotency test,
  and a DuckDB↔SQLite `TraceInsightsResponse` parity test.

Recommended next action: **Implement** — Stage A is unblocked; the B-stages land
additively behind the stable MCP/HTTP contract, and the two follow-ups above are
scheduled after the read cutover.

## Decision

Status: Approved

Chosen path:
- Ship Stage A first: a stdio MCP server (`scripts/obs/`, in the `tools` project) over the
  existing trace store, reading it through a shared `core.ts` that wraps the same
  functions the log-server HTTP API uses (`matchesTraceFilters`,
  `buildTraceInsights` / `buildInsightsSql`, `buildTrajectoryScorecard`,
  `compareTraceSessions`, `analyzeTraceSession`, `buildHarnessRatchetCandidates`);
  register via repo-root `.mcp.json`.
- Land the storage rework underneath the stable MCP/HTTP contract:
  `packages/observability-schema/` (OTel-GenAI spans + deterministic mappers),
  server-side projection in `scripts/log-server.ts` to one NDJSON+Parquet+CAS spine
  via dual-write → dual-read parity → cutover, then the RL `(state, action, reward)`
  trajectory projection and the viewer repoint.
- Keep the engine dev-only; the trajectory reward derives from the LP-4 verifier
  score shaped by the OpenClaw 1–5 grade-to-lowest rubric.

Required edits before implementation:
- None.

Non-blocking follow-ups:
- DuckDB analytics tier (Stage B2) over the Parquet spine behind `OBS_ANALYTICS`,
  with the existing SQLite/JS aggregation kept as a permanent fallback.
- Streamable-HTTP `/mcp` transport for browser/remote MCP clients.
- Dev-server containerization (Docker) — parked until a holistic
  local-environment-run overview exists.

Do not do:
- Do not emit OTLP from the MV3 service worker or add in-extension IndexedDB
  durability in this RFC.
- Do not add query/filter/SQL logic inside the MCP package — it may only wrap
  existing functions.
- Do not persist the RL trajectory as a new table — it is a projection.

Evidence required before merge:
- Stage A: per-tool MCP parity tests vs the existing HTTP/query functions, and a
  live `get_trajectory` against a recorded session.
- Stage B: field-coverage test, dual-read parity test, backfill idempotency test,
  and a DuckDB↔SQLite `TraceInsightsResponse` parity test.

Next action:
- Implement
