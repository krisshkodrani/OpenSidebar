# RFC LP-11 — unified_vl as the Default Perception Mode

Lifecycle status: Decision stamped
Date: 2026-07-04
Decision date: 2026-07-04 (owner accepted the recommended decisions for the LP-9…LP-14 series in session)
Scope: `utils/perception-mode.ts` (decision default), `loop.ts` mode integration, settings default + migration, perception-cache telemetry, e2e + bench measurement
Related: Perception SOTA audit (2026-07-04); LP-9 (cheaper screenshots make this cheaper); perception architecture docs

## Problem

The current default is `structured`: a separate perception-model call
produces textual observations, and the executor never sees the screenshot
unless heuristic signals (canvas/sparse-DOM/image-heavy/visual-task-text)
flip the turn to `unified_vl`. This architecture dates from when executors
were not reliably multimodal.

The surveyed field spends vision *in the executor* — grounding and acting on
what the model itself sees — not on a separate observation model whose text
summary the executor must trust secondhand. Every production stack
(Operator, Claude CU, Gemini CU) and the converged OSS pattern (browser-use
`use_vision: "auto"`, one screenshot per step to the acting model) works
this way. Our own default executor (`kimi-k2p6-turbo`) is VL-capable, and
the unified_vl path already exists, is budget-gated, and falls back to
structured on capture failure.

Secondary concern from the audit: our observation-call cache (2–4-turn
stale thresholds) is more aggressive than anything surveyed — the field
re-perceives every turn. Flipping the default shrinks the cache's blast
radius to the structured fallback path only.

## Proposal

1. Invert the auto-heuristic default in
   `resolvePerceptionRuntimeModeDecision()`: `unified_vl` unless signals
   argue *for* structured — dense text-heavy DOM (high element count + high
   text length + no visual signals) or image budget exhausted. Explicit
   settings overrides keep working unchanged.
2. Keep the structured PerceptionAgent fully intact as: (a) the budget-
   exhausted / capture-failure fallback, (b) the explicit-override mode,
   (c) the popup-triage provider on structured turns. No deletion.
3. Add trace telemetry comparing the two modes per run (mode, vision
   tokens, turns, outcome) and a cache-efficacy counter on structured turns
   (how often `stale_fingerprint` re-interpretation reveals changes the
   cache had been hiding).
4. **Gate the flip on measurement**: run the e2e staged suite + bench
   sample with default-structured vs default-unified_vl. Adopt only if task
   success is non-inferior and cost increase is acceptable (expected:
   success up on visual/SPA pages, cost roughly neutral after LP-9's
   downscaling — low-detail images are ~85 tokens vs a 600-token
   observation call).

## Risks

- Cost regression on text-heavy sites if detail selection misfires —
  mitigated by the existing 25K image budget, `detail: low` after the first
  turn, and the measurement gate.
- Weaker non-VL models configured via BYOK: the mode decision must keep a
  capability check (existing `VL_CAPABLE_MODELS` set) so non-VL executors
  always get structured.
- Losing the perception text's BLOCKERS triage on unified_vl turns is
  already today's behavior on those turns (executor self-dismisses from the
  screenshot); no new risk, but the e2e overlay fixtures must stay green.

## Verification

- Mode-decision unit tests updated for the inverted default (existing table
  tests in `perception-mode` tests).
- A/B report on ≥30 staged e2e tasks + bench sample checked into
  `docs/evals/`; flip only on non-inferior success.
- `pnpm run verify` green; e2e easy/medium suites green under the new
  default before merging.

## Decision

Status: Approved with edits

Chosen path:

- Telemetry first (per-run mode/vision-token/outcome comparison and
  structured-turn cache-efficacy counters), then the A/B after LP-9 lands,
  then invert the auto-heuristic default to unified_vl only on non-inferior
  task success with acceptable cost. Structured mode remains as fallback,
  explicit override, and popup-triage provider.

Required edits before implementation:

- Run the A/B strictly after LP-9's default profile is decided, so image
  economics reflect the engineered pipeline.

Non-blocking follow-ups:

- Revisit the structured-path stale-cache thresholds using the new
  cache-efficacy telemetry.

Do not do:

- Do not delete or bypass the PerceptionAgent; do not send images to
  executors absent from VL_CAPABLE_MODELS.

Evidence required before merge:

- Updated mode-decision unit tests; A/B report (≥30 staged e2e tasks +
  bench sample) in docs/evals/; e2e easy/medium green under the new default.

Next action:

- Implement
