# RFC LP-13 — Region Zoom: an inspect_region Tool for Small Targets

Lifecycle status: Decision stamped
Date: 2026-07-04
Decision date: 2026-07-04 (owner accepted the recommended decisions for the LP-9…LP-14 series in session)
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

## Decision

Status: Approved with edits

Chosen path:

- New inspect_region tool (viewport-coordinate rect + tag-id sugar), crop
  via LP-9's owned scale factor, ≤2 zooms/turn, high-detail budget
  charging, canvas-chart fixture landing first.

Required edits before implementation:

- Sequenced strictly after LP-9 merges (scale factor is a hard dependency).

Non-blocking follow-ups:

- Auto-zoom suggestions from perception VISUAL-ONLY findings.

Do not do:

- No full-screenshot upscaling; no zoom results persisted into history
  beyond the turn.

Evidence required before merge:

- Crop-math unit tests across HiDPI/downscaled profiles; the canvas fixture
  e2e task reads a value unreadable in the base screenshot; tool-count
  assertions updated; verify green.

Next action:

- Implement

## Implementation note (2026-07-05)

Shipped on `feat/lp-0013-inspect-region`. Decisions made during
implementation, within the stamped scope:

- **Placement:** executed in the agent loop (`background/agent/region-zoom.ts`
  behind a narrow `RegionZoomHost`), intercepted in `loop.executeToolCall`
  before the registry so both sequential and parallel dispatch are covered;
  the registry keeps a graceful "requires an active agent turn" fallback.
- **Coordinate mapping:** no devicePixelRatio capture — the crop maps the
  viewport-CSS rect via the single ratio `imageWidth / viewportWidth`
  (= dpr ÷ LP-9 scaleFactor by construction), correct for HiDPI, browser
  zoom, and degraded-passthrough screenshots.
- **Crop output:** PNG, long edge ≤ 1024, upscale ≤ 4× (a sliver never
  becomes 1024px of blur), sub-8px regions rejected; crop-only — the full
  screenshot is never upscaled.
- **Delivery:** unified_vl turns attach the crop as a high-detail user
  image on the executor's next prompt, cleared at the next perception
  refresh (never persists across turns); structured turns route through a
  one-shot `PerceptionAgent.describeRegion` that bypasses the fingerprint
  cache in both directions.
- **Tag-id sugar:** live rect via `chrome.scripting` querying
  `[data-os-tag]` in the top frame, snapshot-rect fallback; 20px padding.
- **Evidence:** crop-geometry unit tests across HiDPI/downscaled profiles;
  the `visual-canvas-small` fixture (answer only in 8px canvas pixels)
  passed 2/2 in the LP-11 arena A/B including the trace-verified
  `inspect_region` call; verify green; tool count 51 (docs' "38" predated
  this series and was corrected).
