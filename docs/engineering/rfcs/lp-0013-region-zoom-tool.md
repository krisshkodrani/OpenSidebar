# RFC LP-13 — Region Zoom: an inspect_region Tool for Small Targets

Lifecycle status: Draft (recommendation only — needs owner Decision Stamp)
Date: 2026-07-04
Scope: new tool (`ToolDefinition` + args type + executor in `background/tools/`), `screenshot-transform.ts` crop path (depends on LP-9), tool metadata/caps, prompt guidance line
Related: Perception SOTA audit (2026-07-04); LP-9 (scale factor prerequisite); Anthropic computer-use `zoom` action (`computer_20251124`); Ferret-UI/AnyRes sub-image literature

## Problem

Small or dense visual targets — tiny text in canvas charts, dense tables,
map labels, favicon-sized icons — are unreadable at normal screenshot
resolution. The SOTA answer is not higher-resolution full captures (token
cost scales with area) but *regional zoom*: capture or crop a region and
resend it at full resolution. Anthropic ships this as the `zoom` action in
its newest computer-use tool and cites it as the fix for small-target
accuracy. We have no equivalent: when perception says "VISUAL-ONLY: chart
with small labels," the executor is stuck.

## Proposal

1. New tool `inspect_region` (LOW risk, not DOM-modifying, cacheable=false):
   args `{ x: number, y: number, width: number, height: number }` in
   *element-list viewport coordinates* (the same space as `@box(x,y WxH)`
   hints, so the model can zoom onto any listed element or box). Optional
   `id: number` sugar: zoom onto tag N's bounding box with 20 px padding.
2. Executor: reuse the current-turn cached screenshot (3 s screenshot cache)
   when fresh, else capture; crop the region via `OffscreenCanvas` using
   LP-9's owned scale factor; upscale the crop to at most 1024 px long edge;
   return it as an image tool-result (unified_vl path) or route it through
   the perception model with a focused "describe exactly this region" prompt
   (structured path). Image budget applies (existing
   `imagePromptBudgetAllows` gate).
3. One prompt line in the tools guidance: use `inspect_region` when text or
   controls are too small to read in the screenshot, especially on canvas.
4. Trace the region + purpose for the viewer.

## Risks

- Tool-count creep (38→39) and prompt tokens — one compact definition;
  metadata marks it sequential=false so it can pipeline with reads.
- Budget interaction: a zoom is a second image in the same turn — the
  existing budget check covers it; low-detail is wrong for zooms, so charge
  the high-detail estimate.
- Models over-calling it as a crutch — cap at 2 zooms per turn in the
  executor (mirrors the popup-triage ≤3 pattern).

## Verification

- Unit: crop math against scale factor (HiDPI and downscaled profiles),
  id-sugar bounding-box resolution, budget charging.
- New fixture: canvas chart with small labels; e2e task must read a value
  it cannot read from the base screenshot.
- `pnpm run verify` green; tool-count assertions updated (38→39).

## Recommended Decision (agent recommendation, not an owner stamp)

Status: Approved with edits

Chosen path: As proposed, sequenced strictly after LP-9 (needs the owned
scale factor). Land the fixture first so the improvement is measurable.
