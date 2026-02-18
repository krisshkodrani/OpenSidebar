# ISSUE-008: Fast Model Hallucinates Non-existent Element IDs

Severity: High
Status: Open
Date identified: 2026-02-17
Area: LLM tool-calling reliability, fast-tier model quality
Confidence: Medium

## Summary

The fast model (`gpt-oss-120b`) generates fabricated element IDs in tool calls — IDs that never existed in any snapshot. This is distinct from stale IDs (ISSUE-004) where elements existed but were invalidated. Hallucinated IDs cause guaranteed failures and wasted turns.

## Evidence

### Session `0b58a215` (185 turns)

The agent called `select_option(id=0)` **5 times** in succession. Element ID 0 was never present in any snapshot — the lowest valid ID in the session was in the hundreds. Each call returned "No element with tag [0]" but the agent repeated the exact same hallucinated call.

### Session `22c047ce` (287 turns)

- T88: `set_checkbox(id=0, checked=true)` — element 0 never existed
- T90: `read_element(id=757)` — element 757 not in snapshot (stale from a much earlier state)
- T203: `click_element(id=594)` — element 594 not in current snapshot

### Aggregate from logs

- "No element with tag" errors: **66 total** across all sessions
- A non-trivial subset of these appears to be hallucinated IDs that never existed (distinct from stale IDs); exact split should be instrumented

### Pattern

Hallucination occurs more frequently:
- After many turns of accumulated context (context bloat — see ISSUE-001)
- When the fast model is processing complex pages with many elements
- When the agent is stuck and cycling (see ISSUE-002) — it "invents" element IDs instead of discovering them via `find_element` or `read_page`

## User-visible impact

- Guaranteed tool failures waste turns and tokens.
- Agent enters retry loops with the same hallucinated ID (compounds ISSUE-002).
- Contributes to perception of "dumb" agent behavior.

## Root cause hypothesis

1. **Context overload.** With 200+ messages in history, the fast model loses track of which element IDs are currently valid and defaults to "round numbers" like 0.
2. **No ID validation before dispatch.** The agent loop sends tool calls directly to the content script without checking if the referenced element ID exists in the last known snapshot.
3. **Fast model has weaker grounding.** The smart model tier (GLM-4.7 in current config) appears to show this behavior less frequently in sampled traces — it references IDs from recent `read_page` results.

## Recommended fix direction

1. **Pre-dispatch ID validation.** Before sending any tool call that references an element ID to the content script, check the ID against the last snapshot's element list. If not found, return an immediate error with a hint: "Element [N] not found in current page. Known elements: [list of valid IDs]. Use read_page or find_element to discover elements."
2. **Inject "current valid IDs" summary.** Add a compact line to the system prompt: "Valid element IDs on this page: [1, 3, 5, 7, ...]" — this gives the model grounding data.
3. **Block ID 0.** Element ID 0 is never valid in the tagging system (IDs start from 1). Hard-reject any tool call referencing id=0 with a clear error.
4. **Escalate on hallucination streak.** If 3 consecutive tool calls reference non-existent IDs, escalate to the smart model — the fast model has lost situational awareness.

## Related issues

- ISSUE-001 (Context bloat): Hallucination frequency correlates with context size.
- ISSUE-002 (Non-converging loops): Hallucinated IDs contribute to tool loops.

## Acceptance criteria

1. Zero tool calls dispatched with element ID 0 (never valid).
2. Hallucinated ID errors reduced by > 70% via pre-dispatch validation.
3. Fast model references IDs from recent snapshots, not invented numbers.

