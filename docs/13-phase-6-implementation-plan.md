# Phase 6: Workspaces & Tab Groups Implementation Plan

## Goal
Implement workspace-based context isolation using Chrome's Tab Groups API. The agent should only see and interact with tabs in the active workspace.

## Proposed Changes

### 1. Workspace Manager
- **File**: `src/background/workspaces/manager.ts` (New)
- **Features**:
    - `createWorkspace(name, color)`: Creates Chrome Tab Group + Storage Entry.
    - `addTabToWorkspace(tabId, workspaceId)`: Groups tab.
    - `removeTabFromWorkspace(tabId, workspaceId)`: Ungroups tab.
    - `getWorkspaces()`: Retrieves from storage.
    - `setActiveWorkspace(id)`: storage update + broadcast.
    - Listeners for `chrome.tabs.onRemoved` and `chrome.tabGroups.onRemoved`.

### 2. Integration with Agent Loop
- **File**: `src/background/agent/loop.ts`
- **Change**:
    - In `AgentLoop.run()`, check `activeWorkspaceId`.
    - If active, filter candidates for `read_page` / `process` to only the active tab if it belongs to the workspace.
    - *Crucially*, we need to ensure the agent *only* acts on the active tab of the workspace, or switches to tabs *within* the workspace.
    - Update `isTabInWorkspace` check before tool execution (as per design doc).

### 3. Side Panel UI
- **File**: `src/sidepanel/components/WorkspaceSelector.tsx` (New)
- **Features**: Dropdown to create/select workspaces.
- **File**: `src/sidepanel/App.tsx`
- **Change**: Integrate `WorkspaceSelector` into the Header or Sidebar.

### 4. Background Message Handling
- **File**: `src/background/background.ts`
- **Change**: Handle `WORKSPACE_CREATE`, `WORKSPACE_SELECT`, `WORKSPACE_DELETE` messages from UI.

## Verification Plan

### Automated Tests
- **File**: `tests/background/workspace.test.ts` (New)
- **Tests**:
    1.  `createWorkspace` adds to storage.
    2.  `addTabToWorkspace` updates storage and calls `chrome.tabs.group`.
    3.  Message handlers correctly route actions.

### Manual Verification
1.  **Create Workspace**: Click "New Workspace", name it "Research".
2.  **Verify Group**: Check if a Chrome Tab Group "Research" appears.
3.  **Isolation**:
    - Open a tab *outside* the group (e.g., YouTube).
    - Activate "Research" workspace.
    - Ask Agent: "What is on the current page?"
    - Agent should either switch to a tab in "Research" or complain that the current tab is not in workspace. (Actually, design says current tab tracking might be tricky, but let's stick to the "Agent operates on active tab" - if active tab is outside workspace, it should probably *warn* or *switch*).
    - *Refinement*: If the user is on a non-workspace tab, the agent should probably say "I can only work within the 'Research' workspace. Please switch to a tab in that group."
