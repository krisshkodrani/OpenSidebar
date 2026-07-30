# Perception Layer

Perception decides **how the executor sees the page**. There is no dedicated
perception model anymore — the seat was removed
(`background/perception/types.ts` records this); the executor does its own
vision. What remains in `background/perception/` is screenshot plumbing, not a
model-calling agent:

| Module | Purpose |
| --- | --- |
| `screenshot-transform.ts` | RFC LP-9 pipeline — resolution/format/scale of every screenshot before it reaches the VLM (default profile: 1280-wide JPEG q85, 1568 long-edge cap, recorded `scaleFactor`), plus RFC LP-13 region crop/zoom (`computeRegionCropGeometry` / `cropScreenshotRegion`) |
| `perception-screenshot-state.ts` | Per-run screenshot state; `getInterpretation()` always returns `null` — no perception model is ever called |
| `warmup.ts` | Pre-captures a screenshot on side-panel open, keyed by `(tabId, fingerprint)` with a 30s staleness guard; the entry's `perception` field is always `null` |
| `element-summary.ts` | Model-free DOM → text grounding summary the executor reads on text-only turns |
| `types.ts`, `index.ts` | Contracts and barrel |

## Modes

- `unified_vl` (**default**): the screenshot goes directly to the executor.
- `structured`: no screenshot is sent; the executor works from the DOM
  snapshot / element summary. Used as the non-VL-executor path, the
  budget/capture-failure fallback, and an explicit override for debugging.

## Runtime decision

- Settings field: `perceptionMode` (`auto` | `unified_vl` | `structured`)
- Decision core: `resolvePerceptionRuntimeModeDecision()` in
  `apps/extension/src/utils/perception-mode.ts`, re-evaluated per snapshot
- Order of precedence:
  1. explicit `structured` override → structured
  2. non-VL executor (`isVLCapable` / `VL_CAPABLE_MODELS` check) →
     structured — images never reach a model that cannot see them, over any
     override
  3. explicit `unified_vl` override → unified_vl
  4. visual signals (task text, canvas/svg, image-heavy, sparse DOM/SPA)
     → unified_vl unless the session image budget is exhausted
  5. no signal → **unified_vl by default** (RFC LP-11, measured flip:
     `docs/evals/lp-0011-perception-default-ab-2026-07.md`), except dense
     text-heavy DOM (≥ 40 elements AND ≥ 2000 chars page text) or exhausted
     image budget → structured
- Legacy `useVLExecutor` is migration-only; do not use it in new code.

The per-turn mode decision, image-budget accounting, and mode tallies are
recorded in session metrics and traces (`perceptionModeDecision`,
`structuredTurnCount` / `unifiedVlTurnCount`).

## Historical: the structured perception contract

Earlier versions ran a dedicated perception model that returned a five-section
`Page Interpretation` (`LOCATION`, `CHANGES`, `BLOCKERS`, `VISUAL-ONLY`,
`AFFORDANCES`, the "v6" contract). That subsystem (`perception-agent.ts`,
`prompt-builder.ts`, observation history, the Grok-baseline eval) has been
**removed from the runtime**. Treat traces and eval reports that reference it
as historical artifacts:

- Do not treat all "perception" traces as structured-perception traces —
  check the recorded runtime path first.
- Pre-v6 and v6 perception reports are not comparable baselines for current
  unified-VL behavior.
