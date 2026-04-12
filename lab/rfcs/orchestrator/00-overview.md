# RFC 00: Orchestrator Architecture Overview

## Summary

This RFC introduces the **Orchestrator**, a high-level supervisor responsible for managing the lifecycle of complex user tasks. The Orchestrator decomposes tasks into subtasks, spawns concurrent `AgentLoop` instances ("Workers") to execute them, and aggregates results. This architecture enables the **Parallel Task Execution** required for high-throughput challenges and moves OpenSidebar towards a true Multi-Agent System.

## Motivation

Currently, OpenSidebar uses a single `AgentLoop` that handles everything sequentially. This has critical limitations:
1.  **Throughput**: Solving 30 sub-challenges takes 30x the time of one.
2.  **Context Window**: Long-running tasks fill the context window with successful *and* failed steps, degrading performance.
3.  **Specialization**: The same agent loop tries to be a planner, researcher, and clicker.

## Architecture

### The Orchestrator

The `Orchestrator` is a singleton service in the background script. It does *not* interact with the DOM directly. Its job is **Task Management**.

```typescript
class Orchestrator {
  private activeTasks: Map<string, Task>;
  private workers: Map<string, AgentLoop>;

  async startTask(userQuery: string, initialTabId: number) {
    // 1. Plan
    const plan = await this.planner.decompose(userQuery);
    
    // 2. Execute
    await this.executePlan(plan, initialTabId);
  }
}
```

### The Worker (`AgentLoop`)

The existing `AgentLoop` becomes a **Worker**. It is spawned by the Orchestrator with a specific, scoped goal (a Subtask).
-   **Focus**: Executes *one* subtask at a time.
-   **Lifespan**: Ephemeral. Created for a subtask, destroyed (or reset) when done.
-   **Context**: Starts fresh for each subtask (or with a minimal context fork), keeping the window clean.

### Task Lifecycle

1.  **Decomposition**: The Orchestrator uses a **Planner** (Evolved `TaskPlanner`) to break the user query into a `Plan` consisting of `Subtasks`.
2.  **Dispatch**: The Orchestrator identifies independent subtasks (e.g., "Solve Challenge 1", "Solve Challenge 2") and spawns multiple Workers.
3.  **Execution**: Workers run in parallel (on different tabs or the same tab with specialized locking).
4.  **Aggregation**: Workers report success/failure back to the Orchestrator.
5.  **Completion**: When all subtasks are done, the Orchestrator synthesizes the final answer.

## Key Concepts

### 1. Parallel Execution (The "Simple Path")
The immediate goal is to run multiple `AgentLoop` instances.
-   **Tab-per-Worker**: Ideally, each Worker operates on its own tab (e.g., cmd+click 30 links -> 30 tabs -> 30 agents).
-   **Shared-Tab**: If operating on one page, Workers must use the `DomLock` mechanism (detailed in RFC-C) to prevent conflicting interactions.

### 2. Context Isolation
Each Worker has its own `ContextManager`. This isolates failures. If Worker A fails subtask A, its verbose error logs don't pollute the context of Worker B.

### 3. Memory Management
(Detailed in RFC 02)
-   **Read-Only Shared Context**: System prompts and initial snapshots are shared to save memory.
-   **Episodic Memory**: Workers write to a temporary "Session Memory". Only on successful task completion is this committed to Long-Term Memory (Vector DB).

## Migration Strategy

1.  **Phase 1 (The Challenge Requirement)**: Implement `Orchestrator` capable of spawning multiple `AgentLoop` instances. Implement simple "fork-join" parallelism.
2.  **Phase 2**: Refactor `TaskPlanner` to support hierarchical plans (RFC 01).
3.  **Phase 3**: Optimize memory usage with Context Forking (RFC 02).

## Next Steps

-   RFC 01: Hierarchical Planning System
-   RFC 02: Context & Memory Efficiency
