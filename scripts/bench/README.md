# Public Benchmark Adapter (RFC LP-1)

A harness-only adapter that runs OpenSidebar against a neutral public benchmark
— [Online-Mind2Web](https://huggingface.co/datasets/osunlp/Online-Mind2Web)
(verified live-web tasks, difficulty-labeled, WebJudge auto-eval) — and prints a
score with re-openable receipts. No product-runtime code lives here.

## TL;DR

```bash
# Smoke the whole pipeline on the bundled read-only sample (needs a provider key):
pnpm run bench

# Preflight, probe Kimi K2.7 Code, then compare K2.6 and K2.7 on the same sample:
pnpm run bench:smoke:kimi-k2p7

# Vendor the official task set (gated dataset — accept its terms first):
export HF_TOKEN=hf_xxx
pnpm run bench:fetch

# A stratified 100-task sweep on a chosen model config:
E2E_PROVIDER=openrouter E2E_MODEL=openai/gpt-5.4-mini pnpm run bench -- --size 100 --config-label "openrouter / gpt-5.4-mini"
```

Artifacts land in `.artifacts/bench/<timestamp>/`: `report.md` (the score),
`summary.json` (machine-readable aggregate), `results.json` (per-task evidence +
verdict), `tasks/*.json` (raw run evidence), and `receipts/<task>/*.jsonl` (the
re-openable trace receipts).

## How it fits together

| Piece | Path | Pure? |
| --- | --- | --- |
| Task schema + types | `types.ts` | — |
| Loader + stratified subset | `loader.ts` | ✅ unit-tested |
| Per-task safety profile | `safety-profile.ts` | ✅ unit-tested |
| WebJudge prompt + verdict + call | `webjudge.ts` | prompt/parse ✅ unit-tested |
| Score aggregation + report | `aggregate.ts` | ✅ unit-tested |
| Official-set fetcher | `fetch-tasks.ts` | — |
| Headed runner (vitest) | `../../apps/extension/tests/bench/online-mind2web.bench.test.ts` | — |
| Orchestrator CLI | `../run-bench.ts` | — |

The unit tests live in `apps/extension/tests/bench/*.test.ts` and run under
`pnpm test`. The headed runner (`*.bench.test.ts`) is **excluded** from
`pnpm test` — it needs headed Chrome, a provider key, and live web — and runs
only via `pnpm run bench`.

## Model configs

A "config" is the provider plus executor/planner pairing the runner injects:
`E2E_PROVIDER` + `E2E_MODEL` + optional `E2E_PLANNER_MODEL`. The writer remains
unset by the harness and therefore inherits the executor. Run the sweep once per
config you want to publish (this is a BYOK scaffold — the scaffold is the
product, so publish 2–3 configs rather than one cherry-picked pairing).

Fireworks Kimi K2.6 Turbo remains the production default. Kimi K2.7 Code
(`accounts/fireworks/models/kimi-k2p7-code`) is a manually selectable candidate.
The paired six-task smoke writes `probe.json`, per-config receipts, and
`comparison.json` / `comparison.md` under one timestamped artifact directory.
Treat that smoke as compatibility evidence only, not headline performance.

## Judging (WebJudge)

A separate judge model scores each task. Configure it independently of the
executor:

- `BENCH_JUDGE_BASE_URL` (default `https://openrouter.ai/api/v1`)
- `BENCH_JUDGE_MODEL` (default `openai/gpt-5.4-mini`)
- `BENCH_JUDGE_API_KEY` (falls back to `OPENROUTER_API_KEY`, then `OPENAI_API_KEY`)

Key lookup checks the environment first, then the repo `.env`. When only an
OpenAI key is found, the judge defaults switch to OpenAI direct
(`https://api.openai.com/v1`, model `gpt-5.4-mini`) automatically.

Unparseable or uncertain verdicts count as **non-successes** — a judge that
can't be read never inflates the score. `--judge-only --run-dir <dir>` re-scores
an existing run without paying for browser time again.

## Safety on the live web

`safety-profile.ts` skips write-mutating tasks (purchase, checkout, payment,
booking, account changes, posting, applications) and counts them as **skipped,
not failed**. The pass rate is over *scored* (non-skipped, judged) tasks; skips
are reported separately. Pass `--allow-writes` only for a sandbox whose protocol
sanctions the mutation.

## Honesty discipline

- Skipped tasks are excluded from the pass-rate denominator.
- Uncertain/unparseable judge verdicts are non-successes.
- The report carries a judge-vs-manual disagreement line (verify a 20% sample
  by hand before publishing a number) and a sample-size caveat under 100 tasks.
- Every published number must ship with its receipt archive.

## CLI flags

```
pnpm run bench [--tasks <file>] [--size <n>] [--levels easy,medium,hard]
               [--task-ids <id,id,...>]
               [--seed <n>] [--max-turns <n>] [--config-label <s>]
               [--run-dir <dir>] [--no-build] [--no-judge] [--judge-only]
               [--allow-writes]
```
