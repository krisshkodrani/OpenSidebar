# Computer Use Challenge

## Challenge
**URL:** https://serene-frangipane-7fd25b.netlify.app/
**Format:** 30 tasks, 5-minute timer (~10s/task budget)
**Goal:** Single prompt, agent loops until all tasks complete

## Settings (before running)

| Setting | Value | Why |
|---------|-------|-----|
| Speed Mode | ON | Parallel tool exec, batch snapshots, filtered tools |
| Max Turns | 500 | 30 tasks need headroom for retries |
| Show Element Tags | OFF | Pure visual overhead, LLM never sees them |

## Prompt (copy-paste this)

```
Complete every challenge task on this page. Click Start if present. For each task, read the instructions from the page text and execute immediately. After completing each task, click Next/Submit/Continue to advance. Keep going through all tasks — never call done until you reach a final completion or score screen.
```

> **Why so short?** The speed-mode system prompt (`SPEED_PROMPT_TEMPLATE` in `context.ts`) already covers all tool usage rules: parallel calls, `type_text` auto-focus + `pressEnter`, `hide_element` for overlays, `select_option`, `press_key`, `drag_and_drop`, `draw_stroke`, `take_screenshot` when stuck. The nudge system handles text-only responses automatically. Repeating tool instructions in the user message wastes the 1500-char viewport text budget and dilutes the task signal.

## Iteration Log

Track each attempt and what broke. Use `bun run logs:tail` during runs.

| Attempt | Tasks Completed | Failure Point | Root Cause | Fix Applied |
|---------|----------------|---------------|------------|-------------|
| 1       |                |               |            |             |

## Debugging Checklist

When a run fails, check logs for:
1. **Which task stalled?** — Look for repeated tool calls on same elements
2. **Missing elements?** — Check element count in context metrics logs
3. **Wrong field targeted?** — Check if label was present in snapshot
4. **Modal blocked?** — Check DISMISS_MODALS count and whether agent tried to dismiss manually
5. **Turn budget blown?** — Check turn count vs tasks completed ratio
6. **Timer expired?** — Check total elapsed time from first to last log entry
