# Browser Navigation Challenge

The Ultimate Test for Browser Automation - 30 steps of hidden codes, modals, and page transitions.

## Prompt

```
Complete all 30 steps of the Browser Navigation Challenge.

Each step follows this pattern:
1. Dismiss any blocking modals/popups (Close/Dismiss/Accept). Leave non-blocking ones alone.
2. Find the hidden code (look for "Reveal Code" buttons, delayed reveals, hidden elements, data-* attributes)
3. IMMEDIATELY type the code into the input field and click the Submit button (type="submit", usually green)
4. Verify the URL changed to the next step

CRITICAL: The page is full of DECOY buttons (white text on white background). IGNORE them.
Only click: Submit/Submit Code buttons (type="submit"), Reveal Code buttons, and modal dismiss buttons.
Once you find a code, act INSTANTLY — type it and submit. Do not explore further.
take_screenshot is SLOW (5-10s). Avoid it. Use read_page or find_element instead.

Do NOT call done() until all 30 steps are verified complete.
```

## Required Settings

| Setting | Value | Why |
|---------|-------|-----|
| **Max Turns** | **150+** | Each step needs ~3-5 tool calls. 30 steps x 4 avg = 120 turns minimum. Add buffer for retries. |
| **Context Window** | Default | Dynamic compression handles long sessions automatically. |
| **Confirm Plan** | Off | Adds a pause at the start that wastes challenge time. |
| **Element Tags** | On | Visual tags help verify which elements the agent is clicking. |

## How the Agent Handles It

### Guardian Decomposition

The guardian receives the prompt and decomposes it into **30 subtasks** (one per challenge step). Each subtask looks like:

```
Step 1: Find hidden code, enter it, submit
Step 2: Find hidden code, enter it, submit
...
Step 30: Find hidden code, enter it, submit, verify completion
```

### Repetitive Step Detection

When consecutive subtask descriptions match (differ only in step numbers), the step-transition system detects this and injects:

> "Same pattern as before -- apply it to the new page state. Read the page, act, verify."

Instead of the default message which says the previous approach "may not apply." This prevents the agent from re-discovering the pattern on every step.

### Progress Tracking

- `update_plan()` advances the step counter after each submission
- URL changes register as progress, preventing false stuck detection
- Step-transition clears history to stay within context limits (30 steps x ~5 tool calls would overflow)

## Common Failure Modes

| Failure | Cause | Fix |
|---------|-------|-----|
| Stops at step 8-10 | Max turns too low (default 30) | Set to 150+ |
| Stops at step 20 | Old MAX_SUBTASKS cap (fixed: now 30) | Update extension |
| Loops on same step | Hidden code uses delayed reveal or JS | Agent should try `take_screenshot` or `wait` |
| Clicks wrong button | Modal overlay blocks the real button | Agent should `hide_element` the overlay first |
| Skips verification | Rushed by urgency phrasing | Prompt says "verify URL changed" explicitly |

## Architecture Notes

Key constants that affect challenge performance (`src/background/agent/constants.ts`):

```
MAX_SUBTASKS: 30          -- Supports 30-step plans
STUCK_THRESHOLDS.NUDGE: 2 -- Nudge after 2 stale turns
STUCK_THRESHOLDS.PIVOT: 4 -- Strategy pivot after 4
REDUNDANT_ACTION.WINDOW: 8 -- Cleared on each step transition
```

The challenge exercises nearly every agent subsystem: guardian decomposition, step playbooks, progress tracking, stuck detection, modal auto-dismiss, element tagging, and potentially model escalation on tricky steps.
