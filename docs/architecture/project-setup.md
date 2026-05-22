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
corepack enable
corepack pnpm install
corepack pnpm run dev
corepack pnpm run dist
corepack pnpm test
corepack pnpm run verify
corepack pnpm run doctor
```

Advanced CI and release aliases remain available for tooling:

```bash
pnpm run ci:lint
pnpm run typecheck
pnpm run ci:test
pnpm run ci:build
pnpm run ci:dist
pnpm run ci:audit
pnpm run ci:local
pnpm run release:verify
pnpm run release:package
pnpm run release:preflight
pnpm run release:smoke:native-panel
```

## Prompts

Prompt templates live under `prompts/` and compile into the generated registry in `packages/prompts/src/generated.ts`.

```bash
pnpm run prompts:build
```

## Local Observability

OpenSidebar can write traces and logs for local debugging.

```bash
pnpm run dev
```

The trace viewer is available at `http://127.0.0.1:7589/viewer`.

## Configuration Notes

- Provider keys and model routing are configured from the Settings drawer.
- The runtime supports mixed provider lanes for executor, planner, perception, and TTS.
- Dev extension output is written to `dist-dev/` while `pnpm run dev` is running.
- Production/manual build output is written to `dist/`.
- `ci:dist` verifies the extension artifact, including manifest references, version alignment, side panel assets, trace viewer assets, service worker import, icons, content scripts, and Vite manifest.
- `ci:audit` checks production dependencies for known advisories.
- `release:package` builds `dist/`, then writes `.artifacts/releases/opensidebar-v<version>.zip`, a matching `.sha256` file, release notes, and an artifact manifest.
- `release:preflight` validates generated release artifacts, requires a clean working tree, reports tag/GitHub CLI readiness, and prints final publication commands.
- `release:smoke:native-panel` launches headed Chrome with the built extension and records native side-panel handshake evidence after a manual toolbar click.
