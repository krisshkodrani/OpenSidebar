# Navigation Bridge

The Navigation Bridge enables the agent loop to survive page navigations by persisting state and resuming after the new page loads.

## Problem

When the agent navigates to a new page:

1. The content script is destroyed
2. The service worker may terminate during page load
3. Agent state (conversation history, turn count) would be lost

## Solution

1. **Save** full agent state before navigation
2. **Detect** when new page loads via `webNavigation.onCompleted`
3. **Resume** agent loop with preserved state

## Architecture

### State Machine

```
┌─────────┐     User message      ┌───────────┐
│  IDLE   │──────────────────────→│ THINKING  │
└─────────┘                       └─────┬─────┘
    ↑                                   │
    │                                   │ LLM returns
    │                                   │ tool calls
    │                                   ▼
    │                             ┌───────────┐
    │                             │   ACTING  │
    │                             └─────┬─────┘
    │                                   │
    │                    ┌──────────────┴──────────────┐
    │               No nav                    Navigation
    │                    │                    detected
    │                    │                          │
    │                    │                          ▼
    │                    │               ┌──────────────────┐
    │                    │               │ WAITING_FOR_PAGE │
    │                    │               │      _LOAD       │
    │                    │               └────────┬─────────┘
    │                    │                        │
    │                    │   webNavigation        │
    │                    │   .onCompleted         │
    │                    │                        │
    └────────────────────┴────────────────────────┘
                         Resume with saved state
```

## Storage Schema

```typescript
interface NavigationState {
  agentState: AgentLoopState; // Full conversation history
  fromUrl: string; // URL before navigation
  toUrl: string | null; // Expected destination
  navigationStartTs: number; // Timestamp
  timeoutMs: number; // Default: 30000ms
}

// Stored at key: "qsidebar:agentState"
```

## Implementation

### Saving State Before Navigation

Called when `navigate()` tool is invoked or `click_element` triggers navigation:

```typescript
async function saveNavigationState(state: AgentLoopState): Promise<void> {
  const navState: NavigationState = {
    agentState: state,
    fromUrl: currentUrl,
    toUrl: state.pendingToolCall?.expectedUrl ?? null,
    navigationStartTs: Date.now(),
    timeoutMs: NAVIGATION_TIMEOUT_MS,
  };

  await chrome.storage.local.set({
    "qsidebar:agentState": navState,
  });
}
```

### Detecting Page Load

```typescript
chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Only main frame (not iframes)
  if (details.frameId !== 0) return;

  // Check for pending navigation state
  const stored = await chrome.storage.local.get("qsidebar:agentState");
  const navState = stored["qsidebar:agentState"];
  if (!navState) return;

  // Validate this is our tab
  if (details.tabId !== navState.agentState.activeTabId) return;

  // Check timeout
  const elapsed = Date.now() - navState.navigationStartTs;
  if (elapsed > navState.timeoutMs) {
    await chrome.storage.local.remove("qsidebar:agentState");
    broadcastStatus(AgentStatus.ERROR, "Navigation timed out");
    return;
  }

  // Clear stored state
  await chrome.storage.local.remove("qsidebar:agentState");

  // Resume agent loop
  await resumeAgentLoop(navState.agentState, details.url);
});
```

### Resuming the Loop

```typescript
async function resumeAgentLoop(
  savedState: AgentLoopState,
  newUrl: string,
): Promise<void> {
  // Add navigation result as tool message
  if (savedState.pendingToolCall) {
    savedState.messages.push({
      role: "tool",
      tool_call_id: savedState.pendingToolCall.toolCallId,
      content: `Navigated to ${newUrl}. Call read_page to see the new content.`,
    });
    savedState.pendingToolCall = null;
  }

  savedState.status = AgentStatus.THINKING;

  // Restart keepalive
  await startKeepalive();

  // Continue agent loop
  try {
    await agentLoop.continue(savedState);
  } catch (err) {
    broadcastStatus(AgentStatus.ERROR, err.message);
  } finally {
    await stopKeepalive();
  }
}
```

## Service Worker Resilience

The service worker may terminate between navigation start and completion. This is handled because:

1. **State persists** in `chrome.storage.local` (survives termination)
2. **Listener re-registration** - Chrome re-instantiates the service worker to deliver `onCompleted` events
3. **Top-level listeners** are re-registered on every service worker start

```typescript
// Top-level registration (runs on every SW start)
chrome.webNavigation.onCompleted.addListener(handleNavigationComplete);

// Check for stale state on startup
chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get("qsidebar:agentState");
  if (stored["qsidebar:agentState"]) {
    const elapsed = Date.now() - stored.navigationStartTs;
    if (elapsed > stored.timeoutMs) {
      // Clean up stale state
      await chrome.storage.local.remove("qsidebar:agentState");
    }
  }
});
```

## Edge Cases

### Back/Forward Navigation

User may click back/forward during agent operation. The `onCompleted` handler resumes regardless of which URL loads. The `isExpectedUrl` flag indicates if we arrived at the expected destination.

### Redirects

HTTP redirects trigger intermediate `onCommitted` events, but `onCompleted` only fires once the final page loads. Correct behavior — we resume after the final destination.

### SPA Navigation (pushState)

Client-side routing does NOT trigger `onCompleted`. Content script survives, so Navigation Bridge isn't needed. If agent calls `navigate()` to a SPA route, Chrome forces full page load which DOES trigger `onCompleted`.

### Tab Closed During Navigation

```typescript
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const stored = await chrome.storage.local.get("qsidebar:agentState");
  if (stored["qsidebar:agentState"]?.agentState?.activeTabId === tabId) {
    await chrome.storage.local.remove("qsidebar:agentState");
    broadcastStatus(AgentStatus.ERROR, "Tab closed during navigation");
    stopKeepalive();
  }
});
```

### Multiple Rapid Navigations

If agent triggers two navigations rapidly, only the last state is saved. The `onCompleted` handler picks up whichever page loads.

### Network Errors

```typescript
chrome.webNavigation.onErrorOccurred.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const stored = await chrome.storage.local.get("qsidebar:agentState");
  if (!stored["qsidebar:agentState"]) return;
  if (details.tabId !== stored.agentState.activeTabId) return;

  await chrome.storage.local.remove("qsidebar:agentState");

  // Resume with error
  const state = stored.agentState;
  if (state.pendingToolCall) {
    state.messages.push({
      role: "tool",
      tool_call_id: state.pendingToolCall.toolCallId,
      content: `Navigation failed: ${details.error}`,
    });
    state.pendingToolCall = null;
  }
  await resumeAgentLoop(state, details.url);
});
```

## Key Files

| File                           | Purpose                                   |
| ------------------------------ | ----------------------------------------- |
| `src/background/navigation.ts` | Navigation bridge implementation          |
| `src/types/index.ts`           | `NavigationState`, `AgentLoopState` types |

## Testing

**tests/background/navigation.test.ts**

- State save/restore
- Timeout detection
- Edge cases (redirects, errors, tab close)

## Integration

The Navigation Bridge is tightly coupled with the Agent Loop:

1. Agent Loop calls `saveNavigationState()` before `navigate()`
2. Navigation Bridge calls `agentLoop.resume()` after page load
3. Both share `AgentLoopState` interface

See [Agent Loop](./agent-loop.md) for the complete orchestration flow.
