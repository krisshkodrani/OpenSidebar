# OpenSidebar - Agent Guidelines

AI-powered Chrome extension with agentic browsing capabilities. Uses React + TypeScript + Zustand for UI, service worker for background tasks, and content scripts for DOM interaction.

## Project Status

**Current Implementation: 90%+ Complete**

✅ **Core Systems (All Working):**

- Side Panel UI - Fully wired to background agent with real-time streaming
- Agent Loop - Complete with 22 tools, sliding window context, progress tracking
- Content Script - DOM distillation, element tagging, action execution, shadow DOM support
- Navigation Bridge - State persistence across page loads
- Memory System - SQLite FTS5 + Voy vector search + RRF fusion
- Workspace Management - Auto-managed Chrome Tab Groups (invisible to user)
- Vision Model - Screenshot description via configurable vision LLM
- Evals Framework - Offline evaluation with golden datasets

✅ **Infrastructure:**

- SSE streaming parser with tool call accumulation
- Service worker keepalive (alarms)
- Web Worker for embeddings (Transformers.js)
- Comprehensive test suite (71+ tests, ~85% coverage)
- Storage Logger with JSONL rotation and auto-redaction
- Progress Tracker with stuck detection and graduated intervention

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
- `vision.ts` — `describeScreenshot(dataUrl)`. Sends screenshots to a vision LLM (configurable via `visionModel` setting, default `qwen/qwen3-vl-235b-a22b-instruct`) via OpenRouter for text descriptions. Used by `take_screenshot` tool. Retry logic with exponential backoff. Strips think-tags from output.
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

⚠️ **Minor Items (Nice-to-Have):**

- Swarm retry logic on 429/500 errors
- Response truncation (8000 char limit)

## New Architecture: Per-Tab Sidebar + Auto-Managed Workspaces

### Per-Tab Sidebar Behavior

**Critical:** Sidebar is strictly per-tab and does not auto-open:

- **Click to open:** Sidebar only opens when user clicks extension icon
- **Auto-close on tab switch:** When user switches to a different tab, sidebar automatically closes
- **No auto-reopen:** When switching back to a tab where sidebar was open, it stays closed (user must click icon again)
- **Independent state:** Each tab maintains its own sidebar open/closed state

### Auto-Managed Workspaces

Workspaces are now **completely automatic and invisible** to users:

- **Auto-create:** When user opens sidebar on a tab, a workspace is automatically created
- **Auto-group:** When agent creates new tabs, they're automatically added to the current workspace's tab group
- **Auto-delete:** When all tabs in a workspace are closed, the workspace automatically deletes
- **Visual only:** Users see Chrome Tab Groups in the tab bar but no workspace UI in sidebar
- **No manual management:** Users cannot create, delete, or switch workspaces manually

### User Flow Example

```
User clicks extension icon on google.com
    ↓
Sidebar opens on google.com
Workspace auto-created (visible as blue tab group: "Workspace 1")
google.com tab automatically added to group
    ↓
User asks: "Search flights to Paris"
    ↓
Agent creates tabs: Kayak, Expedia, Google Flights
All 3 tabs auto-added to blue "Workspace 1" group
Sidebar stays on google.com (conversation context)
    ↓
User switches to github.com (unrelated tab)
    ↓
Sidebar automatically closes
Blue tab group still visible but inactive
    ↓
User clicks extension icon on github.com
    ↓
Sidebar opens on github.com
NEW workspace auto-created (red group: "Workspace 2")
github.com added to red group
First workspace (flights) preserved separately
```

## Build/Lint/Test Commands

```bash
# Development (Vite dev server)
bun run dev

# Production build
bun run build

# Lint TypeScript
bun run lint

# Run all tests
bun test

# Run single test file
bun test tests/background/agent.test.ts

# Run tests matching pattern
bun test --grep "AgentLoop"

# Format code with Prettier
bun run fmt
```

**Note:** On Windows, bun may not be in PATH if installed via `npm install -g bun`. The `tsconfig.json` only includes `src/` — test files under `tests/` are not type-checked by `tsc`.

## Code Style Guidelines

### Imports

- Use ES modules (`"type": "module"` in package.json)
- Use path alias `@/` for src imports: `import { logger } from "@/utils"`
- Group imports: React/types first, then third-party, then local
- Named imports preferred over default
- **Always import types explicitly when used in function signatures**

Example:

```typescript
import React, { useEffect, useCallback } from "react";
import {
  AgentStatus,
  RuntimeMessage,
  MessageSource,
  ChatEntry,
} from "../types";
import { useStore } from "./store";
import { logger } from "../utils";
```

### TypeScript

- Strict mode enabled - no implicit any
- Explicit return types on exported functions
- Use enums for finite states (AgentStatus, ToolName, MessageSource)
- Discriminated unions for message types
- Types in `src/types/index.ts` - single source of truth
- **Use `const` assertions for literal types when needed**

### Naming Conventions

- PascalCase: components, classes, interfaces, enums, types
- camelCase: functions, variables, properties, methods
- UPPER_SNAKE_CASE: enum values
- Private class members prefixed with `_` (optional)
- Boolean props prefixed with `is`, `has`, `can` (e.g., `isAgentRunning`)

### React Components

- Functional components with hooks
- Props interface defined inline or above component
- Use `lucide-react` for icons
- Tailwind for styling (dark mode with `dark:` prefix)
- Store state in Zustand, local UI state with useState
- **Use useCallback for event handlers passed to child components**
- **Clean up event listeners in useEffect return functions**

Example:

```typescript
const handleSend = useCallback(
  async (text: string) => {
    // Implementation
  },
  [addMessage, setInputText, setAgentRunning, updateStatus, setError],
);
```

### Error Handling

- Try/catch with typed errors: `catch (error: any)`
- Check error.name for AbortError
- Log errors with structured logger: `logger.error("category", message, data)`
- Return Result types for recoverable errors
- Propagate errors to UI via store.setError()

### State Management

- Zustand store in `src/sidepanel/store.ts`
- Immer middleware for immutable updates
- Actions are methods in the store
- Background state persists to chrome.storage.session
- **Side panel state is reactive via Zustand subscriptions**

**Key Store Actions:**

- `addMessage(msg)` - Add chat message
- `appendStreamDelta(delta)` - Append to streaming message
- `finalizeStream()` - Mark streaming as complete
- `updateStatus(status, detail)` - Update agent status
- `setAgentRunning(isRunning)` - Toggle running state

### Chrome Extension Patterns

- Background (service worker): `src/background/`
- Content script: `src/content/content.ts`
- Sidepanel: `src/sidepanel/` - React app with direct message handling
- Offscreen document: `src/offscreen/`
- Message passing with discriminated union types
- Use `chrome.*` APIs (not `browser.*`)

**Important:** Side panel now handles messages directly in App.tsx, not through bridge.ts

### Side Panel Architecture

**Communication Flow:**

1. User sends message via InputArea → triggers `handleSend` in App.tsx
2. `handleSend` adds user message + assistant placeholder to store
3. `handleSend` queries active tab and sends `USER_CHAT` message to background
4. Background's agent loop processes request
5. Background sends `STREAM_CHUNK` messages during LLM streaming
6. App.tsx's message listener receives chunks and calls `appendStreamDelta`
7. Background sends final `AGENT_RESPONSE` or status update
8. Store updates trigger React re-render

**Message Handling in App.tsx:**

```typescript
useEffect(() => {
  const listener = (message: RuntimeMessage) => {
    if (message.source !== MessageSource.BACKGROUND) return;

    switch (message.type) {
      case "AGENT_STATUS":
        updateStatus(message.payload.status, message.payload.detail);
        setAgentRunning(message.payload.status !== AgentStatus.IDLE);
        break;
      case "STREAM_CHUNK":
        handleStreamChunk(message.payload);
        break;
      case "AGENT_RESPONSE":
        handleAgentResponse(message.payload);
        break;
    }
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}, []);
```

### Testing (Bun Test + Happy DOM)

```typescript
import { describe, test, expect, mock, spyOn, beforeEach } from "bun:test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

describe("Component", () => {
  beforeEach(() => {
    // Reset store state
    useStore.setState({ messages: [], agentStatus: AgentStatus.IDLE });
  });

  test("does something", () => {
    expect(result).toBe(expected);
  });
});
```

- Mock Chrome APIs in `tests/setup.ts`
- Use `mock()` for function mocks
- Use `mock.module()` for module mocks
- Tests use Happy DOM for DOM simulation
- **Reset Zustand store state in beforeEach**
- **Mock chrome.runtime.sendMessage and onMessage for sidepanel tests**

### Side Panel Testing

Key patterns for testing side panel:

```typescript
// Mock chrome.runtime
const mockSendMessage = mock(() => Promise.resolve({ success: true }));
const mockAddListener = mock((cb) => cb);
(globalThis as any).chrome = {
    runtime: {
        sendMessage: mockSendMessage,
        onMessage: {
            addListener: mockAddListener,
            removeListener: mock()
        }
    },
    tabs: {
        query: mock(() => Promise.resolve([{ id: 123 }]))
    }
};

// Test message sending
test("sends USER_CHAT message on submit", async () => {
    render(<App />);
    const input = screen.getByPlaceholderText("Ask OpenSidebar...");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "USER_CHAT",
                source: "sidepanel"
            })
        );
    });
});
```

### Logging

Always use the structured logger:

```typescript
import { logger } from "@/utils";

logger.debug("agent", "Processing message", { id: msg.id });
logger.info("ui", "Chat history cleared");
logger.warn("system", "Low memory", { available: "128MB" });
logger.error("system", "Failed to initialize", { error: err.message });
```

### File Structure

```
src/
├── background/           # Service worker code
│   ├── background.ts     # Entry point
│   ├── agent/
│   │   ├── loop.ts       # AgentLoop orchestration
│   │   ├── context.ts    # ContextManager with sliding window
│   │   ├── progress.ts   # ProgressTracker with stuck detection
│   │   ├── step-labels.ts # Human-readable step labels
│   │   └── tool-recovery.ts # Extract tool calls from LLM text
│   ├── llm/
│   │   ├── client.ts     # OpenRouter API client
│   │   └── types.ts      # LLM types
│   ├── tools/
│   │   ├── index.ts      # 22 tool definitions
│   │   ├── registry.ts   # ToolRegistry
│   │   └── metadata.ts   # Tool metadata and risk classification
│   ├── memory/
│   │   └── bridge.ts     # Offscreen document communication
│   ├── workspaces/
│   │   └── manager.ts    # Auto-managed workspace system
│   ├── vision.ts         # Screenshot description via vision model
│   ├── navigation.ts     # Navigation Bridge (state persistence)
│   ├── keepalive.ts      # SW keepalive alarm (prevents termination)
│   ├── streaming.ts      # SSE parser for LLM streaming
│   └── security.ts       # Risk classification + sanitization
├── content/              # Content script (runs in every tab)
│   ├── content.ts        # Main entry + message listener
│   ├── snapshot.ts       # DOM distillation
│   ├── tagging.ts        # Element tagging [1], [2], [3]...
│   ├── actions.ts        # Tool execution (click, type, scroll, etc.)
│   └── janitor.ts        # Cookie banner auto-dismiss
├── sidepanel/            # React UI (side panel)
│   ├── App.tsx           # Main component with message handling
│   ├── store.ts          # Zustand state management
│   ├── bridge.ts         # Message router (routes RuntimeMessages)
│   └── components/       # UI components
│       ├── Header.tsx
│       ├── InputArea.tsx
│       ├── MessageBubble.tsx
│       ├── ControlBar.tsx
│       ├── SettingsDrawer.tsx
│       ├── StatusBar.tsx
│       ├── ToolCallBadge.tsx
│       ├── StuckBanner.tsx
│       ├── TaskProgressPanel.tsx
│       └── CompletionSummary.tsx
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
├── utils/                # Shared utilities
│   ├── logger.ts         # Structured logging
│   ├── storage-logger.ts # StorageLogger with auto-redaction
│   └── context.ts        # Execution context detection
├── evals/                # Offline evaluation framework
│   ├── cli.ts            # CLI entry point (supports --stats and --analyze --suggest flags)
│   ├── core/             # Eval runner, metrics, reporter
│   │   ├── loader.ts     # YAML case loader
│   │   ├── runner.ts     # Eval executor
│   │   ├── metrics.ts    # Scoring
│   │   ├── reporter.ts   # Output formatting
│   │   └── types.ts
│   ├── golden/cases/     # YAML test cases (login forms, search, memory operations)
│   └── optimizer/        # Analyzer, tracker, suggester for identifying improvements
└── scripts/              # Build/dev scripts
    ├── log-server.ts     # Bun HTTP server for log draining
    └── log-query.ts      # CLI for querying JSONL logs

tests/                    # Test files mirror src structure
docs/                     # Documentation
    ├── architecture/     # Technical architecture docs
    ├── guides/           # User guides (future)
    └── *.md              # RFC documents
```

### Key Types

**RuntimeMessage** - discriminated union (26 members, discriminant: `type` field) for all inter-context messages:

```typescript
type RuntimeMessage =
    | UserChatMessage         // Side panel → Background
    | AgentStatusMessage      // Background → Side panel
    | StreamChunkMessage      // Background → Side panel (real-time)
    | AgentResponseMessage    // Background → Side panel (final)
    | ToolExecuteMessage      // Background → Content script
    | DomSnapshotRequest      // Background → Content script
    | MemoryWorkerMessage     // Background → Offscreen
    | STREAM_CHUNK            // Real-time LLM response
    | NAVIGATION_RESUME       // Continue after page load
    | SETTINGS_UPDATE        // User settings changed
    | SIDE_PANEL_OPENED      // Side panel opened
    | CLOSE_SIDE_PANEL       // Side panel closed
    | DISSMISS_MODALS        // Auto-dismiss modals
    | AGENT_STUCK            // Agent stuck detection
    | AGENT_TURN             // Agent turn indicator
    | TASK_PROGRESS          // Task progress update
    | TASK_COMPLETION        // Task completion
    | PAUSE_AGENT            // Pause agent
    | RESUME_AGENT           // Resume agent
    | SKIP_SUBTASK           // Skip current subtask
    | AGENT_STEP             // Agent step timeline
    | AGENT_ACTIVITY         // Agent activity update
    | SCREENSHOT_CAPTURED    // Screenshot captured
    | ...;
```

**ChatEntry** - Message in chat history:

```typescript
interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolCalls: ToolCallSummary[];
  isStreaming: boolean;
}
```

**AgentStatus** - Agent state machine:

```typescript
enum AgentStatus {
  IDLE = "IDLE", // Ready for input
  THINKING = "THINKING", // LLM is generating
  ACTING = "ACTING", // Executing tools
  WAITING_FOR_PAGE_LOAD = "WAITING_FOR_PAGE_LOAD", // Navigation
  WAITING_FOR_SWARM = "WAITING_FOR_SWARM", // Deep thinking
  ERROR = "ERROR", // Unrecoverable error
}
```

**ToolName** - 22 tools:

```typescript
enum ToolName {
  CLICK_ELEMENT = "click_element",
  TYPE_TEXT = "type_text",
  SCROLL_PAGE = "scroll_page",
  READ_PAGE = "read_page",
  HOVER_ELEMENT = "hover_element",
  FIND_ELEMENT = "find_element",
  SELECT_OPTION = "select_option",
  PRESS_KEY = "press_key",
  DRAG_AND_DROP = "drag_and_drop",
  DRAW_STROKE = "draw_stroke",
  HIDE_ELEMENT = "hide_element",
  NAVIGATE = "navigate",
  CREATE_TAB = "create_tab",
  CLOSE_TAB = "close_tab",
  SWITCH_TAB = "switch_tab",
  WAIT = "wait",
  TAKE_SCREENSHOT = "take_screenshot",
  MEMORY_ADD = "memory_add",
  MEMORY_SEARCH = "memory_search",
  ESCALATE = "escalate",
  DONE = "done",
  PAUSE_AGENT = "pause_agent",
  RESUME_AGENT = "resume_agent",
}
```

**RiskLevel** - Tool risk classification:

```typescript
enum RiskLevel {
  LOW = "low", // Read-only (read_page, scroll_page, memory_search)
  MEDIUM = "medium", // Mutates state (click_element, type_text, memory_add)
  HIGH = "high", // Navigation/tabs (navigate, close_tab, escalate)
}
```

**UserSettings** - Configuration options:

```typescript
interface UserSettings {
  apiKey: string;
  model: string;
  maxTurns: number;
  contextWindowSize: number;
  enableMemory: boolean;
  enableWorkspaces: boolean;
  theme: "light" | "dark" | "system";
  showElementTags: boolean;
  visionModel: string;
  confirmPlan: boolean;
}
```

### Messaging Protocol

All cross-context communication uses `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` with `RuntimeMessage` payloads. Each message carries a `requestId` (UUID) and `source` (enum: sidepanel, background, content, offscreen).

- Background→content tool execution: `TOOL_EXECUTE` / `TOOL_RESULT`
- Background→content modal cleanup: `DISMISS_MODALS` / `DISMISS_MODALS_RESPONSE`
- Background→offscreen memory: `MEMORY_WORKER` / `MEMORY_WORKER_RESPONSE`
- Background→sidepanel streaming: `STREAM_CHUNK`
- Navigation resumption: `NAVIGATION_RESUME`
- Agent feedback: `AGENT_STUCK`, `AGENT_TURN`, `TASK_PROGRESS`, `TASK_COMPLETION`
- User control: `PAUSE_AGENT`, `RESUME_AGENT`, `SKIP_SUBTASK`

### Tool System

22 tools registered in `src/background/tools/index.ts`:

**DOM Tools (Content Script):**

- `click_element` - Click tagged element
- `type_text` - Type into input field
- `scroll_page` - Scroll up/down
- `read_page` - Get DOM snapshot
- `hover_element` - Hover over element
- `find_element` - Find element by text
- `select_option` - Select dropdown option
- `press_key` - Press keyboard key
- `drag_and_drop` - Drag element to target
- `draw_stroke` - Draw on canvas
- `hide_element` - Hide element by ID

**Tab Tools (Service Worker):**

- `navigate` - Navigate to URL
- `create_tab` - Open new tab (auto-added to current workspace)
- `close_tab` - Close tab
- `switch_tab` - Switch to tab
- `wait` - Wait for duration
- `take_screenshot` - Capture viewport

**Special Tools:**

- `memory_add` - Save to Second Brain
- `memory_search` - Search Second Brain
- `escalate` - Switch to smarter model (MiniMax M2.5)
- `done` - Mark task complete
- `pause_agent` - Pause agent execution
- `resume_agent` - Resume agent execution

### Streaming Architecture

Real-time LLM response streaming:

```
LLM API → SSE chunks
    ↓
background/streaming.ts: parseSSEStream()
    ↓
Background sends STREAM_CHUNK { delta: "..." }
    ↓
sidepanel/App.tsx receives chunk
    ↓
store.appendStreamDelta(delta) - appends to last assistant message
    ↓
React re-renders MessageBubble with updated content
    ↓
User sees text appear character-by-character
```

### Navigation Persistence

When agent triggers navigation:

1. **Before navigation:** Agent state saved to `chrome.storage.local`
2. **Page loads:** `webNavigation.onCompleted` fires
3. **Restore:** Agent loop resumes with preserved context
4. **Continue:** Agent receives new DOM snapshot and continues

See `src/background/navigation.ts` for implementation.

### Memory System (Second Brain)

Hybrid RAG (Retrieval-Augmented Generation):

1. **User query** → embedding generated via Transformers.js (Web Worker)
2. **Semantic search** → Voy vector search (WASM)
3. **Keyword search** → SQLite FTS5 (WASM)
4. **Fusion** → RRF (Reciprocal Rank Fusion) combines results
5. **Context injection** → Top memories added to LLM prompt

All data stays client-side in IndexedDB.

### Security Model

**Risk Classification:**

- LOW: Read-only (read_page, scroll_page, memory_search)
- MEDIUM: Mutates state (click_element, type_text, memory_add)
- HIGH: Navigation/tabs (navigate, close_tab, activate_swarm)

**Input Sanitization:**

- User input truncated to 10k chars
- URLs validated (http/https only)
- No user data in LLM context injection

**Autonomous Operation:**

- Agent acts without confirmation gates
- Stop button is the safety mechanism
- Risk levels are informational only

### Performance Considerations

1. **Sliding Window Context** - Keeps conversation within token budget
2. **Web Worker Embeddings** - Transformers.js runs off main thread
3. **IndexedDB Persistence** - Fast restarts for SQLite/Voy
4. **Service Worker Keepalive** - 24s alarm prevents termination
5. **Streaming Parser** - Processes SSE chunks without buffering entire response

### Progress Tracking

The agent loop includes a `ProgressTracker` that monitors execution:

- **Stuck Detection:** Detects loops via snapshot fingerprinting (hashing DOM state)
- **Graduated Intervention:**
  - At 6 stale turns: Nudge the agent with a hint
  - At 12 stale turns: Escalate to smarter model
  - At 20+ turns: Give up and report failure
- **Signals:** Emits `AGENT_STUCK`, `AGENT_TURN`, `TASK_PROGRESS`, `TASK_COMPLETION` messages

See `src/background/agent/progress.ts` for implementation.

### Vision Model

The agent can analyze screenshots using a vision LLM:

- **Configuration:** Set via `visionModel` in user settings (default: `qwen/qwen3-vl-235b-a22b-instruct`)
- **Integration:** Via OpenRouter API
- **Retry Logic:** Exponential backoff on failure

See `src/background/vision.ts` for implementation.

### Evals Framework

Offline evaluation system for testing agent behavior:

- **Golden Datasets:** YAML test cases in `evals/golden/cases/`
- **Metrics:** Success rate, tool efficiency, error handling
- **CLI Commands:**
  - `bun run evals` - Run evaluation suite
  - `bun run evals:stats` - Show statistics
  - `bun run evals:analyze` - Analyze with suggestions

See `evals/` directory for implementation.

### Logging System

Structured logging with multiple output destinations:

- **StorageLogger:** Ring buffer (2000 entries) in `chrome.storage.local`
- **Auto-Redaction:** API keys/tokens automatically redacted
- **Real-time Draining:** When `bun run logs` is running, logs stream to disk
- **Log File:** `logs/opensidebar.jsonl` (JSONL format, 50MB rotation, 5 files max)

**Log Commands:**

```bash
bun run logs           # Start log drain server (127.0.0.1:7589)
bun run logs:query    # Query log file (tail, errors, since, search, stats)
bun run logs:tail     # Show last 50 entries
bun run logs:errors   # Show error-level entries only
```

### Design Principles

#### Generic over task-specific

All agent infrastructure (planning, progress tracking, completion judgment, stuck detection) must be **task-agnostic**. Never hardcode logic for a specific website, challenge, or workflow. The agent should handle a complex multi-step workflow the same way it handles a multi-page checkout, a complex form, or a research task across multiple tabs.

- **No site-specific heuristics.** If a pattern only works on one site, it doesn't belong in the agent loop.
- **The agent adapts through prompting and memory, not code.** If the user wants the agent to solve a specific challenge, they describe it in the input. The agent uses `memory_add` / `memory_search` to learn and recall strategies across sessions.
- **Tools are generic primitives.** Click, type, scroll, navigate — not "solve step 5 of the challenge." Higher-level behavior emerges from the LLM's reasoning over these primitives.
- **Plans are dynamic.** The guardian decomposes any user query into subtasks based on context — it doesn't have a list of known task templates.

#### When in doubt, ask: "Would this work on a site I've never seen?"

### Commits

Do NOT commit unless explicitly asked by the user.

### Testing Checklist

Before committing changes, ensure:

- [ ] `bun run lint` passes (or warnings only)
- [ ] `bun run build` succeeds
- [ ] `bun test` passes (all 71+ tests)
- [ ] New tests added for changed functionality
- [ ] Manual testing in Chrome extension
- [ ] Documentation updated if architecture changed

### Debugging

When investigating errors (build failures, runtime exceptions, unexpected behavior), **check the logs first** — they are the best source of truth for what actually happened at runtime.

1. **Start the log drain** (if not already running): `bun run logs`
2. **Query recent errors**: `bun run logs:errors`
3. **Tail live output**: `bun run logs:tail`
4. **Search for a keyword**: `bun run logs:query search <text>`
5. **Log file location**: `logs/opensidebar.jsonl` (JSONL format, one structured entry per line)

The extension's `StorageLogger` captures structured logs from all four execution contexts (background, content, sidepanel, offscreen) with auto-redacted secrets. When `bun run logs` is running, entries drain to disk in real time; otherwise they accumulate in `chrome.storage.local` (ring buffer, 2000 entries).

For build errors, also check `bun run build` output directly — Vite/Rollup surface missing exports, unresolved imports, and type mismatches there.

### Common Issues

**Issue:** "chrome is not defined" in tests
**Fix:** Import tests/setup.ts or mock chrome API

**Issue:** Zustand state not resetting between tests
**Fix:** Call `useStore.setState({...})` in beforeEach

**Issue:** Streaming not working (messages don't appear)
**Fix:** Check that App.tsx listener handles STREAM_CHUNK case

**Issue:** "No active tab" error
**Fix:** Ensure tab query has `{ active: true, currentWindow: true }`

**Issue:** Service worker terminates during long operations
**Fix:** Check keepalive.ts alarm is created (should fire every 24s)

### Resources

- **Architecture Docs:** `docs/architecture/`
- **RFC Documents:** `docs/*.md` (Phase 0-8)
- **Type Definitions:** `src/types/index.ts`
- **Test Examples:** `tests/background/*.test.ts`
- **Chrome Extension API:** https://developer.chrome.com/docs/extensions/

### Getting Started

1. Install dependencies: `bun install`
2. Copy env file: `cp .env.example .env` (add API keys)
3. Start dev server: `bun run dev`
4. Load extension: Chrome → Extensions → Load unpacked → Select `dist/`
5. Open side panel: Click extension icon
6. Send test message: "Go to google.com"
7. Watch agent browse and respond in real-time

## Path Aliases

`@/*` maps to `./src/*` (configured in both `tsconfig.json` and `vite.config.ts`).
