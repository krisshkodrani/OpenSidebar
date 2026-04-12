# RFC: Strategic Resilience — Fallback Plans & State Checkpointing

## Status
Proposed (Phase 2 — depends on Phase 1: `rfc-post-action-verification.md`)

## References
- **Study**: "Autonomous Web Agent Reliability: Tree of Thoughts, State-Validation, and Tool-Recovery" (2025 analysis)
- **Book 1**: Victor Dibia, *Designing Multi-Agent Systems* (2025), Ch 6 (checkpointing gap in DMAS eval)
- **Book 2**: Antonio Gulli et al., *Agentic AI Design Patterns* (2025), Ch 4 (producer-critic), ToT branching
- **Book 3**: Denis Rothman, *Context Engineering for Multi-Agent Systems* (2025)
- **Internal**: `docs/rfc/rfc-post-action-verification.md` (Phase 1), `docs/rfc/rfc-multi-turn-resilience.md`

## Context

### Beyond Micro-Verification

Phase 1 (Post-Action Verification) addresses the feedback gap at the *action* level: did this click work? Was the element interactable? Are we stuck in a zero-effect loop?

Phase 2 addresses the *strategic* level: what happens when the entire approach fails? Currently, `replanFrom()` makes an expensive planner-model call on every deviation. And when a plan step fails after multiple retries, the only options are "continue from here" or "full fresh start" — there's no middle ground of rolling back to a known-good checkpoint.

### Two Gaps

**Gap 4 (P2a): No alternative strategy.** The planner decomposes tasks into a single sequence of steps. When deviation is detected, `replanFrom()` calls the planner model to replan — an expensive LLM call. If the planner had generated an alternative approach during initial decomposition, we could try it immediately before falling back to an LLM replan call. The study's ToT (Tree of Thoughts) branching and Plan-MCTS patterns both maintain multiple candidate paths.

**Gap 5 (P2b): No state checkpointing.** The agent has no middle ground between "continue from current state" and "full fresh start" (which resets all context). The navigation bridge already demonstrates per-navigation state persistence. The same pattern applied at plan step boundaries would enable targeted rollback — go back to the state where step N-1 succeeded, rather than starting from scratch. Dibia identifies this as a gap in DMAS evaluation (Ch 6).

## Design

### P2a: Plan Fallback Strategies

**Approach**: Extend `PlanDecomposition` to optionally include an `alternativeStrategy` field. The planner prompt is updated to request an alternative approach for tasks where one exists. During `handlePlanDeviation()`, if an alternative exists and hasn't been used, swap plan steps directly — skipping the expensive `replanFrom()` LLM call.

**Type extension** (in `planner.ts`):
```typescript
interface PlanDecomposition {
  // ... existing fields
  alternativeStrategy?: {
    description: string;
    steps: PlanStep[];
  };
}
```

**Prompt addition** (in `prompts/runtime/planner/decompose_system.md`):
```
If the task has an obvious alternative approach, include "alternativeStrategy":
{ "description": "Brief description of the alternative", "steps": [...] }
Only include for genuinely different approaches (e.g., search vs browse, form vs API).
Omit for simple tasks or when there's only one sensible approach.
```

**Control flow** (in `loop.ts`):
```
handlePlanDeviation():
  1. If alternativeStrategy exists AND not yet used:
     → Swap plan steps, inject context message, set alternativeStrategyUsed = true
     → Skip replanFrom() call (saves ~2s + planner model tokens)
  2. Else:
     → Fall through to existing replanFrom() logic
```

**Cost**: Zero additional LLM calls at plan time (the alternative is requested in the same decomposition prompt). Saves one planner-model call when deviation triggers and alternative exists.

### P2b: State Checkpointing at Plan Step Boundaries

**Approach**: New `CheckpointManager` class that saves lightweight state snapshots at plan step boundaries. When a plan step fails after exhausting retries, the agent can backtrack to the last checkpoint rather than doing a full fresh start.

**Checkpoint data** (in new `checkpoints.ts`):
```typescript
export interface PlanCheckpoint {
  stepIndex: number;
  url: string;
  title: string;
  fingerprint: string;           // snapshot fingerprint for staleness check
  perception: string;            // last perception interpretation
  timestamp: string;
  subtaskStatuses: Array<{
    description: string;
    status: string;
    result?: string;
  }>;
}

export class CheckpointManager {
  private checkpoints: PlanCheckpoint[] = [];  // ring buffer, max 3
  save(stepIndex, snapshot, perception, subtaskStatuses): void;
  getLatest(): PlanCheckpoint | null;
  canBacktrack(currentUrl: string, checkpoint: PlanCheckpoint): boolean;  // same-origin check
  reset(): void;
}
```

**Integration** (in `loop.ts`):
- After step completion in `advanceCompletedSubtasks()`: save checkpoint with current snapshot + perception
- In `handlePlanDeviation()` when `replanCount >= 2` AND alternative exhausted:
  - Get latest checkpoint
  - If `canBacktrack()` (same origin): navigate to checkpoint URL, wait for DOM, inject backtrack context, reset replanCount
  - Fall through to `replanFrom()` on failure

**Constraints**:
- Ring buffer of 3 checkpoints (memory bounded)
- Same-origin only (cross-origin navigation would break extension context)
- Only used when replanCount >= 2 (not on first deviation — give replan a chance)
- Navigation via `chrome.tabs.update()` (same as navigation bridge pattern)

## Files Changed

| File | Change |
|------|--------|
| `src/background/agent/planner.ts` | `alternativeStrategy` on `PlanDecomposition` |
| `prompts/runtime/planner/decompose_system.md` | Alternative strategy prompt addition |
| `src/prompts/generated.ts` | Regenerated after prompt change |
| `src/background/agent/checkpoints.ts` | New: `CheckpointManager` class |
| `src/background/agent/index.ts` | Export checkpoints |
| `src/background/agent/loop.ts` | Store alternative strategy, use in `handlePlanDeviation()`, instantiate `CheckpointManager`, save/restore checkpoints |
| `tests/background/checkpoints.test.ts` | `CheckpointManager` tests |
| `tests/background/planner.test.ts` | `alternativeStrategy` parsing tests |

## Testing

- **CheckpointManager**: save/get, ring buffer eviction (4 saves → only 3 kept), canBacktrack same-origin/cross-origin, getLatest returns most recent, reset clears all
- **Alternative strategy parsing**: present when LLM includes it, absent for simple tasks, steps validated with same `parseSteps()` logic, capped at 5 steps
- **Integration**: alternative strategy consumed before replanFrom, checkpoint navigation on double-deviation

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Alternative strategy rarely useful | Zero cost when absent — field is optional, prompt says "omit for simple tasks" |
| Checkpoint navigation returns to stale state | Fingerprint comparison detects staleness; perception refresh runs after navigation |
| Ring buffer too small (3) | Plan steps are sequential — we only need to go back 1-2 steps. 3 is sufficient. |
| Cross-origin backtrack breaks extension | `canBacktrack()` enforces same-origin check |

## Dependencies

This RFC depends on Phase 1 (Post-Action Verification) being implemented first:
- P2b's checkpoint save uses the same snapshot infrastructure that P0 surfaces
- P2a's fallback strategy evaluation benefits from P1b's micro-verification to judge whether the alternative is working
