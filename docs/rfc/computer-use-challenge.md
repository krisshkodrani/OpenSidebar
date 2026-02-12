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
Complete all challenge tasks on this page. For each task: read the instruction in the page text, execute it immediately, then move to the next. If there's a Start button, click it first. After each task, click Next/Submit/Continue to advance. Dismiss any modals/popups with hide_element. Fill all form fields in one turn and press Enter to submit. Never stop until all tasks are done or you see a completion/score screen — then call done. If stuck, scroll or read_page to find the task. If you can't solve it immediately, dismiss modals, step back, and try a different approach.
```

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
