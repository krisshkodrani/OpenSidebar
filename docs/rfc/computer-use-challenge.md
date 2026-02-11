# Computer Use Challenge

## Challenge
**URL:** https://serene-frangipane-7fd25b.netlify.app/
**Format:** 30 tasks, 5-minute timer (~10s/task budget)
**Goal:** Single prompt, agent loops until all tasks complete

## Prompt

```
Complete all challenge tasks on this page. For each task: read the instruction, execute it immediately, then move to the next task. If there's a Start button, click it first. After completing each task, look for and click Next/Submit/Continue. Dismiss any modals or popups immediately. Fill all form fields in one step and press Enter to submit. Never stop until all tasks are done or you see a completion/score screen — then call done. If you cant solve it immediately, step back, dissmis modals, try to find a way to solve it.
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
