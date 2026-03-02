# Escalation Eval Report

Generated: 2026-02-28T11:33:02.304Z
Smart model: gpt-oss+reasoning

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 6 |
| Pass rate | 0.0% (0/6) |
| Failed | 6 |
| Errors | 0 |
| Avg escalation triggered | 0.000 |
| Avg reason quality | 0.000 |
| Avg tool match | 0.333 |
| Avg args match | 0.083 |
| Avg investigation quality | 0.500 |
| Avg composite | 0.158 |

## Per-Case Results

| Case | Status | Difficulty | Escalation | Tool Match | Investigation | Composite | Latency |
|------|--------|------------|------------|------------|---------------|-----------|---------|
| escalation-complex-001 | FAIL | hard | 0.00 | 0.00 | 0.00 | 0.00 | 3162ms |
| escalation-hidden-001 | FAIL | medium | 0.00 | 0.00 | 1.00 | 0.10 | 16647ms |
| escalation-hidden-002 | FAIL | medium | 0.00 | 1.00 | 1.00 | 0.45 | 19946ms |
| escalation-scroll-001 | FAIL | easy | 0.00 | 0.00 | 0.00 | 0.00 | 17018ms |
| escalation-stuck-click-001 | FAIL | easy | 0.00 | 0.00 | 0.00 | 0.00 | 5816ms |
| escalation-wrong-input-001 | FAIL | medium | 0.00 | 1.00 | 1.00 | 0.40 | 8783ms |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 0% (0/2) | 0.000 |
| medium | 0% (0/3) | 0.317 |
| hard | 0% (0/1) | 0.000 |

## Phase Analysis

| Phase | Success Rate |
|-------|-------------|
| Phase 1: Escalation triggered | 0% (0/6) |
| Phase 2: Recovery tool match | 33% (2/6) |

## Failed Cases (6 total)

### escalation-complex-001 — puzzle_requiring_reasoning

- **Status**: fail
- **Scores**: esc=0.00 tool=0.00 inv=0.00 comp=0.00
  - *(not judged)*

- **Fast model called**: type_text({"id":4,"text":"THIS IS THE CODE"})
- **Smart model called**: type_text({"id":4,"text":"THIS IS THE CODE","pressEnter":false})
- **Expected smart action**: read_page (or: execute_js, read_element)

### escalation-hidden-001 — hidden_code

- **Status**: fail
- **Scores**: esc=0.00 tool=0.00 inv=1.00 comp=0.10
  - *(not judged)*

- **Fast model called**: xray_page({})
- **Smart model called**: read_element({"id":3})
- **Expected smart action**: inspect_hidden (or: xray_page, execute_js)

### escalation-hidden-002 — aria_label_code

- **Status**: fail
- **Scores**: esc=0.00 tool=1.00 inv=1.00 comp=0.45
  - *(not judged)*

- **Fast model called**: type_text({"id":3,"text":"X7K9M2","pressEnter":false})
- **Smart model called**: read_element({"id":2,"attribute":"aria-label"})
- **Expected smart action**: read_element (or: inspect_hidden, xray_page, execute_js)

### escalation-scroll-001 — element_below_fold

- **Status**: fail
- **Scores**: esc=0.00 tool=0.00 inv=0.00 comp=0.00
  - *(not judged)*

- **Fast model called**: scroll_page({"direction":"bottom"})
- **Smart model called**: (no tool calls)
- **Expected smart action**: execute_js (or: find_element, xray_page, inspect_hidden)

### escalation-stuck-click-001 — click_intercepted_overlay

- **Status**: fail
- **Scores**: esc=0.00 tool=0.00 inv=0.00 comp=0.00
  - *(not judged)*

- **Fast model called**: click_element({"id":4})
- **Smart model called**: (no tool calls)
- **Expected smart action**: dismiss_overlays (or: hide_element, click_element)

### escalation-wrong-input-001 — typing_wrong_field

- **Status**: fail
- **Scores**: esc=0.00 tool=1.00 inv=1.00 comp=0.40
  - *(not judged)*

- **Fast model called**: type_text({"id":4,"text":"user@test.com"})
- **Smart model called**: read_element({"id":4,"attribute":"type"})
- **Expected smart action**: find_element (or: read_page, read_element)

## Prompt Recommendations

No specific recommendations — all cases passed or no judge was run.
