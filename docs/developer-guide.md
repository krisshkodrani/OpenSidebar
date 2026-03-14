# Developer Guide

This is the quickest accurate map of the current codebase.

## Current Runtime

- side panel UI: React 18 + Zustand
- service worker: agent loop, orchestrator, tool routing, tracing
- content script: DOM tagging, snapshots, page actions
- prompts: compiled prompt registry under `src/prompts/`
- evals: trace-based and fixture-based quality checks under `evals/`

## Current Model Defaults

| Role | Default |
| --- | --- |
| Executor | `openai/gpt-4.1-mini` |
| Executor fallback | `google/gemini-2.5-flash-lite` |
| Planner | `minimax/minimax-m2.5` |
| Perception | `x-ai/grok-4.1-fast` |

Settings overrides live in `src/types/settings.ts` and are exposed in the settings drawer.

## Main Directories

```text
src/
  background/
    agent/          Main execution loop and recovery logic
    llm/            Model routing, provider pools, pricing, streaming
    orchestrator/   Planner/executor/verifier pipeline
    perception/     Visual interpretation and prompt building
    tools/          Tool schemas, metadata, and dispatch
    workspaces/     Workspace and tab-group runtime state
  content/          DOM snapshots, tagging, and page actions
  prompts/          Generated prompt registry
  sidepanel/        React UI
  types/            Shared enums and interfaces
  utils/            Logging, storage, support utilities

tests/              Unit, integration, and e2e tests
evals/              Evaluation CLI, fixtures, reports, results
scripts/            Build, prompts, logs, and maintenance scripts
```

## Important Files

- `src/background/agent/loop.ts`: executor runtime and guardrails
- `src/background/agent/context.ts`: system prompt assembly and history compression
- `src/background/llm/client.ts`: executor/planner model defaults and provider routing
- `src/background/orchestrator/index.ts`: multi-step runtime orchestration
- `src/background/perception/perception-agent.ts`: stateful visual interpretation
- `src/background/perception/prompt-builder.ts`: shared production/eval prompt path
- `src/background/tools/metadata.ts`: tool risk metadata and tool profiles
- `src/content/tagging/index.ts`: stable tag generation and candidate filtering
- `src/content/actions/`: DOM action implementations
- `src/sidepanel/components/SettingsDrawer.tsx`: model override UI

## Tooling

OpenSidebar currently exposes 38 tool names in `src/types/enums.ts`.

Common groups:

- DOM actions: click, type, select, hover, drag and drop, checkbox, coordinates
- navigation: navigate, back, tabs, windows
- inspection: read page, read element, find element, inspect hidden, xray page, execute js
- control flow: done, escalate, wait, clarify, update plan, update notes

Tool filtering happens through focused tool profiles in `src/background/tools/metadata.ts`.

## Perception

Production perception uses the unified v6 contract:

- `LOCATION`
- `CHANGES`
- `BLOCKERS`
- `VISUAL-ONLY`
- `AFFORDANCES`

The eval harness uses the same contract and the same prompt path.

## Commands

```bash
npm run ci:lint
npm run ci:test
npm run ci:evals:offline
npm run ci:build
npm run test:e2e
npm run evals:critique
npm run evals:perception
npx tsx evals/cli.ts perception-validate
```

## Development Notes

- Prefer `rg` for search.
- Prompt changes usually require `npm run build` because prompts are compiled into `src/prompts/generated.ts`.
- If docs disagree with code, update the docs after checking the runtime source of truth.
