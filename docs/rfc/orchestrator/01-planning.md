# RFC 01: Hierarchical Planning System

## Summary

This RFC redefines the `PlanGuardian` into a **Hierarchical Planner**. Instead of a linear list of strings, the planner will output a structured **Task Graph** where tasks can have subtasks, dependencies, and assigned metadata. This allows the Orchestrator to dispatch parallel agents effectively.

## Motivation

The current `PlanGuardian` produces a flat list of strings (`string[]`). This is insufficient for parallel execution because:
1.  **No Dependencies**: We don't know which steps *must* be sequential and which can be parallel.
2.  **No Context**: A string like "Click button" doesn't carry enough context for a fresh agent.
3.  **No Hierarchy**: Complex tasks (e.g., "Research A and B") need recursively nested subtasks.

## Data Structures

### The Task Node

```typescript
interface TaskNode {
  id: string;
  description: string;
  type: "group" | "action"; // Group = container for subtasks, Action = leaf
  status: "pending" | "running" | "completed" | "failed";
  dependencies: string[]; // IDs of tasks that must complete first
  result?: string;
  meta: {
    url?: string; // Context URL for this task
    elementId?: number; // Target element for this task
  };
}
```

### The Plan

```typescript
interface TaskPlan {
  rootId: string;
  tasks: Map<string, TaskNode>;
}
```

## The New Planner

The Planner (Smart Model) will be prompted to produce this graph structure.

### Prompt Strategy

```
User Query: "Solve the 30 challenges on this page."

Planner Output:
{
  "tasks": [
    { "id": "t1", "desc": "Solve Challenge 1", "deps": [] },
    { "id": "t2", "desc": "Solve Challenge 2", "deps": [] },
    ...
  ]
}
```

By specifying `deps: []`, the Planner explicitly signals that `t1` and `t2` are independent. The Orchestrator can then schedule them simultaneously.

### Planning Phases

1.  **Initial Decomposition**: Convert User Query -> Task Plan.
2.  **Dynamic Expansion**: A running agent can report "Tool `batch_execute` failed, need to break this down." The Orchestrator calls the Planner to expand that specific node into sub-nodes.
3.  **Consolidation**: When a group of tasks completes, the Planner (or Orchestrator) summarizes their results into the parent node's result.

## Integration with Orchestrator

The Orchestrator's **Scheduler** loop:
1.  Scan for `pending` tasks where all `dependencies` are `completed`.
2.  Move them to `ready`.
3.  Spawn `AgentLoop` for each `ready` task (up to a concurrency limit).
4.  When `AgentLoop` finishes, mark task `completed`, save result, and repeat loop.

## Migration

1.  **Step 1**: Update `PlanGuardian` to output a simplified JSON with `parallel: boolean` flag.
2.  **Step 2**: Implement the full Graph based Planner.
