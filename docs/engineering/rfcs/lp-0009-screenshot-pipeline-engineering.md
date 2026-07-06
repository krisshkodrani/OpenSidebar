# RFC LP-9 — Screenshot Pipeline Engineering: Owned Resolution, Format, and Scale Factor

Lifecycle status: Decision stamped
Date: 2026-07-04
Decision date: 2026-07-04 (owner accepted the recommended decisions for the LP-9…LP-14 series in session)
Scope: `background/agent/loop.ts` (capture paths `refreshPerception` / `captureScreenshotForVLExecutor`), a new small `background/perception/screenshot-transform.ts`, `perception-agent.ts` dead panoramic path, e2e A/B harness
Related: Perception SOTA audit (2026-07-04); LP-1 benchmark harness (measurement vehicle); Anthropic computer-use best practices; OpenAI/Gemini computer-use docs

## Problem

Screenshots are sent to VLMs exactly as `chrome.tabs.captureVisibleTab`
produces them: native device resolution, JPEG quality 70, no downscaling, no
cropping, no owned scale factor (`loop.ts` capture sites). Three problems:

1. **Unowned resolution.** On a HiDPI display the capture can be 2560–3840px
   wide. Every vendor's computer-use guidance targets far lower input
   (Anthropic: 1280×720 "safe practical default", avoid >1920×1080; OpenAI:
   1440×900; Gemini: 1440×900). Anthropic calls client-side pre-downscaling
   with an owned scale factor "the single highest-impact optimization" —
   providers silently downscale otherwise, and any future coordinate-based
   grounding returns coordinates in the *model's* image space, not ours.
   Our default executor vision stack (Kimi / MoonViT native-resolution
   packing) publishes no guidance, so oversized inputs directly inflate
   vision token cost with unknown accuracy benefit.
2. **JPEG q70 on text.** Vendor vision docs warn that aggressive JPEG makes
   on-screen text unreadable; UI screenshots are mostly text. We compress
   harder than any surveyed agent.
3. **Dead panoramic path.** `PanoramicShot[]` multi-scroll stitching is
   plumbed through `perception-agent.ts`, `prompt-builder.ts`, and
   `callVLM()` but no production caller populates it. The field's answer to
   off-viewport content is scrolling + re-perception (which we already do),
   not stitching. The dead code misleads readers and reviewers.

## Proposal

1. **`screenshot-transform.ts`**: one pure function that takes the captured
   data URL and returns `{ dataUrl, scaleFactor, width, height }`:
   - downscale longest edge to a per-profile target (default 1280 wide,
     preserving aspect; capped at 1568 long edge to match Claude-class
     standard tiers),
   - re-encode at JPEG quality 85 (A/B PNG for text-dense pages later),
   - record `scaleFactor = capturedWidth / outputWidth` so coordinate
     mapping is possible (prerequisite for LP-13 zoom and any future
     coordinate grounding).
   Implemented with `OffscreenCanvas` in the service worker (no DOM needed).
2. Apply the transform in both capture paths (structured perception and
   unified_vl executor). Store `scaleFactor` on the trace turn.
3. Delete the dead panoramic pipeline (`panoramicScreenshots` parameter,
   prompt note, `PanoramicShot` type) — scrolling remains the off-viewport
   strategy.
4. **Measure before adopting defaults**: A/B on the e2e medium suite +
   bench sample — native-q70 (today) vs 1280-q85 vs 1280-PNG — comparing
   task success, vision token spend, and end-to-end latency. Adopt the
   winner as default; keep a `screenshotProfile` dev setting for future
   model-specific tuning.

## Risks

- Downscaling could hurt small-text reading on dense pages for MoonViT-class
  encoders that handle native resolution well — this is exactly what the A/B
  decides; the transform is a no-op profile away from reverting.
- OffscreenCanvas re-encode adds ~10–30 ms per capture — negligible against
  a 20 s perception timeout.
- Deleting panoramic code forecloses full-page stitching — acceptable; no
  surveyed production agent stitches, and the code can be recovered from git.

## Verification

- Unit: transform output dimensions/quality/scale factor; capture paths pass
  through the transform; trace records scaleFactor.
- A/B report checked into `docs/evals/` with the three profiles on ≥20 e2e
  tasks; decision recorded in this RFC before flipping the default.
- `pnpm run verify` green; no `PanoramicShot` references remain.

## Decision

Status: Approved

Chosen path:

- Implement screenshot-transform.ts (downscale to 1280-wide default profile,
  JPEG q85, owned scale factor recorded on the trace turn), apply it in both
  capture paths, and delete the dead PanoramicShot pipeline.
- Run the three-profile A/B (native-q70 / 1280-q85 / 1280-PNG) on the e2e
  medium suite + bench sample; adopt 1280-q85 as default only if
  non-inferior on task success and cheaper on vision tokens.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Model-specific screenshot profiles via a dev setting; PNG-for-text-dense
  heuristics if the A/B shows a split result.

Do not do:

- No full-page stitching; scrolling remains the off-viewport strategy.
- Do not flip the default profile before the A/B result is recorded in this
  RFC.

Evidence required before merge:

- Unit tests for transform dimensions/quality/scaleFactor; A/B report in
  docs/evals/; verify green; zero PanoramicShot references.

Next action:

- Implement
