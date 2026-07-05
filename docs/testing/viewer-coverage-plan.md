# Trace Viewer - Test Coverage Plan

Date: 2026-05-30

Scope: close the coverage gaps for the trace viewer, prioritized by the dual
(AI-researcher / AI-engineer) feature review. Today the viewer has **28 unit/
component test files (113 cases) in happy-dom with mocked `fetch`, and 0
real-browser e2e tests.**

## Guiding principle

Weight new coverage toward the **weak spots the review surfaced**: evidence
*trust/freshness* and *real-bundle fidelity*, not toward re-testing the pure
`analysis/*` functions, which happy-dom already covers well. Three tiers:

1. Trust invariants (unit/component, happy-dom): cheap, highest bug-density.
2. Real-browser smoke (headless Puppeteer, mocked `/api/*`): the missing layer.
3. Contract/parity guards (unit): pin things that silently drift.

---

## Tier 1 - Trust & freshness invariants (happy-dom, extend existing harness)

These target the architecture doc's #1 risk ("selected sessions cannot show
stale evidence"), the family the recent hardening already touched.

- **Detail isolation**: selecting B while A's entries/logs/run-events are still
  in-flight never shows A's data under B (extends the existing stale-data test
  in `use-trace-data.test.tsx`).
- **Cross-tab evidence keying**: evidence/perception/logs for the open session
  are never rendered against a different session's turns. Assert via store +
  component (`PerceptionList`, `EvidenceTimeline`, `LogList`).
- **Screenshot expiry signaling**: when a screenshot URL 404s/expired, the turn
  card shows an explicit "expired/unavailable" affordance, NOT a broken image
  read as "perception failed". (Component test on `TurnSnapshotSection` /
  `PanoramicThumbnails` with a failing image src.)
- **Investigation finding -> evidence pointer integrity**: every
  `InvestigationFinding.evidence` pointer resolves to a real turn/tool/event in
  the session (no dangling pointers). Pure test over `analyzeTraceSession`
  output against fixture entries.
- **Filter <-> refetch correctness**: changing a filter refetches the session
  list but does not blank the open trace unless it falls out of results
  (complements the runId-derived guard we added).

## Tier 2 - Real-browser smoke (NEW headless Puppeteer harness)

The missing layer: run the actual built bundle in Chrome against a server, so
layout-driven behavior, asset loading, and real `/api/*` round-trips are
exercised. **Headless, no extension, no LLM**: deterministic and CI-cheap.

Location: `apps/extension/tests/viewer-e2e/` (kept OUT of the agent
`tests/e2e/` staged runner so it inherits neither the extension load nor
provider-key gating / `validateSuites`).

Files:
- `viewer-server.ts`: `http.createServer` (pattern from
  `tests/e2e/helpers/fixture-server.ts`): serves `dist/src/trace-viewer/
  index.html` at `/viewer`, `/assets/*` from `dist/assets/` (mirrors
  `scripts/log-server.ts`), and mocks the full viewer API surface from
  `trace-viewer/api.ts`: `/api/traces/search`, `/api/traces/days`,
  `/api/traces/models`, `/api/traces/:id`, `/api/run-traces/:id`,
  `/api/logs/:id`, `/api/trace-insights`, `/api/trace-index/status`,
  `/api/skills`.
- `fixtures.ts`: one seeded session, ~5 turns: varied `modelTier`,
  `durationMs`, a `plan_monitor` event + `planDecomposition`, one tool failure,
  one degraded-perception turn, and one expired-screenshot turn (so failure/
  perception/integrity surfaces have real content).
- `vitest.viewer-e2e.config.ts`: node env, single fork, ~60s timeout.
- `trace-viewer.smoke.test.ts`: `puppeteer.launch({ headless: true })`,
  navigate to `http://127.0.0.1:<port>/viewer`.

Assertions (map to changed code + review priorities):
1. Boot + sessions list renders from the mocked search endpoint.
2. Drill-in: click a session -> detail view (`TraceDetailHeader`, subview toggle).
3. Turns tab: `TurnTimeline` renders one segment per turn; clicking a segment
   navigates to that turn (memoization + `navigateToTurn`).
4. Plan tab: step statuses + a turn range render (`buildStepStatuses` path).
5. **Scroll persistence (real layout)**: scroll the turns container, switch tab
   and back, assert scroll restored: the one thing happy-dom cannot verify
   (covers the H1 rAF-flush + restore effect).
6. Insights debounce: typing in the filter issues <=1 `/api/trace-insights`
   request within the debounce window (`useDebounce`).
7. Investigation summary: a seeded failing session shows a headline +
   recommended action + a clickable evidence pointer that lands on the turn.

Build dependency: requires a built `dist/`. The runner should rebuild (or
hard-fail with a clear message) so the test reflects current source.

## Tier 3 - Contract / parity guards (unit)

- **Insights aggregate parity**: the JSONL-backed and SQLite-backed insights
  paths must produce the same aggregate shape for the same input (the doc
  mandates this; nothing pins it). Table-driven test over both code paths.
- **Fleet metrics report `n`**: extend `analyzeTraceFleet` output (or at least
  assert) that each cluster carries its sample size, so the UI can stop
  presenting point estimates without counts. (Research-lens fix: surfaces the
  nondeterminism caveat instead of hiding it.)
- **Finding confidence provenance**: a test that documents/locks how
  `confidence` is derived (even if heuristic), so it can't silently change
  meaning.

## Explicitly out of scope (already well covered)

- Pure `analysis/*` happy-path logic (analyze, comparison, evidence, fleet,
  timeline-diff, validation): 13 logic test files already exist; expand only
  where Tier 1/3 invariants require it.
- Agent behavior: covered by the `tests/e2e/` smoke/interaction/runtime suites.

## Suggested sequencing

1. Tier 1 trust invariants (fastest, highest bug-density, reuses harness).
2. Tier 2 viewer-e2e harness + smoke (the structural gap; ~1 new dir).
3. Tier 3 parity/labeling guards (prevents silent drift + research misreads).

## Verification of this coverage work

- `npx vitest run --config apps/extension/vitest.config.ts apps/extension/tests/trace-viewer/`
- `npx vitest run --config apps/extension/tests/viewer-e2e/vitest.viewer-e2e.config.ts` (new)
- `npx tsc -b apps/extension/tsconfig.json` and `npm run lint`
- Keep Tier 2 out of `nx run extension:test-e2e-staged`; optionally add the
  viewer-e2e script to `ci:test` since it is deterministic and LLM-free.
