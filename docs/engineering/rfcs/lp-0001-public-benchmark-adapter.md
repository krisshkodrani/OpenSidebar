# RFC LP-1 — Public Benchmark Adapter & Published Numbers

Lifecycle status: Draft
Date: 2026-06-10
Owner decision: Pending
Scope: `tests/e2e` harness reuse, a new `scripts/bench-*` runner, trace frozen-bundle export, README/launch copy. No product-runtime changes except those separately approved.
Related: SOTA Gap Analysis GAP-2 (internal regression benchmarking); RFC 0005 (frozen-bundle export, implemented)

## Problem

OpenSidebar launches with no externally verifiable performance number. All
published evidence is internal: fixture E2E suites (92% natural-prompt v2) and
a single-seed WorkArena baseline (33/33 with the ServiceNow platform pack).
Neither is comparable to anything outside this repo, and the 2026 field is
actively hostile to unverifiable claims (HAL exists because scaffold-reported
numbers were systematically inflated; "SOTA on our own fixtures" reads as a
red flag to exactly the collaborators we want to attract).

Without a public benchmark:

- The launch claim "solid agentic performance on web work" has no floor.
- We cannot detect whether we're ahead of or behind Nanobrowser/Browser Use on
  neutral ground.
- Collaborators have no shared scoreboard to improve against — the
  contribution flywheel (LP-3) has no metric.

## Motivation (both lenses)

- **AI researcher:** comparability requires a community benchmark with a
  published protocol. Online-Mind2Web (300 verified tasks, 136 live sites,
  WebJudge auto-eval) is the current live-web standard; SOTA sits around
  ~42%, so honest mid-range numbers are publishable without embarrassment —
  the benchmark is not saturated.
- **AI engineer:** a pinned external task set is a regression suite that
  internal fixtures cannot fake. Frozen-bundle exports (RFC 0005, shipped)
  give every published number a re-openable receipt.

## Proposal

Two stages; only Stage 1 blocks launch.

### Stage 1 — Headed adapter on the existing E2E harness (launch-blocking)

1. **Task source:** vendor the Online-Mind2Web task list (JSON) under
   `tests/bench/online-mind2web/tasks/` with its license and revision pinned.
   Start with a stratified 100-task subset (easy/medium/hard per the
   benchmark's own difficulty labels).
2. **Runner:** `scripts/run-bench.ts` reusing the Puppeteer headed-Chrome
   machinery from `scripts/run-e2e-staged.ts` and `tests/e2e/helpers/`:
   load extension, drive task via the e2e-helper page, collect the run trace,
   export a frozen bundle per task. The runner is harness-only — no product
   logic (AGENTS.md fixture policy applies).
3. **Scoring:** primary = WebJudge auto-eval as specified by the benchmark
   (separate judge model, configurable provider key); secondary = manual
   verification of a 20% random sample, with disagreement rate reported next
   to the headline number (honest-aggregates discipline, RFC 0002 culture).
4. **Safety rails for live-web runs:** benchmark profile forces
   `requireApprovals` semantics suitable for unattended runs — a domain
   allowlist derived from the task list, hard refusal of payment/checkout
   submission, and `allowNavigation` scoped to the task's site. Write-style
   tasks that would mutate third-party state beyond the benchmark's own
   protocol are skipped and counted as skipped, not failed.
5. **Publication:** README gets a "Measured performance" section with: score,
   subset definition, model/provider config, date, cost per task, and a link
   to the frozen-bundle archive. Numbers are reported per model config (this
   is a BYOK scaffold — the scaffold is the product, so publish 2–3 model
   configs rather than one cherry-picked pairing).

### Stage 2 — Headless agent-core runs (post-launch, separate decision)

The full headless agent-core runtime is currently deferred (AGENTS.md). Stage
1 deliberately does not require it. If benchmark iteration cost (headed
Chrome, ~minutes/task) proves limiting, a follow-up RFC can re-scope the
minimal headless runtime; this RFC must not be read as approval for it.

## Cost estimate

100 tasks × ~$0.10–0.30/run (observed internal averages) × 2 configs ≈
$20–60 per full sweep, plus judge calls (~$5). Weekly cadence is affordable;
per-PR is not — per-PR regression coverage stays on internal fixtures
(GAP-2), which this RFC complements but does not replace.

## Alternatives

- **WebVoyager:** saturated (top scaffolds 94–99%); a high score there is no
  longer informative, and a low one is fatal. Rejected as primary; optional
  later as a smoke set.
- **WebArena:** self-hosted dockerized sites; heavyweight to operate, and the
  leaderboard is dominated by RL-trained models — wrong comparison class for
  a BYOK scaffold. Rejected for launch.
- **WebBench (Skyvern):** larger (5,750 tasks) and write-heavy; good
  post-launch stretch goal once Stage 1 is routine. Deferred.
- **BrowserGym integration:** maximal comparability but requires the headless
  agent-core (Stage 2 dependency) and a Playwright adapter. Deferred.
- **Publish internal fixture numbers only (status quo):** unverifiable;
  exactly the pattern the field has learned to discount. Rejected.

## Testing

- Unit: task-list loader validates schema/pin; runner config builds the
  correct safety profile per task.
- Integration: runner completes a 3-task smoke subset end-to-end in CI-like
  conditions (manual trigger, not per-PR), producing valid frozen bundles
  (`validateFrozenTraceBundle`).
- Judge harness: golden transcript fixtures verify WebJudge prompt assembly
  and verdict parsing.

## Rollout

Largest of the three P0s (~1–2 weeks of focused work). Sequence after LP-2 so
the first published sweep reflects the rescued agent. First public sweep is a
launch-blocking artifact; subsequent sweeps run on a weekly manual cadence.

## Recommended Decision (agent recommendation — not an owner stamp)

Status: Approved with edits

Chosen path:

- Stage 1 only: headed Online-Mind2Web 100-task adapter on the existing E2E
  harness, WebJudge + manual-sample scoring, frozen-bundle receipts, README
  publication per model config.

Required edits before implementation:

- Owner picks the 2–3 model configs to publish and the cost ceiling per sweep.
- Confirm the Online-Mind2Web subset, license handling, and skip policy for
  write-mutating tasks.

Non-blocking follow-ups:

- WebBench subset; BrowserGym/headless Stage 2 as a separate RFC.

Do not do:

- Do not build the headless agent-core under this RFC.
- Do not add benchmark-specific branches to product runtime to lift the score
  (AGENTS.md WorkArena philosophy applies verbatim to public benchmarks).
- Do not publish a number without the frozen-bundle archive and the manual
  disagreement rate alongside it.

Evidence required before merge:

- A complete 100-task sweep with score, cost, judge/manual disagreement rate,
  and re-openable frozen bundles for every task.
- Smoke-subset integration test green; `pnpm run verify` green.
