# Architecture Overview

OpenSidebar is a Manifest V3 Chrome extension with three runtime contexts:

```text
Side Panel <-> Service Worker <-> Content Script
```

## Runtime Roles

- Side panel: React UI, chat, plans, approvals, streaming output, settings
- Service worker: agent loop, orchestrator, model routing, tracing
- Content script: DOM snapshotting, tagging, and tool execution in the page context

## Model Stack

| Role | Current Default |
| --- | --- |
| Provider mode | `fireworks` |
| Executor | `accounts/fireworks/routers/kimi-k2p5-turbo` |
| Executor fallback | `accounts/fireworks/routers/kimi-k2p5-turbo` |
| Planner | `accounts/fireworks/routers/kimi-k2p5-turbo` |
| Perception | `x-ai/grok-4.1-fast` |

Models are configurable in Settings.

## Core Subsystems

- `apps/extension/src/background/`: main execution loop, orchestrator, perception, tools, and tracing
- `apps/extension/src/content/`: page snapshotting, tagging, and DOM actions
- `apps/extension/src/sidepanel/`: chat UI, settings, approvals, and plan display
- `apps/extension/src/trace-viewer/`: trace inspection UI
- `apps/backend/src/`: local backend service for memory and scheduled tasks
- `packages/prompts/src/`: compiled prompt registry and render helpers
- `packages/shared-types/src/`: shared runtime and domain contracts

## Execution Flow

1. User submits a task from the side panel.
2. Service worker captures page state from the content script.
3. Planner decides whether the task is single-step or orchestrated.
4. Executor runs tools against tagged DOM elements.
5. Perception refreshes visual grounding when needed.
6. Verifier or runtime checks decide whether to continue, retry, reroute, escalate, or finish.

## Quality and Safety

- Generic browser tools with risk metadata and tool profiles
- Approval gates for higher-risk actions
- Repeated-action blocking and stale-element recovery
- Structured traces in `traces/` and logs in `logs/`

## See Also

- [Orchestrator](./orchestrator.md)
- [Agent Loop](./agent-loop.md)
- [Perception Layer](./perception-layer.md)
- [Content Script](./content-script.md)
- [Developer Guide](../developer-guide.md)
- [Tools](./tools.md)
