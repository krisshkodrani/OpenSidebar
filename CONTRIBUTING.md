# Contributing to OpenSidebar

This repository has been trimmed to focus on the extension, the trace/logging workflow, and the active test surface.

## Development Setup

1. Fork the repository.
2. Clone your fork.
3. Run `npm install`.
4. Copy `.env.example` to `.env` if you want local provider-backed runs.
5. Run `npm run dev`.

`npm run dev` starts the extension build, the local log server, and the trace viewer.

## Command Reference

| Command | Description |
| --- | --- |
| `npm run dev` | Extension dev stack + logs + trace viewer |
| `npm run build` | Production build |
| `npm test` | Vitest suite |
| `npm run lint` | ESLint for `src/` |
| `npm run fmt` | Prettier for `src/` |
| `npm run logs` | Start log server + trace viewer |
| `npm run logs:tail` | Tail recent structured logs |
| `npm run logs:errors` | Show error-level logs |
| `npm run traces` | Trace query CLI |
| `npm run fixtures` | Serve local E2E/demo fixtures |
| `npm run test:e2e` | Build + real-browser E2E tests |

## Testing

Use this as the normal validation loop:

```bash
npm run lint
npm test
npm run build
```

Run E2E only when you need browser-level validation:

```bash
npm run test:e2e
```

## Observability

OpenSidebar keeps the trace/logging workflow:

- Structured logs drain to `logs/`
- Session traces drain to `traces/`
- The trace viewer is served at `http://127.0.0.1:7589/viewer`

Useful commands:

```bash
npm run logs
npm run logs:tail
npm run logs:errors
npm run traces -- list
```

## Architecture

The active product surface is:

- `src/background/`: agent loop, orchestrator, model routing, tool dispatch
- `src/content/`: DOM tagging, snapshots, page actions
- `src/sidepanel/`: React UI, chat, settings, approvals, progress
- `src/trace-viewer/`: trace inspection UI

## Contribution Notes

- Prefer removing stale features over preserving dead compatibility layers.
- Keep docs aligned with the shipped product and current scripts.
- Do not add UI affordances for features that no longer have a backend path.
- When removing functionality, also remove tests and documentation that keep advertising it.
