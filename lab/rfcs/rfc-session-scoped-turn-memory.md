# RFC: Workspace-Scoped Turn Memory for Multi-Turn Continuity

**Status**: Draft
**Date**: 2026-04-10
**Author**: Agent session
**Affects**: `src/background/orchestrator/index.ts`, `src/background/background.ts`, `src/sidepanel/store/chat-slice.ts`, `src/background/agent/memory.ts` (new, or equivalent workspace-turn module)

## Problem

Continuation behavior across multiple user turns in the same workspace is broken.

The failing E2E cases are not asking for generic chat history. They require the agent to carry forward task-relevant state across turns:

- Edit prior work in place
- Preserve exact values introduced in a prior turn
- Recall facts observed on a page that is no longer visible
- Synthesize observations across tabs/pages
- Reset prior work when the user explicitly says to start over

Representative expectations:

- `tests/e2e/continuation.test.ts`: Turn 3 must preserve the Monday suggestion introduced in Turn 2
- `tests/e2e/continuation-paginated-memory.test.ts`: Turn 3 must compare a value seen on page 1 with a value seen on the last page
- `tests/e2e/continuation-cross-tab.test.ts`: Turn 3 must synthesize information from two different tabs
- `tests/e2e/continuation-abandon-restart.test.ts`: Turn 2 must discard earlier state when the user says to scrap everything and start over

## Root Cause

The break is real, but it is not just "workerId changed."

### What happens today

1. Each new user message starts a fresh orchestrator task.
2. `startTask()` stops the prior task for that workspace and creates a new task with only the current user message.
3. Executor loops are created with fresh `workerId`s, so `ContextManager` state keyed by `agent_context:{workspaceId}:{workerId}` is not reused.
4. The system already persists assistant completion summaries into `chatMessages:{workspaceId}`, but those persisted turn results are not reconstructed into planner/executor/verifier inputs for the next task.

### Consequence

Cross-turn continuity fails for two independent reasons:

- The prior executor conversation state is not reused
- The next task is not given a structured summary of prior turns

So the underlying issue is:

> The system has workspace-scoped persistence for UI history, but no workspace-scoped turn-memory contract for model inputs.

## Non-Goals

- Reusing raw agent-loop history across turns
- Sharing full tool-call transcripts between turns
- Changing intra-task orchestrator handoff behavior between nodes
- Building semantic search, embedding retrieval, or intent indexing in this phase
- Solving long-horizon memory beyond the recent workspace conversation

## Design Principles

1. Use workspace scope, not worker scope, for cross-turn memory.
2. Store faithful turn outputs, not heuristic guesses derived later.
3. Keep one source of truth for persisted turn records where possible.
4. Make reset semantics explicit.
5. Feed compact structured memory into prompts, not raw transcripts.

## Proposed Solution

Introduce **workspace-scoped turn records** persisted in `chrome.storage.local`, then reconstruct a compact memory block for the next turn's planner and executor inputs.

This is a workspace-level continuation mechanism, not a worker-history restoration mechanism.

## Storage Choice

Use `chrome.storage.local`.

Why:

- Available in MV3 service workers
- Already used by the codebase for workspace-scoped persistence
- Survives service-worker restarts
- Appropriate for small structured records

Why not:

- `localStorage`: unavailable in MV3 service workers
- `chrome.storage.session`: too ephemeral for service-worker restarts and still tied to current in-memory execution assumptions
- IndexedDB: unnecessary for phase 1

## Scope Semantics

This RFC intentionally uses **workspace-scoped** memory, not true browser-session-scoped memory.

Lifecycle rules:

- Same workspace + follow-up user message: prior turn memory is available
- New workspace: no prior turn memory
- "Clear current conversation" for a workspace: clear chat history and turn memory for that workspace
- Global "clear chat history": clear turn memory for all workspaces too

Until an explicit per-workspace clear path exists in the background, the feature is incomplete.

## Data Model

Do not use regex-extracted `keyFacts` as the canonical record.

Store the outputs we already have at task completion time.

```typescript
interface WorkspaceTurnRecord {
  turnId: string;
  workspaceId: string;
  turnNumber: number;
  userQuery: string;
  outcome: "completed" | "partial" | "failed" | "stopped";
  assistantSummary: string;
  finalUrl?: string | null;
  completedAt: number;
  nodeResults: Array<{
    description: string;
    status: "completed" | "failed" | "skipped";
    result: string;
  }>;
}

interface WorkspaceTurnMemory {
  workspaceId: string;
  turns: WorkspaceTurnRecord[];
  createdAt: number;
  updatedAt: number;
}
```

Storage key:

- Preferred: extend the existing workspace chat/completion persistence with structured turn records
- Acceptable phase-1 fallback: `agent_turn_memory:{workspaceId}`

Cap:

- Keep the most recent 10 turns by default
- Format at most the most recent 3 to 5 turns into the prompt

## Why This Data Model

This design preserves what the next turn actually needs:

- What the user asked last turn
- Whether the turn succeeded, partially succeeded, or failed
- What the agent says it accomplished
- Which sub-results were completed or failed
- Where the agent ended up

That is enough for:

- "Change the reply you drafted"
- "Compare what you saw on page 1 with page 5"
- "Based on both tabs, which looks strongest?"
- "Scrap all that and start over"

It is also materially safer than trying to infer facts later from regexes over summaries.

## Prompt Reconstruction

### Read Path

When a new user message arrives for an existing workspace:

1. Load recent `WorkspaceTurnRecord`s for that workspace
2. Build a compact memory brief
3. Inject that brief into:
   - Planner input
   - Executor instruction
4. Optionally inject a shorter version into verifier/advisory paths when relevant

### Memory Brief Format

Example:

```text
PRIOR WORKSPACE TURNS:

Turn 1
- User request: Draft a reply accepting Thursday 2 PM
- Outcome: completed
- Result: Drafted a reply in the reply box accepting Thursday 2 PM. Did not send.
- Final URL: http://localhost:3000/email-compose

Turn 2
- User request: Change the reply. Decline both proposed times and suggest Monday at 11 AM.
- Outcome: completed
- Result: Rewrote the draft to decline the proposed times and suggest Monday at 11 AM.

CURRENT REQUEST:
One more change. Make the tone more casual and add that you'll send over the Q3 budget numbers before the meeting.
```

### Important Prompt Rules

- The memory brief is context, not an instruction override
- Failed turns must be labeled as failed
- Partial turns must be labeled as partial
- The current user request remains authoritative
- The brief must be compact and bounded

## Reset Semantics

This RFC requires explicit reset behavior.

### Per-workspace clear

When the user clears the active conversation for a workspace:

- Clear `chatMessages:{workspaceId}`
- Clear turn memory for that workspace
- Clear any recent-completion cache for that workspace if applicable

### Global clear

When the user uses the existing global "clear chat history" action:

- Clear all `chatMessages:*`
- Clear all turn-memory keys

### User-directed restart

When the user says "scrap that," "start over," or equivalent, the system should not wipe memory automatically. That instruction should be handled by the model as part of the next turn, using the preserved prior state as contrast.

Only explicit UI/data clear actions should erase stored memory.

## Implementation Plan

### Phase 1: Minimal viable continuity

1. Add workspace turn-memory load/save/clear helpers
2. Save one `WorkspaceTurnRecord` at task completion
3. Read recent turn records before starting the next task
4. Inject the memory brief into planner and executor inputs
5. Add per-workspace clear integration

### Phase 2: Tighten source of truth

1. Consolidate chat/completion persistence and turn-memory persistence
2. Avoid duplicated representations of the same completion
3. Add migration if needed from fallback storage keys

### Phase 3: Quality improvements

1. Improve formatting for compactness and salience
2. Add stronger filtering for failed/noisy turns
3. Consider structured extraction of stable facts only when directly available from tool results or node artifacts

## Concretely Required Code Changes

| Component | Change |
|---|---|
| `src/background/orchestrator/index.ts` | Save `WorkspaceTurnRecord` on task completion; load recent turn memory before planning; pass memory brief into planner/executor |
| `src/background/background.ts` | Extend data-clear handlers to clear turn memory; add per-workspace clear path if missing |
| `src/sidepanel/store/chat-slice.ts` | Ensure active-workspace clear also clears turn memory through background messaging |
| `src/background/agent/memory.ts` | New helper module for load/save/clear/format, unless folded into existing workspace persistence code |
| `tests/background/memory.test.ts` | New unit tests |
| `tests/background/orchestrator-conversation.test.ts` | Add integration coverage for cross-turn prompt injection |

## What This Does Not Change

- Intra-task node handoff inside the orchestrator
- Executor-loop internals for same-task retries
- Context compression logic inside a single agent loop
- Planner decomposition strategy
- Tool implementations

## Safety Analysis

### Regression risk: low to medium

Single-turn tasks should be unaffected when no prior turn records exist.

Risk increases if memory formatting is too verbose or if failed turns are presented unclearly.

### Memory pollution risk: medium

If a prior turn was wrong, the next turn can inherit bad assumptions.

Mitigations:

- Label outcomes clearly
- Prefer stored assistant summaries and node results over inferred facts
- Keep the current user request authoritative

### Context pressure: low

Formatting 3 to 5 recent turns as compact bullets should stay within budget.

Do not inject raw transcripts.

### Storage growth: low

10 turns per workspace with compact records is small.

## Tests

### Unit tests

1. Save appends a turn record
2. Load returns empty/null for unknown workspace
3. Old turns are trimmed at the cap
4. Clear removes only the targeted workspace memory
5. Global clear removes all turn-memory keys
6. Prompt formatting is compact, ordered, and labels failed/partial turns correctly
7. Empty memory produces no injected memory block

### Integration tests

1. New task in same workspace receives prior-turn memory
2. New workspace does not receive memory from another workspace
3. Clearing active workspace removes prior-turn memory
4. Global clear removes all workspaces' memory

### E2E targets

- `tests/e2e/continuation.test.ts`
- `tests/e2e/continuation-paginated-memory.test.ts`
- `tests/e2e/continuation-cross-tab.test.ts`
- `tests/e2e/continuation-abandon-restart.test.ts`
- `tests/e2e/continuation-verify.test.ts`
- `tests/e2e/continuation-act-check-act.test.ts`

### Success criteria

Phase 1 target:

- Majority of continuation E2Es pass
- No regression in previously passing single-turn tests

Phase 2 target:

- All continuation E2Es pass consistently
- No duplicated or divergent turn-history representations

## Open Questions

1. Should turn memory become the canonical persisted conversation record for the workspace, with UI chat derived from it?
2. Should planner and executor receive the same memory block, or should the planner get a more compact version?
3. Should user-authored messages also be persisted in the same turn-record schema for exact reconstruction?

## Decision

- [ ] Approved
- [ ] Approved with modifications: ___
- [ ] Rejected, reason: ___
