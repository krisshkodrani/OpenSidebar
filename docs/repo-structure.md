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

- `pnpm run dev`: extension dev stack with logs, trace viewer, and loadable `dist-dev/`
- `pnpm run dist`: production/manual extension build into `dist/`
- `pnpm test`: extension unit and integration tests
- `pnpm run verify`: local confidence gate for lint, typecheck, tests, build, and dist validation
- `pnpm run doctor`: setup diagnosis for new users and coding agents

Advanced aliases remain available for targeted work:

- `pnpm run build`: production extension build
- `pnpm run test:backend`: backend tests
- `pnpm run test:e2e`: browser E2E validation
- `pnpm run ci:local`: CI-equivalent local confidence gate
- `pnpm run release:verify`: release confidence gate, including production dependency audit
- `pnpm run release:package`: release zip, SHA-256 checksum, notes, and manifest under `.artifacts/releases/`
- `pnpm run release:preflight`: release artifact/version/commit validation and publication-readiness warnings before tagging
- `pnpm run release:smoke:native-panel`: assisted headed Chrome smoke for the native side-panel launch path

Use direct Nx commands for project-scoped work:

- `pnpm exec nx run extension:dev`: extension dev target
- `pnpm exec nx run extension:build`: extension production build
- `pnpm exec nx run extension:test`: extension unit and integration tests
- `pnpm exec nx run backend:test`: backend tests
- `pnpm exec nx run-many -t lint`: all lint targets
- `pnpm exec nx run-many -t typecheck`: all typecheck targets

## Compatibility Notes

- Root `vite.config.ts` and `vitest.config.ts` remain as thin shims so existing root commands still work.
- The production build still emits the extension artifact to root `dist/` because the load-unpacked and E2E flows depend on that location.
- Some extension compatibility wrappers still exist under `apps/extension/src/prompts/` and `apps/extension/src/types/` to avoid a mass import rewrite while the repo settles.
- Side panel UI code is shared between the Chrome side panel and the overlay harness. Components use `apps/extension/src/sidepanel/runtime.ts` for runtime, tab, permission, and storage access; direct Chrome API calls belong in the Chrome-backed adapter or production shell code.
