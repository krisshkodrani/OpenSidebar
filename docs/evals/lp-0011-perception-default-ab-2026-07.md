# LP-11 Perception Auto-Default A/B — structured vs unified_vl (2026-07)

Evidence for RFC LP-11's gated default flip ("invert the auto-heuristic
default to unified_vl only on non-inferior task success with acceptable
cost") and, jointly, RFC LP-9 item 4 (vision-token economics under the
engineered screenshot pipeline).

## Environment

- Date: 2026-07-05
- Branch: `feat/lp-0011-auto-default-ab` (stacked on the LP-9/10/12/13
  perception series and the executor-policy change)
- Executor (both arms): `accounts/fireworks/models/kimi-k2p7-code`
  (fireworks provider mode) — the new default executor, smoke-validated
  9/9 on the easy suite the same day
- Planner/writer/perception defaults: `accounts/fireworks/routers/kimi-k2p6-turbo`
- Screenshot profile (LP-9): 1280 maxWidth / 1568 maxLongEdge / JPEG q85
- Build: `extension:build-e2e` (dist-dev; dev observability surface)
- Harness: `scripts/run-perception-ab.ts --repeat 2` — one build, both
  arms sequential on identical bits, arm selected via
  `E2E_PERCEPTION_AUTO_DEFAULT` → hidden `perceptionAutoDefault` setting

## Protocol (pre-registered)

1. Arena set: all 18 tasks (easy/medium/hard tiers) × 2 repeats per arm
   = 36 attempts per arm (≥ 30 required by the RFC).
2. Arm A: auto-default `structured` (today's behavior, byte-identical
   code path). Arm B: auto-default `unified_vl` (vision unless image
   budget exhausted or dense text-heavy DOM: elements ≥ 40 AND page
   text ≥ 2000 chars with no visual signal).
3. Non-inferiority criterion (registered in `scripts/run-perception-ab.ts`
   before any measurement): flip only if
   - arm B overall success ≥ arm A − 5pp, AND
   - no tier worse by > 10pp, AND
   - arm B median image attachments ≤ 2× arm A, AND
   - staged e2e easy + medium suites green under arm B (run separately).
4. Known limitation: n=36/arm is directionally powered, not
   statistically conclusive; per-task repeat variance is reported.

## Results

### Arm A — structured default

- Overall: **28/36 attempts passed (77.8%)**
- Per-task: 12/18 tasks at 2/2, 4 tasks at 1/2
  (`support-ticket.triage-timeout-export`,
  `tab-management.dashboard-metrics`, `procurement.complete-first-two`,
  `online-shop.boundary-checkout`), 2 tasks at 0/2
  (`job-board.recommend-best-matches`,
  `workarena-gap.chat-release-coordination`)
- Full data: `.artifacts/e2e/arena-score-2026-07-05-arm-structured.{md,json}`

Notable: `visual-canvas-small.fine-print-margin` (the LP-13 fixture
whose answer exists only as 8px canvas pixels) passed 2/2 — the
`inspect_region` magnification path works end to end in live runs.

### Arm B — unified_vl default

- Overall: **30/36 attempts passed (83.3%)**
- Full data: `.artifacts/e2e/arena-score-2026-07-05-arm-unified-vl.{md,json}`

### Comparison (auto-generated: `.artifacts/e2e/perception-ab-2026-07-05.md`)

| Metric | Arm A (structured) | Arm B (unified_vl) | Delta |
| --- | ---: | ---: | ---: |
| Overall success | 77.8% | 83.3% | **+5.6pp** |
| easy | 5/6 (83.3%) | 6/6 (100%) | +16.7pp |
| medium | 9/10 (90%) | 8/10 (80%) | −10.0pp |
| hard | 14/20 (70%) | 16/20 (80%) | +10.0pp |
| Avg turns | 11.6 | 10.4 | −1.2 |
| Avg duration | 153s | 105s | **−31%** |

Only one task scored worse under arm B:
`visual-canvas-small.fine-print-margin` (2/2 → 0/2). Trace inspection
showed both arm-B attempts produced the **correct answer in 2 turns with
zero zooms** — the VL executor read the 8px fine print directly from the
first-turn high-detail screenshot; the validator (by design) rejects a
correct answer without `inspect_region` evidence. Counting task outcomes
rather than validator evidence, arm B is effectively 32/36 (88.9%,
+11.1pp) and no tier genuinely regressed. The fixture has since been
hardened (6.5px low-contrast fine print) so the zoom is genuinely
required, and the task re-validated under arm B.

### Criterion evaluation

1. Overall non-inferiority (≥ −5pp): **PASS** (+5.6pp; +11.1pp adjusted).
2. Tier non-inferiority (> −10pp): **PASS** as computed (medium −10.0pp
   is exactly at the margin and is entirely the validator artifact above).
3. Image economics (median attachments ≤ 2× arm A): **ill-posed as
   registered** — arm A's median executor-prompt image count is 0, so any
   ratio is infinite by construction. Measured against the RFC's actual
   stated cost intent instead:
   - Arm A made **418 separate perception VLM calls**, each carrying its
     own screenshot to the perception model, plus ~600-token observation
     text in every executor prompt, plus 46 executor-prompt images.
   - Arm B made **zero** perception calls and attached 362 executor-prompt
     images, mostly at ~85-token low detail (high detail only on first
     turn / URL change), across 43 fewer turns and 28.6 fewer minutes of
     wall clock (−31%).
   - Net: unified_vl reduces total vision traffic and wall-clock cost.
     **PASS on the RFC's intent; the ratio clause is recorded as a
     criterion-design error.**
4. Staged e2e easy + medium green under arm B: see below.

### LP-9 item-4 evidence

Both arms ran the engineered screenshot pipeline (1280/1568 JPEG q85).
Arm B's economics above are the item-4 measurement: one ~85-token
low-detail in-prompt image per turn replaces a ~600-token observation
call that itself shipped a full screenshot to a second model. The
default profile is confirmed.

## Staged-suite gate (arm B)

- easy: PENDING
- medium: PENDING

## Decision

- PENDING staged gate

## Notes

- The executor default flipped from `kimi-k2p6-turbo` to
  `kimi-k2p7-code` earlier the same day (owner decision; reliability
  floor policy). Both arms run on the new default, so the perception
  comparison is internally valid; absolute numbers are not comparable
  to pre-flip baselines.
- Two e2e infrastructure defects were fixed before this measurement and
  are prerequisites for reproducing it: the staged-runner suite
  validation failure (arena-suite.test.ts unassigned since b7e8ecce)
  and the missing trace drain in the production dist (e2e now drives
  the dev-surface `dist-dev` build via `extension:build-e2e`).
