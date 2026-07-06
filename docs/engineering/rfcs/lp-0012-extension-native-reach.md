# RFC LP-12 — Extension-Native Reach: Closed Shadow Roots and Cross-Origin Iframes

Lifecycle status: Decision stamped
Date: 2026-07-04
Decision date: 2026-07-04 (owner accepted the recommended decisions for the LP-9…LP-14 series in session)
Scope: `content/tagging/dom-traversal.ts` (traversal roots), manifest content-script `all_frames` wiring + per-frame snapshot merge in `content/` and `background/tools/bridge.ts`, permissions review
Related: Perception SOTA audit (2026-07-04); Chrome `chrome.dom.openOrClosedShadowRoot` (Chrome 88+); browser-use `cross_origin_iframes` (off by default, CDP OOPIF complexity)

## Problem

Two page regions are invisible to perception today, both marked as silent
skips in `dom-traversal.ts`:

1. **Closed shadow roots** — `getDeepQueryRoots()` traverses only open
   roots. Web components using `mode: "closed"` (common in enterprise
   widget libraries and, notably, ServiceNow-adjacent UI stacks) contribute
   zero elements.
2. **Cross-origin iframes** — skipped entirely. Embedded checkout forms,
   payment widgets, auth frames, and docs viewers are unperceivable and
   unclickable except via blind `click_coordinates`.

This is exactly where our architecture has an unexploited advantage: CDP-
based tools (browser-use, Stagehand) need per-frame CDP sessions, composite
node IDs, and coordinate remapping to reach OOPIFs — browser-use ships it
off-by-default because of the complexity. A Chrome extension gets both
capabilities natively: `chrome.dom.openOrClosedShadowRoot()` opens closed
roots from a content script, and `all_frames: true` injects the content
script into every frame, cross-origin included, with normal DOM access
inside each.

## Proposal

Phase A — closed shadow roots (small):
1. In `getDeepQueryRoots()`, when `el.shadowRoot` is null and the element
   looks like a custom element (tag contains `-`), try
   `chrome.dom.openOrClosedShadowRoot(el)`; traverse the returned root under
   the existing `MAX_SHADOW_DEPTH = 10`.
2. Tag provenance: elements from closed roots get the same stable-ID
   treatment (domPath includes the shadow hop already).

Phase B — cross-origin iframes (medium):
1. Manifest: content script `all_frames: true` (already `<all_urls>` host
   permissions, so no new permission surface — verify in the CWS listing
   notes).
2. Each frame builds its own partial snapshot; the top frame requests child
   snapshots via `chrome.runtime` relay keyed by frameId; merged element
   list namespaces tags per frame (`frameId` recorded on the element,
   IDs stay globally unique via the existing hash→ID map salted with
   frameId).
3. Action routing: `executeContentTool` targets the owning frame's content
   script by frameId (the bridge already resolves frame IDs for main-world
   injection via `getFrameIdsForMainWorldBridge`).
4. Screenshot unchanged (captureVisibleTab already renders iframes
   visually).

## Risks

- `all_frames` injection multiplies content-script instances — bound the
  per-frame element contribution (e.g. 200) and skip hidden/zero-size
  frames to protect the 1000-element cap and snapshot latency.
- Frame-relay races on navigation-heavy pages — snapshot merge must tolerate
  missing child responses (timeout 150 ms, partial merge, overflow metadata
  notes skipped frames).
- Closed-root traversal can surprise component authors' invariants — read
  paths only; actions still dispatch real events on real elements, unchanged.
- Privacy posture: no new host permissions, but document in PRIVACY_POLICY
  that frames are read for the same purpose as the top page.

## Verification

- New fixtures: closed-shadow-root form, cross-origin iframe checkout
  (fixture server already serves multi-origin via ports).
- Unit: traversal returns closed-root elements; merge namespacing; frame-
  targeted action routing.
- E2E: iframe checkout task completes tag-based (no click_coordinates);
  `pnpm run verify` green.

## Decision

Status: Approved with edits

Chosen path:

- Phase A (closed shadow roots via chrome.dom.openOrClosedShadowRoot under
  the existing depth cap) lands immediately.
- Phase B (all_frames per-frame snapshots, frame-namespaced tags,
  frame-routed actions) lands behind a setting: default-on for dev builds,
  default-off in the shipped build until the first CWS review clears, then
  flipped.

Required edits before implementation:

- Phase B ships with the per-frame element bound (~200), hidden/zero-size
  frame skipping, and the 150 ms partial-merge timeout as specified.

Non-blocking follow-ups:

- PRIVACY_POLICY wording for frame reads; CWS listing note.

Do not do:

- No new host permissions; no writes into closed shadow roots beyond normal
  event dispatch on real elements.

Evidence required before merge:

- Closed-shadow-root and cross-origin-iframe fixtures with tag-based e2e
  completion (no click_coordinates); merge-race unit tests; verify green.

Next action:

- Implement
