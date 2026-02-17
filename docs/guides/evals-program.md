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

## Scoring

The runner emits:

- `toolNameMatch`
- `toolParamMatch`
- `sequenceMatch`
- `composite` (weighted aggregate)

A/B winner logic prioritizes:

1. status (`pass` > `fail` > `error`)
2. composite score

## Operating Cadence

1. Run full tracks weekly.
2. Pick top 1-2 failure clusters only.
3. Patch prompts.
4. Re-run A/B.
5. Promote only if no critical regressions and net win-rate improves.
