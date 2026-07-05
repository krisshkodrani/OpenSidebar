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

- PENDING (run in progress)

### Comparison and verdict

- PENDING — auto-generated comparison:
  `.artifacts/e2e/perception-ab-2026-07-05.md`

## Decision

- PENDING

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
