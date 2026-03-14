# Architecture Overview

OpenSidebar is a Manifest V3 Chrome extension with three runtime contexts:

```text
Side Panel <-> Service Worker <-> Content Script
```

## Runtime Roles

- Side panel: React UI, approvals, plans, streaming output, settings.
- Service worker: agent loop, orchestrator, model routing, tracing, eval-facing instrumentation.
- Content script: DOM snapshotting, element tagging, and tool execution in the page context.

## Model Stack

| Role | Current Default |
| --- | --- |
| Executor | `openai/gpt-4.1-mini` |
| Executor fallback | `google/gemini-2.5-flash-lite` |
| Planner | `minimax/minimax-m2.5` |
| Perception | `x-ai/grok-4.1-fast` |

All models are routed through OpenRouter by default.

## Core Subsystems

- `src/background/agent/`: main execution loop, context management, recovery, tracing.
- `src/background/orchestrator/`: planner/executor/verifier pipeline for multi-step tasks.
- `src/background/perception/`: stateful visual interpretation and prompt construction.
- `src/background/tools/`: tool registry, schemas, risk metadata, and routing.
- `src/content/`: page snapshotting, tagging, and DOM actions.
- `src/sidepanel/`: chat UI, settings, approvals, plan display, and trace views.
- `src/prompts/`: compiled prompt registry and render helpers.

## Execution Flow

1. User submits a task from the side panel.
2. Service worker captures page state from the content script.
3. Planner decides whether the task is single-step or orchestrated.
4. Executor runs tools against tagged DOM elements.
5. Perception refreshes visual grounding when the page changes.
6. Verifier or runtime checks decide whether to continue, retry, reroute, escalate, or finish.

## Quality and Safety

- 38 generic tools with risk metadata and focused tool profiles.
- Approval gates for higher-risk actions.
- Stale element recovery and repeated-action blocking.
- Structured traces in `traces/` and logs in `logs/`.
- Offline and trace-based evals under `evals/`.

## See Also

- [Developer Guide](../developer-guide.md)
- [Perception Layer](./perception-layer.md)
- [Tools](./tools.md)
- [Evals Program](../guides/evals-program.md)
