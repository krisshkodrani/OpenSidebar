# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Core development
npm run dev            # Full dev stack: Vite HMR + log server + trace viewer
npm run build          # Production build (vite build)
npm run lint           # ESLint (src/**/*.ts,tsx)
npm run fmt            # Prettier format src/
npm test               # Run all tests (vitest, excludes e2e)
npx vitest run tests/content/tagging.test.ts  # Run a single test file
npm run test:e2e       # E2E tests: build + launch Chrome + real agent (requires OPENROUTER_API_KEY)
npm run fixtures       # Serve demo fixture pages on http://localhost:3333 (for screenshots/videos)

# Logs & Traces
npm run logs           # Start log drain server + trace viewer (http://127.0.0.1:7589/viewer)
npm run logs:tail      # Show last 50 log entries
npm run logs:errors    # Show error-level entries only
npm run traces         # Trace query CLI (list, show, turns, stats, help)

# Evals
npm run evals          # Eval CLI help (shows all subcommands)
npm run evals:critique # Replay golden cases + judge + generate report
npm run evals:validate # Structural validation of golden cases (offline, no API key)
```

`npm run dev` automatically clears stale processes on ports 5173/7589 before starting, preventing "port in use" errors from orphaned Vite processes.

Scripts use `tsx` for TypeScript execution and `vitest` for testing. The `tsconfig.json` only includes `src/` — test files under `tests/` are not type-checked by `tsc`.

## E2E Report Format

When Claude runs the E2E suite or prepares an E2E summary report, write a dated markdown report in `docs/` using this filename pattern:

- `docs/e2e-report-YYYY-MM-DD.md`

Do not create or maintain an undated `docs/e2e-report.md`.

Use this structure:

1. `# E2E Final Report`
2. `Date: YYYY-MM-DD`
3. `Scope: ...`
4. `Overall result: ...`
5. A markdown table with columns:
   - `Case`
   - `Success`
   - `Turns`
   - `Perceptions`
   - `Traces`
   - `Prompt used`
6. `## Metric Definitions`
7. `## Stability Notes`

Metric conventions:

- `Turns`: total recorded trace turns across the trace file(s) for that case.
- `Perceptions`: turns where the trace input included `Page Interpretation`.
- `Traces`: number of trace sessions produced for that case, including replans or retries.
- `Success`: whether the case completed successfully in the run.

## Architecture

Chrome Manifest V3 extension with three isolated execution contexts communicating via `chrome.runtime.onMessage`:

```
Side Panel (React/Zustand) ←→ Service Worker (Agent Loop) ←→ Content Script (DOM)
```

### Service Worker (`src/background/`)

The orchestrator. Receives user messages from the side panel, runs the agent loop, dispatches tool calls to the content script, and streams responses back.

- `background.ts` — Entry point. Message router for all `RuntimeMessage` types (chat, stop, workspace CRUD, settings, side panel lifecycle). Per-workspace `AgentLoop` instances via `agentLoops = Map<workspaceId, AgentLoop>`. Supports parallel agent execution across workspaces.
- `agent/loop.ts` — `AgentLoop` class. Runs the LLM→tool→LLM cycle with abort support, pause/resume, feedback injection, and progress tracking. Returns `LoopResult`. Unified mode: parallel tool execution, modal auto-dismiss, reflection→escalate→give-up for text-only responses. Workspace-scoped via `workspaceId` property — each workspace gets isolated state. Barrel-exported via `agent/index.ts`.
- `agent/context.ts` — `ContextManager`. Builds the system prompt with DOM snapshot data (title, URL, tagged elements, visible content). Manages sliding-window conversation history with dynamic compression (NONE→LIGHT→MEDIUM→HEAVY). `summarizeTrajectory()` compresses full history into a structured timeline (~1K tokens) before planner model handoff. `summarizeHistory()` utility extracts tool name + args + outcome per turn.
- `agent/stagnation.ts` — `StagnationMonitor`. Detects stuck loops via snapshot fingerprinting. Graduated intervention: reflection at 6 stagnant turns, escalate at 12. Broadcasts `AGENT_STAGNATION` signals.
- `agent/step-labels.ts` — Human-readable step label generation for `AgentStep` timeline entries.
- `agent/tool-recovery.ts` — `recoverToolCallsFromText()`. Extracts structured tool calls from LLM text output when models emit JSON as plain text instead of using the tool_calls API.
- `llm/client.ts` — `LLMClient`. Two-tier architecture with independent `ProviderPool`s for each tier, both via OpenRouter. Executor pool: `google/gemini-3-flash-preview:nitro`. Planner pool: `minimax/minimax-m2.5`. Executor fallback: `google/gemini-3.1-flash-lite-preview`. `ProviderPool` manages cooldowns (60s on 429). `fetchWithRetry` returns `{ response, actualProviderId, actualModel }`. `switchToPlanner()` reads from planner pool, `switchToExecutor()` reads from executor pool. `applyNitro()` appends `:nitro` suffix when `useNitro` setting is enabled. `llm/types.ts` defines `LLMMessage`, `CompletionRequest`, `CompletionResponse` (with `actualModel` for failover attribution), `ProviderConfig`. Barrel-exported via `llm/index.ts`.
- `tools/registry.ts` — `ToolRegistry` singleton. Maps `ToolName` → executor function. `getDefinitions()` returns all tool schemas. `tools/index.ts` registers all 38 tools and bridges to content script.
- `tools/metadata.ts` — `ToolMeta` interface and pre-computed sets: `DOM_MODIFYING_TOOLS`, `SEQUENTIAL_TOOLS`. Single source of truth for tool properties (risk, domModifying, sequential). Used by `security.ts` and `loop.ts`.
- `workspaces/manager.ts` — `WorkspaceManager`. Maps workspaces to Chrome Tab Groups via `chrome.tabGroups`. Persists to `chrome.storage.local`.
- `keepalive.ts` — Service Worker keepalive via `chrome.alarms`. Creates a repeating alarm (~24s) to prevent SW termination during long agent loop runs. Start/stop tied to agent loop lifecycle.
- `navigation.ts` — Navigation bridge. Persists `AgentLoopState` to `chrome.storage.local` before page navigations, listens for `webNavigation.onCompleted` / `onErrorOccurred`, and resumes the agent loop with the tool result. Handles timeout (30s) and tab-closed cleanup.
- `security.ts` — `classifyRisk()` maps each `ToolName` to a `RiskLevel` (low/medium/high) via tool metadata. `sanitizeUrl()` blocks non-http(s) protocols. `sanitizeUserInput()` strips null bytes and truncates.
- `streaming.ts` — `parseSSEStream()`. Parses OpenAI-compatible SSE streams, accumulating text deltas and tool calls across chunks. Captures `usage` (token counts + cost) from the final SSE chunk. Returns final content, assembled `ToolCall[]`, and `TokenUsage`.

### Content Script (`src/content/`)

Injected into every page at `document_idle`. Handles DOM snapshot generation and action execution.

- `content.ts` — Message listener. Routes `DOM_SNAPSHOT_REQUEST`, `TOOL_EXECUTE`, and `DISMISS_MODALS` messages. Runs `autoDismissModals()` to clear cookie banners and overlay modals on load.
- `tagging.ts` — Vimium-style numeric tagging of interactive elements (`[N]` labels). Generates `TaggedElement[]`. Tags `canvas` and `[draggable='true']` elements. Extracts label associations (explicit `<label for>`, implicit wrapper, aria-labelledby).
- `snapshot.ts` — `buildSnapshot()`. Produces `DomSnapshot` with tagged elements, visible content, scroll position.
- `actions.ts` — `executeAction()`. Implements click, type, scroll, hover, find, select, press_key, drag_and_drop, draw_stroke, and hide_element on tagged elements by ID.

### Side Panel (`src/sidepanel/`)

React 18 + Tailwind CSS UI rendered in Chrome's side panel.

- `App.tsx` — Root component. Composes Header, StatusLine, PlanStrip, MessageBubble, InputArea.
- `store.ts` — Zustand + Immer store. Holds `SidePanelState` (messages, agent status, settings, error, taskProgress, taskCompletion, stagnationState, turnProgress).
- `bridge.ts` — `initializeBridge()`. Centralized message router with exhaustive `never` check. Routes all `RuntimeMessage` types to store actions. Sends `USER_CHAT`, `STOP_AGENT`, `PAUSE_AGENT`, `RESUME_AGENT`, `SKIP_SUBTASK` messages.
- `components/` — `Header`, `MessageBubble`, `InputArea` (barrel-exported), plus `SettingsDrawer`, `ToolCallBadge`, `StatusLine`, `PlanStrip`, `PlanTimelineCard`, `StepTimeline`, `ApprovalOverlay`, `ClarificationOverlay`, `EscalationOverlay`, `DemoLibrary`, `DemoRecordButton`, `DemoSaveModal`, `ErrorBoundary`, `ModelSelector`, `PlanStepIcon`, `SavedPromptsDrawer`, `ScreenshotLightbox`.

### Utilities (`src/utils/`)

Shared utilities used across all execution contexts. Barrel-exported via `index.ts`.

- `logger.ts` — Structured `Logger` class. Auto-detects execution context (background/content/sidepanel). Color-coded DevTools output with collapsible groups. Persists to `chrome.storage.local` via `storage-logger.ts`.
- `storage-logger.ts` — `StorageLogger` ring buffer (2000 entries) in `chrome.storage.local`. Batched writes (20 entries or 5s interval). Auto-redacts API keys/tokens. Also drains to local HTTP server (`127.0.0.1:7589`) for disk persistence when `npm run logs` is running.
- `context.ts` — `getExecutionContext()` detects which Chrome extension context code is running in. Helpers: `isContentScript()`, `isBackground()`, `isSidepanel()`.

### Types (`src/types/index.ts`)

Single source of truth for all interfaces. Key patterns:

- `RuntimeMessage` — discriminated union (discriminant: `type` field) for all inter-context messages. Includes `STREAM_CHUNK`, `NAVIGATION_RESUME`, `SETTINGS_UPDATE`, `SIDE_PANEL_OPENED`, `CLOSE_SIDE_PANEL`, `DISMISS_MODALS`, `AGENT_STAGNATION`, `AGENT_TURN`, `TASK_PROGRESS`, `TASK_COMPLETION`, `PAUSE_AGENT`, `RESUME_AGENT`, `SKIP_SUBTASK`, `AGENT_STEP`, `AGENT_ACTIVITY`, `SCREENSHOT_CAPTURED`, `PLAN_CONFIRMATION_REQUEST`, `PLAN_CONFIRMATION_RESPONSE`, `CLARIFICATION_REQUEST`, `CLARIFICATION_RESPONSE`.
- `ToolName` enum → `ToolArgsMap` maps each tool to its typed arguments.
- `ToolDefinition` — OpenAI function-calling schema format, used by `ToolRegistry`.
- `RiskLevel` enum (low/medium/high) for tool risk classification.
- `NavigationState` — serialized agent state for cross-navigation persistence.
- `Result<T, E>` — discriminated union for fallible operations.
- `UserSettings` — OpenRouter API key, maxTurns, theme, showSessionMetrics, model overrides (executorModel, plannerModel, perceptionModel), useNitro toggle.

### Messaging Protocol

All cross-context communication uses `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` with `RuntimeMessage` payloads. Each message carries a `requestId` (UUID), `source` (enum: sidepanel, background, content), and optional `workspaceId` for workspace-scoped routing. Side panel bridge filters messages by `activeWorkspaceId`. Background→content tool execution uses `TOOL_EXECUTE` / `TOOL_RESULT`. Background→content modal cleanup uses `DISMISS_MODALS` / `DISMISS_MODALS_RESPONSE`. Background→sidepanel streaming uses `STREAM_CHUNK`. Navigation resumption uses `NAVIGATION_RESUME`. Agent feedback uses `AGENT_STAGNATION`, `AGENT_TURN`, `TASK_PROGRESS`, `TASK_COMPLETION`. User control uses `PAUSE_AGENT`, `RESUME_AGENT`, `SKIP_SUBTASK`.

### Traces & Evals

**Trace Recording** (`src/background/agent/trace.ts`): `TraceRecorder` captures full-fidelity execution data from every live agent session — DOM snapshots, LLM requests/responses, tool executions, events. Data drains to `traces/` via the log server (fire-and-forget, zero cost when server is down). Types in `src/types/index.ts`: `TraceEntry`, `TraceToolExecution`, `TraceEvent`, `TraceSession`.

**Trace Server** (`scripts/log-server.ts`): The existing log server (port 7589) also handles trace endpoints: `POST /traces` appends per-turn entries to `traces/{sessionId}.jsonl`, `POST /traces/session` writes session metadata to `traces/index.jsonl`.

**Trace Query** (`scripts/trace-query.ts`): CLI for querying trace files. Commands: `list`, `show <id>`, `turns <id>`, `turn <id> <N>`, `filter --outcome <o>`, `stats`.

**Trace Viewer** (`src/trace-viewer/`): Built-in React UI for inspecting recorded sessions. Served by the log server at `http://127.0.0.1:7589/viewer`. Shows session list, per-turn LLM/tool details, and screenshots. Start with `npm run logs` or `npm run dev`.

**Eval Pipeline** (`evals/`): Trace-based evaluation system that replays recorded interactions offline.

- `types.ts` — `EvalCase`, `EvalResult`, `JudgeScore` types.
- `converter.ts` — Converts trace sessions into eval cases using strategies: `first-turn`, `any-turn`, `recovery`, `escalation`.
- `runner.ts` — Replays eval cases against the LLM via OpenRouter (no browser needed).
- `scorer.ts` — Scoring: tool name match, param match (fuzzy), sequence alignment (Levenshtein).
- `judge.ts` — LLM-as-judge (Claude Sonnet) with 5-dimension rubric + prompt fix suggestions.
- `extractor.ts` — Golden case extraction from specific trace turns with corrected expectations.
- `report.ts` — Actionable markdown report generator with per-pathology breakdown.
- `cli.ts` — CLI entry point: `extract`, `critique`, `regression`, `convert`, `run`, `stats`, `analyze`.
- `utils.ts` — Shared utilities: file I/O, API key loading, Levenshtein distance.
- `golden/` — 10 curated golden cases (2 per pathology) with real system prompts.

**Workflow**: Record traces → Extract golden cases → Run critique (`npm run evals:critique`) → Read report → Apply prompt fixes → Re-run critique to verify.

### Scripts (`scripts/`)

- `log-server.ts` — Node.js HTTP server (`127.0.0.1:7589`). Receives log batches from the extension's `StorageLogger` and appends to `logs/opensidebar.jsonl`. 50MB rotation, 5 files max.
- `log-query.ts` — CLI for querying JSONL logs. Commands: `tail [N]`, `errors`, `since <duration>`, `level <lvl>`, `category <cat>`, `search <text>`, `stats`, `help`.

## Testing

### Unit Tests

Tests use **Vitest** with `happy-dom` for DOM simulation. The global test setup (`tests/setup.ts`) mocks `chrome.*` APIs, `getBoundingClientRect`, `scrollIntoView`, etc. Tests live in `tests/` mirroring `src/` structure. E2E tests are excluded from `npm test`.

Test files cover: agent loop, context manager, keepalive, navigation bridge, security, streaming, tools, content script (tagging, snapshot, shadow DOM), sidepanel store, and logger.

### E2E Tests (`tests/e2e/`)

Real browser tests using Puppeteer. Launches headed Chrome with the built extension, sends tasks via `chrome.runtime.sendMessage`, and watches the agent interact with fixture pages. Requires `OPENROUTER_API_KEY` (env var or `.env` file); skipped if missing.

- `online-shop.test.ts` — Shopping flow (5 variants): add to cart, apply coupon, select shipping, checkout. Includes multi-item, quantity change, and apparel tests.
- `online-shop-natural.test.ts` — Natural language checkout prompt (no structured steps).
- `online-shop-boundaries.test.ts` — Step advancement without done() rejection churn.
- `navigation-challenge.test.ts` — Sequential interaction: click Advance 3x, read revealed code, enter and submit.
- `multi-step-form.test.ts` — 3-step wizard with conditional fields (Enterprise → Company Name).
- `dashboard.test.ts` — Tab switch to Settings, type email, save settings.
- `edge-cases.test.ts` — Error recovery (form validation), delayed content, impossible task graceful stop.
- `summarize.test.ts` — Read-only page summarization in ≤2 turns.
- `article-research.test.ts` — Scroll to find footnote source and report it.
- `execute-js.test.ts` — JavaScript execution in page context.
- `go-back-navigation.test.ts` — Browser back navigation across pages.
- `scroll-find.test.ts` — Scroll and find element tests.
- `sequential-tasks.test.ts` — Sequential task execution.
- `tab-management.test.ts` — Tab creation, switching, and closing.
- `helpers/browser.ts` — Puppeteer launch with extension, SW discovery, helper page.
- `helpers/utils.ts` — `sendUserChat()`, `waitForOutcome()`, `resetExtensionState()`, event monitoring.
- `helpers/fixture-server.ts` — HTTP server for fixture HTML files (avoids `file://` content script issues).
- `helpers/diagnostics.ts` — Log server lifecycle, CDP console capture, trace file reading + summary.
- `fixtures/` — Single React app: `online-shop-pro/` with routes for all fixtures (`/shop`, `/summarize`, `/article`, `/navigation`, `/dashboard`, `/form`, `/errors`)
- `vitest.e2e.config.ts` — Separate Vitest config (node env, 360s timeout, single fork, retry:1).

Run: `npm run test:e2e` (builds first, then runs). Each test suite launches its own Chrome instance. `beforeEach` cleanup resets agent state between test cases.

## Debugging

When investigating errors (build failures, runtime exceptions, unexpected behavior), **check the logs first** — they are the best source of truth for what actually happened at runtime.

1. **Start the log drain** (if not already running): `npm run logs`
2. **Query recent errors**: `npm run logs:errors`
3. **Tail live output**: `npm run logs:tail`
4. **Search for a keyword**: `npx tsx scripts/log-query.ts search <text>`
5. **Log file location**: `logs/opensidebar.jsonl` (JSONL format, one structured entry per line)

The extension's `StorageLogger` captures structured logs from all three execution contexts (background, content, sidepanel) with auto-redacted secrets. When `npm run logs` is running, entries drain to disk in real time; otherwise they accumulate in `chrome.storage.local` (ring buffer, 2000 entries).

For build errors, also check `npm run build` output directly — Vite/Rollup surface missing exports, unresolved imports, and type mismatches there.

## Prompt Change Workflow

When modifying agent prompts or LLM-facing behavior (system prompts, tool descriptions, reflection messages, demos):

1. **Baseline**: Run `npm run evals:validate` (structural) + `npm run test:e2e` and record pass/fail counts.
2. **Change**: Make the prompt change.
3. **Re-eval**: Run `npm run evals:validate` again — structural validation must still pass.
4. **E2E gate**: Run `npm run test:e2e` — compare with baseline. No regression on previously passing tests.
5. **Document**: Write a dated report in `docs/e2e-report-YYYY-MM-DD.md` with a comparison table.

Key principle: **The planner should plan, not execute.** When the executor gets stuck, the planner produces a revised plan and hands back to the executor — it does not execute tools directly. This is enforced by `replanOnEscalation()` in `loop.ts`.

## Design Principles

### Generic over task-specific

All agent infrastructure (planning, progress tracking, completion judgment, stagnation detection) must be **task-agnostic**. Never hardcode logic for a specific website, challenge, or workflow. The agent should handle a complex multi-step workflow the same way it handles a multi-page checkout, a complex form, or a research task across multiple tabs.

- **No site-specific heuristics.** If a pattern only works on one site, it doesn't belong in the agent loop.
- **The agent adapts through prompting and demonstrations, not code.** If the user wants the agent to solve a specific challenge, they describe it in the input. The agent uses recorded demos to learn and recall strategies across sessions.
- **Tools are generic primitives.** Click, type, scroll, navigate — not "solve step 5 of the challenge." Higher-level behavior emerges from the LLM's reasoning over these primitives.
- **Plans are dynamic.** The planner decomposes any user query into subtasks based on context — it doesn't have a list of known task templates.

### When in doubt, ask: "Would this work on a site I've never seen?"

## Path Aliases

`@/*` maps to `./src/*` (configured in both `tsconfig.json` and `vite.config.ts`).
