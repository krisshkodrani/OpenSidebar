# RFC: Orchestrator-Owned Runtime Plan State

**Date**: 2026-03-13
**Status**: Draft
**Goal**: Replace the current hybrid planning model with a scalable architecture where the orchestrator owns the task plan, the executor consumes one active step at a time, and runtime state is explicit instead of inferred from stitched handoff text.

## Problem

OpenSidebar currently has two planning layers:

1. An orchestrator/planner layer that can decompose a task into nodes or steps.
2. An executor loop that can also perform internal planning and maintain `planStatus`.

In practice, orchestrated executor runs are configured with internal planning disabled, but the orchestrator does not inject an equivalent runtime step plan into the executor loop.

That creates a harmful hybrid:

- the orchestrator knows the task is multi-step
- the executor cannot decompose internally
- the executor does not receive durable runtime step state
- tool filtering falls back to heuristic objective-text inference

This is now directly confirmed in the repo.

## Repository Evidence

### Confirmed Root Cause

The executor contract explicitly disables internal planning:

- [contracts.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/orchestrator/contracts.ts#L59)
- `disableInternalPlanning: true`

That flag is passed into the executor worker:

- [index.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/orchestrator/index.ts#L1791)

The loop only performs internal decomposition when planning is enabled:

- [loop.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/agent/loop.ts#L1296)

Fresh shopping-task evidence:

- [online-shop.test.ts](/C:/Users/k_shk/Projects/OpenSidebar/tests/e2e/online-shop.test.ts) passed
- trace: [bb2e6755-62e3-4f3b-bf75-12d2e73c569a.jsonl](/C:/Users/k_shk/Projects/OpenSidebar/traces/bb2e6755-62e3-4f3b-bf75-12d2e73c569a.jsonl)
- session log: [session-bb2e6755-62e3-4f3b-bf75-12d2e73c569a.jsonl](/C:/Users/k_shk/Projects/OpenSidebar/logs/session-bb2e6755-62e3-4f3b-bf75-12d2e73c569a.jsonl)

The shopping run succeeded, but every turn still showed:

- `source: "fallback_inference"`
- `fallbackReason: "no_plan_status"`
- `profile: "enter_code"`

So the system succeeded despite missing runtime plan state, not because it had it.

### Additional Evidence

The orchestrator planner did produce structure:

- [opensidebar.jsonl](/C:/Users/k_shk/Projects/OpenSidebar/logs/opensidebar.jsonl)
- `Planner produced structured plan`
- `Planner produced structured graph assignments`
- `Planner generated nodes`

But the executor runtime still had no active `planStatus`.

This means the failure is not "planner absent." It is "planner output not injected as executor runtime plan state."

## Literature Basis

This recommendation is supported by both local notes and external studies.

### Local Notes

[prompt-management-notes.md](/C:/Users/k_shk/Projects/OpenSidebar/books/notes/prompt-management-notes.md) already argues for:

- explicit role boundaries
- minimal overlap between agents
- prioritizing actionable state
- avoiding duplicated policy across orchestrator and executor

### External Literature

1. **ReAct**
   - Short observe-reason-act loops work best when actions are grounded in the current state, not buried in broad policy text.
   - https://arxiv.org/abs/2210.03629

2. **Mind2Web**
   - Web-agent reliability improves when context and action space are constrained before action selection.
   - https://arxiv.org/abs/2306.06070

3. **WebArena**
   - Long-horizon web tasks require explicit control and robust state tracking; first-step quality alone is insufficient.
   - https://arxiv.org/abs/2307.13854

4. **Reflexion**
   - Recovery and improvement should come from explicit feedback and memory, not ever-growing prompt instructions.
   - https://arxiv.org/abs/2303.11366

5. **OSWorld**
   - Computer-use agents should be evaluated and controlled through execution, not just predicted next actions.
   - https://arxiv.org/abs/2404.07972

## Diagnosis

The current architecture violates a key scaling rule:

**There should be one owner of task decomposition at runtime.**

Right now OpenSidebar has:

- orchestrator-owned coarse planning
- executor-owned local control
- disabled executor internal planning
- no orchestrator-owned runtime step injection

That forces the executor to infer step state from large handoff blobs and current DOM state.

This scales poorly because:

1. step progression is implicit
2. tool filtering is heuristic rather than plan-driven
3. verifier/replan decisions do not cleanly update executor state
4. traces are harder to interpret
5. prompt complexity grows to compensate for missing control state

## Recommended Architecture

### Principle

The orchestrator should own the plan. The executor should execute the current step. The verifier should advance or repair the plan. The controller should enforce local safety and recovery.

### Proposed Runtime Layers

1. **Orchestrator**
   - decomposes the task into structured steps
   - assigns the initial active step
   - launches executor with explicit runtime plan state

2. **Runtime Plan State Machine**
   - persisted in executor context
   - contains:
     - `steps`
     - `currentIndex`
     - `status`
     - `successCriteria`
     - `expectedState`
     - `toolProfile`
     - optional `fallbackPolicy`

3. **Executor**
   - consumes exactly one active step at a time
   - sees a narrow tool set for that step
   - does not replan unless explicitly delegated

4. **Verifier / Monitor**
   - checks whether the active step completed
   - either advances the step index or requests a repair
   - writes changes back into the same runtime plan state

5. **Guardrail Layer**
   - deterministic pre-dispatch controls
   - repeated-action blocking
   - visible-state direct-action enforcement
   - escalation rules

### Architecture Decision

Use **orchestrator-owned planning with executor runtime plan injection**.

Do **not** rely on executor internal decomposition when the orchestrator is already in control.

## Why This Is the Best Scalable Choice

Compared with the current hybrid:

### Better Role Separation

- orchestrator plans
- executor executes
- verifier verifies

This aligns with both the local notes and the multi-agent literature.

### Better Tool Gating

The executor can use the step's `toolProfile` directly instead of inferring from a giant objective blob.

### Better Traceability

Each turn can be attributed to:

- active step
- active profile
- expected state
- verifier decision

### Better Recovery

Step-local repair becomes possible without reconstructing intent from stitched history.

### Lower Prompt Load

The executor prompt can stay small because more control lives in structured state, not prose.

## Non-Recommended Alternatives

### Alternative A: Keep Internal Planning Disabled and Continue Using Fallback Inference

Reject.

This is what the shopping run currently does. It works only when the executor is good enough to recover despite not having explicit plan state.

### Alternative B: Re-enable Internal Planning for All Executor Runs

Reject as a default architecture.

This would restore plan state, but it reintroduces duplicated planning responsibility between orchestrator and executor. That is harder to scale and debug.

### Alternative C: Full Prompt-Only Repair

Reject.

The literature and current measurements both show that prompt-only arbitration does not solve long-horizon control problems reliably.

## Concrete Specification

### Phase 1 Only

This RFC now specifies only Phase 1.

Deferred:

- richer step contracts
- verifier/monitor redesign
- prompt cleanup

Those should be validated separately after runtime plan injection works.

### Phase 1: Inject Orchestrator Plan into Executor Runtime State

Change:

- pass structured node/step state from orchestrator into `AgentLoop`
- initialize `ContextManager.setPlanStatus(...)` before the first executor turn
- preserve `inferToolProfileForStep()` as fallback when injected plan state is absent
- add a controlled profile-widening escape hatch when a step stalls

Targets:

- [index.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/orchestrator/index.ts)
- [contracts.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/orchestrator/contracts.ts)
- [loop.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/agent/loop.ts)
- [context.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/agent/context.ts)

Specification:

1. The orchestrator passes `initialPlanState` to executor workers when `task.nodes.length >= 2`.
2. `initialPlanState` includes:
   - node descriptions
   - node statuses
   - current active index
   - verification gates when available
   - inferred tool profiles when available
3. `AgentLoop` initializes runtime `planSubtasks`, `taskId`, and `ContextManager.planStatus` from `initialPlanState`.
4. `applyToolProfile()` prefers injected `plan_status` over fallback inference.
5. If an injected profile reaches the step warning threshold without progress, the profile widens temporarily to allow recovery.
6. Single-node tasks continue unchanged.

Success criterion:

- shopping-style runs log `source: "plan_status"` instead of `fallback_inference`

Non-goals for this RFC:

- replacing fallback inference
- redesigning guardrails
- solving prompt bloat
- full verifier/runtime plan unification

## Measurement Plan

### Primary Metrics

1. `% turns using source = plan_status`
2. `% turns using fallback_inference`
3. average filtered tool count under plan-driven vs fallback-driven runs
4. live success rate on multi-step fixtures
5. median turns to completion on structured tasks

### Key Benchmarks

1. [online-shop.test.ts](/C:/Users/k_shk/Projects/OpenSidebar/tests/e2e/online-shop.test.ts)
2. [navigation-challenge.test.ts](/C:/Users/k_shk/Projects/OpenSidebar/tests/e2e/navigation-challenge.test.ts)
3. live benchmark reports from [live-benchmark.ts](/C:/Users/k_shk/Projects/OpenSidebar/evals/live-benchmark.ts)

### Trace Checks

Every structured task should show:

- planner produced structure
- runtime plan initialized
- active step index
- tool profile source = `plan_status`

If not, it should explicitly log why not.

## Risks

1. Orchestrator and executor may disagree on step semantics.
2. Step plans may become stale after unexpected page changes.
3. Over-constraining tool profiles may block recovery paths.

Mitigations:

- verifier can request targeted step repair
- guardrails remain active
- fallback inference remains available as a backup, but only when plan state is absent or invalid

## Decision

Adopt **orchestrator-owned runtime plan state** as the primary architecture for multi-step tasks.

Keep executor internal planning disabled for orchestrated runs only if the orchestrator injects explicit step state first.

That is the cleanest scalable architecture for this repo and the best match to both the evidence and the literature.

## Immediate Next Step

Implement Phase 1:

- add orchestrator-to-executor runtime plan injection
- rerun [online-shop.test.ts](/C:/Users/k_shk/Projects/OpenSidebar/tests/e2e/online-shop.test.ts)
- confirm logs switch from `fallback_inference` to `plan_status`
