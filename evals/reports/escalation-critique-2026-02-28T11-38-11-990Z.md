# Escalation Eval Report

Generated: 2026-02-28T11:38:11.989Z
Smart model: gpt-oss+reasoning

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 6 |
| Pass rate | 50.0% (3/6) |
| Failed | 3 |
| Errors | 0 |
| Avg escalation triggered | 1.000 |
| Avg reason quality | 1.000 |
| Avg tool match | 0.500 |
| Avg args match | 0.250 |
| Avg investigation quality | 0.500 |
| Avg composite | 0.725 |

## Per-Case Results

| Case | Status | Difficulty | Escalation | Tool Match | Investigation | Composite | Latency |
|------|--------|------------|------------|------------|---------------|-----------|---------|
| escalation-complex-001 | FAIL | hard | 1.00 | 0.00 | 0.00 | 0.50 | 1905ms |
| escalation-hidden-001 | PASS | medium | 1.00 | 1.00 | 1.00 | 1.00 | 44775ms |
| escalation-hidden-002 | PASS | medium | 1.00 | 1.00 | 1.00 | 0.95 | 3567ms |
| escalation-scroll-001 | FAIL | easy | 1.00 | 0.00 | 0.00 | 0.50 | 16841ms |
| escalation-stuck-click-001 | FAIL | easy | 1.00 | 0.00 | 0.00 | 0.50 | 20777ms |
| escalation-wrong-input-001 | PASS | medium | 1.00 | 1.00 | 1.00 | 0.90 | 4841ms |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 0% (0/2) | 0.500 |
| medium | 100% (3/3) | 0.950 |
| hard | 0% (0/1) | 0.500 |

## Phase Analysis

| Phase | Success Rate |
|-------|-------------|
| Phase 1: Escalation triggered | 100% (6/6) |
| Phase 2: Recovery tool match | 50% (3/6) |

## Failed Cases (3 total)

### escalation-complex-001 — puzzle_requiring_reasoning

- **Status**: fail
- **Scores**: esc=1.00 tool=0.00 inv=0.00 comp=0.50
  - *(not judged)*

- **Fast model called**: escalate({"reason":"I attempted to submit the original ciphertext 'GUVF VF GUR PBQR' directly, then tried to use the provided Caesar cipher hint (ROT13) but mistakenly re-entered the same ciphertext without decoding. The system responded with errors: first indicating the answer was incorrect, then stating the decoded text must be in UPPERCASE. I have not yet applied ROT13 to decode the message to its plaintext, which should be 'THIS IS THE CODE' in uppercase. However, I was unable to produce the correct decoded text within the current tool constraints, leading to repeated failures. Escalating for deeper analysis to correctly apply ROT13 and submit the uppercase decoded message."})
- **Smart model called**: type_text({"id":4,"text":"THIS IS THE CODE","pressEnter":false})
- **Expected smart action**: read_page (or: execute_js, read_element)

### escalation-scroll-001 — element_below_fold

- **Status**: fail
- **Scores**: esc=1.00 tool=0.00 inv=0.00 comp=0.50
  - *(not judged)*

- **Fast model called**: escalate({"reason":"I attempted to scroll down the Terms of Service page multiple times and used find_element to locate 'I Accept' checkbox and 'Continue' button, but no such elements appeared in the visible elements or page content. The page likely loads these controls via dynamic content or they are hidden, and my attempts to locate them failed. Unable to progress further, escalating for deeper analysis."})
- **Smart model called**: (no tool calls)
- **Expected smart action**: execute_js (or: find_element, xray_page, inspect_hidden)

### escalation-stuck-click-001 — click_intercepted_overlay

- **Status**: fail
- **Scores**: esc=1.00 tool=0.00 inv=0.00 comp=0.50
  - *(not judged)*

- **Fast model called**: escalate({"reason":"Attempted to click the 'Place Order' button (id 2) but each click was intercepted by an overlay element covering the button. Scrolled up and down but overlay persisted, preventing interaction. No other visible elements to dismiss the overlay were identified. Need deeper analysis to remove or bypass the overlay."})
- **Smart model called**: (no tool calls)
- **Expected smart action**: dismiss_overlays (or: hide_element, click_element)

## Prompt Recommendations

No specific recommendations — all cases passed or no judge was run.
