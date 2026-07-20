# RFC LP-18 — JobAgent Queue Scheduler & Notification Channel

Lifecycle status: Draft (not stamped)
Date: 2026-07-20
Scope: `scripts/jobagent-console/` (scheduler loop, notification dispatch, new API routes), `scripts/jobagent/` (stage runners refactored to be scheduler-callable), console UI (schedule panel, event feed). No extension changes; no changes to the status lifecycle or either human gate.
Related: [JobAgent automation gap analysis](../jobagent-automation-gap-analysis.md) §G1/G2/G5; pi-backend integration notes (`docs/engineering/pi-backend-spike.md`); RFC LP-19 (consumes this RFC's track record), RFC LP-20 (its drafts flow through the same queue)

## Problem

The JobAgent pipeline is autonomous within each stage but fully manual
*between* stages. A single application currently requires a human to (1) start
a discovery sweep, (2) request kit drafting, (3) approve the kit, (4) launch
the fill, and (5) approve the submit — of which only (3) and (5) are
judgment; (1), (2), and (4) are pure triggering. Worse, the judgment steps are
invisible unless the console tab is open: a run parked at `awaiting-approval`
expires after 600 seconds, and a kit blocked on TODOs waits silently forever.

The result is that "the pipeline works" (live-proven 2026-07-19) but its
throughput is bounded by human attention on mechanical steps, and the two
steps that genuinely need attention have no way to request it.

## Proposal

### 1. Stage scheduler inside the console process

A single scheduler loop in `scripts/jobagent-console/` (the process that
already owns the WS bridge and the run mutex) advances packages through the
mechanical transitions:

- **Sweep stage** (interval, default daily, configurable window): spawn pi for
  a discovery run exactly as the manual path does today (close bridge → spawn
  child → reacquire port with retry). New listings land as `reviewing` with
  their audit trail, unchanged.
- **Draft stage** (event-driven): any `reviewing` package without a kit gets
  one drafted immediately. Kits with zero TODOs are marked *ready for review*;
  kits with TODOs raise a notification (below). No approval is ever implied —
  drafting is already deterministic and side-effect-free.
- **Re-assess pass**: when the criteria file's hash changes, queued
  `reviewing` packages are re-scored by `assessListing`; newly out-of-scope
  packages are moved to `archived` with the assessment reason recorded (this
  retroactively clears the 4 geo-rejected packages stranded by the first
  sweep).
- **Fill stage** (event-driven, mutex-honoring): packages in `ready` are
  filled one at a time through the existing single-run mutex. On
  `filled-awaiting-submit` → notification. On `awaiting-approval` →
  notification (this is the submit gate firing mid-fill).

The scheduler holds **no new state machine**: every transition it performs
already exists and still goes through `recordStatus`, which remains the only
status writer. Illegal jumps still 409; the scheduler treats a 409 as a bug
signal, not something to retry.

### 2. Serialization constraint honored, not redesigned

One bridge port owner and one live run at a time is a correctness constraint
(orchestrator same-workspace replacement does not await the stop drain). The
scheduler is therefore a *queue* worker, never a pool: discovery (which needs
the port handed to pi) and fills (which need the console holding it) are
mutually exclusive phases with explicit hand-over, exactly as the manual flow
does today. Throughput scaling is a non-goal (see Non-goals).

### 3. Notification channel

Two tiers, dispatched from the console process:

- **Blocking events** (human input is the dependency): kit drafted with TODOs,
  fill parked at `awaiting-approval`, approval expired (410) and re-runnable,
  fill failed. Delivery: OS desktop notification (loopback-served, no external
  service) plus an optional generic webhook URL (`POST` JSON) for anything the
  owner wants to bridge (phone push, chat).
- **Digest events** (informational): sweep summary (queued/rejected/dup
  counts), fills completed, packages archived by re-assess. Delivery: console
  event feed (SSE, already exists) plus inclusion in the next blocking
  notification as a summary line.

Notification payloads carry package id, state, and a deep link into the
console — never PII values (answers stay on disk; a notification saying which
field is TODO is fine, its content is not).

### 4. Schedule and kill controls

- `schedule.json` next to the criteria file: sweep interval/window, fill
  concurrency (fixed at 1, present for forward-compat), quiet hours,
  per-stage enable flags.
- A master pause (console UI toggle + API) that finishes the in-flight run and
  then stops advancing. Scheduler state is derivable — pausing loses nothing.
- Every scheduler action appends to a `scheduler-log.jsonl` audit line
  (stage, package, outcome, duration) so LP-19 has a clean track record to
  calibrate against.

## Non-goals

- **No change to either human gate.** Kit approval and submit approval remain
  unconditionally manual; this RFC only makes the mechanical stages
  self-advancing and the judgment stages *visible*. Autonomy policy is LP-19.
- **No concurrency.** The single-run mutex stays; redesigning workspace
  replacement for parallel fills is out of scope.
- **No hosted/external services.** Everything remains loopback; the webhook is
  outbound-only and off by default.
- **No auto-archive of failures.** A failed fill parks for human triage.

## Risks

- **Scheduler-triggered fill at an unattended moment** hits the submit gate
  and expires (410). Mitigation: quiet hours + the expiry is already
  re-runnable by design; the notification tier exists precisely for this.
- **pi spawn flakiness under automation** (port handover races). The manual
  path's retry-on-reacquire is reused verbatim; a failed handover pauses the
  sweep stage and notifies rather than retrying unboundedly.
- **Notification fatigue** → owner disables the channel → worse than before.
  Mitigation: strict two-tier split; digests never push.

## Open questions

1. Desktop notification mechanism on Windows without an external dependency
   (PowerShell toast vs. a tiny tray helper) — spike needed.
2. Should the fill stage require a fresh dry-run "clean" check before
   launching a fill for a kit approved more than N days ago (form drift)?
3. Where does the schedule live: seed dir (per-candidate) or console config
   (per-machine)? Recommendation: seed dir, beside `search-criteria.json`.

## Recommended Decision

Approve as scoped: scheduler + notifications with both human gates untouched,
single-run serialization honored, all transitions through `recordStatus`.
Implement in the console process only; land behind a `schedule.json` that
defaults to all stages disabled so merging is behavior-neutral until the owner
opts in. Sequence before LP-19 (which needs this RFC's audit log for
threshold calibration); independent of LP-20.
