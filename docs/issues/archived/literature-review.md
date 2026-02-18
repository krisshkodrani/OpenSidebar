# OpenSidebar Literature Review and Best-Practice Mapping

Date: 2026-02-17
Scope: Research-backed mitigation patterns for issues `ISSUE-001` through `ISSUE-010`.

## Goal

Translate known best practices from agent research, browser automation practice, and reliability engineering into concrete implementation guidance for this codebase.

## Method

- Start from observed failures in `logs/opensidebar.jsonl` and `traces/*.jsonl`.
- Map each issue cluster to primary-source guidance.
- Define concrete code-level changes and measurable acceptance checks.

## Issue-to-Research Matrix

| Issue(s) | Best-practice pattern | Concrete implementation in OpenSidebar | Acceptance signal |
|---|---|---|---|
| `ISSUE-001`, `ISSUE-002`, `ISSUE-008` | Add explicit self-critique + short-horizon failure memory (Reflexion), and interleave reasoning/action (ReAct). | In `src/background/agent/loop.ts`, persist a compact `recentFailures` structure (last 8-12 actions + outcomes) and inject into prompt every turn. Add hard block for exact repeated tool+args after N attempts unless page state changed. | Redundant action warnings still possible, but repeated identical tool+args chains drop materially; fewer long single-step loops. |
| `ISSUE-001` | Prevent context quality collapse with structured summarization/compression and salience retention ("Lost in the Middle"). | In `src/background/agent/context.ts`, trigger compression by turn count and repeated-failure density, not token count only. Preserve a pinned "critical state" block (current step, last valid IDs, blocking condition, last successful action). | Compression mode transitions appear in long runs; prompt growth flattens after threshold; fewer late-run regressions. |
| `ISSUE-009` | Progress-gated controller policies (de-escalate based on observed recovery, not fixed turns). | In `src/background/agent/loop.ts` and `src/background/agent/constants.ts`, keep smart tier until progress predicate is true (URL change, new fingerprint, previously blocked control enabled) or safety cap reached. | Fewer rapid smart/fast oscillations; escalation overhead share decreases in trace timings. |
| `ISSUE-003`, `ISSUE-004`, `ISSUE-010` | Use resilient interaction semantics: actionability checks + locator re-resolution (Playwright model). | In `src/content/actions.ts`, validate actionability (visible, enabled, event-receiving, stable) before dispatch. For `hide_element`, walk ancestors to locate overlay container. For DnD, re-resolve IDs right before action. | Higher success rate for modal dismissal and DnD on modal-heavy pages; fewer stale-ID failures. |
| `ISSUE-003` (adjacent) | Robust text input via proper `InputEvent` dispatch (React/SPA controlled-input compatibility). | In `src/content/actions.ts` `type_text` handler, dispatch `InputEvent` with `data` and `inputType` properties instead of bare `Event("input")`. Use the native value setter trick (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set`) already implemented in `react_set_input` for all controlled inputs, not just React-detected ones. | Forms that use framework-controlled inputs accept programmatic text entry correctly; code submission works on SPA challenge pages. |
| `ISSUE-010` | Prioritized element selection over naive cap; dedupe low-value controls. | In `src/content/tagging.ts`, replace fixed first-50 with scored selection: high priority for task-relevant controls (`submit`, inputs, draggable/drop zones, recently referenced elements), collapse near-duplicate bait buttons. | Snapshot shows critical controls consistently even on dense pages; DnD/drop targets remain visible. |
| `ISSUE-005` | Channel health checks and automatic recovery for disconnected executors. | Add a pre-dispatch content-script ping and reinject path using `chrome.scripting.executeScript` when `Receiving end does not exist` is returned. | Bridge failures auto-recover in-run without manual reload; reduced hard-stop execution failures. |
| `ISSUE-006` | Reliability patterns: classify transient vs permanent errors, circuit-break permanent faults, bounded retries with jitter. | In `src/background/llm/client.ts`, classify 402/credit exhaustion as permanent-for-session provider disable. Keep transient 429/5xx on cooldown/backoff. Emit one user-facing provider-disabled event. | No repeated retries to a permanently exhausted provider in same session. |
| `ISSUE-007` | Constraint-aware planning with negative memory (taboo list for blocked actions). | After blocked tab tool calls in `src/background/tools`/planner path, persist short-lived taboo for same step and inject explicit single-tab constraint reminder. | Immediate repeats of blocked tab tools disappear; fewer wasted turns on policy-violating actions. |

## Explicit Work Item: Dead-End / Unsolvable-Step Detection

Given the finding that Step 20 may be intentionally unsolvable, and more generally that agents waste hundreds of turns when a step is blocked, add explicit dead-end detection as a first-class deliverable (not just a nice-to-have):

- **Trigger:** Same objective attempted N times (e.g., same tool+args pattern repeated 5x, or same submit action with no URL/state change 3x) with no observable state delta.
- **Action:** Switch to diagnostic mode — take screenshot, explain current state, enumerate alternative hypotheses, try fundamentally different approach (inspect page source, look for hidden elements, try different navigation path).
- **Exit:** If no progress after bounded diagnostics (e.g., 5 diagnostic turns), report blocked/unsolved state to user with evidence summary instead of looping. Include: what was tried, how many times, what the page shows, and a hypothesis about why it's not working.

Estimated effort: 1.5d. Tightly coupled with ISSUE-002 (loop detection).

Insertion points:

- `src/background/agent/progress.ts` (dead-end heuristics — extend snapshot fingerprinting to detect "same submit pattern with same result")
- `src/background/agent/loop.ts` (diagnostic pivot policy — when dead-end detected, inject diagnostic mode prompt and cap additional turns)

## Research Sources

Primary sources used for the mappings above:

1. ReAct: Synergizing Reasoning and Acting in Language Models  
   https://arxiv.org/abs/2210.03629
2. Reflexion: Language Agents with Verbal Reinforcement Learning  
   https://arxiv.org/abs/2303.11366
3. Lost in the Middle: How Language Models Use Long Contexts  
   https://arxiv.org/abs/2307.03172
4. WebArena: A Realistic Web Environment for Building Autonomous Agents  
   https://arxiv.org/abs/2307.13854
5. BrowserGym (benchmarking browser agents)  
   https://arxiv.org/abs/2412.05467
6. Playwright Locators (robust element targeting)  
   https://playwright.dev/docs/locators
7. Playwright Actionability (interaction preconditions)  
   https://playwright.dev/docs/actionability
8. Chrome Extensions Messaging  
   https://developer.chrome.com/docs/extensions/develop/concepts/messaging
9. Chrome `scripting` API  
   https://developer.chrome.com/docs/extensions/reference/api/scripting
10. Backoff + Jitter reliability guidance  
    https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/

## Execution Order Recommendation

1. `ISSUE-010` (dedup/overflow) + `ISSUE-003` + `ISSUE-005` + `ISSUE-006` + `type_text` fix (visibility, unblock, transport, provider, input reliability)
2. `ISSUE-001` + `ISSUE-002` (together — compression enables loop detection) + `ISSUE-010` (scored selection) + dead-end detection (policy/control-loop quality)
3. `ISSUE-009` + `ISSUE-008` + `ISSUE-007` (efficiency/polish)

This order reduces hard blockers first, stabilizes the LLM pipeline, then reduces loop waste.
