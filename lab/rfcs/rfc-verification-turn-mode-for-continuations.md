# RFC: Verification Turn Mode for Continuation Follow-Ups

**Status**: Draft
**Date**: 2026-04-11
**Author**: Codex
**Affects**: `src/background/orchestrator/handoff.ts`, `src/background/agent/loop.ts`, continuation E2E behavior

## Problem

Continuation tests are failing at the last mile even though the system now carries prior-turn memory correctly into Turn 2.

The observed failure is not that the model forgot the previous action. The failure is that the runtime still treats a **verification follow-up** like a normal **action step**.

Turn 2 queries such as:

- "Did it work?"
- "What's the status now?"
- "Can you confirm the comment posted?"

are typically **read/confirm** tasks, not **act/change** tasks.

By the time Turn 2 begins, the current page snapshot often already contains the answer. The model then behaves rationally:

- it reads the injected state
- it narrates the answer in plain text
- it does not issue tool calls because there is nothing left to do on the page

The harness, however, requires completion through tool protocol, especially `done()`. This creates a contract mismatch:

- the model sees a question-answering task
- the runtime expects action-style termination

## Evidence

The current code shape supports this diagnosis:

1. Prior-turn memory is injected into the executor instruction.
2. `buildExecutorInstruction()` in `src/background/orchestrator/handoff.ts` appends prior-turn context, but does not change the execution contract for verification follow-ups.
3. The loop in `src/background/agent/loop.ts` treats text-only replies as recoverable protocol failures rather than recognizing a distinct task type.
4. `evaluateTextAdmissionAdvanceGate()` still blocks on the first text-only turn, which is a poor fit for a verification query whose answer is already visible.

This means the runtime has fixed memory transport but not task interpretation.

## Root Cause

The system lacks an explicit **verification-turn mode**.

The executor prompt currently says things like:

- continue from prior context
- do not repeat completed work
- call `done()` only when success criteria are satisfied

That is still generic executor language. It does not tell the model:

- this turn is verification-only
- plain-text narration is not an acceptable terminal form
- the turn should end through `done()`
- `read_page()` is only needed if current grounding is insufficient

Without that distinction, models will continue to answer verification turns as natural-language confirmations.

## Proposed Solution

Introduce a first-class **Verification Turn Mode** for continuation follow-ups.

This should be treated as a runtime classification, not just a stronger wording tweak.

### Entry conditions

Enable verification mode when both are true:

1. `priorTurnMemoryBrief` is present and indicates a recent completed user-requested action
2. the current query matches a verification intent

Suggested intent patterns:

```typescript
/\b(did it work|verify|confirm|check if|check whether|does it show|what('s| is) the (status|result|current)|is it there)\b/i
```

### Execution contract in verification mode

When verification mode is active, the executor instruction should explicitly require:

- use tool-mediated completion only
- do not answer in free text
- if grounding is insufficient or stale, call `read_page()`
- if the current grounded snapshot already answers the question, call `done({"summary":"..."})`
- do not repeat prior mutations unless the user explicitly asked to retry

Example prompt block:

```text
VERIFICATION TURN:
The user is asking you to confirm the result of a prior action.
You must complete this turn using tool calls, not plain-text narration.

Rules:
- If the current page evidence is insufficient, call read_page().
- If the current grounded page state already answers the question, call done({"summary":"..."}).
- Do not describe findings in plain text.
- Do not repeat the prior action unless the user explicitly asked for that.
```

## Why this is the right fix

This addresses the actual failure mode:

- it changes the task contract at the point where the mismatch is created
- it does not rely on the model inferring hidden protocol expectations
- it avoids treating verification turns as failed action turns

Most importantly, it does **not** assume the model is confused. It assumes the runtime is underspecified.

## Recovery Logic

The loop should still have a backup path, but only as a narrow fallback.

### Verification-specific first-turn recovery

If verification mode is active and the first model response is text-only but clearly admits success or reports the requested verification result, the loop should not wait for a second text-only turn.

Instead:

- evaluate whether the response matches the active success criteria
- if yes, issue an immediate strong `done()` nudge
- optionally allow constrained synthesis of `done()` only when all of the following are true:
  - step is verification-classified
  - step is read-only
  - success criteria are matched
  - current snapshot already contains the required evidence

This keeps recovery local to the task type that needs it.

## Non-Goals

This RFC does not propose:

- globally lowering text-only escalation thresholds
- auto-completing from arbitrary success-sounding text
- forcing `read_page()` on every verification turn

Those options may improve pass rate in the short term, but they either overfit the symptom or add unnecessary work.

## Alternatives Considered

### 1. Force `read_page()` on all verification follow-ups

Pros:

- simple to explain
- likely improves compliance

Cons:

- redundant when current grounding is already sufficient
- teaches ritual tool use instead of grounded termination
- treats `read_page()` as protocol filler rather than evidence gathering

### 2. Lower the text-admission gate from 2 to 1 for these cases

Pros:

- fast to implement
- reduces wasted turns

Cons:

- still recovery logic, not contract repair
- does not solve the executor-side ambiguity
- risks growing special-case loop behavior over time

### 3. Auto-synthesize `done()` from narration

Pros:

- can rescue some failing runs

Cons:

- too easy to over-trust model phrasing
- weakens the explicit boundary between narration and structured completion
- should only be allowed in a tightly constrained verification-only path

## Recommended Implementation

### Phase 1: minimal, high-leverage change

1. Add verification-turn detection before or within `buildExecutorInstruction()`.
2. Inject a dedicated verification-mode instruction block into the executor prompt.
3. Add verification-specific first-turn recovery in `loop.ts`.

### Phase 2: durable cleanup

Add explicit task typing for planner/executor flow, for example:

- `action`
- `verification`
- `read_only_verification`

That typing should feed:

- executor instruction construction
- text-admission handling
- done-path expectations

This would stop the runtime from inferring verification behavior through scattered heuristics.

## Files to Modify

| File | Change |
|---|---|
| `src/background/orchestrator/handoff.ts` | Detect verification follow-ups and inject verification-mode executor instructions |
| `src/background/agent/loop.ts` | Add first-turn verification-specific recovery for text-only admissions |
| `src/background/orchestrator/index.ts` | Optionally classify and pass verification-turn state explicitly |

## Tests

### Unit tests

1. Verification mode activates only when prior-turn memory exists and current query matches verification intent.
2. Verification mode instruction includes `done()` termination guidance.
3. Verification mode does not activate for normal single-turn action requests.
4. First text-only verification admission triggers immediate recovery instead of waiting for a second miss.
5. Recovery does not fire when snapshot evidence does not satisfy success criteria.

### E2E targets

Primary:

```bash
npx vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/continuation-verify.test.ts
```

Secondary:

```bash
npx tsx scripts/run-e2e-progressive.ts continuation
```

## Decision

- [ ] Approved
- [ ] Approved with modifications: ___
- [ ] Rejected - reason: ___
