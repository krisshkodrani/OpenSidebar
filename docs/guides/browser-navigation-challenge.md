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
Complete every challenge task on this page. Click Start if present. For each task, read the instructions from the page text and execute immediately. After completing each task, click Next/Submit/Continue to advance. Keep going through all tasks — never call done until you reach a final completion or score screen.
```

**Why this works:** The system prompt already covers all tool usage rules (parallel calls, auto-focus, keyboard shortcuts, overlays, drag/drop, drawing, screenshots). The nudge/escalate system handles stalls automatically. A short, focused user prompt avoids wasting context budget.

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

## Iteration Log

Track each attempt here:

| Attempt | Tasks Completed | Failure Point | Root Cause | Fix Applied |
|---------|----------------|---------------|------------|-------------|
| | | | | |
