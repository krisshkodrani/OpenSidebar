# RFC: Step-Scoped Workflow Efficiency

**Date**: 2026-03-13  
**Status**: Draft

## Context

The shopping workflow now completes successfully in [online-shop.test.ts](/C:/Users/k_shk/Projects/OpenSidebar/tests/e2e/online-shop.test.ts), but the successful run is still inefficient:

- trace: [568ccf7e-eba4-41a7-a408-366726fc3021.jsonl](/C:/Users/k_shk/Projects/OpenSidebar/traces/568ccf7e-eba4-41a7-a408-366726fc3021.jsonl)
- total turns: 26
- planner rescue is used heavily

This is too expensive for a workflow that should complete in a short forward sequence.

## Problem

The system is now good enough to finish multi-step workflows, but it is still too loose inside each step.

Observed waste in the successful shopping trace:

- redundant cart opening
- repeated cart-state rediscovery
- executor drift into irrelevant controls
- expensive planner recovery to get back on path

This is an efficiency problem, not a completion problem.

## Corrected Diagnosis

The earlier draft overstated controller-level action blocking. That is not the right fix.

The actual root cause is:

1. step objectives are still too broad or noisy
2. runtime step state is not yet focused enough
3. tool narrowing works at tool-family level, not strongly enough at step scope
4. planner recovery is compensating for weak step execution focus

This means the right layer for improvement is:

- orchestrator / plan state
- step-scoped executor instruction
- plan-level narrowing

Not:

- semantic button-text blocking in `loop.ts`

## What We Should Not Do

Do not add controller rules like:

- block buttons named `Remove`
- block buttons named `Close Cart`
- block `-` during checkout

Those require semantic UI interpretation in deterministic code and violate the project’s generic-over-task principle.

## Goal

Improve efficiency of multi-step workflows by making each executor run more tightly scoped to its current step.

Primary outcomes:

- fewer turns
- fewer planner rescues
- lower latency and cost
- no regression in completion rate

## Proposed Solution

### Phase 1: Step-Scoped Objective Tightening

Strengthen the executor handoff so it receives a cleaner current-step instruction and less distracting future-step context.

Concretely:

- make the active step objective the dominant instruction
- reduce sibling/future-step noise in executor context
- preserve global context only as compact state, not as competing action guidance

This should happen in:

- [src/background/orchestrator/handoff.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/orchestrator/handoff.ts)
- [src/background/orchestrator/index.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/orchestrator/index.ts)

### Phase 2: Plan-Level Narrowing, Not Controller Semantic Blocking

Improve tool narrowing at the planning layer.

Instead of asking the loop to infer destructive intent from button labels, the orchestrator/planner should provide:

- a tighter step objective
- a narrower tool profile for that step
- optionally a verification gate / expected state for advancement

This keeps the control generic and architectural.

Targets:

- [src/background/orchestrator/planner.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/orchestrator/planner.ts)
- [src/background/agent/planner.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/agent/planner.ts)
- [src/background/tools/metadata.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/tools/metadata.ts)

### Phase 3: Better Step Advancement Through Existing Plan Machinery

Use plan-state and verifier logic to advance steps earlier and more reliably once a step is clearly complete.

Examples:

- item added and cart visible -> move off add-to-cart step
- coupon applied and shipping chosen -> move to checkout-fill step
- form fields filled and submit clicked -> move to confirmation step

This should build on the existing plan-status and verification machinery, not duplicate it with page-specific loop heuristics.

Relevant files:

- [src/background/agent/loop.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/agent/loop.ts)
- [src/background/agent/context.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/agent/context.ts)
- [src/background/orchestrator/verifier.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/orchestrator/verifier.ts)

## Measurement

Do not validate only on the shopping fixture.

Primary metrics:

- average turns per completed multi-step workflow
- planner-lane turns per workflow
- executor-only completion share
- total task time
- total cost

Evaluation sets:

- [online-shop.test.ts](/C:/Users/k_shk/Projects/OpenSidebar/tests/e2e/online-shop.test.ts)
- other multi-step fixtures already in the repo
- live benchmark sessions where plan state is active

Success criteria:

- lower turn count on shopping without harming completion
- lower planner rescue usage
- no regressions on other staged workflows

## Risks

- over-tightening step scope and preventing legitimate recovery
- making planner-produced step objectives too brittle
- improving shopping while regressing other workflows

Mitigation:

- preserve `escalate()` and existing generic guardrails
- keep fallback inference as backup
- validate on multiple multi-step flows, not only shopping

## Recommendation

Implement this in the following order:

1. tighten executor step handoff
2. improve plan-level narrowing
3. improve step advancement through existing verifier / plan-status paths

Do not add controller-level semantic action blocking based on button text.

That keeps the solution aligned with:

- the project’s generic-over-task principle
- the orchestrator-owned plan-state architecture
- the literature-backed preference for explicit structured state over heuristic controller reasoning
