# RFC LP-18 — JobAgent Queue Scheduler & Notification Channel

Lifecycle status: Draft (not stamped) — revision 2, incorporating the
[glm-5p2 second-opinion review](../rfc-review-jobagent-autonomy-glm-2026-07-20.md)
(F3, F5, F6, F8, F9, F13, M2)
Date: 2026-07-20
Scope: `scripts/jobagent-console/` (scheduler loop, notification dispatch, approval-decision logging, new API routes), `scripts/jobagent/` (stage runners refactored to be scheduler-callable; one status-lifecycle addition, see §5), console UI (schedule panel, event feed). No extension changes; neither human gate changes.
Related: [JobAgent automation gap analysis](../jobagent-automation-gap-analysis.md) §G1/G2/G5; pi-backend integration notes (`docs/engineering/pi-backend-spike.md`); RFC LP-19 (consumes this RFC's approval-decision log), RFC LP-20 (its drafts flow through the same queue)

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
  sweep). `ready` packages are re-scored too, but are **parked with a
  notification rather than archived** — they passed a human gate already, so
  only a human may retire them.

  Packages already in flight (`filled-awaiting-submit`, `awaiting-approval`)
  are not interrupted mid-run, but the re-assess pass sets a durable
  **`outOfScope` flag** on them with its reason. The flag is what carries the
  criteria change forward: the submit-approval screen shows it as a warning,
  and LP-19 §2 always-parks any package carrying it, at every level. So an
  application the owner no longer wants can never be auto-submitted — it
  reaches a human or it does not go out.
- **Fill stage** (event-driven, mutex-honoring): packages in `ready` are
  filled one at a time through the existing single-run mutex, subject to the
  pacing limits in §6. On `filled-awaiting-submit` → notification. On
  `awaiting-approval` → notification (this is the submit gate firing
  mid-fill).

The scheduler holds **no new state machine**: every transition it performs
already exists (with the single addition in §5) and still goes through
`recordStatus`, which remains the only status writer.

**Concurrency model and 409 handling.** The scheduler is a single async loop
inside the console process, interleaving with HTTP handlers at await points —
so a human can approve, edit, or pause a package between the scheduler's
state read and its action. A 409 is therefore only a bug signal when the
scheduler's *own* derivation was wrong. On any 409 the scheduler re-reads the
package: if the on-disk status differs from what it read at decision time, it
is a benign human race — drop the action and re-evaluate on the next tick,
no notification. If the status is unchanged and the transition still 409s,
the scheduler's logic is wrong: stop the scheduler and notify.

### 2. Serialization constraint honored, not redesigned

One bridge port owner and one live run at a time is a correctness constraint
(orchestrator same-workspace replacement does not await the stop drain). The
scheduler is therefore a *queue* worker, never a pool: discovery (which needs
the port handed to pi) and fills (which need the console holding it) are
mutually exclusive phases with explicit hand-over, exactly as the manual flow
does today. Throughput scaling is a non-goal (see Non-goals).

**Discovery must not starve behind parked fills.** A fill paused at
`awaiting-approval` holds the port until the 600s gate expiry, so a naive
loop that immediately re-fills every expired package can block sweeps
indefinitely. Two rules bound this without making a paused fill survive a
bridge teardown (which would mean new orchestrator resume machinery):

1. **An expired approval never auto-re-runs.** Expiry parks the package for
   human action with a notification. This is also what kills the
   park → expire → re-fill → park cycle at its source.
2. **Sweeps get a reserved window.** When a scheduled sweep is due, the fill
   stage stops launching new fills; the sweep starts as soon as the in-flight
   run reaches a terminal or parked state. Worst-case sweep delay is one gate
   expiry, not unbounded.

### 3. Notification channel

Two tiers, dispatched from the console process:

- **Blocking events** (human input is the dependency): kit blocked on any
  unresolved field, fill parked at `awaiting-approval`, approval expired,
  fill failed, package parked by re-assess. Delivery: OS desktop notification
  (loopback-served, no external service) plus an optional generic webhook URL
  (`POST` JSON) for anything the owner wants to bridge (phone push, chat).

  A blocked kit's notification carries a **per-field blocking reason** drawn
  from a shared vocabulary defined once (LP-20 owns it, since it introduces
  the second reason): `todo` — no answer exists, the human writes it; and
  `drafted` — an LLM draft is waiting to be reviewed or edited. These demand
  different work, and a notification that says "TODO" for a ready-to-review
  draft mis-sets the human's expectation, so the distinction is part of the
  payload contract, not a UI detail.
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
  (stage, package, outcome, duration).

**Two logs, because they answer different questions.** `scheduler-log.jsonl`
records what the *machine* did; it cannot calibrate an autonomy policy,
because LP-19's thresholds are counts of what *humans decided*. So this RFC
also specifies `approval-decisions.jsonl`, written on **every gate resolution
— human or policy** (LP-19 L2 auto-approvals included, carrying
`approvedBy: "policy"`). Policy approvals do not count toward LP-19's
precedent thresholds — only `approvedBy: "human"` rows do — but they are
still gate resolutions that reached a real ATS, so anything counting
submissions (§6 pacing above all) must see them. A log that recorded only
human decisions would let L2 submit without pacing, which is precisely the
bot-detection risk pacing exists to prevent.

Row fields:

| Field | Why LP-19 needs it |
| --- | --- |
| `packageId`, `formFamily` (see LP-19 §3), `timestamp` | Groups precedents per family |
| `gate`: `kit` \| `submit` | The two gates have separate thresholds |
| `approvedBy`: `human` \| `policy` | Only `human` rows count as precedents; both count for pacing |
| `decision`: `approved` \| `rejected` \| `approved-after-edit` | An edit means the draft was *wrong*; it must not count as a clean precedent |
| `editedFields[]` (labels only, never values) | Identifies which answers needed correction, without logging PII |
| `dryRunClassification`, `dryRunDigest` (submit gate) | "Clean in hindsight" is only checkable if the classification was recorded |
| `kitFieldSummary[]`: label + provenance kind | Lets LP-19 verify a precedent was library/identity-only |

Values are never written to either log — labels, provenance kinds, and digests
only, so the audit trail carries no PII. LP-19's activation thresholds count
rows in this log; without it, LP-19 is uncalibratable and the two RFCs' stated
dependency would be fiction.

### 5. One lifecycle addition: `fill-failed`

A failed fill has nowhere to go in the current lifecycle. Leaving the package
at `ready` means the scheduler re-fills it on the next tick, forever; a
side-channel "do not fill" flag would be a lifecycle change wearing a
disguise. So this RFC adds one honest status with explicit transitions, all
enforced by `recordStatus` as usual:

- `ready → fill-failed` — the fill run errored or the run record is terminal
  without a filled form. Notifies (blocking tier).
- `fill-failed → ready` — human retry after triage.
- `fill-failed → archived` — human discards the package.

`fill-failed` is terminal for the scheduler: it never auto-retries a failed
fill, since a repeat failure usually means the form changed or the kit is
wrong, and both need eyes.

### 6. Submission pacing

Automated applications arriving in a tight burst are an account-level risk:
ATS platforms and job boards run bot detection, and a flagged or banned
candidate account is a worse outcome than a slow queue. `schedule.json`
therefore carries pacing limits, enforced by the fill stage:

- `maxSubmissionsPerDay` (default 5) and `maxSubmissionsPerWeek` (default 20);
- `minIntervalBetweenFills` (default 45 min) with randomized jitter (±40%),
  so submissions do not land on a machine-regular cadence;
- pacing counters are derived from `approval-decisions.jsonl` submit-gate
  approvals **regardless of `approvedBy`** — a policy-approved submission
  consumes budget exactly like a human-approved one, since the ATS cannot
  tell them apart — so a restart cannot reset them and L2 cannot outrun them.

Reaching a cap pauses the fill stage until the window rolls over; it is a
digest event, not a blocking one.

## Non-goals

- **No change to either human gate.** Kit approval and submit approval remain
  unconditionally manual; this RFC only makes the mechanical stages
  self-advancing and the judgment stages *visible*. Autonomy policy is LP-19.
- **No concurrency.** The single-run mutex stays; redesigning workspace
  replacement for parallel fills is out of scope.
- **No hosted/external services.** Everything remains loopback; the webhook is
  outbound-only and off by default.
- **No auto-retry of failures.** A failed fill parks at `fill-failed` for
  human triage; the scheduler never retries it on its own.
- **No lifecycle changes beyond `fill-failed`** (§5). That one addition is
  stated openly rather than smuggled in as a flag.

## Risks

- **Scheduler-triggered fill at an unattended moment** hits the submit gate
  and expires. Mitigation: quiet hours, pacing (§6), and expiry parks for a
  human instead of re-running (§2); the notification tier exists for this.
- **pi spawn flakiness under automation** (port handover races). The manual
  path's retry-on-reacquire is reused verbatim; a failed handover pauses the
  sweep stage and notifies rather than retrying unboundedly.
- **Notification fatigue** → owner disables the channel → worse than before.
  Mitigation: strict two-tier split; digests never push.
- **Pacing defaults too slow to be useful, or too fast to be safe.** They are
  guesses until there is data; §6's values are a deliberately conservative
  starting point, revisited once the log has a few weeks of history.

## Open questions

1. Desktop notification mechanism on Windows without an external dependency
   (PowerShell toast vs. a tiny tray helper) — spike needed.
2. Should the fill stage require a fresh dry-run "clean" check before
   launching a fill for a kit approved more than N days ago (form drift)?
   Related: LP-19's L2 needs the same freshness question answered (M3).
3. Where does the schedule live: seed dir (per-candidate) or console config
   (per-machine)? Recommendation: seed dir, beside `search-criteria.json`.
4. Do the pacing caps count *submissions* only, or fills as well? Recommended:
   submissions, since that is what the ATS observes.

## Recommended Decision

Approve as scoped: scheduler + notifications with both human gates untouched,
single-run serialization honored, all transitions through `recordStatus`, plus
the `fill-failed` status (§5), the approval-decision log (§4), and pacing
limits (§6). Implement in the console process only; land behind a
`schedule.json` that defaults to all stages disabled so merging is
behavior-neutral until the owner opts in. Sequence before LP-19, whose
thresholds are uncalibratable without §4's log; independent of LP-20.
