# Architecture Overview

OpenSidebar is an AI-powered Chrome extension that transforms the browser into an agentic workspace. This document provides a high-level overview of the system architecture.

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                        Side Panel                           │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Chat UI    │  │   Settings   │  │  Workspace       │  │
│  │  (React)    │  │   Drawer     │  │  Selector        │  │
│  └──────┬──────┘  └──────────────┘  └──────────────────┘  │
│         │                                                   │
│         ▼                                                   │
│  ┌────────────────────────────────────────────────────┐   │
│  │              Zustand Store + Immer                 │   │
│  └────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ Chrome Extension Messaging
┌───────────────────────────▼─────────────────────────────────┐
│                    Service Worker                           │
│  ┌────────────────────────────────────────────────────┐   │
│  │                  Agent Loop                        │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │   │
│  │  │  LLM     │  │ Context  │  │   Tool Registry  │  │   │
│  │  │ Client   │  │ Manager  │  │   (21 tools)     │  │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘  │   │
│  └────────────────────────────────────────────────────┘   │
│                         │                                   │
│         ┌───────────────┼───────────────┐                   │
│         ▼               ▼               ▼                   │
│  ┌────────────┐            ┌────────────┐                  │
│  │ Navigation │            │ Memory     │                  │
│  │ Bridge     │            │ Bridge     │                  │
│  └────────────┘            └────────────┘                  │
│                                              │              │
└──────────────────────────────────────────────┼──────────────┘
                                               │
┌──────────────────────────────────────────────▼──────────────┐
│              Offscreen Document (Memory)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │  SQLite     │  │    Voy      │  │ Transformers.js  │   │
│  │  FTS5       │  │  (Vector)   │  │   (Embeddings)   │   │
│  └─────────────┘  └─────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                               ▲
                               │ Chrome Tabs API
┌──────────────────────────────┴──────────────────────────────┐
│                  Content Script (per tab)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │  Element    │  │   DOM       │  │   Action         │   │
│  │  Tagging    │  │  Snapshot   │  │   Execution      │   │
│  └─────────────┘  └─────────────┘  └──────────────────┘   │
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

## Technology Stack

| Layer               | Technology                         |
| ------------------- | ---------------------------------- |
| **Platform**        | Chrome Extension Manifest V3       |
| **Build**           | Vite 5 + @crxjs/vite-plugin        |
| **Language**        | TypeScript 5.7 (strict mode)       |
| **Package Manager** | Bun                                |
| **UI**              | React 18 + Tailwind CSS 3.4        |
| **State**           | Zustand + Immer                    |
| **Fast LLM**        | OpenRouter (Gemini 2.5 Flash Lite) |
| **Smart LLM**       | OpenRouter (MiniMax M2.5, via model escalation) |
| **Vision LLM**      | OpenRouter API (configurable, default Gemini 2.0 Flash) |
| **Embeddings**      | Transformers.js (all-MiniLM-L6-v2) |
| **Vector Search**   | Voy (WASM)                         |
| **Keyword Search**  | SQLite WASM (FTS5)                 |
| **Tests**           | Bun test runner + Happy DOM        |

## Directory Structure

```
src/
├── background/          # Service worker code
│   ├── background.ts    # Entry point
│   ├── agent/
│   │   ├── loop.ts      # AgentLoop orchestration
│   │   ├── context.ts   # ContextManager (sliding window)
│   │   ├── progress.ts  # ProgressTracker (stuck detection)
│   │   └── step-labels.ts # Step label generation
│   ├── llm/
│   │   ├── client.ts    # OpenRouter LLM client
│   │   └── types.ts     # LLM types
│   ├── tools/
│   │   ├── index.ts     # 21 tool definitions
│   │   ├── registry.ts  # ToolRegistry
│   │   └── metadata.ts  # ToolMeta, pre-computed sets
│   ├── memory/
│   │   └── bridge.ts    # Offscreen communication
│   ├── workspaces/
│   │   └── manager.ts   # Workspace/Tab Group management
│   ├── vision.ts        # Vision LLM bridge (screenshot descriptions)
│   ├── navigation.ts    # Navigation Bridge
│   ├── keepalive.ts     # SW keepalive alarm
│   ├── streaming.ts     # SSE parser
│   └── security.ts      # Risk classification
├── content/             # Content script (DOM access)
│   ├── content.ts       # Message listener
│   ├── snapshot.ts      # DOM distillation
│   ├── tagging.ts       # Element tagging
│   └── actions.ts       # Tool execution (DOM actions)
├── sidepanel/           # React UI
│   ├── App.tsx
│   ├── store.ts         # Zustand state
│   ├── bridge.ts        # Message routing (exhaustive switch)
│   └── components/      # UI components
│       ├── StuckBanner.tsx
│       ├── TaskProgressPanel.tsx
│       └── ...
├── offscreen/           # Offscreen document
│   └── memory/
│       ├── main.ts      # SQLite + Voy coordination
│       ├── worker.ts    # Embedding worker
│       ├── utils.ts     # RRF algorithm
│       └── index.html
├── types/               # TypeScript types
│   └── index.ts         # Single source of truth
└── utils/               # Shared utilities
    └── logger.ts        # Structured logging

tests/                   # Test files mirror src structure
docs/                    # Documentation
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
    | PauseAgentMessage      // Side panel → background
    | ResumeAgentMessage     // Side panel → background
    | ...;                   // 26 members total
```

Every message has:

- `type` - Discriminant
- `requestId` - UUID for correlation
- `source` - Origin context
- `payload` - Message-specific data

### 2. State Management

**Side Panel:** Zustand with Immer for immutable updates

```typescript
const useStore = create<Store>()(
  immer((set) => ({
    messages: [],
    agentStatus: AgentStatus.IDLE,
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

## Security

### Risk Classification

Tools classified by risk level:

- **LOW:** Read-only (read_page, scroll_page, memory_search)
- **MEDIUM:** Mutates state (click_element, type_text, memory_add)
- **HIGH:** Navigation/tabs (navigate, create_tab, close_tab)

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

## Testing Strategy

| Test Type         | Location                     |
| ----------------- | ---------------------------- |
| Unit tests        | `tests/**/*.test.ts`         |
| Component tests   | `tests/sidepanel/*.test.tsx` |
| Integration tests | Manual E2E                   |

**Coverage:** 14 test files, ~85% coverage

## Extension Lifecycle

1. **Install:** Load unpacked from `dist/` folder
2. **Startup:** SW initializes, registers listeners
3. **Side Panel Open:** React mounts, connects to store
4. **User Message:** Agent loop starts, streaming begins
5. **Navigation:** State saved, resumed after load
6. **Shutdown:** State persisted to storage

## See Also

- [Project Setup](./project-setup.md) - Build configuration
- [Content Script](./content-script.md) - DOM interaction
- [Agent Loop](./agent-loop.md) - Core orchestration
- [Navigation Bridge](./navigation-bridge.md) - State persistence
- [Memory System](./memory-system.md) - RAG implementation
