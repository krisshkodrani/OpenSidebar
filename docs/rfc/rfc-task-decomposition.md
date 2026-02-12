# RFC: Task Decomposition — Classification, Subtask Breakdown, Progress Tracking

**Status:** Proposed (design phase)
**Author:** OpenSidebar team
**Date:** 2026-02-11
**Depends on:** RFC Progress Tracker (Phase 1)

## Problem

The agent treats every user message as a monolithic task. A complex instruction like "Complete all 30 challenge tasks" gets a single turn budget, single context window, and no structured subtask tracking. When it fails at task 5, there's no record of what was completed vs. what remains.

## Vision

Before the main agent loop runs, a **planner pass** classifies the task complexity and optionally decomposes it into subtasks:

```
User message → Task Classifier → Simple | Complex
                                    ↓         ↓
                              Direct loop    Planner LLM call
                                             → Subtask list
                                             → Per-subtask loop with progress tracking
                                             → Persist progress to chrome.storage.session
```

## Task Classification Heuristics

Not every message needs decomposition. Simple heuristics to avoid unnecessary overhead:

1. **Word count** < 15 → simple (e.g., "click the login button")
2. **Multi-step indicators** → complex: "then", "after that", "next", "and also", numbered lists
3. **Quantifiers** → complex: "all", "every", "each", numbers > 1 ("fill 3 forms")
4. **User setting** → `UserSettings.autoDecompose: boolean` (opt-in)

## Subtask Persistence

```ts
interface TaskProgress {
  taskId: string;                  // UUID
  userMessage: string;             // original instruction
  subtasks: SubtaskEntry[];        // decomposed subtasks
  currentIndex: number;            // which subtask is active
  startedAt: number;               // timestamp
  status: 'running' | 'paused' | 'completed' | 'failed';
}

interface SubtaskEntry {
  description: string;             // what to do
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  turnsUsed: number;               // how many turns spent
  completedAt?: number;            // timestamp
  result?: string;                 // summary of outcome
}
```

Store in `chrome.storage.session` (key: `"taskProgress"`). Survives SW restarts. Cleared on new task.

## Subtask Loop Integration

Each subtask gets its own mini-context:

1. Planner generates subtask list from user message
2. For each subtask: inject subtask instruction as user message, run agent loop with per-subtask turn limit
3. After each subtask: check completion via page state + LLM assessment
4. Persist progress after each subtask
5. If a subtask fails: skip after 3 retries, mark as failed, continue to next

### Turn Budget Strategy

Options under consideration:

- **Fixed**: Each subtask gets N turns (e.g., 20)
- **Proportional**: Total budget / subtask count
- **Adaptive**: Start with a baseline, extend if progress is being made (fingerprint changing)

### Context Management

Between subtasks:
- Clear conversation history (subtask context is independent)
- Preserve system prompt + snapshot (page state carries over)
- Inject brief summary of completed subtasks for continuity

## Side Panel UI

Subtask progress is surfaced via `TASK_PROGRESS` and `TASK_COMPLETION` message types (see Phase 4 below for full interfaces). The UI components (`TaskProgressPanel`, `CompletionSummary`) are specified in [RFC: Agent UX Feedback](./rfc-agent-ux-feedback.md).

## Dependencies

- **RFC Progress Tracker** (Phase 1) — per-subtask stuck detection via `ProgressTracker`
- Planner prompt engineering — the decomposition LLM call
- Side panel UI work — rendering `TASK_PROGRESS` messages

## Implementation Plan

### Phase 1 (prerequisites — done)
- ProgressTracker class with snapshot fingerprinting
- Enhanced logging for debugging

### Phase 2 (task classification)
- Add `classifyTask(text: string): 'simple' | 'complex'` heuristic
- Add `UserSettings.autoDecompose` toggle
- Wire into `background.ts` message handler before creating `AgentLoop`

### Phase 3 (planner + subtask loop)
- Planner prompt: given user message + current page snapshot, output JSON subtask list
- `SubtaskRunner` class: iterates subtasks, manages per-subtask agent loop instances
- `TaskProgress` persistence to `chrome.storage.session`

### Phase 4 (UI + User Control)

Concrete message types and components for surfacing subtask progress in the side panel. Full UX details (styling, animations, integration with other feedback surfaces) are in [RFC: Agent UX Feedback](./rfc-agent-ux-feedback.md).

#### Message Types

```ts
/** Broadcast from background → side panel on every subtask state change */
interface TaskProgressMessage extends BaseMessage {
  type: "TASK_PROGRESS";
  source: MessageSource.BACKGROUND;
  payload: {
    taskId: string;
    subtasks: SubtaskSummary[];
    currentIndex: number;
    /** Turns used so far across all subtasks */
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

/** Sent once when the entire task completes (all subtasks done or aborted) */
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

**Emit points:**
- `TASK_PROGRESS` — emitted by `SubtaskRunner` on: subtask start, subtask completion/failure/skip, and periodically every 5 turns within a subtask.
- `TASK_COMPLETION` — emitted once at the end of the entire task by `SubtaskRunner.run()`.

#### `TaskProgressPanel` Component

New component: `src/sidepanel/components/TaskProgressPanel.tsx`

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

- Renders as a persistent widget anchored above the input area (not in the chat stream)
- Status icons: `✓` completed, `✗` failed, `—` skipped, `▶` running (animated), `○` pending
- Per-subtask turn counter: `turnsUsed / turnBudget`
- Collapses to a single progress bar when minimized (user toggleable)
- Hidden when no decomposed task is active

#### User Control

**Skip current subtask:**

```ts
/** Side panel → background: skip the running subtask */
interface SkipSubtaskMessage extends BaseMessage {
  type: "SKIP_SUBTASK";
  source: MessageSource.SIDEPANEL;
  payload: { taskId: string };
}
```

The `SubtaskRunner` handles this by:
1. Aborting the current `AgentLoop` (same as `STOP_AGENT` for one subtask)
2. Marking the subtask as `"skipped"`
3. Advancing `currentIndex` and starting the next subtask
4. Emitting `TASK_PROGRESS` with the updated state

**Per-subtask turn budget visibility:** Each subtask in the `TaskProgressPanel` shows `turnsUsed / turnBudget`. If a subtask exceeds 80% of its budget, the counter turns orange; at 100%, the subtask auto-fails and the runner moves to the next.

## Open Questions

1. **Model for decomposition**: Should the planner use the same model as the agent loop, or a separate (cheaper/faster) model?
   - **Recommendation:** Use Cerebras (fast, cheap) for the classification heuristic. Use the same OpenRouter model as the agent loop for the planner call — it needs to understand the page snapshot and produce coherent subtask descriptions. The added latency (~1–2s) is acceptable since it happens once per task.

2. **Subtask dependencies**: How to handle cases where subtask B requires output from subtask A?
   - **Decision:** Sequential execution only (no dependency graph). Each subtask's `result` summary is injected into the next subtask's context preamble. This is simple and covers 90% of cases (fill form → submit → verify). If a subtask truly requires structured output from a prior one, the planner should merge them into a single subtask.

3. **Per-subtask turn budget**: Fixed (simple), proportional (fair), or adaptive (smart)?
   - **Decision:** Start with **fixed** (20 turns per subtask). This is simple, predictable, and easy to display in the UI. The `turnBudget` field in `SubtaskSummary` is per-subtask, so we can make it adaptive later without changing the message format. Total budget = `min(subtaskCount * 20, maxTurns)`.

4. **User interruption**: What happens when the user sends a message mid-subtask?
   - **Decision:** Inject the message as a hint into the current subtask's context (same mechanism as [RFC: Agent UX Feedback](./rfc-agent-ux-feedback.md) `AgentLoop.injectHint()`). Does not pause or abort. If the user explicitly sends `STOP_AGENT`, abort the entire task. If they send `SKIP_SUBTASK`, skip just the current subtask.

5. **Decomposition failures**: What if the planner generates bad subtasks?
   - **Decision:** Validate the planner response (must be valid JSON, 1–20 subtasks, each with a non-empty `description`). If validation fails, fallback to monolithic execution with a warning logged. Track decomposition attempts vs. fallbacks in the log drain for tuning.

## Integration with Agent UX Feedback

The UI rendering of `TASK_PROGRESS` and `TASK_COMPLETION` messages is fully specified in [RFC: Agent UX Feedback](./rfc-agent-ux-feedback.md), including:

- `TaskProgressPanel` styling, animations, and collapse behavior
- `CompletionSummary` component for structured end-of-task reports
- How subtask failures interact with the `StuckBanner` (stuck detection can trigger a skip suggestion)
- Hint injection during subtask execution

## Alternatives Considered

### 1. No decomposition — just better nudging
Relies entirely on the progress tracker to recover from stuck states. Works for simple tasks but doesn't address the "no progress record" problem for complex multi-step workflows.

### 2. User-driven decomposition
Let users manually break tasks into subtasks in the chat UI. Lower complexity but worse UX — users expect the agent to handle complexity.

### 3. ReAct-style inner monologue
Instead of structured subtasks, let the model maintain its own plan in chain-of-thought. Already partially done via the system prompt. Doesn't provide structured tracking or persistence.
