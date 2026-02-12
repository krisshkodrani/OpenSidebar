# Side Panel UI

The side panel is OpenSidebar's user-facing interface built with React, TypeScript, and Tailwind CSS. It provides a chat interface, real-time streaming display, workspace management, and settings configuration.

## Architecture

**Location:** `src/sidepanel/`

**Files:**

- `App.tsx` - Main component, composes all sub-components
- `store.ts` - Zustand + Immer state management
- `bridge.ts` - Centralized message router with exhaustive `never` check. Routes all `RuntimeMessage` types to store actions
- `components/` - UI components (Header, InputArea, MessageBubble, ControlBar, StuckBanner, TaskProgressPanel, CompletionSummary, etc.)

## Component Hierarchy

```
App (Main container)
├── Header
│   └── Settings button
├── SettingsDrawer (conditional overlay)
├── StuckBanner (visible when agent is stuck)
├── Main Chat Area
│   ├── Welcome screen (empty state)
│   └── MessageBubble[] (chat messages)
│       └── CompletionSummary (in final assistant message)
├── ControlBar
│   ├── Status indicators (incl. PAUSED)
│   ├── Pause / Resume buttons
│   └── Turn counter (turn / maxTurns)
├── TaskProgressPanel (visible during decomposed tasks)
└── Bottom Section
    └── InputArea
        └── Send / Send Hint / Stop button
```

## State Management

The side panel uses **Zustand** with **Immer** for immutable state updates:

```typescript
interface SidePanelState {
  messages: ChatEntry[];                              // Chat history
  agentStatus: AgentStatus;                           // Current agent state (incl. PAUSED)
  statusDetail: string;                               // Status description
  inputText: string;                                  // Current input value
  isAgentRunning: boolean;                            // Disable input when true
  settings: UserSettings;                             // App configuration
  error: string | null;                               // Error message
  taskProgress: TaskProgressMessage["payload"] | null; // Active subtask progress
  taskCompletion: TaskCompletionMessage["payload"] | null; // Completed task report
  stuckState: StuckState | null;                      // Agent stuck detection
  turnProgress: TurnProgress | null;                  // Current turn / maxTurns
}
```

**Key Actions:**

- `addMessage(msg)` - Add message to chat history
- `appendStreamDelta(delta)` - Append text to streaming message
- `finalizeStream()` - Mark streaming as complete
- `updateStatus(status, detail)` - Update agent status
- `setAgentRunning(isRunning)` - Toggle running state
- `setInputText(text)` - Update input field
- `setStuckState(state)` - Set/clear stuck detection banner
- `setTaskProgress(payload)` - Update subtask progress panel
- `setTaskCompletion(payload)` - Set task completion report
- `setTurnProgress(payload)` - Update turn counter

## Communication Flow

The side panel communicates directly with the background service worker via Chrome extension messaging.

### Message Handling Architecture

**Location:** `bridge.ts` — `initializeBridge()`

The bridge module is the centralized message router. It uses an exhaustive `switch` on `RuntimeMessage.type` with a `never` check to ensure all message types are handled:

```typescript
// Simplified — bridge.ts routes all RuntimeMessage types to store actions
chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  switch (message.type) {
    case "AGENT_STATUS":
      updateStatus(message.payload.status, message.payload.detail);
      break;
    case "STREAM_CHUNK":
      handleStreamChunk(message.payload);
      break;
    case "AGENT_RESPONSE":
      handleAgentResponse(message.payload);
      break;
    case "AGENT_STUCK":
      setStuckState(message.payload);
      break;
    case "AGENT_TURN":
      setTurnProgress(message.payload);
      break;
    case "TASK_PROGRESS":
      setTaskProgress(message.payload);
      break;
    case "TASK_COMPLETION":
      setTaskCompletion(message.payload);
      break;
    // ... all 26 message types handled
    default:
      const _exhaustive: never = message;
  }
});
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
- **Hint mode**: When agent is running, input stays enabled — messages are sent as hints with amber "Send Hint" button and MessageCircle icon
- Enter to submit, Shift+Enter for new line

### StuckBanner

- Fixed-position banner between Header and main chat area
- Visible only when `stuckState !== null`
- **Nudge**: yellow styling (`bg-yellow-50`)
- **Escalate**: orange styling (`bg-orange-50`)
- Dismissible; auto-clears on `AGENT_STUCK` with `signal: "resolved"` or when agent goes idle

### TaskProgressPanel

- Anchored between ControlBar and InputArea
- Shows subtask checklist with status icons (pending/running/completed/failed/skipped)
- Turn counter per subtask and total turns used
- "Skip" button for current running subtask
- Collapsible; auto-expands when a subtask transitions to `running`
- Hidden when `taskProgress` is null

### CompletionSummary

- Rendered inside the final assistant `MessageBubble` when `completionData` is present
- Color-coded header: green (completed), yellow (partial), red (failed)
- Shows subtask results checklist, total turns, duration, URL history breadcrumb

### SettingsDrawer

- OpenRouter API key input
- Max turns slider (cap: 500)
- Context window selector (8k/32k/128k)
- Memory enabled toggle
- Workspace enabled toggle
- Confirm plan toggle
- Theme selector (light/dark/system)
- **Show element tags** toggle
- Clear history button
- Export logs button

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
