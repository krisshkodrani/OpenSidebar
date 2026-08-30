# OpenSidebar — Message Passing Protocol

> How messages move between extension contexts, and a catalog of the message
> domains. The **source of truth for payload shapes** is
> `packages/shared-types/src/messages/` (one module per domain, barrel at
> `packages/shared-types/src/messages.ts`) — consult the source for exact
> fields; this doc stays at the name/purpose level so it cannot drift.

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
  payload: { refresh: true },
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

`RuntimeMessage` (`packages/shared-types/src/messages.ts`) is a union of **seven
per-domain sub-unions** — 65 concrete variants in total. Add a new message to
its domain module, not the barrel; domain-scoped consumers should type against
the sub-union (e.g. `ContentProtocolMessage`), not `RuntimeMessage`.

Payload shapes are intentionally not duplicated here — read them from the
domain module. The offscreen `TAB_AUDIO_*` protocol is deliberately excluded
from the union (see the note at the top of `messages.ts`).

### Session — `messages/session.ts` (16 variants)

Chat lifecycle and session control, UI ↔ service worker: `USER_CHAT`,
`USER_CHAT_ACCEPTED`, `SPEECH_TRANSCRIPTION_REQUEST`, `AGENT_RESPONSE`,
`AGENT_STATUS`, `STREAM_CHUNK`, `STOP_AGENT`, `PAUSE_AGENT`, `RESUME_AGENT`,
`SKIP_SUBTASK`, `SIDE_PANEL_OPENED`, `CLOSE_SIDE_PANEL`, `WORKSPACE_SYNC`,
`SCREENSHOT_CAPTURED`, `DATA_CONTROL_REQUEST`, `DATA_CONTROL_RESULT`.

Typical flow: `USER_CHAT` → streamed `STREAM_CHUNK`s → final `AGENT_RESPONSE`,
with `AGENT_STATUS` transitions throughout. UI-sourced messages carry
`source: UiMessageSource` (sidepanel or overlay `UI`).

### Progress — `messages/progress.ts` (12 variants)

Service worker → UI progress reporting: `AGENT_STEP`, `AGENT_ACTIVITY`,
`AGENT_STEP_LABEL`, `AGENT_STAGNATION`, `AGENT_TURN`, `TASK_PROGRESS`,
`TASK_RECOVERY`, `DURABLE_RUN_STATUS`, `TASK_COMPLETION`, `SESSION_METRICS`,
`NAVIGATION_RESUME`, `TASK_PAUSED`. Carries the bigger reporting types
(`SubtaskSummary`, `SessionMetrics`, `PartialProgressHandoff`, lane telemetry).

### Interaction — `messages/interaction.ts` (8 variants)

Request/response pairs that block on the user: `APPROVAL_REQUEST/RESPONSE`
(high-risk tool gating), `ESCALATION_REQUEST/DECISION` (with
`EscalationPacket`), `PLAN_CONFIRMATION_REQUEST/RESPONSE`,
`CLARIFICATION_REQUEST/RESPONSE`.

### Content protocol — `messages/content-protocol.ts` (13 variants)

Service worker ↔ content script: `DOM_SNAPSHOT_REQUEST` (payload
`{ refresh, autoDismiss? }`) / `DOM_SNAPSHOT_RESPONSE`, `TOOL_EXECUTE` /
`TOOL_RESULT`, `DISMISS_MODALS` / `DISMISS_MODALS_RESPONSE`,
`CONTENT_SCRIPT_READY`, `DOM_READY_PROBE` / `DOM_READY_ACK`,
`SCROLL_TO_POSITION` / `SCROLL_TO_POSITION_RESPONSE`, `PRESENCE_SUSPEND` /
`PRESENCE_RESUME`.

`DOM_SNAPSHOT_RESPONSE` and `DOM_READY_ACK` include the current document UUID,
mutation epoch, URL, viewport, and scroll geometry. Trusted background code may
attach that basis to `TOOL_EXECUTE` or `DISMISS_MODALS`. The content script
returns typed `stale_observation` without executing a page mutation when the
live identity/epoch no longer matches; coordinate actions additionally compare
viewport and scroll geometry.

### Skills — `messages/skills.ts` (9 variants)

Website-skill recording and CRUD: `SKILL_RECORDING_START/STOP/CANCEL/EVENT/STATUS`,
`USER_SKILL_SAVE/LIST/DELETE/USAGE_STATUS`.

### Watch mode — `messages/watch-mode.ts` (5 variants)

Passive monitoring: `PASSIVE_MONITOR_START/STOP/STATUS/PAGE_ACTIVITY/SUGGESTION`.

### E2E hooks — `messages/e2e.ts` (2 variants)

Test-only seams: `E2E_SEED_PENDING_INTERACTION`, `E2E_RAIL_UPDATE`.

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
