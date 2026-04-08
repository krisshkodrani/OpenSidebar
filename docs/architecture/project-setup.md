# Project Setup

This document describes the active build, test, and runtime setup for OpenSidebar.

## Stack

- Chrome Manifest V3 extension
- Vite 5 with `@crxjs/vite-plugin`
- React 18 for the side panel
- TypeScript in strict mode
- Tailwind CSS for styling
- Vitest for automated tests

## Main Directories

```text
opensidebar/
|- src/
|  |- background/    # service worker, agent loop, orchestrator, providers
|  |- content/       # page snapshotting, tagging, DOM actions
|  |- prompts/       # prompt registry and generated prompt bundle
|  |- sidepanel/     # React UI, hooks, Zustand store
|  |- trace-viewer/  # local trace viewer UI
|  `- types/         # shared TypeScript contracts
|- tests/            # unit and integration tests
|- scripts/          # build and maintenance scripts
|- docs/             # product and architecture documentation
|- traces/           # local trace output
`- logs/             # local structured logs
```

## Core Commands

```bash
npm install
npm run dev
npm run build
npm run ci:lint
npm run ci:test
npm run ci:build
```

## Prompts

Prompt templates live under `prompts/` and compile into the generated registry in `src/prompts/generated.ts`.

```bash
npm run prompts:build
```

## Local Observability

OpenSidebar can write traces and logs for local debugging.

```bash
npm run logs
```

The trace viewer is available at `http://127.0.0.1:7589/viewer`.

## Configuration Notes

- Provider keys and model routing are configured from the Settings drawer.
- The runtime supports mixed provider lanes for executor, planner, perception, and TTS.
- Build output is written to `dist/`.
