# Plan: Turn-Level Checkpoint/Retry + Agent Status UX

**Date**: 2026-03-09
**Scope**: Two interconnected features — resilient turn retry on transient failures, and richer agent status signals so the user always knows what's happening and how to intervene.

**Literature references**:
- Gulli, *Agentic Design Patterns* — Ch 4 (Reflection), Ch 11 (Goal Monitoring), Ch 12 (Exception Handling & Recovery), Ch 13 (Human-in-the-Loop)
- Rothman, *Context Engineering for Multi-Agent Systems* — Ch 2 (Resilience/Reliability, bounded revision loops, `max_revisions=2`)
- Dibia, *Designing Multi-Agent Systems* — Ch 2 (Termination, Plan-Based Retry), Ch 3 (Four UX Principles: Observability, Interruptibility, Cost-Aware Delegation, Capability Discovery), Ch 4 (Event Streaming, Middleware), Ch 5 (Computer Use Reliability)

---

## Part A: Turn-Level Checkpoint & Retry

### Problem Statement

The agent loop is forward-progress-only. When a turn fails (hallucinated tool call, network error, malformed response), the failure is injected into history and the loop advances. This means:
1. Hallucinated output pollutes conversation history, biasing subsequent turns
2. Transient API failures (timeouts, rate limits, malformed SSE) waste a turn budget slot
3. The user sees "the agent is confused" rather than a clean retry

The trace `ba38a416` demonstrated this: the model hallucinated a tool call as text on turn 3, the hallucination detector caught it, but instead of retrying the turn, the synthesized garbage was added to history. The user stopped before recovery could complete.

### Design Principles (from literature)

1. **Bounded revision loops** (Rothman): `max_revisions = 2` per turn. Never retry infinitely — exhaust budget then fall through to existing escalation path.
2. **Retry with adapted context** (Dibia): "Retry is not blind repetition — it includes enhanced instructions based on the failure analysis." Each retry injects a diagnostic hint.
3. **Checkpoint is the messages array** (natural boundary): The state before `completeStream()` is called IS the checkpoint — `messages[]` hasn't been mutated yet.
4. **Side effects can't be rolled back** (Gulli Ch 12): Tool clicks/navigations are irreversible. Retry only applies to the LLM inference step, not tool execution.

### Architecture

```
┌─────────────────────────────────────────────────┐
│                 executeTurn()                     │
│                                                   │
│  ┌──────────────┐                                │
│  │  CHECKPOINT   │ ← messages[], snapshot,        │
│  │  (implicit)   │   perception, turnCount        │
│  └──────┬───────┘                                │
│         │                                         │
│         ▼                                         │
│  ┌──────────────┐     retry ≤ MAX_TURN_RETRIES   │
│  │ completeStream│ ←──────────────────┐           │
│  └──────┬───────┘                     │           │
│         │                             │           │
│    success?──── no ──► classifyError()│           │
│         │              ┌──────────────┘           │
│        yes             │ retryable?               │
│         │              │  yes → inject hint,      │
│         ▼              │        invalidate cache, │
│  [continue as today]   │        loop back         │
│                        │  no  → fall through to   │
│                        │        existing path     │
│                        └──────────────────────────│
└─────────────────────────────────────────────────┘
```

### Retryable vs Non-Retryable Errors

| Error Class | Retryable? | Retry Hint |
|---|---|---|
| Hallucinated tool call (detected by `isHallucinatedToolCall`) | Yes | "Your previous response contained a tool call as raw text. Use the tool_calls API." |
| Network/SSE stream error (non-abort) | Yes | (none — transparent retry) |
| Provider 429 (rate limit) | Yes (with delay) | (none — handled by `fetchWithRetry` already) |
| Provider 402 (no credits) | No | (existing: show error, return) |
| User abort (`STOP_AGENT`) | No | (existing: clean exit) |
| Provider 400/422 (bad request) | No | (fall through to text-only handling) |
| Empty response (no content, no tools) | Yes | "You returned an empty response. Observe the page and choose a tool to advance." |
| Tool recovery succeeded | Not applicable | (existing: recovered calls execute normally) |

### Implementation Plan

#### A1. Add `TurnRetryConfig` constant to `loop.ts`

```typescript
const TURN_RETRY = {
  MAX_RETRIES: 2,          // Rothman's max_revisions pattern
  RETRYABLE_ERRORS: new Set(["hallucination", "network", "empty_response"]),
  BACKOFF_MS: [0, 500],    // No delay on first retry, 500ms on second
} as const;
```

**File**: `src/background/agent/loop.ts`
**Location**: Near existing `LLM_CONFIG` and `TOOL_CACHE` constants

#### A2. Add `classifyTurnError()` helper to `loop-helpers.ts`

```typescript
export type TurnErrorClass =
  | "hallucination"
  | "network"
  | "empty_response"
  | "credits_exhausted"
  | "user_abort"
  | "bad_request"
  | "unknown";

export function classifyTurnError(
  error: unknown,
  hallucinationDetected: boolean,
  response: CompletionResponse | null,
): TurnErrorClass { ... }
```

Centralizes error classification that's currently scattered across the catch block.

**File**: `src/background/agent/loop-helpers.ts`

#### A3. Wrap LLM call in retry loop (`loop.ts`)

Current code (simplified):
```typescript
try {
  response = await this.llm.completeStream({ messages, tools, ... }, onTextDelta);
} catch (llmError) {
  if (hallucinationDetected && llmError.name === "AbortError") {
    // synthesize response from accumulated text
  } else if (llmError.name === "AbortError") {
    throw llmError;
  } else if (llmError.status === 402) {
    // credits exhausted
  }
  throw llmError;
}
```

New code:
```typescript
let retryCount = 0;
let response: CompletionResponse;

retryLoop: while (true) {
  // Reset per-attempt state
  streamedTextAccumulator = "";
  hallucinationDetected = false;

  try {
    response = await this.llm.completeStream({ messages, tools, ... }, onTextDelta);

    // Check for empty response (retryable)
    if (!response.content && (!response.tool_calls || response.tool_calls.length === 0)) {
      const errorClass = "empty_response";
      if (retryCount < TURN_RETRY.MAX_RETRIES && TURN_RETRY.RETRYABLE_ERRORS.has(errorClass)) {
        retryCount++;
        this.log.warn("agent", "Empty response, retrying", { turn: this.turnCount, retry: retryCount });
        // Broadcast retry status to UI
        this.broadcast({ type: "AGENT_STEP", payload: {
          step: { id: crypto.randomUUID(), type: "info", label: `Retrying (${retryCount}/${TURN_RETRY.MAX_RETRIES})...`,
                  status: "running", timestamp: Date.now() },
          update: false,
        }});
        // Clear streamed garbage
        this.broadcast({ type: "STREAM_CHUNK", payload: { delta: "", done: false, replaceContent: "" } });
        if (TURN_RETRY.BACKOFF_MS[retryCount - 1]) {
          await delay(TURN_RETRY.BACKOFF_MS[retryCount - 1]);
        }
        continue retryLoop;
      }
    }
    break; // Success — exit retry loop

  } catch (llmError: any) {
    const errorClass = classifyTurnError(llmError, hallucinationDetected, null);

    if (errorClass === "user_abort") throw llmError;
    if (errorClass === "credits_exhausted") { /* existing 402 handling */ return ...; }

    if (retryCount < TURN_RETRY.MAX_RETRIES && TURN_RETRY.RETRYABLE_ERRORS.has(errorClass)) {
      retryCount++;
      this.log.warn("agent", `Turn error (${errorClass}), retrying`, { turn: this.turnCount, retry: retryCount });

      // Clear any garbage streamed to UI
      this.broadcast({ type: "STREAM_CHUNK", payload: { delta: "", done: false, replaceContent: "" } });

      // Broadcast retry step to UI
      this.broadcast({ type: "AGENT_STEP", payload: {
        step: { id: crypto.randomUUID(), type: "info",
                label: `Retrying (${retryCount}/${TURN_RETRY.MAX_RETRIES})...`,
                status: "running", timestamp: Date.now() },
        update: false,
      }});

      // Inject diagnostic hint for hallucination retries
      if (errorClass === "hallucination") {
        messages = [...messages, {
          role: "user" as const,
          content: "[System] Your previous response contained raw JSON instead of a proper tool call. " +
                   "Use the tool_calls API to invoke tools. Do not emit JSON as text.",
        }];
      }

      // Invalidate perception cache (force fresh observation on retry)
      this.perception.invalidateCache();

      if (TURN_RETRY.BACKOFF_MS[retryCount - 1]) {
        await delay(TURN_RETRY.BACKOFF_MS[retryCount - 1]);
      }
      continue retryLoop;
    }

    // Exhausted retries — fall through to existing recovery
    if (hallucinationDetected) {
      // existing: synthesize response from accumulated text
      response = { role: "assistant", content: streamedTextAccumulator, ... };
      break;
    }
    throw llmError;
  }
}
```

**File**: `src/background/agent/loop.ts`
**Location**: Lines ~2638-2700 (the LLM call + catch block)

#### A4. Record retry events in trace

```typescript
if (retryCount > 0) {
  this.traceRecorder?.recordEvent("turn_retry", {
    turn: this.turnCount,
    retryCount,
    errorClass,
    succeeded: response != null,
  });
}
```

**File**: `src/background/agent/loop.ts`

#### A5. Expose retry info in `AgentStep`

Add optional `retryCount` field to `AgentStep` type so the UI can display retry badges.

```typescript
export interface AgentStep {
  // ... existing fields ...
  retryCount?: number;  // How many retries this turn needed
}
```

**File**: `src/types/agent.ts`

#### A6. Clean up diagnostic hint after successful retry

If a hallucination retry succeeds, remove the injected diagnostic hint from `messages` before adding the assistant response to history. This prevents the hint from polluting context for future turns.

**File**: `src/background/agent/loop.ts`

---

## Part B: Agent Status UX

### Problem Statement

Users can't easily tell when the agent is working vs. idle, and the stop mechanism is hard to discover. The trace session showed a user stopping the agent during recovery — likely because they couldn't tell it was still trying.

Current issues:
1. **Stop button is small and subtle** — a 16px red icon next to the send button, easily missed
2. **No prominent "agent is working" visual state** — just a small spinner in the status line
3. **Status text is technical** — "Thinking", "Acting" don't convey what's actually happening
4. **No retry/recovery visibility** — hallucination recovery, escalation, stagnation are invisible
5. **No progress narrative** — the step timeline shows tool names, not user-friendly descriptions

### Design Principles (from literature)

1. **Real-Time Activity Streaming** (Dibia Ch 3): "Show live updates as agents make progress, including structured plans, current steps, and time/cost estimates."
2. **Simple Progress Narratives** (Dibia Ch 3): "Translate complex agent coordination into user-friendly progress stories."
3. **Interruptibility** (Dibia Ch 3): "Users can interrupt, pause, resume, or cancel agent actions at any point." The stop affordance must be unmissable.
4. **Functional Transparency** (Dibia Ch 3): End users need "understanding outcomes and having simple controls without being overwhelmed."
5. **Outcome Attribution** (Dibia Ch 3): "When things go wrong, explain in user terms with clear causation."

### Implementation Plan

#### B1. Prominent "Agent Running" state on InputArea

When the agent is running, replace the text input with a full-width status panel:

```
┌─────────────────────────────────────────────┐
│  ● Working on your task...          [Stop]  │
│  ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈  │
│  Step 2/4 · Turn 3/10 · openai/gpt-oss     │
└─────────────────────────────────────────────┘
```

Key changes:
- The entire input area transforms when agent is running (not just a small button swap)
- Large, prominent **Stop** button with text label (not just an icon)
- Animated progress indicator (pulsing bar or dots) replaces the text input
- Current step description in natural language
- Turn counter and model badge visible at a glance

**File**: `src/sidepanel/components/InputArea.tsx`
**Scope**: Conditional rendering — when `isAgentRunning`, show the running panel instead of the input field

#### B2. Running state header indicator

Add a subtle animated accent to the header/top of the panel:
- Thin animated gradient bar at the very top (2-3px) when agent is running
- Color: primary brand color, pulsing left-to-right
- Disappears immediately when agent stops

This gives an ambient "the agent is alive" signal even when the user is scrolled up in chat history.

**File**: `src/sidepanel/App.tsx` or `src/sidepanel/components/Header.tsx`
**Scope**: Small — conditional CSS class on a thin div

#### B3. Enhanced StatusLine with activity detail

Extend StatusLine to show richer information:

| State | Current Display | New Display |
|---|---|---|
| Thinking | "Thinking..." | "Thinking... (analyzing page)" |
| Acting | "Acting..." | "Clicking submit button" (from step label) |
| Retrying | (not shown) | "Retrying turn (1/2)..." |
| Escalating | (not shown) | "Switching to planner model..." |
| Stalled | "Stalled (6 turns)" | "Stuck — trying different approach" |
| Hallucination | (not shown) | "Correcting response..." |
| Waiting | "Waiting..." | "Waiting for page to load..." |

**File**: `src/sidepanel/components/StatusLine.tsx`
**Data source**: New `AGENT_ACTIVITY` payload fields from loop.ts

#### B4. New `AGENT_EVENT` message type for transient events

Currently, internal events (hallucination, escalation, retry, stagnation) are only logged. Add a lightweight message type to surface them to the UI as transient toasts or step timeline entries:

```typescript
// New message type
interface AgentEventMessage {
  type: "AGENT_EVENT";
  source: MessageSource.BACKGROUND;
  workspaceId: string;
  payload: {
    event: "retry" | "escalation" | "hallucination_recovered" | "stagnation_nudge" | "deescalation";
    detail: string;        // Human-readable: "Retrying after malformed response (1/2)"
    turn: number;
    timestamp: number;
  };
}
```

These render as info-type `AgentStep` entries in the step timeline with distinct icons:
- Retry: `RefreshCw` icon
- Escalation: `ArrowUp` icon (already exists)
- Hallucination: `AlertTriangle` icon
- De-escalation: `ArrowDown` icon

**Files**:
- `src/types/messages.ts` — add `AGENT_EVENT` to `RuntimeMessage` union
- `src/background/agent/loop.ts` — broadcast events at existing log points
- `src/sidepanel/bridge.ts` — route to store
- `src/sidepanel/store/chat-slice.ts` — inject as step into current message
- `src/sidepanel/components/StepTimeline.tsx` — new icon cases

#### B5. Stop button UX overhaul

Replace the small icon-only stop button with:

```tsx
<button className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600
                    text-white text-xs font-medium rounded-md transition-colors">
  <StopCircle size={14} />
  Stop
</button>
```

Properties:
- Text label "Stop" alongside the icon
- Larger click target (full button, not just icon)
- Centered in the running-state input panel (B1)
- Keyboard shortcut: `Escape` key stops the agent (with confirmation if high-risk action in progress)

**File**: `src/sidepanel/components/InputArea.tsx`

#### B6. Escape-to-stop keyboard shortcut

Add a global keyboard listener in the side panel:

```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === "Escape" && isAgentRunning) {
      e.preventDefault();
      onStop();
    }
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}, [isAgentRunning, onStop]);
```

**File**: `src/sidepanel/App.tsx` or `src/sidepanel/components/InputArea.tsx`

#### B7. "Agent finished" transition

When the agent completes, show a brief completion flash:
- The running indicator transitions to a green checkmark or completion state
- Status text shows "Done" for 2 seconds before reverting to idle
- If error: red flash with "Failed — [reason]" for 3 seconds

This prevents the jarring jump from "working" to "nothing" that makes users wonder if it finished or crashed.

**File**: `src/sidepanel/components/StatusLine.tsx` (timer-based state)

---

## Implementation Order

### Phase 1: Quick wins (high impact, low risk)
1. **B5** — Stop button UX (text label + larger target) — 30min
2. **B6** — Escape-to-stop shortcut — 15min
3. **B1** — Running-state input panel — 1-2hr
4. **B2** — Animated top bar indicator — 30min

### Phase 2: Retry system (core reliability)
5. **A2** — `classifyTurnError()` helper — 30min
6. **A1** — `TurnRetryConfig` constants — 10min
7. **A3** — Retry loop wrapping LLM call — 2-3hr (careful, critical path)
8. **A4** — Trace recording for retries — 15min
9. **A6** — Diagnostic hint cleanup — 30min

### Phase 3: Status richness (observability)
10. **B4** — `AGENT_EVENT` message type + bridge routing — 1-2hr
11. **A5** — `retryCount` on AgentStep — 15min
12. **B3** — Enhanced StatusLine text — 1hr
13. **B7** — Completion transition animation — 30min

### Phase 4: Polish
14. Wire retry events into B4 event system
15. Integration testing — verify retry doesn't break existing escalation flow
16. Add retry stats to `SESSION_METRICS` payload

---

## Testing Strategy

### Unit Tests
- `classifyTurnError()` — all error classes correctly identified
- Retry loop — verify max retries respected, verify backoff timing
- Diagnostic hint injection and cleanup
- `AGENT_EVENT` message routing through bridge

### Integration Tests
- Hallucination → retry → success (mock `completeStream` to fail once then succeed)
- Hallucination → retry × 2 → exhaust → fall through to existing escalation
- Network error → retry → success
- User abort during retry → clean exit (no dangling state)
- Empty response → retry with hint → success

### Manual Testing
- Run a task, observe the running-state input panel
- Press Escape while agent is running → agent stops
- Trigger hallucination (use a model known to hallucinate tool calls) → observe retry step in timeline
- Watch StatusLine during escalation → verify "Switching to planner model" appears

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Retry loop creates infinite cycles | Hard cap at `MAX_RETRIES=2`, plus main loop `maxTurns` still applies |
| Diagnostic hint pollutes context | Explicit cleanup after successful retry (A6) |
| Retry delays frustrate users | Visible retry indicator (B4), short backoffs (0ms, 500ms) |
| Running-state panel hides input | Immediate transition back on stop/completion |
| Escape key conflicts | Only active when `isAgentRunning`, standard browser Escape behavior preserved otherwise |
| Retry masks persistent model issues | Trace recording (A4) + session metrics expose retry rates for monitoring |

---

## Files Modified (Complete List)

### Part A (Checkpoint/Retry)
- `src/background/agent/loop.ts` — retry loop, event broadcasting
- `src/background/agent/loop-helpers.ts` — `classifyTurnError()`
- `src/types/agent.ts` — `retryCount` on `AgentStep`

### Part B (Status UX)
- `src/sidepanel/components/InputArea.tsx` — running-state panel, stop button
- `src/sidepanel/components/StatusLine.tsx` — enhanced text, completion transition
- `src/sidepanel/components/StepTimeline.tsx` — new event icons
- `src/sidepanel/App.tsx` — top bar indicator, escape shortcut
- `src/sidepanel/bridge.ts` — route `AGENT_EVENT`
- `src/sidepanel/store/chat-slice.ts` — inject event steps
- `src/types/messages.ts` — `AGENT_EVENT` message type
