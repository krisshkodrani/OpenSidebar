# Phase 4 — Navigation Bridge

> **Goal:** Enable the agent loop to survive page navigations by persisting state to `chrome.storage.local`, listening for `webNavigation.onCompleted`, and resuming the loop after the new page loads.

---

## Background

When the agent clicks a link or calls `navigate(url)`, the current page unloads, destroying the content script. The service worker may also terminate during the page load. The Navigation Bridge solves this by:

1. **Saving** the full agent state before navigation.
2. **Detecting** when the new page has loaded via `chrome.webNavigation.onCompleted`.
3. **Resuming** the agent loop with the preserved state.

---

## Design

### State Machine

```
                 ┌──────────────┐
                 │     IDLE     │
                 └──────┬───────┘
                        │ User sends message
                        ▼
                 ┌──────────────┐
            ┌───→│   THINKING   │←──────────────────────┐
            │    └──────┬───────┘                        │
            │           │ LLM returns tool calls         │
            │           ▼                                │
            │    ┌──────────────┐                        │
            │    │    ACTING    │                        │
            │    └──────┬───────┘                        │
            │           │                                │
            │     ┌─────┴──────┐                         │
            │     │            │                         │
            │  No nav       Navigation                   │
            │     │         detected                     │
            │     │            │                         │
            │     │            ▼                         │
            │     │   ┌────────────────────┐             │
            │     │   │ WAITING_FOR_PAGE   │             │
            │     │   │     _LOAD          │             │
            │     │   └────────┬───────────┘             │
            │     │            │                         │
            │     │   webNavigation                      │
            │     │   .onCompleted                       │
            │     │            │                         │
            │     │            ▼                         │
            │     │   ┌────────────────────┐             │
            │     │   │  Restore state &   │─────────────┘
            │     │   │  re-inject content │
            │     └──→│  script (auto)     │
            │         └────────────────────┘
            │
            │ LLM returns text (no tool calls) or done()
            │
            ▼
     ┌──────────────┐
     │     IDLE     │
     └──────────────┘
```

---

## Implementation Details

### Storage Schema

```typescript
// Key: "qsidebar:agentState"
// Value: NavigationState | null

interface NavigationState {
  agentState: AgentLoopState;  // Full conversation history + turn count
  fromUrl: string;              // URL before navigation
  toUrl: string | null;         // Expected destination (null for click-triggered navs)
  navigationStartTs: number;    // Timestamp for timeout detection
  timeoutMs: number;            // Default: 30000
}
```

### Saving State Before Navigation

Called from the agent loop when `navigate()` is invoked or a `click_element` result reports `navigated: true`.

```typescript
async function saveNavigationState(state: AgentLoopState): Promise<void> {
  const navState: NavigationState = {
    agentState: {
      ...state,
      // Ensure messages are serializable (no functions, no circular refs)
      messages: state.messages.map(m => ({ ...m })),
    },
    fromUrl: "", // Will be set by the caller
    toUrl: state.pendingToolCall?.expectedUrl ?? null,
    navigationStartTs: Date.now(),
    timeoutMs: NAVIGATION_TIMEOUT_MS,
  };

  await chrome.storage.local.set({
    "qsidebar:agentState": navState,
  });
}
```

### webNavigation.onCompleted Handler

```typescript
chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Only care about main frame (not iframes)
  if (details.frameId !== 0) return;

  // Check if we have pending navigation state
  const stored = await chrome.storage.local.get("qsidebar:agentState");
  const navState: NavigationState | null = stored["qsidebar:agentState"] ?? null;

  if (!navState) return;
  if (navState.agentState.status !== AgentStatus.WAITING_FOR_PAGE_LOAD) return;

  // Check if this is the tab we're tracking
  if (details.tabId !== navState.agentState.activeTabId) return;

  // Check for timeout
  const elapsed = Date.now() - navState.navigationStartTs;
  if (elapsed > navState.timeoutMs) {
    await chrome.storage.local.remove("qsidebar:agentState");
    broadcastStatus(AgentStatus.ERROR, "Navigation timed out");
    return;
  }

  // Validate URL if we have an expected one
  const isExpectedUrl = navState.toUrl
    ? details.url.startsWith(navState.toUrl.split("?")[0])
    : true;

  // Clear stored state
  await chrome.storage.local.remove("qsidebar:agentState");

  // Notify side panel
  chrome.runtime.sendMessage({
    type: "NAVIGATION_RESUME",
    requestId: crypto.randomUUID(),
    source: MessageSource.BACKGROUND,
    payload: { url: details.url, isExpectedUrl },
  });

  // Wait a moment for the content script to initialize
  await new Promise(resolve => setTimeout(resolve, 500));

  // Resume the agent loop
  resumeAgentLoop(navState.agentState, details.url);
});
```

### Resuming the Agent Loop

```typescript
async function resumeAgentLoop(savedState: AgentLoopState, newUrl: string): Promise<void> {
  const state = { ...savedState };

  // Add the navigation result as a tool message
  if (state.pendingToolCall) {
    state.messages.push({
      role: "tool",
      tool_call_id: state.pendingToolCall.toolCallId,
      content: `Navigated to ${newUrl}. Page has loaded. Call read_page to see the new page content.`,
    });
    state.pendingToolCall = null;
  }

  state.status = AgentStatus.THINKING;

  // Restart keepalive
  startKeepalive();

  // Continue the agent loop from where it left off
  // (re-enter the while loop with the existing message history)
  try {
    await continueAgentLoop(state);
  } catch (err) {
    broadcastStatus(AgentStatus.ERROR, (err as Error).message);
  } finally {
    stopKeepalive();
  }
}
```

### Service Worker Lifecycle

The service worker may terminate between the navigation start and `onCompleted` firing. This is handled because:

1. State is in `chrome.storage.local` (persistent, survives termination).
2. `chrome.webNavigation.onCompleted` listener is registered at the top level of the service worker script — Chrome re-instantiates the service worker to deliver the event.
3. On wake-up, the listener checks `chrome.storage.local` for pending navigation state.

```typescript
// Top-level registration (runs on every service worker start)
chrome.webNavigation.onCompleted.addListener(handleNavigationComplete);

// Also check for stale navigation state on startup
chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get("qsidebar:agentState");
  const navState = stored["qsidebar:agentState"];
  if (navState) {
    const elapsed = Date.now() - navState.navigationStartTs;
    if (elapsed > navState.timeoutMs) {
      // Stale state — clean up
      await chrome.storage.local.remove("qsidebar:agentState");
    }
    // If not timed out, the webNavigation listener will handle it
  }
});
```

---

## Edge Cases

### Back/Forward Navigation

The user may hit the browser's back or forward button during an agent operation. This triggers a new `webNavigation.onCompleted` event.

**Behavior:** If the agent is in `WAITING_FOR_PAGE_LOAD` state, the bridge resumes regardless of which URL loaded. The `isExpectedUrl` flag tells the agent loop whether we arrived at the expected destination. The LLM is informed and can adapt.

If the agent is NOT waiting for navigation (e.g., `THINKING` or `IDLE`), the `onCompleted` handler is a no-op.

### Redirects

HTTP redirects (301, 302) trigger intermediate `webNavigation.onCommitted` events, but `onCompleted` only fires once the final page is fully loaded. This is the correct behavior — we resume only after the final destination loads.

### SPA Navigation (pushState / replaceState)

SPAs use `history.pushState` for client-side routing, which does NOT trigger `webNavigation.onCompleted`. The content script survives SPA navigations (no page unload), so the Navigation Bridge is not needed.

However, if the agent calls `navigate(url)` to a URL that the SPA handles via client-side routing, `chrome.tabs.update` forces a full page load, which DOES trigger `webNavigation.onCompleted`. This is correct behavior.

### Tab Closed During Navigation

If the user closes the tab while the agent is waiting for navigation:

```typescript
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const stored = await chrome.storage.local.get("qsidebar:agentState");
  const navState = stored["qsidebar:agentState"];
  if (navState && navState.agentState.activeTabId === tabId) {
    await chrome.storage.local.remove("qsidebar:agentState");
    broadcastStatus(AgentStatus.ERROR, "Tab was closed during navigation");
    stopKeepalive();
  }
});
```

### Multiple Navigations in Quick Succession

If the agent triggers two navigations rapidly (unlikely but possible if the LLM outputs two `navigate` tool calls), only the last state is saved. The `onCompleted` handler picks up whichever page loads.

### Network Errors

If the navigation fails (DNS error, timeout, etc.), `webNavigation.onErrorOccurred` fires instead of `onCompleted`:

```typescript
chrome.webNavigation.onErrorOccurred.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const stored = await chrome.storage.local.get("qsidebar:agentState");
  const navState = stored["qsidebar:agentState"];
  if (!navState) return;
  if (details.tabId !== navState.agentState.activeTabId) return;

  await chrome.storage.local.remove("qsidebar:agentState");

  // Resume loop with error message
  const state = navState.agentState;
  if (state.pendingToolCall) {
    state.messages.push({
      role: "tool",
      tool_call_id: state.pendingToolCall.toolCallId,
      content: `Navigation failed: ${details.error}. The page could not be loaded.`,
    });
    state.pendingToolCall = null;
  }
  state.status = AgentStatus.THINKING;
  resumeAgentLoop(state, details.url);
});
```

---

## File Paths

| File | Purpose |
|---|---|
| `src/background/background.ts` | `webNavigation.onCompleted` listener, `tabs.onRemoved` listener |
| `src/types/index.ts` | `NavigationState`, `AgentLoopState` |

The Navigation Bridge is NOT a separate file — it is integrated into `background.ts` since it is tightly coupled with the agent loop.

---

## Testing

- `tests/background/navigation.test.ts` — state save/restore, timeout detection, edge cases
- Manual testing: navigate to a new page during an agent task and verify resumption

---

## Open Questions

None — all decisions are final.
