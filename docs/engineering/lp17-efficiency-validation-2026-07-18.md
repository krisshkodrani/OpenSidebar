# LP-17 / LP-17b Efficiency Validation — 2026-07-18

Live before/after measurement of the LP-17 (P1–P7) and LP-17b (CM-1–CM-5)
context-efficiency fixes. Seat config for all new runs: planner glm-5p2,
executor qwen3p7-plus (`E2E_MODEL` override), judge gpt-oss-120b. Baselines
are the 2026-07-17 runs of the same fixtures on the same seats. Companion to
`token-and-planner-analysis-2026-07-18.md` (the motivating analysis).

## Run set

1. **Easy tier, 9/9 GREEN** (240s wall) — no functional regression from any of
   the 11 fixes.
2. **Apply run (refurbed form), take 7** — both attempts killed by Fireworks
   qwen3p7-plus `503 no healthy upstream` (attempt 1 at turn ~9 after 6/8
   turns saw transient 503s; attempt 2 at turn 2). **Infrastructure, not
   build**: this is the third day the qwen pool has 503'd (it also killed
   take 5 attempt 2 and both online-shop eval runs). Attempt 1's 8 productive
   turns still measure the per-turn effects.

## The flagship three-point series (same form, same kit prompt, qwen)

| | take 5 (no fixes) | take 6 (LP-17) | take 7 att.1 (LP-17+17b) |
|---|---|---|---|
| Outcome | ✗ budget death | ✓ complete | ✗ 503s (external) |
| Turns | 53 | 22 | 8 (killed) |
| Input tokens | 1,249,887 | 538,314 | 162,521 |
| **Input/turn** | **23.6K** | **24.5K** | **20.3K (−17%)** |
| Planner call | 53s / 4,148 tok | 54s / 4,148 tok | **NONE — plannerSkipped:true** |
| Node prompt | 22.3K chars | 22.3K chars | **15.3K chars (−31%)** |
| Node objective | query + 4.8K LLM tail | query + 4.8K LLM tail | **raw kit verbatim (4,488)** |

## Per-fix verdicts

| Fix | Verdict | Evidence |
|---|---|---|
| P1 fill-checklist | ✅ big | take 6: verification tail gone (53→22 turns); agent's done() cites "All 11 tracked fields hold confirmed values" |
| P2 content marker / P3 reorder | ✅ | cache 41→47% on the long run; flat input maintained |
| P5 verify-tail | ✅ | Jul 17 baselines show literal "Verify the outcome…"/"Return … and verify page is visible" nodes (11–12K tokens each); absent in all new runs |
| P6+CM-1 gate | ✅ big | apply run: plannerSkipped:true (−54s, −4,148 planner tokens); easy tier: 2/5 agent fixtures skipped, "new tab" correctly routed |
| CM-2/3 echo caps | ✅ | node objective = raw kit exactly; planner restatement (~7K chars/turn ≈ 1.75K tok/turn) eliminated |
| CM-5 screenshot reuse | ✅ modest, correct | 1 reuse in 8 form-fill turns — form fills change the DOM, so reuse correctly stays rare here; wins accrue on read/verify-heavy runs |

## Losses / gaps found (the contrast side)

1. **qwen3p7-plus reliability is the config's dominant risk.** 503s killed
   take 7 outright. Capability-wise it is the best executor measured
   (18/19 medium, fine-print vision); the Fireworks deployment is thin.
   Mitigation options: retry-with-backoff at the suite level, or seat
   minimax/kimi for runs that must not flake.
2. **"Log in with email … password …" paid 21.2s of planner** for a
   nodeCount:1 plan — the login shape matches neither gate tier (verb "log
   in" is not a fill verb). Candidate follow-up: a `log in/sign in with`
   positive shape.
3. **Easy-tier tokens ≈ neutral** (fixtures were already 1–4 turns; e.g.
   Load Data 50K→42K, message composer ~equal). The easy-tier win is
   latency only (2–8s planner skip on 2/5, and the 21s login outlier).
4. **~10.8K chars of node prompt remain** even with zero planner echo:
   ~6.2K static Execution-policy boilerplate + ~3.6K skill-pack sections +
   handoff context. Per-run stable (so prefix-cacheable after P3), but the
   next slimming target if one is wanted.
5. **Attribution correction to the previous doc:** take 6's "11.4K
   assumptions" section actually included the Execution-policy and skill
   sections; the true LLM echo was ~7K chars/turn. The CM fixes removed
   exactly that component (22.3K → 15.3K with the boilerplate constant).

## Bottom line

All 11 fixes hold up live with zero functional regressions (9/9 easy). For
apply-shaped work the stack now saves ~54s of planning latency, ~4.2K tokens
per turn (echo + churn), and the entire failure mode take 5 died of. The
remaining efficiency frontier is boilerplate (Execution policy block) and
the remaining reliability frontier is the qwen Fireworks pool, not the code.

Take 7 should be re-run when the qwen pool recovers — attempt 1 was on a
clean trajectory (8 turns, dropdowns one-shot, both uploads planned) before
the API died.
