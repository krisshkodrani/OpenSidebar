# RFC 02: Context & Memory Efficiency

## Summary

This RFC defines a memory management strategy for parallel agents to minimize latency and memory usage. It introduces **Context Forking** to share static data and **Episodic Session Memory** to prevent database pollution and reduce I/O overhead.

## Motivation

Running 30 concurrent agents presents two scaling challenges:
1.  **Memory Footprint**: 30 `ContextManager` instances, each with a 32k token window, consume ~1GB+ of RAM if fully populated.
2.  **Database Contention**: 30 agents reading/writing to the single SQLite/Vector DB simultaneously will cause locking and latency.

## Design

### 1. Context Forking (`SharedContext`)

Start with a shared, immutable context object.

```typescript
class SharedContext {
  readonly systemPrompt: string;       // ~1k tokens
  readonly initialSnapshot: DomSnapshot; // ~5k tokens
  readonly userGoal: string;           // ~50 tokens
  readonly embeddingWorker: Worker;    // Shared embedding worker
}

class AgentContext {
  private shared: SharedContext;
  private history: LLMMessage[] = []; // Only the forked history

  getPrompt(): LLMMessage[] {
    return [
      { role: "system", content: this.shared.systemPrompt },
      { role: "user", content: this.shared.userGoal },
      ...this.history
    ];
  }
}
```

By referencing the `SharedContext`, we save ~6k tokens (approx 24KB strings) per agent. For 30 agents, that's ~720KB saved. Not huge, but significant for garbage collection churn.

### 2. Session Memory (Episodic Buffer)

**User Requirement**: "Load at URL load and save at task finish."

**Strategy**:
1.  **Load Phase (Pre-fetch)**: When a Task starts for a URL, the Orchestrator performs **one** Vector Search for relevant rules/memories for that domain.
    *   *Result*: A list of "Relevant Memories".
    *   *Action*: Inject these into the `SharedContext`. All 30 agents see them without hitting the DB again.

2.  **Execution Phase (Buffer)**: Agents do *not* write to the specific Vector DB directly. They emit `memory_add` tool calls, which are buffered in the `AgentLoop`.

3.  **Commit Phase (Write-Back)**:
    *   If the Subtask **Succeeds**: The Orchestrator collects the buffered memories and commits them to the global Vector DB.
    *   If the Subtask **Fails**: The buffered memories are discarded. This keeps the long-term memory clean of "hallucinations from failed attempts."

### 3. Offscreen Document Optimization

The explicit `offscreen` document for memory (`src/offscreen/memory`) is good, but:
*   **Keep Alive**: Ensure the offscreen document is not terminated aggressively.
*   **Batching**: The Orchestrator should batch "Commit" operations. Instead of 30 distinct `add` calls, send one `batch_add` message to the worker.

## Implementation Plan

1.  **Refactor Context**: Extract `SharedContext` interface.
2.  **Update Orchestrator**: Implement the "Pre-fetch" logic (Search once -> Pass to all).
3.  **Update AgentLoop**: Buffer `memory_add` calls instead of executing immediately (transactional memory).
