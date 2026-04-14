# Developer Guide

This is the quickest accurate map of the current codebase.

## Start Here

Most development work falls into one of these workflows:

1. Run the extension locally with logs and traces.
2. Run fast tests while iterating.
3. Run the real-browser E2E harness.
4. Inspect traces and logs to debug agent behavior.

If you only need the common commands, start with the next section. Use the rest of the document as an operating map.

## Common Workflows

### Run the app locally

When to use this:
Work on the extension with the log server and trace viewer available.

```bash
npm run dev
```

What it starts:

- extension build/watch
- log server
- trace viewer at `http://127.0.0.1:7589/viewer`

### Run fast tests

When to use this:
Validate normal code changes without launching Chrome.

```bash
npm test
```

Run a single file:

```bash
npx vitest run --config apps/extension/vitest.config.ts apps/extension/tests/background/tools.test.ts
```

### Run E2E tests

When to use this:
Validate real browser behavior with the built extension and live agent loop.

Prerequisites:

- `OPENROUTER_API_KEY`
- successful build assets

```bash
npm run test:e2e
```

Related surfaces:

- fixtures in `apps/extension/tests/e2e/fixtures/`
- helper utilities in `apps/extension/tests/e2e/helpers/`
- dated reports in `docs/e2e-report-YYYY-MM-DD.md`

### Inspect traces and logs

When to use this:
Debug tool execution, planner/executor behavior, or E2E failures.

```bash
npm run logs
npm run traces
```

Viewer:

- `http://127.0.0.1:7589/viewer`

## Current Runtime

- side panel UI: React 18 + Zustand
- service worker: agent loop, orchestrator, tool routing, tracing
- content script: DOM tagging, snapshots, page actions
- prompts: compiled prompt registry under `packages/prompts/`

## Current Model Defaults

| Role | Default |
| --- | --- |
| Executor | `google/gemini-3-flash-preview` |
| Executor fallback | `google/gemini-3.1-flash-lite-preview` |
| Planner | `minimax/minimax-m2.5` |
| Perception | `x-ai/grok-4.1-fast` |

Settings overrides live in `apps/extension/src/types/settings.ts` and are exposed in the settings drawer.

## Main Directories

```text
apps/
  extension/
    src/
      background/   Main execution loop, orchestrator, providers, tools
      content/      DOM snapshots, tagging, page actions
      sidepanel/    React UI
      trace-viewer/ Trace inspection UI
      utils/        Logging, storage, support utilities
    tests/          Extension unit, integration, and E2E tests
  backend/
    src/            Backend service, routes, persistence
    tests/          Backend tests

packages/
  shared-types/     Shared runtime and domain contracts
  prompts/          Prompt runtime and generated prompt assets

scripts/            Build, prompts, logs, and maintenance scripts
```

## Important Files

- `apps/extension/src/background/agent/loop.ts`: executor runtime and guardrails
- `apps/extension/src/background/agent/context.ts`: system prompt assembly and history compression
- `apps/extension/src/background/llm/client.ts`: executor/planner model defaults and provider routing
- `apps/extension/src/background/orchestrator/index.ts`: multi-step runtime orchestration
- `apps/extension/src/background/perception/perception-agent.ts`: stateful visual interpretation
- `apps/extension/src/background/perception/prompt-builder.ts`: perception prompt assembly
- `apps/extension/src/background/tools/metadata.ts`: tool risk metadata and tool profiles
- `apps/extension/src/content/tagging/index.ts`: stable tag generation and candidate filtering
- `apps/extension/src/content/actions/`: DOM action implementations
- `apps/extension/src/sidepanel/components/SettingsDrawer.tsx`: model override UI
- `apps/backend/src/server.ts`: backend runtime entrypoint

## Tooling

OpenSidebar currently exposes 38 tool names in `packages/shared-types/src/index.ts` and extension-facing compatibility exports.

Common groups:

- DOM actions: click, type, select, hover, drag and drop, checkbox, coordinates
- navigation: navigate, back, tabs, windows
- inspection: read page, read element, find element, inspect hidden, xray page, execute js
- control flow: done, escalate, wait, clarify, update plan, update notes

Tool filtering happens through focused tool profiles in `apps/extension/src/background/tools/metadata.ts`.

## Perception

Production perception uses the unified v6 contract:

- `LOCATION`
- `CHANGES`
- `BLOCKERS`
- `VISUAL-ONLY`
- `AFFORDANCES`

## Operational Surfaces

### App runtime

- side panel UI: user interaction and settings
- service worker: agent loop, orchestration, tool routing, tracing
- content script: DOM tagging, snapshots, page actions
- backend service: memory and scheduled task support

### E2E harness

- Vitest config: `apps/extension/tests/e2e/vitest.e2e.config.ts`
- global startup: `apps/extension/tests/e2e/global-setup.ts`
- reusable harness: `apps/extension/tests/e2e/helpers/harness.ts`
- fixture serving: `scripts/serve-fixtures.ts`

### Tracing and logs

- log server: `scripts/log-server.ts`
- trace viewer: `apps/extension/src/trace-viewer/`
- trace files: `traces/`
- query CLI: `npm run traces`

## Command Reference

### Local development

| Command | Use this when | Notes |
| --- | --- | --- |
| `npm run dev` | you want the main local stack running | starts build/watch, log server, trace viewer |
| `npm run build` | you need fresh production assets | required before loading `dist/` manually |
| `npm run lint` | you want a lint pass | source-focused ESLint run |
| `npm run fmt` | you want formatting only | formats extension source and shared packages |

### Tests

| Command | Use this when | Notes |
| --- | --- | --- |
| `npm test` | you want the normal fast extension suite | excludes backend and browser E2E runs |
| `npm run test:backend` | you changed backend routes or persistence | backend-only Vitest run |
| `npm run test:e2e` | you need real-browser validation | requires `OPENROUTER_API_KEY` |
| `npm run release:verify` | you want the release gate | lint + extension tests + backend tests + build |
| `npx vitest run <file>` | you want one focused test file | useful during iteration |

### Observability

| Command | Use this when | Notes |
| --- | --- | --- |
| `npm run logs` | you want the log server and trace viewer | viewer at `127.0.0.1:7589/viewer` |
| `npm run logs:tail` | you want recent logs quickly | last 50 entries |
| `npm run logs:errors` | you only care about errors | filters by log level |
| `npm run traces` | you want trace CLI queries | session list, turns, stats |

## Development Notes

- Prefer `rg` for search.
- Prompt changes usually require `npm run build` because prompts are compiled into `packages/prompts/src/generated.ts`.
- If docs disagree with code, update the docs after checking the runtime source of truth.
