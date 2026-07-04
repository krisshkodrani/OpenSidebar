# OpenSidebar Extension

The Chrome (Manifest V3) extension — the whole product lives in this app. The
repo root [README](../../README.md) covers install and usage; this file
orients you inside the source.

## Runtime contexts

Three isolated contexts communicate via `chrome.runtime` messages using the
`RuntimeMessage` discriminated union in
[`packages/shared-types/src/messages.ts`](../../packages/shared-types/src/messages.ts):

| Context | Entry point | What it does |
| --- | --- | --- |
| Service worker | `src/background/background.ts` | Agent runtime: orchestrator, agent loop, tools, LLM client, checkpoints |
| Content script | `src/content/content.ts` | DOM snapshotting, element tagging, page actions (`src/content/actions/`) |
| Side panel | `src/sidepanel/index.tsx` | React/Zustand chat UI; message routing in `sidepanel/bridge.ts` |

Dev-only surfaces that never ship in the production build: the trace viewer
(`src/trace-viewer/`, served from dev builds against the local log-server) and
the e2e helper pages (`tests/e2e/assets/`).

## Where the agent logic lives

- `src/background/orchestrator/` — task planning, node execution, verification
- `src/background/agent/` — the agent loop, completion kernel, policies
- `src/background/tools/` — tool definitions + executors; platform-specific
  logic is quarantined in adapters (e.g. `tools/servicenow/`)
- `src/background/llm/` — provider pools, streaming, failover
- `src/background/perception/` — page perception (unified-VL and structured)

Read the repo root `CLAUDE.md` "Landmines" section before editing the large
files in `agent/` and `tools/`.

## Build and test

```bash
pnpm run dev        # dev build → dist-dev/ (HMR, load this in Chrome for dev)
pnpm run dist       # production build → dist/
pnpm test           # unit/integration tests (Vitest, no API key needed)
pnpm run test:e2e   # real-browser E2E (needs a provider key)
```

Run one test file:

```bash
pnpm exec vitest run --config apps/extension/vitest.config.ts <path>
```
