# Manual Evals Runbook

Use this checklist to collect clean manual traces and turn them into eval artifacts without losing data.

## Pre-Flight (Do This First)

1. Open terminal at repo root.
2. Start log drain server:
   - `bun run logs`
3. In a second terminal, verify extension build is current:
   - `bun run build`
4. Reload extension in `chrome://extensions`.

## Manual Capture Flow

1. Perform one representative task in the side panel.
2. Wait for task completion (or explicit failure) before starting another run.
3. Keep `bun run logs` running for the whole session.

## Extract Artifacts

1. List recorded sessions:
   - `bun run traces:list`
2. Inspect session stats:
   - `bun run traces:stats`
3. Convert a session to eval cases:
   - `bun run evals convert <session-id> --strategy all`
4. Generate critique outputs:
   - `bun run evals critique`

Outputs:
- Logs: `logs/opensidebar.jsonl`
- Agent traces: `traces/<session-id>.jsonl`
- Orchestrator traces: `traces/runs/<run-id>.jsonl`
- Critique: `evals/reports/critique-<timestamp>.json` and `.md`

## Common Mistakes (And Fixes)

- Forgot `bun run logs`:
  - Use `Settings -> Export Logs` for buffered logs (`opensidebar-logs.jsonl`), then re-run with log server for full traces.
- Multiple tasks in one unclear session:
  - Re-run and keep one task per session for clean eval conversion.
- Converted wrong session:
  - Re-check with `bun run traces:list` and use the exact session id.
- Build mismatch after code changes:
  - Re-run `bun run build` and reload extension before capture.

## Minimal Quality Gate

Before sharing results, confirm:

1. `bun run lint` has no errors (warnings are acceptable if known).
2. `bun test` passes.
3. `bun run build` passes.
4. At least one new `traces/<session-id>.jsonl` exists for the run.
