# DMAS Gap Closure Plan (2026-02-16)

## Scope

This plan tracks OpenSidebar's remaining gap against the evaluation in:
- `docs/research/evaluation-against-DMAS-book.md`
- *Designing Multi-Agent Systems* (Victor Dibia, 2025)

## What Was Completed In This Pass

1. Hardened orchestrator integration and removed cross-suite test races.
2. Added dependency injection seams for deterministic orchestration testing:
   - `src/background/orchestrator/index.ts`
   - `src/background/workspaces/manager.ts`
3. Removed flaky module-level test coupling in:
   - `tests/background/orchestrator-integration.test.ts`
   - `tests/background/workspace-manager.test.ts`
4. Suppressed local log-drain test noise (`127.0.0.1:7589`) in:
   - `tests/setup.ts`
5. Validation status on 2026-02-16:
   - `bun test`: pass (572 pass, 0 fail)
   - `bun run lint`: pass (warnings only)
   - `bun run build`: pass

## Progress Map (0% -> 100%)

1. Tool system design: 95%
2. Memory architecture (hybrid retrieval + persistence): 90%
3. Observability/tracing and tactical logs: 90%
4. Plan-based orchestration robustness (deps, retries, drift, handoffs): 88%
5. Human-in-the-loop controls (approval, pause/resume/skip): 82%
6. Multi-agent specialization (planner/executor/verifier as independent workers): 65%
7. Conversation-driven multi-agent collaboration (group-chat/reflection patterns): 35%
8. Evaluation and contract-compliance coverage for orchestration joins: 80%

## Remaining Critical Path To 100%

1. Introduce explicit multi-agent worker isolation at runtime
   - Separate execution lanes for planner/executor/verifier with independent budgets.
   - Add deterministic handoff contracts and failure containment per lane.
2. Add conversation-driven critic/reflection loop for hard tasks
   - Lightweight verifier-critic exchange before retry/reroute decisions.
   - Enforce bounded turns and explicit stop conditions.
3. Close human delegation loop for high-risk uncertainty
   - Structured operator escalation packet (state summary, confidence, options).
   - Post-decision replay logs and eval cases.
4. Raise integration coverage for crucial joins
   - Cross-lane handoff + checkpoint restore + skip/race + budget termination permutations.
   - Promote these to required CI gates.

## Next Milestone (Recommended)

Implement **runtime-isolated planner/executor/verifier workers with bounded handoff protocol**, then add integration tests validating:
- worker isolation under retries/reroutes
- deterministic checkpoint recovery across worker boundaries
- bounded termination under budget + stale signals

