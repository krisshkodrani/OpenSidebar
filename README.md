<p align="center">
  <img src="OpenSidebar.png" alt="OpenSidebar" width="128" />
</p>

<h1 align="center">OpenSidebar</h1>

<p align="center">
  <a href="https://github.com/OpenSidebar/OpenSidebar/actions/workflows/ci.yml"><img src="https://github.com/OpenSidebar/OpenSidebar/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js" /></a>
</p>

<p align="center">
  Open-source Chrome extension that turns your browser into an AI-powered agent.<br />
  Navigate, click, type, and automate web tasks from a side panel — bring your own key via <a href="https://openrouter.ai">OpenRouter</a>.
</p>

<video src="docs/assets/demo-agent.mp4" width="100%" autoplay loop muted></video>

---

## Features

- **Natural language browser automation** — click, type, scroll, navigate, drag-and-drop, draw on canvas.
- **Visual DOM understanding** — Vimium-style element tagging (`[1]`, `[2]`, ...) with label association and inline clickable detection.
- **Perception layer** — vision-based page understanding via Gemini 2.5 Flash.
- **Two-tier LLM architecture** — executor model (`gpt-oss-120b`) for fast observe-act cycles, planner model (`deepseek-v3.2`) for complex reasoning. Automatic escalation when the executor gets stuck.
- **36 generic tools** — no site-specific heuristics. The agent adapts through prompting, not code.
- **Plan confirmation** — the agent pauses to show its plan before executing multi-step tasks.
- **Clarification** — the agent asks when something is ambiguous instead of guessing.
- **Stagnation detection** — snapshot fingerprinting detects stuck loops with graduated intervention.
- **Navigation survival** — persists state across page loads and service worker restarts.
- **Workspaces** — auto-managed via Chrome Tab Groups, each with isolated agent state.
- **Full execution traces** — every LLM call, tool execution, DOM snapshot, and screenshot recorded.
- **Built-in trace viewer** — React UI for inspecting agent sessions (see below).
- **Eval pipeline** — trace-based evaluation system with LLM-as-judge scoring.
- **Real-time streaming** — SSE-based streaming responses with token/cost tracking.
- **BYOK** — all inference through OpenRouter. Your keys, your data.

---

## Quick Start

### Prerequisites

- Node.js 18+
- An [OpenRouter](https://openrouter.ai) API key

### Install

```bash
git clone https://github.com/OpenSidebar/OpenSidebar.git
cd OpenSidebar
npm install
npm run build
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder

### Configure

1. Click the OpenSidebar icon to open the side panel.
2. Open **Settings**.
3. Enter your OpenRouter API key.

### Development

```bash
npm run dev    # Vite HMR + log server + trace viewer — all in one
```

This starts the full dev stack: Vite with HMR for the extension, the log drain server, and the trace viewer at `http://127.0.0.1:7589/viewer`. It auto-clears stale processes on ports 5173/7589.

---

## Architecture

```
Side Panel (React/Zustand) <--> Service Worker (Agent Loop) <--> Content Script (DOM)
```

| Component | Technology |
| --- | --- |
| Executor LLM | `openai/gpt-oss-120b` via OpenRouter |
| Planner LLM | `deepseek/deepseek-v3.2` via OpenRouter |
| Perception | Gemini 2.5 Flash via OpenRouter |
| UI | React 18 + Tailwind CSS + Zustand |
| Build | Vite + `@crxjs/vite-plugin` |
| Tests | Vitest + happy-dom |

**Service Worker** (`src/background/`) — the orchestrator. Runs the agent loop (LLM -> tool -> LLM cycle), dispatches tool calls to the content script, manages workspaces, handles navigation persistence.

**Content Script** (`src/content/`) — injected into every page. Generates DOM snapshots with tagged interactive elements, executes actions (click, type, scroll, etc.), auto-dismisses modals.

**Side Panel** (`src/sidepanel/`) — React UI. Chat interface, settings, task progress, stall banner, plan confirmation overlay.

For deep architecture docs, see [`CLAUDE.md`](./CLAUDE.md) and [`docs/architecture/`](./docs/architecture/).

---

## Trace Viewer

OpenSidebar ships with a built-in trace viewer for inspecting agent execution sessions.

<video src="docs/assets/demo-trace-viewer.mp4" width="100%" autoplay loop muted></video>

### What you can inspect

- **Session list** — filterable by outcome, day, domain, model. Cost dashboard with aggregate stats.
- **Turn timeline** — visual bar chart showing relative turn duration, color-coded by model tier (executor vs planner).
- **Per-turn cards** — LLM input/output, tool calls with args and results, DOM snapshots, events, token usage, cost, compression level, provider attribution.
- **Perception view** — accumulated observations from the vision model across turns.
- **Logs view** — session-scoped structured logs with level filtering.
- **Story mode** — LLM-generated narrative analysis of a session (uses your OpenRouter key).
- **Turn search** — full-text search across LLM output and tool results within a session.
- **Deep-linkable** — URL hash routing for sharing specific sessions and views.

### Running the viewer

```bash
npm run dev     # starts everything including the viewer
# or
npm run logs    # starts just the log server + viewer
```

Then open `http://127.0.0.1:7589/viewer`.

### Developing the viewer

The viewer source lives in `src/trace-viewer/` — it's a standalone React app served by the log server.

```
src/trace-viewer/
  App.tsx              # Root component, URL hash routing
  store.ts             # Zustand + Immer store (traces + UI slices)
  api.ts               # HTTP client for the trace server API
  utils.ts             # Formatting helpers (tokens, cost, duration)
  index.css            # Tailwind + custom styles (scrollbars, story prose)
  components/
    PanelLayout.tsx     # Left/right split panel
    TabBar.tsx          # Top tab bar
    traces/
      TracesTab.tsx     # Main traces view (session list + detail)
      TraceSessionList  # Session list with selection
      TraceFilterPanel  # Outcome/day/domain/model filters
      CostDashboard     # Aggregate cost/token/outcome stats
      TurnCard          # Single turn: LLM I/O, tools, snapshot, events
      TurnTimeline      # Visual duration bar chart
      TurnSearchBar     # Full-text search within session
      StoryPanel        # LLM narrative generation (streaming)
      PerceptionList    # Perception observations view
      LogList           # Session-scoped log viewer
```

The viewer talks to the log server API (`scripts/log-server.ts`):

| Endpoint | Description |
| --- | --- |
| `GET /api/traces/search` | List sessions with filters |
| `GET /api/traces/:id` | Get turn entries for a session |
| `GET /api/traces/:id/screenshots/:turn` | Get screenshot for a turn |
| `GET /api/traces/days` | Day buckets for filter dropdown |
| `GET /api/traces/models` | Model buckets for filter dropdown |
| `GET /api/logs/:sessionId` | Session-scoped structured logs |

---

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Full dev stack: Vite HMR + log server + trace viewer |
| `npm run build` | Production build |
| `npm test` | Run all tests (Vitest) |
| `npm run lint` | ESLint (`src/**/*.ts,tsx`) |
| `npm run fmt` | Prettier format `src/` |
| `npm run logs` | Start log drain server + trace viewer |
| `npm run logs:tail` | Tail recent log entries |
| `npm run logs:errors` | Show error-level logs |
| `npm run traces` | Trace query CLI (`list`, `show`, `turns`, `stats`) |
| `npm run evals` | Eval CLI help |
| `npm run evals:critique` | Replay golden cases + judge + generate report |
| `npm run evals:validate` | Structural validation (offline, no API key) |

See also: `make help` for Makefile targets.

---

## How Traces Work

When `npm run dev` or `npm run logs` is running, the extension records full-fidelity execution data:

1. **Agent runs** — every LLM request/response, tool execution, DOM snapshot, event, and screenshot.
2. **Data drains** to `traces/<session-id>.jsonl` via the log server (fire-and-forget, zero cost when server is down).
3. **Query** with `npm run traces -- list`, `npm run traces -- show <id>`, or the trace viewer UI.
4. **Convert** traces to eval cases: `npx tsx evals/cli.ts convert <session-id> --strategy all`.
5. **Judge** with `npm run evals:critique` for LLM-as-judge scoring.

Logs are always buffered in `chrome.storage.local` (ring buffer, 2000 entries) even without the server. Export from Settings if needed.

---

## Security

- API keys stored in `chrome.storage.sync` — never sent anywhere except OpenRouter.
- All data stays in local browser storage and local files.
- No telemetry or analytics.
- URL sanitization blocks non-http(s) protocols.
- Tool risk classification (low/medium/high) with approval gates for destructive actions.
- See [SECURITY.md](SECURITY.md) for the full security policy.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines.

```bash
git clone https://github.com/OpenSidebar/OpenSidebar.git
cd OpenSidebar
npm install
npm run dev
npm test        # make sure tests pass
npm run lint    # make sure linter passes
```

---

## Documentation

- [Architecture Overview](./docs/architecture/overview.md)
- [Agent Loop](./docs/architecture/agent-loop.md)
- [Perception Layer](./docs/architecture/perception-layer.md)
- [Navigation Bridge](./docs/architecture/navigation-bridge.md)
- [Message Protocol](./docs/architecture/message-protocol.md)
- [Tools Reference](./docs/features/tools.md)
- [Security](./docs/features/security.md)
- [RFCs](./docs/rfc/)
- [Evals Guide](./docs/guides/evals-program.md)

For the full internal reference, see [`CLAUDE.md`](./CLAUDE.md).

---

## License

MIT. See [LICENSE](LICENSE).
