# OpenSidebar Evals

Trace-based evaluation system for the OpenSidebar browser agent. The repo currently has two main eval tracks:

- critique and recovery evals for action selection
- perception evals for screenshot and page-state interpretation

## Quick Start

```bash
# Action-eval fixture validation
npm run evals:validate

# Perception fixture validation
npx tsx evals/cli.ts perception-validate

# Action critique suite
npm run evals:critique

# Perception suite
npm run evals:perception
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run evals:critique` | Replay action golden cases, judge with the critique rubric, and generate a report |
| `npm run evals:critique -- --tag <p>` | Critique filtered by pathology tag |
| `npx tsx evals/cli.ts critique-recovery --tag <p>` | Recovery-aware critique that replays up to 3 guarded turns |
| `npm run evals:perception` | Run the v6 perception eval suite against the current perception model |
| `npx tsx evals/cli.ts perception-validate` | Validate perception goldens before replay |
| `npx tsx evals/cli.ts live-benchmark --localhost --limit 20` | Summarize recorded live sessions from `traces/index.jsonl` |
| `npm run evals:validate` | Structural validation of critique golden cases |
| `npm run evals -- extract <id> <turn>` | Extract a critique golden case from a trace turn |
| `npm run evals -- help` | Show all CLI subcommands |

## Perception Evals

Perception evals replay screenshot-based cases against the production v6 contract:

- `LOCATION`
- `CHANGES`
- `BLOCKERS`
- `VISUAL-ONLY`
- `AFFORDANCES`

Recommended workflow:

```bash
# 1. Validate the perception dataset
npx tsx evals/cli.ts perception-validate

# 2. Run the perception suite
npm run evals:perception
```

Current frozen baseline:

- default model: `x-ai/grok-4.1-fast`
- validator status: `20 valid, 0 invalid, 1 warning`
- baseline result: `18/20` pass (`90%`)
- canonical report: `evals/reports/model-compare/perception-critique-2026-03-13T18-22-13-878Z.md`

Guardrails:

- treat legacy pre-v6 perception reports as non-comparable reference artifacts
- require `perception-validate` to pass before trusting score changes
- compare future model or prompt changes against the frozen Grok baseline

## Critique Evals

The critique track replays recorded action turns from real traces, scores the resulting tool behavior, and generates actionable reports for planner and executor prompt work.

Useful commands:

```bash
npm run evals:critique
npx tsx evals/cli.ts critique-recovery --tag <pathology>
npx tsx evals/cli.ts live-benchmark --localhost --limit 20
```

## File Layout

```text
evals/
  cli.ts
  golden/
  reports/
  results/
  perception-*.ts
  runner.ts
  scorer.ts
  judge.ts
  report.ts
  utils.ts
```
