# Escalation Eval Report

Generated: 2026-02-28T15:45:04.592Z
Smart model: deepseek-v3.2

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 6 |
| Pass rate | 100.0% (6/6) |
| Failed | 0 |
| Errors | 0 |
| Avg escalation triggered | 1.000 |
| Avg reason quality | 1.000 |
| Avg tool match | 0.833 |
| Avg args match | 0.417 |
| Avg investigation quality | 1.000 |
| Avg composite | 0.892 |

## Per-Case Results

| Case | Status | Difficulty | Escalation | Tool Match | Investigation | Composite | Latency |
|------|--------|------------|------------|------------|---------------|-----------|---------|
| escalation-complex-001 | PASS | hard | 1.00 | 1.00 | 1.00 | 0.90 | 11707ms |
| escalation-hidden-001 | PASS | medium | 1.00 | 1.00 | 1.00 | 1.00 | 16101ms |
| escalation-hidden-002 | PASS | medium | 1.00 | 1.00 | 1.00 | 0.95 | 12759ms |
| escalation-scroll-001 | PASS | easy | 1.00 | 1.00 | 1.00 | 1.00 | 5025ms |
| escalation-stuck-click-001 | PASS | easy | 1.00 | 0.00 | 1.00 | 0.60 | 6854ms |
| escalation-wrong-input-001 | PASS | medium | 1.00 | 1.00 | 1.00 | 0.90 | 12328ms |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 100% (2/2) | 0.800 |
| medium | 100% (3/3) | 0.950 |
| hard | 100% (1/1) | 0.900 |

## Phase Analysis

| Phase | Success Rate |
|-------|-------------|
| Phase 1: Escalation triggered | 100% (6/6) |
| Phase 2: Recovery tool match | 83% (5/6) |

## Failed Cases

No failures.

## Prompt Recommendations

1. **[LOW]** (1x) The fast model's reasoning shows it actually knew the correct answer ('THIS IS THE CODE') but still escalated rather than trying it. The prompt could clarify that the fast model should attempt the obvious fix (submitting the correctly decoded uppercase text) before escalating.
2. **[LOW]** (1x) None needed - both phases performed optimally.
3. **[LOW]** (1x) None needed — both phases performed optimally.
4. **[LOW]** (1x) Encourage the smart model to prioritize execute_js for DOM inspection when elements are suspected to be hidden or dynamically loaded, rather than starting with read_page which may not reveal hidden elements.
5. **[LOW]** (1x) The smart model should be prompted to follow up investigation with action - after read_page(), it should explicitly look for overlay elements and attempt dismiss_overlays or hide_element before retrying the click.
6. **[LOW]** (1x) Consider encouraging the smart model to also use find_element with semantic queries like 'email input' to directly locate the correct field after reading the page, rather than just reading the full page.
