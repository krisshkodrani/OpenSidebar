# Developer Guide

This is the quickest accurate map of the current codebase.

## Start Here

Most development work starts with the same small command set:

```bash
pnpm run dev      # run the local app stack
pnpm run dist     # build the standalone unpacked extension
pnpm test         # run fast tests
pnpm run verify   # run the full local confidence gate
pnpm run doctor   # diagnose local setup
```

After that, development work usually falls into one of these workflows:

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
pnpm run dev
```

What it starts:

- local server/backend/log server
- trace viewer at `http://127.0.0.1:7589/viewer`
- Vite/CRXJS dev process
- loadable dev extension output in `dist-dev/`

For manual dev testing, load `dist-dev/` in `chrome://extensions/` after `pnpm run dev` prints the CRXJS instruction. Keep that shell running while testing.

For a standalone production/manual extension build, run:

```bash
pnpm run dist
```

Then load or reload the unpacked extension from `dist/` in `chrome://extensions/`.

### Run fast tests

When to use this:
Validate normal code changes without launching Chrome.

```bash
pnpm test
```

Run a single file:

```bash
pnpm exec vitest run --config apps/extension/vitest.config.ts apps/extension/tests/background/tools.test.ts
```

### Run E2E tests

When to use this:
Validate real browser behavior with the built extension and live agent loop.

Prerequisites:

- `FIREWORKS_API_KEY` by default, unless `E2E_PROVIDER` points at another configured provider
- `XIAOMI_API_KEY` when `E2E_PROVIDER=xiaomi`
- successful build assets

```bash
pnpm run test:e2e:staged
```

Related surfaces:

- fixtures in `apps/extension/tests/e2e/fixtures/`
- helper utilities in `apps/extension/tests/e2e/helpers/`
- local reports in `.artifacts/e2e/e2e-report-YYYY-MM-DD.md`
- E2E config defaults in `apps/extension/tests/e2e/helpers/e2e-config.ts`

The supported public E2E environment surface is intentionally small:

| Env var | Purpose |
| --- | --- |
| `E2E_PROFILE` | Selects defaults: `local`, `ci`, `debug`, `video`, or `headed`. |
| `E2E_PROVIDER` | Selects the agent provider. Default is `fireworks`. |
| `E2E_MODEL` | Overrides the executor model for focused runs. |
| `E2E_PERCEPTION_MODE` | Selects perception mode, for example `unified_vl`. |
| `E2E_SUITE_FLAGS` | Comma-separated optional gates such as `backend-durable`, `backend-profile`, `memory-long`, `diagnostic`, or `single-process`. |
| `E2E_ARTIFACTS` | Comma-separated artifact/browser flags such as `video`, `screenshots`, `panel`, `detached-panel`, `no-panel`, `headed`, or `headless`. |

Older `E2E_*` names are temporary compatibility aliases and should not be used in new commands.

Routine E2E is divided by purpose rather than difficulty:

| Suite              | Command                                  | Purpose                                                                                          |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Smoke              | `pnpm run test:e2e:smoke`                 | Cheap confidence for core browser-agent behavior                                                 |
| Interactions       | `pnpm run test:e2e:interactions`          | Page interaction, navigation, overlays, form, and shopping regressions                           |
| Runtime            | `pnpm run test:e2e:runtime`               | Planning, continuation, recovery, and durable state regressions                                  |
| WorkArena setup    | `pnpm exec tsx scripts/workarena-doctor.ts`    | Local WorkArena readiness and gated dataset access checks                                       |
| WorkArena handoff  | `pnpm exec tsx scripts/workarena-handoff.ts`   | Manual real ServiceNow handoff run; requires explicit reset flag                                |

### Inspect traces and logs

When to use this:
Debug tool execution, planner/executor behavior, or E2E failures.

```bash
pnpm run dev
pnpm run traces
```

Viewer:

- `http://127.0.0.1:7589/viewer`

Trace retention:

- SQLite is the viewer store: `.artifacts/trace-index.sqlite`.
- Hot raw evidence in `traces/` and `logs/` is kept for local Codex/debug work.
- The default raw-file window is 7 days.
- Trace endpoints ingest into SQLite in real time; `traces:index` is the repair/backfill path.

Maintenance commands:

```bash
pnpm run traces:index                # backfill or repair SQLite from raw JSONL
pnpm run traces:delete-old           # dry run: raw files older than 7 days
pnpm run traces:delete-old -- --apply # delete old raw files after SQLite coverage check
pnpm run traces:compact              # index, then delete old raw files
```

## Current Runtime

- side panel UI: React 18 + Zustand
- service worker: agent loop, orchestrator, tool routing, tracing
- content script: DOM tagging, snapshots, page actions
- prompts: compiled prompt registry under `packages/prompts/`

## Current Model Defaults

| Role                  | Default                                      |
| --------------------- | -------------------------------------------- |
| Provider stack        | `fireworks`                                  |
| Executor              | `accounts/fireworks/routers/kimi-k2p6-turbo` |
| Executor fallback     | `accounts/fireworks/routers/kimi-k2p6-turbo` |
| Planner               | `accounts/fireworks/routers/kimi-k2p6-turbo` |
| Perception            | `unified_vl` by default; structured fallback is provider-specific |

Settings overrides live in `apps/extension/src/types/settings.ts` and are exposed in the settings drawer.
Xiaomi MiMo is available as `providerMode: "xiaomi"` for agent executor/planner traffic. It uses `XIAOMI_API_KEY`, `mimo-v2-omni` for the multimodal executor, and `mimo-v2-pro` as the default planner.

## Observation Path

- source of truth setting: `perceptionMode`
- `auto`: unified VL
- `unified_vl`: screenshot goes directly to the executor and no separate `Page Interpretation` model runs
- `structured`: dedicated perception model produces the v6 `LOCATION/CHANGES/BLOCKERS/VISUAL-ONLY/AFFORDANCES` contract

When debugging traces, do not assume every screenshot-backed turn used the structured perception layer. Check the recorded perception mode first.

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

Structured perception uses the unified v6 contract:

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
- backend service: scheduled task and durable run support

### E2E harness

- Vitest config: `apps/extension/tests/e2e/vitest.e2e.config.ts`
- global startup: `apps/extension/tests/e2e/global-setup.ts`
- reusable harness: `apps/extension/tests/e2e/helpers/harness.ts`
- fixture serving: `scripts/serve-fixtures.ts`

### Tracing and logs

- log server: `scripts/log-server.ts`
- trace viewer: `apps/extension/src/trace-viewer/`
- trace files: `traces/`
- query CLI: `pnpm run traces`

## Command Reference

### Local development

| Command         | Use this when                         | Notes                                        |
| --------------- | ------------------------------------- | -------------------------------------------- |
| `pnpm run dev`   | you want the main local stack running | starts local services, trace viewer, Vite/CRXJS, and writes `dist-dev/` |
| `pnpm run dist`  | you need standalone extension assets | writes `dist/` for Chrome Load unpacked    |
| `pnpm test`      | you want fast local tests             | extension + backend unit/integration tests   |
| `pnpm run verify` | you want pre-commit confidence       | lint + typecheck + tests + build + dist check |
| `pnpm run doctor` | you want setup diagnosis             | checks deps, builds, local server, and trace DB |

Advanced local commands:

| Command         | Use this when                         | Notes                                        |
| --------------- | ------------------------------------- | -------------------------------------------- |
| `pnpm run build` | you want the production build name    | runs the extension production build           |
| `pnpm run lint`  | you want a lint pass                  | source-focused ESLint run                    |
| `pnpm run typecheck` | you want TypeScript project checks | all typecheck targets                        |
| `pnpm run fmt`   | you want formatting only              | formats extension source and shared packages |

The pnpm package scripts are the stable day-to-day entry points. Use direct Nx commands when you need to address a specific project target:

| Command                    | Use this when                              |
| -------------------------- | ------------------------------------------ |
| `pnpm exec nx run extension:dev` | you only want the extension dev target     |
| `pnpm exec nx run extension:build` | you only want the extension production build |
| `pnpm exec nx run extension:test` | you only want extension unit/integration tests |
| `pnpm exec nx run backend:test`  | you only want backend tests                |
| `pnpm exec nx run-many -t lint`  | you want all lint targets                  |
| `pnpm exec nx run-many -t typecheck` | you want all typecheck targets          |

### Tests

| Command                      | Use this when                             | Notes                                          |
| ---------------------------- | ----------------------------------------- | ---------------------------------------------- |
| `pnpm test`                   | you want the normal fast test suite       | extension and backend tests; excludes browser E2E |
| `pnpm run test:backend`       | you changed backend routes or persistence | backend-only Vitest run                        |
| `pnpm run test:e2e`           | you need the normal budgeted E2E sequence | alias for staged E2E                           |
| `pnpm run test:e2e:smoke`     | you need cheap real-browser confidence    | uses Fireworks by default                      |
| `pnpm run test:e2e:staged`    | you need the normal budgeted E2E sequence | smoke + interactions + runtime                 |
| `pnpm exec tsx scripts/workarena-first-task.ts` | you need a safe first real WorkArena candidate | metadata-only; no reset or LLM calls |
| `pnpm exec tsx scripts/workarena-category-coverage.ts` | you need to verify local analog coverage for every WorkArena category | metadata-only; writes `.artifacts/e2e/` report |
| `pnpm exec tsx scripts/workarena-handoff.ts` | you need a manual real WorkArena handoff run | requires `--allow-servicenow-reset`; token-spending |
| `pnpm exec tsx scripts/workarena-validate-reports.ts` | you need to validate WorkArena JSON reports | no ServiceNow or LLM calls |
| `pnpm run verify`             | you want the local confidence gate        | lint + typecheck + tests + build + dist check  |
| `pnpm run ci:local`           | you want the CI-equivalent local gate     | lint + typecheck + tests + build + dist check  |
| `pnpm run release:verify`     | you want release confidence              | lint + typecheck + tests + build + dist check + production dependency audit |
| `pnpm run release:package`    | you want release artifacts               | builds `dist/`, then writes `.artifacts/releases/` zip, SHA-256 checksum, notes, and manifest |
| `pnpm run release:preflight`  | you want to check release artifacts before tagging | validates artifact hash/version/commit consistency, reports native-smoke/tag/GitHub readiness, requires a clean working tree, and prints publication commands |
| `pnpm run release:smoke:native-panel` | you want the manual Chrome side-panel gate | launches headed Chrome with `dist/`, waits for a toolbar click, and writes evidence under `.artifacts/e2e/native-sidepanel/` |
| `pnpm exec vitest run <file>`      | you want one focused test file            | useful during iteration                        |

For the path from guarded WorkArena smoke runs to category-balanced graded evaluation, see [WorkArena Roadmap](./evals/workarena-roadmap.md).

### Observability

| Command               | Use this when                            | Notes                             |
| --------------------- | ---------------------------------------- | --------------------------------- |
| `pnpm run dev`         | you want the log server and trace viewer | viewer at `127.0.0.1:7589/viewer` |
| `pnpm run logs:tail`   | you want recent logs quickly             | last 50 entries                   |
| `pnpm run logs:errors` | you only care about errors               | filters by log level              |
| `pnpm run traces`      | you want trace CLI queries               | session list, turns, stats        |
| `pnpm run traces:index` | you want to backfill or repair the SQLite trace store | writes `.artifacts/trace-index.sqlite` |
| `pnpm run traces:delete-old` | you want to preview 7-day raw-file deletion | dry run by default |
| `pnpm run traces:compact` | you want normal trace maintenance | indexes, then deletes old raw files after coverage checks |

## Development Notes

- Prefer `rg` for search.
- Prompt changes usually require `pnpm run dist` because prompts are compiled into `packages/prompts/src/generated.ts`.
- If docs disagree with code, update the docs after checking the runtime source of truth.
