# Escalation Eval Report

Generated: 2026-02-28T15:41:09.196Z
Smart model: deepseek-v3.2-speciale

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 6 |
| Pass rate | 0.0% (0/6) |
| Failed | 0 |
| Errors | 6 |
| Avg escalation triggered | 0.000 |
| Avg reason quality | 0.000 |
| Avg tool match | 0.000 |
| Avg args match | 0.000 |
| Avg investigation quality | 0.000 |
| Avg composite | 0.000 |

## Per-Case Results

| Case | Status | Difficulty | Escalation | Tool Match | Investigation | Composite | Latency |
|------|--------|------------|------------|------------|---------------|-----------|---------|
| escalation-complex-001 | ERR | hard | 0.00 | 0.00 | 0.00 | 0.00 | 775ms |
| escalation-hidden-001 | ERR | medium | 0.00 | 0.00 | 0.00 | 0.00 | 553ms |
| escalation-hidden-002 | ERR | medium | 0.00 | 0.00 | 0.00 | 0.00 | 609ms |
| escalation-scroll-001 | ERR | easy | 0.00 | 0.00 | 0.00 | 0.00 | 778ms |
| escalation-stuck-click-001 | ERR | easy | 0.00 | 0.00 | 0.00 | 0.00 | 1070ms |
| escalation-wrong-input-001 | ERR | medium | 0.00 | 0.00 | 0.00 | 0.00 | 470ms |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 0% (0/2) | 0.000 |
| medium | 0% (0/3) | 0.000 |
| hard | 0% (0/1) | 0.000 |

## Phase Analysis

| Phase | Success Rate |
|-------|-------------|
| Phase 1: Escalation triggered | 0% (0/6) |
| Phase 2: Recovery tool match | 0% (0/6) |

## Failed Cases (6 total)

### escalation-complex-001 — puzzle_requiring_reasoning

- **Status**: error — Smart phase API error 404: {"error":{"message":"No endpoints found that support tool use. To learn more about provider routing, visit: https://openrouter.ai/docs/guides/routing/provider-selection","code":404}}
- **Scores**: esc=0.00 tool=0.00 inv=0.00 comp=0.00
  - *(not judged)*

- **Fast model called**: (no tool calls)
- **Smart model called**: (no tool calls)
- **Expected smart action**: type_text (or: read_page, execute_js, read_element)

### escalation-hidden-001 — hidden_code

- **Status**: error — Smart phase API error 404: {"error":{"message":"No endpoints found that support tool use. To learn more about provider routing, visit: https://openrouter.ai/docs/guides/routing/provider-selection","code":404}}
- **Scores**: esc=0.00 tool=0.00 inv=0.00 comp=0.00
  - *(not judged)*

- **Fast model called**: (no tool calls)
- **Smart model called**: (no tool calls)
- **Expected smart action**: inspect_hidden (or: xray_page, execute_js)

### escalation-hidden-002 — aria_label_code

- **Status**: error — Smart phase API error 404: {"error":{"message":"No endpoints found that support tool use. To learn more about provider routing, visit: https://openrouter.ai/docs/guides/routing/provider-selection","code":404}}
- **Scores**: esc=0.00 tool=0.00 inv=0.00 comp=0.00
  - *(not judged)*

- **Fast model called**: (no tool calls)
- **Smart model called**: (no tool calls)
- **Expected smart action**: read_element (or: inspect_hidden, xray_page, execute_js)

### escalation-scroll-001 — element_below_fold

- **Status**: error — Smart phase API error 404: {"error":{"message":"No endpoints found that support tool use. To learn more about provider routing, visit: https://openrouter.ai/docs/guides/routing/provider-selection","code":404}}
- **Scores**: esc=0.00 tool=0.00 inv=0.00 comp=0.00
  - *(not judged)*

- **Fast model called**: (no tool calls)
- **Smart model called**: (no tool calls)
- **Expected smart action**: execute_js (or: find_element, xray_page, inspect_hidden, read_page)

### escalation-stuck-click-001 — click_intercepted_overlay

- **Status**: error — Smart phase API error 404: {"error":{"message":"No endpoints found that support tool use. To learn more about provider routing, visit: https://openrouter.ai/docs/guides/routing/provider-selection","code":404}}
- **Scores**: esc=0.00 tool=0.00 inv=0.00 comp=0.00
  - *(not judged)*

- **Fast model called**: (no tool calls)
- **Smart model called**: (no tool calls)
- **Expected smart action**: click_element (or: dismiss_overlays, hide_element)

### escalation-wrong-input-001 — typing_wrong_field

- **Status**: error — Smart phase API error 404: {"error":{"message":"No endpoints found that support tool use. To learn more about provider routing, visit: https://openrouter.ai/docs/guides/routing/provider-selection","code":404}}
- **Scores**: esc=0.00 tool=0.00 inv=0.00 comp=0.00
  - *(not judged)*

- **Fast model called**: (no tool calls)
- **Smart model called**: (no tool calls)
- **Expected smart action**: find_element (or: read_page, read_element)

## Prompt Recommendations

No specific recommendations — all cases passed or no judge was run.
