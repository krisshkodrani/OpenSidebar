# E2E Performance Report — 2026-03-15

Full suite run: 4 test files, 6 test cases, 10 agent sessions, **all passing**.
Total wall-clock: **610s** (~10.2 min).

---

## Suite Summary

| Test File               | Tests | Wall-Clock | Result |
|-------------------------|-------|------------|--------|
| summarize.test.ts       | 1     | 44s        | PASS   |
| navigation-challenge.ts | 1     | 150s       | PASS   |
| online-shop.test.ts     | 1     | 96s        | PASS   |
| edge-cases.test.ts      | 3     | 245s       | PASS   |

---

## Per-Session Breakdown

Each test case spawns one or more agent sessions (planner decomposes tasks into subtask nodes).

| Session            | Turns | Duration | Prompt Tok | Compl Tok | Cost    | Outcome   | Models Used         |
|--------------------|-------|----------|------------|-----------|---------|-----------|---------------------|
| summarize          | 1     | 2.4s     | 2,949      | 90        | $0.0013 | completed | gpt-4.1-mini        |
| nav:advance        | 8     | 16.4s    | 26,824     | 384       | $0.0081 | completed | gpt-4.1-mini        |
| nav:type-code      | 7     | 15.7s    | 22,681     | 360       | $0.0070 | completed | gpt-4.1-mini        |
| nav:read-code      | 7     | 15.7s    | 17,283     | 228       | $0.0046 | stopped   | gpt-4.1-mini, m2.5  |
| online-shop        | 17    | 3.9m     | 97,624     | 2,050     | $0.0266 | completed | gpt-4.1-mini, m2.5  |
| edge:form          | 6     | 21.4s    | 20,128     | 374       | $0.0054 | completed | gpt-4.1-mini        |
| edge:delayed       | 1     | 17.6s    | 3,373      | 19        | $0.0014 | completed | gpt-4.1-mini        |
| edge:gen-report    | 2     | 44.4s    | 6,402      | 212       | $0.0029 | completed | gpt-4.1-mini        |
| edge:impossible    | 3     | 2.0m     | 9,600      | 254       | $0.0026 | completed | gpt-4.1-mini        |
| edge:submit-report | 4     | 2.1m     | 12,739     | 519       | $0.0043 | completed | gpt-4.1-mini        |
| **TOTALS**         | **56**|          | **219,603**| **4,490** |**$0.0642**|           |                     |

---

## LLM Latency Analysis

### Executor (openai/gpt-4.1-mini)

Across 40 executor turns:

| Metric        | Value   |
|---------------|---------|
| Avg latency   | 1,531ms |
| Median        | ~1,200ms|
| P95           | ~2,975ms|
| Max           | 3,735ms |
| Tokens/turn   | ~4,900 prompt, ~70 completion |

The executor is consistently fast — sub-3s for all turns. Average prompt is ~4.9K tokens with very tight completion output (~70 tokens). This reflects the tool-calling pattern: the LLM returns a structured tool call, not prose.

### Planner (minimax/minimax-m2.5)

Across 10 planner turns (online-shop session only):

| Metric        | Value     |
|---------------|-----------|
| Avg latency   | 16,203ms  |
| Median        | ~7,575ms  |
| P95           | ~101,251ms|
| Max           | 101,251ms |
| Tokens/turn   | ~6,307 prompt, ~160 completion |

**Critical outlier**: Turn 8 of the online-shop session took **101.3s** (1m 41s) for a single `click_element` call. This was the first planner turn after escalation — likely a cold-start or queuing delay on OpenRouter for MiniMax M2.5. Excluding this outlier, the planner averages **6,914ms** per turn.

---

## Tool Execution Performance

Tool execution is extremely fast since it runs locally in the content script:

| Metric          | Value |
|-----------------|-------|
| Avg tool exec   | ~20ms |
| Max tool exec   | ~79ms |
| Total tool time | ~752ms across all sessions |

Tool execution is negligible (<1%) of total latency. **Nearly all wall-clock time is LLM inference.**

---

## Tool Usage Profile

| Tool            | Count | % of Total |
|-----------------|-------|------------|
| done            | 16    | 28%        |
| click_element   | 12    | 21%        |
| read_page       | 9     | 16%        |
| read_element    | 7     | 12%        |
| type_text       | 7     | 12%        |
| scroll_page     | 2     | 4%         |
| find_element    | 1     | 2%         |
| escalate        | 2     | 4%         |

**`done` is the most-called tool** (28%). This is inflated by `done_rejected` events — the agent frequently attempts to call `done` prematurely, gets rejected, and must retry. See "Behavioral Flags" below.

---

## Behavioral Flags

Flags are runtime signals injected by the agent loop to correct LLM behavior:

| Flag                          | Count | Affected Sessions                    |
|-------------------------------|-------|--------------------------------------|
| `done_rejected`               | 10    | nav:advance, nav:type-code, edge:gen-report, edge:submit |
| `step_advanced_by_done_rejection` | 10 | Same as above                        |
| `blind_tool_call_nudge`       | 5     | nav:advance, nav:type-code, online-shop, edge:form |
| `action_effect`               | 14    | nav:advance, nav:type-code, online-shop, edge:form, edge:delayed |
| `escalation`                  | 2     | nav:read-code, online-shop           |
| `grounding_mismatch`          | 1     | online-shop                          |
| `step_watchdog_warn`          | 3     | nav:read-code, online-shop           |
| `zero_effect_warning`         | 1     | online-shop                          |

### Key observations

1. **`done_rejected` is the top issue.** The executor calls `done` before the step's success criteria are satisfied, the loop rejects it, and the agent must retry. This adds 2-3 wasted turns per affected session. In nav:type-code, `done` was called 3 times before being accepted. This is a prompt/training issue with gpt-4.1-mini — it terminates too eagerly on multi-step plans.

2. **`blind_tool_call_nudge`** fires when the LLM calls a tool without first reading the page state. This happens 5 times, mostly after DOM-modifying actions. The nudge forces a `read_page` before acting.

3. **Escalation pattern works.** Both escalations (nav:read-code, online-shop) successfully handed off to the planner, which resolved the stuck state. The online-shop escalation at T7 led to successful checkout completion by T17.

4. **`grounding_mismatch`** fired once when the executor's tool call targeted an element that didn't match its stated reasoning. The loop corrected this.

---

## Efficiency Metrics

| Metric                        | Value   |
|-------------------------------|---------|
| Turns per successful task     | 5.6 avg |
| Wasted turns (done_rejected)  | 10/56 = 18% |
| Escalation rate               | 2/10 sessions (20%) |
| Cost per test case            | $0.011 avg |
| LLM time as % of wall-clock  | ~95%    |
| Tool time as % of wall-clock  | <1%     |
| Overhead (perception, snapshot, planning) | ~4% |

---

## Per-Test Deep Dives

### Summarize (1 turn, 2.4s)
Optimal. Single `done` call with summary extracted from the DOM snapshot context. No tools needed beyond the implicit snapshot. Cost: $0.0013.

### Navigation Challenge (3 parallel sessions, ~16s each)
The planner decomposed into 3 parallel subtask nodes. Two completed, one (`read-code`) was stopped after the sibling sessions already finished the task. **Issue**: The `advance` session clicked the button only once in T1, then called `done` — rejected because the success criteria required 3 clicks. It took 8 turns to finish what should be 4-5 turns.

### Online Shop (17 turns, 3.9m)
The longest and most expensive session. Key bottleneck:
- **T1-T7 (executor)**: Clicked "Add to cart" but couldn't confirm the cart drawer appeared. Escalated at T7.
- **T8 (planner, 101s)**: Cold-start outlier. After this, the planner completed the remaining checkout steps (coupon, shipping, name, email, place order) in 9 turns.
- **Without the T8 outlier**, the session would have taken ~2.2m instead of 3.9m.

### Edge Cases
- **Form validation** (6 turns, 21s): Clean execution — type fields, click submit, verify confirmation. 3 `read_element` calls for verification were slightly redundant.
- **Delayed content** (1 turn, 17.6s): Optimal. Single click with async change detection. The 17.6s is mostly the fixture's built-in delay.
- **Impossible task** (3 sessions, ~2m each): The planner decomposed into 3 parallel nodes. Each independently determined the "Generate Report" button doesn't exist. While correct, running 3 parallel sessions to conclude "not possible" is heavier than needed.

---

## Recommendations

### High-impact

1. **Reduce `done_rejected` churn.** 18% of all turns are wasted retries. The executor prompt should reinforce: "Only call `done` when you have verified the success criteria on the current page, not when you believe the action was taken." This could save 2-3 turns per multi-step session.

2. **Investigate MiniMax M2.5 cold-start.** The 101s outlier on the first planner turn is 10x the subsequent average. Consider:
   - A warmup request on escalation
   - Switching to nitro mode for the first planner turn
   - Setting a timeout with automatic retry on a different provider

### Medium-impact

3. **Parallel subtask convergence.** When one parallel node completes the shared goal (e.g., nav challenge), cancel siblings earlier. The `nav:read-code` session ran 7 turns before being stopped, consuming tokens unnecessarily.

4. **Reduce verification over-read.** The `edge:form` session used 3 consecutive `read_element` calls to verify the form submission. A single `read_page` or checking the tool result from `click_element` would suffice.

### Low-impact

5. **Token budget.** Prompt tokens average ~4.9K per executor turn (DOM snapshot dominates). For simple pages like the summarize fixture, element-list compression could cut this further. Current compression levels are adequate for the test fixtures.

---

## Historical Comparison (all-time stats)

| Metric          | All-Time (226 sessions) | This Suite (10 sessions) |
|-----------------|------------------------|--------------------------|
| Completion rate | 68%                    | 90% (9/10)               |
| Avg turns       | 9.2                    | 5.6                      |
| Total cost      | $1.73                  | $0.064                   |
| Max turns hit   | 8%                     | 0%                       |
| Error rate      | 1%                     | 0%                       |

The suite shows improved efficiency vs. historical averages — fewer turns per task, higher completion rate, and zero errors or turn-limit hits.
