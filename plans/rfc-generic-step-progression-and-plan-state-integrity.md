# RFC: Generic Step Progression and Plan-State Integrity

**Date**: 2026-03-13
**Status**: Revised Draft

## Problem

Recent multi-step runs show a recurring pattern:

- The agent starts on the correct step.
- The page reaches that step's success condition.
- The runtime does not deterministically advance to the next step.
- The model keeps acting inside the old step until it calls `done()` or escalates.
- During that transition, `planStatus` can lose the running subtask and fall back to heuristic inference.

This is a generic orchestration/runtime issue, not a site-specific one.

## Evidence

From the successful but inefficient shopping run:

- [session-40a77643-fecf-4aa1-8d99-d5dc0bb52505.jsonl](/C:/Users/k_shk/Projects/OpenSidebar/logs/session-40a77643-fecf-4aa1-8d99-d5dc0bb52505.jsonl)
- [40a77643-fecf-4aa1-8d99-d5dc0bb52505.jsonl](/C:/Users/k_shk/Projects/OpenSidebar/traces/40a77643-fecf-4aa1-8d99-d5dc0bb52505.jsonl)

Observed behavior:

1. Step 1 remains active after its success condition is visibly satisfied.
2. The agent reopens cart state, searches for the old control, and escalates.
3. Step advancement happens only after rejected `done()`.
4. After that rejection, the loop falls back to `fallback_inference` because there is no running subtask in `planStatus`.

Relevant code paths:

- Initial plan injection: [index.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/orchestrator/index.ts)
- Step profile inference: [planner.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/agent/planner.ts)
- Verification gate handling: [loop.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/agent/loop.ts)
- `done()` rejection and advancement: [loop.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/agent/loop.ts)

## Root Cause

The primary issue is narrower than the original draft:

1. **`advance_step` gates only nudge**
   - When a verification gate matches with `action: "advance_step"`, the loop adds a user-facing checkpoint message.
   - It does not actually call `advanceCompletedSubtasks()`.
   - That forces a wasted round-trip where the model either keeps acting on the old step or calls `done()`, which is then rejected before advancement happens.

2. **Transition observability is weak**
   - The runtime does not explicitly distinguish:
     - step advancement driven by a gate
     - step advancement driven by rejected `done()`
     - invalid plan status with no running subtask

3. **Profile quality is secondary**
   - Tool-profile quality still matters, but it is not the highest-value fix for the observed 1-2 turn tax per step transition.

## Design Principles

- Generic over task-specific.
- Planning decides what step is active.
- Runtime enforces step integrity, not page-specific semantics.
- Step advancement should be state-based where possible, not model-opinion-based.
- Fallback inference remains a backup, not the normal path.

## Proposal

### Phase 1: Auto-Advance on `advance_step`

When a verification gate matches and its action is `advance_step`:

- immediately call `advanceCompletedSubtasks()`
- immediately write the updated `planStatus`
- immediately add a compact user-context message confirming the new active step

Do not wait for a later `done()` rejection to advance intermediate steps.

### Phase 2: Observability

Add explicit events/counters for:

- `step_advanced_by_gate`
- `step_advanced_by_done_rejection`
- `plan_status_missing_running_subtask`

These should be queryable in traces and benchmark summaries.

## Non-Goals

- No controller-level blocking based on button text semantics.
- No site-specific checkout/cart heuristics.
- No planner duplication inside tool dispatch.
- No broad profile redesign in this RFC.

## Implementation Scope

Primary files:

- [src/background/agent/planner.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/agent/planner.ts)
- [src/background/agent/loop.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/agent/loop.ts)
- [src/background/orchestrator/index.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/orchestrator/index.ts)
- [src/background/orchestrator/planner.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/orchestrator/planner.ts)

Tests:

- [tests/background/planner.test.ts](/C:/Users/k_shk/Projects/OpenSidebar/tests/background/planner.test.ts)
- [tests/background/agent.test.ts](/C:/Users/k_shk/Projects/OpenSidebar/tests/background/agent.test.ts)
- [tests/background/orchestrator-handoff.test.ts](/C:/Users/k_shk/Projects/OpenSidebar/tests/background/orchestrator-handoff.test.ts)
- [tests/e2e/online-shop.test.ts](/C:/Users/k_shk/Projects/OpenSidebar/tests/e2e/online-shop.test.ts)

## Measurement

Primary metrics:

- average turns on multi-step e2e workflows
- number of planner rescues per successful run
- number of `fallback_inference` turns after initial plan injection

Secondary metrics:

- `step_advanced_by_gate`
- `step_advanced_by_done_rejection`
- `plan_status_missing_running_subtask`

Success criteria:

1. Intermediate steps advance without requiring mistaken global `done()`.
2. Multi-step runs show fewer fallback or escalation turns immediately after a satisfied step.
3. Shopping-style flows reduce wasted turns without site-specific controller logic.

## Recommended Sequence

1. Auto-advance on matched `advance_step` gates.
2. Add trace events for gate- and rejection-driven step transitions.
3. Add a defensive trace for missing running subtasks.
4. Rerun focused tests and multi-step e2e workflows.
