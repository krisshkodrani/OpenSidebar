# OpenSidebar Documentation

## Directory Structure

```
docs/
├── README.md                    # This file
├── architecture/                # Architecture documentation
│   ├── overview.md             # High-level system overview
│   ├── agent-loop.md           # Agent execution loop
│   ├── content-script.md       # Content script architecture
│   ├── sidepanel-ui.md         # Side panel React UI
│   ├── memory-system.md        # Second Brain / memory
│   ├── navigation-bridge.md    # Navigation persistence
│   ├── message-protocol.md     # Cross-context messaging
│   ├── types-reference.md      # TypeScript type reference
│   └── ...
├── features/                   # Feature documentation
│   ├── memory-system.md
│   ├── workspace-management.md
│   └── ...
├── guides/                     # User guides
│   └── ...
├── rfc/                        # Request for Comments
│   ├── README.md               # RFC process overview
│   ├── rfc-*.md               # RFC proposals
│   └── archived/               # Deprecated/archived RFCs
├── bugs/                       # Bug reports
│   └── *.md
├── research/                   # Research notes
│   └── *.md
└── screenshots/                # Screenshot assets
```

## File Naming Conventions

### General Rules

1. **Use kebab-case** for all file names (lowercase with hyphens)
2. **Use descriptive names** that convey the file's purpose
3. **Use prefixes** to group related files:

| Directory       | Prefix        | Example                             |
| --------------- | ------------- | ----------------------------------- |
| `rfc/`          | `rfc-`        | `rfc-task-decomposition.md`         |
| `bugs/`         | Number prefix | `001-workspace-not-created.md`      |
| `architecture/` | Feature name  | `agent-loop.md`, `memory-system.md` |
| `features/`     | Feature name  | `workspace-management.md`           |

### RFC Naming

RFC files should follow the pattern: `rfc-<topic>.md`

- ✅ `rfc-task-decomposition.md`
- ✅ `rfc-progress-tracker.md`
- ❌ `RFC_Task_Decomposition.md`
- ❌ `task-decomposition.md` (missing `rfc-` prefix)

### Architecture Docs

Architecture files should be named after the system/component they document:

- ✅ `agent-loop.md`
- ✅ `memory-system.md`
- ❌ `Architecture_Agent_Loop.md`

### Bug Reports

Bug files should use a numeric prefix for ordering:

- ✅ `001-workspace-not-created-on-click.md`
- ✅ `002-element-tag-collision.md`

## Creating New Documentation

1. Choose the appropriate directory based on content type
2. Use kebab-case for the file name
3. Add a brief description at the top using a heading:

```markdown
# Feature Name

Brief description of what this document covers.
```

4. For RFCs, follow the template in `rfc/README.md`
