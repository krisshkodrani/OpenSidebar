# Planner-seat eval — kimi-k2p6-turbo vs GLM-5.2 (2026-07)

Owner hypothesis (2026-07-05): GLM-5.2 "looks stronger in reasoning" and
could hold the planner/orchestrator ("brains") seat, with reactive
VL models keeping the executor seat. This eval tests that with one
variable changed.

## Environment

- Branch: `feat/lp-0011-auto-default-ab` (post LP-11 flip: unified_vl
  auto-default; executor default kimi-k2p7-code)
- Executor (both configs, pinned): `accounts/fireworks/models/kimi-k2p7-code`
- Perception: `auto` (unified_vl default)
- Config A (incumbent): planner `accounts/fireworks/routers/kimi-k2p6-turbo`
- Config B (challenger): planner `accounts/fireworks/models/glm-5p2`
  (text-only — legitimate for the planner seat; pricing entry is a
  placeholder estimate per pricing-data.ts, so cost columns are
  indicative only)
- Harness: `E2E_PLANNER_MODEL` → `settings.plannerModel` → planner pool
  verbatim (client.ts fireworks branch)

## Protocol (pre-registered, before any measurement)

1. Per config: full arena set (18 tasks × 2 repeats = 36 attempts) via
   `run-e2e-arena.ts --all --repeat 2 --report-label planner-<x>`, plus
   the `escalation-rescue` focus suite (the planner-heavy path: rescue,
   replanning, escalation).
2. **Flip criterion — the planner default changes to GLM-5.2 only if ALL
   hold:**
   - arena overall success ≥ incumbent − 0pp (ties break FOR the
     incumbent: a flip needs positive evidence, not parity), AND
   - no tier worse by > 10pp, AND
   - escalation-rescue suite green under GLM-5.2, AND
   - hard-tier success or avg turns strictly better (the "stronger
     reasoning" hypothesis must show up where reasoning matters).
3. Known limitations: n=36/config is directional; the planner only
   influences a subset of turns (decomposition, escalation, verification),
   so deltas are expected to be smaller than the perception A/B's.
4. **Mid-flight deviation (recorded before results):** the job-board
   validator fix (quota 8→4, commit b19e254a) landed after config A's
   arena started but before config B's — the two configs therefore run
   different job-board gates. `job-board.recommend-best-matches` is
   EXCLUDED from the cross-config comparison and will be re-measured
   ×2 per config on identical code afterwards. The concurrent
   waitForOutcome change alters failure latency/reason strings only,
   not pass/fail semantics, and does not affect comparability.

## Results

### Config A — planner kimi-k2p6-turbo (incumbent)

- PENDING

### Config B — planner glm-5p2

- PENDING

## Decision

- PENDING
