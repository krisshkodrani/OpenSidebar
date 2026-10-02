# LP-12 Phase B implementation plan

Decision: [LP-12](../rfcs/lp-0012-extension-native-reach.md), Approved with edits.
Phase A is shipped. Phase B is in progress. Cross-origin frame reach defaults
on in development and off in the shipped build, with an explicit setting.

## Runtime path

1. Add the Phase B setting with a dev-build default of on and a shipped-build
   default of off. Keep the existing `<all_urls>` permission set. Inject the
   content script in all frames, but make child frames answer only explicitly
   frame-targeted messages so ordinary tab messages remain top-frame-only.
2. Resolve frame identity and geometry through a child-to-parent content-script
   handshake. The background owns Chrome `frameId`; the parent matches the
   child's `window.postMessage` source to an actual iframe element and reports
   its viewport rectangle. Use the same process at each nesting level and
   discard stale geometry after navigation. Never trust a frame ID supplied by
   page script as the routing authority.
3. Collect partial snapshots with `chrome.tabs.sendMessage(..., { frameId })`.
   Bound each child contribution to 200 elements, skip hidden or zero-size
   frames, and settle the child collection within 150 ms. Return the top-frame
   snapshot with overflow/skipped-frame diagnostics when children are missing.
4. Merge tags through the runtime-only frame namespace in
   `background/perception/frame-snapshot-merge.ts`. Keep Chrome frame IDs and
   local tags out of replayable trajectories. Route each tag-based action to
   its owning frame, translate to the frame-local tag, and verify that frame's
   observation basis before acting. Invalidate routes on navigation or a new
   snapshot; do not fall back to a blind click if a frame disappears.
5. Apply the merged snapshot through the existing background snapshot call
   sites, then remove stale single-frame assumptions in readback and action
   recovery. Leave screenshot capture unchanged.

## Evidence before merge and shipped activation

- Unit: duplicate local tags in separate frames stay unique and stable;
  routing selects the owner; hidden/zero-size frames and element caps are
  enforced; navigation and delayed replies cannot apply stale routes.
- E2E: two-origin iframe checkout completes with tag-based actions and no
  `click_coordinates`; a delayed or missing child yields an honest partial
  snapshot within the 150 ms bound; top-frame tasks retain their behavior.
- Repository `verify` gate, production and E2E builds, and manifest/permission
  review pass. Update privacy and CWS listing copy before shipped activation.

The bounded collector, geometry relay, tag namespace, and frame action route
map are connected to the orchestrator, warmup, agent refresh, and post-tool
snapshot paths. `read_page` and drag prevalidation use the merged snapshot.
Child actions carry their own observation basis and never fall back to a
top-frame click when the route is stale. A two-origin browser-agent checkout
passed with a child tag; the targeted protocol test also verifies a stale
child action is rejected. The local mock top-frame lifecycle regression passes.
The setting, privacy policy, and store copy are updated; no host permission was
added. The shipped default remains off.

The equivalent local `verify` steps passed: RFC and skill checks, staged suite
inventory, repository lint/typecheck, 5,684 extension unit tests, 67 script
tests, production build, and dist check. The E2E build and focused browser
tests pass. The literal `pnpm run verify` remains unavailable because the
Corepack pnpm shim cannot fetch the pinned pnpm version in this environment.
The default-worker unit run hit a Vitest worker RPC timeout after all assertions
passed; the same full suite exited cleanly with four workers.

An additional Chrome E2E confirms a child without an injected content script
produces an honest partial-page notice while the agent continues. The focused
collector test proves the 150 ms deadline; the browser test does not measure
that deadline directly. Navigation and newer snapshot reads now invalidate
in-flight route generations.

An untagged `press_key` now follows the frame of the last successful focused
action, and a new read preserves that keyboard route only while the frame is
still observed. Child snapshots retain short visible text so a brief success
message can be verified. The two-origin promo-field browser task typed, pressed
Enter, read the confirmation, and completed. All five focused frame E2E cases
pass with the local mock provider.

`find_element` now searches observed child frames when the top frame has no
actionable match. The child result receives a runtime-only global tag that can
be clicked; a two-origin find-then-click task passes. Frame tag identities stay
stable when child collection order changes across reads. An explicit child tag
on `extract_form_state` follows the generic frame action route. Without a tag,
that tool still inventories the top document and reports inaccessible iframes.
Combined cross-frame form inventory would need a separate capture contract so
field selectors retain their frame identity.

The remaining direct top-frame snapshot calls were reviewed. Passive Watch
Mode, cloud device commands, and cloud restore observe the authorized top
page under their separate contracts. The ServiceNow adapter keeps its own
platform-specific form observation. Agent `read_page`, drag prevalidation,
orchestrator reads, warmup, refresh, and post-tool readback use the merged path.

Remaining confidence checks: measure the missing-child deadline in a browser
E2E and run live-provider staged E2E when the Fireworks account HTTP 412
suspension is resolved. The approved shipped default remains off until CWS
review clears activation.
