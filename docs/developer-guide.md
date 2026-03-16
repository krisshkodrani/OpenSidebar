# Developer Guide

This is the quickest accurate map of the current codebase.

## Start Here

Most development work falls into one of these workflows:

1. Run the extension locally with logs and traces.
2. Run fast tests while iterating.
3. Run the real-browser E2E harness.
4. Inspect traces and logs to debug agent behavior.
5. Run evals to measure regressions.

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
npx vitest run tests/background/tools.test.ts
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

- fixtures in `tests/e2e/fixtures/`
- helper utilities in `tests/e2e/helpers/`
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

### Run evals

When to use this:
Measure regressions and review action/perception quality without rerunning a full manual scenario.

```bash
npm run ci:evals:offline
npm run evals:critique
npm run evals:perception
npx tsx evals/cli.ts perception-validate
```

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

## Operational Surfaces

### App runtime

- side panel UI: user interaction and settings
- service worker: agent loop, orchestration, tool routing, tracing
- content script: DOM tagging, snapshots, page actions

### E2E harness

- Vitest config: `tests/e2e/vitest.e2e.config.ts`
- global startup: `tests/e2e/global-setup.ts`
- reusable harness: `tests/e2e/helpers/harness.ts`
- fixture serving: `scripts/serve-fixtures.ts`

### Tracing and logs

- log server: `scripts/log-server.ts`
- trace viewer: `src/trace-viewer/`
- trace files: `traces/`
- query CLI: `npm run traces`

### Evals

- CLI: `evals/cli.ts`
- golden cases: `evals/golden/`
- reports and critique flow: `evals/`

## Command Reference

### Local development

| Command | Use this when | Notes |
| --- | --- | --- |
| `npm run dev` | you want the main local stack running | starts build/watch, log server, trace viewer |
| `npm run build` | you need fresh production assets | required before loading `dist/` manually |
| `npm run lint` | you want a lint pass | source-focused ESLint run |
| `npm run fmt` | you want formatting only | formats `src/` |

### Tests

| Command | Use this when | Notes |
| --- | --- | --- |
| `npm test` | you want the normal fast test suite | excludes the browser E2E run |
| `npm run test:e2e` | you need real-browser validation | requires `OPENROUTER_API_KEY` |
| `npx vitest run <file>` | you want one focused test file | useful during iteration |

### Observability

| Command | Use this when | Notes |
| --- | --- | --- |
| `npm run logs` | you want the log server and trace viewer | viewer at `127.0.0.1:7589/viewer` |
| `npm run logs:tail` | you want recent logs quickly | last 50 entries |
| `npm run logs:errors` | you only care about errors | filters by log level |
| `npm run traces` | you want trace CLI queries | session list, turns, stats |

### Evals

| Command | Use this when | Notes |
| --- | --- | --- |
| `npm run ci:evals:offline` | you want offline structural validation | no API key required |
| `npm run evals:critique` | you want judged action-quality feedback | replay + report |
| `npm run evals:perception` | you want perception critique runs | judge-backed |
| `npx tsx evals/cli.ts perception-validate` | you want perception contract validation | focused perception check |

## Development Notes

- Prefer `rg` for search.
- Prompt changes usually require `npm run build` because prompts are compiled into `src/prompts/generated.ts`.
- If docs disagree with code, update the docs after checking the runtime source of truth.
