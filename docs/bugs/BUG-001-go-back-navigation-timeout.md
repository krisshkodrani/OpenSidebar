# BUG-001: Planner over-decomposes round-trip tasks, causing node budget exhaustion

**Severity**: Medium
**Component**: Planner decomposition + orchestrator scheduling
**Test**: `tests/e2e/go-back-navigation.test.ts`
**Prompt**: "Check the inventory count for Warehouse Gamma on page 3, then go back to Warehouse Alpha and check its count too. Tell me both numbers."
**Status**: Open

## Observed behavior

The planner decomposes a 2-step round-trip task into 4 orchestrator nodes:
1. Navigate to page 3, locate Warehouse Gamma
2. Read Warehouse Gamma inventory count
3. Go back to Warehouse Alpha
4. Read Warehouse Alpha count and report both

Node 1 completes successfully (~60s). Node 2 starts but the test's `waitForOutcome(240_000)` times out before nodes 2-4 can finish. The verifier returns `retry` with `insufficient_evidence` on node 2, and `task_stop_requested` fires twice — killing the run.

## Evidence

Run trace `traces/runs/cbc36365`:
```
plan_decomposed: 4 nodes, difficulty: moderate
node 62b78466: ACCEPTED (confidence 0.99) — "Gamma 6,412 units"
node 8249ec1a: RETRY (confidence 0.98, insufficient_evidence)
task_stop_requested (×2)
task_stopped (phase: execution)
```

Nodes 3-4 never start.

## Root cause

**Over-decomposition**: The planner splits "navigate to Gamma + read count" into 2 separate nodes (navigate, then read), and "go back to Alpha + read count" into 2 more. A human would do this in 2 steps: go to Gamma and note the number, go back to Alpha and note the number. The planner creates 4 nodes because the decomposition prompt says "Do NOT combine 'go back' and 'read data' into a single step — split them."

**Budget math**: 4 nodes × ~60s each = ~240s minimum. With planning overhead (~30s) and verifier calls, the total exceeds the 240s `waitForOutcome` timeout.

**Verifier redundancy**: Node 2 re-verifies what node 1 already established. The verifier says "insufficient_evidence" because node 2's executor didn't explicitly re-read the Gamma count — it was already in node 1's handoff context.

## Possible fixes

1. **Planner prompt**: Relax the "Do NOT combine go back and read data" rule for simple data reads. Allow "Navigate to X and note the value" as a single step when the value is visible on the page.

2. **Test timeout**: Increase `waitForOutcome` to 360_000 (6 min) for round-trip tests. This is a workaround, not a fix.

3. **Node merging**: The orchestrator could merge consecutive nodes when the second node's only action is "read data from the page we're already on" — this is an optimization pass on the plan.

4. **Handoff context**: Pass node 1's verified data (Gamma: 6,412) as structured evidence to node 2, so node 2 doesn't need to re-verify it.

## Reproduction

```bash
npm run test:e2e:progressive -- go-back-navigation
```

## Related

- RFC: `docs/rfc/rfc-criteria-based-text-only-advancement.md`
- Report: `docs/e2e-reports/natural-v2/go-back-navigation.md`
- Decomposition prompt: `prompts/runtime/planner/decompose_system.md` (ROUND-TRIP NAVIGATION section)
