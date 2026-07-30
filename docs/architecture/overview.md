# Architecture Overview

OpenSidebar is a Manifest V3 Chrome extension with three production runtime contexts:

```text
Side Panel <-> Service Worker <-> Content Script
```

## Runtime Roles

- Side panel: React UI, chat, plans, approvals, streaming output, settings
- Service worker: agent loop, orchestrator, model routing, tracing
- Content script: DOM snapshotting, tagging, and tool execution in the page context

The same side panel React app also runs inside the overlay harness for browser-driven testing. The overlay is injected into a generic page and talks through an in-memory `UiRuntimePort`; production side panel wiring talks through the Chrome-backed `chromeUiRuntimePort`. Shared UI code should use the runtime port instead of importing `chrome.*` directly.

## Model Stack

| Role          | Current Default                                                                        |
| ------------- | -------------------------------------------------------------------------------------- |
| Provider mode | `openrouter`                                                                           |
| Executor      | `minimax/minimax-m3`                                                                   |
| Planner       | `z-ai/glm-5.2`                                                                         |
| Judge         | `openai/gpt-oss-120b`                                                                  |
| Perception    | `unified_vl` through the executor by default; structured fallback is provider-specific |

Defaults live in `apps/extension/src/config/model-config.ts` and
`apps/extension/src/utils/executor-model-policy.ts`; trust those over this
table when they disagree. Settings offers the release-verified OpenRouter and
Fireworks modes. Experimental adapters remain available to internal evaluation
commands but are not part of the supported setup surface.

## Core Subsystems

- `apps/extension/src/background/`: main execution loop, orchestrator, perception, tools, and tracing
- `apps/extension/src/content/`: page snapshotting, tagging, and DOM actions
- `apps/extension/src/sidepanel/`: shared chat UI, settings, approvals, plan display, and UI runtime port
- `apps/extension/src/overlay/`: draggable in-page overlay harness that mounts the shared side panel app
- `apps/extension/src/background/environment/`: partial page, content bridge, and persistence ports for reusable background I/O
- `apps/extension/src/trace-viewer/`: trace inspection UI
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

- [AI Architecture Overview](./ai-architecture-overview.html)
- [Orchestrator](./orchestrator.md)
- [First-Class Parallel Work Roadmap](./parallel-work-roadmap.md)
- [Agent Loop](./agent-loop.md)
- [Perception Layer](./perception-layer.md)
- [Content Script](./content-script.md)
- [Runtime Boundaries](./runtime-boundaries.md)
- [Developer Guide](../developer-guide.md)
- [Tools](./tools.md)
