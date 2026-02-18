# Evals Program For Prompt Quality

This guide defines an eval program aligned with the current orchestrator roadmap and provides a repeatable loop for improving prompt quality.

## Tracks

Use six tracks that map directly to current architecture work:

1. `orchestrator_lane_isolation`
2. `verifier_critic`
3. `human_escalation`
4. `budget_and_termination`
5. `checkpoint_resume`
6. `core_task_success`
7. `conversation_collaboration` — structured evidence, cross-role reflexion, pre-flight review, advocate triad, retrospective

## Case Schema

`EvalCase` now supports `promptQuality` metadata:

- `promptVersion`
- `track`
- `expectedPlanShape`
- `expectedLaneEvents`
- `expectedEscalation`
- `expectedVerifierDecision`
- `mustNot`
- `notes`

Legacy cases continue to run because the section is optional.

## CLI Workflow

Manual-first recommended order:

1. `bun run logs`
2. Run manual task in extension
3. `bun run traces:list`
4. `bun run evals convert <session-id> --strategy all`
5. `bun run evals run --all --prompt-id orchestrator.verifier.system`
6. `bun run evals critique`

1. Convert traces to cases:

```bash
bun run evals convert <session-id> --strategy all
```

2. Run baseline:

```bash
bun run evals run --all
```

3. Run candidate prompt:

```bash
bun run evals run --all --prompt-file prompts/candidate.txt --prompt-variant candidate
```

Or run against shared production prompts:

```bash
bun run evals run --all --prompt-id orchestrator.verifier.system --prompt-variant baseline
```

4. Run A/B directly:

```bash
bun run evals ab --prompt-a prompts/baseline.txt --prompt-b prompts/candidate.txt --all
```

Mixed-source A/B is supported:

```bash
bun run evals ab --prompt-id-a orchestrator.verifier.system --prompt-b prompts/candidate.txt --all
```

5. Analyze failure clusters:

```bash
bun run evals analyze
```

6. Generate AI-readable critique artifacts:

```bash
bun run evals critique
```

See the strict operator checklist in:
- `docs/guides/manual-evals-runbook.md`

## Scoring

The runner emits:

- `toolNameMatch`
- `toolParamMatch`
- `sequenceMatch`
- `composite` (weighted aggregate)

A/B winner logic prioritizes:

1. status (`pass` > `fail` > `error`)
2. composite score

## Run-Trace Signals To Watch

Use run traces (`traces/runs/<run-id>.jsonl`) to track behavior changes, especially for skill replay:

- `task_completed`
- `skill_replay_attempted`
- `skill_replay_selected`
- `skill_replay_miss`
- `skill_replay_dry_run_match`
- `skill_replay_outcome`

These are summarized in critique output so prompt changes can be tied to replay hit-rate, replay success/failure, and deltas in duration/tokens.

## Operating Cadence

1. Run full tracks weekly.
2. Pick top 1-2 failure clusters only.
3. Patch prompts.
4. Re-run A/B.
5. Promote only if no critical regressions and net win-rate improves.
