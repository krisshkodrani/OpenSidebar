# Online-Mind2Web Run Checklist (strategies & modes)

Operator checklist for producing a publishable score. Companion to
[README.md](./README.md). Work top to bottom; each phase gates the next, so a
failure costs the cheapest possible amount of money and time.

## Phase 0 — Prerequisites (one-time)

- [x] **Executor key live.** `FIREWORKS_API_KEY` is available in `.env`; the
      paid probe remains the go/no-go check for model routing and credits.
- [x] **Judge key.** Falls back to `OPENAI_API_KEY` in `.env` automatically
      (OpenAI direct, `gpt-5.4-mini`). Override via `BENCH_JUDGE_*` if needed.
- [x] **Task set vendored.** `tasks/online-mind2web.json` (300 tasks: 80 easy /
      141 medium / 79 hard). Re-fetch: `pnpm run bench:fetch` (HF token read
      from `.env`).
- [ ] **Repo green.** `pnpm run verify` passes; no uncommitted runtime changes
      that would make the receipts unreproducible.
- [ ] **Machine ready.** Headed Chrome can open; no VPN/firewall that blocks
      the benchmark's live sites; machine stays awake for the run duration.

## Phase 1 — Pipeline smoke (~minutes, pennies)

- [ ] Run the paired K2.6/K2.7 compatibility smoke:
      `pnpm run bench:smoke:kimi-k2p7`
- [ ] Confirm the K2.7 probe recognized the red PNG, returned streaming usage,
      resolved the exact model ID, and emitted a valid required `done` call.
- [ ] Run the bundled 6-task read-only sample:
      `pnpm run bench -- --tasks scripts/bench/tasks/sample.json --config-label "<provider> / <model> (smoke)"`
- [ ] Confirm artifacts exist: `report.md`, `summary.json`, `results.json`,
      `tasks/*.json`, `receipts/<task>/*.jsonl`.
- [ ] Confirm every task got a judge verdict (no "Recording evidence without
      verdicts" warning).
- [ ] Open one receipt and one trace to confirm they replay/read sensibly.

## Phase 2 — Calibration (~30–60 min, small spend)

- [ ] Run a 15–20 task easy-leaning subset:
      `pnpm run bench -- --size 20 --levels easy,medium --seed 0`
- [ ] Record per-task wall-clock and token cost → extrapolate the 100-task
      sweep budget (default per-task caps: 25 turns, 300 s timeout).
- [ ] Hand-check ~5 judge verdicts against the traces. If the judge looks
      miscalibrated, fix prompt/model **now**, then re-score this same run free
      with `--judge-only --run-dir <dir>` — don't pay for browser time again.
- [ ] Check the skip rate (write-mutating tasks). High skip rates shrink the
      scored denominator; note it for the report.

## Phase 3 — Headline sweep (hours per config)

- [ ] One config at a time, stratified 100:
      `pnpm run bench -- --size 100 --seed 0 --config-label "<provider> / <model>"`
- [ ] Keep `--seed 0` and the dataset revision fixed across configs so subsets
      are identical and configs are comparable.
- [ ] Don't touch the machine mid-run (headed Chrome is driving).
- [ ] If the run dies partway: evidence already on disk stays usable —
      re-judge with `--judge-only`, and re-run only what's missing.

## Phase 4 — Repeat per config (publish 2–3, never 1)

Provider modes the harness supports: `fireworks` (default), `deepseek`,
`moonshot`/`kimi`, `xiaomi`, `openrouter`, `groq`/`openrouter-groq`,
`openai-groq`. Key availability today:

| Config (E2E_PROVIDER / E2E_MODEL) | Key in `.env`? | Notes |
| --- | --- | --- |
| `fireworks` / kimi-k2p6-turbo (default) | ✅ `FIREWORKS_API_KEY` | Production default and baseline |
| `fireworks` / kimi-k2p7-code (candidate) | ✅ `FIREWORKS_API_KEY` | Candidate only; set executor and planner together |
| `deepseek` / DeepSeek V3.2 | ✅ `DEEPSEEK_API_KEY` | 84% on internal E2E; honest second config |
| `openrouter` / gpt-5.4-mini | ❌ no `OPENROUTER_API_KEY` | Add key if a third config is wanted |
| `groq` variants | ❌ no Groq key | Optional speed-focused config |

- [ ] Same `--size`, `--seed`, levels, and task revision for every config.
- [ ] Distinct `--config-label` per sweep (it's the report headline).

## Phase 5 — Verification & publishing (honesty gates)

- [ ] Hand-verify a **20% sample** of judge verdicts per config; record the
      judge-vs-manual disagreement rate (the report has a line for it).
- [ ] Uncertain/unparseable verdicts already count as failures — do not
      hand-flip them to successes.
- [ ] Skipped (write-mutating) tasks are reported separately, never in the
      pass-rate denominator.
- [ ] Keep the receipts archive for every published number.
- [ ] Carry the sample-size caveat for anything under 100 scored tasks.
- [ ] Update the README "Measured performance" section with config labels,
      dataset revision, date, and disagreement rate.

## Optional / diagnostic modes

| Mode | Command sketch | When |
| --- | --- | --- |
| Hard-only probe | `--size 25 --levels hard` | Find failure classes cheaply before a sweep |
| Turn-budget ablation | `--max-turns 15` vs default 25 | Measure convergence speed, not just success |
| Re-judge with a different judge | `--judge-only --run-dir <dir>` + `BENCH_JUDGE_MODEL=…` | Judge-sensitivity check, costs only judge tokens |
| Evidence-only run | `--no-judge` | Run browser now, judge later/offline |
| Full 300-task run | bare `pnpm run bench` (no `--size`!) | Final launch number once 100-task results are stable |
| Sandbox writes | `--allow-writes` | **Only** in a sandbox whose protocol sanctions mutations |

## Cost guards

- A bare `pnpm run bench` now runs **all 300 tasks** (the official file is
  vendored and preferred). Always pass `--size`/`--tasks` unless you mean it.
- Browser time is the expensive part; judging is decoupled (`--judge-only`)
  and cheap — when in doubt, run `--no-judge` and score later.
- `--no-build` skips the extension rebuild when `dist/` is already current.
