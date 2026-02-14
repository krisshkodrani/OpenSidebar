# RFC: Content Script API Guard

> **Status: DONE** — Archived 2026-02-14. Implemented in `src/utils/context.ts` with `getExecutionContext()`, `isContentScript()`, `isBackground()`, etc. Guards added to WorkspaceManager and keepalive.

## Error

WorkspaceManager and keepalive modules fail to initialize when loaded in content scripts, throwing errors about undefined Chrome APIs (`chrome.tabs.onRemoved`, `chrome.alarms.create`).

## Root Cause

Content scripts run in a restricted sandbox and don't have access to Chrome extension APIs like `chrome.tabs`, `chrome.tabGroups`, or `chrome.alarms`. These APIs are only available in:

- Service worker / background script context
- Sidepanel context
- Popup context

Currently, both `WorkspaceManager` and `keepalive.ts` attempt to use these APIs unconditionally during initialization, causing failures when the code is accidentally imported or executed in content scripts.

## Solution

Add runtime context detection and guards to prevent initialization in unsupported contexts:

1. **Create a context detection utility** that identifies if code is running in:
   - Background/service worker
   - Content script
   - Sidepanel
   - Offscreen document

2. **Add guards to WorkspaceManager** to skip listener setup in content scripts

3. **Add guards to keepalive.ts** to skip alarm operations in content scripts

4. **Log appropriate warnings** when APIs are unavailable instead of throwing errors

## Implementation

### Detection Utility

```typescript
export function getExecutionContext():
  | "background"
  | "content"
  | "sidepanel"
  | "offscreen"
  | "unknown" {
  if (typeof chrome === "undefined" || !chrome.runtime) {
    return "unknown";
  }

  // Check for content script context
  if (chrome.runtime.onMessage && !chrome.tabs && !chrome.alarms) {
    return "content";
  }

  // Check for service worker
  if (typeof ServiceWorkerGlobalScope !== "undefined") {
    return "background";
  }

  // Check for sidepanel
  if (chrome.sidePanel) {
    return "sidepanel";
  }

  return "unknown";
}

export function isContentScript(): boolean {
  return getExecutionContext() === "content";
}
```

### WorkspaceManager Guard

```typescript
private setupListeners() {
  // Skip in content scripts - APIs not available
  if (isContentScript()) {
    logger.debug('workspace', 'Skipping listener setup in content script');
    return;
  }

  chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));
  chrome.tabGroups.onRemoved.addListener(this.handleGroupRemoved.bind(this));
  chrome.tabs.onUpdated.addListener(this.handleTabUngrouped.bind(this));
}
```

### Keepalive Guard

```typescript
export async function startKeepalive(): Promise<void> {
  if (isContentScript()) {
    logger.debug("keepalive", "Skipping keepalive in content script");
    return;
  }

  // ... existing keepalive logic
}
```

## Files to Modify

- `src/utils/context.ts` (new file)
- `src/background/workspaces/manager.ts`
- `src/background/keepalive.ts`
- `src/utils/logger.ts` (for content script detection)

## Testing

- Ensure WorkspaceManager initializes without errors in content scripts
- Ensure keepalive doesn't throw in content scripts
- Verify normal operation continues in background script
- All existing tests should pass

## Success Criteria

- [ ] No more "Failed to initialize WorkspaceManager" errors in content scripts
- [ ] No more "Failed to create alarm" warnings in content scripts
- [ ] Background/sidepanel functionality remains intact
- [ ] All tests pass
