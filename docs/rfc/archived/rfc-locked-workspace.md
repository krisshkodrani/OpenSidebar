# Implementation Plan: Claude-Style SidePanel Behavior

> **Status: DONE** — Archived 2026-02-14. All proposed features implemented: setPanelBehavior, tabs.onActivated handler, tab re-grouping on manual removal (handleTabUngrouped), auto-delete empty workspaces.

## Overview

Implement Anthropic-style side panel behavior where:

- Panel opens via `setPanelBehavior({ openPanelOnActionClick: true })`
- Panel persists across workspace tabs via `tabs.onActivated` handler
- Panel auto-hides on non-workspace tabs
- Workspaces are locked (tabs cannot be manually ungrouped)
- Workspaces auto-delete when last tab closes

## Changes Required

### 1. Initialize Panel Behavior (background.ts)

**Location**: Service worker startup
**Code**:

```typescript
// Initialize native Chrome panel behavior
chrome.sidePanel.setPanelBehavior({
  openPanelOnActionClick: true,
});
```

### 2. Tab Activation Handler (background.ts)

**Location**: Event listeners section
**Purpose**: Detect when user switches tabs and manage panel visibility
**Code**:

```typescript
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const workspace = await workspaceManager.getWorkspaceForTab(tabId);

  if (workspace) {
    // Tab is in workspace - ensure panel is visible
    // onActivated is a user gesture, so we can call open()
    try {
      await chrome.sidePanel.open({ tabId });
    } catch (e) {
      // Panel might already be open, ignore error
    }
  }
  // If not in workspace, Chrome naturally hides panel
});
```

### 3. Icon Click Handler (background.ts)

**Location**: chrome.action.onClicked
**Purpose**: Create workspace when clicking icon on new tab
**Changes**: Remove manual open() call, just handle workspace creation
**Code**:

```typescript
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  // Chrome opens panel automatically via setPanelBehavior
  // Just ensure workspace exists
  const existingWorkspace = await workspaceManager.getWorkspaceForTab(tab.id);
  if (!existingWorkspace) {
    const workspaceName = workspaceManager.getNextWorkspaceName();
    const workspaceColor = workspaceManager.getNextColor();
    await workspaceManager.createWorkspace(workspaceName, workspaceColor);
  }
});
```

### 4. Lock Tab Groups (workspaces/manager.ts)

**Location**: WorkspaceManager.createWorkspace()
**Purpose**: Prevent manual ungrouping of workspace tabs
**Code**:

```typescript
// When creating workspace, lock the tab group
await chrome.tabGroups.update(groupId, {
  collapsed: false,
  // Note: Chrome doesn't have a "locked" property,
  // but we can monitor and re-group if tabs are removed
});

// Listen for tabs leaving groups and re-add them
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    // Tab was ungrouped - check if it should be in a workspace
    const workspace = await this.getWorkspaceForTab(tabId);
    if (workspace && workspace.tabGroupId) {
      // Re-add to workspace group
      await chrome.tabs.group({
        tabIds: [tabId],
        groupId: workspace.tabGroupId,
      });
    }
  }
});
```

### 5. Simplify State Tracking (background.ts)

**Remove**:

- `sidebarState` Map (no longer needed)
- `currentSidebarTab` tracking (no longer needed)
- Manual panel open/close logic

**Keep**:

- Workspace management
- Tab-to-workspace mapping

### 6. Auto-Delete on Empty (workspaces/manager.ts)

**Location**: handleTabRemoved listener
**Code**:

```typescript
private async handleTabRemoved(tabId: number) {
  // Check if tab was in a workspace
  const workspace = this.getWorkspaceByTabId(tabId);
  if (workspace) {
    // Remove from workspace
    workspace.tabIds = workspace.tabIds.filter(id => id !== tabId);

    // If workspace is now empty, delete it
    if (workspace.tabIds.length === 0) {
      await this.deleteWorkspace(workspace.id);
      logger.info("workspace", "Auto-deleted empty workspace", {
        name: workspace.name
      });
    } else {
      await this.save();
    }
  }
}
```

## Technical Notes

### Why This Works

1. **`setPanelBehavior`** - Chrome handles icon clicks natively
2. **`tabs.onActivated`** - This event fires in user gesture context, allowing `open()`
3. **Workspace locking** - Re-group tabs that are manually removed
4. **Auto-delete** - Clean up empty workspaces automatically

### User Experience Flow

```
1. User clicks icon on Tab A
   → Chrome opens panel (native behavior)
   → Workspace "QSidebar 1" created
   → Tab A added to blue group

2. User switches to Tab B (also in workspace)
   → onActivated fires
   → Tab B is in workspace
   → open() called (panel stays visible)

3. User switches to Tab C (not in workspace)
   → onActivated fires
   → Tab C not in workspace
   → Chrome naturally hides panel

4. User switches back to Tab A
   → onActivated fires
   → Tab A is in workspace
   → open() called (panel reopens)

5. User closes all tabs in workspace
   → Last tab removed triggers auto-delete
   → Workspace "QSidebar 1" deleted
   → Blue group disappears
```

## Testing Checklist

- [ ] Click icon opens panel
- [ ] Panel stays open when switching between workspace tabs
- [ ] Panel closes when switching to non-workspace tab
- [ ] Panel reopens when clicking back to workspace tab
- [ ] Cannot manually ungroup tabs (they re-join automatically)
- [ ] Workspace auto-deletes when all tabs closed
- [ ] New workspace created when clicking icon on non-workspace tab
- [ ] No "user gesture" errors in console

## Files to Modify

1. `src/background/background.ts` - Panel behavior, tab activation handler
2. `src/background/workspaces/manager.ts` - Lock groups, auto-delete, tab tracking
3. Remove: Manual state tracking, complex open/close logic

## References

- Chrome Side Panel API: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Claude for Chrome behavior analysis
- User gesture requirements: https://developer.chrome.com/docs/extensions/mv3/user_privacy
