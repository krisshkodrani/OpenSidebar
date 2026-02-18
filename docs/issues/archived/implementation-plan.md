# OpenSidebar Implementation Plan (Issue Remediation)

Date: 2026-02-17  
Scope: Execution plan based on `docs/issues/literature-review.md` and `docs/issues/README.md`.

## Planning Assumptions

- Team cadence: 1-week sprints.
- Estimates use engineering days (`d`) and include code + tests.
- Owners are placeholders (`TBD`) and can be replaced with names.
- Success is measured on fresh challenge runs with logs/traces enabled.

## Phase Plan

### P0: Blockers (stabilize completion path first)

| Priority | Issue | Deliverable | Owner | Estimate | Dependencies | Test Gate |
|---|---|---|---|---:|---|---|
| P0 | `ISSUE-010` (phase 1) snapshot cap dedup | Duplicate button collapse (group near-identical text, keep 2-3 representatives) + overflow indicator ("50/87 elements shown") | TBD | 1.5d | None | Fake bait buttons collapsed; drop zones visible on dense pages; overflow note in snapshot |
| P0 | `ISSUE-003` overlay/modal dismissal gaps | Ancestor-walk in `hide_element`, broader overlay detection, post-dismiss verification | TBD | 2.0d | None | Overlay dismiss success >70% on modal-heavy steps; fewer disabled-submit loops |
| P0 | `ISSUE-005` bridge disconnects | Pre-dispatch ping + auto reinject/retry on `Receiving end does not exist` | TBD | 1.5d | None | Bridge errors auto-recover in run; hard disconnect stalls drop to <5/session |
| P0 | `ISSUE-006` provider resilience | Error classification (transient vs permanent), session disable for credit exhaustion, UI notice | TBD | 1.5d | None | No repeated calls to permanently failed provider in same session |
| P0 | `type_text` robustness | Use `InputEvent` with `data`/`inputType` + native value setter for all inputs (not just React-detected) | TBD | 1.0d | None | SPA form submissions work reliably; challenge code entry accepted by page validation |

### P1: Stability and loop control

| Priority | Issue | Deliverable | Owner | Estimate | Dependencies | Test Gate |
|---|---|---|---|---:|---|---|
| P1 | `ISSUE-001` context bloat | Turn-count + repetition-density compression triggers, pinned critical-state summary | TBD | 2.0d | None | Long runs show compression transitions beyond `none`; prompt growth flattens |
| P1 | `ISSUE-002` non-converging loops | Failed-action memory + exact-repeat circuit breaker + forced pivot policy | TBD | 2.5d | `ISSUE-001` required | Repeated tool+args loops bounded; longest single-step loop <30 turns |
| P1 | `ISSUE-010` (phase 2) scored selection | Replace first-N tagging with priority-scored selection (task-relevant controls, recently referenced elements ranked higher) | TBD | 2.0d | `ISSUE-010` phase 1 | Critical elements consistently tagged even on 100+ element pages |
| P1 | Dead-end detection | Detect repeated identical submit/action patterns with no state change; pivot to diagnostic mode then graceful exit with evidence report | TBD | 1.5d | `ISSUE-002` | Agent stops grinding unsolvable steps within bounded turns; user gets actionable report |

### P2: Efficiency and policy polish

| Priority | Issue | Deliverable | Owner | Estimate | Dependencies | Test Gate |
|---|---|---|---|---:|---|---|
| P2 | `ISSUE-009` escalation thrashing | Progress-gated smart-tier de-escalation (keep smart until state delta or safety cap) and escalation cooldown | TBD | 2.0d | `ISSUE-002` | Smart/fast oscillation reduced; escalation overhead <20% of session time |
| P2 | `ISSUE-008` ID hallucination | Pre-dispatch element-ID validation (hard block for `id=0`, hint with valid IDs) + escalation on hallucination streak | TBD | 1.5d | `ISSUE-001`, `ISSUE-002` | Invalid-ID dispatch rate drops >70%; zero dispatches with `id=0` |
| P2 | `ISSUE-007` tab attempt churn | Blocked-tool taboo memory + explicit single-tab reminder injection | TBD | 0.75d | None | Immediate repeats of blocked tab actions eliminated |

## Work Breakdown by Area

### Background Agent (`src/background/agent/`)

- Add `recentFailures` compact state and inject into prompt context each turn.
- Add exact tool+args repeat breaker with page-state-change bypass.
- Add progress-gated de-escalation predicate (state delta, URL delta, unblocked controls).
- Add dead-end/unsolvable-step detector in `progress.ts` with bounded diagnostic pivot.

### Content Script (`src/content/`)

- Phase 1: Add duplicate bait-button collapse and overflow metadata in `tagging.ts`.
- Phase 2: Replace first-N tagging with scored selection in `tagging.ts`.
- Update overlay detection and `hide_element` ancestor walk in `actions.ts`.
- Add DnD pre-action re-resolution and post-action refresh hook in `actions.ts`.
- Fix `type_text` to use `InputEvent` with `data`/`inputType` properties and native value setter (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set`) for controlled-input compatibility in `actions.ts`. Unify with the existing `react_set_input` approach.

### LLM Client (`src/background/llm/client.ts`)

- Parse provider errors into transient/permanent classes.
- Permanently disable exhausted provider for current session.
- Emit one-time user-visible provider-disabled status event.

### Bridge/Execution (`src/background/tools`, bridge path)

- Add content-script health ping before tool dispatch.
- On missing receiving end: reinject content script, wait ready, retry once.
- Add structured reason tagging for bridge failure metrics.

## Verification Protocol

### Required run set

1. Fresh run after cleanup (`logs/*`, `traces/*` cleared).
2. Minimum 3 full challenge attempts with identical settings.
3. One stress run with intentional modal interference and DnD-heavy path.

### Baseline metrics (from 2026-02-17 run set)

| Metric | Current Baseline | Target |
|--------|-----------------|--------|
| `dismiss_overlays` success rate | 21% (5/24) | >70% |
| Bridge failures per session | 36 | <5 |
| DnD first-attempt success (when cap hit) | 0% | >80% |
| Provider wasted calls (credit exhaustion) | 21 | 0 |
| Longest single-step loop | 275 turns | <30 turns |
| Compression activations in >60-turn runs | 0 | >0 |
| Escalation overhead (% of session time) | ~40% | <20% |
| Invalid-ID dispatches (id=0 or never-existed) | 66 | <10 |
| Blocked tab tool repeats | 16 | <3 |

### Metrics to capture per run

- Completion rate (steps completed / steps attempted).
- Median turns to completion per step.
- Per-step turn distribution (especially Step 6, Step 14, Step 20).
- `dismiss_overlays` effective success rate.
- Bridge failure count and auto-recovery rate.
- Invalid-ID dispatch count.
- Escalation count, de-escalation count, switch overhead time share.
- Provider permanent-disable events and repeated-failure avoidance.
- Dead-end detection trigger count and turns-to-graceful-exit.
- `type_text` form submission success rate on SPA pages.

### Ship criteria

- No known blocker issue regresses from current baseline.
- P0 metrics show clear improvement in at least 2/3 run samples vs baseline table above.
- No new high-severity failure class introduced.
- Dead-end detection triggers within 15 turns of first failed repeat (not 275).

## Suggested Sprint Cut

### Sprint 1 (~7.5d) — See, click, stay connected

- `ISSUE-010` phase 1 (dedup + overflow) — 1.5d
- `ISSUE-003` (overlay/modal fix) — 2.0d
- `ISSUE-005` (bridge reconnect) — 1.5d
- `ISSUE-006` (provider permanent disable) — 1.5d
- `type_text` robustness (InputEvent + native setter) — 1.0d
- **Goal:** Agent can see critical elements, dismiss modals, stay connected to content script, survive provider failures, and type into SPA forms correctly.

### Sprint 2 (~8.0d) — Smart loops, no grinding

- `ISSUE-001` (context compression) — 2.0d
- `ISSUE-002` (loop breaker + failed-action memory) — 2.5d *(requires ISSUE-001)*
- `ISSUE-010` phase 2 (scored element selection) — 2.0d
- Dead-end detection — 1.5d *(coupled with ISSUE-002)*
- **Goal:** Agent compresses context in long runs, breaks out of loops, detects unsolvable steps, and tags the most relevant elements.

### Sprint 3 (~4.25d) — Efficiency and polish

- `ISSUE-009` (progress-gated escalation) — 2.0d
- `ISSUE-008` (ID validation + hallucination guard) — 1.5d
- `ISSUE-007` (tab taboo memory) — 0.75d
- **Goal:** Reduced wasted turns from escalation thrashing, hallucinated IDs, and blocked tab attempts.

