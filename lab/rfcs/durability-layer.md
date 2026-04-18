# RFC: In-Extension Durability Layer

**Date:** 2026-04-17
**Status:** Draft
**Depends on:** Temporal evaluation (`lab/research/temporal-evaluation.md`)

---

## Motivation

Service worker death mid-task still causes three distinct failures:

1. **Context amnesia**: the resumed executor loses loop-local state and restarts work from an earlier point.
2. **Duplicate side effects**: a tool call succeeded, but the resumed executor does not know that the same mutation already happened.
3. **Lost human-in-the-loop state**: approvals and clarifications are currently represented as in-memory waiters, which disappear on restart.

This RFC proposes a durability layer that works with the current extension architecture. The key design constraint is:

**A service worker restart destroys the executor's suspended async stack.**

That means durability cannot rely on "rehydrating" in-memory Promises or callbacks. Recovery must be expressed as explicit persisted state that a fresh executor or orchestrator instance can read and continue from.

No backend is required. Adoption is incremental.

---

## Overview

| # | Feature | Storage | Key Files | Effort |
|---|---------|---------|-----------|--------|
| 1 | Runtime turn checkpoints | `chrome.storage.local` | `context.ts`, `loop.ts`, `orchestrator/index.ts` | Medium |
| 2 | Step-scoped mutation ledger | `chrome.storage.local` | `loop.ts`, `tools/metadata.ts` | Medium |
| 3 | Durable interactions via yield/resume | `chrome.storage.local` | `loop.ts`, `orchestrator/index.ts`, `background.ts` | Medium-Large |
| 4 | Side-effects log on failure | `chrome.storage.local` | `loop.ts`, `orchestrator/index.ts` | Small-Medium |

Recommended shipping units:

1. Phase 1 + Phase 2
2. Phase 3
3. Phase 4

---

## Design Principles

1. **Persist behaviorally-relevant state, not just chat history.**
   A resumed executor should restore the fields that change runtime behavior: turn counters, current plan step, notes, recent outcomes, model tier, and mutation history.

2. **Treat restart recovery as "start fresh from a checkpoint", not "resume a suspended function".**
   A fresh `AgentLoop` instance can restore durable state, but it cannot continue from an `await` that existed in a dead service worker.

3. **Keep dedupe state aligned to user-visible semantics.**
   Duplicate-prevention should be scoped to the current plan step, not to one turn and not to the entire node forever.

4. **Keep rollback out of the critical path.**
   First make failures legible by reporting side effects. Planner-generated rollback can be a follow-up RFC.

---

## Phase 1: Runtime Turn Checkpoints

### Problem

`ContextManager` currently persists to `chrome.storage.session`, which is lost on service worker restart. The orchestrator checkpoints task-level state, but not enough loop-local state to faithfully continue a partially completed node.

Today, a restarted node gets relaunched as a fresh `AgentLoop`, and `run()` resets loop-local counters such as `turnCount`. History-only recovery is therefore insufficient.

### Goal

Restore a new `AgentLoop` instance to an equivalent runtime position at the start of the next turn.

### New type: `TurnCheckpoint`

```typescript
// agent/checkpoint-types.ts

export interface TurnCheckpoint {
  version: 1;
  workspaceId: string;
  nodeId: string;
  savedAt: number;

  // Loop runtime
  turnCount: number;
  maxTurns: number;
  currentPlanIndex: number;
  turnsOnCurrentStep: number;
  escalationsOnCurrentStep: number;
  guardAfterDoneRejection: boolean;

  // Context/runtime prompt state
  history: CompressedHistory;
  planStatus: PlanStatus | null;
  workingNotes: string;
  lastActionOutcome: LastActionOutcome | null;
  modelTier: "executor" | "planner";
  isFirstTurn: boolean;

  // Resume validation
  snapshotFingerprint: string;
  pageUrl: string | null;

  // Phase 2
  stepMutationLedger: MutationLedgerEntry[];

  // Phase 4
  sideEffectsLog: SideEffectEntry[];
}

export interface CompressedHistory {
  recentMessages: LLMMessage[];
  olderSummaries: string[];
  originalCount: number;
}
```

### Storage key

`opensidebar:turn-checkpoint:{workspaceId}:{nodeId}`

One checkpoint per active node. Overwritten each turn. Deleted when the node reaches a terminal state.

### Save boundary

Save once per turn, after all tool results and loop state updates are committed, and before the next LLM call.

This boundary is important:

1. Tool effects are already known.
2. The LLM has not yet consumed the next prompt.
3. The next executor can safely begin from a stable point.

### Required runtime restoration

The restore path must set more than chat history. At minimum:

- `turnCount`
- `maxTurns`
- `currentPlanIndex`
- `turnsOnCurrentStep`
- `escalationsOnCurrentStep`
- `guardAfterDoneRejection`
- `workingNotes`
- `lastActionOutcome`
- `modelTier`
- `isFirstTurn`

If those fields are not restored, the resumed node will behave differently from the interrupted node even if message history is preserved.

### Restore rules

When the orchestrator relaunches a node after restart:

1. Load the node's `TurnCheckpoint`
2. Fetch a fresh snapshot for the tab
3. Compare snapshot fingerprint and URL
4. If the page is close enough, restore the checkpoint
5. If the page diverged materially, discard the checkpoint and restart the node with a fresh context

The checkpoint is therefore an optimization for faithful continuation, not a hard dependency for task recovery.

### Changes to existing files

**`agent/context.ts`**

- Add `exportForCheckpoint(): CompressedHistory`
- Add `restoreFromCheckpointHistory(cp: CompressedHistory, isFirstTurn: boolean): void`
- Add small setters/getters for `workingNotes`, `lastActionOutcome`, and any fields needed by restore

**`agent/loop.ts`**

- Add `saveTurnCheckpoint()`
- Add `restoreFromTurnCheckpoint(cp: TurnCheckpoint)`
- Stop treating `run()` startup as always equivalent to a fresh node

**`orchestrator/index.ts`**

- When restarting a running node as pending, also load its turn checkpoint
- Pass checkpoint data into the new `AgentLoop`
- Delete checkpoint on node completion, failure, or explicit cancellation
- Sweep orphaned checkpoints during `restoreFromCheckpoints()`

### Notes on `chrome.storage.session`

Keep the current session save path during rollout for low-latency warm restores inside the same service worker lifetime. `chrome.storage.local` remains the source of truth for durable recovery.

---

## Phase 2: Step-Scoped Mutation Ledger

### Problem

The current `executedActions` map is not a durable restart defense:

- it is in memory only
- it is currently cleared at the start of most turns
- it mixes "same-turn dedupe" with "do not repeat this mutation after restart"

That is the wrong abstraction for service worker durability.

### Goal

Introduce a persisted ledger of mutation-sensitive actions that remains valid for the current plan step across turns and across restarts.

### Model

Split the current behavior into two layers:

1. **Turn action cache**
   Short-lived dedupe for repeated identical tool calls within the same turn.

2. **Step mutation ledger**
   Durable record of mutation-sensitive actions already executed in the current plan step.

Only the second layer is persisted in `TurnCheckpoint`.

### New type: `MutationLedgerEntry`

```typescript
export interface MutationLedgerEntry {
  key: string;                    // toolName + canonical args
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  recordedAt: number;
  planIndex: number;
  snapshotFingerprint: string;
}
```

### Tool classification

Add a dedicated `mutationSensitive` flag to `ToolMeta`.

```typescript
export interface ToolMeta {
  risk: RiskLevel;
  domModifying: boolean;
  sequential: boolean;
  cacheable?: CacheType | false;
  mutationSensitive?: boolean;
}
```

This set should represent "unsafe to repeat if we are recovering from partial progress", not "changes DOM somehow".

Likely `mutationSensitive: true`:

- `CLICK_ELEMENT`
- `TYPE_TEXT`
- `SELECT_OPTION`
- `SET_CHECKBOX`
- `PRESS_KEY`
- `EXECUTE_JS`
- `UPLOAD_FILE`
- `SET_COOKIE`
- `DELETE_COOKIE`
- `NAVIGATE`
- `GO_BACK`
- `CREATE_TAB`
- `CLOSE_TAB`
- `CREATE_WINDOW`
- `SCHEDULE_TASK`

Likely not mutation-sensitive:

- `READ_PAGE`
- `READ_ELEMENT`
- `FIND_ELEMENT`
- `SCROLL_PAGE`
- `HOVER_ELEMENT`
- `DISMISS_OVERLAYS`
- `HIDE_ELEMENT`
- `LIST_TABS`
- `GET_COOKIES`
- `SEARCH_HISTORY`
- `WAIT`
- `DONE`
- `ESCALATE`
- `CLARIFY`
- `UPDATE_NOTES`
- `UPDATE_PLAN`

`DRAG_AND_DROP` should be decided explicitly. It is not safely idempotent, but it may also be too state-dependent for exact ledger reuse. If uncertain, leave it out in v1.

### Ledger rules

1. Record mutation-sensitive tools after successful execution
2. Consult the ledger before executing the same mutation-sensitive tool again
3. Keep the ledger across turns
4. Clear it only when:
   - the plan step advances
   - a strategy pivot clears the current step's assumptions
   - the node terminates

### Key format

Do not rely on raw `JSON.stringify(args)` as the normative definition of identity.

Instead, introduce a small canonicalizer:

```typescript
function buildMutationKey(
  toolName: ToolName,
  args: Record<string, unknown>,
): string;
```

This avoids accidental misses from object key order or equivalent argument aliases.

### Changes to existing files

**`tools/metadata.ts`**

- Add `mutationSensitive`
- Export `MUTATION_SENSITIVE_TOOLS`

**`agent/loop.ts`**

- Keep a non-persisted turn-local cache if useful
- Replace the current `executedActions` durability role with `stepMutationLedger`
- Persist the ledger in `TurnCheckpoint`
- Clear the ledger on step advance and strategy pivot, not on every turn

### Why this is the right scope

The user expectation is not "never repeat a click again anywhere in this node." It is "do not redo the same already-completed mutation while still working on the same step or while recovering after restart."

That is exactly step scope.

---

## Phase 3: Durable Interactions via Yield/Resume

### Problem

`approvalWaiters` and `clarificationWaiters` are currently in-memory callback maps. After a service worker restart, those waiters are gone.

The important implication is:

**The old executor is not paused. It is dead.**

So durability cannot work by re-registering a Promise resolver and hoping the original tool call continues.

### Goal

Move approval and clarification durability to an explicit yield/resume protocol owned by the orchestrator.

### New model

Instead of awaiting a long-lived in-memory waiter, the executor yields control:

```typescript
type LoopResult =
  | { outcome: "completed"; summary: string; ... }
  | { outcome: "failed"; summary: string; ... }
  | { outcome: "awaiting_approval"; interaction: PendingInteraction; ... }
  | { outcome: "awaiting_clarification"; interaction: PendingInteraction; ... };
```

The orchestrator then becomes responsible for:

1. persisting the pending interaction
2. broadcasting it to the side panel
3. marking the node as paused/waiting
4. restarting the node later with the user's decision injected into durable input state

This matches the architecture already used more closely for plan confirmation than the current waiter-based executor flow.

### New type: `PendingInteraction`

```typescript
export interface PendingInteraction {
  id: string;
  type: "approval" | "clarification" | "plan_confirmation";
  workspaceId: string;
  taskId: string;
  nodeId: string | null;
  createdAt: number;
  timeoutAt: number;
  payload: ApprovalPayload | ClarificationPayload | PlanConfirmationPayload;
}

export interface ApprovalPayload {
  toolName: ToolName;
  args: Record<string, unknown>;
  risk: RiskLevel;
  context: string;
}

export interface ClarificationPayload {
  question: string;
  suggestions?: string[];
}
```

### Storage

`opensidebar:pending-interactions`

Value shape:

```typescript
Record<string, PendingInteraction>
```

### Executor behavior

When approval is needed, the executor does **not** wait on a static map. It returns:

```typescript
{
  outcome: "awaiting_approval",
  interaction,
  checkpoint,
}
```

Likewise for clarification.

That ends the current executor run cleanly and durably.

### Orchestrator behavior

On receiving `awaiting_approval` or `awaiting_clarification`:

1. Persist the interaction
2. Persist the task checkpoint
3. Broadcast the request to the side panel
4. Mark the node as waiting
5. Do not keep a suspended executor alive

When the side panel responds:

1. Persist the decision/answer temporarily
2. Remove the interaction record
3. Relaunch the node with:
   - its turn checkpoint
   - an injected `resumeDecision` or `resumeClarification`

The new executor then resumes from a durable input, not from a dead Promise.

### Resume injection

Add an optional `resumeState` to `AgentLoop` startup options:

```typescript
resumeState?: {
  approvalDecision?: {
    interactionId: string;
    approved: boolean;
  };
  clarificationAnswer?: {
    interactionId: string;
    answer: string;
  };
};
```

The restored loop consumes that state the first time it reaches the corresponding continuation point.

Implementation detail is flexible, but the recovery unit must be explicit and persisted.

### Timeout handling

Timeout is now an orchestrator/storage concern, not an in-memory timer concern.

Recommended behavior:

- approval timeout: treat as denied
- clarification timeout: treat as no-answer / timeout answer

The orchestrator can enforce this by scanning `pending-interactions` during startup and before node relaunch.

### Plan confirmation

Keep plan confirmation under the same durable interaction store so all human-in-the-loop flows follow one persistence model.

### Changes to existing files

**`agent/loop.ts`**

- replace waiter-based durability assumptions with yield-style outcomes
- accept `resumeState` at startup

**`orchestrator/index.ts`**

- own interaction persistence and rebroadcast
- restart paused nodes after user response
- enforce timeout expiry

**`background.ts`**

- route side panel responses to orchestrator-owned interaction resolution

### Why this is safer

This design matches the actual runtime model. A dead service worker cannot resume an `await`, but a fresh orchestrator can start a fresh executor with durable resume inputs.

---

## Phase 4: Side-Effects Log on Failure

### Problem

When a task fails after partial progress, the user currently has limited visibility into what may already have changed on the page or in browser state.

### Goal

Record a concise durable log of important side effects and surface it in failure messaging.

This phase intentionally does **not** attempt automatic rollback.

### New type: `SideEffectEntry`

```typescript
export interface SideEffectEntry {
  id: string;
  turn: number;
  planIndex: number;
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  timestamp: number;
  snapshotFingerprint: string;
}
```

### What gets logged

Only high-signal externally relevant mutations:

- `CLICK_ELEMENT`
- `TYPE_TEXT`
- `SELECT_OPTION`
- `SET_CHECKBOX`
- `PRESS_KEY`
- `EXECUTE_JS`
- `UPLOAD_FILE`
- `SET_COOKIE`
- `DELETE_COOKIE`
- `NAVIGATE`
- `GO_BACK`
- `CREATE_TAB`
- `CLOSE_TAB`
- `CREATE_WINDOW`

Important correction:

Agent-created tabs are **not** currently cleaned up by orchestrator worker-tab cleanup alone, so `CREATE_TAB` should remain visible in the side-effects log.

### Usage on failure

If a node or task fails, include a concise section in the final failure summary:

```text
Task failed after partial progress. Possible side effects:
- Turn 3: typed text into email field
- Turn 5: clicked Add to Cart
- Turn 6: created a new tab to example.com
```

This gives the user enough information to inspect or manually undo changes.

### Deferred work

Planner-generated rollback nodes and automatic compensation are intentionally out of scope for this RFC. They require a separate design pass once checkpointing and durable interactions are proven in practice.

---

## Implementation Order

### Ship 1: Runtime Checkpoints + Step Mutation Ledger

Files:

- `agent/checkpoint-types.ts`
- `agent/context.ts`
- `agent/loop.ts`
- `orchestrator/index.ts`
- `tools/metadata.ts`

Outcome:

- resumed nodes keep relevant runtime state
- duplicate mutation risk drops materially after restart

### Ship 2: Durable Interactions

Files:

- `agent/checkpoint-types.ts`
- `agent/loop.ts`
- `orchestrator/index.ts`
- `background.ts`
- new interaction-store helper

Outcome:

- approvals, clarifications, and plan confirmations survive restart
- no waiter rehydration hacks

### Ship 3: Side-Effects Log

Files:

- `agent/loop.ts`
- `orchestrator/index.ts`
- optional helper module for formatting

Outcome:

- failures become legible
- rollback remains a follow-up problem

---

## Testing Strategy

### Unit tests

**Phase 1**

- `TurnCheckpoint` round-trip restores runtime state, not just messages
- stale or corrupt checkpoints fall back safely
- snapshot mismatch causes checkpoint discard

**Phase 2**

- `MUTATION_SENSITIVE_TOOLS` matches the intended set
- step ledger survives turn boundaries
- step ledger survives restart
- ledger clears on plan-step advance
- ledger clears on strategy pivot

**Phase 3**

- executor returns `awaiting_approval` instead of suspending forever
- orchestrator persists and rebroadcasts interactions
- side panel response relaunches node with `resumeState`
- expired interactions resolve with timeout semantics

**Phase 4**

- only tracked tools enter the side-effects log
- failed tool executions are not logged as successful side effects
- failure summary formatting is concise and readable

### Integration tests

- run 5 turns, persist checkpoint, create a fresh `AgentLoop`, restore, verify counters and context continue correctly
- trigger approval, simulate restart, verify orchestrator rebroadcasts and relaunches with decision
- trigger clarification, simulate timeout, verify resumed node receives timeout outcome

### E2E tests

- kill extension mid-node and verify resumed node continues from recovered runtime state
- kill extension during approval wait and verify the overlay reappears, response is accepted, and the node continues

---

## Storage Budget

| Feature | Per-Task Storage | Key |
|---------|------------------|-----|
| Orchestrator checkpoint | ~5-10KB | `opensidebar:orchestrator:checkpoints` |
| Turn checkpoint per active node | ~15-30KB | `opensidebar:turn-checkpoint:{ws}:{node}` |
| Pending interactions | ~1-2KB each | `opensidebar:pending-interactions` |
| Side-effects log | embedded in turn checkpoint | `sideEffectsLog` |

Expected headroom remains large under `chrome.storage.local`.

---

## Migration

No destructive migration is required.

All new storage keys are additive. During rollout:

- keep `chrome.storage.session` saves for warm in-lifetime restoration
- prefer `chrome.storage.local` for durable restart recovery
- ignore unknown checkpoint versions

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Checkpoint writes slow the loop | save once per turn at a stable boundary; keep payload bounded |
| Restored page state has drifted | compare snapshot fingerprint and URL before restore; discard when unsafe |
| Mutation ledger over-blocks legitimate retries | scope it to the current plan step and clear it on step advance/pivot |
| Durable interaction flow adds orchestrator complexity | use one shared `PendingInteraction` model for approval, clarification, and plan confirmation |
| Side-effects log is mistaken for rollback | explicitly present it as informational only |

---

## Open Questions

1. **How strict should snapshot compatibility be before restoring a turn checkpoint?**
   Recommended v1: require URL match and a lightweight page fingerprint match, otherwise fall back to a fresh node start.

2. **Should `DRAG_AND_DROP` participate in the step mutation ledger in v1?**
   Recommended v1: no, unless a clear canonical identity can be defined.

3. **Should approvals and clarifications both use the same node waiting status, or distinct statuses?**
   Recommended v1: distinct statuses for debugging and trace clarity, shared persistence model underneath.

4. **When should session-storage context saves be removed?**
   Recommended: only after at least one release cycle with local durable checkpoints in production.
