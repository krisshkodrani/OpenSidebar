# Grounding Eval Report

Generated: 2026-03-01T18:25:36.405Z
Model: openai/gpt-oss-120b

## Summary

| Metric | Value |
|--------|-------|
| Total cases | 8 |
| Pass rate | 37.5% (3/8) |
| Failed | 5 |
| Errors | 0 |
| Avg mismatch detection | 0.000 |
| Avg observe first | 0.250 |
| Avg trap avoidance | 0.750 |
| Avg strategy novelty | 0.875 |
| Avg tool correctness | 0.250 |
| Avg composite | 0.497 |

## Per-Case Results

| Case | Status | Difficulty | Mismatch | Observe | Trap | Novelty | Tool | Composite | Latency |
|------|--------|------------|----------|---------|------|---------|------|-----------|---------|
| grounding-blind-001 | FAIL | easy | 0.00 | 0.00 | 1.00 | 1.00 | 0.00 | 0.50 | 684ms |
| grounding-blind-002 | FAIL | medium | 0.00 | 0.00 | 1.00 | 1.00 | 0.00 | 0.50 | 702ms |
| grounding-flailing-001 | FAIL | medium | 0.00 | 0.00 | 1.00 | 0.00 | 0.00 | 0.29 | 547ms |
| grounding-flailing-002 | PASS | hard | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 | 0.86 | 443ms |
| grounding-mismatch-001 | FAIL | hard | 0.00 | 1.00 | 0.00 | 1.00 | 0.00 | 0.40 | 1046ms |
| grounding-mismatch-002 | FAIL | medium | 0.00 | 0.00 | 0.00 | 1.00 | 0.00 | 0.15 | 595ms |
| grounding-noise-001 | PASS | medium | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.64 | 964ms |
| grounding-noise-002 | PASS | hard | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.64 | 400ms |

## Scenario Analysis

| Scenario | Pass Rate | Avg Composite |
|----------|-----------|---------------|
| blind_first_action | 0% (0/2) | 0.500 |
| decoy_noise | 100% (2/2) | 0.643 |
| flailing | 50% (1/2) | 0.571 |
| instruction_mismatch | 0% (0/2) | 0.275 |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 0% (0/1) | 0.500 |
| medium | 25% (1/4) | 0.395 |
| hard | 67% (2/3) | 0.633 |

## Failed Cases (5 total)

### grounding-blind-001 — blind_first_action

- **Status**: fail
- **Scores**: mis=0.00 obs=0.00 trap=1.00 nov=1.00 tool=0.00 comp=0.50
  - **Judge**: aware=2 contra=3 strat=1 trap=2
  - **Reasoning**: The agent immediately typed the code 'XNJGFD' without first reading the page to understand its structure, find the input field, or verify the context. While the code itself is correct (visible on the page), the agent skipped the expected first action of reading/inspecting the page. It acted blindly by directly typing into an element with ID 194 without any prior observation or reasoning about the page state. The agent got lucky that the code was correct, but the approach was blind action without situational awareness or strategic reasoning.
  - **Prompt fix**: Instruct the agent to always read or inspect the page first before taking any action, especially when no prior history exists. Add a rule like: 'Before interacting with any element, use read_page or find_element to understand the current page state.'

- **Agent called**: type_text({"id":194,"pressEnter":false,"text":"XNJGFD"})
- **Expected tool**: read_page (or: inspect_hidden, find_element, read_element)

### grounding-blind-002 — blind_first_action

- **Status**: fail
- **Scores**: mis=0.00 obs=0.00 trap=1.00 nov=1.00 tool=0.00 comp=0.50
  - **Judge**: aware=2 contra=3 strat=1 trap=2
  - **Reasoning**: The agent immediately typed text into element ID 32 without first reading the page to understand its structure. It didn't verify which field it was targeting, didn't check if there was actually a form with an email field, and didn't observe the page state before acting. The expected first action was read_page or find_element to understand the page layout. The agent blindly assumed element 32 is the email field without any verification. This is a classic 'blind first action' failure - acting without situational awareness.
  - **Prompt fix**: Add an explicit instruction to always read the page first before interacting with any elements. Something like: 'Before taking any action, always use read_page to understand the current page structure, identify the correct elements, and verify the page matches your expectations.'

- **Agent called**: type_text({"id":32,"pressEnter":false,"text":"john.doe@example.com"})
- **Expected tool**: read_page (or: find_element, read_element)

### grounding-flailing-001 — flailing

- **Status**: fail
- **Scores**: mis=0.00 obs=0.00 trap=1.00 nov=0.00 tool=0.00 comp=0.29
  - **Judge**: aware=3 contra=3 strat=2 trap=2
  - **Reasoning**: The agent is aware it's on step 1 of a challenge and understands the page context. However, its strategic reasoning is poor - it previously failed to click element 134 because it was covered by element 135, then tried to hide element 135 (which failed), then tried dismiss_overlays (which found nothing), then tried read_element (a trap action). Now it's trying to click element 135 directly, which is a reasonable pivot but comes after several failed/trap actions. The expected behavior was to use click_coordinates or scroll_page/read_page first. The agent has been flailing through trap actions (hide_element, dismiss_overlays, read_element) before arriving at this approach. The strategy of clicking the covering element (135) is somewhat logical given the interception message, but the path to get here involved multiple trap actions.
  - **Prompt fix**: When a click is intercepted by a covering element, suggest trying click_coordinates as the first alternative strategy rather than attempting to hide or dismiss the covering element. Also encourage reading the page content more carefully before acting.

- **Agent called**: click_element({"id":135})
- **Expected tool**: click_coordinates (or: scroll_page, read_page)

### grounding-mismatch-001 — instruction_mismatch

- **Status**: fail
- **Scores**: mis=0.00 obs=1.00 trap=0.00 nov=1.00 tool=0.00 comp=0.40
  - **Judge**: aware=1 contra=1 strat=2 trap=1
  - **Reasoning**: The instruction claims the agent is on step 2, but the page clearly shows step 5 (URL: /step5, title mentions step 5, content says 'You are on step 5'). The agent completely ignores this contradiction and proceeds to act as if the instruction is correct. Furthermore, the code (XNJGFD) is already visibly displayed on the page - there's no need to 'reveal' it or search the DOM. The agent uses inspect_hidden to search for a code that's already plainly visible, which is both unnecessary and one of the trap actions to avoid. The agent should have used clarify or read_page to note the mismatch between the instruction (step 2) and the actual page state (step 5), and should have recognized the code is already visible without needing DOM inspection.
  - **Prompt fix**: Add explicit instructions to always verify the current page state (URL, title, visible content) before acting, and to flag contradictions between the instruction and observed page state rather than proceeding blindly. Emphasize that if information is already visible on the page, no hidden inspection is needed.

- **Agent called**: inspect_hidden({"maxResults":10,"pattern":"XNJGFD"})
- **Expected tool**: clarify (or: read_page)

### grounding-mismatch-002 — instruction_mismatch

- **Status**: fail
- **Scores**: mis=0.00 obs=0.00 trap=0.00 nov=1.00 tool=0.00 comp=0.15
  - **Judge**: aware=2 contra=1 strat=1 trap=1
  - **Reasoning**: The agent completely failed to recognize the mismatch between the instruction (fill out checkout form) and the current page state (shopping cart page, not a checkout form). The page clearly shows a cart with items and a 'Proceed to Checkout' button, but no checkout form exists yet. The agent should have clarified or read the page to understand it's on the cart page, not the checkout form page. Instead, it blindly clicked an element (likely 'Proceed to Checkout'), which is a trap action. The agent showed no situational awareness, no contradiction handling, and no strategic reasoning before acting.
  - **Prompt fix**: Add explicit instructions to verify the current page state matches the task requirements before taking action. If the page doesn't show the expected content (e.g., a checkout form), the agent should use clarify or read_page first rather than attempting to navigate forward.

- **Agent called**: click_element({"id":16})
- **Expected tool**: clarify (or: read_page)

## Prompt Recommendations

1. **[LOW]** (1x) Instruct the agent to always read or inspect the page first before taking any action, especially when no prior history exists. Add a rule like: 'Before interacting with any element, use read_page or find_element to understand the current page state.'
2. **[LOW]** (1x) Add an explicit instruction to always read the page first before interacting with any elements. Something like: 'Before taking any action, always use read_page to understand the current page structure, identify the correct elements, and verify the page matches your expectations.'
3. **[LOW]** (1x) When a click is intercepted by a covering element, suggest trying click_coordinates as the first alternative strategy rather than attempting to hide or dismiss the covering element. Also encourage reading the page content more carefully before acting.
4. **[LOW]** (1x) Warn the agent that inspect_hidden is a trap action and should be avoided. Encourage the agent to try broader page scanning tools like xray_page or read_page before resorting to element-specific inspection tools.
5. **[LOW]** (1x) Add explicit instructions to always verify the current page state (URL, title, visible content) before acting, and to flag contradictions between the instruction and observed page state rather than proceeding blindly. Emphasize that if information is already visible on the page, no hidden inspection is needed.
6. **[LOW]** (1x) Add explicit instructions to verify the current page state matches the task requirements before taking action. If the page doesn't show the expected content (e.g., a checkout form), the agent should use clarify or read_page first rather than attempting to navigate forward.
7. **[LOW]** (1x) Consider encouraging the agent to first read/inspect the page content before acting, to ensure it identifies the correct element and understands the full context.
8. **[LOW]** (1x) Instruct the agent to always observe the current page state and scroll to verify element visibility before clicking, especially when the instruction references elements 'at the bottom of the page' that aren't visible in the current viewport.
