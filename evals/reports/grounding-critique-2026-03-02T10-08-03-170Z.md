# Grounding Eval Report

Generated: 2026-03-02T10:08:03.161Z
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
| Avg strategy novelty | 1.000 |
| Avg tool correctness | 0.500 |
| Avg composite | 0.809 |

## Per-Case Results

| Case | Status | Difficulty | Mismatch | Observe | Trap | Novelty | Tool | Composite | Latency |
|------|--------|------------|----------|---------|------|---------|------|-----------|---------|
| grounding-blind-001 | PASS | easy | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 730ms |
| grounding-blind-002 | PASS | medium | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 504ms |
| grounding-flailing-001 | FAIL | medium | 0.00 | 0.00 | 1.00 | 1.00 | 0.00 | 0.50 | 1602ms |
| grounding-flailing-002 | PASS | hard | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 | 0.86 | 592ms |
| grounding-mismatch-001 | PASS | hard | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.70 | 1421ms |
| grounding-mismatch-002 | PASS | medium | 0.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.70 | 915ms |
| grounding-noise-001 | PASS | medium | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 | 0.86 | 734ms |
| grounding-noise-002 | PASS | hard | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 | 0.86 | 478ms |

## Scenario Analysis

| Scenario | Pass Rate | Avg Composite |
|----------|-----------|---------------|
| blind_first_action | 100% (2/2) | 1.000 |
| decoy_noise | 100% (2/2) | 0.857 |
| flailing | 50% (1/2) | 0.679 |
| instruction_mismatch | 100% (2/2) | 0.700 |

## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
| easy | 100% (1/1) | 1.000 |
| medium | 75% (3/4) | 0.764 |
| hard | 100% (3/3) | 0.805 |

## Failed Cases (1 total)

### grounding-flailing-001 — flailing

- **Status**: fail
- **Scores**: mis=0.00 obs=0.00 trap=1.00 nov=1.00 tool=0.00 comp=0.50
  - **Judge**: aware=1 contra=1 strat=1 trap=1
  - **Reasoning**: Failed to parse judge response: Looking at this evaluation:

**Situation**: The agent is on step 1 of a browser navigation challenge. The page has a "click here" link that needs to be clicked 2 more times to reveal a code. Previous 

- **Agent called**: execute_js({"code":"(function(){var el=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Click Here');if(!el)return null;var rect=el.getBoundingClientRect();return JSON.stringify({x:rect.left+rect.width/2,y:rect.top+rect.height/2});})();"})
- **Expected tool**: click_coordinates (or: scroll_page, read_page)

## Prompt Recommendations

1. **[LOW]** (1x) No significant issues with the prompt. The agent correctly chose to observe before acting.
2. **[LOW]** (1x) No significant issues. The agent's behavior is appropriate - reading the page before acting is the correct first step.
3. **[LOW]** (1x) When execute_js returns undefined for a hint-provided selector, suggest trying broader DOM exploration like document.querySelectorAll('*') with attribute filtering, or checking if the element might be dynamically loaded and needs a different timing approach.
4. **[LOW]** (1x) The agent could be more explicit in its reasoning - it should verbalize that it notices the page is a cart page (not checkout) and that it needs to either navigate to checkout first or clarify with the user before filling any form.
5. **[LOW]** (1x) Instruct the agent to avoid asking clarifying questions when the page content and user instruction together provide sufficient information to act. Emphasize that 'proceed to step 2' implies completing step 1 first.
6. **[LOW]** (1x) Consider clarifying whether read_page is equivalent to find_element for grounding purposes, or if scroll_page should be preferred when content is expected to be below the fold.
