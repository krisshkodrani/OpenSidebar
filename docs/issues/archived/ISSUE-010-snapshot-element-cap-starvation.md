# ISSUE-010: 50-Element Snapshot Cap Starves Critical Elements on Complex Pages

Severity: Critical
Status: Open
Date identified: 2026-02-17
Area: Content script DOM tagging, snapshot generation
Confidence: High

## Summary

The DOM snapshot system has a hard cap of 50 elements. On complex pages with many interactive elements (buttons, links, inputs), this cap is reached before all task-relevant elements are included. Drop zones, form fields, and other critical elements are silently excluded from the snapshot, making them invisible to the agent. This is a structural contributor to DnD failures (ISSUE-004) and can amplify modal-related issues (ISSUE-003).

## Evidence

### Step 6 DnD page element budget

| Element type | Count | Priority | In snapshot? |
|-------------|-------|----------|-------------|
| Fake "Next/Continue/Keep Going" buttons | 27 | Low (anti-bot traps) | Yes (all 27) |
| Modal buttons (cookie, popup, alert) | 5 | Medium | Yes |
| Draggable pieces | 12 | High | Yes |
| Input field | 1 | Medium | Yes |
| **Drop zone `<span>` elements** | **6** | **Critical** | **NO — cap reached** |
| **Total** | **51** | | **50 included, 6 excluded** |

The 27 fake navigation buttons consume 54% of the element budget while providing zero task value. The 6 drop zones — the most important elements for the DnD task — are excluded.

### Impact on DnD success

| Session | Drop zones in snapshot? | DnD outcome |
|---------|----------------------|-------------|
| `4426e55d` | Yes (fewer fake buttons on page) | **Completed** (6/6 slots) |
| `4b279dcc` | No (cap filled by fake buttons) | **Failed** (0/6 slots, 80 turns wasted) |

A key observed difference between sampled success and failure runs was whether drop zones fit within the 50-element cap.

### Impact on element visibility generally

When the cap is reached, the agent cannot see elements that are:
- Below the fold (elements further down in DOM order)
- Inside containers that are processed after other sections
- Dynamically added after initial page render
- Non-standard interactive elements (custom components, `<span>` with click handlers)

### Workaround limitations

`find_element` can locate elements outside the cap via `addDynamicTag()`, but these tags are invalidated on the next snapshot refresh (see ISSUE-004). The agent must use `find_element` → act within the same turn, with no `read_page` in between.

## User-visible impact

- DnD tasks can be structurally impossible — the agent literally cannot see the drop targets.
- Agent wastes turns searching for elements that exist on the page but aren't in its view.
- Whether a task succeeds depends on how many junk elements the page has — non-deterministic.
- Pages with anti-bot trap buttons (common in the wild) disproportionately hit the cap.

## Root cause analysis

### Fixed cap with no prioritization

The 50-element cap was set as a constant to keep prompt sizes manageable. Elements are selected based on DOM order and selector matching (`INTERACTIVE_SELECTORS` + Phase 2 inline clickable scan). There is no intelligence about which elements are task-relevant.

### No deduplication

27 buttons with near-identical text ("Next", "Continue", "Keep Going", "Click Here", "Go Forward") are all included individually. A human would recognize these as duplicates or traps, but the tagging system treats each as equally important.

### Static cap doesn't adapt to page complexity

A simple login page (3 elements) and a complex challenge page (100+ elements) both get the same 50-element budget. The cap should scale with page complexity or at least be configurable per context.

## Recommended fix direction

1. **Element deduplication.** If N buttons have similar text (Levenshtein distance < 3), include only 2-3 representatives and note "N similar buttons omitted." This alone would free ~20 slots on the challenge page.

2. **Priority-based selection.** Score elements by relevance:
   - **High**: Elements the agent has recently interacted with or searched for
   - **High**: Form inputs, drop zones, submit buttons
   - **Medium**: Unique buttons, links, checkboxes
   - **Low**: Duplicate-looking buttons, decorative elements
   - Select top 50 by priority score, not DOM order.

3. **Dynamic cap adjustment.** Increase the cap on pages with many interactive elements:
   - Default: 50 elements
   - Pages with `[draggable]` elements: 75
   - Pages with > 100 interactive elements: 75-100
   - Monitor prompt token impact and adjust.

4. **Preserve dynamic tags.** Tags created by `find_element` should be "pinned" for at least 2 snapshot cycles (see ISSUE-004).

5. **"Overflow" indicator.** When the cap is reached, include a line in the snapshot: "⚠ 50/87 elements shown. Use find_element to search for specific elements." This tells the agent that there are hidden elements it should look for.

6. **Anti-bot button detection.** Flag clusters of buttons with generic action text ("Next", "Continue", "Click Here") that all appear in the same viewport region. Collapse them in the snapshot.

## Related issues

- ISSUE-004 (DnD stale IDs): The cap is a major cause of DnD failures in relevant sampled runs.
- ISSUE-003 (Modal dismissal): Modal buttons consume cap slots, worsening the problem.
- ISSUE-002 (Tool loops): Agent loops trying to find elements that are invisible due to cap.

## Acceptance criteria

1. Drop zone elements visible in snapshot when DnD is needed (dedup frees sufficient slots).
2. Duplicate buttons collapsed: no more than 3 representatives per text-similar group.
3. Snapshot includes "overflow" indicator when cap is reached.
4. DnD tasks succeed consistently regardless of fake button count on page.
5. Prompt token budget stays within bounds despite higher element counts.

