# Side Panel UI

The side panel is OpenSidebar's user-facing interface built with React, TypeScript, and Tailwind CSS. It provides a chat interface, real-time streaming display, workspace management, and settings configuration.

## Architecture

**Location:** `src/sidepanel/`

**Files:**

- `App.tsx` - Main component with message handling logic
- `store.ts` - Zustand state management
- `bridge.ts` - **DEPRECATED** (logic moved to App.tsx)
- `components/` - UI components (Header, InputArea, MessageBubble, etc.)

## Component Hierarchy

```
App (Main container)
├── Header
│   └── Settings button
├── SettingsDrawer (conditional overlay)
├── Main Chat Area
│   ├── Welcome screen (empty state)
│   └── MessageBubble[] (chat messages)
├── ControlBar
│   └── Status indicators
└── Bottom Section
    ├── WorkspaceSelector
    └── InputArea
        └── Send button / Stop button
```

## State Management

The side panel uses **Zustand** with **Immer** for immutable state updates:

```typescript
interface SidePanelState {
  messages: ChatEntry[]; // Chat history
  agentStatus: AgentStatus; // Current agent state
  statusDetail: string; // Status description
  inputText: string; // Current input value
  isAgentRunning: boolean; // Disable input when true
  activeWorkspace: Workspace | null; // Selected workspace
  workspaces: Workspace[]; // Available workspaces
  settings: UserSettings; // App configuration
  error: string | null; // Error message
}
```

**Key Actions:**

- `addMessage(msg)` - Add message to chat history
- `appendStreamDelta(delta)` - Append text to streaming message
- `finalizeStream()` - Mark streaming as complete
- `updateStatus(status, detail)` - Update agent status
- `setAgentRunning(isRunning)` - Toggle running state
- `setInputText(text)` - Update input field

## Communication Flow

The side panel communicates directly with the background service worker via Chrome extension messaging.

### Message Handling Architecture

**Location:** `App.tsx` (lines 97-156)

```typescript
useEffect(() => {
  const listener = (message: RuntimeMessage) => {
    if (message.source !== MessageSource.BACKGROUND) return;

    switch (message.type) {
      case "AGENT_STATUS":
        // Update status indicator
        updateStatus(message.payload.status, message.payload.detail);
        setAgentRunning(message.payload.status !== AgentStatus.IDLE);
        break;

      case "STREAM_CHUNK":
        // Append to streaming message in real-time
        handleStreamChunk(message.payload);
        break;

      case "AGENT_RESPONSE":
        // Final response or stream completion
        handleAgentResponse(message.payload);
        break;
    }
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}, []);
```

### Sending Messages to Agent

**Location:** `App.tsx` - `handleSend` function (lines 218-276)

```typescript
const handleSend = useCallback(async (text: string) => {
    // 1. Add user message + assistant placeholder
    const userEntry: ChatEntry = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: Date.now(),
        toolCalls: [],
        isStreaming: false,
    };

    const assistantEntry: ChatEntry = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",           // Starts empty for streaming
        timestamp: Date.now(),
        toolCalls: [],
        isStreaming: true,     // Mark as streaming
    };

    addMessage(userEntry);
    addMessage(assistantEntry);

    // 2. Get active tab
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    // 3. Send to background
    await chrome.runtime.sendMessage({
        type: "USER_CHAT",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        payload: {
            text,
            tabId: tab?.id ?? 0,
            workspaceId: store.activeWorkspace?.id ?? null,
        },
    });
}, [...]);
```

### Streaming Handler

**Location:** `App.tsx` - `handleStreamChunk` (lines 172-180)

```typescript
const handleStreamChunk = useCallback(
  (payload: { delta: string; done: boolean }) => {
    const { delta, done } = payload;
    if (done) {
      finalizeStream(); // Mark streaming complete
    } else if (delta) {
      appendStreamDelta(delta); // Append text to last assistant message
    }
  },
  [appendStreamDelta, finalizeStream],
);
```

## Message Types

### Incoming (Background → Side Panel)

**AGENT_STATUS**

```typescript
{
    type: "AGENT_STATUS",
    source: "background",
    payload: {
        status: AgentStatus,    // THINKING, ACTING, IDLE, etc.
        detail: string          // Human-readable description
    }
}
```

**STREAM_CHUNK**

```typescript
{
    type: "STREAM_CHUNK",
    source: "background",
    payload: {
        delta: string,  // Text chunk to append
        done: boolean   // true when stream complete
    }
}
```

**AGENT_RESPONSE**

```typescript
{
    type: "AGENT_RESPONSE",
    source: "background",
    payload: {
        text: string,              // Full response text
        isStreaming: boolean,      // Whether still streaming
        toolCalls: ToolCallSummary[]  // Executed tools
    }
}
```

**WORKSPACE_UPDATE**

```typescript
{
    type: "WORKSPACE_UPDATE",
    source: "background",
    payload: {
        workspaces: Workspace[],
        activeWorkspaceId: string | null
    }
}
```

### Outgoing (Side Panel → Background)

**USER_CHAT**

```typescript
{
    type: "USER_CHAT",
    source: "sidepanel",
    requestId: string,
    payload: {
        text: string,              // User message
        tabId: number,             // Active tab ID
        workspaceId: string | null // Current workspace
    }
}
```

**STOP_AGENT**

```typescript
{
    type: "STOP_AGENT",
    source: "sidepanel",
    requestId: string,
    payload: {}
}
```

## Components

### MessageBubble

Displays chat messages with:

- User messages (right-aligned, blue background)
- Assistant messages (left-aligned, gray background)
- Tool call badges (collapsible)
- Streaming indicator (pulsing cursor)

### InputArea

- Auto-resizing textarea
- Send button (converts to Stop button when running)
- Enter to submit, Shift+Enter for new line
- Disabled state when agent is running

### WorkspaceSelector

- Dropdown to select active workspace
- Create new workspace button
- Delete workspace button
- Syncs with Chrome Tab Groups

### SettingsDrawer

- Cerebras API key input
- OpenRouter API key input
- Max turns slider
- Memory enabled toggle
- Workspace enabled toggle
- Theme selector (light/dark/system)

## Dark Mode

Dark mode uses Tailwind's `dark:` prefix:

```typescript
// Applied via class on document.documentElement
useEffect(() => {
  const root = document.documentElement;
  const isDark =
    settings.theme === "dark" ||
    (settings.theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}, [settings.theme]);
```

## Lifecycle

1. **Mount** - App.tsx initializes, sets up message listener
2. **Load Workspaces** - Fetches initial workspace list from background
3. **User Input** - Text entered in InputArea
4. **Send** - handleSend called, messages added to store
5. **Background Processing** - Agent loop processes request
6. **Streaming** - STREAM_CHUNK messages update UI in real-time
7. **Complete** - AGENT_STATUS: IDLE or AGENT_RESPONSE finalizes

## Testing

**tests/sidepanel/store.test.ts** - Store actions and state
**tests/sidepanel/app.test.tsx** - Component rendering, message flow

### Mock Pattern

```typescript
const mockSendMessage = mock(() => Promise.resolve({ success: true }));
(globalThis as any).chrome = {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: {
      addListener: mock((cb) => cb),
      removeListener: mock(),
    },
  },
  tabs: {
    query: mock(() => Promise.resolve([{ id: 123 }])),
  },
};
```

## Deprecated: bridge.ts

The `bridge.ts` file exists for historical reference but is **no longer used**. All message handling logic has been moved directly into `App.tsx` following the RFC 02-sidepanel-ui.md specification.

**Why it was deprecated:**

- Having bridge logic in a separate file created indirection
- App.tsx is the natural place for message handling
- Easier to follow the data flow when message handlers are co-located with component

## Key Implementation Notes

1. **Always filter by source** - Check `message.source === MessageSource.BACKGROUND` to ignore echoes
2. **Cleanup listeners** - Always return cleanup function from useEffect
3. **Use useCallback** - Memoize handlers to prevent unnecessary re-renders
4. **Optimistic updates** - Add user message immediately before API call
5. **Placeholder assistant** - Create streaming placeholder before sending to background
6. **Error handling** - Catch sendMessage failures and update error state

## See Also

- [Architecture Overview](./overview.md) - System-wide architecture
- [Agent Loop](./agent-loop.md) - Background processing
- [Project Setup](./project-setup.md) - Build configuration
