# RFC LP-11 — unified_vl as the Default Perception Mode

Lifecycle status: Draft (recommendation only — needs owner Decision Stamp)
Date: 2026-07-04
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

## Recommended Decision (agent recommendation, not an owner stamp)

Status: Approved with edits

Chosen path: Implement telemetry (item 3) and the A/B (item 4) first;
invert the default (item 1) only after the measurement supports it. LP-9
should land before the A/B so image costs reflect the engineered pipeline.
