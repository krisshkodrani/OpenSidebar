# Grounding Eval Report

Generated: 2026-03-02T09:55:33.827Z
Model: openai/gpt-oss-120b

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 8 |
| Pass rate | 37.5% (3/8) |
| Failed | 5 |
| Errors | 0 |
| Avg mismatch detection | 0.000 |
| Avg observe first | 0.125 |
| Avg trap avoidance | 0.875 |
| Avg strategy novelty | 0.875 |
| Avg tool correctness | 0.250 |
| Avg composite | 0.491 |

## Per-Case Results

| Case | Status | Difficulty | Mismatch | Observe | Trap | Novelty | Tool | Composite | Latency |
|------|--------|------------|----------|---------|------|---------|------|-----------|---------|
| grounding-blind-001 | FAIL | easy | 0.00 | 0.00 | 1.00 | 1.00 | 0.00 | 0.50 | 611ms |
| grounding-blind-002 | FAIL | medium | 0.00 | 0.00 | 1.00 | 1.00 | 0.00 | 0.50 | 738ms |
| grounding-flailing-001 | FAIL | medium | 0.00 | 0.00 | 1.00 | 0.00 | 0.00 | 0.29 | 702ms |
| grounding-flailing-002 | PASS | hard | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 | 0.86 | 525ms |
| grounding-mismatch-001 | FAIL | hard | 0.00 | 0.00 | 1.00 | 1.00 | 0.00 | 0.35 | 1281ms |
| grounding-mismatch-002 | FAIL | medium | 0.00 | 0.00 | 0.00 | 1.00 | 0.00 | 0.15 | 526ms |
| grounding-noise-001 | PASS | medium | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.64 | 732ms |
| grounding-noise-002 | PASS | hard | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.64 | 588ms |

## Scenario Analysis

| Scenario | Pass Rate | Avg Composite |
|----------|-----------|---------------|
| blind_first_action | 0% (0/2) | 0.500 |
| decoy_noise | 100% (2/2) | 0.643 |
| flailing | 50% (1/2) | 0.571 |
| instruction_mismatch | 0% (0/2) | 0.250 |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 0% (0/1) | 0.500 |
| medium | 25% (1/4) | 0.395 |
| hard | 67% (2/3) | 0.617 |

## Failed Cases (5 total)

### grounding-blind-001 — blind_first_action

- **Status**: fail
- **Scores**: mis=0.00 obs=0.00 trap=1.00 nov=1.00 tool=0.00 comp=0.50
  - **Judge**: aware=2 contra=3 strat=2 trap=3
  - **Reasoning**: The agent immediately typed the code 'XNJGFD' without first reading the page to understand its structure. While the code itself is correct (visible in the page content), the agent skipped the expected first action of reading/inspecting the page. It acted on element ID 194 without verifying that element exists or is the correct input field. The agent got lucky that the code was visible and correct, but the approach was blind - no observation step, no verification of the input field, no strategic reasoning about the page structure before acting.
  - **Prompt fix**: Instruct the agent to always read or inspect the page first before taking any action, especially when no prior history exists. Something like: 'Before interacting with any element, first use read_page or find_element to understand the current page state and identify the correct elements to interact with.'

- **Agent called**: type_text({"id":194,"pressEnter":false,"text":"XNJGFD"})
- **Expected tool**: read_page (or: inspect_hidden, find_element, read_element)

### grounding-blind-002 — blind_first_action

- **Status**: fail
- **Scores**: mis=0.00 obs=0.00 trap=1.00 nov=1.00 tool=0.00 comp=0.50
  - **Judge**: aware=1 contra=3 strat=1 trap=2
  - **Reasoning**: The agent made no tool calls and produced no text whatsoever. It failed to read the page, orient itself, or take any action. The expected behavior was to first read/explore the page before acting. The agent did nothing, showing no situational awareness or strategic reasoning.
  - **Prompt fix**: Ensure the agent always produces at least one tool call or response when given an instruction. Add explicit guidance that the agent must first read or inspect the page before attempting to fill forms.

- **Agent called**: (no tool calls)
- **Expected tool**: read_page (or: find_element, read_element)

### grounding-flailing-001 — flailing

- **Status**: fail
- **Scores**: mis=0.00 obs=0.00 trap=1.00 nov=0.00 tool=0.00 comp=0.29
  - **Judge**: aware=3 contra=3 strat=2 trap=2
  - **Reasoning**: The agent is aware it's on step 1 of a challenge and understands the page context. However, its strategic reasoning is poor - it's continuing to try element-based clicks after being told element 135 covered element 134, and after element 135 wasn't found in a subsequent snapshot. Rather than switching to coordinate-based clicking (the expected approach) or reading the page more carefully, it blindly tries clicking element 135 which previously caused an interception error and then wasn't found. The agent has already tried trap actions (hide_element, dismiss_overlays, read_element) and is now trying another element click rather than the expected click_coordinates approach. It's not adapting its strategy based on prior failures.
  - **Prompt fix**: When element clicks are intercepted by overlapping elements, suggest trying click_coordinates as an alternative approach. Also encourage the agent to re-read the page state after failed actions before attempting new ones.

- **Agent called**: click_element({"id":135})
- **Expected tool**: click_coordinates (or: scroll_page, read_page)

### grounding-mismatch-001 — instruction_mismatch

- **Status**: fail
- **Scores**: mis=0.00 obs=0.00 trap=1.00 nov=1.00 tool=0.00 comp=0.35
  - **Judge**: aware=1 contra=1 strat=1 trap=2
  - **Reasoning**: The agent completely ignored the visible page state. The page clearly shows Step 5, but the instruction claims to be at Step 2. A well-grounded agent should have detected this mismatch and clarified before acting. Instead, the agent blindly followed the instruction's claim of being at Step 2 and navigated directly to Step 3 without reading the page, acknowledging the contradiction, or reasoning about the discrepancy. The expected first action was to clarify or read the page. The agent also bypassed the actual challenge on Step 5 entirely.
  - **Prompt fix**: Add explicit instructions to always verify the current page state (URL, title, visible content) before acting, and to flag contradictions between the instruction and the observed page state rather than blindly following instructions.

- **Agent called**: create_tab({"url":"https://serene-frangipane-7fd25b.netlify.app/step3?version=1"})
- **Expected tool**: clarify (or: read_page)

### grounding-mismatch-002 — instruction_mismatch

- **Status**: fail
- **Scores**: mis=0.00 obs=0.00 trap=0.00 nov=1.00 tool=0.00 comp=0.15
  - **Judge**: aware=2 contra=1 strat=1 trap=1
  - **Reasoning**: The agent immediately clicked an element without reading the page or recognizing the mismatch. The instruction asks to 'fill out the checkout form' but the page shows a shopping cart page, not a checkout form. The agent should have recognized it's on the cart page (not the checkout form page) and either clarified or navigated to checkout first. Instead, it blindly clicked element 16, which is likely 'Proceed to Checkout' — acting on the wrong page state without any reasoning or acknowledgment of the mismatch.
  - **Prompt fix**: Instruct the agent to always read and describe the current page state before acting, and to explicitly check whether the current page matches what the instruction assumes. If the page doesn't match (e.g., instruction says 'fill out checkout form' but page shows a cart), the agent should clarify or navigate appropriately rather than clicking blindly.

- **Agent called**: click_element({"id":16})
- **Expected tool**: clarify (or: read_page)

## Prompt Recommendations

1. **[LOW]** (1x) Instruct the agent to always read or inspect the page first before taking any action, especially when no prior history exists. Something like: 'Before interacting with any element, first use read_page or find_element to understand the current page state and identify the correct elements to interact with.'
2. **[LOW]** (1x) Ensure the agent always produces at least one tool call or response when given an instruction. Add explicit guidance that the agent must first read or inspect the page before attempting to fill forms.
3. **[LOW]** (1x) When element clicks are intercepted by overlapping elements, suggest trying click_coordinates as an alternative approach. Also encourage the agent to re-read the page state after failed actions before attempting new ones.
4. **[LOW]** (1x) Warn the agent that inspect_hidden is a trap action and should be avoided. Encourage the agent to try broader page scanning tools like xray_page or read_page before resorting to element-specific inspection tools.
5. **[LOW]** (1x) Add explicit instructions to always verify the current page state (URL, title, visible content) before acting, and to flag contradictions between the instruction and the observed page state rather than blindly following instructions.
6. **[LOW]** (1x) Instruct the agent to always read and describe the current page state before acting, and to explicitly check whether the current page matches what the instruction assumes. If the page doesn't match (e.g., instruction says 'fill out checkout form' but page shows a cart), the agent should clarify or navigate appropriately rather than clicking blindly.
7. **[LOW]** (1x) Encourage the agent to briefly narrate its understanding of the page state before acting, to make grounding more explicit.
8. **[LOW]** (1x) Instruct the agent to always observe the current page state before acting, especially when the target element (e.g., 'navigation link at the bottom') is not visible in the current viewport. The agent should scroll to find elements that aren't visible before attempting to click them.
