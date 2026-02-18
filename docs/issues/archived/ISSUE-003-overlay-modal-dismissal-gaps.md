# ISSUE-003: Overlay/Modal Dismissal Is Inconsistent Under Challenge Load

Severity: Critical
Status: Open
Date identified: 2026-02-17
Updated: 2026-02-17 (source code root cause analysis)
Area: Content script overlay handling + agent tool strategy
Confidence: Medium-High

## Summary

`dismiss_overlays` frequently reports success with zero dismissals even when overlays still block interactions. The overlay detection pipeline (`isLikelyOverlay`, `autoDismissModals`, `detectViewportCoveringOverlays`) has structural blind spots that miss common modal patterns. The `hide_element` tool rejects valid modal targets because the agent targets child elements inside modals instead of the modal container. This is a primary blocker for challenge progression, along with element-cap and loop issues.

## Evidence

### Aggregate failure rates

| Tool | Calls | Zero/rejected | Success rate |
|------|-------|---------------|-------------|
| `dismiss_overlays` | 24 | 19 (dismissed 0) | **21%** |
| `hide_element` | 6 | 5 (rejected) | **17%** |

### Session-specific patterns

**Session `22c047ce` (287 turns):**
- T17: `dismiss_overlays` → "Dismissed 0 overlay(s)"
- T34: `hide_element` → rejected
- T92: Agent diagnosed the problem: "Submit Code button remains disabled because a modal popup is still open"
- T204: Submit button [165] has `disabled="true"` in DOM — modal is blocking
- Agent never successfully cleared the blocking modal in 275 turns

**Session `4b279dcc` (153 turns):**
- `dismiss_overlays` called 6 times: ALL returned 0 dismissed
- `hide_element` rejected 2 times: targets were `[446] <h3>` and `[115] <button>` — children inside modals, not the modal containers

**Session `4426e55d` (85 turns, completed despite modals):**
- Persistent "Alert!" modal with fake "Dismiss" button appeared in every `read_page` from T1 to T67
- T39: `dismiss_overlays` → 0, T41: `hide_element(454)` → rejected (h3 element), T65: `dismiss_overlays` → 0
- DnD still worked through the modal (it didn't technically block drag events)

### Source code root cause analysis

**`isLikelyOverlay()` in `src/content/actions.ts`** has 5 conditions:
1. `position: fixed|absolute` AND `z-index > 100` → many challenge modals use `z-index < 100` or `static` positioning
2. Matches `OVERLAY_SELECTORS` (`[role='dialog']`, `.modal`, `.overlay`, `.popup`, `.banner`, `.cookie`, `.consent`) → challenge modals use custom classes not in this list
3. `backdrop-filter` present → challenge modals don't use backdrop-filter
4. Semi-transparent `rgba` background with `alpha < 0.85` → challenge modals may use solid backgrounds
5. Covers >30% viewport → small centered modals miss this threshold

**`autoDismissModals()` in `src/content/content.ts`** 4-phase pipeline:
- Phase A: Selector-based — uses same narrow `OVERLAY_SELECTORS` list
- Phase B: Viewport coverage — `detectViewportCoveringOverlays()` scans all elements for `fixed|absolute` + >30% viewport. Small modals miss this.
- Phase C: ESC dispatch — works for some modals but not challenge-style ones
- Phase D: Re-scan — repeats Phase A+B, still misses the same modals

**`hide_element` handler in `src/content/actions.ts`:** Rejects with "does not appear to be an overlay" if `isLikelyOverlay()` returns false. The agent typically targets **child elements** (buttons, headings) inside the modal, not the modal container itself. Children never pass overlay detection.

### Critical gap: agent targets children, not containers

The pattern observed across all sessions:
1. Agent sees modal content (text, button) in the snapshot
2. Agent calls `hide_element` on the visible child element (e.g., `[454] <h3>`, `[446] <h3>`, `[115] <button>`)
3. `isLikelyOverlay()` checks the child element — it's not positioned/fixed, no high z-index → rejected
4. The actual modal container (a wrapping div) would pass the checks, but the agent doesn't know its tag ID

## User-visible impact

- Popups/modals block submit buttons, input fields, and interactive elements
- Agent correctly diagnoses "modal is blocking" but cannot clear it
- Sessions burn hundreds of turns trying to work around modals instead of dismissing them
- Submit buttons rendered `disabled="true"` due to modal interference

## Primary and contributing causes

1. **`OVERLAY_SELECTORS` list is too narrow.** Missing `data-*` attributes, custom class patterns, and common modal containers (`.dialog`, `.lightbox`, `.notification`, `[aria-modal]`).
2. **`isLikelyOverlay()` checks are conjunctive, not disjunctive enough.** A modal only needs to match ONE strong signal (covers interactive elements, has a close button, appears after page load) but the current heuristics require specific CSS properties.
3. **No ancestor walk in `hide_element`.** When the agent targets a child element, the tool should walk up the DOM to find the nearest overlay ancestor and hide that instead.
4. **Viewport coverage threshold too high.** A 200x300px modal on a 1920x1080 screen covers ~3%, far below the 30% threshold. Many modals are small.
5. **No "blocks interaction" heuristic.** The real test for "is this an overlay?" is whether it prevents clicking elements behind it — via `pointer-events`, z-index stacking, or `position: fixed`. The current code doesn't test this.

## Recommended fix direction

1. **Ancestor walk in `hide_element`.** When `isLikelyOverlay(target)` returns false, walk `target.parentElement` up the tree until an overlay ancestor is found or root is reached. Hide the ancestor.
2. **Broaden `OVERLAY_SELECTORS`.** Add: `[aria-modal='true']`, `[data-modal]`, `[data-overlay]`, `[data-dialog]`, `.dialog`, `.lightbox`, `.notification`, `.toast`, `.popup-content`, `.modal-overlay`, `.backdrop`.
3. **Lower viewport coverage threshold.** Reduce from 30% to 10%, or add a second heuristic: "covers ANY tagged interactive element" = overlay.
4. **Add z-index stacking check.** If an element has higher z-index than interactive elements behind it and is `position: fixed|absolute`, it's an overlay — regardless of size.
5. **Return structured dismiss telemetry.** Report: detected overlays, actions taken, remaining blockers. Let the agent retry with better targeting.
6. **Post-dismiss verification.** After dismissal, check if previously disabled elements became enabled. If not, retry with broader detection.

## Acceptance criteria

1. `dismiss_overlays` success rate > 70% on modal-heavy pages (up from 21%).
2. `hide_element` with child targets should auto-walk to overlay ancestor.
3. Reduced incidence of immediate post-dismiss stuck/redundancy events.
4. Submit buttons that were `disabled` due to modals become enabled after dismissal.
5. Fewer user hints needed for modal-related unblock.

