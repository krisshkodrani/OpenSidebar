# CLAUDE.md

Repository guide for coding agents working on OpenSidebar.

## Core Commands

```bash
npm run dev        # Extension dev stack + log server + trace viewer
npm run build      # Production build
npm run lint       # ESLint for src/
npm test           # Vitest suite
npm run test:e2e   # Real-browser E2E tests
npm run fixtures   # Serve local fixture pages

npm run logs       # Start log server + trace viewer
npm run logs:tail  # Tail structured logs
npm run logs:errors
npm run traces     # Trace query CLI

npm run prompts:build
npm run prompts:check
```

## E2E Reports

When writing an E2E summary, use:

- `docs/e2e-report-YYYY-MM-DD.md`

Do not create or update an undated `docs/e2e-report.md`.

Use this structure:

1. `# E2E Final Report`
2. `Date: YYYY-MM-DD`
3. `Scope: ...`
4. `Overall result: ...`
5. A table with `Case`, `Success`, `Turns`, `Perceptions`, `Traces`, `Prompt used`
6. `## Metric Definitions`
7. `## Stability Notes`

## Architecture

OpenSidebar is a Manifest V3 Chrome extension with three contexts:

```text
Side Panel <-> Service Worker <-> Content Script
```

- `src/background/`: agent loop, orchestrator, provider routing, tool dispatch
- `src/content/`: DOM tagging, snapshots, actions
- `src/sidepanel/`: React UI, chat, settings, approvals, progress
- `src/trace-viewer/`: trace inspection UI
- `src/prompts/`: compiled prompt registry

## Active Product Surface

- Planner, executor, and verifier lanes
- Provider routing across OpenRouter, OpenAI, Groq, and Fireworks
- Trace recording and structured logs
- Real-browser E2E fixtures under `tests/e2e/`

## Cleanup Principle

Prefer removing dead compatibility layers over keeping stale UI, tests, or docs alive.

If a feature no longer has a backend path:

- remove the UI affordance
- remove the tests that still advertise it
- update the docs in the same change
