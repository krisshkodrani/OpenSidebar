# ISSUE-007: Repeated Tab-Management Attempts Still Consume Turns

Severity: Medium
Status: Open
Date identified: 2026-02-17
Updated: 2026-02-17 (confirmed by independent trace analysis)
Area: Agent planning/tool-selection under tab constraints

## Summary

The agent repeatedly attempts `create_tab`/`switch_tab` even when current task constraints require staying in the current tab. Policy blocks these actions correctly, but wasted turns still accumulate.

## Evidence

- `logs/opensidebar.jsonl`:
  - `create_tab blocked - not explicitly requested`: 8
  - `switch_tab blocked - not explicitly requested`: 8

## User-visible impact

- Extra turns with no task progress.
- Adds noise and latency in already long sessions.
- Contributes to perception of “distraction.”

## Root cause hypothesis

1. Planner/executor still infer multi-tab strategy from challenge ambiguity or prior failures.
2. Constraint memory is not strongly reinforced after blocked tab operations.
3. Block responses do not always trigger immediate strategy refocus.

## Why this is a real defect

Safety policy works, but intent control is still leaky. Repeated blocked actions are measurable inefficiency.

## Recommended fix direction

1. Strengthen post-block corrective prompt injection:
   - explicit "single-tab mode active" reinforcement.
2. Add short-term taboo memory for blocked tools in current node/step.
3. Penalize repeated blocked-tool proposals in tool selection policy.

## Acceptance criteria

1. Blocked tab-management attempts per run decrease materially.
2. After first block event, no immediate repeat of same blocked tool.
3. End-to-end turn count improves on single-tab challenge benchmarks.
