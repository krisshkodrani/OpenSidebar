# OpenSidebar — Message Passing Protocol

> **Complete specification** of every message exchanged between extension contexts.
> All message types are defined in [`types-reference.md`](./types-reference.md).

---

## Table of Contents

1. [Overview](#overview)
2. [Transport Mechanisms](#transport-mechanisms)
3. [Request ID Correlation](#request-id-correlation)
4. [Message Catalog](#message-catalog)
5. [Sequence Diagrams](#sequence-diagrams)
6. [Error Handling](#error-handling)

---

## Overview

OpenSidebar has three production extension contexts that communicate through Chrome messaging, plus an overlay harness that exercises the same UI contract through browser events.

| Context                         | Process              | Lifecycle                              | File                           |
| ------------------------------- | -------------------- | -------------------------------------- | ------------------------------ |
| **Service Worker** (background) | Extension process    | Ephemeral (terminates after ~30s idle) | `apps/extension/src/background/background.ts` |
| **Side Panel** (UI)             | Extension process    | Lives while panel is open              | `apps/extension/src/sidepanel/App.tsx`, `apps/extension/src/sidepanel/runtime.ts` |
| **Content Script**              | Tab renderer process | Lives while page is loaded             | `apps/extension/src/content/content.ts` |
| **Overlay Harness**             | Page renderer process | Lives while injected into a test page | `apps/extension/src/overlay/` |

### Communication Paths

```
Side Panel UI <-> UiRuntimePort <-> Service Worker <-> ContentBridgePort/chrome.tabs.sendMessage <-> Content Script
```

**Rules:**

- Shared side panel UI code must use `UiRuntimePort`; the Chrome-backed adapter is the only side panel module that wraps `chrome.runtime`, `chrome.tabs`, `chrome.windows`, `chrome.permissions`, and `chrome.storage`.
- The overlay harness uses the same message payloads with `MessageSource.UI` instead of `MessageSource.SIDEPANEL`.
- Content scripts **cannot** talk directly to the side panel — all messages route through the service worker.

---

## Transport Mechanisms

### 1. `UiRuntimePort.sendMessage` (one-shot, with response)

Used for: Side Panel UI to Service Worker.

Production side panel calls are backed by `chrome.runtime.sendMessage`. Overlay harness calls are backed by browser events and an optional fake background controller.

```typescript
// Sender
const response = await uiRuntime.sendMessage({
  type: "USER_CHAT",
  requestId: crypto.randomUUID(),
  source: uiRuntime.source,
  payload: { text: "Search for flights to NYC", tabId: 123, workspaceId: null },
});

// Receiver (background.ts)
chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    if (message.type === "USER_CHAT") {
      handleUserChat(message).then(sendResponse);
      return true; // async response
    }
  },
);
```

### 2. `ContentBridgePort.sendMessage` / `chrome.tabs.sendMessage` (background to content script)

Used for: Service Worker to Content Script (tab-targeted).

Reusable background code should prefer `ContentBridgePort` where available. Production wiring still uses the Chrome-backed implementation.

```typescript
// Background sends to a specific tab
const response = await contentBridgePort.sendMessage(tabId, {
  type: "DOM_SNAPSHOT_REQUEST",
  requestId: crypto.randomUUID(),
  source: "background",
  payload: { includeText: true, refresh: true },
});
```

### 3. `chrome.runtime.onMessage` with `sender.tab` check (content script → background)

Content scripts use `chrome.runtime.sendMessage`, and the background listener disambiguates via `sender.tab`.

### 4. Overlay browser events (overlay harness to fake or test background)

Used for: browser-driven overlay smoke tests.

- Outbound UI messages dispatch `opensidebar:overlay:send-message`.
- Inbound background-style messages dispatch `opensidebar:overlay:receive-message`.
- `apps/extension/src/overlay/driver.ts` exposes helpers for emitting inbound messages and subscribing to outbound UI messages.

---

## Request ID Correlation

Every message carries a `requestId: string` (UUID v4). This enables:

1. **Async response matching** — When the side panel sends `USER_CHAT` with `requestId: "abc"`, the background responds with `AGENT_RESPONSE` containing `requestId: "abc"`.
2. **Tool call tracking** — `TOOL_EXECUTE` and `TOOL_RESULT` share the same `requestId`.
3. **Timeout detection** — If no response arrives within 10s, the sender logs an error and surfaces it to the user.

---

## Message Catalog

### UI → Service Worker

| Message Type      | Purpose                     | Payload                                 | Expected Response                                                                             |
| ----------------- | --------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `USER_CHAT`       | User sends a chat message   | `{ text, tabId, workspaceId, isFeedback? }` | `AGENT_RESPONSE` (streamed via multiple `STREAM_CHUNK` messages, then final `AGENT_RESPONSE`) |
| `STOP_AGENT`      | User clicks stop button     | `{ workspaceId? }`                      | `AGENT_STATUS` with `status: IDLE`                                                            |
| `PAUSE_AGENT`     | User pauses agent execution | `{ workspaceId? }`                      | `AGENT_STATUS` with `status: PAUSED`                                                          |
| `RESUME_AGENT`    | User resumes paused agent   | `{ workspaceId? }`                      | `AGENT_STATUS` with `status: THINKING`                                                        |
| `SKIP_SUBTASK`    | User skips current subtask  | `{ taskId }`                            | —                                                                                             |

### Service Worker → UI

| Message Type        | Purpose                              | Payload                                                                                          |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ | ------- | ---------- | --------------------------------------- |
| `AGENT_STATUS`      | Agent state machine changed          | `{ status: AgentStatus, detail: string }`                                                        |
| `STREAM_CHUNK`      | Incremental LLM output               | `{ delta: string, done: boolean }`                                                               |
| `AGENT_RESPONSE`    | Final agent response for a turn      | `{ text, isStreaming, toolCalls }`                                                               |
| `NAVIGATION_RESUME` | Page load completed after navigation | `{ success, url, error? }`                                                                       |
| `AGENT_STEP`        | Step timeline update                 | `{ step: AgentStep, update: boolean }`                                                           |
| `AGENT_STAGNATION`       | Agent stagnation detection signal    | `{ signal: "escalate" \| "resolved", stagnantTurns, url, message }` |
| `AGENT_TURN`        | Turn progress update                 | `{ turn, maxTurns, provider? }`                                                                  |
| `TASK_PROGRESS`     | Subtask progress update              | `{ taskId, subtasks, currentIndex, totalTurnsUsed }`                                             |
| `TASK_COMPLETION`   | Task completion report               | `{ taskId, status, totalTurnsUsed, totalTimeMs, summary, subtaskResults, urlHistory, metrics? }` |
| `SESSION_METRICS`   | Real-time token/cost tracking        | `{ totalPromptTokens, totalCompletionTokens, totalTokens, totalCost, ... }`                      |

### Service Worker → Content Script

| Message Type           | Purpose                     | Payload                               | Expected Response         |
| ---------------------- | --------------------------- | ------------------------------------- | ------------------------- |
| `DOM_SNAPSHOT_REQUEST` | Request DOM distillation    | `{ includeText, refresh, showTags? }` | `DOM_SNAPSHOT_RESPONSE`   |
| `TOOL_EXECUTE`         | Execute a DOM action        | `{ toolName, args, toolCallId }`      | `TOOL_RESULT`             |
| `DISMISS_MODALS`       | Auto-dismiss modal overlays | `{}`                                  | `DISMISS_MODALS_RESPONSE` |

### Content Script → Service Worker

| Message Type              | Purpose                       | Payload                                                     |
| ------------------------- | ----------------------------- | ----------------------------------------------------------- |
| `DOM_SNAPSHOT_RESPONSE`   | Return DOM snapshot           | `{ snapshot: DomSnapshot, durationMs }`                     |
| `TOOL_RESULT`             | Return tool execution result  | `{ toolCallId, success, result, navigated }`                |
| `DISMISS_MODALS_RESPONSE` | Report dismissed modals count | `{ dismissed: number, remainingOverlay?, capturedTexts[] }` |

---

## Sequence Diagrams

### 1. User Chat → Agent Loop → Tool Execution

```
Side Panel          Service Worker          Content Script
    │                     │                       │
    │── USER_CHAT ──────→ │                       │
    │                     │ (start agent loop)    │
    │← AGENT_STATUS ────  │ (status: THINKING)    │
    │                     │                       │
    │← STREAM_CHUNK ──── │ (LLM streaming...)    │
    │← STREAM_CHUNK ──── │                       │
    │← STREAM_CHUNK ──── │ (done: true)          │
    │                     │                       │
    │                     │ (LLM returned tool_calls)
    │← AGENT_STATUS ────  │ (status: ACTING)      │
    │                     │                       │
    │                     │── TOOL_EXECUTE ──────→ │
    │                     │                       │ (execute click)
    │                     │←── TOOL_RESULT ──────  │
    │                     │                       │
    │                     │ (feed result to LLM)  │
    │← AGENT_STATUS ────  │ (status: THINKING)    │
    │← STREAM_CHUNK ──── │ ...                   │
    │← AGENT_RESPONSE ── │ (final response)      │
    │← AGENT_STATUS ────  │ (status: IDLE)        │
    │                     │                       │
```

### 2. Navigation Bridge

```
Service Worker          Content Script (old)    Content Script (new)
    │                       │                       │
    │── TOOL_EXECUTE ──────→ │                       │
    │   (navigate url)      │                       │
    │←── TOOL_RESULT ──────  │ (navigated: true)   │
    │                     │                       │
    │← AGENT_STATUS ────  │ (WAITING_FOR_PAGE_LOAD)
    │                     │                       │
    │                     │ (save state to         │
    │                     │  chrome.storage.local) │
    │                     │                       │
    │                     │ (destroyed)           │
    │                     │                       │
    │←── webNavigation.onCompleted ────────────────  │
    │                     │                       │
    │                     │ (restore state from storage)
    │                     │── DOM_SNAPSHOT_REQUEST ─→│
    │                     │←── DOM_SNAPSHOT_RESPONSE  │
    │                     │                       │
    │← NAVIGATION_RESUME  │                       │
    │← AGENT_STATUS ────  │ (status: THINKING)    │
    │                     │ (resume agent loop)    │
    │                     │                       │
```

### 3. Pause / Resume

```
Side Panel          Service Worker
    │                     │
    │── PAUSE_AGENT ────→ │
    │                     │ (set pauseGate promise)
    │← AGENT_STATUS ────  │ (status: PAUSED)
    │                     │ ... (loop awaits gate) ...
    │── RESUME_AGENT ───→ │
    │                     │ (resolve pauseGate)
    │← AGENT_STATUS ────  │ (status: THINKING)
    │                     │ (loop continues)
    │                     │
```

### 4. Stagnation Detection

```
Side Panel          Service Worker          Content Script
    │                     │                       │
    │                     │ (StagnationMonitor detects stagnant snapshot)
    │← AGENT_STAGNATION ─────  │ (signal: "escalate", stagnantTurns: 6)
    │                     │                       │
    │                     │ (injects reflection into LLM context)
    │                     │── TOOL_EXECUTE ──────→ │
    │                     │←── TOOL_RESULT ──────  │
    │                     │                       │
    │                     │ (snapshot changed → progress detected)
    │← AGENT_STAGNATION ─────  │ (signal: "resolved")
    │                     │                       │
```

### 5. Turn Progress + Metrics

```
Side Panel          Service Worker
    │                     │
    │                     │ (top of each loop iteration)
    │← AGENT_TURN ──────  │ (turn: 14, maxTurns: 100)
    │                     │
    │                     │ ... (LLM + tool execution) ...
    │                     │
    │← SESSION_METRICS ── │ (totalTokens: 4500, cost: $0.02)
    │                     │
    │← AGENT_TURN ──────  │ (turn: 15, maxTurns: 100)
    │                     │
```

---

## Error Handling

### Message-Level Errors

Every response can optionally include an `error` field. Receivers check this first:

```typescript
// Pattern used throughout the codebase
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true; // async
});
```

### Disconnected Contexts

| Scenario                              | Detection                                   | Recovery                                                                                  |
| ------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Content script destroyed (navigation) | `chrome.runtime.lastError` on `sendMessage` | Navigation Bridge restores state after new page loads                                     |
| Service worker terminated (idle)      | Side panel detects missed `AGENT_STATUS`    | Side panel re-sends last `USER_CHAT`; service worker restores from `chrome.storage.local` |
| Side panel closed by user             | N/A (service worker continues if mid-loop)  | Agent loop completes silently; results available when panel reopens                       |

### Timeout Constants

| Operation                 | Timeout   | Action on Timeout                            |
| ------------------------- | --------- | -------------------------------------------- |
| DOM snapshot request      | 5,000 ms  | Return error to agent: "Page not responding" |
| Tool execution            | 10,000 ms | Return error to agent: "Action timed out"    |
| LLM provider API call     | 30,000 ms | Set `AgentStatus.ERROR`, notify side panel   |
| Navigation bridge wait    | 30,000 ms | Abort navigation, set `AgentStatus.ERROR`    |

---

## Message Versioning

Messages do not carry an explicit version number. Breaking changes to message payloads require updating all sender and receiver code in the same commit. Since all contexts are bundled together in the extension, there is no cross-version compatibility concern.
