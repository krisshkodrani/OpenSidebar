# Grounding Eval Report

Generated: 2026-03-02T11:21:48.493Z
Model: openai/gpt-oss-120b

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 8 |
| Pass rate | 100.0% (8/8) |
| Failed | 0 |
| Errors | 0 |
| Avg mismatch detection | 0.000 |
| Avg observe first | 1.000 |
| Avg trap avoidance | 1.000 |
| Avg strategy novelty | 1.000 |
| Avg tool correctness | 0.750 |
| Avg composite | 0.889 |

## Per-Case Results

| Case | Status | Difficulty | Mismatch | Observe | Trap | Novelty | Tool | Composite | Latency |
|------|--------|------------|----------|---------|------|---------|------|-----------|---------|
| grounding-blind-001 | PASS | easy | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1052ms |
| grounding-blind-002 | PASS | medium | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 390ms |
| grounding-flailing-001 | PASS | medium | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1037ms |
| grounding-flailing-002 | PASS | hard | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 | 0.86 | 394ms |
| grounding-mismatch-001 | PASS | hard | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.70 | 637ms |
| grounding-mismatch-002 | PASS | medium | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.70 | 916ms |
| grounding-noise-001 | PASS | medium | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 530ms |
| grounding-noise-002 | PASS | hard | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 | 0.86 | 561ms |

## Scenario Analysis

| Scenario | Pass Rate | Avg Composite |
|----------|-----------|---------------|
| blind_first_action | 100% (2/2) | 1.000 |
| decoy_noise | 100% (2/2) | 0.929 |
| flailing | 100% (2/2) | 0.929 |
| instruction_mismatch | 100% (2/2) | 0.700 |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 100% (1/1) | 1.000 |
| medium | 100% (4/4) | 0.925 |
| hard | 100% (3/3) | 0.805 |

## Failed Cases

No failures.

## Prompt Recommendations

1. **[LOW]** (1x) Instruct the agent to always start with read_page or equivalent to get a full overview before targeting specific elements, especially on the first action.
2. **[LOW]** (1x) No significant fix needed. The agent demonstrated good grounding behavior by reading the page before acting.
3. **[LOW]** (1x) Consider adding guidance that when click_element is intercepted by a covering element, the agent should try click_coordinates to bypass the element ID system and click at the actual screen coordinates instead.
4. **[LOW]** (1x) Warn the agent that inspect_hidden is a trap action and should be avoided. Encourage the agent to try broader page scanning tools like xray_page or read_page before resorting to element-specific inspection tools.
5. **[LOW]** (1x) No fix needed - the agent handled this perfectly. The prompt already encourages detecting contradictions between instructions and page state.
6. **[LOW]** (1x) Encourage the agent to explicitly verbalize when it detects a mismatch between the instruction and the current page state, and to use clarify tool when the required UI elements are not present on the current page.
7. **[LOW]** (1x) Consider clarifying whether the agent should prioritize reading/inspecting the page before clicking, or if it should follow the visible instructions directly (e.g., 'click here 2 more times').
8. **[LOW]** (1x) Consider clarifying whether read_page is an acceptable first action equivalent to find_element, or if scroll_page should be preferred when content is described as being 'at the bottom of the page'.
