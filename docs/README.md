# OpenSidebar Documentation

## Quick Links

- [Developer Guide](./developer-guide.md) - Comprehensive developer reference (architecture, code style, file structure)
- [Architecture Overview](./architecture/overview.md) - High-level system architecture
- [Project Setup](./architecture/project-setup.md) - Build system and dev environment
- [Agent Capabilities](./features/agent-capabilities.md) - LLM tiers, orchestrator, skills, vision
- [Manual Evals Runbook](./guides/manual-evals-runbook.md) - How to run baseline + coached evals

## Directory Structure

```
docs/
├── README.md                    # This file
├── developer-guide.md           # Comprehensive developer reference
├── business-plan.md             # Business model and strategy
├── architecture/                # Technical architecture
│   ├── overview.md              # High-level system overview
│   ├── agent-loop.md            # Agent execution loop
│   ├── content-script.md        # Content script architecture
│   ├── sidepanel-ui.md          # Side panel React UI
│   ├── memory-system.md         # Second Brain / memory
│   ├── navigation-bridge.md     # Navigation persistence
│   ├── message-protocol.md      # Cross-context messaging
│   ├── types-reference.md       # TypeScript type reference
│   ├── tools.md                 # Tool system architecture
│   ├── project-setup.md         # Build configuration
│   └── fast-smart-collaboration.md # Two-tier LLM system (executor-planner)
├── features/                    # Feature documentation
│   ├── agent-capabilities.md    # LLM tiers, orchestrator, skills
│   ├── browser-automation.md    # Browser automation features
│   ├── memory-system.md         # Memory system user guide
│   ├── security.md              # Security model
│   ├── streaming-ui.md          # Streaming UI
│   ├── tools.md                 # 57-tool reference
│   └── workspace-management.md  # Workspace management
├── guides/                      # User guides and runbooks
│   ├── manual-evals-runbook.md  # Baseline + coached eval workflow
│   ├── evals-program.md         # Eval program for prompt quality
│   ├── prompt-tips.md           # Prompt writing tips
│   ├── agent-strategy-letter.md # Agent strategy guide
│   └── browser-navigation-challenge.md
├── research/                    # Research and analysis
│   ├── evaluation-against-DMAS-book.md
│   ├── dmas-gap-closure-plan.md
│   └── dom-context-opts.md
└── rfc/                         # Request for Comments
    ├── README.md                # RFC process overview
    ├── orchestrator/            # Orchestrator RFCs
    ├── upgrades/                # Upgrade proposals
    ├── rfc-*.md                 # Active RFC proposals
    └── archived/                # Implemented/deprecated RFCs
```

## File Naming Conventions

1. **Use kebab-case** for all file names (lowercase with hyphens)
2. **Use descriptive names** that convey the file's purpose

| Directory       | Convention    | Example                              |
| --------------- | ------------- | ------------------------------------ |
| `architecture/` | Feature name  | `agent-loop.md`, `memory-system.md`  |
| `features/`     | Feature name  | `workspace-management.md`            |
| `guides/`       | Action/topic  | `manual-evals-runbook.md`            |
| `rfc/`          | `rfc-` prefix | `rfc-task-decomposition.md`          |
| `research/`     | Topic name    | `evaluation-against-DMAS-book.md`    |
