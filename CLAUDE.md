# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run build          # Production build (vite build)
bun run dev            # Dev server with HMR (load dist/ as unpacked extension)
bun run lint           # ESLint (src/**/*.ts,tsx)
bun run fmt            # Prettier format src/
bun test               # Run all tests
bun test tests/content/tagging.test.ts  # Run a single test file
bun run logs           # Start log drain server (receives logs from extension)
bun run logs:query     # Query log file (tail, errors, since, search, stats, help)
bun run logs:tail      # Show last 50 log entries
bun run logs:errors    # Show error-level entries only
bun run evals          # Run eval suite
bun run evals:stats    # Show eval statistics
bun run evals:analyze  # Analyze evals with suggestions
```

**Note:** On this Windows machine, bun was installed via `npm install -g bun` and may not be in PATH by default. The `tsconfig.json` only includes `src/` — test files under `tests/` are not type-checked by `tsc`.

## Architecture

Chrome Manifest V3 extension with four isolated execution contexts communicating via `chrome.runtime.onMessage`:

```
Side Panel (React/Zustand) ←→ Service Worker (Agent Loop) ←→ Content Script (DOM)
                                       ↕
                               Offscreen Document
                          (Memory: SQLite + Voy + Transformers.js)
```

### Service Worker (`src/background/`)
The orchestrator. Receives user messages from the side panel, runs the agent loop, dispatches tool calls to the content script, and streams responses back.

- `background.ts` — Entry point. Message router for all `RuntimeMessage` types (chat, stop, workspace CRUD, settings, side panel lifecycle). Creates/destroys `AgentLoop` instances.
- `agent/loop.ts` — `AgentLoop` class. Runs the LLM→tool→LLM cycle with abort support. Persists state to `chrome.storage.session` to survive SW restarts. Barrel-exported via `agent/index.ts`.
- `agent/context.ts` — `ContextManager`. Builds the system prompt with DOM snapshot data (title, URL, tagged elements, viewport text). Manages sliding-window conversation history.
- `llm/client.ts` — `LLMClient`. Calls Cerebras or OpenRouter chat completions API with tool definitions. `llm/types.ts` defines `LLMMessage`, `CompletionRequest`, `CompletionResponse`. Barrel-exported via `llm/index.ts`.
- `tools/registry.ts` — `ToolRegistry` singleton. Maps `ToolName` → executor function. `tools/index.ts` registers all tools and bridges to content script / memory / swarm.
- `swarm.ts` — `callKimiSwarm()`. Delegates complex research to Kimi K2.5 (`moonshotai/kimi-k2.5`) via OpenRouter. Includes retry logic with exponential backoff (max 3 retries, 7s total), streaming response parsing, and smart truncation (intro+conclusion extraction for long reports).
- `memory/bridge.ts` — Creates the offscreen document and relays memory commands to it.
- `workspaces/manager.ts` — `WorkspaceManager`. Maps workspaces to Chrome Tab Groups via `chrome.tabGroups`. Persists to `chrome.storage.local`.
- `keepalive.ts` — Service Worker keepalive via `chrome.alarms`. Creates a repeating alarm (~24s) to prevent SW termination during long agent loop runs. Start/stop tied to agent loop lifecycle.
- `navigation.ts` — Navigation bridge. Persists `AgentLoopState` to `chrome.storage.local` before page navigations, listens for `webNavigation.onCompleted` / `onErrorOccurred`, and resumes the agent loop with the tool result. Handles timeout (30s) and tab-closed cleanup.
- `security.ts` — `classifyRisk()` maps each `ToolName` to a `RiskLevel` (low/medium/high) for UI display. `sanitizeUrl()` blocks non-http(s) protocols. `sanitizeUserInput()` strips null bytes and truncates.
- `streaming.ts` — `parseSSEStream()`. Parses OpenAI-compatible SSE streams, accumulating text deltas and tool calls across chunks. Returns final content and assembled `ToolCall[]`.

### Content Script (`src/content/`)
Injected into every page at `document_idle`. Handles DOM snapshot generation and action execution.

- `content.ts` — Message listener. Routes `DOM_SNAPSHOT_REQUEST` and `TOOL_EXECUTE` messages. Runs a cookie-banner auto-dismiss janitor on load.
- `tagging.ts` — Vimium-style numeric tagging of interactive elements (`[N]` labels). Generates `TaggedElement[]`.
- `snapshot.ts` — `buildSnapshot()`. Produces `DomSnapshot` with tagged elements, viewport text, scroll position.
- `actions.ts` — `executeAction()`. Implements click, type, scroll, hover, find on tagged elements by ID.

### Side Panel (`src/sidepanel/`)
React 18 + Tailwind CSS UI rendered in Chrome's side panel.

- `App.tsx` — Root component. Composes Header, MessageBubble, InputArea, ControlBar.
- `store.ts` — Zustand + Immer store. Holds `SidePanelState` (messages, agent status, settings, error state).
- `bridge.ts` — `initializeBridge()`. Listens for background messages and updates the Zustand store. Sends `USER_CHAT` and `STOP_AGENT` messages.
- `components/` — `Header`, `MessageBubble`, `InputArea`, `ControlBar` (barrel-exported), plus `SettingsDrawer`, `StatusBar`, `ToolCallBadge`.

### Offscreen Document (`src/offscreen/`)
Runs heavy memory operations outside the service worker.

- `offscreen.ts` — Entry point. Initializes the offscreen document.
- `memory/main.ts` — Message handler wrapping `VectorStore`.
- `memory/storage.ts` — `VectorStore`. Hybrid search: Transformers.js embeddings (all-MiniLM-L6-v2) + Voy vector search + SQLite FTS5 keyword search, fused with Reciprocal Rank Fusion.
- `memory/utils.ts` — `reciprocalRankFusion()`. RRF scoring algorithm (K=60) combining semantic and keyword result rankings.
- `memory/worker.ts` — Web Worker for Transformers.js embedding pipeline. Loads `Xenova/all-MiniLM-L6-v2` model (fp32/wasm), handles `embed` requests via `postMessage`.

### Utilities (`src/utils/`)
Shared utilities used across all execution contexts. Barrel-exported via `index.ts`.

- `logger.ts` — Structured `Logger` class. Auto-detects execution context (background/content/sidepanel/offscreen). Color-coded DevTools output with collapsible groups. Persists to `chrome.storage.local` via `storage-logger.ts`.
- `storage-logger.ts` — `StorageLogger` ring buffer (2000 entries) in `chrome.storage.local`. Batched writes (20 entries or 5s interval). Auto-redacts API keys/tokens. Also drains to local HTTP server (`127.0.0.1:7589`) for disk persistence when `bun run logs` is running.
- `context.ts` — `getExecutionContext()` detects which Chrome extension context code is running in. Helpers: `isContentScript()`, `isBackground()`, `isSidepanel()`, `isOffscreen()`.

### Types (`src/types/index.ts`)
Single source of truth for all interfaces. Key patterns:
- `RuntimeMessage` — discriminated union (discriminant: `type` field) for all inter-context messages. Includes `STREAM_CHUNK`, `NAVIGATION_RESUME`, `SETTINGS_UPDATE`, `SIDE_PANEL_OPENED`, `CLOSE_SIDE_PANEL`.
- `ToolName` enum (16 tools) → `ToolArgsMap` maps each tool to its typed arguments.
- `ToolDefinition` — OpenAI function-calling schema format, used by `ToolRegistry`.
- `RiskLevel` enum (low/medium/high) for tool risk classification.
- `NavigationState` — serialized agent state for cross-navigation persistence.
- `Result<T, E>` — discriminated union for fallible operations.
- `UserSettings` — Cerebras/OpenRouter API keys, maxTurns, contextWindowSize, memory/workspace toggles, theme.

### Messaging Protocol
All cross-context communication uses `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` with `RuntimeMessage` payloads. Each message carries a `requestId` (UUID) and `source` (enum: sidepanel, background, content, offscreen). Background→content tool execution uses `TOOL_EXECUTE` / `TOOL_RESULT`. Background→offscreen memory uses `MEMORY_WORKER` / `MEMORY_WORKER_RESPONSE`. Background→sidepanel streaming uses `STREAM_CHUNK`. Navigation resumption uses `NAVIGATION_RESUME`.

### Evals (`evals/`)
Offline evaluation framework for testing agent behavior against golden datasets.

- `cli.ts` — CLI entry point. Supports `--stats` and `--analyze --suggest` flags.
- `core/` — `loader.ts` (YAML case loader), `runner.ts` (eval executor), `metrics.ts` (scoring), `reporter.ts` (output formatting), `types.ts`.
- `golden/cases/` — YAML test cases (login forms, search, memory operations).
- `optimizer/` — `analyzer.ts`, `tracker.ts`, `suggester.ts` for identifying improvements.

### Scripts (`scripts/`)
- `log-server.ts` — Bun HTTP server (`127.0.0.1:7589`). Receives log batches from the extension's `StorageLogger` and appends to `logs/opensidebar.jsonl`. 50MB rotation, 5 files max.
- `log-query.ts` — CLI for querying JSONL logs. Commands: `tail [N]`, `errors`, `since <duration>`, `level <lvl>`, `category <cat>`, `search <text>`, `stats`, `help`.

## Testing

Tests use **Bun test runner** with `happy-dom` for DOM simulation. The global test setup (`tests/setup.ts`) mocks `chrome.*` APIs, `getBoundingClientRect`, `scrollIntoView`, etc. Tests live in `tests/` mirroring `src/` structure.

Test files cover: agent loop, context manager, keepalive, navigation bridge, security, streaming, tools, content script (tagging, snapshot, shadow DOM), memory (RRF, storage), sidepanel store, and logger.

## Path Aliases

`@/*` maps to `./src/*` (configured in both `tsconfig.json` and `vite.config.ts`).
