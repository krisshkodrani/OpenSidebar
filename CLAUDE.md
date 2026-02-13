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
- `agent/loop.ts` — `AgentLoop` class. Runs the LLM→tool→LLM cycle with abort support, pause/resume, hint injection, and progress tracking. Returns `LoopResult`. Unified mode: parallel tool execution, modal auto-dismiss, nudge→escalate→give-up for text-only responses. Barrel-exported via `agent/index.ts`.
- `agent/context.ts` — `ContextManager`. Builds the system prompt with DOM snapshot data (title, URL, tagged elements, viewport text). Manages sliding-window conversation history with dynamic compression (NONE→LIGHT→MEDIUM→HEAVY).
- `agent/progress.ts` — `ProgressTracker`. Detects stuck loops via snapshot fingerprinting. Graduated intervention: nudge at 6 stale turns, escalate at 12. Broadcasts `AGENT_STUCK` signals.
- `agent/step-labels.ts` — Human-readable step label generation for `AgentStep` timeline entries.
- `agent/tool-recovery.ts` — `recoverToolCallsFromText()`. Extracts structured tool calls from LLM text output when models emit JSON as plain text instead of using the tool_calls API.
- `llm/client.ts` — `LLMClient`. Calls OpenRouter chat completions API with tool definitions. Two model tiers: `MODEL_FAST` (Gemini 2.5 Flash Lite) and `MODEL_SMART` (MiniMax M2.5). `switchModel()` for escalation. `llm/types.ts` defines `LLMMessage`, `CompletionRequest`, `CompletionResponse`. Barrel-exported via `llm/index.ts`.
- `tools/registry.ts` — `ToolRegistry` singleton. Maps `ToolName` → executor function. `getDefinitions()` returns all tool schemas. `tools/index.ts` registers all 22 tools and bridges to content script / memory.
- `tools/metadata.ts` — `ToolMeta` interface and pre-computed sets: `DOM_MODIFYING_TOOLS`, `SEQUENTIAL_TOOLS`. Single source of truth for tool properties (risk, domModifying, sequential). Used by `security.ts` and `loop.ts`.
- `vision.ts` — `describeScreenshot(dataUrl)`. Sends screenshots to a vision LLM (configurable via `visionModel` setting, default `google/gemini-2.0-flash-001`) via OpenRouter for text descriptions. Used by `take_screenshot` tool. Retry logic with exponential backoff.
- `memory/bridge.ts` — Creates the offscreen document and relays memory commands to it.
- `workspaces/manager.ts` — `WorkspaceManager`. Maps workspaces to Chrome Tab Groups via `chrome.tabGroups`. Persists to `chrome.storage.local`.
- `keepalive.ts` — Service Worker keepalive via `chrome.alarms`. Creates a repeating alarm (~24s) to prevent SW termination during long agent loop runs. Start/stop tied to agent loop lifecycle.
- `navigation.ts` — Navigation bridge. Persists `AgentLoopState` to `chrome.storage.local` before page navigations, listens for `webNavigation.onCompleted` / `onErrorOccurred`, and resumes the agent loop with the tool result. Handles timeout (30s) and tab-closed cleanup.
- `security.ts` — `classifyRisk()` maps each `ToolName` to a `RiskLevel` (low/medium/high) via tool metadata. `sanitizeUrl()` blocks non-http(s) protocols. `sanitizeUserInput()` strips null bytes and truncates.
- `streaming.ts` — `parseSSEStream()`. Parses OpenAI-compatible SSE streams, accumulating text deltas and tool calls across chunks. Returns final content and assembled `ToolCall[]`.

### Content Script (`src/content/`)
Injected into every page at `document_idle`. Handles DOM snapshot generation and action execution.

- `content.ts` — Message listener. Routes `DOM_SNAPSHOT_REQUEST`, `TOOL_EXECUTE`, and `DISMISS_MODALS` messages. Runs `autoDismissModals()` to clear cookie banners and overlay modals on load.
- `tagging.ts` — Vimium-style numeric tagging of interactive elements (`[N]` labels). Generates `TaggedElement[]`. Tags `canvas` and `[draggable='true']` elements. Extracts label associations (explicit `<label for>`, implicit wrapper, aria-labelledby).
- `snapshot.ts` — `buildSnapshot()`. Produces `DomSnapshot` with tagged elements, viewport text, scroll position.
- `actions.ts` — `executeAction()`. Implements click, type, scroll, hover, find, select, press_key, drag_and_drop, draw_stroke, and hide_element on tagged elements by ID.

### Side Panel (`src/sidepanel/`)
React 18 + Tailwind CSS UI rendered in Chrome's side panel.

- `App.tsx` — Root component. Composes Header, StuckBanner, TaskProgressPanel, MessageBubble, ControlBar, InputArea.
- `store.ts` — Zustand + Immer store. Holds `SidePanelState` (messages, agent status, settings, error, taskProgress, taskCompletion, stuckState, turnProgress).
- `bridge.ts` — `initializeBridge()`. Centralized message router with exhaustive `never` check. Routes all `RuntimeMessage` types to store actions. Sends `USER_CHAT`, `STOP_AGENT`, `PAUSE_AGENT`, `RESUME_AGENT`, `SKIP_SUBTASK` messages.
- `components/` — `Header`, `MessageBubble`, `InputArea`, `ControlBar` (barrel-exported), plus `SettingsDrawer`, `StatusBar`, `ToolCallBadge`, `StuckBanner`, `TaskProgressPanel`, `CompletionSummary`.

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
- `RuntimeMessage` — discriminated union (26 members, discriminant: `type` field) for all inter-context messages. Includes `STREAM_CHUNK`, `NAVIGATION_RESUME`, `SETTINGS_UPDATE`, `SIDE_PANEL_OPENED`, `CLOSE_SIDE_PANEL`, `DISMISS_MODALS`, `AGENT_STUCK`, `AGENT_TURN`, `TASK_PROGRESS`, `TASK_COMPLETION`, `PAUSE_AGENT`, `RESUME_AGENT`, `SKIP_SUBTASK`, `AGENT_STEP`, `AGENT_ACTIVITY`, `SCREENSHOT_CAPTURED`.
- `ToolName` enum (22 tools) → `ToolArgsMap` maps each tool to its typed arguments.
- `ToolDefinition` — OpenAI function-calling schema format, used by `ToolRegistry`.
- `RiskLevel` enum (low/medium/high) for tool risk classification.
- `NavigationState` — serialized agent state for cross-navigation persistence.
- `Result<T, E>` — discriminated union for fallible operations.
- `UserSettings` — OpenRouter API key, maxTurns, contextWindowSize, memory/workspace toggles, theme, showElementTags, visionModel, confirmPlan.

### Messaging Protocol
All cross-context communication uses `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` with `RuntimeMessage` payloads. Each message carries a `requestId` (UUID) and `source` (enum: sidepanel, background, content, offscreen). Background→content tool execution uses `TOOL_EXECUTE` / `TOOL_RESULT`. Background→content modal cleanup uses `DISMISS_MODALS` / `DISMISS_MODALS_RESPONSE`. Background→offscreen memory uses `MEMORY_WORKER` / `MEMORY_WORKER_RESPONSE`. Background→sidepanel streaming uses `STREAM_CHUNK`. Navigation resumption uses `NAVIGATION_RESUME`. Agent feedback uses `AGENT_STUCK`, `AGENT_TURN`, `TASK_PROGRESS`, `TASK_COMPLETION`. User control uses `PAUSE_AGENT`, `RESUME_AGENT`, `SKIP_SUBTASK`.

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

## Debugging

When investigating errors (build failures, runtime exceptions, unexpected behavior), **check the logs first** — they are the best source of truth for what actually happened at runtime.

1. **Start the log drain** (if not already running): `bun run logs`
2. **Query recent errors**: `bun run logs:errors`
3. **Tail live output**: `bun run logs:tail`
4. **Search for a keyword**: `bun run logs:query search <text>`
5. **Log file location**: `logs/opensidebar.jsonl` (JSONL format, one structured entry per line)

The extension's `StorageLogger` captures structured logs from all four execution contexts (background, content, sidepanel, offscreen) with auto-redacted secrets. When `bun run logs` is running, entries drain to disk in real time; otherwise they accumulate in `chrome.storage.local` (ring buffer, 2000 entries).

For build errors, also check `bun run build` output directly — Vite/Rollup surface missing exports, unresolved imports, and type mismatches there.

## Design Principles

### Generic over task-specific

All agent infrastructure (planning, progress tracking, completion judgment, stuck detection) must be **task-agnostic**. Never hardcode logic for a specific website, challenge, or workflow. The agent should handle a complex multi-step workflow the same way it handles a multi-page checkout, a complex form, or a research task across multiple tabs.

- **No site-specific heuristics.** If a pattern only works on one site, it doesn't belong in the agent loop.
- **The agent adapts through prompting and memory, not code.** If the user wants the agent to solve a specific challenge, they describe it in the input. The agent uses `memory_add` / `memory_search` to learn and recall strategies across sessions.
- **Tools are generic primitives.** Click, type, scroll, navigate — not "solve step 5 of the challenge." Higher-level behavior emerges from the LLM's reasoning over these primitives.
- **Plans are dynamic.** The guardian decomposes any user query into subtasks based on context — it doesn't have a list of known task templates.

### When in doubt, ask: "Would this work on a site I've never seen?"

## Path Aliases

`@/*` maps to `./src/*` (configured in both `tsconfig.json` and `vite.config.ts`).
