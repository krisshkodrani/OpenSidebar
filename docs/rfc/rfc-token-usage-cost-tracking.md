# RFC: Token Usage & Cost Tracking — Session Metrics with OpenRouter

**Status:** Proposed
**Author:** OpenSidebar team
**Date:** 2026-02-12
**Depends on:** None (self-contained)

## Problem

Users have no visibility into how many tokens or how much money a task consumes. Once an agent session starts:

1. **No token visibility** — users can't see how many prompt/completion tokens are being used per turn or across the session
2. **No cost tracking** — OpenRouter charges per token, but the extension discards all cost data; users must check the OpenRouter dashboard manually
3. **No timing metrics** — `llmMs` is logged internally but never surfaced to the user
4. **Streaming path drops usage** — `parseSSEStream()` ignores the `usage` object in the final SSE chunk, so token data is never captured in practice (the agent loop exclusively uses streaming)
5. **Vision calls untracked** — `describeScreenshot()` in `vision.ts` makes OpenRouter API calls but discards token/cost data entirely
6. **No historical perspective** — there's no way to see cumulative cost across sessions or compare cost between tasks

This RFC adds a toggleable session metrics panel that surfaces token usage, estimated cost, and timing — all derived from data OpenRouter already returns.

## Priorities

| Priority | Feature | Complexity |
|----------|---------|------------|
| P1 | Capture usage from SSE stream + non-streaming responses | Low |
| P2 | Accumulate per-session metrics in AgentLoop | Low |
| P3 | Broadcast metrics to side panel via new RuntimeMessage | Low |
| P4 | Settings toggle + session metrics UI | Medium |
| P5 | Completion summary with cost/token/time data | Low |
| P6 | Vision call tracking | Low |
| P7 | Historical cost persistence (cross-session) | Medium (future) |

---

## P1: Capture Usage from OpenRouter Responses

### The Gap

OpenRouter returns a `usage` object in every response — including the **final SSE chunk** in streaming mode. The current `parseSSEStream()` function skips it because it only looks at `parsed.choices[0].delta`.

OpenRouter's streaming response includes usage in the last `data:` event (before `[DONE]`):

```json
data: {"id":"gen-xxx","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1234,"completion_tokens":567,"total_tokens":1801,"cost":0.00234}}
```

### Expanded Usage Type

```ts
// src/background/llm/types.ts
export interface TokenUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    /** Cost in USD charged by OpenRouter (returned directly in response) */
    cost?: number;
}

export interface CompletionResponse {
    role: "assistant";
    content: string | null;
    tool_calls?: ToolCall[];
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | "error";
    usage?: TokenUsage;
}
```

### Streaming Parser Change

`parseSSEStream()` currently returns `{ content, tool_calls }`. Change its return type to include `usage`:

```ts
// src/background/streaming.ts
export async function parseSSEStream(
    body: ReadableStream<Uint8Array>,
    onTextDelta: (delta: string) => void,
    signal?: AbortSignal,
): Promise<{ content: string | null; tool_calls?: ToolCall[]; usage?: TokenUsage }> {
    // ... existing code ...
    let usage: TokenUsage | undefined;

    for (const line of lines) {
        // ... existing delta handling ...

        // Capture usage from final chunk (appears at top level, not in delta)
        if (parsed.usage) {
            usage = {
                prompt_tokens: parsed.usage.prompt_tokens ?? 0,
                completion_tokens: parsed.usage.completion_tokens ?? 0,
                total_tokens: parsed.usage.total_tokens ?? 0,
                cost: parsed.usage.cost,
            };
        }
    }

    return { content: content || null, tool_calls: toolCalls, usage };
}
```

### LLM Client Change

`completeStream()` currently hardcodes `usage: undefined`. Wire through the parsed value:

```ts
// src/background/llm/client.ts — completeStream()
const result = await parseSSEStream(response.body!, onTextDelta, request.signal);
return {
    role: "assistant",
    content: result.content,
    tool_calls: result.tool_calls,
    finish_reason: /* ... */,
    usage: result.usage,  // was: undefined
};
```

### Affected Files

| File | Change |
|------|--------|
| `src/background/llm/types.ts` | Extract `TokenUsage` interface, use in `CompletionResponse` |
| `src/background/streaming.ts` | Capture `parsed.usage` from final SSE chunk, return in result |
| `src/background/llm/client.ts` | Wire `usage` from `parseSSEStream` result into `CompletionResponse` |

---

## P2: Session Metrics Accumulator

### SessionMetrics Type

```ts
// src/types/index.ts
export interface SessionMetrics {
    /** Total prompt tokens across all LLM calls this session */
    totalPromptTokens: number;
    /** Total completion tokens across all LLM calls this session */
    totalCompletionTokens: number;
    /** Total tokens (prompt + completion) */
    totalTokens: number;
    /** Cumulative cost in USD from OpenRouter */
    totalCost: number;
    /** Total LLM call time in ms (wall clock, not including tool execution) */
    totalLlmTimeMs: number;
    /** Total session wall clock time in ms */
    totalSessionTimeMs: number;
    /** Number of LLM calls made (including vision) */
    llmCallCount: number;
    /** Per-model breakdown */
    modelBreakdown: Record<string, {
        promptTokens: number;
        completionTokens: number;
        cost: number;
        calls: number;
    }>;
}
```

### AgentLoop Accumulator

Add a `SessionMetrics` accumulator to `AgentLoop`:

```ts
// src/background/agent/loop.ts
class AgentLoop {
    private metrics: SessionMetrics = {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        totalLlmTimeMs: 0,
        totalSessionTimeMs: 0,
        llmCallCount: 0,
        modelBreakdown: {},
    };
    private sessionStartTime: number = 0;

    /** Call after each LLM response to accumulate usage */
    private recordUsage(response: CompletionResponse, llmMs: number): void {
        if (response.usage) {
            this.metrics.totalPromptTokens += response.usage.prompt_tokens;
            this.metrics.totalCompletionTokens += response.usage.completion_tokens;
            this.metrics.totalTokens += response.usage.total_tokens;
            if (response.usage.cost != null) {
                this.metrics.totalCost += response.usage.cost;
            }
        }
        this.metrics.totalLlmTimeMs += llmMs;
        this.metrics.llmCallCount += 1;

        // Per-model breakdown
        const model = this.llm.getCurrentModel();
        if (!this.metrics.modelBreakdown[model]) {
            this.metrics.modelBreakdown[model] = {
                promptTokens: 0, completionTokens: 0, cost: 0, calls: 0,
            };
        }
        const entry = this.metrics.modelBreakdown[model];
        entry.calls += 1;
        if (response.usage) {
            entry.promptTokens += response.usage.prompt_tokens;
            entry.completionTokens += response.usage.completion_tokens;
            if (response.usage.cost != null) {
                entry.cost += response.usage.cost;
            }
        }
    }
}
```

**Integration point:** After the existing `const llmMs = Date.now() - llmStart;` line in the loop body, call `this.recordUsage(response, llmMs)`.

### Extend LoopResult

```ts
export interface LoopResult {
    outcome: "completed" | "stopped" | "max_turns" | "error";
    turnCount: number;
    summary: string;
    /** Session token/cost/time metrics (present when tracking enabled) */
    metrics?: SessionMetrics;
}
```

Set `metrics` when building the return value:

```ts
this.metrics.totalSessionTimeMs = Date.now() - this.sessionStartTime;
return { outcome: "completed", turnCount: this.turnCount, summary, metrics: this.metrics };
```

### Affected Files

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `SessionMetrics` interface |
| `src/background/agent/loop.ts` | Add `metrics` field, `recordUsage()`, wire into loop, include in `LoopResult` |

---

## P3: Broadcast Metrics to Side Panel

### New RuntimeMessage Type

```ts
// src/types/index.ts
interface SessionMetricsMessage extends BaseMessage {
    type: "SESSION_METRICS";
    source: MessageSource.BACKGROUND;
    payload: SessionMetrics;
}
```

Add `SessionMetricsMessage` to the `RuntimeMessage` union.

### Broadcast Strategy

Metrics are broadcast at two points:

1. **Per-turn** (throttled) — after each LLM call, if the `showSessionMetrics` setting is enabled. Throttle to every 3 turns or when cost increases by >$0.001 to avoid message spam.
2. **On completion** — always, as part of the `TASK_COMPLETION` payload (extended with metrics).

```ts
// In loop.ts, after recordUsage():
if (this.settings.showSessionMetrics && (this.turnCount % 3 === 0 || this.turnCount === 1)) {
    this.metrics.totalSessionTimeMs = Date.now() - this.sessionStartTime;
    chrome.runtime.sendMessage({
        type: "SESSION_METRICS",
        source: "background",
        requestId: crypto.randomUUID(),
        payload: { ...this.metrics },
    });
}
```

### Extend TaskCompletionMessage

Add optional `metrics` to `TaskCompletionMessage.payload`:

```ts
interface TaskCompletionMessage extends BaseMessage {
    type: "TASK_COMPLETION";
    source: MessageSource.BACKGROUND;
    payload: {
        // ... existing fields ...
        /** Session metrics (token usage, cost, timing) */
        metrics?: SessionMetrics;
    };
}
```

### Affected Files

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `SessionMetricsMessage` to `RuntimeMessage` union, extend `TaskCompletionMessage` payload |
| `src/background/agent/loop.ts` | Broadcast `SESSION_METRICS` per-turn (throttled) and on completion |
| `src/sidepanel/bridge.ts` | Handle `SESSION_METRICS` → store action |

---

## P4: Settings Toggle + Session Metrics UI

### Settings

Add a single toggle to `UserSettings`:

```ts
export interface UserSettings {
    // ... existing fields ...
    /** Show token usage and cost metrics during and after agent sessions */
    showSessionMetrics: boolean;
}
```

Default: `false` (opt-in to avoid clutter for casual users).

### SettingsDrawer

Add under a new **"Usage & Cost"** section between "Agent Behavior" and "Appearance":

```
┌─────────────────────────────────────────┐
│ Usage & Cost                            │
│ ──────────────────────────────────────  │
│ Show session metrics        [  toggle ] │
│ Token usage, cost, and timing           │
│ displayed during agent runs             │
└─────────────────────────────────────────┘
```

### Zustand Store

```ts
// src/sidepanel/store.ts
interface SidePanelState {
    // ... existing fields ...
    /** Live session metrics (null when no active session or tracking disabled) */
    sessionMetrics: SessionMetrics | null;
}

// Actions
setSessionMetrics: (metrics: SessionMetrics) => void;
clearSessionMetrics: () => void;
```

- `setSessionMetrics` is called from `bridge.ts` on `SESSION_METRICS` messages
- `clearSessionMetrics` is called when the agent transitions to IDLE (via `AGENT_STATUS`)

### MetricsBar Component

**File:** `src/sidepanel/components/MetricsBar.tsx` (NEW)

A compact, single-line bar displayed below the `ControlBar` during active sessions. Only rendered when `showSessionMetrics` is enabled AND `sessionMetrics` is non-null.

```
┌─────────────────────────────────────────┐
│ 12.4K tokens · $0.0023 · 4.2s LLM      │
└─────────────────────────────────────────┘
```

**Format rules:**
- Tokens: `< 1000` → `"834"`, `≥ 1000` → `"12.4K"`, `≥ 1M` → `"1.2M"`
- Cost: `< $0.01` → `"$0.0023"` (4 decimal places), `≥ $0.01` → `"$0.12"` (2 decimal places), `≥ $1` → `"$1.23"`
- Time: `< 60s` → `"4.2s"`, `≥ 60s` → `"2m 14s"`
- Show `"—"` for cost if OpenRouter didn't return cost data

**Styling:**
- `text-xs text-gray-500 dark:text-gray-400` — subtle, non-intrusive
- Same horizontal padding as `ControlBar` for alignment
- No background, just a text line

**Layout in App.tsx:**
```tsx
<div className="flex flex-col shrink-0 ...">
    <ControlBar />
    {settings.showSessionMetrics && sessionMetrics && <MetricsBar metrics={sessionMetrics} />}
    <TaskProgressPanel />
    <InputArea ... />
</div>
```

### Affected Files

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `showSessionMetrics` to `UserSettings`, add `sessionMetrics` to `SidePanelState` |
| `src/sidepanel/store.ts` | Add `sessionMetrics` state, actions, default setting |
| `src/sidepanel/bridge.ts` | Handle `SESSION_METRICS` message |
| `src/sidepanel/components/SettingsDrawer.tsx` | Add "Usage & Cost" toggle |
| `src/sidepanel/components/MetricsBar.tsx` | NEW — compact metrics display |
| `src/sidepanel/components/index.ts` | Barrel export `MetricsBar` |
| `src/sidepanel/App.tsx` | Render `MetricsBar` conditionally |

---

## P5: Completion Summary with Metrics

Extend the existing `CompletionSummary` component (rendered inside `MessageBubble`) to show session metrics when available.

### Current Display

```
┌─────────────────────────────────────────┐
│ ✓ Task Completed                        │
│ 47 turns                                │
│ [summary text]                          │
└─────────────────────────────────────────┘
```

### Enhanced Display (when metrics available)

```
┌─────────────────────────────────────────┐
│ ✓ Task Completed                        │
│ 47 turns · 125.3K tokens · $0.04       │
│ LLM: 12.3s · Total: 2m 14s             │
│ ──────────────────────────────────────  │
│ [summary text]                          │
└─────────────────────────────────────────┘
```

If the user had model escalation (started on Gemini Flash Lite, escalated to MiniMax M2.5), show the breakdown:

```
│ 47 turns · 125.3K tokens · $0.04       │
│ ├ gemini-2.5-flash-lite: 98.1K tok · $0.01  │
│ └ minimax-m2.5:          27.2K tok · $0.03  │
```

### Data Flow

The `TaskCompletionMessage.payload.metrics` field (added in P3) carries this data. The `completionData` on `ChatEntry` will include it, and `CompletionSummary` will conditionally render the metrics section when present.

### Affected Files

| File | Change |
|------|--------|
| `src/sidepanel/components/MessageBubble.tsx` | Extend `CompletionSummary` to render metrics |

---

## P6: Vision Call Tracking

`describeScreenshot()` in `vision.ts` makes a non-streaming `fetch` to OpenRouter but discards `json.usage`. Capture it and return alongside the description.

```ts
// src/background/vision.ts
export async function describeScreenshot(
    dataUrl: string,
    apiKey: string,
    visionModel: string,
): Promise<{ description: string; usage?: TokenUsage }> {
    // ... existing fetch ...
    const json = await response.json();
    return {
        description: json.choices?.[0]?.message?.content ?? "No description",
        usage: json.usage ? {
            prompt_tokens: json.usage.prompt_tokens ?? 0,
            completion_tokens: json.usage.completion_tokens ?? 0,
            total_tokens: json.usage.total_tokens ?? 0,
            cost: json.usage.cost,
        } : undefined,
    };
}
```

In the `take_screenshot` tool handler (in `tools/index.ts`), after calling `describeScreenshot`, report the usage back to the agent loop's accumulator via a callback or return value.

### Affected Files

| File | Change |
|------|--------|
| `src/background/vision.ts` | Return `usage` from `describeScreenshot()` |
| `src/background/tools/index.ts` | Pass vision usage to loop accumulator |
| `src/background/agent/loop.ts` | Accept vision usage via callback/method |

---

## P7: Historical Cost Persistence (Future)

> **Not in initial scope.** Documented for future consideration.

Store per-session metrics in `chrome.storage.local` for historical tracking:

```ts
interface SessionRecord {
    id: string;
    timestamp: number;
    query: string;
    metrics: SessionMetrics;
    outcome: LoopResult["outcome"];
}
```

This would enable:
- "You've spent $X.XX across N sessions this week"
- Cost comparison between tasks
- Budget alerts ("You've exceeded your daily budget of $Y")

Deferred because it adds storage management complexity and is not needed for the core use case.

---

## How OpenRouter Cost Calculation Works

OpenRouter includes cost data directly in API responses, so **no additional API calls are needed**:

1. **Per-response `usage.cost`** — OpenRouter returns the cost (in USD) charged to your account directly in the `usage` object of every response, including streaming. This is the authoritative cost.

2. **Token counts** — `usage.prompt_tokens` and `usage.completion_tokens` use the model's native tokenizer. These are exact, not estimated.

3. **Model pricing** — OpenRouter passes through the underlying provider's pricing with no markup. Prices vary per model:
   - `google/gemini-2.5-flash-lite` (MODEL_FAST): ~$0.10/M input, ~$0.40/M output
   - `minimax/minimax-m2.5` (MODEL_SMART): ~$0.30/M input, ~$1.20/M output
   - Vision models: same pricing as their text counterparts (default: `google/gemini-2.5-flash-lite`)

4. **Fallback if `cost` is absent** — If OpenRouter doesn't return `cost` (rare), we can estimate from token counts × known model prices. But the `usage.cost` field should be preferred as the source of truth.

5. **Generation endpoint** — OpenRouter also offers `/api/v1/generation?id=<gen_id>` for async cost lookup after a request completes. We don't need this since `usage.cost` is inline, but it's available as a fallback for debugging.

**No local pricing table is needed.** We rely entirely on OpenRouter's reported `usage.cost`.

---

## Implementation Phases

| Phase | Scope | Depends on | Effort |
|-------|-------|------------|--------|
| **A** | Capture usage from SSE stream (P1) | None | Small — ~20 lines changed |
| **B** | Session accumulator in AgentLoop (P2) | Phase A | Small — new method + fields |
| **C** | Broadcast + store (P3, P4 store/bridge) | Phase B | Small — new message type + handler |
| **D** | Settings toggle + MetricsBar UI (P4 UI) | Phase C | Medium — new component + settings |
| **E** | Completion summary with metrics (P5) | Phase C | Small — extend existing component |
| **F** | Vision call tracking (P6) | Phase B | Small — wire return value |

**Recommended order:** A → B → C → D + E (parallel) → F

Phases A–C are plumbing with no UI impact and can be shipped as a single commit. D and E are the user-facing changes. F is independent polish.

---

## Alternatives Considered

### 1. Query `/api/v1/generation` endpoint per call

OpenRouter provides a `/api/v1/generation?id=<gen_id>` endpoint that returns detailed cost data after a request completes. This would give precise cost but adds an extra HTTP round-trip per LLM call (~100-300ms), increasing latency. Rejected in favor of inline `usage.cost` which requires zero additional requests.

### 2. Local pricing table for cost estimation

Maintain a hardcoded map of model → price-per-token and compute cost locally. Fragile — prices change, and we'd need to update the table constantly. OpenRouter's inline `usage.cost` is always accurate and requires no maintenance.

### 3. Always-visible metrics (no toggle)

Show metrics for all users by default. Rejected because most casual users don't care about token counts, and the extra UI line adds visual noise. An opt-in toggle respects minimal UI.

### 4. Separate metrics panel/page

Instead of an inline bar, show metrics in a dedicated settings sub-page or popup. Over-engineered for the amount of data — a single-line bar and an enhanced completion summary are sufficient. A dedicated page would make sense only when historical persistence (P7) is implemented.

### 5. Per-message token counts in chat bubbles

Show token usage on each assistant message bubble. Too noisy — users care about session totals, not per-message breakdowns. The per-model breakdown in the completion summary covers the escalation case adequately.

---

## Testing Strategy

### Unit Tests

- **`streaming.test.ts`**: Verify `parseSSEStream` captures `usage` from final SSE chunk with mock stream data
- **`loop.test.ts`**: Verify `recordUsage()` accumulates tokens/cost correctly across multiple calls, per-model breakdown
- **`store.test.ts`**: Verify `sessionMetrics` state transitions (set, clear, null when idle)
- **`MetricsBar.test.tsx`**: Render with mock metrics, verify formatting (K/M suffixes, cost decimal places, time formatting)

### Integration Tests

- Mock `chrome.runtime.onMessage`, send `SESSION_METRICS`, verify store updates
- Verify `SESSION_METRICS` is NOT broadcast when `showSessionMetrics` is false
- Verify `CompletionSummary` renders metrics when present, omits when absent

### Manual Tests

1. Enable "Show session metrics" in settings
2. Run an agent task and verify MetricsBar appears with live-updating values
3. Verify values roughly match the OpenRouter dashboard after the session
4. Verify the completion summary shows final token/cost/time stats
5. Trigger model escalation and verify per-model breakdown appears
6. Disable the toggle and verify MetricsBar disappears
