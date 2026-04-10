# RFC: Tighten Text-Admission Path with Existing Gate Shape

**Status**: Draft (v3 — revised after two code reviews)
**Date**: 2026-04-10
**Author**: Agent session
**Reviewers**: Codex review 1 (4 issues in v1), Codex review 2 (2 issues in v2)
**Affects**: `src/background/agent/loop.ts`

## Problem

When the executor model narrates step completion in text instead of calling `done()`, the existing text-admission handler at `loop.ts:8101` only nudges "Call done()" — which the model often ignores, leading to text-only loops, empty responses, and eventual timeout.

This is a **general gap** in the text-only handler, not specific to one test. Traces confirm the intermediate-step text-admission scenario is real:

- `traces/014980ff`: Model produces `"## Completed ... Warehouse Gamma ... 6,412 units"` after clicking — text-only with no tool call on that turn
- `traces/runs/44bba53f`: Node 2 fails with "finished without summary" / insufficient evidence
- `traces/runs/9da77ef0`: 3-node decomposition, later nodes don't complete

The failure mode varies across runs (heterogeneous decomposition, different node counts, different failure points). The common thread is: **the text-admission path has no evidence-based advancement — it only nudges, and nudges don't reliably convert to tool calls.**

The system already has two advancement paths that combine evidence:

- **done() rejection auto-advance** (`loop.ts:5552`): sentiment + coherence + criteria + rate limit
- **Post-action passive advancement** (`loop.ts:7662`): DOM criteria matching via `completeSingleSubtask()`

But the **text-only handler** (`loop.ts:8101`) doesn't use this gate shape — it only does regex phrase matching via `detectAdmission()`, then nudges.

## v1 Issues (Codex review 1)

1. Misidentified failure as pure text-only (report shows click_element + done)
2. Final-step auto-complete bypassed task-contract and multi-return guards
3. Used `advanceCompletedSubtasks()` instead of safer `completeSingleSubtask()`
4. Testing claimed zero risk with no new tests

## v2 Issues (Codex review 2)

1. **Cleanup was self-defeating**: Proposed reverting SUCCESS_PATTERNS that the gated path depends on. The `## Completed` pattern is needed for `detectAdmission()` to fire, which is the entry point for the new gate. **Resolution**: Keep the admission patterns — they are the trigger. The gate adds safety, not redundancy.
2. **Root-cause narrative was overspecified**: Claimed a concrete 3-4 node sequence as "the" cause, but traces show heterogeneous failures. **Resolution**: Present as a general text-admission gap supported by trace evidence, not as a confirmed single root cause.

## Proposed Solution (v3)

Tighten the **existing** text-admission path at `loop.ts:8115` using the same gate shape already used for rejected done() calls. Do NOT create a new shortcut.

### Change

When `detectAdmission()` matches a success pattern, instead of just nudging, run the 4-gate check. If all gates pass on an intermediate step, advance using `completeSingleSubtask()`. If on the final step, nudge with a stronger message but do NOT auto-complete (preserving all existing guards).

```typescript
if (admission.type === "success") {
  const runningIdx = this.planSubtasks.findIndex(s => s.status === "running");
  const currentStep = this.planSteps[runningIdx];

  // Same 4-gate shape as done() rejection auto-advance (line 5552)
  const sentiment = assessDoneSummary(cleanContent || "");
  const criteriaCheck = currentStep?.successCriteria
    ? matchSuccessCriteria({
        successCriteria: currentStep.successCriteria,
        snapshot: this.context.getSnapshot(),
      })
    : null;
  const coherence = runningIdx >= 0
    ? checkSummaryStepCoherence({
        summary: cleanContent || "",
        currentStepIndex: runningIdx,
        stepDescriptions: this.planSubtasks.map(s => s.description),
      })
    : null;

  const gatesPassed =
    sentiment.confident &&
    (criteriaCheck?.satisfied ?? false) &&
    (coherence?.coherent ?? true) &&
    consecutiveTextOnly >= 1;

  if (gatesPassed && runningIdx >= 0) {
    const pendingCount = this.planSubtasks.filter(
      s => s.status === "pending",
    ).length;
    const isLastStep = pendingCount === 0;

    if (!isLastStep) {
      // INTERMEDIATE step: advance using safe single-step primitive
      const newIdx = this.completeSingleSubtask(runningIdx);
      this.syncPlanStatus(newIdx, "text_admission_criteria_advance", {
        turn: this.turnCount,
      });
      this.context.addMessage({
        role: "user",
        content:
          `Step verified complete (criteria matched, text confirms success). ` +
          `Advancing.\nYOUR NEW OBJECTIVE: ` +
          `${this.planSubtasks[newIdx]?.description}`,
      });
      this.broadcast({
        type: "STREAM_CHUNK",
        payload: { delta: "", done: true },
      });
      continue;
    } else {
      // LAST step: nudge done() — do NOT auto-complete.
      // Let the model call done() so task-contract and multi-return
      // guards can validate the final summary.
      this.context.addMessage({
        role: "user",
        content:
          `You stated: "${admission.match}". All step criteria are met. ` +
          `Call done({"summary": "..."}) now with the complete result ` +
          `including all requested data.`,
      });
      this.broadcast({
        type: "STREAM_CHUNK",
        payload: { delta: "", done: true },
      });
      continue;
    }
  }

  // Gates didn't pass — fall back to simple nudge
  const nudge =
    `You stated: "${admission.match}". Call done() to deliver the result.`;
  this.context.addMessage({ role: "user", content: nudge });
}
```

### Key properties

| Property | How it's ensured |
|---|---|
| Final step guards preserved | Last step nudges done(), doesn't auto-complete. `evaluateDoneTaskContractGuard()` and multi-return checks still run. |
| Safe advancement primitive | `completeSingleSubtask()` advances exactly one step, resets state properly |
| Consistent gate shape | Same 4 checks as done() rejection: sentiment, criteria, coherence, consecutiveTextOnly |
| Admission patterns kept | SUCCESS_PATTERNS additions (## Completed, "I verified", etc.) are required for `detectAdmission()` to fire — they are the entry point, not cleanup targets |

### What this preserves

- `evaluateDoneTaskContractGuard()` still validates all final done() calls
- Multi-return suppression on auto-complete signal still active
- `completeSingleSubtask()` safely advances one step, not multiple
- Existing text-only escalation still fires when gates don't pass
- All existing SUCCESS_PATTERNS remain (they trigger the gate)

## Regression Analysis

### 30 passing tests: LOW risk

The text-admission detection (`detectAdmission`) fires on specific phrases. If any passing test's model happens to produce a matching phrase on a text-only turn, the new code would fire. However:

- The 4-gate chain (sentiment + criteria + coherence + consecutiveTextOnly >= 1) makes false advancement unlikely
- `completeSingleSubtask` is already used by the passive advancement path (`loop.ts:7681`) on passing tests
- Final step never auto-completes — all existing guards still run

### New unit tests required

1. **Intermediate step advancement**: Mock plan with 3 steps, step 1 running, criteria satisfied, text admits success, consecutiveTextOnly=1 → verify `completeSingleSubtask` called, step 2 becomes running
2. **Final step does NOT auto-complete**: Same setup but on last step → verify `doneSignaled` is NOT set, nudge message contains "Call done()" instead
3. **Gate blocks on failure sentiment**: Text says "I couldn't find X", criteria match → verify no advancement
4. **Gate blocks on criteria mismatch**: Text admits success but DOM doesn't match criteria → verify no advancement
5. **Gate blocks on first text-only**: `consecutiveTextOnly === 0` → verify no advancement even if other gates pass

## Cleanup

The following stopgap changes from this session should be evaluated **separately** (not as part of this RFC):

1. **SUCCESS_PATTERNS additions** in `verification.ts` — **KEEP**. These are required for `detectAdmission()` to match the narration patterns observed in traces. Without them, the gated path cannot fire.
2. **Auto-done from text admission block** in `loop.ts` (the `if (admission.type === "success" && this.planSubtasks.length > 0)` block) — **REPLACE** with this RFC's implementation. This is the code being tightened.
3. **Multi-return step advancement in auto-complete signal** in `loop.ts` (the `else if (explicitSuccessSignal && taskContractMultiReturn >= 2)` block) — **KEEP** for defense-in-depth. It handles a different path (post-action snapshot) vs this RFC (text-only handler).

## Decision

- [ ] Approved — implement as described
- [ ] Approved with modifications: ___
- [ ] Rejected — reason: ___
