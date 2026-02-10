# OpenSidebar - Agent Guidelines

AI-powered Chrome extension with agentic browsing capabilities. Uses React + TypeScript + Zustand for UI, service worker for background tasks, and content scripts for DOM interaction.

## Project Status

**Current Implementation: 90%+ Complete**

✅ **Core Systems (All Working):**

- Side Panel UI - Fully wired to background agent with real-time streaming
- Agent Loop - Complete with 16 tools, sliding window context, security
- Content Script - DOM distillation, element tagging, action execution
- Navigation Bridge - State persistence across page loads
- Memory System - SQLite FTS5 + Voy vector search + RRF fusion
- Workspace Management - Auto-managed Chrome Tab Groups (invisible to user)

✅ **Infrastructure:**

- SSE streaming parser with tool call accumulation
- Service worker keepalive (alarms)
- Web Worker for embeddings (Transformers.js)
- Comprehensive test suite (71 tests, ~85% coverage)

⚠️ **Minor Items (Nice-to-Have):**

- Swarm retry logic on 429/500 errors
- Response truncation (8000 char limit)
- Shadow DOM support for web components

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
│   │   ├── loop.ts       # AgentLoop orchestration (THINKING → ACTING → IDLE)
│   │   └── context.ts    # ContextManager with sliding window
│   ├── llm/
│   │   ├── client.ts     # Cerebras/OpenRouter API clients
│   │   └── types.ts      # LLM types
│   ├── tools/
│   │   ├── index.ts      # 16 tool definitions
│   │   └── registry.ts   # ToolRegistry
│   ├── memory/
│   │   └── bridge.ts     # Offscreen document communication
│   ├── workspaces/
│   │   └── manager.ts    # Auto-managed workspace system
│   ├── swarm.ts          # Kimi k2.5 Deep Thought delegation
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
│   ├── bridge.ts         # DEPRECATED - logic moved to App.tsx
│   └── components/       # UI components
│       ├── Header.tsx
│       ├── InputArea.tsx
│       ├── MessageBubble.tsx
│       ├── ControlBar.tsx
│       └── SettingsDrawer.tsx
├── offscreen/            # Offscreen document (separate DOM context)
│   └── memory/
│       ├── main.ts       # SQLite + Voy + RRF coordination
│       ├── worker.ts     # Transformers.js embedding worker
│       ├── utils.ts      # RRF fusion algorithm
│       └── index.html
├── types/                # TypeScript types
│   └── index.ts          # Single source of truth
└── utils/                # Shared utilities
    └── logger.ts         # Structured logging

tests/                    # Test files mirror src structure
docs/                     # Documentation
    ├── architecture/     # Technical architecture docs
    ├── guides/           # User guides (future)
    └── *.md              # RFC documents
```

### Key Types

**RuntimeMessage** - All inter-context communication:

```typescript
type RuntimeMessage =
    | UserChatMessage         // Side panel → Background
    | AgentStatusMessage      // Background → Side panel
    | StreamChunkMessage      // Background → Side panel (real-time)
    | AgentResponseMessage    // Background → Side panel (final)
    | ToolExecuteMessage      // Background → Content script
    | DomSnapshotRequest      // Background → Content script
    | MemoryWorkerMessage     // Background → Offscreen
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

### Tool System

16 tools registered in `src/background/tools/index.ts`:

**DOM Tools (Content Script):**

- `click_element` - Click tagged element
- `type_text` - Type into input field
- `scroll_page` - Scroll up/down
- `read_page` - Get DOM snapshot
- `hover_element` - Hover over element
- `find_element` - Find element by text

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
- `activate_swarm` - Delegate to Kimi k2.5
- `done` - Mark task complete

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
