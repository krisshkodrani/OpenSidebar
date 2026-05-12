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
|- apps/
|  |- extension/
|  |  |- src/        # service worker, content script, side panel, trace viewer
|  |  `- tests/      # extension unit, integration, and E2E tests
|  `- backend/
|     |- src/        # backend routes, services, persistence
|     `- tests/      # backend tests
|- packages/
|  |- prompts/       # prompt runtime and generated prompt bundle
|  `- shared-types/  # shared TypeScript contracts
|- scripts/          # build and maintenance scripts
|- prompts/          # prompt source templates
|- docs/             # product and architecture documentation
|- traces/           # local trace output
`- logs/             # local structured logs
```

## Core Commands

```bash
npm install
npm run dev
npm run dist
npm run ci:lint
npm run typecheck
npm run ci:test
npm run ci:build
npm run ci:dist
npm run ci:local
npm run test:backend
npm run release:verify
```

## Prompts

Prompt templates live under `prompts/` and compile into the generated registry in `packages/prompts/src/generated.ts`.

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
- Dev extension output is written to `dist-dev/` while `npm run dev` is running.
- Production/manual build output is written to `dist/`.
- `ci:dist` verifies the extension artifact, including manifest references, side panel assets, trace viewer assets, service worker import, icons, content scripts, and Vite manifest.
