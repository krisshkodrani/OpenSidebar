# OpenSidebar

[![CI](https://github.com/krisshkodrani/OpenSidebar/actions/workflows/ci.yml/badge.svg)](https://github.com/krisshkodrani/OpenSidebar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

An open-source Chrome extension that turns your browser into an AI-powered agent workspace.

OpenSidebar can navigate, read, click, type, and research across web pages from a side panel. It uses a two-tier LLM architecture: an executor model (`gpt-oss-120b`) for quick observe → act cycles, with escalation to a planner model (`deepseek-v3.2`) when tasks get harder. All inference runs through OpenRouter.

<!-- Add screenshots to docs/screenshots/ and uncomment the relevant lines below -->
<!-- ![Side Panel](docs/screenshots/sidepanel.png) -->
<!-- ![Trace Viewer](docs/screenshots/trace-viewer.png) -->

---

## Features

- Browser automation via natural language (click, type, scroll, navigate).
- Visual DOM understanding with Vimium-style element tags (`[1]`, `[2]`, ...).
- Perception layer — vision-based page understanding (Gemini 2.5 Flash via OpenRouter).
- Two-tier model execution with automatic escalation when needed.
- Runtime lane isolation in the orchestrator (planner, executor, verifier).
- Demo recording and replay for repeatable workflows.
- Saved prompts and prompt management.
- Auto-managed workspaces using Chrome Tab Groups.
- Per-tab sidebar behavior (open on click, auto-close on tab switch).
- Navigation survival across page loads and service-worker lifecycle changes.
- Real-time streaming responses.

---

## Architecture

```text
Side Panel (React) <-> Service Worker (Agent Loop / Orchestrator) <-> Content Script (DOM)
```

| Component | Technology |
| --- | --- |
| Executor LLM | `openai/gpt-oss-120b` via OpenRouter |
| Planner LLM | `deepseek/deepseek-v3.2` via OpenRouter |
| Perception | Gemini 2.5 Flash via OpenRouter |
| UI | React 18 + Tailwind CSS |
| Build | Vite + `@crxjs/vite-plugin` |

### Orchestrator Runtime Lanes

The orchestrator runs isolated runtime lanes per workspace:

- `planner` lane: low concurrency, isolates quickly on repeated failures.
- `executor` lane: high concurrency for throughput.
- `verifier` lane: high concurrency with stricter failure isolation than executor.

Each lane tracks active calls, total calls, failures, cumulative runtime, and cooldown isolation state. Lane isolation emits `AGENT_STEP` warnings so containment is visible in the UI timeline.

Lane policy overrides are wired through `OrchestratorDeps.lanePolicies`; explicit overrides win, then runtime defaults derived from `maxWorkers`, then lane base defaults.

Complete technical documentation: [docs/architecture/](./docs/architecture/)

---

## Quick Start

### Prerequisites

- Node.js 18+
- OpenRouter API key ([openrouter.ai](https://openrouter.ai))

### Install and Build

```bash
git clone https://github.com/krisshkodrani/OpenSidebar.git
cd OpenSidebar
npm install
npm run build
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click Load unpacked
4. Select the `dist/` folder

### Development

Use `npm run dev` — it builds the extension, starts the log/trace server, and launches Vite with HMR, all in one process:

```bash
npm run dev
```

A `Makefile` is included for convenience — run `make help` to see all targets.

### Configure

1. Click the OpenSidebar icon to open the side panel.
2. Open Settings.
3. Enter your OpenRouter API key.

---

## Commands

All commands are available via `npm run <script>` or `make <target>`. Run `make help` for a quick reference.

### Day-to-day

| Command | Description |
| --- | --- |
| `npm run dev` | **Recommended.** Build + log server + Vite HMR. Traces captured automatically. |
| `npm run build` | Production build only |
| `npm test` | Run all tests (Vitest) |
| `npm run lint` | Run ESLint |
| `npm run fmt` | Format source files |

### Logs & Traces

| Command | Description |
| --- | --- |
| `npm run logs` | Start log drain server + trace viewer (port 7589) |
| `npm run logs:tail` | Tail recent log entries |
| `npm run logs:errors` | Show error-level logs |
| `npm run traces` | Trace query CLI (`list`, `show`, `turns`, `stats`, `help`) |

### Evals

| Command | Description |
| --- | --- |
| `npm run evals` | Eval CLI help (shows all subcommands) |
| `npm run evals:critique` | Replay golden cases + judge + generate report |
| `npm run evals:validate` | Structural validation of golden cases (offline, no API key) |
| `npm run evals:perception` | Perception layer evaluation |
| `npm run evals:planner` | Planner evaluation |
| `npm run evals:context` | Context management evaluation |
| `npm run evals:stagnation` | Stagnation detection evaluation |

When `npm run logs` (or `npm run dev`) is active, execution traces are persisted under:
- `traces/<session-id>.jsonl` (agent turn traces)
- `traces/runs/<run-id>.jsonl` (orchestrator run traces)
- `traces/index.jsonl` (manual run session index)
- `traces/runs/index.jsonl` (orchestrator run index)

### Trace Viewer UI

OpenSidebar includes a built-in React trace viewer (`src/trace-viewer/`):
- Server/API: `scripts/log-server.ts`
- URL: `http://127.0.0.1:7589/viewer`

Start it:
1. Run `npm run logs` (or `npm run dev`).
2. Open `http://127.0.0.1:7589/viewer`.

What you can inspect:
- Session list with outcome, turns, model badges, cost, timestamps
- Per-turn cards with:
  - LLM text/tool calls
  - tool execution results/errors
  - snapshot URL/title/tagged elements
  - events (`stuck_signal`, `escalation`, `done_rejected`, etc.)
  - token usage, duration, compression level

Useful API endpoints (served by the same process):
- `GET /api/traces` -> list sessions
- `GET /api/traces/:sessionId` -> list turn entries for one session

### Manual Runs: Where Logs Come From

Yes, manual browser runs produce logs.

- Always-on buffer: structured logs are written to `chrome.storage.local` (`opensidebar_logs`) via `StorageLogger`.
- Optional disk persistence: if `npm run logs` is running, the extension also drains logs/traces to local files:
  - `logs/opensidebar.jsonl`
  - `traces/<session-id>.jsonl`
  - `traces/runs/<run-id>.jsonl`

### How Info Is Extracted

1. Start drain server in a terminal:
   - `npm run logs`
2. Run your task manually in Chrome (open side panel, execute workflow).
3. Inspect raw logs/traces:
   - `npm run logs:tail`
   - `npm run traces -- list`
   - `npm run traces -- stats`
4. Convert captured traces into eval cases:
   - `npx tsx evals/cli.ts convert <session-id> --strategy all`
5. Generate AI-readable critique artifacts:
   - `npm run evals:critique`

If you forgot to start `npm run logs`, you can still export buffered logs from the side panel:
- `Settings -> Export Logs` downloads `opensidebar-logs.jsonl`.

---

## Documentation

### User Guides

- [Features Overview](./docs/features/)
- [Browser Automation](./docs/features/browser-automation.md)
- [Workspace Management](./docs/features/workspace-management.md)
- [Streaming UI](./docs/features/streaming-ui.md)
- [Security and Privacy](./docs/features/security.md)

### Technical Architecture

- [Architecture Overview](./docs/architecture/overview.md)
- [Agent Loop](./docs/architecture/agent-loop.md)
- [Fast-Smart Collaboration](./docs/architecture/fast-smart-collaboration.md)
- [Message Protocol](./docs/architecture/message-protocol.md)
- [Types Reference](./docs/architecture/types-reference.md)
- [Orchestrator RFCs](./docs/rfc/orchestrator/)

### Development

- [RFCs](./docs/rfc/)
- [Evals Program Guide](./docs/guides/evals-program.md)
- [Manual Evals Runbook](./docs/guides/manual-evals-runbook.md)
- [Evals Manual Workflow](./evals/README.md)
- [Contributing Guide](./CONTRIBUTING.md)

---

## Repository

- Repository: [github.com/krisshkodrani/OpenSidebar](https://github.com/krisshkodrani/OpenSidebar)
- Issues: [github.com/krisshkodrani/OpenSidebar/issues](https://github.com/krisshkodrani/OpenSidebar/issues)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and contribution workflow.

1. Fork the repository.
2. Create a branch (`git checkout -b feature/my-feature`).
3. Commit your changes.
4. Push your branch.
5. Open a pull request.

---

## Security

See [SECURITY.md](SECURITY.md) for the security policy.

- API keys are stored in `chrome.storage.sync`.
- All data stays in local browser storage.
- No telemetry or analytics by default.
- URL sanitization blocks non-http(s) protocols.

---

## License

MIT. See [LICENSE](LICENSE).
