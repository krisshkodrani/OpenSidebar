# Repo Structure

OpenSidebar now uses a lightweight app-and-packages layout while keeping root developer commands intact.

## Current Layout

- `apps/extension/`: the browser extension app
- `apps/backend/`: the local backend service
- `packages/shared-types/`: shared runtime and domain types
- `packages/prompts/`: prompt runtime and generated prompt registry
- `prompts/`: prompt source templates
- `scripts/`: repo-level developer scripts
- `docs/`: product, architecture, and release documentation
- `traces/`: local run traces

## How The Pieces Fit

- The extension is the main product surface and owns:
  - service worker runtime
  - content script
  - shared side panel UI
  - overlay harness
  - trace viewer
  - extension tests and E2E harness
- The backend is an app-local service used for:
  - task scheduling
  - durable run state
  - backend health and task APIs
- Shared packages keep cross-app contracts stable:
  - `packages/shared-types/` for shared types
  - `packages/prompts/` for prompt helpers and generated prompt assets
- Prompt source files remain under `prompts/` and compile into `packages/prompts/src/generated.ts`

## Build And Test Entry Points

From the repo root:

- `npm run dev`: extension dev stack with logs, trace viewer, and loadable `dist-dev/`
- `npm run dist`: production/manual extension build into `dist/`
- `npm test`: extension unit and integration tests
- `npm run verify`: local confidence gate for lint, typecheck, tests, build, and dist validation
- `npm run doctor`: setup diagnosis for new users and coding agents

Advanced aliases remain available for targeted work:

- `npm run build`: compatibility alias for `npm run dist`
- `npm run test:backend`: backend tests
- `npm run test:e2e`: browser E2E validation
- `npm run ci:local`: compatibility alias for `npm run verify`
- `npm run release:verify`: release alias for `npm run verify`

Use direct Nx commands for project-scoped work:

- `npx nx run extension:dev`: extension dev target
- `npx nx run extension:build`: extension production build
- `npx nx run extension:test`: extension unit and integration tests
- `npx nx run backend:test`: backend tests
- `npx nx run-many -t lint`: all lint targets
- `npx nx run-many -t typecheck`: all typecheck targets

## Compatibility Notes

- Root `vite.config.ts` and `vitest.config.ts` remain as thin shims so existing root commands still work.
- The production build still emits the extension artifact to root `dist/` because the load-unpacked and E2E flows depend on that location.
- Some extension compatibility wrappers still exist under `apps/extension/src/prompts/` and `apps/extension/src/types/` to avoid a mass import rewrite while the repo settles.
- Side panel UI code is shared between the Chrome side panel and the overlay harness. Components use `apps/extension/src/sidepanel/runtime.ts` for runtime, tab, permission, and storage access; direct Chrome API calls belong in the Chrome-backed adapter or production shell code.
