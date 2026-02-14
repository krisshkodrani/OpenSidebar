# Running the Browser Navigation Challenge

The [Browser Navigation Challenge](https://serene-frangipane-7fd25b.netlify.app/) is a 30-task timed benchmark for browser automation agents. Each task tests a different interaction pattern (clicking, typing, selecting, dragging, drawing, etc.) and the agent must complete all 30 within a 5-minute timer (~10s per task).

## Settings

Open the settings drawer and configure:

| Setting | Value | Why |
|---------|-------|-----|
| Max Turns | 500 | 30 tasks need headroom for retries and escalation |
| Show Element Tags | OFF | Visual overlays are a debugging aid — the LLM never sees them |
| Confirm Plan | OFF | Skips the plan confirmation step so the agent runs without pausing |
| Show Session Metrics | ON | Track token usage and cost across the run |

All other settings can stay at defaults. Memory and workspace can be left enabled — the agent may use `memory_add` to save strategies it discovers.

## Prompt

Paste this into the input area after navigating to the challenge URL:

```
You are on Step 1 of the 30-step Browser Navigation Challenge. For each step:
1. Use update_plan to track which step you're on and what needs to happen
2. Dismiss any modals/popups blocking the page (click Close/Dismiss/Accept buttons)
3. Find and reveal the hidden code (look for "Reveal Code" buttons, delayed reveals, hidden DOM elements)
4. Enter the code in the input field and click Submit Code
5. Verify the URL changed to the next step before continuing
If stuck for 5+ actions, take_screenshot and try execute_js to inspect hidden elements. Complete all 30 steps to win.
```

**Why this works:**
- **Explicit per-step workflow** prevents aimless loops — each step has a clear 5-action pattern
- **Calls out `update_plan`** — trace analysis shows runs that use `update_plan` consistently are 10x more efficient (23 turns vs 246)
- **"Verify URL changed"** prevents false progress detection — the agent sometimes thinks it advanced when it didn't
- **Tool hints** (`execute_js`, `take_screenshot`) for the hardest patterns (hidden DOM, delayed reveals)
- **"5+ actions" self-imposed stuck threshold** beats the system's default 6-turn detection, triggering self-correction earlier

## What to Expect

- The agent will auto-dismiss cookie banners and modals before starting.
- Tasks include: clicking buttons, filling forms, selecting dropdowns, drag-and-drop, drawing strokes, keyboard shortcuts, and reading page content.
- If the agent stalls on a task, the progress tracker nudges it after 6 unchanged turns, escalates to the smart model at 12, and gives up on that subtask after repeated failure.
- You can send a hint at any time via the input area (it switches to hint mode during a run).
- Pause/resume via the control bar if you need to intervene.

## Monitoring the Run

Start the log drain before the run so you can watch in real time:

```bash
bun run logs        # start log drain server (in a separate terminal)
bun run logs:tail   # tail live output
```

After the run, query logs for issues:

```bash
bun run logs:errors              # error-level entries only
bun run logs:query search "stuck" # search for stuck-related logs
bun run logs:query search "Redundant" # check for redundant action warnings
bun run logs:query search "filler"    # check for filler text detections
bun run logs:query stats          # summary statistics
```

## Debugging Failures

When a run fails or stalls, check logs for:

1. **Which task stalled?** — Look for repeated tool calls targeting the same elements
2. **Missing elements?** — Check element count in context metrics logs; if it drops to 0, the snapshot retry may have failed
3. **Wrong field targeted?** — Check if the label was present in the snapshot
4. **Modal blocked?** — Check `DISMISS_MODALS` count and whether the agent tried to dismiss manually
5. **Turn budget blown?** — Check turn count vs tasks completed ratio
6. **Timer expired?** — Check total elapsed time from first to last log entry
7. **Escalation triggered?** — Look for `switchModel` in logs; if the agent escalated, the fast model was stuck
8. **Redundant actions?** — Search for "Redundant action detected" to see where the agent looped on the same tool call
9. **Filler text?** — Search for "filler" to see text-only responses that were fast-tracked

## Trace Analysis (from 246-turn run)

Analysis of a real 246-turn session revealed systematic waste patterns:

### Pattern: Successful-but-Pointless Action Repetition (~50 turns wasted)
The agent called `find_element` with the same arguments 3-6 times in a row, getting the same result each time, but never acting on it:
```
Turn 82-84: find_element({"text":"Enter 6-character code"}) → OK, found [269] <form>  (3x)
Turn 87:    find_element({"text":"Enter 6-character code"}) → OK, found [269] <form>  (4th time!)
```
**Fix applied:** Redundant action detection ring buffer (window=6, threshold=3). Injects a corrective "ACT on what you found" message.

### Pattern: Low-Information Filler Text (~30 turns wasted)
The fast model emitted text-only responses like "I'm ready...", "We need to resolve the current step.", "We have..............." — with no tool calls and no useful reasoning.
**Fix applied:** Filler text fast-track. Responses under 60 chars, matching filler prefixes, or with >40% non-alphanumeric characters skip the normal 2-turn tolerance and immediately trigger a strategy pivot.

### Pattern: No Plan Tracking
The 246-turn run never called `update_plan`. A separate 23-turn run on the same challenge used `update_plan` 6 times and completed more efficiently.
**Fix applied:** The updated prompt explicitly instructs the agent to use `update_plan` for step tracking.

### Combined Impact
~80 turns out of 246 (33%) were wasted by these patterns. The redundant action detector and filler fast-track are expected to reduce waste by 20-30%.

## Iteration Log

Track each attempt here:

| Attempt | Tasks Completed | Turns Used | Failure Point | Root Cause | Fix Applied |
|---------|----------------|------------|---------------|------------|-------------|
| 1 | ~5/30 | 246 | Steps 3-5: repeated find_element loops, filler text | No plan tracking, no redundant action detection, filler tolerance too high | Added update_plan to prompt, redundant action detector, filler fast-track |
