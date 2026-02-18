# ISSUE-002: Non-converging Tool Loops Despite Redundancy Detection

Severity: Critical
Status: Open
Date identified: 2026-02-17
Updated: 2026-02-17 (deep trace analysis)
Area: Agent loop policy, stuck handling, tool strategy pivots

## Summary

The agent repeatedly enters search/action loops (`find_element`, `read_page`, `scroll_page`, repeated clicks) even while redundancy and stuck detectors are firing. Detection exists, but convergence controls are not strong enough. The agent never develops a fundamentally different approach despite escalation signals, redundancy warnings, and stuck detection.

## Evidence

### Aggregate log counts

- `Redundant action detected`: 66
- `Tool-name redundancy detected`: 48
- `Progress stuck detected`: 26
- `Worker emitted stale-progress signal`: 18
- Tool usage: `find_element` 370 calls (31% miss rate), `click_element` 167, `read_page` 155

### Worst-case session: `22c047ce` (287 turns, stuck on Step 20 for 275 turns)

The agent was trapped in a tight loop for 275 consecutive turns:

```
type_text("TA8UBD") → click_element(Submit) → wait → read_page → find_element("Step 21")
→ not found → type_text again → ...
```

- Typed the code 20 times (15 matching displayed code, 5 corrupted as "TABUBD")
- Clicked Submit 18 times
- Ran 3-5 consecutive `find_element` searches without acting between each attempt
- 14 `redundant_action` events, 13 `tool_name_redundancy` events, 3 `stuck_signal` events — all ignored

**Critical finding: Step 20 is likely unsolvable by design.** The displayed code "TA8UBD" does not work — confirmed by manual human testing. Step 21 never appears in any trace across all sessions. The same code "TA8UBD" is reused from Step 19, unlike all other steps which have unique codes. The "Enter Code to Proceed to Step 21" form is a deliberate dead-end trap.

**The real failure is not that the agent couldn't solve Step 20 — it's that the agent spent 275 turns grinding on an impossible task without recognizing it was unsolvable.** After 5-10 failed submit attempts with the correct code, a well-functioning agent should conclude "this code entry is not working, the step may be a trap or require a different approach" and either:
- Report to the user that it's stuck and the step appears unsolvable
- Try a fundamentally different strategy (inspect page source, look for hidden mechanisms)
- Give up gracefully

### Session `0b58a215` (185 turns)

- `select_option(id=0)` hallucinated 5 times — element ID 0 never existed
- 14 `redundant_action` events, 12 `tool_name_redundancy` events
- Step 18 consumed 74 turns (40% of session) with no strategy change

### Session `37661697` (189 turns)

- Step 14 consumed 76 turns (40% of session)
- Fabricated wrong code "5QWW5R" instead of reading the actual code from the page
- Canvas strokes: 3 of 6 didn't register, but the agent repeated the same stroke pattern instead of adapting

### DnD failure: session `4b279dcc`

- All 3 `drag_and_drop` attempts used **identical args** `{sourceId:411, targetId:440}` despite receiving stale-element errors each time listing available elements
- The error message explicitly listed valid elements — the agent never used them

### Turn concentration by step (across all sessions)

| Step | Total Turns | % of Budget |
|------|-------------|-------------|
| Step 20 | 473 | worst |
| Step 6 (DnD) | 248 | second worst |
| Step 14 | 154 | third |

## User-visible impact

- Agent appears distracted and repetitive.
- Same UI regions/actions are revisited without unlocking progress.
- User intervention is needed to redirect.
- Agent "knows" the answer but cannot execute (e.g., correct code typed but submit blocked).

## Root cause hypothesis

1. **Redundancy warnings are advisory only.** They inject a nudge into the system prompt but don't prevent the next tool call. The model ignores nudges after a few turns.
2. **No "failed actions memory."** The agent has no short-term record of "I tried X, it failed." Each turn reasons from scratch over the full (bloated) context, leading to the same conclusion.
3. **Escalation doesn't reset strategy.** After escalation to the smart model, the same conversation history is present, so the smart model arrives at the same conclusion as the fast model.
4. **No action deduplication.** Nothing prevents calling `find_element("Step 21")` for the 97th time. A simple "you already searched for this 5 times" would force a pivot.

## Recommended fix direction

1. **Hard tool budget per step.** After N calls to the same tool (e.g., `find_element` × 10), block it and force an alternative (screenshot, xray_page, or escalation).
2. **Failed action log.** Maintain a rolling window of the last 10 tool calls + results. Inject a compact summary: "Recent failures: find_element('Step 21') × 5 → not found, click_element(165) × 3 → disabled."
3. **Identical-args circuit breaker.** If the same tool+args combination appears 3 times, auto-fail with "You've tried this exact action 3 times. Try a different approach."
4. **Mandatory strategy pivot after stuck detection.** On the 3rd `stuck_signal`, force a structured pivot: take screenshot → describe state → formulate new hypothesis → act differently.
5. **Per-step progress contracts.** Define expected observable changes (URL change, new elements, element state change). If no delta is observed after 5 turns, compress and restart.

## Acceptance criteria

1. Repeated redundancy events should trigger bounded recovery, not open-ended loops.
2. No tool+args combination should appear more than 3 times without intervention.
3. For challenge benchmarks, `find_element` count per completed step must remain under target bounds.
4. Manual hint frequency required for completion should drop significantly.
