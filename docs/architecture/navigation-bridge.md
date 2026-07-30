# Navigation Bridge

The Navigation Bridge enables the agent loop to survive page navigations by
persisting state and resuming after the new page loads.

**Implementation:** `apps/extension/src/background/infrastructure/navigation.ts`
(`src/background/navigation.ts` is just a re-export barrel). Read the source
for exact signatures — this doc describes the model, not line-accurate code.

## Problem

When the agent navigates:

1. The content script is destroyed
2. The service worker may terminate during page load
3. Agent state (conversation history, turn count) would be lost

## Solution

1. **Save** full agent state before navigation
2. **Detect** the new page load via `webNavigation.onCompleted`
3. **Resume** the agent loop with preserved state

```
IDLE → THINKING → ACTING → (navigation detected) → WAITING_FOR_PAGE_LOAD
  ↑                                                        │
  └──────────────── resume with saved state ←──────────────┘
```

## Storage schema

```typescript
interface NavigationState {
  agentState: AgentLoopState; // full conversation history
  fromUrl: string;
  toUrl: string | null;       // expected destination
  navigationStartTs: number;
  timeoutMs: number;          // NAVIGATION_TIMEOUT_MS = 30_000
}
```

State is stored in `chrome.storage.local` under **workspace/worker-scoped
keys**: `opensidebar:agentState:<workspaceId>:<workerId>` (via
`storageKey()`); the bare prefix is only the no-workspace fallback. This
scoping is what lets multiple orchestrator workers navigate concurrently
without clobbering each other — lookups (`loadNavigationStateForTab`) iterate
all prefix-matching keys and match on the tab.

## Flow

1. **Save** — `saveNavigationState(state, fromUrl, expectedUrl)` writes the
   keyed `NavigationState` and sets status to `WAITING_FOR_PAGE_LOAD`.
2. **Detect** — the `webNavigation.onCompleted` handler ignores subframes
   (`frameId !== 0`), requires status `WAITING_FOR_PAGE_LOAD`, resolves the
   saved state for the tab, and enforces the 30s timeout (timeout → clear
   state, status `ERROR`).
3. **Wait for the content script** — `ensureContentScript(tabId, 3000)` waits
   for the new page's content script to be responsive before resuming.
4. **Resume** — the bridge is **decoupled from the agent loop by callbacks**:
   `setNavigationCallbacks()` registers a `ResumeCallback` / `StatusCallback`
   pair; the handler invokes the resume callback (which ends up in
   `AgentLoop.resumeFromNavigation`). The pending tool call is answered with a
   tool message ("Page has loaded. Fresh page snapshot is available."), and a
   `NAVIGATION_RESUME` runtime message is broadcast to the side panel on both
   success and error.

## Service worker resilience

- State persists in `chrome.storage.local` (survives SW termination).
- Listeners are registered top-level (`registerNavigationListeners()`), so
  Chrome re-instantiates the worker to deliver `onCompleted`.
- `chrome.runtime.onStartup` runs `checkStaleNavigationState()`, which
  iterates all navigation-state keys and clears expired entries.

## Edge cases

- **Back/forward** — `onCompleted` resumes regardless of which URL loads;
  the expected-URL comparison tells the agent where it actually landed.
- **Redirects** — `onCompleted` fires only for the final page; resume happens
  at the true destination.
- **SPA navigation (pushState)** — does not fire `onCompleted`; the content
  script survives, so the bridge isn't involved. An explicit `navigate()` to
  an SPA route forces a full load, which does fire it.
- **Tab closed mid-navigation** — `tabs.onRemoved` clears the matching
  state and reports the error.
- **Network errors** — `onErrorOccurred` resumes the loop with an error tool
  message (and broadcasts `NAVIGATION_RESUME` with the failure) instead of
  hanging until timeout.
- **Rapid successive navigations** — the last save wins for a given
  workspace/worker key.

## Key files

| File | Purpose |
| --- | --- |
| `apps/extension/src/background/infrastructure/navigation.ts` | Bridge implementation |
| `packages/shared-types/src/settings.ts` | `NavigationState` |
| `packages/shared-types/src/agent.ts` | `AgentLoopState` |

## Testing

`apps/extension/tests/background/navigation.test.ts` — state save/restore,
timeout detection, redirects/errors/tab-close edge cases.

## Integration

The agent loop saves state before `navigate()` completes; the bridge resumes
via the registered callback into `AgentLoop.resumeFromNavigation`. See
[Agent Loop](./agent-loop.md).
