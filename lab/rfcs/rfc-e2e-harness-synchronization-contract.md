# RFC: E2E Turn Handoff and Completion Contract

**Status**: Draft
**Date**: 2026-04-11
**Author**: Codex
**Affects**: `tests/e2e/helpers/utils.ts`, `tests/e2e/helpers/diagnostics.ts`, runtime teardown timing for multi-turn E2Es

## Problem

The current E2E harness still decides too much state from sleeps, polling cadence, and weak completion proxies.

This creates recurring failure modes:

1. false negatives because the harness checks too early
2. race conditions between turn completion, teardown, and the next user message
3. occasional misclassification when step labels or idle states are treated as terminal truth

The continuation failures exposed this clearly.

## Evidence

Some concrete harness issues have already been fixed:

- `done()` extraction now reads `summary` before `message`
- `waitForWorkspaceIdle()` and `settleWorkspaceBetweenTurns()` were added for continuation handoff

Those fixes resolved a real portion of the failures.

The remaining gap is narrower than a full redesign:

- teardown can still be delayed after `done()`
- `IDLE` may arrive late because post-completion work is still running
- some helpers still accept weak proxies such as `"Task complete"` or bare `IDLE`
- trace reading still uses a fixed sleep

## Proposed Solution

Tighten the harness around a small completion and turn-handoff contract.

## Core Principles

### 1. Terminal task status is the primary completion signal

For harness purposes, task success should come from explicit terminal completion state.

Do not treat these as equivalent to completion:

- `AGENT_STEP` text like `"Task complete"`
- bare `AGENT_STATUS: IDLE`
- arbitrary settle windows

These signals are still useful diagnostics, but they should not override missing terminal task status.

### 2. Turn handoff requires `IDLE` after terminal completion

For continuation and other multi-turn tasks, the harness should advance only when:

1. the prior turn has emitted terminal task status
2. the same workspace has then reached `IDLE`

This keeps `IDLE` meaningful, but only in the right sequence.

### 3. Post-`done()` teardown delay is part of the bug

The harness race is not only a test-side problem.

If the runtime keeps doing work after `done()` and delays `IDLE`, then turn handoff remains fragile even with better waiting logic.

The immediate target should therefore be:

- better handoff sequencing in the harness
- less post-completion work that delays teardown

## Concrete Contract

### Task completion

Interpret terminal task status as:

- `completed` => success
- `partial` => incomplete/failure
- explicit error or abort => failure

`IDLE` without terminal completion does not count as success.

### Turn handoff

A continuation turn is eligible to begin only when:

1. terminal task status has been observed for the workspace
2. `IDLE` has then been observed for the same workspace

This should replace arbitrary settle windows as the primary handoff rule.

### Trace reading

Trace reading should avoid blind fixed sleeps where possible.

This RFC does not require new runtime trace markers. It only requires tightening helper behavior using the data already available first.

## Why this is the right fix

This stays close to the actual failure evidence.

It does not propose a broad protocol redesign. It fixes the specific contract that was proven to be weak:

- how the harness decides a turn is done
- when it is safe to send the next turn

## Non-Goals

This RFC does not propose:

- removing all polling
- redesigning the runtime protocol from scratch
- adding new runtime lifecycle events in this document
- treating `IDLE` as irrelevant

`IDLE` remains important. The point is to interpret it correctly.

## Recommended Implementation

1. Keep `settleWorkspaceBetweenTurns()` as the shared handoff helper.
2. Tighten it so it requires `IDLE` after terminal completion for the same workspace.
3. Tighten `waitForTaskCompletion()` so step-label and idle proxies do not override missing terminal status.
4. Investigate and reduce post-`done()` work that delays `IDLE`, especially post-completion LLM calls.
5. Remove the unconditional trace-summary sleep if current readiness data is sufficient.

## Files to Modify

| File | Change |
|---|---|
| `tests/e2e/helpers/utils.ts` | Tighten terminal-state logic and turn-handoff sequencing |
| `tests/e2e/helpers/harness.ts` | Remove fixed trace-summary delay if current readiness data is sufficient |
| `tests/e2e/helpers/diagnostics.ts` | Improve trace-read timing without blind sleeps where feasible |
| runtime teardown path | Reduce post-`done()` work that delays workspace `IDLE` |

## Tests

1. Multi-turn continuation does not send Turn 2 before the workspace is ready.
2. `IDLE` without terminal completion does not count as success.
3. A `"Task complete"` step label alone does not count as success.
4. Workspace handoff requires `IDLE` after terminal completion for the same workspace.
5. Slow runs and fast runs both pass under the same barrier logic.

## Decision

- [ ] Approved
- [ ] Approved with modifications: ___
- [ ] Rejected - reason: ___
