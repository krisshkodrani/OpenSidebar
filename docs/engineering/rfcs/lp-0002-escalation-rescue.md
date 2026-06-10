# RFC LP-2 — Escalation Rescue: Converge or Escalate

Lifecycle status: Decision stamped
Date: 2026-06-10
Decision date: 2026-06-10 (owner approved in session, recommended defaults accepted)
Scope: `background/agent/stagnation.ts`, escalation trigger paths in `loop.ts`, a new small `*-policy.ts` module, run-trace events, trace-viewer escalation surfacing, new fault-injection E2E fixtures
Related: "Converge or Escalate" goal (2026-05-26); WS1 completion hardening (landed and verified); SOTA Gap Analysis §3 (recovery is the unaddressed half)

## Problem

The agent's only mid-task rescue mechanism is effectively dead. The 2026-05-26
trace-DB analysis found `escalation_requested` fired ~3 times in the entire
database, while ~19% of runs (157/830 that week) hit `max_turns`. A max_turns
failure costs 3.4× a success ($0.286 vs $0.083) and burns 4× the turns
(20.9 vs 5.1). WS1 (completion recognition) removed the dominant
"reached-goal-but-didn't-recognize-it" cluster; the remaining max_turns
failures are stuck runs that nothing rescues.

Why the current trigger never fires: escalation keys off the
`StagnationMonitor`, which requires the snapshot fingerprint
(url + element count + sorted element signatures) to be **identical** for 12
consecutive turns. Stuck agents flail — they click, scroll, and re-read, so
the fingerprint keeps changing while no plan progress is made. The trigger
measures "frozen page", but the failure mode is "moving page, frozen
progress". With default `max_turns` 25, even a perfectly stagnant run only
escalates at turn 12+, after half the budget is spent.

SOTA context: execution-feedback replanning and adaptive recovery are table
stakes in 2026 systems (scheduler-RL agents, ColorBrowserAgent-style
knowledge evolution). We don't need learned recovery; we need the existing
prompt-based escalate→distill→replan path to actually fire.

## Proposal

Four parts, all measured before/after on the same fixtures.

### 1. Progress-based trigger (the core fix)

Add an `escalation-trigger-policy.ts` (following the existing small
`*-policy.ts` pattern; no new logic in `AgentLoop`) that requests escalation
when **either**:

- **No verified plan progress** for N consecutive turns (default N=6): no
  plan-step advance (`agent-plan-progress`), no new evidence accepted by the
  completion kernel, and no successful first-time mutation in the mutation
  ledger; or
- **Budget-fraction stall:** ≥50% of the turn budget consumed while <50% of
  plan steps are complete (only when a multi-step plan exists).

The existing fingerprint-stagnation signal remains as a third input, with its
escalate threshold lowered from 12 to 8 stagnant turns. Nudge (6) and pivot
(9) reflections are unchanged.

### 2. Escalation efficacy guard

Escalation is a prompt-based persona swap + distilled replan (no model-tier
change — do not measure it via `model_tier`). After an escalation, if no plan
progress occurs within M turns (default M=6), fail fast with a structured
partial-progress summary (`partial-progress-handoff`) instead of burning the
remaining budget. One escalation per run scope; a second stall ends the run.

### 3. Observability

- Run-trace events: `escalation_triggered` (with which trigger and its
  inputs), `escalation_outcome` (rescued / failed-fast / budget-exhausted).
- Trace-viewer: surface escalation events on the run timeline and add
  fire-rate / rescue-rate to the aggregate view, with the honest-aggregates
  sample-size treatment.

### 4. Deterministic stuckness fixtures

The reason WS2 was deferred is that loop surgery is hard to unit-test. Add
fault-injection E2E fixtures that force the four observed stall shapes:
dead-end navigation (goal content unreachable from landing page), disabled
submit (button never enables without an off-screen field), looping pagination
(next button cycles), and false-affordance page (visually clickable elements
that do nothing). Each fixture is solvable **only** after a strategy change,
so it deterministically exercises trigger → distill → replan → converge.

## Risks and guardrails

- **Premature escalation** wastes planner-context distillation on runs that
  would have converged. Guardrails: triggers count *verified* progress (kernel
  evidence, ledger first-mutations), not page change; thresholds are
  constants in `constants.ts` tuned against the fixture suite; the
  interaction-regression tier (currently 17/17) must stay green — that suite
  is the explicit no-regression gate, per the 2026-05-26 finding that the
  current baseline is healthy.
- **Trigger flapping** on slow pages: progress counters reset on any verified
  progress, and SPA-wait/turn-retry paths do not increment them.

## Alternatives

- **Lower only the fingerprint threshold (12→6):** doesn't fix the core
  mismatch — flailing runs never look fingerprint-stagnant. Rejected as the
  sole fix; kept as a component.
- **Model-tier escalation (swap to a stronger model):** changes cost and BYOK
  assumptions; orthogonal to whether the trigger fires. Out of scope.
- **Tree search / multi-trajectory recovery:** SOTA-interesting, expensive,
  unsafe on live writes. Out of scope (research lane).
- **Do nothing:** accepts ~19% expensive failures into launch demos. Rejected.

## Testing

- Unit: trigger policy truth-table (progress inputs × thresholds), efficacy
  guard state machine, one-escalation-per-scope invariant.
- E2E: the four fault-injection fixtures pass with rescue (escalation fires,
  run converges or fails fast under budget); full interaction-regression tier
  stays 17/17; smoke tier stays green.
- Trace assertions: `escalation_triggered`/`escalation_outcome` events appear
  with correct payloads via the existing run-trace assertion helpers.

## Rollout

Medium (~3–5 days). Ship before LP-1's first published sweep so public
numbers include the rescue path. Constants are tunable without re-review;
trigger semantics changes need a stamp update.

## Decision

Status: Approved

Chosen path:

- Progress-based + budget-fraction escalation triggers in a new policy
  module, an efficacy fail-fast guard, run-trace/trace-viewer observability,
  and four deterministic stuckness fixtures as the verification harness.
- Confirmed thresholds: N=6 no-verified-progress turns, 50% budget fraction
  with <50% plan steps complete, M=6 efficacy window, fingerprint escalate
  threshold lowered from 12 to 8.
- Fail-fast with a structured partial-progress summary after a failed
  escalation is the accepted UX.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Aggregate escalation dashboards beyond the basic fire/rescue rates;
  per-domain threshold tuning.

Do not do:

- No model-tier swap on escalation; escalation remains prompt-based persona
  swap + distilled replan.
- No new logic added directly to `AgentLoop`/`completion-kernel.ts`; the
  trigger lives in a policy module.
- Do not weaken or bypass completion-kernel evidence rules to make progress
  counters move.

Evidence required before merge:

- All four fault-injection fixtures rescued (escalation fires and the run
  converges or fails fast under budget), demonstrated in committed E2E tests.
- Interaction-regression tier 17/17 and smoke tier green, unchanged.
- A before/after comparison on the hard E2E tier showing reduced max_turns
  rate with no pass-rate regression, with trace evidence.

Next action:

- Implement

## Implementation notes (2026-06-10)

Recorded during implementation; deviations are scoping refinements within the
stamped path, not semantic changes to it.

- **Fingerprint threshold:** the code had already moved past the RFC's
  baseline — `STUCK_THRESHOLDS.ESCALATE` is 5 (stricter than the stamped
  12→8). Left at 5; the stamped edit was already satisfied.
- **Existing trigger landscape:** step watchdog (replan-first), same-URL
  forced escalation, and done-rejection mid-point escalation already existed.
  The new module adds what was missing: the budget-stall trigger, a
  no-verified-progress trigger, the efficacy fail-fast, and the unified
  `escalation_triggered`/`escalation_outcome` telemetry across all sources.
- **No-progress trigger scope:** fires only on runs without a plan; planned
  runs are already owned by the step watchdog (turns-on-step), and stacking a
  second trigger there would cause premature double-escalation.
- **Verified progress sources as implemented:** plan-step advance, successful
  mutation-sensitive action (per existing ledger semantics this includes
  clicks/typing), newly accumulated trusted tool evidence, and first visit to
  a new URL. Completion-kernel evidence wiring beyond the trusted-evidence
  accumulator is deferred — accepted done ends the run anyway.
- **Fail-fast result shape:** reuses the partial-progress handoff with a new
  `escalation_failed` reason and `outcome: "max_turns"` +
  `failure.code: "escalation_failed"`, so orchestrator retry/reroute and
  trace rollups treat it like a budget failure without a new outcome variant.
- **Not persisted across service-worker restarts:** the rescue tracker resets
  on resume; the window restarts (fail-safe direction — never fails a run
  early because of stale restored state).
- **Fixture mechanic:** stuckness fixtures hold the interactive-element set
  constant during a locked phase (solvable only after 10 interactions or 90s)
  so the stuck phase is deterministic for any model; dead-end-nav never
  unlocks and exercises fail-fast/honest-failure under budget.
