# Online-Mind2Web Benchmark Plan (launch number)

Decision-locked execution plan for producing OpenSidebar's first **publishable**
Online-Mind2Web score. This is the *what we will run and ship* document; it sits
on top of two companions and does not duplicate them:

- Architecture, flags, judging, safety → [README.md](./README.md)
- Per-phase operator mechanics & honesty gates → [RUN-CHECKLIST.md](./RUN-CHECKLIST.md)

Authored 2026-06-14. Updated 2026-06-15. Owner: Kris. Status: **ready for paired Fireworks smoke**.

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

## 2. Current-state assessment (2026-06-15)

| Gate | State |
| --- | --- |
| Build / `dist/` | Preflight rebuilds before paid inference |
| Task set (300) | ✅ `tasks/online-mind2web.json` (80 easy / 141 medium / 79 hard) |
| Judge key | ✅ `OPENAI_API_KEY` → auto-fallback to OpenAI direct, `gpt-5.4-mini` |
| HF token | ✅ present (only needed to re-fetch tasks) |
| **Executor key** | ✅ `FIREWORKS_API_KEY` available |

The paid Kimi K2.7 probe and paired six-task smoke (§5 Phase 1) are still the
go/no-go checks for exact model routing, multimodal function calling, credits,
browser execution, judging, and receipt generation.

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
| **A — flagship** | `fireworks` | `kimi-k2p6-turbo` | `fireworks / kimi-k2p6-turbo` | Fireworks key | ready |
| **Candidate smoke** | `fireworks` | `accounts/fireworks/models/kimi-k2p7-code` | `fireworks / kimi-k2p7-code (smoke)` | Fireworks key | compatibility candidate only |
| **B — second** | `deepseek` | `deepseek-v3.2` | `deepseek / v3.2` | Fireworks **and** DeepSeek keys (hybrid) | ready after smoke |
| **C — optional third** | `openrouter` | `openai/gpt-5.4-mini` | `openrouter / gpt-5.4-mini` | `OPENROUTER_API_KEY` | optional key not present |

Publish **2 minimum** from the launch matrix. K2.7 is not promoted or published
as a headline config from a six-task smoke; it needs a larger comparable sweep
and the normal honesty gates first.

---

## 5. Phased execution (each phase gates the next)

Operator detail for each phase is in [RUN-CHECKLIST.md](./RUN-CHECKLIST.md); the
exact commands for *this* campaign are below. Run from repo root.

### Phase 0 — Preflight + freeze (minutes)
- Run focused tests, typecheck, and build before paid inference.
- Confirm `.env` judge key present. Do **not** start with uncommitted runtime changes.

### Phase 1 — Paired K2.6/K2.7 smoke, ~pennies — **GO/NO-GO**
```bash
pnpm run bench:smoke:kimi-k2p7
```
GO if: the exact K2.7 model passes the red-image required-tool probe; both
configs produce six evidence files, judge verdicts, and trace receipts; and
`comparison.json` / `comparison.md` are written. This establishes compatibility
only and does not change the K2.6 production default.

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
| Executor key invalid/misrouted | Phase-1 smoke is the gate; never sweep before it passes |
| `deepseek` hybrid depends on Fireworks executor routing | Keep both Fireworks and DeepSeek keys healthy before Config B |
| Headed Chrome instability / machine sleep | Disable sleep; one config at a time; partial runs recoverable via `--judge-only` |
| Judge miscalibration | Hand-check in Phase 2; re-score free with `--judge-only`; swap `BENCH_JUDGE_MODEL` if needed |
| High write-skip rate shrinks denominator | Report skips separately; carry the scored-n and a small-n caveat |
| Mid-campaign dataset/seed drift | §3 freezes them; any change = new campaign |

---

## 8. Order of operations (today)

1. Phase 0 preflight.
2. Phase 1 paired K2.6/K2.7 smoke → GO/NO-GO.
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
