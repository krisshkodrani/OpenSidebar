# Online-Mind2Web Benchmark Plan (launch number)

Decision-locked execution plan for producing OpenSidebar's first **publishable**
Online-Mind2Web score. This is the *what we will run and ship* document; it sits
on top of two companions and does not duplicate them:

- Architecture, flags, judging, safety → [README.md](./README.md)
- Per-phase operator mechanics & honesty gates → [RUN-CHECKLIST.md](./RUN-CHECKLIST.md)

Authored 2026-06-14. Owner: Kris. Status: **blocked on one live executor key** (see §2).

---

## 1. Objective & deliverables

**Objective.** A defensible Online-Mind2Web pass rate for OpenSidebar, on the
official 300-task set, for **2–3 executor configs**, with re-openable receipts
and a hand-verified judge sample — suitable to put in the public README and a
launch post.

**Deliverables (definition of done).**
1. `report.md` + `summary.json` + receipts archive per published config.
2. ≥2 configs at stratified **n=100** (same seed/subset), 1 optionally at n=300.
3. A 20% hand-verified judge sample per config, with the disagreement rate recorded.
4. README "Measured performance" section updated: config labels, dataset
   revision, date, scored-n, skip count, judge-disagreement rate.
5. This plan's §9 results table filled in.

**Non-goals.** Tuning the agent to the benchmark; running write-mutating tasks
outside a sanctioned sandbox; publishing a single cherry-picked config.

---

## 2. Current-state assessment (2026-06-14) — the one blocker

| Gate | State |
| --- | --- |
| Build / `dist/` | ✅ green (built 2026-06-14) |
| Task set (300) | ✅ `tasks/online-mind2web.json` (80 easy / 141 medium / 79 hard) |
| Judge key | ✅ `OPENAI_API_KEY` → auto-fallback to OpenAI direct, `gpt-5.4-mini` |
| HF token | ✅ present (only needed to re-fetch tasks) |
| **Executor key** | ❌ **none live — this is the only blocker** |

**Why there is no live executor today.** `.env` holds `DEEPSEEK_API_KEY`,
`FIREWORKS_API_KEY`, `OPENAI_API_KEY`. But:

- `FIREWORKS_API_KEY` is **dead** (401 on a real completion, verified 2026-06-11).
- `E2E_PROVIDER=deepseek` is **not** a standalone DeepSeek executor. It resolves
  to the `fireworks-deepseek` **hybrid** (`detectProviderMode`), and the hybrid's
  active completion key is the **Fireworks** key
  (`loadActiveProviderApiKey`: `fireworksKey && deepseekKey ? fireworksKey : undefined`).
  Dead Fireworks key ⇒ hybrid is dead too.
- No `OPENROUTER_API_KEY` / Groq / Moonshot / Xiaomi key is present, so every
  other provider mode is also unkeyed.

**Decision — pick ONE to unblock (cheapest first):**

| Option | Effort | Unlocks | Recommendation |
| --- | --- | --- | --- |
| **A. Replace `FIREWORKS_API_KEY`** | new key at app.fireworks.ai | `fireworks` flagship **and** the `deepseek` hybrid (1 key → 2 configs) | **Primary** — best config coverage for one action |
| B. Add `OPENROUTER_API_KEY` | new key at openrouter.ai | `openrouter / openai/gpt-5.4-mini` (pure single-provider) | Good standalone/extra config |
| C. Add a Groq/Moonshot key | new key | speed-focused single config | Optional |

The 6-task smoke (§5 Phase 1) is the **go/no-go** that confirms whichever key is
provisioned actually completes.

---

## 3. Locked parameters (identical across every config)

- **Dataset:** `scripts/bench/tasks/online-mind2web.json`, the vendored revision. Do not re-fetch mid-campaign.
- **Subset:** `--size 100 --seed 0` (stratified across easy/medium/hard). Seed and size are **frozen** so all configs run the *same* tasks.
- **Per-task caps:** default `--max-turns 25`, 300 s timeout (don't change between configs being compared).
- **Judge:** OpenAI direct, `gpt-5.4-mini` (via `OPENAI_API_KEY` fallback). Same judge for every config.
- **Safety:** write-mutating tasks **skipped** (no `--allow-writes`); skips reported, never in the denominator.

Any change to these = a new campaign, not a comparable config.

---

## 4. Config matrix (what we publish)

| Slot | `E2E_PROVIDER` | `E2E_MODEL` | `--config-label` | Key needed | Status |
| --- | --- | --- | --- | --- | --- |
| **A — flagship** | `fireworks` | `kimi-k2p6-turbo` | `fireworks / kimi-k2p6-turbo` | replaced Fireworks key | gated on §2-A |
| **B — second** | `deepseek` | `deepseek-v3.2` | `deepseek / v3.2` | Fireworks **and** DeepSeek keys (hybrid) | gated on §2-A |
| **C — optional third** | `openrouter` | `openai/gpt-5.4-mini` | `openrouter / gpt-5.4-mini` | `OPENROUTER_API_KEY` | gated on §2-B |

Publish **2 minimum** (A + B once the Fireworks key is replaced). Add C if a
third, independent executor is wanted for credibility. (Model id `deepseek-v3.2`
is the working label; confirm it resolves in the Phase-1 smoke and correct here
if the provider expects a different string.)

---

## 5. Phased execution (each phase gates the next)

Operator detail for each phase is in [RUN-CHECKLIST.md](./RUN-CHECKLIST.md); the
exact commands for *this* campaign are below. Run from repo root.

### Phase 0 — Unblock + freeze (minutes)
- Provision one executor key per §2. `git status` clean; `dist/` current (it is).
- Confirm `.env` judge key present. Do **not** start with uncommitted runtime changes.

### Phase 1 — Pipeline smoke, ~pennies — **GO/NO-GO on the key**
```bash
E2E_PROVIDER=fireworks E2E_MODEL=kimi-k2p6-turbo \
  pnpm run bench -- --tasks scripts/bench/tasks/sample.json \
  --config-label "fireworks / kimi-k2p6-turbo (smoke)"
```
GO if: artifacts written (`report.md`, `summary.json`, `results.json`,
`receipts/<task>/*.jsonl`), **every** task got a judge verdict (no "evidence
without verdicts" warning), and one receipt + one trace read sensibly.
NO-GO ⇒ the key is dead/misrouted; fix before spending on browser time.

### Phase 2 — Calibration, ~30–60 min, small spend
```bash
E2E_PROVIDER=fireworks E2E_MODEL=kimi-k2p6-turbo \
  pnpm run bench -- --size 20 --levels easy,medium --seed 0 \
  --config-label "fireworks / kimi-k2p6-turbo (calib)"
```
- Record per-task wall-clock + token cost → extrapolate the n=100 budget (§6).
- Hand-check ~5 judge verdicts vs traces. If the judge looks miscalibrated, fix
  the prompt/model **now** and re-score free: `--judge-only --run-dir <dir>`.
- Note the skip rate (shrinks the scored denominator).

### Phase 3 — Headline sweep per config, hours each
```bash
# Config A
E2E_PROVIDER=fireworks E2E_MODEL=kimi-k2p6-turbo \
  pnpm run bench -- --size 100 --seed 0 --config-label "fireworks / kimi-k2p6-turbo"
# Config B (after A; same subset because seed/size are frozen)
E2E_PROVIDER=deepseek E2E_MODEL=deepseek-v3.2 \
  pnpm run bench -- --size 100 --seed 0 --no-build --config-label "deepseek / v3.2"
```
- One config at a time; don't touch the machine (headed Chrome is driving).
- `--no-build` after the first sweep (dist is current).
- If a run dies partway: evidence on disk stays usable — re-judge with
  `--judge-only --run-dir <dir>` and re-run only what's missing.

### Phase 4 — Optional full 300 (final launch number)
Run a bare 300-task sweep **only** on the single config you headline, once n=100
is stable:
```bash
E2E_PROVIDER=fireworks E2E_MODEL=kimi-k2p6-turbo \
  pnpm run bench -- --seed 0 --no-build --config-label "fireworks / kimi-k2p6-turbo (full 300)"
```

### Phase 5 — Verify & publish (honesty gates, see README §"Honesty discipline")
- Hand-verify a **20% sample** of verdicts per config; record disagreement rate.
- Uncertain/unparseable verdicts stay failures — never hand-flip to success.
- Archive every receipts dir tied to a published number.
- Update README "Measured performance" + this plan's §9.

---

## 6. Budget & time (fill from Phase 2)

Method: from the n=20 calibration, take median per-task wall-clock `t` and mean
per-task cost `c` (executor + judge). Then:

- n=100 wall-clock ≈ `100 × t` (serial, headed) → ___ ; cost ≈ `100 × c` → ___
- n=300 ≈ `300 × t` / `300 × c` → ___ / ___
- 2 configs at n=100 ≈ `2 × (100 × t)` → ___

Browser time is the expensive axis; judging is decoupled and cheap. When unsure,
`--no-judge` to bank evidence now and judge later with `--judge-only`.

---

## 7. Risk register

| Risk | Mitigation |
| --- | --- |
| Executor key dead/misrouted | Phase-1 smoke is the gate; never sweep before it passes |
| `deepseek` hybrid silently uses dead Fireworks key | §2 documents the dependency; replacing the Fireworks key fixes both A and B |
| Headed Chrome instability / machine sleep | Disable sleep; one config at a time; partial runs recoverable via `--judge-only` |
| Judge miscalibration | Hand-check in Phase 2; re-score free with `--judge-only`; swap `BENCH_JUDGE_MODEL` if needed |
| High write-skip rate shrinks denominator | Report skips separately; carry the scored-n and a small-n caveat |
| Mid-campaign dataset/seed drift | §3 freezes them; any change = new campaign |

---

## 8. Order of operations (today)

1. Provision one executor key (§2-A preferred).
2. Phase 1 smoke → GO/NO-GO.
3. Phase 2 calibration → fill §6 budget; sanity-check the judge.
4. Phase 3 sweep Config A, then Config B (n=100, seed 0).
5. Phase 5 verify 20% sample each → publish A + B.
6. (Optional) Phase 4 full-300 on the headline config; Config C if a third is wanted.

---

## 9. Results (fill in as runs land)

| Config | Run dir | Scored n | Skipped | Pass rate | Judge disagreement (20%) | Date |
| --- | --- | --- | --- | --- | --- | --- |
| fireworks / kimi-k2p6-turbo | | | | | | |
| deepseek / v3.2 | | | | | | |
| openrouter / gpt-5.4-mini | | | | | | |
