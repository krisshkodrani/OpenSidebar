# Architecture Overview

OpenSidebar is an AI-powered Chrome extension that transforms the browser into an agentic workspace. This document provides a high-level overview of the system architecture.

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                        Side Panel                           │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Chat UI    │  │   Settings   │  │  Saved Prompts  │  │
│  │  (React)    │  │   Drawer     │  │     Drawer      │  │
│  └──────┬──────┘  └──────────────┘  └──────────────────┘  │
│         │                                                   │
│         ▼                                                   │
│  ┌────────────────────────────────────────────────────┐   │
│  │              Zustand Store + Immer                 │   │
│  └────────────────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────────────────┐   │
│  │     Metrics Bar (token usage, cost tracking)        │   │
│  └────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ Chrome Extension Messaging
┌───────────────────────────▼─────────────────────────────────┐
│                    Service Worker                           │
│  ┌────────────────────────────────────────────────────┐   │
│  │                  Agent Loop                        │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │   │
│  │  │  LLM     │  │ Context  │  │   Tool Registry   │  │   │
│  │  │ Client   │  │ Manager  │  │   (52 tools)     │  │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘  │   │
│  │                                                      │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │   │
│  │  │ Progress │  │  Plan    │  │   Trace          │  │   │
│  │  │ Tracker  │  │ Guardian │  │   Recorder       │  │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘  │   │
│  └────────────────────────────────────────────────────┘   │
│                         │                                   │
│         ┌───────────────┼───────────────┐                   │
│         ▼               ▼               ▼                   │
│  ┌────────────┐            ┌────────────┐            ┌────────────┐
│  │ Navigation │            │   Memory   │            │  Workspace │
│  │  Bridge    │            │   Bridge   │            │  Manager   │
│  └────────────┘            └────────────┘            └────────────┘
│                                              │              │
│  ┌───────────────────────────────────────────┼──────────────┐
│  │          Storage Logger (JSONL rotation)   │              │
│  └───────────────────────────────────────────┼──────────────┘
└──────────────────────────────────────────────┼──────────────┘
                                               │
┌──────────────────────────────────────────────▼──────────────┐
│              Offscreen Document (Memory)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │  SQLite     │  │    Voy      │  │ Transformers.js  │   │
│  │  FTS5       │  │  (Vector)   │  │   (Embeddings)  │   │
│  └─────────────┘  └─────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                               ▲
                               │ Chrome Tabs API
┌──────────────────────────────┴──────────────────────────────┐
│                  Content Script (per tab)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │  Element    │  │   DOM       │  │   Action          │   │
│  │  Tagging    │  │  Snapshot   │  │   Execution      │   │
│  └─────────────┘  └─────────────┘  └──────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Janitor (cookie banner auto-dismiss)              │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Communication Flow

### 1. User Sends Message

```
Side Panel → Background: USER_CHAT
Background → Content Script: DOM_SNAPSHOT_REQUEST
Content Script → Background: DOM_SNAPSHOT_RESPONSE
Background → LLM API: Streaming request
LLM API → Background: SSE chunks
Background → Side Panel: STREAM_CHUNK (real-time)
```

### 2. Tool Execution

```
Background → Content Script: TOOL_EXECUTE
Content Script → Background: TOOL_RESULT
Background → LLM: Include result in next prompt
```

### 3. Memory Operations

```
Background → Offscreen: MEMORY_WORKER
Offscreen → Worker: embed request
Worker → Offscreen: embedding
Offscreen → Background: MEMORY_WORKER_RESPONSE
```

### 4. Navigation

```
Background → Chrome Tabs: tabs.update (navigate)
Background → Storage: Save state
Chrome → Background: webNavigation.onCompleted
Background → Content Script: DOM_SNAPSHOT_REQUEST (new page)
Background → Side Panel: AGENT_RESPONSE (resumed)
```

### 5. Session Metrics

```
Background → Side Panel: SESSION_METRICS (real-time token/cost tracking)
Background → Side Panel: TASK_COMPLETION (with metrics summary)
```

## Technology Stack

| Layer               | Technology                                     |
| ------------------- | ---------------------------------------------- |
| **Platform**        | Chrome Extension Manifest V3                   |
| **Build**           | Vite 5 + @crxjs/vite-plugin                    |
| **Language**        | TypeScript 5.7 (strict mode)                   |
| **Package Manager** | Bun                                            |
| **UI**              | React 18 + Tailwind CSS 3.4                    |
| **State**           | Zustand + Immer                                |
| **Fast LLM**        | OpenRouter (GPT-OSS-120B), Groq, or Cerebras   |
| **Smart LLM**       | X.AI Grok 4.1 Fast (via escalation)            |
| **Vision LLM**      | OpenRouter API (configurable, default Qwen VL) |
| **Embeddings**      | Transformers.js (all-MiniLM-L6-v2)             |
| **Vector Search**   | Voy (WASM)                                     |
| **Keyword Search**  | SQLite WASM (FTS5)                             |
| **Tests**           | Bun test runner + Happy DOM                    |

## Per-Tab Sidebar Behavior

**Critical:** Sidebar is strictly per-tab and does not auto-open:

- **Click to open:** Sidebar only opens when user clicks extension icon
- **Auto-close on tab switch:** When user switches to a different tab, sidebar automatically closes
- **No auto-reopen:** When switching back to a tab where sidebar was open, it stays closed (user must click icon again)
- **Independent state:** Each tab maintains its own sidebar open/closed state

## Auto-Managed Workspaces

Workspaces are now **completely automatic and invisible** to users:

- **Auto-create:** When user opens sidebar on a tab, a workspace is automatically created
- **Auto-group:** When agent creates new tabs, they're automatically added to the current workspace's tab group
- **Auto-delete:** When all tabs in a workspace are closed, the workspace automatically deletes
- **Visual only:** Users see Chrome Tab Groups in the tab bar but no workspace UI in sidebar
- **No manual management:** Users cannot create, delete, or switch workspaces manually

## Directory Structure

```
src/
├── background/          # Service worker code
│   ├── background.ts    # Entry point
│   ├── agent/
│   │   ├── loop.ts      # AgentLoop orchestration
│   │   ├── context.ts   # ContextManager (sliding window)
│   │   ├── progress.ts  # ProgressTracker (stuck detection)
│   │   ├── step-labels.ts # Step label generation
│   │   ├── guardian.ts  # PlanGuardian (task decomposition)
│   │   ├── executor.ts  # Tool execution orchestration
│   │   └── tool-recovery.ts # Extract tool calls from plain text
│   ├── llm/
│   │   ├── client.ts    # Multi-provider LLM client (OpenRouter, Groq, Cerebras)
│   │   └── types.ts     # LLM types
│   ├── tools/
│   │   ├── index.ts     # 52 tool definitions
│   │   ├── registry.ts  # ToolRegistry
│   │   ├── metadata.ts  # ToolMeta, pre-computed sets
│   │   └── screenshot.ts # Screenshot with element tags
│   ├── memory/
│   │   └── bridge.ts    # Offscreen communication
│   ├── workspaces/
│   │   └── manager.ts   # Workspace/Tab Group management
│   ├── vision.ts        # Vision LLM bridge (screenshot descriptions)
│   ├── navigation.ts    # Navigation Bridge
│   ├── keepalive.ts     # SW keepalive alarm
│   ├── streaming.ts     # SSE parser
│   ├── security.ts      # Risk classification
│   └── logger.ts        # Storage Logger with JSONL rotation
├── content/             # Content script (DOM access)
│   ├── content.ts       # Message listener + autoDismissModals
│   ├── snapshot.ts      # DOM distillation
│   ├── tagging.ts       # Element tagging
│   ├── actions.ts       # Tool execution (DOM actions)
│   └── janitor.ts       # Cookie banner auto-dismiss
├── sidepanel/           # React UI
│   ├── App.tsx          # Main component with message handling
│   ├── store.ts         # Zustand state
│   ├── bridge.ts        # Message routing
│   └── components/     # UI components
│       ├── Header.tsx
│       ├── MessageBubble.tsx
│       ├── InputArea.tsx
│       ├── ControlBar.tsx
│       ├── StuckBanner.tsx
│       ├── TaskProgressPanel.tsx
│       ├── MetricsBar.tsx
│       ├── CompletionSummary.tsx
│       ├── SettingsDrawer.tsx
│       └── SavedPromptsDrawer.tsx
├── offscreen/           # Offscreen document
│   └── memory/
│       ├── main.ts      # SQLite + Voy coordination
│       ├── worker.ts    # Embedding worker
│       ├── utils.ts     # RRF algorithm
│       └── index.html
├── types/               # TypeScript types
│   └── index.ts         # Single source of truth
└── utils/               # Shared utilities
    ├── logger.ts        # Structured logging
    └── context.ts       # Execution context detection

tests/                   # Test files mirror src structure
docs/                   # Documentation
evals/                  # Offline evaluation framework
```

## Key Design Patterns

### 1. Message Passing

All inter-context communication uses typed discriminated unions:

```typescript
type RuntimeMessage =
    | UserChatMessage        // Side panel → background
    | AgentResponseMessage   // Background → side panel
    | AgentStatusMessage     // Background → side panel
    | StreamChunkMessage     // Background → side panel
    | ToolExecuteMessage     // Background → content script
    | AgentStuckMessage      // Background → side panel (stuck detection)
    | AgentTurnMessage       // Background → side panel (turn progress)
    | TaskProgressMessage    // Background → side panel (subtask progress)
    | SessionMetricsMessage  // Background → side panel (token/cost tracking)
    | PauseAgentMessage      // Side panel → background
    | ResumeAgentMessage     // Side panel → background
    | ...;                   // 27+ members total
```

Every message has:

- `type` - Discriminant
- `requestId` - UUID for correlation
- `source` - Origin context
- `workspaceId` - Optional scope for workspace isolation

### 2. State Management

**Side Panel:** Zustand with Immer for immutable updates

```typescript
const useStore = create<Store>()(
  immer((set) => ({
    messages: [],
    agentStatus: AgentStatus.IDLE,
    sessionMetrics: null,
    // ...actions
  })),
);
```

**Background:** Chrome storage (session for ephemeral, local for persistent)

### 3. Tool System

Tools are registered dynamically:

```typescript
toolRegistry.register(
  ToolName.CLICK_ELEMENT,
  CLICK_DEF, // JSON schema
  (args, tabId) => executeClick(args, tabId), // Handler
);
```

### 4. Streaming Architecture

SSE from LLM → parseSSEStream → STREAM_CHUNK → Zustand → React

Real-time text streaming without waiting for full response.

### 5. Navigation Persistence

Agent state saved to `chrome.storage.local` before navigation, restored via `webNavigation.onCompleted` after page load.

### 6. Session Tracing

Full-fidelity recording of agent sessions for offline evaluation replay:

```typescript
interface TraceEntry {
  sessionId: string;
  turnNumber: number;
  snapshot: {...};
  llmRequest: {...};
  llmResponse: {...};
  toolExecutions: TraceToolExecution[];
  events: TraceEvent[];
}
```

## Security

### Risk Classification

Tools classified by risk level:

- **LOW:** Read-only (read_page, scroll_page, memory_search, etc.)
- **MEDIUM:** Mutates state (click_element, type_text, memory_add)
- **HIGH:** Navigation/tabs (navigate, create_tab, close_tab, etc.)

Risk displayed in UI but not blocking (autonomous agent model).

### Input Sanitization

```typescript
function sanitizeUserInput(text: string): string {
  // Remove null bytes, truncate to 10k chars
  return text.replace(/\0/g, "").slice(0, 10_000);
}

function sanitizeUrl(url: string): Result<string> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: `Blocked: ${parsed.protocol}` };
  }
  return { ok: true, value: parsed.href };
}
```

## Performance Considerations

### 1. Sliding Window Context

Keeps conversation within token limits while preserving critical context (system message, original query, recent messages).

### 2. Web Worker Embeddings

Transformers.js runs in web worker to avoid blocking offscreen document.

### 3. IndexedDB Persistence

SQLite and Voy state persisted for fast restarts.

### 4. Service Worker Keepalive

Alarm fires every ~24 seconds to prevent SW termination during long operations.

### 5. JSONL Log Rotation

Storage Logger writes to `logs/opensidebar.jsonl` with 50MB rotation and 5 file max.

### 6. Session Metrics Tracking

Real-time token usage and cost tracking with provider breakdown.

## Testing Strategy

| Test Type         | Location                     |
| ----------------- | ---------------------------- |
| Unit tests        | `tests/**/*.test.ts`         |
| Component tests   | `tests/sidepanel/*.test.tsx` |
| Integration tests | Manual E2E                   |

**Coverage:** 71+ tests, ~85% coverage

## Extension Lifecycle

1. **Install:** Load unpacked from `dist/` folder
2. **Startup:** SW initializes, registers listeners
3. **Side Panel Open:** React mounts, connects to store
4. **User Message:** Agent loop starts, streaming begins
5. **Navigation:** State saved, resumed after load
6. **Session End:** Trace written, metrics finalized
7. **Shutdown:** State persisted to storage

## Evals Framework

OpenSidebar includes an offline evaluation framework for testing agent behavior:

- **Golden Datasets:** YAML test cases in `evals/golden/cases/`
- **Metrics:** Success rate, tool efficiency, error handling
- **CLI Commands:**
  - `bun run evals` - Run evaluation suite
  - `bun run evals:stats` - Show statistics
  - `bun run evals:analyze` - Analyze with suggestions

## See Also

- [Project Setup](./project-setup.md) - Build configuration
- [Content Script](./content-script.md) - DOM interaction
- [Agent Loop](./agent-loop.md) - Core orchestration
- [Navigation Bridge](./navigation-bridge.md) - State persistence
- [Memory System](./memory-system.md) - RAG implementation
- [Tools](./tools.md) - 52 tool definitions
- [Types Reference](./types-reference.md) - TypeScript types
- [Message Protocol](./message-protocol.md) - Message passing
