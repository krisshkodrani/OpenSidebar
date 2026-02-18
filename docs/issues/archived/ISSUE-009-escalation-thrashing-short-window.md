# ISSUE-009: Escalation Thrashing — Smart Model De-escalated Before Completing Work

Severity: High
Status: Open
Date identified: 2026-02-17
Area: Two-tier escalation system, BRAINS→HANDS handoff
Confidence: Medium-High

## Summary

The escalation system uses a short orientation window (`PHASE_TURNS = 2`) and may return to fast tier before smart-tier recovery is complete. This is too short for the smart model to complete complex reasoning or execute a multi-step recovery strategy. The result is rapid escalation/de-escalation cycling ("thrashing") that can consume up to ~40% of session time in sampled traces and often cuts off smart-tier recovery early.

## Evidence

### Aggregate escalation stats

- Total escalations: **35**
- Total de-escalations: **23**
- Net: 12 sessions ended while still on smart model (escalated but never de-escalated)
- Average smart-tier tenure in orientation paths is 2 turns by design (`ORIENTATION.PHASE_TURNS = 2`); escalation paths also enforce `MIN_SMART_TENURE = 3` before de-escalation checks

### Escalation overhead (sessions `4426e55d` and `4b279dcc`)

Large inter-turn gaps caused by escalation (context distillation + model switch):

| Session | Escalation pauses (>5s) | Total session time | % lost to escalation |
|---------|------------------------|-------------------|---------------------|
| `4426e55d` | 63s | 156.7s | **40%** |
| `4b279dcc` | 126s | 298.9s | **42%** |

Individual escalation pauses:
- T79→T80: 25.7s (biggest single gap)
- T86→T87: 19.5s
- T58→T59: 16.7s
- T100→T101: 15.1s
- T15→T16: 8.7s

### Session `22c047ce` (287 turns) — 7 model switches

| Turn | Switched To | Context |
|------|------------|---------|
| T1 | GLM-4.7 (smart) | Session start |
| T3 | gpt-oss-120b (fast) | BRAINS→HANDS after 2 turns |
| T17 | GLM-4.7 (smart) | Escalation (stuck at 3 stale turns) |
| T56 | gpt-oss-120b (fast) | De-escalation during recovery cycle |
| T104 | GLM-4.7 (smart) | Escalation |
| T204 | gpt-oss-120b (fast) | De-escalation |
| T235 | GLM-4.7 (smart) | Escalation |

After de-escalation at T56, the fast model ran for 48 turns before hitting the same stuck state again → escalated at T104 → smart model got 2 turns → de-escalated → fast model ran for 100 turns and corrupted the code → escalated again. The smart model never got enough turns to actually solve the blocking problem.

### Smart model was right, fast model undid progress

At T92 (during smart model tenure), the agent correctly diagnosed: "Submit Code button remains disabled because a modal popup is still open." But after de-escalation at T56, the fast model didn't act on this diagnosis — it went back to the type-code→click-submit loop.

## User-visible impact

- 40% of session time lost to escalation/distillation overhead.
- Smart model correctly identifies the problem but doesn't get enough turns to fix it.
- Fast model undoes smart model's progress by reverting to the same failing strategy.
- Escalation cycles create the appearance of "the agent getting dumber over time."

## Root cause analysis

### A short orientation window is architecturally fixed

The BRAINS→HANDS pattern starts smart for 2 turns, then hands off to fast. This makes sense for quick orientation — but 2 turns is insufficient for:
- Multi-step modal dismissal (identify container → find close button → click → verify)
- DnD recovery (re-discover elements → validate IDs → execute drag → verify slot fill)
- Any strategy that requires more than 2 actions

### distillForEscalation() loses context

On escalation, `distillForEscalation()` compresses history into a compact timeline. While this prevents context bloat, it also loses the specific details the smart model needs — like which element IDs are valid, what the last error was, or what the agent already tried.

### No "progress gate" for de-escalation

De-escalation happens after a fixed turn count, not after the smart model has made observable progress. The smart model should stay active until the stuck condition that triggered escalation is resolved.

## Recommended fix direction

1. **Progress-gated de-escalation.** Don't de-escalate after a fixed turn count. Instead, keep the smart model active until:
   - The stuck signal is resolved (snapshot fingerprint changes)
   - OR a URL navigation occurs (new page = new context)
   - OR max smart turns exceeded (e.g., 8 turns as a safety cap)
2. **Minimum smart tenure of 4-5 turns.** Even for BRAINS→HANDS, 2 turns is too few. A minimum of 4-5 gives the smart model time to diagnose AND act.
3. **Preserve diagnostic context across de-escalation.** When de-escalating, include the smart model's text-only diagnostic output (e.g., "Submit button disabled due to modal") in a sticky note that persists in the fast model's context.
4. **Reduce distillation overhead.** The 8-25 second pauses during escalation are excessive. Profile `distillForEscalation()` to find bottlenecks — it may be doing unnecessary work or making an LLM call.
5. **Escalation cooldown.** After de-escalation, impose a minimum of 10 fast-model turns before allowing re-escalation. This prevents rapid oscillation.

## Related issues

- ISSUE-001 (Context bloat): distillForEscalation is the only context reset — if escalation overhead is reduced, context bloat may worsen. These must be fixed together.
- ISSUE-002 (Non-converging loops): Fast model reverts to the same loop after de-escalation.

## Acceptance criteria

1. Smart model gets at least 4 turns per escalation (up from 2).
2. De-escalation only occurs after observable progress or a safety cap.
3. Escalation overhead < 20% of total session time (down from 40%).
4. Smart model's diagnostic insights persist after de-escalation.
5. No re-escalation within 10 fast-model turns of a de-escalation.


