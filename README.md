# OpenSidebar

An open-source Chrome extension that turns your browser into an AI-powered agent workspace.

OpenSidebar can navigate, read, click, type, and research across web pages from a side panel. It uses a two-tier LLM architecture: a fast model (`gpt-oss-120b`) for quick observe → act cycles, with escalation to a smart model (`z-ai/glm-4.7`, GLM-4.7 with native reasoning) when tasks get harder. Tri-provider failover (Cerebras → Groq → OpenRouter) keeps inference fast and resilient. A local "Second Brain" provides persistent memory across sessions.

<!-- Add screenshots to docs/screenshots/ and uncomment the relevant lines below -->
<!-- ![Side Panel](docs/screenshots/sidepanel.png) -->
<!-- ![Trace Viewer](docs/screenshots/trace-viewer.png) -->

---

## Features

- Browser automation via natural language (click, type, scroll, navigate).
- Visual DOM understanding with Vimium-style element tags (`[1]`, `[2]`, ...).
- Two-tier model execution with automatic escalation when needed.
- Runtime lane isolation in the orchestrator (planner, executor, verifier).
- Teach Mode with learned skill replay (capture successful runs and reuse them, with pin/enable controls).
- Local memory with hybrid retrieval (Transformers.js + SQLite FTS5 + Voy + RRF).
- Auto-managed workspaces using Chrome Tab Groups.
- Per-tab sidebar behavior (open on click, auto-close on tab switch).
- Navigation survival across page loads and service-worker lifecycle changes.
- Real-time streaming responses.

---

## Architecture

```text
Side Panel (React) <-> Service Worker (Agent Loop / Orchestrator) <-> Content Script (DOM)
                                  |
                           Offscreen Document
                    (Memory: SQLite + Voy + Transformers.js)
```

| Component | Technology |
| --- | --- |
| Fast LLM | `gpt-oss-120b` via Cerebras → Groq → OpenRouter failover |
| Smart LLM | `z-ai/glm-4.7` (GLM-4.7) via Cerebras → OpenRouter failover |
| Vision LLM | Configurable via OpenRouter (default `qwen/qwen3-vl-235b-a22b-instruct`) |
| Embeddings | Transformers.js (`all-MiniLM-L6-v2`) |
| Vector Search | Voy (WASM) |
| Keyword Search | SQLite WASM (FTS5) |
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
- Bun
- OpenRouter API key ([openrouter.ai](https://openrouter.ai))

### Install and Build

```bash
git clone https://github.com/OpenSidebar/OpenSidebar.git
cd OpenSidebar
bun install
bun run build
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click Load unpacked
4. Select the `dist/` folder

### Development

Use `dev:stack` — it builds the extension, starts the log/trace server, and launches Vite with HMR, all in one process:

```bash
bun run dev:stack     # or: make dev
```

> **Why not just `bun run dev`?** Plain `bun run dev` only starts Vite. Without the log server running, execution traces are silently dropped and you lose all session data. `dev:stack` ensures traces are always captured.

A `Makefile` is included for convenience — run `make help` to see all targets.

### Configure

1. Click the OpenSidebar icon to open the side panel.
2. Open Settings.
3. Enter your OpenRouter API key.

---

## Commands

All commands are available via `bun run <script>` or `make <target>`. Run `make help` for a quick reference.

### Day-to-day

| Make | Bun | Description |
| --- | --- | --- |
| `make dev` | `bun run dev:stack` | **Recommended.** Build + log server + Vite HMR. Traces captured automatically. |
| `make build` | `bun run build` | Production build only |
| `make test` | `bun test` | Run all tests |
| `make lint` | `bun run lint` | Run ESLint |
| `make fmt` | `bun run fmt` | Format source files |

### Logs & Traces

| Make | Bun | Description |
| --- | --- | --- |
| `make logs` | `bun run logs` | Start log drain server (port 7589) — required for trace capture |
| `make viewer` | `bun run viewer` | Start server + open trace viewer UI |
| `make traces` | `bun run traces:list` | List captured trace sessions |
| `make traces-stats` | `bun run traces:stats` | Aggregate trace statistics |
| `make traces-clean` | — | Delete all traces and start fresh |
| `make logs-tail` | `bun run logs:tail` | Tail recent log entries |
| `make logs-errors` | `bun run logs:errors` | Show error-level logs |

### Evals

| Make | Bun | Description |
| --- | --- | --- |
| `make evals-convert` | `bun run evals:convert` | Convert traces to eval cases |
| `make evals-run` | `bun run evals:run` | Run eval cases against LLM |
| `make evals-stats` | `bun run evals:stats` | Show eval statistics |
| `make evals-analyze` | `bun run evals:analyze` | Pattern analysis across results |

When `bun run logs` (or `make dev`) is active, execution traces are persisted under:
- `traces/<session-id>.jsonl` (agent turn traces)
- `traces/runs/<run-id>.jsonl` (orchestrator run traces)
- `traces/index.jsonl` (manual run session index)
- `traces/runs/index.jsonl` (orchestrator run index)

### Trace Viewer UI

OpenSidebar includes a custom trace viewer UI in-repo (not a third-party library):
- Viewer UI: `scripts/trace-viewer.html`
- Server/API: `scripts/log-server.ts`
- URL: `http://127.0.0.1:7589/viewer`

Start it:
1. Run `bun run logs` (or `bun run viewer`).
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
- Optional disk persistence: if `bun run logs` is running, the extension also drains logs/traces to local files:
  - `logs/opensidebar.jsonl`
  - `traces/<session-id>.jsonl`
  - `traces/runs/<run-id>.jsonl`

### How Info Is Extracted

1. Start drain server in a terminal:
   - `bun run logs`
2. Run your task manually in Chrome (open side panel, execute workflow).
3. Inspect raw logs/traces:
   - `bun run logs:tail`
   - `bun run logs:query search "task_completed"`
   - `bun run traces:list`
   - `bun run traces:stats`
4. Convert captured traces into eval cases:
   - `bun run evals convert <session-id> --strategy all`
5. Generate AI-readable critique artifacts:
   - `bun run evals critique`

If you forgot to start `bun run logs`, you can still export buffered logs from the side panel:
- `Settings -> Export Logs` downloads `opensidebar-logs.jsonl`.

---

## Documentation

### User Guides

- [Features Overview](./docs/features/)
- [Browser Automation](./docs/features/browser-automation.md)
- [Memory System](./docs/features/memory-system.md)
- [Workspace Management](./docs/features/workspace-management.md)
- [Streaming UI](./docs/features/streaming-ui.md)
- [Security and Privacy](./docs/features/security.md)

### Technical Architecture

- [Architecture Overview](./docs/architecture/overview.md)
- [Agent Loop](./docs/architecture/agent-loop.md)
- [Memory System](./docs/architecture/memory-system.md)
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

## Organization

OpenSidebar is developed by the OpenSidebar organization.

- GitHub: [github.com/OpenSidebar](https://github.com/OpenSidebar)
- Repository: [github.com/OpenSidebar/OpenSidebar](https://github.com/OpenSidebar/OpenSidebar)
- Issues: [github.com/OpenSidebar/OpenSidebar/issues](https://github.com/OpenSidebar/OpenSidebar/issues)

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
- Memory data stays in local browser storage.
- No telemetry or analytics by default.
- URL sanitization blocks non-http(s) protocols.

---

## License

MIT. See [LICENSE](LICENSE).
