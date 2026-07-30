# Orchestrator

The orchestrator manages multi-step task execution. When a user submits a task, the orchestrator decides whether it needs decomposition and, if so, plans, executes, and verifies each step.

## When It Activates

The planner (`TaskPlanner.decompose()`) classifies every task:

- **Simple tasks** — single-step, run directly by the agent loop
- **Multi-step tasks** — decomposed into nodes, each executed by its own agent loop instance

Multi-step triggers: distinct phases (navigate then fill), multiple targets (add item A and item B), round-trips (go forward then return), or explicit numbered steps.

## Components

```
src/background/orchestrator/
  index.ts       — Main scheduler: node execution, verification, replanning
  planner.ts     — OrchestratorPlanner: wraps TaskPlanner, builds TaskNodes
  verifier.ts    — OrchestratorVerifier: programmatic + LLM verification
  handoff.ts     — Context formatting between nodes (briefs, reflexion, evidence)
  contracts.ts   — Tool profiles and execution constraints per node
  parallel-contract.ts — Node parallel/resource contracts and trace graph shaping
  scheduling.ts  — Dependency resolution, runnable node selection
  retry-policy.ts — Retry/reroute decisions after verification failure
  types.ts       — TaskNode, OrchestratorTask, handoff types
```

The directory holds ~44 modules in total. Beyond the core files above, the
scheduler's state maps live behind small **controller classes** (extracted in
LP-16 Phase 5): `recent-completion-tracker.ts`, `pending-feedback-queue.ts`,
`completion-waiter-registry.ts`, `pending-interaction-timers.ts`,
`budget-estimator-registry.ts`, `pending-resolver-registry.ts`,
`lane-registry.ts`, `workspace-registry.ts` — the orchestrator composes them
and owns no raw per-workspace `Map` fields. Pure helpers are split out the same
way (`navigation-goal-heuristics.ts`, `plan-state.ts`,
`completion-envelope-verification.ts`, `node-heuristics.ts`), lanes live in
`lane-topology.ts` / `lane-supervisor.ts`, and the skills stack is
`skills.ts` + `skill-types.ts` + `skill-catalog.ts` + `skill-bodies.ts`.

## Execution Flow

```
User query
  → TaskPlanner.decompose() → steps + difficulty
  → repairPlanCoverage() → adds missing return/read steps
  → stepsToNodes() → TaskNode[] with dependencies
  → Plan confirmation (user reviews before execution)
  → Scheduler loop:
      For each runnable node:
        1. Build executor instruction (objective, criteria, handoff context)
        2. Spawn AgentLoop instance for this node
        3. Agent executes (observe → think → act → done)
        4. Programmatic verification (token matching, URL/title change)
        5. If ambiguous → LLM verifier (accept/retry/reroute)
        6. On accept → mark complete, advance to next node
        7. On retry → re-run with reflexion context
        8. On reroute → create new node with revised objective
  → Aggregate results from all completed nodes
  → Emit TASK_COMPLETION to side panel
```

## Task Nodes

Each node is a self-contained sub-task. Abridged shape (the full interface in
`orchestrator/types.ts` adds role/labels, skill selection, tool profile,
verification gate, retries, trajectory, and partial-handoff fields):

```typescript
interface TaskNode {
  id: string;
  description: string; // "Add Trabuco Max 3 to cart"
  successCriteria: string; // "Cart shows Trabuco Max 3, quantity 1"
  allowedTools: ToolName[]; // Tool profile for this node
  dependencies: string[]; // Node IDs that must complete first
  assumptions: string[]; // Planner's expectations about page state
  parallelContract?: NodeParallelContract; // Parallelism hint + resource ownership
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: string; // Done summary from executor
  handoffArtifacts: NodeHandoffArtifact[];
  reflexionLog: ReflexionEntry[];
}
```

Nodes execute sequentially by default unless the plan or repair layer can identify independent read-only targets. Each node may carry a `NodeParallelContract` with a `parallelism` hint, resource hints, dependency reason, and sibling-awareness level. The scheduler treats those hints conservatively: dependency ordering still wins, mutable or ambiguous shared resources serialize, and resource wait/start/release events are written to run traces.

Tool-level node coexistence is audited in `tools/metadata.ts` and summarized by tool profile when the repair layer derives resource access. Executor instructions include a compact parallel work context with the worker index, assigned resources, and environment-neutral sibling summaries.

`plan_decomposed` run-trace events include a compact graph with node IDs, dependency edges, parallel contracts, and resource hints so trace assertions can inspect the planned graph without parsing raw logs. Worker lifecycle events also include active worker counts and resource-lock snapshots; trace-viewer integrity checks detect missing worker finishes, orphan resource locks, and dependency-order violations. The trace viewer Plan tab summarizes worker overlap, queued work, resource blocks, verifier checks, and retry events from the same run trace stream.

Focused browser coverage for this contract lives in `apps/extension/tests/e2e/parallel-work.test.ts` and is wired as the `parallel-workers` E2E focus suite. It uses the generic `parallel-work` fixture plus timestamp-based run-trace helpers to assert independent read overlap, shared-form serialization, and stop cleanup during active parallel work.

## Plan Repair

`repairPlanCoverage()` in `agent/task-contract.ts` (note: the `agent/`
directory, not `orchestrator/`) patches common planner gaps:

- **Missing return leg** — if the query says "go back to X" but no step explicitly returns to X, a return node is added
- **Missing report targets** — if the query says "report both X and Y" but a target has no read step, one is added

The repair uses semantic matching: it checks for explicit "return to X" or "back to X" in step objectives, not bare string inclusion. This prevents "Navigate FROM Alpha" from falsely satisfying a "return TO Alpha" check.

## Verifier

After each node completes, the verifier decides: accept, retry, or reroute.

**Programmatic verification** (fast, no LLM call):

- Success/error markers in executor output
- URL or title changed (DOM mutation evidence)
- Goal token overlap between output and criteria

**LLM verification** (when programmatic is ambiguous):

- Verifier LLM receives: node objective, success criteria, executor output, handoff context
- Prompt explicitly says: "Judge ONLY the Objective and Success criteria — NOT the overall Task"
- The full task query is provided as background context only

This scoping prevents false retries where the verifier rejects a node because the overall task isn't done yet.

## Global Goal Gate

An optimization that skips the last remaining node when its success criteria are already satisfied on the page. Constraints:

- Only fires when exactly 1 pending node remains
- Must pass task contract coverage check
- Blocked for round-trip and multi-obligation tasks

A separate, earlier **Navigation Goal Gate**
(`assessNavigationGoalCompletion` + `navigation-goal-heuristics.ts`) can skip
pure-navigation goals that are already satisfied; it has its own, narrower
constraints.

## Sub-Node Scoping

When the agent loop runs as an orchestrator sub-node (`this.nodeId` is set):

- **`validateDone` is skipped** — the orchestrator's verifier handles completion checking. Running validateDone against the full original query would reject correct node completions.
- **`countExplicitSteps` is skipped** — the original query may have 5 numbered steps, but the sub-node only handles 1.
- **`taskContractGuard` is skipped** — entity coverage is checked at the orchestrator level, not per-node.

## Handoff Context

Between nodes, the orchestrator builds handoff context:

- **Completed steps summary** — what prior nodes achieved
- **Reflexion log** — failures, retries, and lessons from prior attempts
- **Assumption drift signal** — checks planner assumptions against current page state
- **Handoff artifacts** — structured evidence from each phase (planner, executor, verifier)

This context is injected into the executor instruction so each node builds on prior work.

## Key Design Decisions

1. **Planner plans, executor executes** — the planner never calls tools directly. It produces a plan, the executor runs it.
2. **Nodes are isolated** — each node gets its own agent loop with fresh state. Cross-node context comes through handoff, not shared memory.
3. **Verification is scoped** — the verifier checks the node objective, not the full task. Partial progress is expected.
4. **Repair over rejection** — when the planner misses a step, `repairPlanCoverage` adds it rather than failing the decomposition.
