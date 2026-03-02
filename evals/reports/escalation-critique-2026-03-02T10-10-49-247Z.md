# Escalation Eval Report

Generated: 2026-03-02T10:10:49.247Z
Planner model: deepseek-v3.2

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 6 |
| Pass rate | 83.3% (5/6) |
| Failed | 1 |
| Errors | 0 |
| Avg escalation triggered | 1.000 |
| Avg reason quality | 1.000 |
| Avg tool match | 0.833 |
| Avg args match | 0.417 |
| Avg investigation quality | 0.833 |
| Avg composite | 0.875 |

## Per-Case Results

| Case | Status | Difficulty | Escalation | Tool Match | Investigation | Composite | Latency |
|------|--------|------------|------------|------------|---------------|-----------|---------|
| escalation-complex-001 | PASS | hard | 1.00 | 1.00 | 1.00 | 0.90 | 21218ms |
| escalation-hidden-001 | PASS | medium | 1.00 | 1.00 | 1.00 | 1.00 | 10129ms |
| escalation-hidden-002 | PASS | medium | 1.00 | 1.00 | 1.00 | 0.95 | 5887ms |
| escalation-scroll-001 | PASS | easy | 1.00 | 1.00 | 1.00 | 1.00 | 7621ms |
| escalation-stuck-click-001 | FAIL | easy | 1.00 | 0.00 | 0.00 | 0.50 | 10212ms |
| escalation-wrong-input-001 | PASS | medium | 1.00 | 1.00 | 1.00 | 0.90 | 14769ms |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 50% (1/2) | 0.750 |
| medium | 100% (3/3) | 0.950 |
| hard | 100% (1/1) | 0.900 |

## Phase Analysis

| Phase | Success Rate |
|-------|-------------|
| Phase 1: Escalation triggered | 100% (6/6) |
| Phase 2: Recovery tool match | 83% (5/6) |

## Failed Cases (1 total)

### escalation-stuck-click-001 — click_intercepted_overlay

- **Status**: fail
- **Scores**: esc=1.00 tool=0.00 inv=0.00 comp=0.50
  - **Judge**: stuck=5 shift=2 depth=1 context=3
  - **Reasoning**: The executor model correctly recognized it was stuck after 4 failed click attempts with scrolling not helping, and appropriately escalated with a clear explanation. However, the planner model failed to actually execute any tool calls - it only produced thinking text about what it would do (dismiss the overlay/click close button) but never called any tools like dismiss_overlays, hide_element, or click_element on the overlay's close button. The planner identified the correct strategy (dismissing the cookie banner overlay) but didn't follow through with any investigation or action tools.
  - **Prompt fix**: The planner model prompt should emphasize that it MUST make tool calls and not just think/reason. Add explicit instruction: 'After analyzing the situation, you MUST call at least one tool to attempt recovery. Thinking alone is insufficient - always follow your analysis with a concrete tool call.'

- **Executor model called**: escalate({"reason":"Attempted to click the 'Place Order' button (element [2]) but each click was intercepted by an overlay element. Tried scrolling up and down to change position, but overlay persisted and still blocked the button. No other visible elements to dismiss the overlay were identified. Unable to bypass the overlay with available tools, leading to repeated click interception."})
- **Planner model called**: (no tool calls)
- **Expected planner action**: click_element (or: dismiss_overlays, hide_element)

## Prompt Recommendations

1. **[LOW]** (1x) The planner should be prompted to first reason through the decoding mathematically/logically before taking any tool actions. In this case, the cipher table was already available in the context (ROT13: A=N, B=O... meaning reverse: N=A, G=T, U=H, V=I, F=S), so the planner should compute the answer directly and proceed to type_text with 'THIS IS THE CODE' rather than re-reading the page.
2. **[LOW]** (1x) Consider adding guidance to the executor prompt to try inspect_hidden or xray_page before escalating when the task explicitly mentions hidden elements, to reduce unnecessary escalations on medium-difficulty tasks.
3. **[LOW]** (1x) Consider adding 'inspect ARIA attributes' as an explicit tool hint in the executor's available tools description, so it can attempt this before escalating on accessibility-related hints.
4. **[LOW]** (1x) When elements are suspected to be dynamically loaded or hidden (as noted in the escalation reason), the planner should be prompted to prioritize execute_js or inspect_hidden tools over passive read_page, since those tools can reveal hidden DOM elements and trigger dynamic content loading.
5. **[LOW]** (1x) The planner model prompt should emphasize that it MUST make tool calls and not just think/reason. Add explicit instruction: 'After analyzing the situation, you MUST call at least one tool to attempt recovery. Thinking alone is insufficient - always follow your analysis with a concrete tool call.'
6. **[LOW]** (1x) Consider adding guidance to the executor to use read_element or read_page before typing into form fields to verify field labels/types match the intended input.
