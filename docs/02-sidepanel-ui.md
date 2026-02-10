# Phase 2 — Side Panel UI

> **Goal:** Build the React side panel with a chat interface, status indicators, input handling, settings panel, and workspace selector.

---

## Background

The side panel is QSidebar's user-facing interface. It opens when the user clicks the extension icon and stays open while the user interacts with web pages. It communicates exclusively with the service worker via `chrome.runtime` messages.

The UI is intentionally minimal: a chat window, a text input, status indicators, and a settings drawer. No routing library — a single `App.tsx` component manages views via state.

---

## Design

### Component Tree

```
App
├── Header
│   ├── Logo
│   ├── WorkspaceSelector
│   └── SettingsButton
├── ChatWindow
│   ├── ChatMessage (user)
│   ├── ChatMessage (assistant)
│   │   └── ToolCallBadge[]
│   └── StreamingIndicator
├── StatusBar
│   └── StatusIndicator
├── InputArea
│   ├── TextInput
│   └── StopButton / SendButton
└── SettingsDrawer (conditional)
    ├── ApiKeyInput (Cerebras)
    ├── ApiKeyInput (OpenRouter)
    ├── MaxTurnsSlider
    ├── ContextWindowSlider
    ├── MemoryToggle
    ├── WorkspaceToggle
    └── ThemeSelector
```

---

## Implementation Details

### File: `src/sidepanel/App.tsx`

```typescript
import { useState, useEffect, useRef, useCallback } from "react";
import type {
  ChatEntry,
  SidePanelState,
  AgentStatus,
  RuntimeMessage,
  UserSettings,
  UserSettings,
  Workspace,
} from "../types";
import { create } from "zustand";

interface SidePanelStore extends SidePanelState {
    setMessages: (messages: ChatEntry[]) => void;
    setAgentStatus: (status: AgentStatus, detail?: string) => void;
    setInputText: (text: string) => void;
    setIsAgentRunning: (isRunning: boolean) => void;
    setWorkspaces: (workspaces: Workspace[]) => void;
    setActiveWorkspace: (workspace: Workspace | null) => void;
    updateSettings: (settings: Partial<UserSettings>) => void;
    setError: (error: string | null) => void;
}

const useStore = create<SidePanelStore>((set) => ({
  messages: [],
  agentStatus: "IDLE",
  statusDetail: "",
  inputText: "",
  isAgentRunning: false,
  activeWorkspace: null,
  workspaces: [],
  settings: {
    cerebrasApiKey: "",
    openRouterApiKey: "",
    maxTurns: 25,
    contextWindowSize: 16000,
    memoryEnabled: true,
    workspaceEnabled: true,
    theme: "system",
  },
  error: null,
  
  setMessages: (messages) => set({ messages }),
  setAgentStatus: (status, detail) => set({ agentStatus: status, ...(detail ? { statusDetail: detail } : {}) }),
  setInputText: (text) => set({ inputText: text }),
  setIsAgentRunning: (isAgentRunning) => set({ isAgentRunning }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspace: (activeWorkspace) => set({ activeWorkspace }),
  updateSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
  setError: (error) => set({ error }),
}));


export default function App() {
  const { 
      messages, agentStatus, settings, updateSettings, // ... select other state needed
      setAgentStatus, setMessages, setWorkspaces, setActiveWorkspace 
  } = useStore();
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Load settings from chrome.storage.sync on mount
  useEffect(() => {
    chrome.storage.sync.get("qsidebar:settings").then((result) => {
      if (result["qsidebar:settings"]) {
        setState((s) => ({ ...s, settings: result["qsidebar:settings"] }));
      }
    });
  }, []);

  // Listen for messages from the service worker
  useEffect(() => {
    const listener = (message: RuntimeMessage) => {
      switch (message.type) {
        case "AGENT_STATUS":
          setState((s) => ({
            ...s,
            agentStatus: message.payload.status,
            statusDetail: message.payload.detail,
            isAgentRunning: message.payload.status !== "IDLE" && message.payload.status !== "ERROR",
          }));
          break;
        case "STREAM_CHUNK":
          handleStreamChunk(message.payload);
          break;
        case "AGENT_RESPONSE":
          handleAgentResponse(message.payload);
          break;
        case "WORKSPACE_UPDATE":
          setState((s) => ({
            ...s,
            workspaces: message.payload.workspaces,
            activeWorkspace: message.payload.workspaces.find(
              (w: Workspace) => w.id === message.payload.activeWorkspaceId
            ) ?? null,
          }));
          break;
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  // ... handlers defined below
}
```

### Sending a Message

```typescript
const sendMessage = useCallback(async () => {
  const text = state.inputText.trim();
  if (!text || state.isAgentRunning) return;

  // Add user message to chat
  const userEntry: ChatEntry = {
    id: crypto.randomUUID(),
    role: "user",
    content: text,
    timestamp: Date.now(),
    toolCalls: [],
    isStreaming: false,
  };

  // Add placeholder assistant message for streaming
  const assistantEntry: ChatEntry = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    toolCalls: [],
    isStreaming: true,
  };

  setState((s) => ({
    ...s,
    messages: [...s.messages, userEntry, assistantEntry],
    inputText: "",
    isAgentRunning: true,
  }));

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Send to service worker
  chrome.runtime.sendMessage({
    type: "USER_CHAT",
    requestId: crypto.randomUUID(),
    source: "sidepanel",
    payload: {
      text,
      tabId: tab?.id ?? -1,
      workspaceId: state.activeWorkspace?.id ?? null,
    },
  });
}, [state.inputText, state.isAgentRunning, state.activeWorkspace]);
```

### Handling Stream Chunks

```typescript
const handleStreamChunk = useCallback((payload: { delta: string; done: boolean }) => {
  setState((s) => {
    const messages = [...s.messages];
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && last.isStreaming) {
      messages[messages.length - 1] = {
        ...last,
        content: last.content + payload.delta,
        isStreaming: !payload.done,
      };
    }
    return { ...s, messages };
  });
}, []);
```

### Handling Final Agent Response

```typescript
const handleAgentResponse = useCallback((payload: {
  text: string;
  isStreaming: boolean;
  toolCalls: ToolCallSummary[];
}) => {
  setState((s) => {
    const messages = [...s.messages];
    const last = messages[messages.length - 1];
    if (last?.role === "assistant") {
      messages[messages.length - 1] = {
        ...last,
        content: payload.text || last.content,
        toolCalls: payload.toolCalls,
        isStreaming: payload.isStreaming,
      };
    }
    return { ...s, messages, isAgentRunning: payload.isStreaming };
  });
}, []);
```

### Stop Button

```typescript
const stopAgent = useCallback(() => {
  chrome.runtime.sendMessage({
    type: "STOP_AGENT",
    requestId: crypto.randomUUID(),
    source: "sidepanel",
    payload: {},
  });
}, []);
```

---

### Component: `ChatMessage`

```typescript
interface ChatMessageProps {
  entry: ChatEntry;
}

function ChatMessage({ entry }: ChatMessageProps) {
  const isUser = entry.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "bg-primary-600 text-white"
            : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        }`}
      >
        {/* Message content with basic markdown-like rendering */}
        <div className="whitespace-pre-wrap break-words">{entry.content}</div>

        {/* Tool call badges */}
        {entry.toolCalls.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {entry.toolCalls.map((tc, i) => (
              <ToolCallBadge key={i} toolCall={tc} />
            ))}
          </div>
        )}

        {/* Streaming cursor */}
        {entry.isStreaming && (
          <span className="inline-block w-2 h-4 bg-primary-500 animate-pulse ml-0.5" />
        )}
      </div>
    </div>
  );
}
```

### Component: `ToolCallBadge`

```typescript
function ToolCallBadge({ toolCall }: { toolCall: ToolCallSummary }) {
  const [expanded, setExpanded] = useState(false);

  const colorMap: Record<string, string> = {
    low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className={`text-xs px-2 py-0.5 rounded-full ${colorMap[toolCall.riskLevel]}`}
    >
      {toolCall.toolName} ({toolCall.durationMs}ms)
      {expanded && (
        <div className="mt-1 text-left font-mono text-[10px]">
          {JSON.stringify(toolCall.args, null, 2)}
          <br />→ {toolCall.result.slice(0, 200)}
        </div>
      )}
    </button>
  );
}
```

### Component: `StatusBar`

```typescript
function StatusBar({ status, detail }: { status: AgentStatus; detail: string }) {
  const statusConfig: Record<AgentStatus, { color: string; label: string }> = {
    IDLE: { color: "bg-gray-400", label: "Ready" },
    THINKING: { color: "bg-blue-500 animate-pulse", label: "Thinking" },
    ACTING: { color: "bg-yellow-500 animate-pulse", label: "Acting" },
    WAITING_FOR_PAGE_LOAD: { color: "bg-orange-500 animate-pulse", label: "Navigating" },
    WAITING_FOR_SWARM: { color: "bg-purple-500 animate-pulse", label: "Deep Thinking" },
    ERROR: { color: "bg-red-500", label: "Error" },
  };

  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-t dark:border-gray-700 text-xs text-gray-500">
      <div className={`w-2 h-2 rounded-full ${config.color}`} />
      <span>{config.label}</span>
      {detail && <span className="truncate">— {detail}</span>}
    </div>
  );
}
```

### Component: `InputArea`

```typescript
function InputArea({
  value,
  onChange,
  onSend,
  onStop,
  isRunning,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  isRunning: boolean;
}) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="flex items-end gap-2 p-3 border-t dark:border-gray-700">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isRunning ? "Agent is working..." : "Ask me anything..."}
        disabled={isRunning}
        rows={1}
        className="flex-1 resize-none rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
      />
      {isRunning ? (
        <button
          onClick={onStop}
          className="px-3 py-2 rounded-lg bg-red-500 text-white text-sm hover:bg-red-600"
        >
          Stop
        </button>
      ) : (
        <button
          onClick={onSend}
          disabled={!value.trim()}
          className="px-3 py-2 rounded-lg bg-primary-600 text-white text-sm hover:bg-primary-700 disabled:opacity-50"
        >
          Send
        </button>
      )}
    </div>
  );
}
```

### Component: `WorkspaceSelector`

```typescript
function WorkspaceSelector({
  workspaces,
  active,
  onSelect,
}: {
  workspaces: Workspace[];
  active: Workspace | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <select
      value={active?.id ?? ""}
      onChange={(e) => onSelect(e.target.value || null)}
      className="text-xs border rounded px-2 py-1 dark:bg-gray-800 dark:border-gray-600"
    >
      <option value="">All tabs</option>
      {workspaces.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </select>
  );
}
```

### Component: `SettingsDrawer`

```typescript
function SettingsDrawer({
  settings,
  onUpdate,
  onClose,
}: {
  settings: UserSettings;
  onUpdate: (patch: Partial<UserSettings>) => void;
  onClose: () => void;
}) {
  const save = (patch: Partial<UserSettings>) => {
    onUpdate(patch);
    chrome.runtime.sendMessage({
      type: "SETTINGS_UPDATE",
      requestId: crypto.randomUUID(),
      source: "sidepanel",
      payload: { settings: patch },
    });
  };

  return (
    <div className="absolute inset-0 bg-white dark:bg-gray-900 z-50 overflow-y-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">Settings</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">&times;</button>
      </div>

      <div className="space-y-4">
        <label className="block">
          <span className="text-sm text-gray-600 dark:text-gray-300">Cerebras API Key</span>
          <input
            type="password"
            value={settings.cerebrasApiKey}
            onChange={(e) => save({ cerebrasApiKey: e.target.value })}
            className="mt-1 block w-full rounded border px-3 py-2 text-sm dark:bg-gray-800"
            placeholder="sk-..."
          />
        </label>

        <label className="block">
          <span className="text-sm text-gray-600 dark:text-gray-300">OpenRouter API Key</span>
          <input
            type="password"
            value={settings.openRouterApiKey}
            onChange={(e) => save({ openRouterApiKey: e.target.value })}
            className="mt-1 block w-full rounded border px-3 py-2 text-sm dark:bg-gray-800"
            placeholder="sk-or-..."
          />
        </label>

        <label className="block">
          <span className="text-sm text-gray-600 dark:text-gray-300">
            Max turns: {settings.maxTurns}
          </span>
          <input
            type="range"
            min={5}
            max={50}
            value={settings.maxTurns}
            onChange={(e) => save({ maxTurns: Number(e.target.value) })}
            className="mt-1 block w-full"
          />
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.memoryEnabled}
            onChange={(e) => save({ memoryEnabled: e.target.checked })}
          />
          <span className="text-sm">Enable Memory (Second Brain)</span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.workspaceEnabled}
            onChange={(e) => save({ workspaceEnabled: e.target.checked })}
          />
          <span className="text-sm">Enable Workspace Isolation</span>
        </label>

        <label className="block">
          <span className="text-sm text-gray-600 dark:text-gray-300">Theme</span>
          <select
            value={settings.theme}
            onChange={(e) => save({ theme: e.target.value as "light" | "dark" | "system" })}
            className="mt-1 block w-full rounded border px-3 py-2 text-sm dark:bg-gray-800"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </div>
    </div>
  );
}
```

---

## Tailwind Theme

Defined in `tailwind.config.cjs` (Phase 0). Key design tokens:

- **Primary:** Blue scale (`primary-50` through `primary-900`)
- **Surface:** White (light) / `#1e1e2e` (dark)
- **Font:** Inter (sans), JetBrains Mono (monospace)
- **Dark mode:** Class-based (`darkMode: "class"`)

The theme class is applied via JavaScript based on `UserSettings.theme`:

```typescript
useEffect(() => {
  const root = document.documentElement;
  if (settings.theme === "dark" || (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}, [settings.theme]);
```

---

## File Paths

| File | Purpose |
|---|---|
| `src/sidepanel/App.tsx` | Main component with all sub-components |
| `src/sidepanel/index.tsx` | React root mount |
| `src/sidepanel/index.html` | HTML entry for CRXJS |
| `src/sidepanel/index.css` | Tailwind directives |

All components are defined in `App.tsx` as co-located functions. No separate component files — the total is ~500 lines, well within single-file maintainability.

---

## Edge Cases

- **Side panel resize:** All components use `flex` layout with `min-w-0` to prevent overflow. Textarea auto-grows with content.
- **Long messages:** `break-words` and `whitespace-pre-wrap` prevent horizontal overflow.
- **API key display:** Keys are shown as `type="password"` inputs. Never logged or sent in messages to the LLM.
- **Message ordering:** Stream chunks are always appended to the LAST assistant message. If messages arrive out of order (unlikely but possible), the `requestId` can be used to match them.

---

## Testing

- `tests/sidepanel/app.test.tsx` — component rendering, message flow simulation
- Manual testing via `npm run dev` with the extension loaded in Chrome

---

## Open Questions

None — all decisions are final.
