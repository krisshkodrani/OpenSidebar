# OpenSidebar - Agent Guidelines

AI-powered Chrome extension with agentic browsing capabilities. Uses React + TypeScript + Zustand for UI, service worker for background tasks, content scripts for DOM interaction, and an orchestrator for multi-step task decomposition.

## Project Status

**Current Implementation: 95%+ Complete**

**Core Systems (All Working):**
- Side Panel UI - Chat interface with real-time streaming, orchestrator console, step timeline
- Agent Loop - 57 tools, sliding window context, progress tracking, feedback injection
- Orchestrator - Planner/executor/verifier pipeline with lane isolation, skills, and conversation collaboration
- Content Script - DOM distillation, element tagging, action execution, shadow DOM, React detection
- Navigation Bridge - State persistence across page loads
- Memory System - SQLite FTS5 + Voy vector search + RRF fusion
- Workspace Management - Auto-managed Chrome Tab Groups (invisible to user)
- Perception Layer - Vision-based page understanding (Groq Llama 4 Scout → GPT-4o-mini)
- Skills System - Learned skills from successful tasks, auto-replay on similar queries
- Evals Framework - Offline evaluation with golden datasets and trace replay

**Infrastructure:**
- SSE streaming parser with tool call accumulation and token usage tracking
- Service worker keepalive (alarms)
- Web Worker for embeddings (Transformers.js)
- Comprehensive test suite (600+ tests)
- Storage Logger with JSONL rotation and auto-redaction
- Progress Tracker with stuck detection and graduated intervention
- Session metrics with per-model cost attribution
- Prompt registry with versioned, parameterized prompts

## Architecture

Chrome Manifest V3 extension with four isolated execution contexts communicating via `chrome.runtime.onMessage`:

```
Side Panel (React/Zustand) <-> Service Worker <-> Content Script (DOM)
                                     |
                              ┌──────┴──────┐
                              │              │
                        Agent Loop     Orchestrator
                        (single-step)  (multi-step)
                              │              │
                              │    ┌─────────┼─────────┐
                              │    │         │         │
                              │  Planner  Executor  Verifier
                              │    │         │         │
                              │    └─────────┼─────────┘
                              │              │
                              ├──────────────┘
                              │
                       Offscreen Document
                  (Memory: SQLite + Voy + Transformers.js)
```

### Service Worker (`src/background/`)

The orchestrator. Receives user messages from the side panel, runs the agent loop or orchestrator pipeline, dispatches tool calls to the content script, and streams responses back.

- `background.ts` — Entry point. Message router for all `RuntimeMessage` types (chat, stop, workspace CRUD, settings, side panel lifecycle). Per-workspace `AgentLoop` instances via `agentLoops = Map<workspaceId, AgentLoop>`.
- `agent/loop.ts` — `AgentLoop` class. Runs the LLM→tool→LLM cycle with abort support, pause/resume, feedback injection, and progress tracking. Returns `LoopResult`. Unified mode: parallel tool execution, modal auto-dismiss, reflection→escalate→give-up for text-only responses. Barrel-exported via `agent/index.ts`.
- `agent/context.ts` — `ContextManager`. Builds the system prompt with DOM snapshot data. Manages sliding-window conversation history with dynamic compression (NONE→LIGHT→MEDIUM→HEAVY). `summarizeTrajectory()` compresses full history into a structured timeline before smart model handoff.
- `agent/stagnation.ts` — `StagnationMonitor`. Detects stuck loops via snapshot fingerprinting. Graduated intervention: reflection at 6 stagnant turns, escalate at 12. Broadcasts `AGENT_STAGNATION` signals.
- `agent/step-labels.ts` — Human-readable step label generation for `AgentStep` timeline entries.
- `agent/tool-recovery.ts` — `recoverToolCallsFromText()`. Extracts structured tool calls from LLM text output when models emit JSON as plain text.
- `agent/trace.ts` — `TraceRecorder`. Full-fidelity session recording (DOM snapshots, LLM requests/responses, tool executions, events). Drains to `traces/` via log server.
- `llm/client.ts` — `LLMClient`. Two-tier architecture with independent `ProviderPool`s. Fast pool: Cerebras (`gpt-oss-120b`) → Groq (`openai/gpt-oss-120b`) → OpenRouter (`openai/gpt-oss-120b`). Smart pool: Cerebras (`zai-glm-4.7`) → OpenRouter (`z-ai/glm-4.7`). `switchToSmart()` / `switchToFast()` for tier switching. GLM-4.7 has native reasoning (no reasoning parameter needed). `llm/types.ts` defines `LLMMessage`, `CompletionRequest`, `CompletionResponse` (with `actualModel` for failover attribution). Barrel-exported via `llm/index.ts`.
- `tools/registry.ts` — `ToolRegistry` singleton. Maps `ToolName` → executor function. `getDefinitions()` returns all tool schemas. `tools/index.ts` registers all 57 tools and bridges to content script / memory.
- `tools/metadata.ts` — `ToolMeta` interface and pre-computed sets: `DOM_MODIFYING_TOOLS`, `SEQUENTIAL_TOOLS`. Single source of truth for tool properties (risk, domModifying, sequential).
- `tools/react.ts` — React Toolkit: 4 on-demand tools (`inspect_react`, `react_set_input`, `inspect_react_tree`, `wait_for_react`) gated behind framework detection.
- `perception.ts` — `perceive()`. Vision-based page understanding. Sends screenshot + element summary to vision model → structured 6-section output. Provider failover: Groq Llama 4 Scout → OpenRouter GPT-4o-mini. Fingerprint-based caching.
- `memory/bridge.ts` — Creates the offscreen document and relays memory commands to it.
- `workspaces/manager.ts` — `WorkspaceManager`. Maps workspaces to Chrome Tab Groups via `chrome.tabGroups`.
- `keepalive.ts` — Service Worker keepalive via `chrome.alarms` (~24s interval).
- `navigation.ts` — Navigation bridge. Persists state before navigations, resumes after page load.
- `security.ts` — `classifyRisk()` maps `ToolName` to `RiskLevel`. `sanitizeUrl()` blocks non-http(s). `sanitizeUserInput()` strips null bytes.
- `streaming.ts` — `parseSSEStream()`. Parses SSE streams, accumulates tool calls, captures `usage` from final chunk for token tracking.

### Orchestrator (`src/background/orchestrator/`)

Multi-step task decomposition and execution pipeline. Activated for complex tasks that benefit from planning.

- `index.ts` — Main orchestrator class. Manages the planner→executor→verifier lifecycle. Lane isolation ensures each role runs in its own execution context. Handles evidence exchange, cross-role reflexion, pre-flight review, retrospective, and advocate triad.
- `types.ts` — `OrchestratorTask`, `TaskNode`, `NodeHandoffArtifact`, `StructuredEvidence`, `PlannerReflexionEntry`, `AdvocateResponse`, `PlanReviewResult`, `RetrospectiveResult`.
- `planner.ts` — `Planner`. Decomposes user queries into `TaskNode` graphs. `expandNode()` for re-planning on failure. `retrospective()` for post-task learning from failures.
- `verifier.ts` — `Verifier`. Validates executor results against success criteria. `runDialogue()` for multi-round verifier-critic debate. `reviewPlan()` for pre-flight plan validation. `advocateChallenge()` for balanced deliberation.
- `handoff.ts` — Context building for role transitions. `buildVerifierContext()`, `buildAssumptionDriftSignal()`. Formats structured evidence for downstream roles.
- `retry-policy.ts` — `decideRetryPolicy()`. Classifies failures into categories (insufficient_evidence, state_mismatch, etc.) and determines retry strategy.
- `scheduling.ts` — Node scheduling and dependency resolution.
- `budget-estimator.ts` — Token budget estimation for LLM calls.
- `contracts.ts` — Inter-role contracts and type definitions.
- `memory-buffer.ts` — Buffered memory operations during orchestrator runs.

### Skills (`src/background/skills/`)

- `store.ts` — `SkillStore`. Persists learned skills to `chrome.storage.local`. `learnFromTask()` extracts reusable plans from successful orchestrator runs. `findMatchingSkill()` retrieves skills for auto-replay on similar queries.

### Prompts (`src/prompts/`)

- `registry.ts` — `PromptRegistry`. Maps `PromptId` to versioned prompt templates. Includes system prompts for planner, verifier, executor, pre-flight review, retrospective, and advocate roles.
- `types.ts` — `PromptId` union type. All prompt identifiers.
- `render.ts` — Template rendering with parameter substitution.

### Content Script (`src/content/`)

Injected into every page at `document_idle`. Handles DOM snapshot generation and action execution.

- `content.ts` — Message listener. Routes `DOM_SNAPSHOT_REQUEST`, `TOOL_EXECUTE`, and `DISMISS_MODALS` messages. Runs `autoDismissModals()` on load.
- `tagging.ts` — Vimium-style numeric tagging of interactive elements. Stable hash-based IDs (FNV-1a). Tags `canvas`, `[draggable='true']`, and inline clickable elements.
- `snapshot.ts` — `buildSnapshot()`. Produces `DomSnapshot` with tagged elements, visible content, scroll position, framework detection.
- `actions.ts` — `executeAction()`. Implements click, type, scroll, hover, find, select, press_key, drag_and_drop, draw_stroke, and hide_element.
- `framework-detect.ts` — Detects React via fiber keys. Gates React Toolkit tools.

### Side Panel (`src/sidepanel/`)

React 18 + Tailwind CSS UI rendered in Chrome's side panel.

- `App.tsx` — Root component. Composes all sub-components.
- `store.ts` — Zustand + Immer store. Holds `SidePanelState`.
- `bridge.ts` — `initializeBridge()`. Centralized message router with exhaustive `never` check.
- `hooks/useSpeechToText.ts` — Voice input via Browser Speech API or Groq Whisper.
- `components/` — `Header`, `MessageBubble`, `InputArea` (feedback mode during agent runs), `ControlBar` (pause/resume/turn counter), `SettingsDrawer`, `StatusBar`, `ToolCallBadge`, `StallBanner`, `TaskProgressPanel`, `CompletionSummary`, `MetricsBar`, `StepTimeline`, `OrchestratorConsole`, `PlanBoard`, `LearnedSkillsPanel`, `EscalationBanner`, `ApprovalBanner`, `RecoveryBanner`, `ArchitectureStrip`, `ScreenshotLightbox`, `SavedPromptsDrawer`, `PromptPicker`.

### Offscreen Document (`src/offscreen/`)

Runs heavy memory operations outside the service worker.

- `offscreen.ts` — Entry point.
- `memory/main.ts` — Message handler wrapping `VectorStore`.
- `memory/storage.ts` — `VectorStore`. Hybrid search: Transformers.js embeddings (all-MiniLM-L6-v2) + Voy vector search + SQLite FTS5 keyword search, fused with RRF.
- `memory/utils.ts` — `reciprocalRankFusion()`. RRF scoring (K=60).
- `memory/worker.ts` — Web Worker for Transformers.js embedding pipeline.

### Utilities (`src/utils/`)

Shared utilities. Barrel-exported via `index.ts`.

- `logger.ts` — Structured `Logger` class. Auto-detects execution context. Persists via `storage-logger.ts`.
- `storage-logger.ts` — `StorageLogger` ring buffer (2000 entries). Batched writes. Auto-redacts API keys. Drains to local HTTP server (`127.0.0.1:7589`).
- `context.ts` — `getExecutionContext()` detects Chrome extension context.

## LLM Architecture

Two-tier model system with independent provider pools and automatic failover:

| Tier | Models | Purpose |
|------|--------|---------|
| **Fast** (tier 0) | `gpt-oss-120b` (Cerebras → Groq → OpenRouter) | Default execution, most turns |
| **Smart** (tier 1) | `zai-glm-4.7` / `z-ai/glm-4.7` (Cerebras → OpenRouter) | Escalation, planning, GLM-4.7 with native reasoning |

- `ProviderPool` manages cooldowns (60s on 429) and immediate failover
- `fetchWithRetry` returns `{ response, actualProviderId, actualModel }` for failover attribution
- `stream_options: { include_usage: true }` ensures Cerebras/Groq return token counts
- `tool_choice: "auto"` sent when tools are present
- Think-tag stripping: `stripThinkTags()` + `createThinkFilter()` in client.ts
- Think blocks preserved raw in conversation history for reasoning chain continuity

## Orchestrator Pipeline

For complex tasks, the orchestrator decomposes into a planner→executor→verifier pipeline:

```
User Query
    ↓
Planner (smart model)
    ↓ TaskNode graph
[Pre-flight Review] ← Verifier reviews plan (≥3 nodes)
    ↓
Executor (fast model) ← runs each node via AgentLoop
    ↓ result + StructuredEvidence
Verifier (smart model) ← validates against success criteria
    ↓
  ┌─accept──→ next node
  ├─retry───→ executor (with reflexion context)
  │            └── [Advocate] challenges retry (low confidence, first attempt)
  └─reroute─→ planner (expand/replace node)
    ↓
[Retrospective] ← Planner learns from failures (if any)
    ↓
Task Complete → [Skill Learning] (if teach mode ON)
```

### Conversation Collaboration Patterns

| Pattern | When | Cost |
|---------|------|------|
| Structured Evidence | Every executor completion | Zero |
| Cross-Role Reflexion | Verifier retry/reroute → planner | Zero |
| Pre-flight Review | Plans with 3+ nodes | 1 LLM call |
| Planner Retrospective | Task end with failures | 1 LLM call |
| Advocate Triad | Retry + low confidence + first attempt | 1 LLM call |
| Verifier-Critic Dialogue | Every verification | Already existed |
| Skill Learning | Successful task + teach mode ON | Zero |

### Escalation

Two-tier escalation: tier 0 (fast) → tier 1 (smart):
- Screenshots unlock at tier 1
- Context distillation on escalation: `summarizeTrajectory()` replaces raw history with compact timeline
- plan-then-act pattern: start smart (tier 1) for 2 turns, hand off to fast (tier 0)
- Text-only response: reflection → escalate (at 2, tier 0→1 only) → give-up (at 3)

## Skills System

Learned skills enable the agent to replay successful plans on similar future queries:

- **Teach Mode**: Toggle in settings. When ON and a task completes successfully, the orchestrator extracts the plan as a reusable skill.
- **Feedback Coaching**: During active runs, the input area switches to amber "Send feedback..." mode. Feedback is injected into the agent's context via `injectFeedback()`.
- **Auto-Replay**: When a new query matches a learned skill, the orchestrator replays the stored plan instead of re-planning from scratch.
- **Management**: Side panel → Settings → Learned Skills panel shows all skills with pin/enable controls.

## Per-Tab Sidebar + Auto-Managed Workspaces

### Per-Tab Sidebar Behavior

- **Click to open:** Sidebar only opens when user clicks extension icon
- **Auto-close on tab switch:** Automatically closes on tab switch
- **No auto-reopen:** User must click icon again
- **Independent state:** Each tab maintains its own state

### Auto-Managed Workspaces

Workspaces are **automatic and invisible** to users:
- **Auto-create** on sidebar open
- **Auto-group** new tabs into workspace's tab group
- **Auto-delete** when all tabs close
- **Visual only** via Chrome Tab Groups (no workspace UI in sidebar)

## Build/Lint/Test Commands

```bash
npm run dev            # Vite dev server with HMR
npm run build          # Production build
npm run lint           # ESLint (src/**/*.ts,tsx)
npm run fmt            # Prettier format src/
npm test               # Run all tests (600+)
npx vitest run tests/background/agent.test.ts  # Single test file

npm run logs           # Start log drain server (127.0.0.1:7589)
npm run logs:tail      # Show last 50 entries
npm run logs:errors    # Show error-level entries

npm run traces -- list  # List recorded sessions
npm run traces -- stats # Aggregate trace statistics

npm run evals          # Eval pipeline CLI
npm run evals:critique # Critique eval results
```

**Note:** The `tsconfig.json` only includes `src/` — test files under `tests/` are not type-checked by `tsc`.

## Code Style Guidelines

### Imports

- ES modules (`"type": "module"` in package.json)
- Path alias `@/` for src imports: `import { logger } from "@/utils"`
- Group: React/types first, then third-party, then local
- Named imports preferred over default

### TypeScript

- Strict mode enabled - no implicit any
- Explicit return types on exported functions
- Enums for finite states (AgentStatus, ToolName, MessageSource)
- Discriminated unions for message types
- Types in `src/types/index.ts` - single source of truth

### Naming Conventions

- PascalCase: components, classes, interfaces, enums, types
- camelCase: functions, variables, properties, methods
- UPPER_SNAKE_CASE: enum values
- Boolean props prefixed with `is`, `has`, `can`

### React Components

- Functional components with hooks
- `lucide-react` for icons
- Tailwind for styling (dark mode with `dark:` prefix)
- Store state in Zustand, local UI state with useState
- `useCallback` for event handlers passed to children

### Error Handling

- Try/catch with typed errors
- Structured logger: `logger.error("category", message, data)`
- `Result<T, E>` types for recoverable errors
- Propagate errors to UI via `store.setError()`

## File Structure

```
src/
├── background/           # Service worker code
│   ├── background.ts     # Entry point, message router
│   ├── agent/
│   │   ├── loop.ts       # AgentLoop orchestration
│   │   ├── context.ts    # ContextManager (sliding window + distillation)
│   │   ├── stagnation.ts  # StagnationMonitor (stuck detection)
│   │   ├── step-labels.ts # Human-readable step labels
│   │   ├── tool-recovery.ts # Extract tool calls from LLM text
│   │   └── trace.ts      # TraceRecorder (session recording)
│   ├── orchestrator/
│   │   ├── index.ts      # Orchestrator pipeline (planner→executor→verifier)
│   │   ├── types.ts      # OrchestratorTask, TaskNode, evidence types
│   │   ├── planner.ts    # Task decomposition + retrospective
│   │   ├── verifier.ts   # Validation + dialogue + advocate + pre-flight
│   │   ├── handoff.ts    # Role transition context building
│   │   ├── retry-policy.ts # Failure classification + retry strategy
│   │   ├── scheduling.ts # Node scheduling + dependencies
│   │   ├── budget-estimator.ts # Token budget estimation
│   │   ├── contracts.ts  # Inter-role contracts
│   │   └── memory-buffer.ts # Buffered memory operations
│   ├── skills/
│   │   └── store.ts      # SkillStore (learn + replay)
│   ├── llm/
│   │   ├── client.ts     # Multi-provider LLM client (Cerebras/Groq/OpenRouter)
│   │   └── types.ts      # LLM types, ProviderConfig, TokenUsage
│   ├── tools/
│   │   ├── index.ts      # 53 core tool definitions + registration
│   │   ├── registry.ts   # ToolRegistry
│   │   ├── metadata.ts   # ToolMeta, DOM_MODIFYING_TOOLS, SEQUENTIAL_TOOLS
│   │   └── react.ts      # React Toolkit (4 on-demand tools)
│   ├── memory/
│   │   └── bridge.ts     # Offscreen document communication
│   ├── workspaces/
│   │   └── manager.ts    # Auto-managed workspace system
│   ├── perception.ts     # Perception layer
│   ├── navigation.ts     # Navigation Bridge (state persistence)
│   ├── keepalive.ts      # SW keepalive alarm
│   ├── streaming.ts      # SSE parser with usage capture
│   └── security.ts       # Risk classification + sanitization
├── content/              # Content script (runs in every tab)
│   ├── content.ts        # Main entry + message listener + auto-dismiss
│   ├── snapshot.ts       # DOM distillation
│   ├── tagging.ts        # Element tagging [1], [2], [3]... (stable hash IDs)
│   ├── actions.ts        # Tool execution (click, type, scroll, etc.)
│   └── framework-detect.ts # React/framework detection
├── prompts/              # Prompt registry
│   ├── registry.ts       # PromptRegistry (versioned templates)
│   ├── types.ts          # PromptId union type
│   ├── render.ts         # Template rendering
│   └── index.ts          # Barrel export
├── sidepanel/            # React UI (side panel)
│   ├── App.tsx           # Main component
│   ├── store.ts          # Zustand state management
│   ├── bridge.ts         # Message router
│   ├── hooks/
│   │   └── useSpeechToText.ts # Voice input (Browser/Groq Whisper)
│   └── components/       # UI components
│       ├── Header.tsx
│       ├── InputArea.tsx  # Chat input + feedback mode
│       ├── MessageBubble.tsx
│       ├── ControlBar.tsx # Pause/resume/turn counter
│       ├── SettingsDrawer.tsx
│       ├── StatusBar.tsx
│       ├── ToolCallBadge.tsx
│       ├── StallBanner.tsx
│       ├── StepTimeline.tsx
│       ├── TaskProgressPanel.tsx
│       ├── OrchestratorConsole.tsx
│       ├── PlanBoard.tsx
│       ├── LearnedSkillsPanel.tsx
│       ├── MetricsBar.tsx
│       ├── CompletionSummary.tsx
│       ├── EscalationBanner.tsx
│       ├── ApprovalBanner.tsx
│       ├── RecoveryBanner.tsx
│       ├── ArchitectureStrip.tsx
│       ├── ScreenshotLightbox.tsx
│       ├── SavedPromptsDrawer.tsx
│       └── PromptPicker.tsx
├── offscreen/            # Offscreen document (separate DOM context)
│   ├── offscreen.ts      # Entry point
│   └── memory/
│       ├── main.ts       # SQLite + Voy + RRF coordination
│       ├── storage.ts    # VectorStore hybrid search
│       ├── worker.ts     # Transformers.js embedding worker
│       ├── utils.ts      # RRF fusion algorithm
│       └── index.html
├── types/                # TypeScript types
│   └── index.ts          # Single source of truth
└── utils/                # Shared utilities
    ├── logger.ts         # Structured logging
    ├── storage-logger.ts # StorageLogger with auto-redaction
    └── context.ts        # Execution context detection

tests/                    # Test files mirror src structure (600+ tests)
docs/                     # Documentation
├── architecture/         # Technical architecture docs
├── features/             # Feature documentation
├── guides/               # User guides and runbooks
├── research/             # Research and analysis
└── rfc/                  # RFC documents (archived + active)
evals/                    # Offline evaluation framework
scripts/                  # Build/dev scripts
traces/                   # Recorded agent sessions
logs/                     # Application logs
```

## Key Types

**RuntimeMessage** - discriminated union (27+ members) for all inter-context messages. Key members: `USER_CHAT`, `STREAM_CHUNK`, `AGENT_STATUS`, `TOOL_EXECUTE`, `NAVIGATION_RESUME`, `SETTINGS_UPDATE`, `AGENT_STAGNATION`, `AGENT_TURN`, `TASK_PROGRESS`, `TASK_COMPLETION`, `PAUSE_AGENT`, `RESUME_AGENT`, `SKIP_SUBTASK`, `AGENT_STEP`, `SESSION_METRICS`, `SCREENSHOT_CAPTURED`.

**UserSettings** - Configuration:
```typescript
interface UserSettings {
  openRouterApiKey: string;
  groqApiKey: string;
  cerebrasApiKey: string;
  maxTurns: number;
  contextWindowSize: number;
  enableMemory: boolean;
  enableWorkspaces: boolean;
  theme: "light" | "dark" | "system";
  showElementTags: boolean;
  visionModel: string;
  confirmPlan: boolean;
  speechProvider: "browser" | "groq";
  showSessionMetrics: boolean;
  teachModeEnabled: boolean;
  autoSkillReplay: boolean;
}
```

## Tool System

57 tools registered in `src/background/tools/index.ts`:

**DOM Tools (11):** click_element, type_text, scroll_page, read_page, hover_element, find_element, select_option, press_key, drag_and_drop, draw_stroke, hide_element

**Navigation/Tab Tools (5):** navigate, create_tab, close_tab, switch_tab, wait

**Memory Tools (2):** memory_add, memory_search

**Chrome API Tools (12):** Various browser management tools

**Page Analysis (4):** inspect_hidden, xray_page, fast_forward, + 1 more

**React Toolkit (4, on-demand):** inspect_react, react_set_input, inspect_react_tree, wait_for_react

**Agent Control (4):** escalate, done, update_plan, pause_agent

**Special:** escalate switches to smart model (GLM-4.7), update_plan broadcasts progress

## Logging System

```bash
npm run logs           # Start log drain server (127.0.0.1:7589)
npm run logs:tail      # Show last 50 entries
npm run logs:errors    # Show error-level entries only
```

Log file: `logs/opensidebar.jsonl` (JSONL, 50MB rotation, 5 files max).

## Design Principles

### Generic over task-specific

All agent infrastructure must be **task-agnostic**. Never hardcode logic for a specific website or workflow.

- **No site-specific heuristics.** If a pattern only works on one site, it doesn't belong.
- **The agent adapts through prompting and memory, not code.**
- **Tools are generic primitives.** Click, type, scroll, navigate — higher-level behavior emerges from LLM reasoning.
- **Plans are dynamic.** The orchestrator decomposes any query based on context.

**When in doubt, ask: "Would this work on a site I've never seen?"**

## Debugging

1. **Start the log drain**: `npm run logs`
2. **Query recent errors**: `npm run logs:errors`
3. **Tail live output**: `npm run logs:tail`
4. **Search for a keyword**: `npx tsx scripts/log-query.ts search <text>`
5. **Check traces**: `npm run traces -- list` / `npm run traces -- stats`

For build errors, check `npm run build` output directly.

## Path Aliases

`@/*` maps to `./src/*` (configured in both `tsconfig.json` and `vite.config.ts`).
