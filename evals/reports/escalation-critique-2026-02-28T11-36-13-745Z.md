# Escalation Eval Report

Generated: 2026-02-28T11:36:13.745Z
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
| Avg tool match | 0.500 |
| Avg args match | 0.250 |
| Avg investigation quality | 0.750 |
| Avg composite | 0.250 |

## Per-Case Results

| Case | Status | Difficulty | Escalation | Tool Match | Investigation | Composite | Latency |
|------|--------|------------|------------|------------|---------------|-----------|---------|
| escalation-complex-001 | FAIL | hard | 0.00 | 0.00 | 0.00 | 0.00 | 2394ms |
| escalation-hidden-001 | FAIL | medium | 0.00 | 0.00 | 0.50 | 0.05 | 5242ms |
| escalation-hidden-002 | FAIL | medium | 0.00 | 1.00 | 1.00 | 0.45 | 21037ms |
| escalation-scroll-001 | FAIL | easy | 0.00 | 1.00 | 1.00 | 0.50 | 7701ms |
| escalation-stuck-click-001 | FAIL | easy | 0.00 | 0.00 | 1.00 | 0.10 | 10333ms |
| escalation-wrong-input-001 | FAIL | medium | 0.00 | 1.00 | 1.00 | 0.40 | 23320ms |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 0% (0/2) | 0.300 |
| medium | 0% (0/3) | 0.300 |
| hard | 0% (0/1) | 0.000 |

## Phase Analysis

| Phase | Success Rate |
|-------|-------------|
| Phase 1: Escalation triggered | 0% (0/6) |
| Phase 2: Recovery tool match | 50% (3/6) |

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
- **Scores**: esc=0.00 tool=0.00 inv=0.50 comp=0.05
  - *(not judged)*

- **Fast model called**: xray_page({})
- **Smart model called**: done({"summary":"**Analysis of attempt log**:\n- T1 & T6: `find_element` for \"code\" returned no visible matches – the code is not in plain text.\n- T2: `find_element` located a hint element [6] with the text \"Hint: Sometimes things are hidden in plain sight.\"\n- T3: `read_element` confirmed the hint.\n- T4: Scrolled down 500 px but no new visible elements appeared, indicating the code is not revealed by scrolling.\n- T5: `find_element` for \"secret\" also failed – no visible occurrence.\n- T7: `read_element` on the instruction paragraph confirmed the task description.\n**Why these attempts failed**: The code is likely hidden via CSS (display:none, visibility:hidden, off‑screen positioning, zero opacity, etc.) or stored in a non‑text attribute. `find_element` only searches visible text, so hidden content is missed. Scrolling does not affect hidden elements.\n\n**Proposed investigation strategy** (different from prior attempts):\n1. **Reveal hidden DOM**: Call `xray_page()` to force all hidden elements (display:none, visibility:hidden, opacity:0, aria‑hidden, etc.) to become visible.\n2. **Refresh snapshot**: After X‑ray, call `read_page()` to get an updated view of the DOM.\n3. **Search for hidden code**:\n   - Use `find_element` with generic terms like \"code\", \"secret\", or a pattern (e.g., \"XXXX\") now that hidden text is visible.\n   - If still not found, call `inspect_hidden` with a loose pattern (e.g., \"[A-Z0-9]{4,}\" or simply no pattern) to list hidden elements that may contain alphanumeric strings.\n   - For each candidate element returned, use `read_element` (no attribute needed) to read its text content.\n4. **Submit the code**: Once the correct code string is identified, type it into the input field [4] using `type_text` and click the submit button [5].\n\n**Turn plan**:\n- **Turn 1**: Execute `xray_page()`.\n- **Turn 2**: Execute `read_page()` then either `find_element` for likely terms or `inspect_hidden` to locate the hidden code, followed by reading the candidate element(s).\n- **Turn 3** (if needed): Input the discovered code and submit.\n\nThis approach leverages hidden‑element inspection tools that have not been used yet, addressing the core obstacle that the code is concealed from normal visibility searches."})
- **Expected smart action**: inspect_hidden (or: xray_page, execute_js)

### escalation-hidden-002 — aria_label_code

- **Status**: fail
- **Scores**: esc=0.00 tool=1.00 inv=1.00 comp=0.45
  - *(not judged)*

- **Fast model called**: read_element({"id":2,"attribute":"aria-label"})
- **Smart model called**: read_element({"id":2,"attribute":"aria-label"})
- **Expected smart action**: read_element (or: inspect_hidden, xray_page, execute_js)

### escalation-scroll-001 — element_below_fold

- **Status**: fail
- **Scores**: esc=0.00 tool=1.00 inv=1.00 comp=0.50
  - *(not judged)*

- **Fast model called**: xray_page({})
- **Smart model called**: inspect_hidden({"pattern":"accept","maxResults":25})
- **Expected smart action**: execute_js (or: find_element, xray_page, inspect_hidden)

### escalation-stuck-click-001 — click_intercepted_overlay

- **Status**: fail
- **Scores**: esc=0.00 tool=0.00 inv=1.00 comp=0.10
  - *(not judged)*

- **Fast model called**: click_element({"id":4})
- **Smart model called**: read_element({"id":3})
- **Expected smart action**: dismiss_overlays (or: hide_element, click_element)

### escalation-wrong-input-001 — typing_wrong_field

- **Status**: fail
- **Scores**: esc=0.00 tool=1.00 inv=1.00 comp=0.40
  - *(not judged)*

- **Fast model called**: type_text({"id":4,"text":"user@test.com"})
- **Smart model called**: read_element({"id":4,"attribute":"placeholder"})
- **Expected smart action**: find_element (or: read_page, read_element)

## Prompt Recommendations

No specific recommendations — all cases passed or no judge was run.
