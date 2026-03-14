# Perception Layer

OpenSidebar uses a stateful perception layer to turn screenshots plus DOM context into a compact page interpretation for the executor and planner.

## Current Contract

Production perception is a unified v6 prompt that returns five sections:

1. `LOCATION`
2. `CHANGES`
3. `BLOCKERS`
4. `VISUAL-ONLY`
5. `AFFORDANCES`

This contract is shared between production and the corrected perception eval harness.

## Current Model

- default perception model: `x-ai/grok-4.1-fast`
- provider: OpenRouter
- prompt source: `prompts/runtime/perception/interpret_page.md`

The perception layer used to rely on older Gemini-based prompt variants. Those older layouts are now legacy-only and should not be used for judging current behavior.

## Runtime Shape

Primary code:

- `src/background/perception/perception-agent.ts`
- `src/background/perception/prompt-builder.ts`
- `src/background/perception/types.ts`

The agent:

- captures the current screenshot
- builds a compact element summary from tagged DOM elements
- includes prior observation history for change tracking
- sends the multimodal prompt to the perception model
- stores the structured interpretation for later turns

## Why It Exists

The DOM snapshot alone is not enough for:

- modal and overlay interpretation
- visual-only text and cues
- canvas/image/chart content
- persistent blocker tracking
- stable change detection across turns

Perception gives the runtime a short, structured page-state summary instead of forcing the executor to infer everything from raw visible text.

## Observation History

`PerceptionAgent` is stateful. It keeps recent observations so the model can describe what changed rather than re-describing the page from scratch every turn.

That is what makes `CHANGES` meaningful and lets the model carry forward persistent blockers or prerequisites.

## Freshness Policy

Perception is refreshed more aggressively after navigation and more lazily after routine actions. The runtime uses tool-aware stale thresholds rather than calling the vision model on every single turn.

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

Use:

```bash
npx tsx evals/cli.ts perception-validate
npm run evals:perception
```

## Guardrails

- Treat pre-v6 perception reports as historical artifacts, not comparable baselines.
- Require `perception-validate` to pass before trusting score changes.
- Compare future prompt or model changes against the frozen Grok baseline.
