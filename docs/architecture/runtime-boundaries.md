# Runtime Boundaries

Last updated: 2026-05-07

OpenSidebar has two supported UI hosts for the same side panel React app:

- The production Chrome extension side panel.
- The in-page overlay harness used for browser-driven testing and generic page smoke runs.

The stable boundary is port-based. Shared UI and reusable runtime code depend on small local ports, while Chrome-specific APIs stay in the Chrome adapters and production shell code that owns extension lifecycle.

## Current Runtime Surfaces

| Surface | Location | Role |
| --- | --- | --- |
| Production side panel | `apps/extension/src/sidepanel` | Shared React UI for chat, controls, settings, plans, metrics, and progress. |
| UI runtime port | `apps/extension/src/sidepanel/runtime.ts` | Side panel adapter for runtime messaging, tabs, windows, permissions, extension URLs, keepalive, and storage. |
| Overlay harness | `apps/extension/src/overlay` | Draggable in-page host that mounts the same side panel app with an in-memory UI runtime port. |
| Overlay driver | `apps/extension/src/overlay/driver.ts` | Browser-test helpers for sending background-style messages into the overlay and observing outbound UI messages. |
| Background environment ports | `apps/extension/src/background/environment` | Partial ports for page, content bridge, and persistence I/O. |
| Production background shell | `apps/extension/src/background/background.ts` and adjacent lifecycle code | Chrome extension lifecycle, listeners, startup, and production wiring. |

## UI Boundary

Side panel components must be environment-agnostic. They should call `uiRuntime` from `apps/extension/src/sidepanel/runtime.ts` instead of importing or reading `chrome.*` APIs directly.

The production adapter is `chromeUiRuntimePort`. It wraps Chrome APIs and exposes the `UiRuntimePort` contract:

- send and subscribe to runtime messages
- resolve extension asset URLs
- connect a keepalive port
- read the active tab, a tab by id, and the current window
- observe active-tab changes
- create tabs
- request permissions
- read and write `local`, `sync`, and `session` storage

The overlay adapter is created by `createOverlayUiRuntimeHarness()` in `apps/extension/src/overlay/runtime.ts`. It implements the same `UiRuntimePort` contract with browser events, synthetic tab/window state, and in-memory storage. The overlay uses `MessageSource.UI`; the Chrome side panel uses `MessageSource.SIDEPANEL`.

## Overlay Harness

The overlay harness is product-quality test infrastructure, not fixture logic. It mounts the real side panel app inside a shadow-DOM frame through `mountOpenSidebarOverlay()` and swaps in the overlay runtime port with `setUiRuntimePortForTesting()`.

The harness may:

- seed tab, window, and storage state
- inject the built overlay bundle into a generic page
- emulate background messages
- capture outbound UI messages
- verify visible UI state and storage behavior

The harness must not:

- encode task-specific browser-agent behavior
- contain WorkArena or fixture-specific selectors as product shortcuts
- bypass the shared UI runtime contract

## Background Boundary

Reusable background I/O should use the ports in `apps/extension/src/background/environment` where those ports already exist:

- `BrowserPagePort` for tab/page operations and screenshots
- `ContentBridgePort` for content-script messaging and injection
- `PersistencePort` for extension storage

Chrome APIs are still expected in production shell and lifecycle code until a specific area is ported. The current architecture is intentionally not a single `BrowserAdapter` tree; prefer the existing small ports over introducing a parallel abstraction.

`background/agent/page-state` is reusable agent-core policy layered over these
small ports. It owns revisioned page observations and action receipts, while
capture and content messaging remain port operations. It does not own tab
lifecycle, storage, planning, tool selection, or completion authority.

## Replay And Trace Data

Data intended for cross-environment replay should avoid Chrome-specific identifiers and storage details. Trajectories should record tool calls, revisioned observations, action receipts, step labels, and evidence in adapter-neutral terms. Observation revisions and screenshot artifact hashes are portable; raw screenshot data URLs, Chrome tab ids, `chrome.storage` keys, and extension-only lifecycle details belong in private runtime state or diagnostics, not in replay contracts.

## Deferred Work

The overlay runner page-port proves headless/mock readiness at the harness level. A full headless agent-core runtime and stable replay contract are still deferred.

## Test Coverage

Relevant boundary tests include:

- `apps/extension/tests/sidepanel/rfc012-boundary.test.ts`
- `apps/extension/tests/overlay/runtime.test.ts`
- `apps/extension/tests/overlay/driver.test.ts`
- `apps/extension/tests/overlay/host.test.ts`
- `apps/extension/tests/e2e/overlay-harness.test.ts`
