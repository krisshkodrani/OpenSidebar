# Contributing to OpenSidebar

Thank you for your interest in contributing! This guide covers development setup, architecture, observability tooling, and the eval pipeline.

---

## Development Setup

1. Fork the repository
2. Clone your fork: `git clone git@github.com:yourusername/OpenSidebar.git`
3. Install dependencies: `npm install`
4. Copy environment file: `cp .env.example .env` and add your OpenRouter API key
5. Start development: `npm run dev`

`npm run dev` starts the full dev stack: Vite with HMR for the extension, the log drain server, and the trace viewer at `http://127.0.0.1:7589/viewer`. It auto-clears stale processes on ports 5173/7589.

---

## Architecture

Chrome Manifest V3 extension with three isolated execution contexts communicating via `chrome.runtime.onMessage`:

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

---

## Testing

```bash
npm test                                          # Run all tests
npx vitest run tests/background/tools.test.ts     # Run a specific file
npx vitest run --grep "AgentLoop"                 # Run tests matching pattern
```

Tests use Vitest + happy-dom. The test setup (`tests/setup.ts`) mocks `chrome.*` APIs. Tests are not type-checked by `tsc` — only `src/` is included in `tsconfig.json`.

---

## Observability

OpenSidebar has built-in observability tooling for debugging and improving the agent. When `npm run dev` or `npm run logs` is running, the extension records full-fidelity execution data from every agent session.

### Trace recording

Every LLM request/response, tool execution, DOM snapshot, event, and screenshot is captured automatically. Data drains to `traces/<session-id>.jsonl` via the log server (fire-and-forget — zero cost when the server is down).

### Trace viewer

A built-in React UI for inspecting recorded sessions, served at `http://127.0.0.1:7589/viewer`.

<video src="docs/assets/demo-trace-viewer.mp4" width="100%" autoplay loop muted></video>

What you can inspect:

- **Session list** — filterable by outcome, day, domain, model. Cost dashboard with aggregate stats.
- **Turn timeline** — visual bar chart showing relative turn duration, color-coded by model tier (executor vs planner).
- **Per-turn cards** — LLM input/output, tool calls with args and results, DOM snapshots, events, token usage, cost, compression level, provider attribution.
- **Perception view** — accumulated observations from the vision model across turns.
- **Logs view** — session-scoped structured logs with level filtering.
- **Story mode** — LLM-generated narrative analysis of a session (uses your OpenRouter key).
- **Turn search** — full-text search across LLM output and tool results within a session.
- **Deep-linkable** — URL hash routing for sharing specific sessions and views.

```bash
npm run dev     # starts everything including the viewer
# or
npm run logs    # starts just the log server + viewer
```

### Trace viewer source

The viewer lives in `src/trace-viewer/` — a standalone React app served by the log server.

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

### Trace server API

The log server (`scripts/log-server.ts`) exposes these endpoints:

| Endpoint | Description |
| --- | --- |
| `GET /api/traces/search` | List sessions with filters |
| `GET /api/traces/:id` | Get turn entries for a session |
| `GET /api/traces/:id/screenshots/:turn` | Get screenshot for a turn |
| `GET /api/traces/days` | Day buckets for filter dropdown |
| `GET /api/traces/models` | Model buckets for filter dropdown |
| `GET /api/logs/:sessionId` | Session-scoped structured logs |

### Trace query CLI

```bash
npm run traces -- list                   # List recent sessions
npm run traces -- show <id>              # Show session detail
npm run traces -- turns <id>             # Show per-turn summary
npm run traces -- stats                  # Aggregate statistics
```

### Structured logs

Logs are always buffered in `chrome.storage.local` (ring buffer, 2000 entries) even without the server running. When the log server is active, entries drain to `logs/opensidebar.jsonl` in real time.

```bash
npm run logs:tail       # Last 50 entries
npm run logs:errors     # Error-level only
npx tsx scripts/log-query.ts search <text>   # Full-text search
```

---

## Evals

Trace-based evaluation system that replays recorded interactions offline to measure and improve agent quality.

### Workflow

1. **Record traces** — run the agent with `npm run dev` or `npm run logs` active.
2. **Extract golden cases** — `npx tsx evals/cli.ts extract <session-id> <turn>` with corrected expectations.
3. **Run critique** — `npm run evals:critique` replays golden cases, judges with LLM-as-judge (Claude Sonnet), and generates a report.
4. **Read report** — per-pathology breakdown with prompt fix suggestions.
5. **Apply fixes and re-run** to verify improvement.

### Commands

```bash
npm run evals                # CLI help (shows all subcommands)
npm run evals:critique       # Replay golden cases + judge + generate report
npm run evals:validate       # Structural validation of golden cases (offline, no API key)
```

Golden cases live in `evals/golden/`. The eval pipeline source is in `evals/`.

---

## Adding New Tools

1. **Add the enum value** in `src/types/enums.ts` (`ToolName` enum)
2. **Add typed args** in `src/types/tools.ts` (`ToolArgsMap`)
3. **Define the tool schema** in `src/background/tools/definitions.ts` (OpenAI function-calling format)
4. **Add metadata** in `src/background/tools/metadata.ts` (`ToolMeta` — risk, domModifying, sequential)
5. **Register the executor** in `src/background/tools/index.ts`
6. **Implement the action** in `src/content/actions.ts` (if it interacts with the DOM)

Important: tool parameter names must match across all layers (definition, TypeScript types, executor).

---

## Code Style

- TypeScript with strict mode
- 2-space indentation
- Run `npm run fmt` before committing
- Follow existing patterns in the codebase
- Path alias: `@/*` maps to `./src/*`

## Commit Messages

```
type: subject (50 chars max)

Body (optional, wrap at 72 chars)
```

Types: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`

## Design Principles

- **Generic over task-specific** — no site-specific heuristics. Everything must work on sites the agent has never seen.
- **Tools are generic primitives** — click, type, scroll, navigate. Higher-level behavior emerges from LLM reasoning.
- **Plans are dynamic** — the planner decomposes any query into subtasks based on context, not templates.

---

## Pull Request Process

1. Create a feature branch: `git checkout -b feature/your-feature-name`
2. Make your changes
3. Run tests: `npm test`
4. Run linter: `npm run lint`
5. Format code: `npm run fmt`
6. Commit with descriptive messages
7. Push to your fork and create a Pull Request

---

## Questions?

Open an issue or discussion on GitHub.
