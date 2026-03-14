# Evals Program

This guide covers the current eval surface used to track OpenSidebar quality.

## Main Tracks

- critique evals: action selection and runtime decision quality
- recovery critique: guarded multi-turn recovery behavior
- perception evals: screenshot and page-state interpretation quality
- live benchmark summaries: aggregate signals from recorded traces

## Baseline Commands

```bash
npm run ci:evals:offline
npx tsx evals/cli.ts perception-validate
npm run evals:critique
npm run evals:perception
```

CI-safe commands:

- `npm run ci:evals:offline`
- `npx tsx evals/cli.ts perception-validate`

## Perception Workflow

1. Validate the perception dataset.
2. Run the perception suite.
3. Compare against the frozen baseline.

```bash
npx tsx evals/cli.ts perception-validate
npm run evals:perception
```

Current frozen baseline:

- model: `x-ai/grok-4.1-fast`
- harness: corrected v6 production-aligned contract
- result: `18/20` pass

The current perception contract is:

- `LOCATION`
- `CHANGES`
- `BLOCKERS`
- `VISUAL-ONLY`
- `AFFORDANCES`

## Action Critique Workflow

```bash
npm run evals:critique
npx tsx evals/cli.ts critique-recovery --tag <pathology>
npx tsx evals/cli.ts live-benchmark --localhost --limit 20
```

Use critique evals when changing:

- executor prompts
- planner prompts
- tool-profile policies
- recovery and anti-loop logic
- post-action verification behavior

## Operating Rules

- Prefer offline validation in CI.
- Treat online evals as opt-in gates when provider credentials are present.
- Validate fixtures before comparing score movement.
- Do not compare current perception scores to legacy pre-v6 reports.
- Prefer large, obvious wins over tiny deltas when judging prompt or model changes.

## Artifacts

- `evals/golden/`: checked-in fixture data
- `evals/results/`: raw run outputs
- `evals/reports/`: markdown reports
- `traces/`: live session traces used for extraction and benchmarking

## Related Docs

- [Evals README](../../evals/README.md)
- [Manual Evals Runbook](./manual-evals-runbook.md)
- [Perception Layer](../architecture/perception-layer.md)
