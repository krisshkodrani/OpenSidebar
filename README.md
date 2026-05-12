<p align="center">
  <img src="OpenSidebar.png" alt="OpenSidebar" width="128" />
</p>

<h1 align="center">OpenSidebar</h1>

<p align="center">
  <a href="https://github.com/krisshkodrani/OpenSidebar/actions/workflows/ci.yml"><img src="https://github.com/krisshkodrani/OpenSidebar/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js" /></a>
</p>

<p align="center">
  Open-source Chrome extension that turns your browser into an AI-powered agent.<br />
  Give it a task in plain English and it navigates, clicks, types, and completes multi-step workflows autonomously.<br />
  Bring your own provider key. No subscription, no telemetry, and an optional local backend for profile data and durable task state.
</p>

---

## What It Does

OpenSidebar runs an autonomous agent loop inside a Chrome side panel. You describe what you want done, and the agent perceives the page through vision and DOM snapshots, reasons about the next action, executes browser tools, and verifies progress until the task is complete.

For harder tasks, a planner decomposes the goal into subtasks, an executor handles each step, and a verifier confirms completion before moving on.

## Capabilities

**Automation** - Generic browser tools for clicking, typing, scrolling, selecting, tab management, uploads, downloads, and page reading.

**Intelligence** - Two-tier model architecture with automatic escalation, page perception, and recovery when the executor gets stuck.

**Orchestration** - Planner, executor, and verifier lanes for multi-step tasks, with plan confirmation and approval gates.

**Observability** - Full-fidelity traces, structured logs, and a built-in trace viewer.

**Privacy** - API keys stay in Chrome storage. No analytics or hosted relay.

## Quick Start

### Prerequisites

- Node.js 18+
- A supported provider API key

### Install

```bash
git clone https://github.com/krisshkodrani/OpenSidebar.git
cd OpenSidebar
npm install
npm run dist
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder

### Configure

1. Open the side panel.
2. Open **Settings**.
3. Add the provider key you want to use.

### Main Commands

Use npm scripts for day-to-day work. Nx is the internal task runner behind those scripts.

```bash
npm run dev      # Local services + trace viewer + loadable dev extension in dist-dev/
npm run dist     # Standalone production/manual extension build into dist/
npm test         # Extension and backend unit/integration tests
npm run verify   # Full local confidence gate before commit or push
npm run doctor   # Diagnose local setup and show next commands
```

Use `npm run dev` while working. When it prints the CRXJS instruction, load `dist-dev/` as the unpacked extension and keep the dev shell running.

Use `npm run dist` when you want a standalone extension build. It writes the loadable Chrome extension to `dist/`; load or reload that folder in Chrome.

`npm run dev` includes the local server/backend/log server and trace viewer at `http://127.0.0.1:7589/viewer`, plus the Vite/CRXJS dev process.

## Development

Main commands:

```bash
npm run dev                  # Local services + trace viewer + loadable dev extension in dist-dev/
npm run dist                 # Standalone production/manual extension build into dist/
npm test                     # Extension and backend unit/integration tests
npm run verify               # Lint, typecheck, tests, build, and dist check
npm run doctor               # Local setup diagnosis
```

Advanced commands:

```bash
npm run build                # Compatibility alias for npm run dist
npm run lint                 # ESLint
npm run typecheck            # TypeScript project checks
npm run e2e                  # Normal staged browser E2E sequence
npm run traces:compact       # Backfill SQLite, then delete raw traces older than 7 days
npm run fmt                  # Prettier
```

The package scripts are thin entry points over Nx targets. Use Nx directly when you want to run one target or project explicitly:

```bash
npx nx run extension:dev
npx nx run extension:build
npx nx run extension:test
npx nx run backend:test
npx nx run-many -t lint
npx nx run-many -t typecheck
```

## Testing

- Use staged E2E runs by default:
  - `npm run test:e2e:smoke` for cheap confidence on core browser-agent behavior
  - `npm run test:e2e:interactions` for page interaction and navigation regressions
  - `npm run test:e2e:runtime` for orchestration, continuation, recovery, and memory regressions
- Use `npm run test:e2e` or `npm run test:e2e:staged` for the normal budgeted sequence: smoke, interactions, then runtime.
- Use the WorkArena scripts directly for real benchmark preparation and handoff runs, for example `npx tsx scripts/workarena-doctor.ts` and `npx tsx scripts/workarena-handoff.ts --task workarena.servicenow.all-menu --seed 0 --allow-servicenow-reset`.
- Generated E2E reports are written locally under `.artifacts/e2e/`.

## Harness And Skill Philosophy

OpenSidebar uses benchmarks and fixtures to expose missing general browser-agent capabilities, not as targets for one-off shortcuts. The harness should stay thin: it can reset state, transfer sessions, collect traces, and validate outcomes, but product behavior belongs in the runtime, tools, controllers, prompts, or reusable skills.

For WorkArena and ServiceNow work, the goal is not to hardcode a 100% benchmark pass. The goal is to improve broad workflow classes: menu navigation, form fill and readback, list filters and sorting, dashboard/chart extraction, knowledge search, catalog checkout, multi-tab work, and sincere infeasible-task handling. WorkArena validation is the proof that these general capabilities work.

When a workflow is stable enough to teach, prefer a generic skill with sequencing, evidence expectations, and tool discipline. Site-specific or organization-specific procedures should eventually be user-authored custom skills, not hidden benchmark logic in the harness.

## Repo Layout

- `apps/extension/` - browser extension app, side panel UI, service worker, content script, trace viewer, and tests
- `apps/backend/` - local backend routes for profile data and durable task state
- `packages/shared-types/` - shared runtime and domain types
- `packages/prompts/` - compiled prompt runtime and generated prompt registry
- `prompts/` - prompt source templates
- `skills/` - reusable runtime workflow guidance and tool-discipline policies
- `scripts/` - repo-level build, observability, and maintenance scripts
- `docs/` - stable product and developer documentation
- `traces/` - local generated trace workspace used by debugging tools and the trace viewer

## Trace Viewer

Every agent session can be inspected in the built-in trace viewer.

```bash
npm run dev
```

Open `http://127.0.0.1:7589/viewer`.

Trace storage is split into a long-lived SQLite viewer store and short-lived raw debug files:

- `.artifacts/trace-index.sqlite` is the trace viewer store.
- `traces/` and `logs/` hold recent raw JSONL/screenshot evidence for local Codex/debug work.
- Raw files default to a 7-day retention window; SQLite keeps the queryable copy.

Maintenance commands:

```bash
npm run traces:index                # backfill or repair .artifacts/trace-index.sqlite
npm run traces:delete-old           # dry run; default raw-file window is 7 days
npm run traces:delete-old -- --apply # delete old raw files after SQLite coverage check
npm run traces:compact              # index, then delete old raw files
```

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Architecture Overview](./docs/architecture/overview.md)
- [Runtime Boundaries](./docs/architecture/runtime-boundaries.md)
- [Developer Guide](./docs/developer-guide.md)
- [Agent Loop](./docs/architecture/agent-loop.md)
- [Perception Layer](./docs/architecture/perception-layer.md)
- [Tools Reference](./docs/features/tools.md)
- [WorkArena Roadmap](./docs/evals/workarena-roadmap.md)
- [WorkArena Setup](./docs/evals/workarena.md)
- [WorkArena Major Full Run Checklist](./docs/evals/workarena-full-run-checklist.md)
- [Right Level Of Abstraction](./docs/guides/right-level-of-abstraction.md)
- [WorkArena Generalized Harness Philosophy](./docs/guides/workarena-generalized-harness-philosophy.md)
- [Personal Profile](./docs/personal-profile.md)
- [Release Checklist](./docs/release-checklist.md)

## Security & Privacy

- API keys are stored locally and only sent to configured providers.
- No telemetry or analytics.
- High-risk tools can require explicit approval.
- See [SECURITY.md](./SECURITY.md) and [PRIVACY_POLICY.md](./PRIVACY_POLICY.md).

## License

MIT. See [LICENSE](./LICENSE).
