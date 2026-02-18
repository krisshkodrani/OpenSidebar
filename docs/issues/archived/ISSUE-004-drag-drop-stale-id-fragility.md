# ISSUE-004: Drag-and-Drop Flow Is Fragile Due to Stale Element IDs and Snapshot Cap

Severity: Critical (upgraded from High)
Status: Open
Date identified: 2026-02-17
Updated: 2026-02-17 (deep trace analysis — root cause identified)
Area: DOM tagging/snapshot lifecycle + drag_and_drop tool + element cap

## Summary

Drag-and-drop actions fail repeatedly due to two compounding problems: (1) the **50-element snapshot cap** prevents drop zone elements from being tagged when the page has too many other interactive elements, and (2) dynamic tags created by `find_element` are **invalidated on the next snapshot refresh**. The cap issue is the structural root cause — it explains why DnD succeeds on some runs and fails completely on others.

## Evidence

### Aggregate stats

- `drag_and_drop` calls: 18 total
- Stale-ID errors: 6 (33% failure rate)
- Successful drops: 12

### Session comparison: success vs. failure

**Session `4426e55d` (85 turns — DnD COMPLETED):**
- Drop zone elements (tag 440 "Slot 1", tag 445 "Slot 2") were **present in the initial snapshot** at T1
- 15 DnD attempts, 3 stale errors, 12 successes (80% mechanical success)
- 6 slots filled in 85 turns (~14 turns/slot)

**Session `4b279dcc` (153 turns — DnD NEVER COMPLETED):**
- Drop zone elements were **NOT in the snapshot** — the 50-element cap was filled by other elements
- All 3 DnD attempts used **identical stale args** `{sourceId:411, targetId:440}` — 100% failure
- 0 of 6 slots filled despite 80 turns on Step 6

### The 50-element cap is the root cause

The challenge page at Step 6 has:
- 12 draggable pieces
- 27 fake "Next/Continue/Keep Going" navigation buttons (anti-bot traps)
- 5 modal buttons (cookie consent, popups, alerts)
- 1 input field
- **Total: 45-50 elements → cap reached**

The 6 drop zone `<span>` elements are pushed out of the snapshot. `find_element("Slot 1")` creates a dynamic tag via `addDynamicTag()`, but this tag is invalidated on the very next `read_page` / snapshot refresh because the element falls outside the 50-element persistent set.

In the **successful** session, fewer fake buttons were present (possibly different page version or modal state), so drop zones fit within the cap.

### Dynamic tag lifecycle problem

1. Agent calls `find_element("Slot 1")` → returns tag 440 via `addDynamicTag()`
2. Agent calls `drag_and_drop(sourceId=411, targetId=440)` → "Stale element IDs"
3. Between steps 1 and 2, a `read_page` or DOM snapshot refresh occurred, rebuilding the tag map from scratch — tag 440 is gone because the `<span>` element didn't make it into the top 50

### Post-drop ID invalidation (secondary issue)

Even in the successful session, 3 of 15 DnD attempts failed because:
- After a successful drop, the DOM re-renders (dragged element moves into slot)
- Remaining draggable pieces get new element IDs
- Agent uses stale IDs from the pre-drop snapshot

## User-visible impact

- DnD tasks can completely fail (0/6 slots) despite correct strategy
- Whether DnD works depends on how many fake buttons the page has — non-deterministic
- Even successful DnD burns ~14 turns per slot (should be 2-3)
- Agent appears to "fumble" despite understanding the task

## Root cause hypothesis

1. **50-element cap is too low for complex pages.** Pages with anti-bot trap buttons consume the entire budget, leaving no room for drop zones.
2. **No element prioritization.** The cap treats a fake "Next" button and a drop zone `<span>` equally. Interactive elements that are actually relevant to the task should be prioritized.
3. **Dynamic tags from `find_element` don't persist.** `addDynamicTag()` results should survive at least one snapshot cycle so the agent can act on them.
4. **No auto-refresh after successful drop.** The DOM mutates after each drag, but the agent must manually call `read_page` to get new IDs.

## Recommended fix direction

1. **Preserve dynamic tags across snapshot refreshes.** When `find_element` creates a tag via `addDynamicTag()`, mark it as "pinned" for at least 2 snapshot cycles. This gives the agent time to act on found elements.
2. **Smart element prioritization.** When the 50-element cap is reached, prioritize: (a) elements the agent has recently interacted with, (b) elements matching the current task context (e.g., drop zones during DnD), (c) de-prioritize duplicate-looking elements (27 buttons with similar text).
3. **Auto-refresh after DnD.** After a successful `drag_and_drop`, automatically trigger a snapshot refresh and return the updated element IDs in the tool response.
4. **Raise the element cap for DnD pages.** Detect DnD scenarios (page has `[draggable]` elements) and temporarily raise the cap to 75 or 100.
5. **Deduplicate fake buttons.** If 10+ buttons have near-identical text ("Next", "Continue", "Keep Going"), only include 2-3 representatives in the snapshot.

## Related issues

- ISSUE-003 (Modal dismissal): Uncleared modals contribute 5+ buttons to the element count, worsening the cap problem.
- ISSUE-010 (Snapshot element cap): The cap is a broader architectural issue affecting more than just DnD.

## Acceptance criteria

1. DnD success rate > 80% on first attempt (currently 0% when cap is hit).
2. Completing 6-slot drag task in < 30 turns (currently 85+ or never).
3. Dynamic tags from `find_element` survive at least 1 snapshot cycle.
4. No manual hint required for baseline drag scenario.
