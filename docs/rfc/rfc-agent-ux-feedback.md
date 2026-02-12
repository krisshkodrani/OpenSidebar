# RFC: Agent UX Feedback — Progress Visibility, Stuck Surfaces, and User Control

**Status:** Implemented (core features)
**Author:** OpenSidebar team
**Date:** 2026-02-12
**Depends on:** [RFC: Progress Tracker](./rfc-progress-tracker.md) (Phase 1 implemented, Phase 2 proposed), [RFC: Task Decomposition](./rfc-task-decomposition.md) (proposed)

## Problem

The agent loop is a black box from the user's perspective. Once a task starts:

1. **No subtask progress** — users can't see which step the agent is on or how much turn budget remains
2. **No completion report** — tasks end with a bare text response; there's no structured summary of what happened
3. **Stuck loops are invisible** — the ProgressTracker nudges the LLM, but the user has no idea the agent is stuck
4. **No user intervention** — users can't send hints, skip steps, or pause/resume mid-execution
5. **No turn visibility** — no indication of how many turns have been used out of the budget

This RFC specifies the user-facing feedback surfaces, new message types, and side panel components that address these gaps.

## Priorities

| Priority | Feature | Depends on |
|----------|---------|------------|
| P1 | Subtask progress + completion summary | RFC Task Decomposition |
| P2 | Stuck detection visibility | RFC Progress Tracker Phase 2a |
| P3 | User control (hints + pause/resume) | — |
| P4 | Turn counter, speed mode UX, notifications | — |

---

## P1: Subtask Progress + Completion Summary

### Message Types

Both types are defined in [RFC: Task Decomposition](./rfc-task-decomposition.md) Phase 4. Reproduced here for context:

```ts
// Already defined in rfc-task-decomposition.md
interface TaskProgressMessage extends BaseMessage {
  type: "TASK_PROGRESS";
  source: MessageSource.BACKGROUND;
  payload: {
    taskId: string;
    subtasks: SubtaskSummary[];
    currentIndex: number;
    totalTurnsUsed: number;
  };
}

interface SubtaskSummary {
  description: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  turnsUsed: number;
  turnBudget: number;
  result?: string;
}

interface TaskCompletionMessage extends BaseMessage {
  type: "TASK_COMPLETION";
  source: MessageSource.BACKGROUND;
  payload: {
    taskId: string;
    status: "completed" | "partial" | "failed";
    totalTurns: number;
    totalTimeMs: number;
    summary: string;
    subtaskResults: SubtaskResult[];
    urlHistory: string[];
  };
}

interface SubtaskResult {
  description: string;
  status: "completed" | "failed" | "skipped";
  turnsUsed: number;
  result: string;
}
```

### Zustand Store Extensions

```ts
// New fields in SidePanelState
interface SidePanelState {
  // ... existing fields ...

  /** Active task decomposition progress (null when no decomposed task) */
  taskProgress: TaskProgressPayload | null;
  /** Completed task report (null until task finishes) */
  taskCompletion: TaskCompletionPayload | null;
}

type TaskProgressPayload = TaskProgressMessage["payload"];
type TaskCompletionPayload = TaskCompletionMessage["payload"];
```

### `TaskProgressPanel` Component

**File:** `src/sidepanel/components/TaskProgressPanel.tsx` (NEW)

Persistent widget anchored above `InputArea`. Visible only when `taskProgress !== null`.

```
┌─────────────────────────────────────────┐
│ Task: Complete all registration steps    │
│ ════════════════════════════════════════ │
│ ✓ Fill in name and email       (8 / 20) │
│ ▶ Submit form and wait         (3 / 20) │
│ ○ Verify confirmation page     (0 / 20) │
│ ○ Click logout link            (0 / 20) │
│ ──────────────────────────────────────── │
│ Total: 11 / 80 turns                    │
│                              [Skip ▸]   │
└─────────────────────────────────────────┘
```

**Status icons:**
- `✓` (`text-green-500`) — completed
- `✗` (`text-red-500`) — failed
- `—` (`text-gray-400`) — skipped
- `▶` (`text-blue-500`, animated pulse) — running
- `○` (`text-gray-300`) — pending

**Behavior:**
- Each subtask row shows `description` (truncated to 40 chars) and `turnsUsed / turnBudget`
- Turn counter turns orange at 80% budget, red at 100%
- "Skip" button visible only when a subtask is `running` — sends `SKIP_SUBTASK` message
- Collapsible: clicking the header toggles between full checklist and a single-line summary (`"Step 2 of 4 — Submit form (3/20 turns)"`)
- Auto-expands when a subtask transitions to `running`
- Hidden (unmounted) when `taskProgress` is null

### `CompletionSummary` Component

**File:** `src/sidepanel/components/CompletionSummary.tsx` (NEW)

Rendered as a `ChatEntry` block (role `"assistant"`) when the task finishes. Replaces the plain-text done message with a structured report.

```
┌─────────────────────────────────────────┐
│ ✓ Task Completed — 4 of 4 steps done    │  ← green header
│ ════════════════════════════════════════ │
│ ✓ Fill in name and email                │
│ ✓ Submit form and wait                  │
│ ✓ Verify confirmation page              │
│ ✓ Click logout link                     │
│ ──────────────────────────────────────── │
│ 47 turns · 2m 14s · 3 pages visited     │
│                                          │
│ Pages: example.com/register →            │
│        example.com/confirm →             │
│        example.com/dashboard             │
└─────────────────────────────────────────┘
```

**Header color:**
- Green (`bg-green-50 border-green-200`) — `status: "completed"`
- Yellow (`bg-yellow-50 border-yellow-200`) — `status: "partial"`
- Red (`bg-red-50 border-red-200`) — `status: "failed"`

**Data source:** `taskCompletion` from the store. The component renders `subtaskResults[]` as a checklist, `totalTurns` and `totalTimeMs` as a summary line, and `urlHistory[]` as a breadcrumb trail.

### Affected Files

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `TaskProgressMessage`, `TaskCompletionMessage`, `SubtaskSummary`, `SubtaskResult` to `RuntimeMessage` union |
| `src/sidepanel/store.ts` | Add `taskProgress`, `taskCompletion` state + actions |
| `src/sidepanel/bridge.ts` | Handle `TASK_PROGRESS` and `TASK_COMPLETION` messages |
| `src/sidepanel/App.tsx` | Render `TaskProgressPanel` above input, inject `CompletionSummary` into chat |
| `src/sidepanel/components/TaskProgressPanel.tsx` | NEW |
| `src/sidepanel/components/CompletionSummary.tsx` | NEW |
| `src/sidepanel/components/index.ts` | Barrel export new components |

---

## P2: Stuck Detection Visibility

### Message Type

Defined in [RFC: Progress Tracker](./rfc-progress-tracker.md) Phase 2a:

```ts
interface AgentStuckMessage extends BaseMessage {
  type: "AGENT_STUCK";
  source: MessageSource.BACKGROUND;
  payload: {
    signal: "nudge" | "escalate" | "resolved";
    staleTurns: number;
    url: string;
    message: string;
  };
}
```

### Zustand Store Extension

```ts
interface SidePanelState {
  // ... existing fields ...

  /** Non-null when the agent is detected as stuck */
  stuckState: StuckState | null;
}

interface StuckState {
  signal: "nudge" | "escalate";
  staleTurns: number;
  url: string;
  /** Timestamp of the stuck signal (for auto-dismiss timing) */
  receivedAt: number;
}
```

- On `AGENT_STUCK` with `signal: "nudge" | "escalate"` → set `stuckState`
- On `AGENT_STUCK` with `signal: "resolved"` → clear `stuckState` to null
- On `AGENT_STATUS` with `status: IDLE` → clear `stuckState` (agent stopped)

### `StuckBanner` Component

**File:** `src/sidepanel/components/StuckBanner.tsx` (NEW)

Fixed-position banner rendered below the `Header` and above the chat stream. Visible only when `stuckState !== null`.

```
┌─────────────────────────────────────────┐
│ ⚠ Agent appears stuck (6 turns)         │
│                                          │
│ [Send a Hint]  [Skip Step]  [Stop]      │
└─────────────────────────────────────────┘
```

**Styling:**
- Nudge: `bg-yellow-50 border-yellow-300 text-yellow-800`
- Escalate: `bg-orange-50 border-orange-300 text-orange-800`

**Buttons:**
| Button | Action |
|--------|--------|
| Send a Hint | Focuses `InputArea`, sets a `isHint: true` flag so the next `USER_CHAT` is treated as a hint injection (see P3) |
| Skip Step | Sends `SKIP_SUBTASK` (only visible when task decomposition is active) |
| Stop | Sends `STOP_AGENT` |

**Auto-dismiss:**
- When `AGENT_STUCK` with `signal: "resolved"` arrives
- When agent status transitions to `IDLE`
- 60s timeout if no further stuck signals arrive (stale banner cleanup)

### Affected Files

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `AgentStuckMessage` to `RuntimeMessage` union |
| `src/background/agent/loop.ts` | Emit `AGENT_STUCK` when ProgressTracker fires + resolved |
| `src/sidepanel/store.ts` | Add `stuckState` + actions |
| `src/sidepanel/bridge.ts` | Handle `AGENT_STUCK` messages |
| `src/sidepanel/App.tsx` | Render `StuckBanner` conditionally |
| `src/sidepanel/components/StuckBanner.tsx` | NEW |
| `src/sidepanel/components/index.ts` | Barrel export |

---

## P3: User Control — Hints + Pause/Resume

### Hint Injection

Allow users to send messages while the agent is running. Today, `InputArea` is disabled when `isAgentRunning` is true. Change: keep it enabled, but messages sent during execution are treated as **hints**.

#### Message Change

```ts
interface UserChatMessage extends BaseMessage {
  type: "USER_CHAT";
  source: MessageSource.SIDEPANEL;
  payload: {
    text: string;
    tabId: number;
    workspaceId: string | null;
    /** When true, inject as hint into running agent context (don't start new loop) */
    isHint?: boolean;
  };
}
```

#### `AgentLoop.injectHint(text: string)`

New method on `AgentLoop`:

```ts
class AgentLoop {
  /** Queue a user hint to be picked up on the next turn */
  injectHint(text: string): void {
    this.pendingHint = text;
  }
}
```

At the start of each loop iteration (before the LLM call), check `this.pendingHint`:
- If non-null, append a `UserMessage` to the conversation: `"[User hint]: {text}"`
- Clear `this.pendingHint`
- The hint appears in context as a user message, so the LLM sees it on the next turn

#### `background.ts` Handler

```ts
case "USER_CHAT":
  if (msg.payload.isHint && currentLoop) {
    currentLoop.injectHint(msg.payload.text);
    // Don't create a new AgentLoop
  } else {
    // Existing behavior: create/restart loop
  }
```

#### Side Panel Changes

- `InputArea`: Always enabled. When `isAgentRunning`, the send button label changes to "Send Hint" and the placeholder changes to "Send a hint to the agent..."
- Hints appear in the chat stream as a user message with a subtle "hint" badge
- `ChatEntry` gets an optional `isHint?: boolean` field for styling

### Pause / Resume

A Promise-based gate in the agent loop.

#### Message Types

```ts
interface PauseAgentMessage extends BaseMessage {
  type: "PAUSE_AGENT";
  source: MessageSource.SIDEPANEL;
  payload: Record<string, never>;
}

interface ResumeAgentMessage extends BaseMessage {
  type: "RESUME_AGENT";
  source: MessageSource.SIDEPANEL;
  payload: Record<string, never>;
}
```

#### New Agent Status

```ts
enum AgentStatus {
  // ... existing values ...
  PAUSED = "PAUSED",
}
```

#### Loop Gate Implementation

```ts
class AgentLoop {
  private pauseGate: { promise: Promise<void>; resolve: () => void } | null = null;

  pause(): void {
    if (!this.pauseGate) {
      let resolve: () => void;
      const promise = new Promise<void>(r => { resolve = r; });
      this.pauseGate = { promise, resolve: resolve! };
      this.setStatus(AgentStatus.PAUSED, "Paused by user");
    }
  }

  resume(): void {
    if (this.pauseGate) {
      this.pauseGate.resolve();
      this.pauseGate = null;
      this.setStatus(AgentStatus.THINKING, "Resumed");
    }
  }
}
```

At the top of each loop iteration: `if (this.pauseGate) await this.pauseGate.promise;`

#### Side Panel Changes

- `ControlBar`: When agent is running, show a Pause button (⏸). When paused, show Resume (▶) and the status indicator shows "Paused"
- `StatusBar`: Display "Paused" state with a distinct color (gray/blue)

### Affected Files

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `isHint` to `UserChatMessage`, add `PauseAgentMessage`, `ResumeAgentMessage`, add `AgentStatus.PAUSED` |
| `src/background/agent/loop.ts` | Add `injectHint()`, `pause()`, `resume()`, pause gate check |
| `src/background/background.ts` | Handle `isHint`, `PAUSE_AGENT`, `RESUME_AGENT` |
| `src/sidepanel/components/InputArea.tsx` | Enable during execution, hint mode UX |
| `src/sidepanel/components/ControlBar.tsx` | Pause/Resume button |
| `src/sidepanel/store.ts` | Handle `PAUSED` status |
| `src/sidepanel/bridge.ts` | Send new message types |

---

## P4: Turn Counter, Speed Mode UX, Notifications

### Turn Counter

A lightweight message emitted every turn so the side panel can show real-time turn progress.

```ts
interface AgentTurnMessage extends BaseMessage {
  type: "AGENT_TURN";
  source: MessageSource.BACKGROUND;
  payload: {
    turn: number;
    maxTurns: number;
  };
}
```

**Emit point:** Top of each loop iteration in `loop.ts`, after incrementing `turnCount`.

**UI:** `ControlBar` displays `"Turn 14 / 100"` as a small label next to the stop button. Turns orange at 80% budget, red at 95%.

### Extension Badge

Use `chrome.action.setBadgeText` to show agent state in the extension icon:

| State | Badge | Color |
|-------|-------|-------|
| Running | Turn number (e.g., `"14"`) | Blue |
| Stuck | `"!"` | Orange |
| Paused | `"▐▐"` | Gray |
| Done | `"✓"` | Green (clears after 5s) |
| Error | `"✗"` | Red |

Set via `chrome.action.setBadgeBackgroundColor` and `setBadgeText` in `loop.ts` (or a dedicated `badge.ts` helper).

### Chrome Notifications (Opt-in)

For long-running tasks when the user has switched to another window:

```ts
interface UserSettings {
  // ... existing fields ...
  /** Show Chrome notification when task completes (requires notifications permission) */
  notifyOnCompletion: boolean;
}
```

- Requires adding `"notifications"` to `manifest.json` `permissions`
- Fires `chrome.notifications.create()` when agent status transitions to `IDLE` after a run
- Only fires if the side panel is not visible (check via `chrome.sidePanel` API or `document.visibilityState`)
- Notification body: `"Task completed: {summary}"` (from `DoneArgs.summary`)

### Affected Files

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `AgentTurnMessage` to `RuntimeMessage`, add `notifyOnCompletion` to `UserSettings` |
| `src/background/agent/loop.ts` | Emit `AGENT_TURN`, badge updates, heartbeat steps |
| `src/background/background.ts` | Notification on completion |
| `src/sidepanel/components/ControlBar.tsx` | Turn counter display |
| `src/sidepanel/components/StepTimeline.tsx` | Speed mode always-expanded |
| `src/sidepanel/bridge.ts` | Handle `AGENT_TURN` |
| `src/sidepanel/store.ts` | Add `turnProgress` state |
| `manifest.json` | Add `"notifications"` permission (conditional) |

---

## Implementation Phases

| Phase | Scope | Depends on |
|-------|-------|------------|
| **A** | Turn counter (`AGENT_TURN` + `ControlBar` display) | None — can ship independently |
| **B** | Stuck banner (`AGENT_STUCK` + `StuckBanner`) | RFC Progress Tracker Phase 2a |
| **C** | Hint injection (`isHint` + `injectHint()` + InputArea changes) | None — can ship independently |
| **D** | Subtask progress (`TaskProgressPanel` + `CompletionSummary`) | RFC Task Decomposition Phase 3+ |
| **E** | Pause/resume (gate + `PAUSE_AGENT` / `RESUME_AGENT`) | Phase C (hint infra) |
| **F** | Extension badge + notifications | Phase A (turn counter) |

**Recommended order:** A → C → B → E → D → F

Phases A and C are self-contained and provide immediate user value. B requires the Progress Tracker broadcast (Phase 2a of that RFC). D is the most complex and depends on Task Decomposition being implemented. F is polish.

---

## Alternatives Considered

### 1. All feedback via chat messages

Instead of dedicated components (`StuckBanner`, `TaskProgressPanel`), render everything as chat entries. Simpler implementation, but subtask progress gets lost in the chat stream and isn't scannable.

### 2. Side panel → popup architecture

Move progress tracking to the extension popup (the icon click target) instead of the side panel. Rejected because the popup closes on click-away and can't maintain persistent state.

### 3. Web notifications instead of Chrome notifications

Use the `Notification` API from the side panel instead of `chrome.notifications`. Works but doesn't fire when the side panel is closed. Chrome notifications persist in the notification center.

---

## Implementation Notes

The following features from this RFC have been implemented:

**Implemented:**
- All message types (`AGENT_STUCK`, `AGENT_TURN`, `TASK_PROGRESS`, `TASK_COMPLETION`, `SKIP_SUBTASK`, `PAUSE_AGENT`, `RESUME_AGENT`) added to `src/types/index.ts`
- `AgentStatus.PAUSED` added to the enum
- `AgentLoop` public API: `injectHint()`, `pause()`, `resume()`, `isPaused()`, `getCurrentTurn()`, `getOriginalQuery()`, `getProgressTracker()`; `start()` returns `LoopResult`
- `AGENT_STUCK` broadcast wired to ProgressTracker (nudge/escalate/resolved signals)
- `AGENT_TURN` broadcast at top of each loop iteration (throttled in speed mode: turn 1 or every 5)
- Pause/resume gate in `AgentLoop` with Promise-based blocking
- `PAUSE_AGENT`/`RESUME_AGENT` handlers in `background.ts`
- Hint injection via `isHint` flag on `USER_CHAT` → `agentLoop.injectHint()`
- `bridge.ts` exhaustive message router with `never` check
- Zustand store: `taskProgress`, `taskCompletion`, `stuckState`, `turnProgress` state fields + actions
- `StuckBanner` component (dismissible, nudge vs escalate styling)
- `TaskProgressPanel` component (subtask list with status icons, completion summary)
- `ControlBar` pause/resume buttons, turn counter
- `InputArea` hint mode (enabled during agent run, amber "Send hint" button)
- `MessageBubble` CompletionSummary card, hint badge
- `ContextManager.clearHistory()` (reset history preserving DOM snapshot)
- `ChatEntry` extended with `steps`, `isHint`, `completionData`

**Not yet implemented (future work):**
- Extension badge (`chrome.action.setBadgeText`) — P4
- Chrome notifications on completion — P4
- `notifyOnCompletion` setting — P4

---

## Testing Strategy

- **Unit tests:** Each new component gets a basic render test (renders null when state is null, renders correctly with mock data)
- **Store tests:** Verify state transitions for `stuckState`, `taskProgress`, `taskCompletion`, `turnProgress`
- **Integration tests:** Mock `chrome.runtime.onMessage` and verify that incoming messages update the store correctly
- **Manual tests:** Run the agent on a multi-step task, verify the `TaskProgressPanel` updates in real time, trigger stuck detection and verify the `StuckBanner` appears
