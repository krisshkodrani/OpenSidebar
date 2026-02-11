# Workspace Management

OpenSidebar automatically organizes your browser tabs into workspaces using Chrome Tab Groups. Each workspace keeps related tabs together and isolated from other activities.

## How It Works

Workspaces are **completely automatic** - you don't need to manage them manually. They're visually represented as colored tab groups in your Chrome tab bar.

### Automatic Creation

When you click the OpenSidebar extension icon on any tab:

- A new workspace is automatically created
- The current tab is added to a colored tab group
- The tab group is named "OpenSidebar N" (where N is the workspace number)

### Tab Management

- **New tabs** created by the AI automatically join the current workspace
- **Tab groups** provide visual organization in the tab bar
- **Isolation** keeps workspaces separate from each other

### Auto-Deletion

When all tabs in a workspace are closed:

- The workspace automatically deletes
- The tab group disappears
- No manual cleanup needed

## User Experience

### Per-Tab Sidebar

The side panel is strictly per-tab:

- **Click to open** - Sidebar only opens when you click the extension icon
- **Auto-close on switch** - Sidebar closes when you switch to a different tab
- **No auto-reopen** - When switching back, you must click the icon again
- **Independent state** - Each tab maintains its own sidebar session

### Workspace Example

```
1. You click extension icon on google.com
   ↓
2. Sidebar opens + "OpenSidebar 1" workspace created
   ↓
3. Google.com tab added to blue tab group "OpenSidebar 1"
   ↓
4. You ask: "Search flights to Paris"
   ↓
5. AI creates tabs: Kayak, Expedia, Google Flights
   ↓
6. All 3 tabs auto-added to blue "OpenSidebar 1" group
   ↓
7. You switch to github.com (unrelated)
   ↓
8. Sidebar closes, blue group stays visible
   ↓
9. You click extension icon on github.com
   ↓
10. NEW workspace "OpenSidebar 2" created (red group)
```

## Visual Indicators

### Tab Groups

- **Colored groups** in the tab bar show active workspaces
- **Group names** indicate workspace numbers
- **Tab count** shows how many tabs in each workspace

### Side Panel State

- **Open indicator** - Shows when sidebar is active
- **Status display** - Shows what the AI is currently doing
- **Workspace context** - AI knows which workspace it's working in

## Benefits

### Organization

- **Related tabs together** - All tabs for a task are grouped
- **Visual separation** - Easy to see different activities at a glance
- **Clean workspace** - Unrelated tabs stay separate

### Context Preservation

- **AI memory** - Each workspace maintains its own conversation context
- **Tab isolation** - AI only operates on tabs in the current workspace
- **Task focus** - Workspaces help maintain focus on specific activities

### Automatic Management

- **No manual setup** - Workspaces created when needed
- **Auto-cleanup** - Empty workspaces disappear
- **Minimal friction** - Just click and work

## Workspace Use Cases

### Research Projects

```
Research workspace:
├── Google Scholar (source paper)
├── ArXiv (related papers)
├── Notion (notes)
└── Google Docs (draft)
```

### Shopping

```
Shopping workspace:
├── Amazon (product search)
├── Consumer Reports (reviews)
├── Manufacturer site (specs)
└── Retailer comparison sites
```

### Travel Planning

```
Travel workspace:
├── Google Flights (search)
├── Booking site (reservation)
├── Hotel website (details)
├── TripAdvisor (reviews)
└── Google Maps (location)
```

### Development

```
Development workspace:
├── GitHub (repository)
├── Stack Overflow (help)
├── Documentation site (reference)
└── Online IDE (testing)
```

## Best Practices

### Single Task Focus

Keep one workspace per activity:

- **Research projects** - Use dedicated workspace
- **Shopping trips** - Separate from work tabs
- **Development** - Isolate coding sessions

### Workspace Naming

While workspaces use automatic naming ("OpenSidebar N"), you can identify them by:

- **Color coding** - Different colors for different activities
- **Tab content** - Look at the tabs in each group
- **Activity type** - Research vs shopping vs development

### Clean Transitions

When switching activities:

1. **Complete current task** or save important information to memory
2. **Let the workspace auto-delete** by closing its tabs
3. **Start new activity** - fresh workspace will be created

## Technical Details

### Tab Group API

Uses Chrome's native Tab Groups API:

- **Automatic grouping** when tabs are created
- **Color assignment** follows Chrome's default sequence
- **Group naming** uses "OpenSidebar N" pattern
- **Group management** happens in the background

### Workspace Persistence

- **Session storage** - Workspace state persists across browser sessions
- **Tab restoration** - If browser crashes, workspaces restore with tabs
- **Isolation enforcement** - AI checks tab belongs to current workspace

### Security Model

- **Tab boundaries** - AI cannot access tabs outside current workspace
- **Permission checks** - Each action validates workspace membership
- **Automatic cleanup** - No orphaned workspaces left behind

## Troubleshooting

### Workspace Not Created

If clicking the extension icon doesn't create a workspace:

- **Check permissions** - Ensure Tab Groups permission is granted
- **Chrome version** - Tab Groups require Chrome 89+
- **Extension reload** - Try reloading the extension

### Tab Not Grouped

If a new tab doesn't join the workspace:

- **Manual grouping** - Drag the tab into the group
- **Workspace reset** - Close and reopen to create fresh workspace
- **Check activity** - Verify tab was created by AI action

### Multiple Workspaces

You can have multiple workspaces active:

- **Parallel work** - Different colored groups for different activities
- **Clear separation** - Each workspace operates independently
- **Resource management** - Chrome limits total tab groups

## See Also

- [Browser Automation](./browser-automation.md) - AI tab interactions
- [Memory System](./memory-system.md) - Cross-workspace information
- [Architecture Overview](../architecture/overview.md) - Technical implementation
