# Phase 7 — Auto-Managed Workspaces

> **Goal:** Implement invisible, auto-managed workspaces using Chrome's Tab Groups API. Workspaces create/delete automatically, and the agent stays within its workspace context.

---

## Design Philosophy

Workspaces are **completely automatic and invisible** to users:

- **No manual management** - Users never create, delete, or switch workspaces
- **Visual organization** - Chrome Tab Groups provide visual grouping in the tab bar
- **Auto-lifecycle** - Create on first use, delete when empty
- **Per-tab context** - Each sidebar session has its own workspace

---

## User Experience

### Scenario 1: First Use

```
1. User on google.com, clicks extension icon
   ↓
2. Sidebar opens on google.com
   Workspace auto-created ("Workspace 1" - blue tab group)
   google.com automatically added to group
   ↓
3. User asks: "Search for flights to Paris"
   ↓
4. Agent creates tabs: Kayak, Expedia, Google Flights
   All tabs auto-added to blue "Workspace 1" group
   Sidebar stays on google.com (conversation tab)
```

### Scenario 2: Context Switching

```
1. User on Kayak.com with sidebar open
   ↓
2. User switches to github.com (unrelated tab)
   Sidebar automatically closes
   "Workspace 1" tab group still visible but inactive
   ↓
3. User clicks extension icon on github.com
   Sidebar opens on github.com
   NEW workspace auto-created ("Workspace 2" - red group)
   github.com added to red group
   First workspace preserved with flight tabs
```

### Scenario 3: Workspace Cleanup

```
1. User has "Workspace 1" with 4 flight tabs
   Sidebar open on google.com
   ↓
2. User closes all 4 flight tabs one by one
   ↓
3. After closing last tab in Workspace 1
   Tab group disappears from Chrome UI
   Workspace auto-deleted
```

### Scenario 4: Multiple Workspaces

```
Tab Bar Visualization:
┌──────────────────────────────────────────────────────┐
│ [Workspace 1 - Blue]  │ [Workspace 2 - Red]         │
│ [G][K][E][GF]         │ [GH][SO]                    │
│  G=Google  K=Kayak    │  GH=GitHub  SO=StackOverflow │
│  E=Expedia GF=GFlights│                             │
│  (Sidebar was here)   │  (Sidebar open here)        │
└──────────────────────────────────────────────────────┘

1. User on StackOverflow (Workspace 2, red group)
   Sidebar open
   ↓
2. User asks: "Find Python documentation"
   ↓
3. Agent creates: python.org, docs.python.org tabs
   Both auto-added to red "Workspace 2" group
   Sidebar stays on StackOverflow
```

---

## Implementation Details

### Auto-Creation on Sidebar Open

When user clicks the extension icon:

```typescript
// In background.ts
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  // Check if workspace exists for this tab
  const existingWorkspace = workspaceManager.getWorkspaceForTab(tab.id);

  if (!existingWorkspace) {
    // Auto-create new workspace
    const workspace = await workspaceManager.createWorkspace(
      `Workspace ${nextWorkspaceNumber}`,
      getNextColor(),
    );

    // Add current tab to workspace
    await workspaceManager.addTabToWorkspace(tab.id, workspace.id);
  }

  // Open sidebar
  await chrome.sidePanel.open({ tabId: tab.id });
});
```

### Auto-Grouping New Tabs

When agent creates a tab via `create_tab` tool:

```typescript
// In create_tab tool handler
async function executeCreateTab(args: CreateTabArgs): Promise<string> {
  const tab = await chrome.tabs.create({ url: args.url });

  // Get active workspace for current sidebar session
  const activeWorkspace = workspaceManager.getActiveWorkspace();

  if (activeWorkspace && tab.id) {
    // Auto-add to current workspace
    await chrome.tabs.group({
      tabIds: [tab.id],
      groupId: activeWorkspace.tabGroupId,
    });

    return `Opened ${args.url} in tab ${tab.id} (added to workspace)`;
  }

  return `Opened ${args.url} in tab ${tab.id}`;
}
```

### Auto-Delete on Empty

Listen for tab closures and cleanup empty workspaces:

```typescript
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const workspace = workspaceManager.findWorkspaceByTab(tabId);

  if (workspace) {
    // Remove tab from workspace record
    workspace.tabIds = workspace.tabIds.filter((id) => id !== tabId);

    // If no tabs left, auto-delete workspace
    if (workspace.tabIds.length === 0) {
      await workspaceManager.deleteWorkspace(workspace.id);
      logger.info("workspace", "Auto-deleted empty workspace", {
        name: workspace.name,
      });
    } else {
      await workspaceManager.save();
    }
  }
});
```

### Workspace Naming Convention

```typescript
function getNextWorkspaceNumber(): number {
  const workspaces = workspaceManager.getWorkspaces();
  const maxNum = workspaces.reduce((max, ws) => {
    const match = ws.name.match(/Workspace (\d+)/);
    return match ? Math.max(max, parseInt(match[1])) : max;
  }, 0);
  return maxNum + 1;
}

function getNextColor(): chrome.tabGroups.ColorEnum {
  const colors: chrome.tabGroups.ColorEnum[] = [
    "blue",
    "red",
    "yellow",
    "green",
    "pink",
    "purple",
    "cyan",
    "orange",
  ];
  const workspaces = workspaceManager.getWorkspaces();
  return colors[workspaces.length % colors.length];
}
```

---

## Architecture

### Key Behaviors

| Action                       | Behavior                                           |
| ---------------------------- | -------------------------------------------------- |
| Click extension icon         | Sidebar opens, workspace auto-created if needed    |
| Agent creates new tab        | Tab auto-added to current workspace group          |
| Close tab                    | Removed from workspace, workspace deleted if empty |
| Switch to different tab      | Sidebar closes, workspace preserved                |
| Switch back to workspace tab | Sidebar closed (must click icon to reopen)         |

### Storage Schema

```typescript
// chrome.storage.local keys:
"qsidebar:workspaces": Workspace[]       // All workspace definitions
"qsidebar:nextWorkspaceNum": number      // For auto-naming
```

### Workspace Interface

```typescript
interface Workspace {
  id: string; // UUID
  name: string; // "Workspace 1", "Workspace 2", etc.
  color: chrome.tabGroups.ColorEnum; // Tab group color
  tabGroupId: number | null; // Chrome tab group ID
  tabIds: number[]; // Tab IDs in workspace
  createdAt: number; // Timestamp
}
```

---

## File Paths

| File                                   | Purpose                                       |
| -------------------------------------- | --------------------------------------------- |
| `src/background/background.ts`         | Sidebar open handler, workspace auto-creation |
| `src/background/workspaces/manager.ts` | Workspace CRUD, tab tracking                  |
| `src/background/tools/index.ts`        | Auto-group tabs in create_tab tool            |
| `src/types/index.ts`                   | Workspace type definitions                    |

---

## Edge Cases

- **User manually ungroups tabs:** Tab is removed from workspace, may trigger auto-delete
- **Tab moved between windows:** Chrome handles group preservation, workspace tracks by tab ID
- **Browser restart:** Tab groups may be restored by Chrome, workspace manager re-syncs
- **Duplicate workspace names:** Not possible with auto-naming (Workspace 1, 2, 3...)

---

## Testing

- `tests/background/workspace.test.ts` — workspace CRUD, auto-delete logic
- Manual testing: open sidebar, create tabs, verify auto-grouping, close all tabs, verify auto-delete

---

## Migration from Manual Workspaces

If migrating from manual workspace UI:

1. Remove `WorkspaceSelector` component from UI
2. Remove manual workspace message handlers (WORKSPACE_CREATE, etc.)
3. Add auto-creation logic to sidebar open handler
4. Add auto-group to `create_tab` tool
5. Add auto-delete on tab removal
6. Users' existing tab groups will remain but become auto-managed

---

## Open Questions

None — all decisions are final.
