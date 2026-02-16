# RFC-C: Concurrent Executors — Multiple Fast Models with Independent Agency

## Summary

The BRAINS (smart model) acts as an **orchestrator** that decomposes work into independent sub-goals. Multiple HANDS (fast model instances) execute concurrently, each with their own context fork and full LLM agency. The orchestrator merges results and coordinates when sub-goals complete.

## Motivation

Many real tasks have inherent parallelism that a single serial executor wastes:

- **Form with independent sections**: shipping address + billing address + payment — 3 independent areas
- **Data extraction**: read price from element A + read title from element B + read rating from element C
- **Multi-element interaction**: expand 3 accordion sections simultaneously
- **Verification**: check header shows X AND footer shows Y AND sidebar shows Z

A single fast model handles these sequentially (~3x slower than necessary). With concurrent executors, wall time drops to max(subtask_time) instead of sum(subtask_time).

## Design

### Architecture: Fork-Execute-Merge

```
BRAINS (orchestrator)
  │
  ├── analyzes page, identifies independent sub-goals
  ├── forks context into N lightweight copies
  │
  ├── HANDS-1 (fast model) ──→ sub-goal A ──→ result A
  ├── HANDS-2 (fast model) ──→ sub-goal B ──→ result B
  └── HANDS-3 (fast model) ──→ sub-goal C ──→ result C
  │
  └── merges results, updates plan, continues
```

### New Concept: `ExecutorPool`

```typescript
class ExecutorPool {
  private executors: Map<string, Executor> = new Map();
  private maxConcurrent: number;
  private llmClient: LLMClient;

  /** Fork context and spawn a new executor for a sub-goal */
  async spawn(subGoal: string, context: ContextFork): Promise<ExecutorHandle> {
    const executor = new Executor(this.llmClient, context, subGoal);
    this.executors.set(executor.id, executor);
    return executor.start();
  }

  /** Wait for all executors to complete (or timeout) */
  async awaitAll(timeoutMs: number): Promise<ExecutorResult[]> {
    return Promise.all(
      [...this.executors.values()].map(e => e.awaitResult(timeoutMs))
    );
  }
}
```

### New Concept: `ContextFork`

A lightweight snapshot of the conversation state, NOT a full copy:

```typescript
interface ContextFork {
  /** Shared (read-only): system prompt, snapshot, plan status */
  readonly systemPrompt: string;
  readonly snapshot: DomSnapshot;
  readonly planStatus: PlanStatus | null;

  /** Forked (per-executor): independent message history */
  history: LLMMessage[];

  /** Sub-goal this executor is working on */
  subGoal: string;

  /** Max turns this executor can run */
  maxTurns: number;
}
```

The key insight: **snapshot and system prompt are shared read-only**, only the message history is forked. This keeps memory usage low.

### New Concept: `Executor`

Each executor is a **mini agent loop** — it can make LLM calls and execute tools independently:

```typescript
class Executor {
  private id: string;
  private context: ContextFork;
  private llm: LLMClient;
  private subGoal: string;
  private turns: number = 0;
  private maxTurns: number;

  async start(): Promise<ExecutorResult> {
    // Mini agent loop: LLM → tool → LLM → tool → done
    while (this.turns < this.maxTurns) {
      this.turns++;
      const response = await this.llm.completeStream({
        messages: this.buildPrompt(),
        tools: this.getAllowedTools(), // Subset: no navigate, no done, no escalate
        max_tokens: 2048, // Smaller budget than main loop
      });

      if (response.tool_calls.length === 0) {
        // Text response = executor thinks it's done
        return { id: this.id, success: true, summary: response.content };
      }

      // Execute tools (only DOM-safe, non-navigating tools)
      for (const tc of response.tool_calls) {
        const result = await toolRegistry.execute(tc, this.tabId, this.signal);
        this.context.history.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
    }
    return { id: this.id, success: false, summary: "Turn limit reached" };
  }
}
```

### New Tool: `dispatch`

The orchestrator (smart model) calls `dispatch` to spawn concurrent executors:

```json
{
  "name": "dispatch",
  "arguments": {
    "executors": [
      {
        "sub_goal": "Fill the shipping address section: name=John, street=123 Main, city=NYC, zip=10001",
        "max_turns": 3,
        "tools": ["type_text", "click_element", "select_option"]
      },
      {
        "sub_goal": "Fill the payment section: card=4111111111111111, exp=12/27, cvv=123",
        "max_turns": 3,
        "tools": ["type_text", "click_element"]
      },
      {
        "sub_goal": "Check the 'same as shipping' checkbox for billing address",
        "max_turns": 1,
        "tools": ["click_element"]
      }
    ]
  }
}
```

### Execution Flow

```
Turn 1 (BRAINS): reads page → calls dispatch([shipping, payment, billing])
  │
  ├── Executor A: type_text(name) → type_text(street) → type_text(city) → done (2 turns)
  ├── Executor B: type_text(card) → type_text(exp) → type_text(cvv) → done (2 turns)
  └── Executor C: click_element(checkbox) → done (1 turn)
  │
  Wall time: max(A, B, C) = 2 turns ≈ 1.5s
  Sequential would be: A + B + C = 5 turns ≈ 4s

Turn 2 (HANDS): sees merged results → clicks Submit → continues plan
```

### DOM Conflict Resolution

Multiple executors touching the same DOM is the primary challenge:

**Strategy: Element-Level Locking**

```typescript
class DomLock {
  private lockedElements: Map<number, string> = new Map(); // tagId → executorId

  acquire(tagId: number, executorId: string): boolean {
    if (this.lockedElements.has(tagId)) return false; // Already locked
    this.lockedElements.set(tagId, executorId);
    return true;
  }

  release(executorId: string): void {
    for (const [tagId, owner] of this.lockedElements) {
      if (owner === executorId) this.lockedElements.delete(tagId);
    }
  }
}
```

Before executing a tool on an element, the executor acquires a lock on that tag ID. If another executor holds the lock, the tool is queued until the lock is released.

**Why this works:** Independent form sections use different elements. Shipping fields don't overlap with payment fields. The orchestrator's job is to dispatch sub-goals that target non-overlapping element sets.

**Fallback:** If lock acquisition fails after 500ms, the executor bails and reports the conflict. The orchestrator falls back to sequential execution for the conflicting sub-goal.

### Snapshot Management

**Problem:** Multiple executors modify the DOM concurrently. A single snapshot becomes stale.

**Solution: Deferred Snapshot**

```
1. All executors share the INITIAL snapshot (read-only)
2. Executors don't refresh snapshots — they use element IDs from the initial snapshot
3. After ALL executors complete, ONE snapshot refresh happens
4. Stale element recovery handles IDs that shifted during execution
```

This mirrors the current parallel-tool-execution design (one refresh after all tools complete).

### LLM Client Isolation

**Problem:** ProviderPool has race conditions under concurrent access.

**Solution: Per-executor request serialization via semaphore**

```typescript
class LLMSemaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(maxConcurrent: number) {
    this.permits = maxConcurrent;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise(resolve => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.permits++;
  }
}
```

Set `maxConcurrent = 2` — at most 2 LLM calls in flight simultaneously. This:
- Prevents provider pool race conditions (only 2 concurrent getActive() calls)
- Limits rate limit consumption (2x instead of Nx burst)
- Still provides meaningful parallelism (2 executors progress simultaneously)

### Allowed Tools Per Executor

Executors get a **restricted tool set** — no state-changing or context-switching tools:

| Allowed | Blocked |
|---------|---------|
| click_element | navigate |
| type_text | done |
| select_option | escalate |
| scroll_page | update_plan |
| press_key | create_tab / close_tab / switch_tab |
| read_page | execute_js |
| find_element | batch_execute |
| hide_element | take_screenshot |
| read_element | dispatch (no recursive spawning) |
| hover_element | |
| drag_and_drop | |

### Result Merging

After all executors complete, results are merged into the main context:

```typescript
const mergedMessage = executorResults.map(r =>
  `[Executor ${r.id} — ${r.subGoal}]: ${r.success ? r.summary : `FAILED: ${r.summary}`}`
).join("\n\n");

this.context.addMessage({
  role: "tool",
  tool_call_id: dispatchToolCall.id,
  content: mergedMessage,
});
```

The main agent loop sees one tool result containing all executor outcomes.

### Integration with BRAINS→HANDS

```
Turn 0:  Guardian decomposes (smart model)
Turn 1:  BRAINS reads page → calls dispatch([...3 sub-goals...])
         Executors run concurrently (2-3 fast model turns each)
Turn 2:  HANDS (fast model) sees merged results → continues plan
Turn 3+: HANDS continues, may call dispatch again for more parallel work
```

### Error Handling

- **Executor timeout**: Each executor has a turn limit (default 3). If exceeded, executor returns partial results.
- **Tool error**: Executor catches the error, adds it to its result, continues with remaining steps (or bails).
- **All executors fail**: The dispatch tool returns all failure messages. Main loop's existing stuck detection kicks in.
- **Abort signal**: Shared across all executors. User pressing Stop kills everything immediately.
- **Provider 429**: Semaphore limits concurrent LLM calls. On 429, executor retries via existing fetchWithRetry.

## Implementation Complexity

| Component | Change | Effort |
|-----------|--------|--------|
| `types/index.ts` | `ContextFork`, `ExecutorResult`, `ExecutorHandle` types | Low |
| `agent/executor.ts` | **New file**: `Executor` class (mini agent loop) | High |
| `agent/executor-pool.ts` | **New file**: `ExecutorPool`, `DomLock`, `LLMSemaphore` | High |
| `tools/index.ts` | Register `dispatch` tool | Low |
| `loop.ts` | Intercept dispatch tool, spawn executors, merge results | Medium |
| `metadata.ts` | Add dispatch to sequential tools, define allowed executor tools | Low |
| `constants.ts` | `MAX_EXECUTORS: 3`, `EXECUTOR_MAX_TURNS: 3`, `LLM_CONCURRENCY: 2` | Trivial |

**Total effort: ~3-4 sessions.** Requires 2 new files, significant new logic.

## Risks

- **DOM conflicts**: Even with element-level locking, CSS layout changes from one executor can affect another's elements
- **Rate limits**: 2-3 concurrent LLM calls consume provider quota faster, potentially triggering more failovers
- **Context coherence**: Executors don't see each other's actions — if executor A types in a field that makes executor B's target disappear, B fails
- **Debugging complexity**: Interleaved executor logs are harder to trace than serial execution
- **Cost**: More LLM calls per task (each executor runs its own LLM loop)
- **Diminishing returns**: Most tasks have limited parallelism — only 2-3 truly independent sub-goals at any given moment
