# OpenSidebar

An open-source Chrome extension that turns your browser into an AI-powered agent workspace.

OpenSidebar can navigate, read, click, type, and research across web pages from a side panel. It uses a two-tier LLM architecture: a fast model (`gpt-oss-120b`) for quick observe -> act cycles, with escalation to a smart model (`x-ai/grok-4.1-fast:nitro`) when tasks get harder. A local "Second Brain" provides persistent memory across sessions.

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
| Fast LLM | `gpt-oss-120b` via OpenRouter providers |
| Smart LLM | `x-ai/grok-4.1-fast:nitro` via OpenRouter |
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

## Screenshots

![Main Interface](docs/screenshots/main-interface.png)
_The OpenSidebar side panel with chat interface and welcome screen._

![Element Tagging](docs/screenshots/element-tagging.png)
_Interactive elements tagged with numeric IDs for AI interaction._

![Settings Panel](docs/screenshots/settings-panel.png)
_API key configuration in the settings drawer._

![Agent Demo](docs/screenshots/agent-demo.gif)
_OpenSidebar automatically navigating and interacting with web pages._

Contributing screenshots: [docs/screenshots/README.md](docs/screenshots/README.md)

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

```bash
bun run dev
```

### Configure

1. Click the OpenSidebar icon to open the side panel.
2. Open Settings.
3. Enter your OpenRouter API key.

---

## Commands

| Command | Description |
| --- | --- |
| `bun run dev` | Start dev server with HMR |
| `bun run build` | Build extension for production |
| `bun run lint` | Run ESLint |
| `bun test` | Run all tests |
| `bun test tests/background/orchestrator-integration.test.ts` | Run orchestrator integration tests |
| `bun run evals` | Run evaluation suite |
| `bun run evals run --all --prompt-id orchestrator.verifier.system` | Run evals with shared production prompt id |
| `bun run evals:stats` | Show eval statistics |
| `bun run evals:analyze` | Analyze eval results and suggestions |
| `bun run logs` | Start log drain server |
| `bun run logs:errors` | Query error logs |
| `bun run fmt` | Format source files |

When `bun run logs` is active, execution traces are persisted under:
- `traces/<session-id>.jsonl` (agent turn traces)
- `traces/runs/<run-id>.jsonl` (orchestrator run traces)

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
- [Evals Manual Workflow](./evals/README.md)
- [Contributing Guide](./CONTRIBUTING.md)
- [Agent Guidelines](./AGENTS.md)

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
