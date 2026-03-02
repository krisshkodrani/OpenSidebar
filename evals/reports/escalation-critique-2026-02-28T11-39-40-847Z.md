# Escalation Eval Report

Generated: 2026-02-28T11:39:40.846Z
Smart model: gpt-oss+reasoning

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 6 |
| Pass rate | 66.7% (4/6) |
| Failed | 2 |
| Errors | 0 |
| Avg escalation triggered | 1.000 |
| Avg reason quality | 1.000 |
| Avg tool match | 0.500 |
| Avg args match | 0.194 |
| Avg investigation quality | 0.500 |
| Avg composite | 0.719 |

## Per-Case Results

| Case | Status | Difficulty | Escalation | Tool Match | Investigation | Composite | Latency |
|------|--------|------------|------------|------------|---------------|-----------|---------|
| escalation-complex-001 | PASS | hard | 1.00 | 1.00 | 0.00 | 0.87 | 2192ms |
| escalation-hidden-001 | FAIL | medium | 1.00 | 0.00 | 0.00 | 0.50 | 15267ms |
| escalation-hidden-002 | PASS | medium | 1.00 | 1.00 | 1.00 | 0.95 | 2821ms |
| escalation-scroll-001 | FAIL | easy | 1.00 | 0.00 | 0.00 | 0.50 | 8483ms |
| escalation-stuck-click-001 | PASS | easy | 1.00 | 0.00 | 1.00 | 0.60 | 16844ms |
| escalation-wrong-input-001 | PASS | medium | 1.00 | 1.00 | 1.00 | 0.90 | 3855ms |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 50% (1/2) | 0.550 |
| medium | 67% (2/3) | 0.783 |
| hard | 100% (1/1) | 0.867 |

## Phase Analysis

| Phase | Success Rate |
|-------|-------------|
| Phase 1: Escalation triggered | 100% (6/6) |
| Phase 2: Recovery tool match | 50% (3/6) |

## Failed Cases (2 total)

### escalation-hidden-001 — hidden_code

- **Status**: fail
- **Scores**: esc=1.00 tool=0.00 inv=0.00 comp=0.50
  - *(not judged)*

- **Fast model called**: escalate({"reason":"Tried searching visible text for 'code', 'hidden', 'secret' using find_element, read_element on hint and paragraph, and scrolling, but no hidden elements revealed. The hidden code may be in a CSS-hidden element or generated dynamically, which requires deeper analysis beyond current tools."})
- **Smart model called**: (no tool calls)
- **Expected smart action**: inspect_hidden (or: xray_page, execute_js)

### escalation-scroll-001 — element_below_fold

- **Status**: fail
- **Scores**: esc=1.00 tool=0.00 inv=0.00 comp=0.50
  - *(not judged)*

- **Fast model called**: escalate({"reason":"I attempted to scroll down the Terms of Service page multiple times and used find_element to locate 'I Accept' checkbox and 'Continue' button, but no such elements appeared in the visible elements or page content. The page likely loads these controls via dynamic content or they are hidden, and my attempts to locate them failed. Unable to progress further, escalating for deeper analysis."})
- **Smart model called**: (no tool calls)
- **Expected smart action**: execute_js (or: find_element, xray_page, inspect_hidden, read_page)

## Prompt Recommendations

No specific recommendations — all cases passed or no judge was run.
