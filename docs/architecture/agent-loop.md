# Agent Loop

The agent loop is the core orchestration engine that runs in the service
worker. It manages the Think → Act → Observe cycle: calling the LLM, executing
tools, and deciding when the task is done.

**Location:** `apps/extension/src/background/agent/`

Since RFC LP-15 Phase 11 / RFC LP-16, the loop is not a monolith: `loop.ts`
hosts the `AgentLoop` class, but each turn runs as an **explicit state machine
of ordered phases**, and most behavior lives in extracted modules around it.
`loop.ts` is guarded by the decomposition ratchet
(`node scripts/loop-ratchet.mjs --report`) — trust the ratchet over any size
numbers quoted in prose.

## The turn state machine

`agent/turn-machine.ts` defines the vocabulary; `loop()` is a thin driver that
executes the phases in canonical order each iteration:

```
gates → escalation → feedback → prepare_model_turn → dispatch_tools
      → post_tool_guards → plan_monitor → completion → account_and_refresh
```

Each phase is a free function in `agent/turn-phases/` (eleven modules — the
phases above plus `prepare-turn-context`, and `text-response` for the
no-tool-calls branch). A phase returns a `TurnPhaseResult` union instead of
raw control flow:

- `continue` — advance to the next phase
- `next_turn` — abandon remaining phases, start the next while-iteration
- `end_turn` — stop this turn's phase sequence
- `end_task` — terminate the loop with a `LoopResult`

A pinning test guards the invariant that `account_and_refresh` runs strictly
after `completion`. If the model returns text with no tool calls, the turn runs
the `text_response` phase (reflection → escalate → give-up) instead of the
dispatch/guards/completion chain.

### State layering

Turn state is homed into explicit bags with distinct lifetimes
(`agent/loop-scope.ts` and `agent/turn-state.ts`):

- **`LoopSession`** — session-scoped, persists across turns: `tabId`,
  previous element count, done summary, plan index.
- **`TurnScope`** — turn-scoped, constructed fresh each iteration: done
  signal, DOM/visual-modification flags.
- **`TurnState`** — run-scoped accumulators: tool-failure counts,
  recent-success and recent-tool-call windows, discovered tag IDs.
- **Escalation controller** — built per run by `createTurnController`
  (`agent/turn-controller.ts`), owns the two-tier escalation state and the
  working-memory reset closures shared by phases.

### The dispatch-host idiom

Phases never receive the whole `AgentLoop`. Each declares a narrow
`XxxPhaseHost` interface of exactly the members it needs, and the driver calls
`runXxxPhase(this as unknown as XxxPhaseHost, deps)`. Extracted method
clusters follow the same pattern (`done-plan-rejection.ts`,
`done-plan-validation.ts`, `completion-evidence.ts`, `turn-checkpoint.ts`,
the ServiceNow controllers in `agent/servicenow/`), with `loop.ts` keeping
thin delegator methods so call sites stay stable.

## Key modules

| Module                                                                                   | Purpose                                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `loop.ts`                                                                                | `AgentLoop` class: lifecycle, the `loop()` driver, delegators             |
| `turn-machine.ts` / `turn-phases/`                                                       | Phase vocabulary and the eleven phase implementations                     |
| `loop-scope.ts`, `turn-state.ts`, `turn-controller.ts`                                   | Session/turn/run state bags + escalation controller                       |
| `parallel-tool-dispatch.ts`, `sequential-tool-dispatch.ts`, `parallel-tool-execution.ts` | Tool dispatch strategies                                                  |
| `completion/`                                                                            | The completion authority (see below)                                      |
| `completion-kernel.ts`                                                                   | Pure completion-contract evaluation kernel                                |
| `context.ts`                                                                             | `ContextManager` — conversation history, sliding window                   |
| `planner.ts`                                                                             | `TaskPlanner` — decomposition and plan validation                         |
| `stagnation.ts`                                                                          | `StagnationMonitor` — stuck detection via snapshot fingerprinting         |
| `escalation-tier-controller.ts`, `escalation-rescue-policy.ts`                           | Two-tier escalation + rescue policy                                       |
| `checkpoint-coordinator.ts`, `turn-checkpoint.ts`                                        | Turn checkpoints (save/restore/clear)                                     |
| `approval-policy.ts`, `approval-enforcement.ts`, `consequential-action-policy.ts`        | High-risk action approval gating                                          |
| `mutation-ledger.ts`, `evidence.ts`, `verification.ts`                                   | State-diff verification evidence                                          |
| `partial-progress-handoff.ts`                                                            | Structured handoff when the turn budget runs out                          |
| `loop-skill-tools.ts`, `skill-turn-cap-policy.ts`                                        | Skill-scoped tool ranking/suppression                                     |
| `servicenow/`                                                                            | Quarantined ServiceNow domain controllers                                 |
| `tool-recovery.ts`                                                                       | Recover tool calls from plain-text LLM responses                          |
| `trace.ts`                                                                               | `TraceRecorder` — full-fidelity session recording (dev-only)              |
| `constants.ts`                                                                           | Centralized thresholds and limits — source of truth for the numbers below |

Many small `*-policy.ts` modules (blind-tool-call, repeat-action,
ambiguous-choice, navigate-guard, popup-triage, …) hold single behaviors;
prefer extending those over adding logic to `AgentLoop`.

## AgentLoop public API

```typescript
class AgentLoop {
  start(initialUserText, tabId, initialSnapshot?, options?): Promise<LoopResult>;
  stop(): void;                      // aborts via AbortController
  resumeFromNavigation(...): ...;    // navigation-bridge re-entry
  pause(): void;                     // promise-gate; loop awaits at gates phase
  resume(): void;                    // resolves the pause gate
  isPaused(): boolean;
  injectFeedback(text: string): void;
  getCurrentTurn(): number;
  getOriginalQuery(): string;
  getStagnationMonitor(): StagnationMonitor;
}
```

## Completion: one authority

"Is the task done?" is decided in exactly one place: the pure pipeline in
`agent/completion/pipeline.ts`. The kernel (`completion-kernel.ts` plus the
per-contract-kind analysis modules under `completion/`) decides accept/reject
first; the absorbed pre-pipeline guard chain runs as ordered stages after it.
The pipeline returns a verdict plus **effects-as-data**, applied by the loop
via the completion-effect host — rejection bookkeeping, diagnostics, and plan
rejection all flow through effects, never inline mutation. Supporting pieces:
guard suite (`completion/guards/` — budget, contract, domain, summary,
grounding), judge gate (`completion/judge.ts`, dedicated judge model seat),
entailment gate, preflight, and decision recording.

The golden corpus in `tests/fixtures/completion-corpus/` must replay
byte-identical; regenerate with `UPDATE_COMPLETION_CORPUS=1` only for an
intended semantic change.

## Escalation and orientation

The system runs two tiers — executor (tier 0) and planner (tier 1) — under
`escalation-tier-controller.ts`. Runs open in a short **plan-then-act
orientation phase** on the planner tier before handing off to the executor
(skipped when `preferredModelTier` is `"executor"`). Escalation back to the
planner is driven by the escalation-rescue policy (fail-fast or
replan/strategy-pivot on no verified progress), with progress-gated
de-escalation and cooldowns (`ESCALATION_RESCUE` in `constants.ts`). Context
distillation (`summarizeTrajectory()`) compresses history into a structured
timeline before planner handoff.

## Context management

`ContextManager` (`context.ts`) keeps the conversation inside token limits via
sliding-window truncation: the system message and original user query are
always pinned (prevents goal amnesia), middle messages drop oldest-first, and
tokens are estimated with a chars/4 heuristic. Context persists across
service-worker restarts via `chrome.storage.session`; compression tightens
dynamically (NONE → LIGHT → MEDIUM → HEAVY) under budget pressure.

## Tools

Tool definitions, registration modules, metadata (risk, DOM-modifying,
sequential, cacheable), and tool profiles are documented in
[Tools](./tools.md). From the loop's perspective: when a response contains no
sequential tools, calls execute in parallel (`parallel-tool-dispatch.ts`);
otherwise sequentially. A single batch DOM-snapshot refresh runs after all
tools complete. HIGH-risk tools are gated behind explicit user approval
(`approval-policy.ts`) — risk is enforced, not informational. Per-tool and
consecutive-failure circuit breakers live in `constants.ts`
(`TOOL_FAILURE_THRESHOLDS`, `MAX_CONSECUTIVE_ALL_FAIL`).

## Safety & limits

- **Max turns** — default 30; the settings picker offers presets 30/50/100/200/500
  (`AGENT_LIMITS.MAX_TURNS_DEFAULT` in `constants.ts`,
  `MAX_TURNS_PRESETS` in `sidepanel/components/settings/settings-options.ts`).
  Hitting the limit produces a structured `PartialProgressHandoff` rather than
  a bare failure.
- **Workspace isolation** — each turn checks the tab is in the active
  workspace before executing tools.
- **Abort** — `stop()` aborts the `AbortController`; the loop exits cleanly on
  `AbortError`. A graceful-stop request drains at the gates phase.

## Stagnation detection

`StagnationMonitor` (`stagnation.ts`) fingerprints DOM snapshots after
DOM-modifying actions. The fingerprint is
`url | title | elementCount | hash(sorted element signatures)`, where an
element signature is `tagName:text:stateAttrs` (disabled/checked/expanded/
value/selected). Thresholds live in `STUCK_THRESHOLDS` (`constants.ts`):
escalate at 5 stagnant turns, give up at 10 (8 on the planner tier), same-URL
escalation at 6, with repeat signals every 6 turns after. The monitor emits a
single `"escalate"` signal type plus `"resolved"` when progress resumes,
broadcast to the side panel as `AGENT_STAGNATION`.

## Streaming

LLM responses stream over SSE; `parseSSEStream` lives in
`background/infrastructure/streaming.ts` (re-exported from
`background/streaming.ts`). Text deltas are forwarded to the side panel as
`STREAM_CHUNK` messages; partial tool calls accumulate across chunks and are
finalized at stream end.

## Model seats

Model configuration is per-provider-mode in
`apps/extension/src/config/model-config.ts` with executor eligibility in
`apps/extension/src/utils/executor-model-policy.ts` — trust those files over
any list here. Current default seats (OpenRouter provider mode): executor
`minimax/minimax-m3`, planner `z-ai/glm-5.2`, judge
`openai/gpt-oss-120b` (a dormant writer seat also exists). The release UI
offers OpenRouter and Fireworks; experimental adapters remain available to
internal evaluation. All modes draw from `ProviderPool` slots.

## Perception

The default perception mode is `unified_vl`: the screenshot goes directly to
the executor. The structured perception path remains available for targeted
debugging and fallback; it returns the five-section contract (`LOCATION`,
`CHANGES`, `BLOCKERS`, `VISUAL-ONLY`, `AFFORDANCES`) with fingerprint-based
caching. See [Perception Layer](./perception-layer.md).

## Navigation bridge

`navigate` saves agent state, exits the loop, and waits for
`webNavigation.onCompleted`; the bridge then calls
`agentLoop.resumeFromNavigation(...)` to restore state and continue. See
[Navigation Bridge](./navigation-bridge.md).

## Pause, resume, feedback

`pause()` installs a promise gate awaited at the top of each turn (the gates
phase); `resume()` resolves it. Messages sent while the agent runs arrive as
`USER_CHAT` with `isFeedback: true` and are folded into context by the
feedback phase on the next turn as `"[User feedback]: {text}"`.

## Orchestrator sub-node mode

When the loop runs as an orchestrator sub-node (`nodeId` set):

- Done-plan validation switches to a snapshot-grounded acceptance path scoped
  to the node (rather than validating against the full original query, which
  would reject correct sub-node completions).
- `countExplicitSteps` early rejection and `taskContractGuard` are skipped —
  step counting and entity coverage are checked at the orchestrator level.

See [Orchestrator](./orchestrator.md).

## Discovered tag IDs

Tool results can reference dynamically-created tags (e.g. `find_element`
returns `[30]`). The `discoveredTagIds` set (on `TurnState`) tracks tags
parsed out of tool output so element-ID validation accepts them on the next
call instead of raising `grounding_mismatch`.

## Metrics and tracing

Session metrics (tokens, cost actual/estimated, vision-call and
perception-mode tallies, per-model breakdown) are accumulated by
`agent-telemetry.ts` and broadcast as `SESSION_METRICS`; the authoritative
shapes are `SessionMetrics` and `TraceEntry` in
`packages/shared-types/src/` (`progress.ts`, `traces.ts`). The
`TraceRecorder` (`trace.ts`) writes full-fidelity dev-only traces consumed by
the [Trace Viewer](./trace-viewer.md).
