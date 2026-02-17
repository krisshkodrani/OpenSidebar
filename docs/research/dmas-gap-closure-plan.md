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
4. Plan-based orchestration robustness (deps, retries, drift, handoffs): 92%
5. Human-in-the-loop controls (approval, pause/resume/skip): 90%
6. Multi-agent specialization (planner/executor/verifier as independent workers): 88%
7. Conversation-driven multi-agent collaboration (group-chat/reflection patterns): 72%
8. Evaluation and contract-compliance coverage for orchestration joins: 86%

## Remaining Critical Path To 100%

1. Unify trace pipelines between production orchestrator and eval tooling
   - Persist orchestrator run manifests/events to local trace artifacts.
   - Consume run traces in eval conversion/analysis workflows (not only agent turn traces).
2. Expand eval datasets for orchestration-specific behavior contracts
   - Add golden cases for lane isolation, critic adoption/rejection, operator decision branches.
   - Add explicit must-not regressions for cross-lane contamination and retry loops.
3. Tighten UX/runtime policy alignment
   - Keep per-tab sidepanel behavior strictly manual-open only.
   - Ensure escalation and recovery state transitions remain workspace-scoped and deterministic.
4. Promote orchestration joins to stricter quality gates
   - Keep integration coverage for checkpoint recovery, budget termination, skip/race, escalation resume.
   - Add required runbooks for manual replay and AI critique loops.

## Next Milestone (Recommended)

Implement **trace/evals harmonization for orchestrator runs**, then validate:
- orchestrator run traces are persisted and queryable
- eval analysis consumes orchestrator run signals alongside turn traces
- golden tracks cover escalation, lane isolation, critic reflection, and checkpoint recovery
