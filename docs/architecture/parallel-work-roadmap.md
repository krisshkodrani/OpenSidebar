# First-Class Parallel Work Roadmap

Last updated: 2026-07-24 (roadmap authored 2026-05-15)

> **Status: completed roadmap, kept as historical rationale.** The staged plan
> below has shipped — the "Current Stage" section and the Stage 1 contract
> match the code (`orchestrator/types.ts`, `lane-topology.ts`). Current
> shipped behavior is documented in [Orchestrator](./orchestrator.md); per the
> [docs policy](../docs-policy.md), the staged-planning scaffolding here is a
> candidate for relocation to Notion.

This roadmap defined the path from the earlier functional parallel runtime to first-class parallel work support across the extension, overlay harness, and future headless/mock environments.

## Scope

Parallel work has four product surfaces:

- Turn-level tool parallelism: safe batches of read-only tool calls inside one agent turn.
- Single-task node parallelism: independent orchestrator nodes running at the same time.
- Multi-workspace parallelism: separate user workspaces running independent tasks concurrently.
- Harness and replay parallelism: deterministic validation of concurrent work outside the production Chrome side panel.

First-class support means parallel work is planned intentionally, scheduled safely, visible to the user, traceable after the run, and covered by real browser tests.

## Current Stage

OpenSidebar now has first-class parallel work support for the extension and overlay validation path covered by this roadmap. Rollout remains controlled by lane topology: `simple` and `standard` keep executor nodes serialized, while `full` enables resource-aware node parallelism. The deterministic headless/mock runtime is still a separate future project that should build on the trace/replay contract from this work.

Implemented release gates:

- Planner and repair code annotate nodes with `NodeParallelContract` metadata, resource hints, dependency reasons, and sibling-awareness.
- The orchestrator scheduler uses resource compatibility to overlap independent read-only nodes and serialize conflicting tab, URL, form, cart, record, table, account, external, and approval resources.
- Lane topology remains the rollout control and kill-switch surface for node-level parallel execution.
- Executor instructions include node id, worker index, assigned resources, and sibling summaries without exposing hidden mutable state.
- Tool metadata includes scheduler-facing node-concurrency classifications, with tests that fail when a registered tool lacks coverage.
- Run traces include graph, worker lifecycle, resource wait/lock/release, cancellation, verifier, retry, and lane queue data using environment-neutral fields.
- The side panel and overlay harness render queued, blocked, running, verifying, retrying, completed, failed, skipped, and cancelled worker states through the shared runtime message contract.
- The trace viewer shows worker overlap, queue depth, resource blocks, verifier checks, retries, and integrity diagnostics for missing finishes, orphan locks, and impossible dependency order.
- The focused `parallel-workers` E2E suite proves independent browser-worker overlap, shared-form serialization, and active parallel stop cleanup without ghost state.
- The staged `smoke` E2E gate remains green after the parallel-work changes.

Known follow-ups:

- Run medium and hard staged E2E before making additional default rollout changes.
- Add more active-parallel recovery variants when a stable timeout or lane-isolation fixture exists; the current focused E2E covers user stop during active parallel workers.
- Build the deterministic headless/mock runtime as a separate roadmap item using the graph, resource, worker, tool, and evidence records defined here.
- Keep extending the tool metadata audit as new tools are added.

## Principles

- Preserve the existing small-port architecture. Do not introduce a broad `BrowserAdapter` tree just to support parallelism.
- Keep harnesses thin. Parallel behavior belongs in runtime scheduling, tools, policies, and skills.
- Treat dependencies and resource ownership as execution truth, not prompt decoration.
- Prefer correctness over throughput. A slower serial fallback is better than two workers corrupting one browser state.
- Make concurrent work observable. Every launch, queue, block, retry, cancellation, and completion should be explainable from traces.
- Ship parallel work behind explicit rollout controls. Operators must be able to disable node-level parallelism without reverting code.

## Stage 1: Explicit Parallel Planning Contract And Trace Model

Goal: planner output describes which work can run concurrently and why.

Deliverables:

- Add explicit node-level parallel metadata to the planning contract. The initial shape should be small and structured:

```typescript
type ParallelismHint =
  | "independent"
  | "resource_bound"
  | "serialized"
  | "unknown";

type ResourceAccess = "read" | "write" | "navigate" | "approval" | "external";

type ResourceHint = {
  kind: "tab" | "origin" | "url" | "form" | "record" | "cart" | "table" | "account" | "external";
  key: string;
  access: ResourceAccess;
  confidence: number;
  source: "planner" | "repair" | "runtime";
};

type NodeParallelContract = {
  parallelism: ParallelismHint;
  dependencyReason?: string;
  resourceHints: ResourceHint[];
  siblingAwareness: "none" | "summary" | "coordination_required";
};
```

- Treat `parallelism` as advisory and `resourceHints` as the scheduler input. Missing or low-confidence hints should bias toward serialization.
- Teach plan repair to preserve required ordering for navigation, mutation, checkout, approval, and round-trip tasks.
- Add planner-side or repair-side conservative serialization when two nodes appear to share the same mutable page resource.
- Define the compact trace model before E2E work starts: task graph, node contracts, worker lifecycle, resource waits, resource locks, lane queue events, and dependency edges.
- Update trace events so `plan_decomposed` records the dependency graph, node parallel contracts, and resource hints in a compact, replayable form.
- Update orchestrator docs to describe the graph contract, not just sequential node execution.

Acceptance criteria:

- A multi-target read-only task produces independent runnable nodes when safe.
- A multi-step mutation task remains ordered unless there is clear resource separation.
- Unit tests prove graph construction for independent, dependent, and ambiguous tasks.
- Trace assertions can inspect the planned graph and resource hints without relying on raw logs.
- No fixture-specific wording or benchmark-specific planner hints are required.

## Stage 2: Resource-Aware Scheduling And Executor Coordination

Goal: the scheduler can run independent workers without tab or page-state contamination.

Deliverables:

- Introduce a small resource-lock policy owned by the orchestrator scheduler.
- Track resources such as root tab, worker tab, URL origin, form target, list/table target, and explicit user approval gates.
- Block or serialize nodes that conflict on mutable resources.
- Prefer new worker tabs only when navigation is allowed, worker cap permits it, and shared-tab execution would be unsafe.
- Add cancellation and cleanup rules for sibling workers when a critical lane fails or the task is stopped.
- Reuse the existing lane topology setting as the rollout control rather than adding a second overlapping mode enum:
  - `simple`: one executor worker, no planner decomposition.
  - `standard`: planner decomposition with serialized executor nodes unless resource-aware parallelism is explicitly enabled.
  - `full`: resource-aware parallel executor nodes once scheduler locks are in place.
  - A global developer kill switch should force `standard` or `simple` semantics regardless of stored settings.
- If a separate flag is needed during rollout, make it narrowly scoped, such as `enableResourceAwareNodeParallelism`, and document how it composes with `laneTopologyMode`.
- Audit every tool for node-level coexistence, not just turn-level dispatch. Classify whether it is safe to run concurrently on separate tabs, same origin, same page, or never. Use this audit to refine resource lock defaults.
- Add executor parallel-context briefing. Each worker should know its own node id, worker index, assigned resource, allowed coordination assumptions, and a short summary of sibling workers such as "worker n2 is reading prices in tab B". This must be informational; workers should not depend on hidden shared mutable state.
- Add trace events for `worker_queued`, `worker_started`, `worker_blocked_resource`, `worker_released_resource`, and `worker_cancelled`.

Acceptance criteria:

- Independent read-only nodes run concurrently.
- Mutating nodes that target the same form, cart, record, or current tab serialize.
- Stopping a task reliably stops all active workers.
- Executor lane isolation does not permanently fail runnable nodes when a bounded retry is possible.
- The tool-safety audit has a checked-in contract or metadata source used by scheduler policy.
- The kill switch can disable node-level parallel execution without changing planner behavior or introducing a second topology vocabulary.

## Stage 3: Real Browser Parallel E2E Harness

Goal: prove real parallel work in the browser, not only in unit tests.

Deliverables:

- Add a generic E2E fixture with two or more independent page regions or tabs that can be read in parallel and then summarized.
- Add a mutation-safe fixture where apparent parallel nodes must serialize because they share one form or cart.
- Record active worker count and resource locks as run events.
- Assert from traces that at least two executor workers overlapped for the independent case.
- Assert from traces that shared-resource mutation cases did not overlap.
- Keep validators focused on real user objectives, not internal planner artifacts alone.

Acceptance criteria:

- `test:e2e:easy` or a focused E2E file validates one positive parallel case and one serialization case.
- Trace assertions prove overlap by timestamps, not by guessed summaries.
- Failed E2E runs can identify graph, scheduler, resource-lock, or executor failure from trace events alone.
- The harness only observes and validates; product logic remains in runtime code.

## Stage 4: First-Class Side Panel UX

Goal: users can understand and control parallel work.

Deliverables:

- Show active worker nodes as distinct rows or grouped lanes in the orchestrator progress view.
- Surface queued, blocked, running, verifying, retrying, completed, failed, skipped, and cancelled states.
- Show resource-block reasons in concise status text when a worker is waiting.
- Add task-level controls that apply cleanly to all workers: stop, pause/resume if supported, and approval/clarification handling.
- Ensure workspace switching and overlay mode preserve the same message contract and status semantics.

Acceptance criteria:

- During a parallel run, the side panel makes it clear which nodes are running and which are waiting.
- Stopping the task leaves no ghost worker state in the panel.
- Overlay harness tests cover the visible multi-worker states through runtime messages.

## Stage 5: Trace Viewer And Replay Readiness

Goal: parallel runs are debuggable and eventually replayable.

Deliverables:

- Build on the Stage 1 trace model for workers, lanes, resources, and dependencies.
- Display worker overlap, lane queue depth, resource blocks, verifier calls, and retries in the trace viewer.
- Keep replay data environment-neutral: tool calls, observations, labels, evidence, resources, and dependencies should not require Chrome tab IDs.
- Add trace checks that detect missing worker finish events, orphan resource locks, and impossible dependency ordering.

Acceptance criteria:

- A parallel run can be inspected without reading raw logs.
- Trace diagnostics can explain whether a failure was planner graph, scheduler resource policy, tool runtime, verifier, or harness validation.
- Replay-facing records avoid Chrome-only fields except in diagnostics.

## Stage 6: Overlay And Headless Parity

Goal: preserve the path to non-production validation without turning this roadmap into a full mock-runtime project.

Deliverables:

- Extend the overlay runner page-port enough to seed multiple page resources and observe worker/resource trace messages.
- Define the minimal replay contract needed to run the same graph in extension, overlay, and headless/mock contexts.
- Identify the deterministic mock runtime as a separate follow-up roadmap, with clear input/output contracts from this work.

Acceptance criteria:

- Overlay tests can validate multi-worker UI and trace message handling without Chrome extension APIs.
- The replay contract names the task graph, resource hints, worker events, and tool/evidence records needed for a future mock runtime.
- Any missing production-only behavior is explicit and documented.

## Stage 7: Release Gates For First-Class Support

Goal: define the product bar for calling parallel work first-class.

Deliverables:

- Planning: independent work is represented as an explicit dependency graph with resource hints.
- Scheduling: resource conflicts are serialized and safe work overlaps.
- Tools: parallel tool batches remain limited to safe read-only work unless a stronger per-tool contract exists.
- UI: users can see and stop concurrent workers without ambiguity.
- Traces: overlapping workers and resource blocks are visible and diagnosable.
- E2E: at least one generic browser E2E proves overlap, and one proves safe serialization.
- Stability: staged E2E has no known parallelism-caused ghost sessions, orphan workers, or tab contamination.

Acceptance criteria:

- All release gates above are covered by tests, trace assertions, or documented manual checks.
- ~~The default rollout mode is conservative until E2E and trace viewer support are stable.~~ Superseded: with the release gates green, `resolveLaneTopology` now defaults to `full` (resource-aware node parallelism ON) when no mode is set (`lane-topology.ts`); `simple`/`standard` remain the serialized fallbacks and the kill switch stays available.

## Test Coverage Matrix

This matrix is the minimum coverage bar for first-class parallel work. It should be updated when implementation reveals a new failure mode.

| Layer | Required coverage | Success signal |
| --- | --- | --- |
| Planner contract unit tests | `NodeParallelContract` generation for independent read tasks, ordered mutation tasks, ambiguous shared-resource tasks, and repaired round-trip plans | The dependency graph, `parallelism`, `resourceHints`, and serialization bias match expectations without prompt-specific fixtures |
| Scheduler unit tests | Resource lock acquisition/release, blocked-resource queueing, serialized same-resource mutations, independent worker overlap, cancellation, lane isolation retry, and kill-switch fallback | Workers overlap only when resource-compatible; all locks release on completion, failure, stop, and timeout |
| Tool-safety tests | Metadata/audit coverage for every registered tool, including separate-tab, same-origin, same-page, and never-concurrent classifications | Scheduler policy rejects unsafe coexistence and the audit fails when a tool lacks a concurrency classification |
| Executor-context tests | Parallel worker instructions include node id, worker index, assigned resources, and sibling summaries without exposing mutable shared state | Executors receive enough coordination context while remaining independently executable |
| Trace contract tests | `plan_decomposed`, worker lifecycle, resource wait/lock, lane queue, verifier, retry, and cancellation events are emitted with environment-neutral fields | Trace assertions can reconstruct graph order, worker overlap, and blocked-resource reasons without raw logs |
| Trace viewer tests | Timeline rendering for overlapping workers, lane queue depth, resource blocks, retries, and cancellation | A failed parallel run can be diagnosed visually from trace viewer data |
| Generic E2E positive case | Real browser task with two or more independent read targets or tabs | Trace timestamps prove at least two executor workers overlapped and the user objective succeeds |
| Generic E2E serialization case | Real browser task where apparent parallel nodes share a mutable form, cart, record, or current tab | Trace timestamps prove conflicting workers did not overlap and the user objective succeeds |
| Stop/recovery E2E | Stop, timeout, or lane isolation during active parallel workers | No ghost workers, orphan locks, stuck tab state, or stale side panel status remain |
| Overlay harness tests | Multi-worker UI states and trace/resource messages through the overlay `UiRuntimePort` path | Overlay and side panel render the same queued, running, blocked, completed, failed, and cancelled states |
| Staged regression checks | Focused parallel E2E plus staged `easy` before broader suites | No staged regression from parallel defaults, kill-switch behavior, or trace schema changes |

## Recommended Follow-Ups

1. Broaden staged regression runs through `interaction-regression` and `runtime-regression` before making additional default rollout changes.
2. Add timeout and lane-isolation variants to the active-parallel recovery E2E coverage once those failure modes have deterministic fixture triggers.
3. Extract the deterministic headless/mock runtime plan from the replay contract documented here.
4. Keep the tool concurrency metadata audit mandatory for every new registered tool.

## Non-Goals

- Do not add benchmark-specific parallel branches.
- Do not use hidden fixture selectors to make parallel E2E pass.
- Do not parallelize high-risk mutation tools by default.
- Do not replace the existing UI runtime and background environment ports with a speculative adapter hierarchy.
