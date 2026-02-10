# Phase 2 — Side Panel UI

> **Goal:** Implement the user-facing chat interface in the Chrome Side Panel. This includes the React component tree, Zustand state management, and the messaging bridge to the Background script.

---

## 1. Architecture

The Side Panel is a standard React SPA running in a blessed extension context.

-   **Entry Point:** `src/sidepanel/index.tsx` -> `App.tsx`
-   **State Management:** `zustand` (global client state) + `immer` (immutable updates).
-   **Styling:** Tailwind CSS (configured in Phase 0).
-   **Communication:**
    -   Sends `USER_CHAT` commands to Background.
    -   Listens for `AGENT_RESPONSE`, `AGENT_STATUS`, `TOOL_RESULT` from Background.

---

## 2. Component Tree

```text
App
├── Header (Logo, Settings Toggle)
├── MessageList (Scrollable)
│   ├── MessageBubble (User/Agent)
│   │   └── ToolCallSummary (Collapsible)
│   └── TypingIndicator
├── InputArea
│   ├── AutoResizingTextarea
│   └── ActionButtons (Send/Stop)
└── SettingsModal (Overlay)
```

---

## 3. Data Model (Zustand Store)

Located in `src/sidepanel/store.ts`.

```typescript
interface State {
  // Chat History
  messages: ChatEntry[];
  
  // Agent State
  agentStatus: AgentStatus;
  statusDetail: string; // e.g. "Clicking button [12]..."
  
  // UI State
  inputText: string;
  isSettingsOpen: boolean;
  
  // Actions
  addMessage: (msg: ChatEntry) => void;
  updateStatus: (status: AgentStatus, detail: string) => void;
  setInputText: (text: string) => void;
  clearHistory: () => void;
}
```

---

## 4. Implementation Steps

### Step 1: State Management (`src/sidepanel/store.ts`)
- Initialize Zustand store.
- Define actions for UI interactions.
- Mock initial data for testing UI without backend.

### Step 2: UI Components (`src/sidepanel/components/`)
- `MessageBubble.tsx`: Renders text (Markdown) and tool calls.
- `InputArea.tsx`: Textarea with auto-height and submit handler.
- `ControlBar.tsx`: Status indicator and Stop button.

### Step 3: Main Layout (`src/sidepanel/App.tsx`)
- Assemble components.
- Implement auto-scroll to bottom.

### Step 4: Messaging Bridge (`src/sidepanel/bridge.ts`)
- Listen to `chrome.runtime.onMessage`.
- Dispatch actions to Zustand store.
- Send messages to Background.

---

## 5. Mocking / Testing Strategy
Since the full background agent loops aren't ready, we will verify the UI by:
1.  **Mock Mode:** A temporary hook in `App.tsx` that simulates incoming agent messages when the user types (e.g., echoes back text after 1 second).
2.  **Unit Tests:** Jest/Bun testing for the Zustand store logic.
