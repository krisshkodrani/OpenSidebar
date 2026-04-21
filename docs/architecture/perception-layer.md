# Perception Layer

OpenSidebar now supports two observation paths, but only one is primary at runtime:

- `unified_vl`: screenshot goes directly to the executor
- `structured`: dedicated perception model produces `Page Interpretation`

The primary path is `unified_vl` on Fireworks. The structured perception layer remains a compatibility and fallback path for non-Fireworks stacks, eval replay, and targeted debugging.

## Current Contract

When the runtime is in `structured` mode, production perception uses a unified v6 prompt that returns five sections:

1. `LOCATION`
2. `CHANGES`
3. `BLOCKERS`
4. `VISUAL-ONLY`
5. `AFFORDANCES`

This contract is shared between production and the corrected perception eval harness.

## Current Runtime Decision

- settings field: `perceptionMode`
- `auto` resolves to `unified_vl` on Fireworks and `structured` elsewhere
- legacy `useVLExecutor` is migration-only and should not be used for new code

## Structured Path Model

- default structured-perception model: `x-ai/grok-4.1-fast`
- provider: OpenRouter
- prompt source: `prompts/runtime/perception/interpret_page.md`

The perception layer used to rely on older Gemini-based prompt variants. Those older layouts are now legacy-only and should not be used for judging current behavior.

## Runtime Shape

Primary code for the structured path:

- `src/background/perception/perception-agent.ts`
- `src/background/perception/prompt-builder.ts`
- `src/background/perception/types.ts`

The structured agent:

- captures the current screenshot
- builds a compact element summary from tagged DOM elements
- includes prior observation history for change tracking
- sends the multimodal prompt to the perception model
- stores the structured interpretation for later turns

## Why The Structured Path Exists

The DOM snapshot alone is not enough for:

- modal and overlay interpretation
- visual-only text and cues
- canvas/image/chart content
- persistent blocker tracking
- stable change detection across turns

Structured perception gives the runtime a short page-state summary instead of forcing the executor to infer everything from raw visible text.

In unified VL mode, that same visual burden shifts to the executor directly, and traces should be read accordingly.

## Observation History

`PerceptionAgent` is stateful only for the structured path. It keeps recent observations so the model can describe what changed rather than re-describing the page from scratch every turn.

That is what makes `CHANGES` meaningful and lets the model carry forward persistent blockers or prerequisites.

## Freshness Policy

Structured perception is refreshed more aggressively after navigation and more lazily after routine actions. The runtime uses tool-aware stale thresholds rather than calling the vision model on every single turn.

Routine actions:

- `click_element`
- `type_text`
- `scroll_page`
- `press_key`
- `select_option`
- `set_checkbox`

Navigation actions refresh sooner:

- `navigate`
- `go_back`
- `create_tab`
- `switch_tab`

## Eval Alignment

The perception eval harness now uses the same v6 prompt contract as production.

Frozen baseline:

- model: `x-ai/grok-4.1-fast`
- validator: `20 valid, 0 invalid, 1 warning`
- result: `18/20` pass (`90%`)

This section is historical reference only. The old perception eval commands have been removed from the active toolchain.

## Guardrails

- Do not treat all “perception” traces as structured perception traces. Check the recorded runtime path first.
- Treat pre-v6 perception reports as historical artifacts, not comparable baselines.
- Compare structured prompt or model changes against the frozen Grok baseline, not against unified VL turns.
