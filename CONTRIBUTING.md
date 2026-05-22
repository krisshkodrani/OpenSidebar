# Contributing to OpenSidebar

This repository has been trimmed to focus on the extension, the trace/logging workflow, and the active test surface.

## Development Setup

1. Fork the repository.
2. Clone your fork.
3. Use Node.js 22+.
4. Run `corepack pnpm install`.
5. Copy `.env.example` to `.env` if you want local provider-backed runs.
6. Run `pnpm run dev`.

`pnpm run dev` starts the extension build, the unified local server, and the trace viewer.

## Command Reference

| Command | Description |
| --- | --- |
| `pnpm run dev` | Extension dev stack + local backend/logs + trace viewer |
| `pnpm run build` | Production build |
| `pnpm test` | Extension unit and integration suite |
| `pnpm run test:backend` | Backend Vitest suite |
| `pnpm run lint` | ESLint for extension, backend, packages, and scripts |
| `pnpm run fmt` | Prettier for extension source and packages |
| `pnpm run logs` | Start unified local server + trace viewer |
| `pnpm run logs:tail` | Tail recent structured logs |
| `pnpm run logs:errors` | Show error-level logs |
| `pnpm run traces` | Trace query CLI |
| `pnpm run fixtures` | Serve local E2E/demo fixtures |
| `pnpm run test:e2e` | Build + real-browser E2E tests |
| `pnpm run release:verify` | Release gate: lint, typecheck, tests, build, dist check, and production dependency audit |
| `pnpm run release:package` | Create the release zip, SHA-256 checksum, notes, and manifest from `dist/` |
| `pnpm run release:preflight` | Validate release artifact hash, version, commit, and publication readiness before tagging |

## Testing

Use this as the normal validation loop:

```bash
pnpm run ci:lint
pnpm run ci:test
pnpm run ci:build
```

Run E2E only when you need browser-level validation:

```bash
pnpm run test:e2e
```

For browser-agent bugs, include the provider mode, model overrides, task prompt, URL shape, screenshots if safe, and whether a local trace or E2E report is available. Redact page data, credentials, cookies, and API keys before attaching diagnostics.

## Observability

OpenSidebar keeps the trace/logging workflow:

- Structured logs drain to `logs/`
- Session traces drain to `traces/`
- The trace viewer is served at `http://127.0.0.1:7589/viewer`

Useful commands:

```bash
pnpm run logs
pnpm run logs:tail
pnpm run logs:errors
pnpm run traces -- list
```

## Architecture

The active product surface is:

- `apps/extension/src/background/`: agent loop, orchestrator, model routing, tool dispatch
- `apps/extension/src/content/`: DOM tagging, snapshots, page actions
- `apps/extension/src/sidepanel/`: React UI, chat, settings, approvals, progress
- `apps/extension/src/trace-viewer/`: trace inspection UI
- `apps/backend/src/`: local backend routes for profile data and durable task state
- `packages/shared-types/`: shared runtime and domain contracts
- `packages/prompts/`: prompt runtime and generated prompt assets

## Contribution Notes

- Prefer removing stale features over preserving dead compatibility layers.
- Keep docs aligned with the shipped product and current scripts.
- Keep BYOK provider, privacy, safety-gate, and permission claims aligned across README, privacy, security, and release docs.
- Do not add UI affordances for features that no longer have a backend path.
- When removing functionality, also remove tests and documentation that keep advertising it.
