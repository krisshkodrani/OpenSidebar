# RFC: Grounding Mismatch Observability and Recovery Messaging

**Date**: 2026-03-13  
**Status**: Draft  
**Scope**: Observability and generic recovery guidance for DOM/perception mismatches

## Decision Summary

Do **not** implement a task-specific mismatch-repair mechanism in the tool dispatch layer.

Instead:

1. Keep the existing rule that direct-action tools may only target IDs present in the current snapshot
2. Improve invalid-ID failures with recovery-oriented guidance
3. Add first-class observability for grounding mismatch cases
4. Treat the structural prevention of these scenarios as part of the orchestrator/runtime plan-state work

## Background

The shopping timeout exposed a real failure mode:

- the executor attempted direct action against an element ID not present in the current actionable snapshot
- the run then entered a long recovery loop and timed out

Fresh evidence:

- [22844eef-4bb8-4629-94fb-267fd154258a.jsonl](/C:/Users/k_shk/Projects/OpenSidebar/traces/22844eef-4bb8-4629-94fb-267fd154258a.jsonl)

However, the best interpretation is:

- the immediate issue is a sequencing/state-availability problem
- not a reason to build field-specific reacquisition logic into the dispatch layer

This aligns with the runtime plan-state RFC:

- [rfc-orchestrator-owned-runtime-plan-state.md](/C:/Users/k_shk/Projects/OpenSidebar/plans/rfc-orchestrator-owned-runtime-plan-state.md)

## What Already Exists

The system already enforces the core direct-action safety rule.

Existing guard:

- [loop-helpers.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/agent/loop-helpers.ts)
- `validateElementIds()` is called from:
  - [loop.ts](/C:/Users/k_shk/Projects/OpenSidebar/src/background/agent/loop.ts)

This means:

- the executor already cannot successfully call `type_text`, `click_element`, etc. on IDs not present in the current snapshot

So the missing pieces are:

- better diagnostics
- better recovery guidance
- better traceability

## Diagnosis

For cases like the shopping timeout, the likely root problem is:

1. the required control is not currently available in the actionable snapshot
2. the executor still attempts to act as if it were
3. the error message is generic, so recovery degrades into unstructured investigation

This is best treated as:

- a **workflow/planning** issue for prevention
- an **observability + recovery-messaging** issue for runtime debugging

## Literature Alignment

This narrower approach is consistent with the literature:

- ReAct: action should follow current observation, not guessed hidden state  
  https://arxiv.org/abs/2210.03629
- Mind2Web: filtered local action context should drive actions  
  https://arxiv.org/abs/2306.06070
- WebArena: long-horizon tasks need better control/state, not just more ad hoc recovery logic  
  https://arxiv.org/abs/2307.13854
- Reflexion: recovery benefits from explicit signals and structured feedback  
  https://arxiv.org/abs/2303.11366
- OSWorld: grounding failures should be surfaced and measured explicitly  
  https://arxiv.org/abs/2404.07972

Local note also supports keeping runtime roles clean and generic:

- [prompt-management-notes.md](/C:/Users/k_shk/Projects/OpenSidebar/books/notes/prompt-management-notes.md)

## Scope

### In Scope

1. Improve invalid-ID failure text
2. Add mismatch trace events and counters
3. Add benchmark visibility for these events

### Out of Scope

1. task-specific field reacquisition
2. label-based form repair logic in dispatch
3. rebuilding planning logic inside `loop.ts`
4. broad prompt redesign

## Proposed Changes

### 1. Recovery-oriented invalid-ID message

When `validateElementIds()` rejects a direct-action tool call, return a more useful message.

Current behavior:

- generic invalid-ID rejection

Proposed behavior:

- explain that the element is not in the current actionable snapshot
- suggest generic reveal/refresh/re-read actions
- mention likely causes such as closed drawers, hidden sections, stale page state, or scrolling

Example shape:

`Element [N] is not in the current page snapshot. The target may be hidden, inside a closed drawer/accordion, off-screen, or the page state may be stale. Reveal or refresh the relevant UI first, then retry with a currently visible tag.`

This stays generic and does not hardcode shopping, forms, or site-specific behavior.

### 2. Grounding mismatch trace event

Add a trace/log event when:

- a direct-action tool targets an ID absent from the snapshot
- perception/interpretation references a concrete control that is not present in the tagged action state

Proposed event name:

- `grounding_mismatch`

Suggested payload:

- `turn`
- `toolName`
- `requestedId`
- `currentUrl`
- `hasPerceptionReference`
- `reason`

### 3. Benchmark metrics

Add counters to live benchmark summaries:

- `groundingMismatchCount`
- `invalidIdBlockCount`
- `invalidIdRecoveryHintCount`

This makes it possible to separate:

- planner/state failures
- controller guard catches
- provider/model failures

## Why Not Build Reacquisition in Dispatch

The rejected alternative is to detect required fields or controls from the active step text and perform targeted reacquisition inside the dispatch layer.

Reasons to reject:

1. It reintroduces planning into execution dispatch
2. It becomes domain- and language-fragile
3. It violates the project preference for generic infrastructure
4. It overlaps with work better handled by runtime plan-state and step progression

## Relationship to Runtime Plan-State RFC

This RFC does not replace:

- [rfc-orchestrator-owned-runtime-plan-state.md](/C:/Users/k_shk/Projects/OpenSidebar/plans/rfc-orchestrator-owned-runtime-plan-state.md)

Instead:

- this RFC improves diagnosis and recovery messaging when runtime state is insufficient
- the runtime plan-state RFC should structurally reduce how often these mismatches happen

## Implementation Plan

### Phase 1

1. Update `validateElementIds()` failure messaging
2. Add `grounding_mismatch` trace/log event
3. Add one or two deterministic tests for the new message/event
4. Expose mismatch counters in live benchmark summaries

## Success Criteria

1. Invalid-ID direct-action failures now produce recovery-oriented guidance
2. Traces clearly show mismatch events instead of opaque invalid-ID failures
3. Live benchmark can count mismatch frequency
4. No task-specific logic is added to dispatch

## Recommendation

Approve this narrowed RFC.

Implement:

- generic recovery-oriented invalid-ID guidance
- mismatch observability

Do **not** implement task-specific mismatch repair in the dispatch layer.
