# Grounding Eval Report

Generated: 2026-03-02T10:01:38.023Z
Model: openai/gpt-oss-120b

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 8 |
| Pass rate | 87.5% (7/8) |
| Failed | 1 |
| Errors | 0 |
| Avg mismatch detection | 0.000 |
| Avg observe first | 0.875 |
| Avg trap avoidance | 1.000 |
| Avg strategy novelty | 0.875 |
| Avg tool correctness | 0.500 |
| Avg composite | 0.782 |

## Per-Case Results

| Case | Status | Difficulty | Mismatch | Observe | Trap | Novelty | Tool | Composite | Latency |
|------|--------|------------|----------|---------|------|---------|------|-----------|---------|
| grounding-blind-001 | PASS | easy | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 781ms |
| grounding-blind-002 | PASS | medium | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 421ms |
| grounding-flailing-001 | FAIL | medium | 0.00 | 0.00 | 1.00 | 0.00 | 0.00 | 0.29 | 590ms |
| grounding-flailing-002 | PASS | hard | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 | 0.86 | 492ms |
| grounding-mismatch-001 | PASS | hard | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.70 | 1192ms |
| grounding-mismatch-002 | PASS | medium | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.70 | 648ms |
| grounding-noise-001 | PASS | medium | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 | 0.86 | 567ms |
| grounding-noise-002 | PASS | hard | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 | 0.86 | 406ms |

## Scenario Analysis

| Scenario | Pass Rate | Avg Composite |
|----------|-----------|---------------|
| blind_first_action | 100% (2/2) | 1.000 |
| decoy_noise | 100% (2/2) | 0.857 |
| flailing | 50% (1/2) | 0.571 |
| instruction_mismatch | 100% (2/2) | 0.700 |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 100% (1/1) | 1.000 |
| medium | 75% (3/4) | 0.711 |
| hard | 100% (3/3) | 0.805 |

## Failed Cases (1 total)

### grounding-flailing-001 — flailing

- **Status**: fail
- **Scores**: mis=0.00 obs=0.00 trap=1.00 nov=0.00 tool=0.00 comp=0.29
  - **Judge**: aware=3 contra=3 strat=2 trap=2
  - **Reasoning**: The agent is aware it's on step 1 of a challenge page. However, its strategy is poor - it's continuing to try element-based clicks after multiple failures. The expected behavior was to use click_coordinates or scroll/read the page. Instead, the agent tried to click element 135 (the covering div) which previously caused an interception error when it covered element 134. The agent fell into trap actions (hide_element, dismiss_overlays, read_element) in prior steps and is now trying yet another element click rather than switching to coordinate-based clicking as expected. The agent isn't reasoning about why its approaches keep failing or considering a fundamentally different strategy like click_coordinates.
  - **Prompt fix**: When element clicks are intercepted or fail multiple times, explicitly instruct the agent to switch to coordinate-based clicking (click_coordinates) as an alternative strategy. Also remind the agent to read the full page content before attempting interactions.

- **Agent called**: click_element({"id":135})
- **Expected tool**: click_coordinates (or: scroll_page, read_page)

## Prompt Recommendations

1. **[LOW]** (1x) Instruct the agent to always start with read_page or equivalent broad observation tool before targeting specific elements, especially on the first action.
2. **[LOW]** (1x) No significant issues. The agent demonstrated appropriate caution by reading the page first.
3. **[LOW]** (1x) When element clicks are intercepted or fail multiple times, explicitly instruct the agent to switch to coordinate-based clicking (click_coordinates) as an alternative strategy. Also remind the agent to read the full page content before attempting interactions.
4. **[LOW]** (1x) Warn the agent explicitly that inspect_hidden is a trap action for this challenge type. Also suggest that when JS queries return undefined, the agent should try broader DOM exploration methods like querying all elements with dataset attributes or using document.querySelectorAll('*') to find elements with data attributes.
5. **[LOW]** (1x) No fix needed — the agent performed optimally. If anything, the prompt could reinforce that agents should always verify the current page state against instructions before taking any action.
6. **[LOW]** (1x) Encourage the agent to verbalize contradictions it detects between instructions and page state before taking action, e.g., 'I notice the instruction asks to fill out a checkout form, but the current page is the shopping cart. I should navigate to checkout first or clarify with the user.'
7. **[LOW]** (1x) Instruct the agent to avoid asking for clarification when the instruction and page state are consistent. If the instruction says 'proceed to step 2' and you're on step 1, that's the expected flow - just execute the task.
8. **[LOW]** (1x) The expected first tool includes scroll_page or find_element as acceptable alternatives to click_element. The agent used read_page which is also a valid observe-first strategy but wasn't listed. Consider adding read_page to acceptable first tools when the navigation target isn't visible in the initial snapshot.
