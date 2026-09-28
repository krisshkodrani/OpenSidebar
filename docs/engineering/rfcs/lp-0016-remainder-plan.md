# LP-16 Landmine Decomposition — Remainder Execution Plan

The [approved RFC](./lp-0016-landmine-decomposition.md) is the scope and
decision authority. This page tracks what remains in the current working tree.

## Current state (2026-09-25)

Phases 0, 2, and 4 have landed. Phase 1's code extraction is locally complete:
`completion-kernel.ts` is a 54-line re-export façade, within its approximately
1,500-line size target. `read-answer-analysis.ts` is 2,417 lines and
`workflow-confirmation-analysis.ts` is 2,188 lines, both within Phase 1's
approximately 2,500-line kind-module target. Independent review and a
frozen-candidate gate remain. Phase 3 has all nine turn phases extracted and
`loop()` calls the four formerly missing phases through `LoopSession` and
`TurnScope`; the driver is 193 lines, within the 200-line target.
`loop.ts` is 3,403 lines and 73 methods, within the 3,500/80 targets. Its list-detail
workflow and plan recovery behavior now live in dedicated collaborators. The
turn phases call plan recovery directly rather than through loop wrappers.
Money-table callers now use their narrow runtime directly as well.
Completion-evidence callers now use their policy runtime directly.
Tool dispatch now calls the list-detail workflow directly.
Skill-tool policy callers now use a bound runtime directly.
Telemetry callers now use the existing controller directly.
Plan-progress callers now use a bound runtime directly.
Generic completion rejection and envelope code now lives with completion policy;
the ServiceNow catalog compatibility method remains until LP-15.
Completion decision inputs and guard context now use a bound read-only runtime.
Accepted pipeline decisions now finalize through a narrow completion helper.
Done plan validation now uses a bound policy runtime without a broad loop cast.
Completion effects now apply through a narrow state host.
Trusted list sort/filter completion now runs through a dedicated runtime;
tool dispatch calls it directly.
Mutation replay and recording now run through a narrow bound runtime;
tool dispatch calls it directly.
Accepted completion finalization and the terminal UI update now run through
a narrow bound runtime; the completion phase calls it directly.
Partial-progress ledger updates, handoff creation, and terminal plan reporting
now run through a bound runtime.
Inline-edit completion and verification checks now run through a bound runtime.
Completion task context is shared by decision context and done diagnostics.
Plan progress captures the latest subtask result directly, without a loop
forwarding method.
Workspace tab IDs and the tab-management gate now use shared routing policy.
Done-rejection escalation and pure list-filter queries now take only the state
they read, without broad loop casts.
Form-submit dry-run takes an explicit typed input object instead of the loop
host cast and forwarding method.
Durable checkpoint save, restore, and clear now use a bound typed runtime;
three broad loop casts and forwarding methods are gone.
Phase 5 has reduced `orchestrator/index.ts` to 2,984 lines, below its
approximately 3,000-line exit target. Task-progress messaging now lives in
`task-messaging.ts`; the snapshot reader's typed result reaches its callers
directly. Phase 6 follows the remaining exits and review.

These figures include local completion-decision recording, form-fill,
quiz-selection, draft-only, navigation, read-answer, workflow-confirmation,
file-transfer result evidence, snapshot evidence, workflow state evidence,
control state evidence, tool-outcome evidence, loop run-state, loop
finalization, completion rejection instruction, and approval/clarification
interaction extractions, orchestrator task bootstrap, completion payload,
execution budget, tab recovery, escalation interaction, initial plan results,
plan confirmation, lane operation runtime, worker tab assignment, horizon
expansion, worker loop setup, executor instruction preparation, and ratchet
changes. The scheduler's budget-warning emission now lives beside its budget
exhaustion policy. Root-goal decision application now lives behind explicit
orchestrator callbacks. Resource conflict reporting, concurrency calculation,
executor lane waiting, and worker queueing now share a scheduler collaborator.
Recovered turn checkpoint validation, drift detection, and worker context
briefs now share a worker-context collaborator. Executor result evidence and
its compact summary now share a dedicated collaborator. Worker metric, fleet
telemetry, budget observation, and partial handoff recording now share a
worker-result state collaborator. Post-execution tab read and verifier routing
now share a worker-verification collaborator. Verifier retry, reflection,
and failure updates now share a verifier-retry collaborator. Drift-triggered
replanning and its budget and lane-isolation handling now share a
verifier-replan collaborator. Incomplete results and thrown worker failures
now share a worker-result failure collaborator. Blocked dependency failures
and scheduler deadlock reporting now live in the scheduler collaborator.
Worker start, lane-pool registration, and release now share a lifecycle
collaborator. Immediate verifier acceptance, reroute handoff, and terminal
failure application now share a verifier-outcome collaborator. Operator
escalation decision application now lives beside escalation request and
checkpoint handling. The verifier decision guard and report now live in the
worker-verification collaborator, and the high-risk judge condition lives
beside the judge gate.
The final task card and post-emission reporting are now prepared in the
completion-payload collaborator.
They are working-tree measurements, not merged or reviewed
release evidence. Use `node scripts/loop-ratchet.mjs --report` for current
figures after further edits.

Phase 1 export review compared the TypeScript AST public names in HEAD's
`completion-kernel.ts` with the working-tree façade: both export 45 names,
with none missing or added. All 143 top-level function bodies and three
top-level variable initializers in the old kernel have token-identical
counterparts in `completion/` after line-ending normalization. The six
completion golden-replay tests pass,
including byte-identical kernel decisions and zero-divergence pipeline
verdicts; the committed corpus fixtures are unchanged. This is local review
evidence, not the remaining independent review or frozen-candidate sign-off.

Phase 5 local review ran nine deterministic orchestrator suites on 2026-09-25:
integration, scheduling, handoff, evidence, verifier, horizon, parallel
contract, driver, and completion. All 224 tests passed. That review found a
pre-existing scheduler bug: rejected worker cleanup through `finally` created
a second unhandled rejection. Cleanup now uses both `then` branches; a focused
regression and the orchestrator integration suite pass (80 tests). Full
working-tree `pnpm run verify` then passed with 5,700 extension tests and the
dist check. These checks do not replace independent review or headed staged
E2E.

## Required work

Current cast inventory (2026-09-25): `loop.ts` still has 22
`this as unknown as ...Host` sites: nine turn-phase/controller hosts and 13
ServiceNow adapter hosts. Module-navigation evidence now receives its five
typed inputs explicitly. The remaining ServiceNow adapter residue follows LP-15's
separate detachment; the turn-machine hosts remain LP-16 review work. Done
diagnostics uses the typed completion-context host, and warmup adoption, VL
screenshot capture, and region zoom share a typed perception-capture host.
Plan-status synchronization now applies through `agent-plan-progress.ts` while
the loop retains its existing caller method.
An AST and TypeScript member audit found no missing members in the 11
turn-phase/controller and three ServiceNow host contracts. Three type
mismatches in the turn-phase contracts were corrected: the optional last-tool
name and the two plan-status trace-event signatures. This checks the current
member surfaces; it does not replace the independent behavior review.
The wider cast audit also found a callback cast to `DonePlanRejectionHost` whose
legacy formatter method was absent from the loop. The runtime already passes
the formatter explicitly; the host contract now allows that path, and a
regression test exercises a host with no formatter method. Nested phase casts
were then checked against the phase contracts and removed.
That review found the tool-handler host still required a removed
`checkNavigateGuard` method. The handler now passes its typed plan subtasks to
the exported guard directly. The parallel and sequential dispatch contracts
are now declared by the phase host and typechecked at their call sites.
Account-and-refresh now receives its four typed inputs directly from the
loop, removing one turn-phase host cast.
Text admission and the completion phase now declare the nested contracts they
actually pass to evidence, spawned-tab, snapshot-refresh, and plan-monitor
helpers. Snapshot refresh and plan monitoring now specify only the perception
methods they read. The parallel and sequential dispatch contracts are also
declared by their phase host. No nested `as unknown as ...Host` casts remain
in `turn-phases/`; the 22 direct `loop.ts` host casts remain for review.
The shared tool-handler host now uses typed context, provider, middleware,
cache, logger, trace, element resolver, and trusted tool-result inputs. This
narrows the dispatch contracts used by the turn phase without changing its
runtime behavior.
The feedback phase now receives its private pending-feedback state and clear
callback explicitly. A once-only feedback regression passes, and the driver
ratchet is 3,403 lines / 73 methods / 193 driver lines. Full working-tree
verification passes with 5,701 extension tests.

1. Complete Phase 1 review of the façade and its extracted modules, preserving
   the same public exports and golden corpus. Keep the test count and
   byte-identical replay evidence on the frozen candidate.
2. Complete Phase 3 review and retire the broad host casts specified by the
   RFC. The 3,500-line, 80-method, and 200-line-driver numeric targets are met
   locally; the working tree still has broad host casts and has not passed the
   headed staged E2E gate. Keep further relocations behavior preserving and
   lower the ratchet after each one.
3. Review Phase 5's extracted scheduling, reroute, completion, and messaging
   collaborators against the deterministic integration coverage; the
   `orchestrator/index.ts` size target is met locally.
4. Complete Phase 6: update `CLAUDE.md` as each landmine clears, then pin
   end-state ratchet budgets.

## Verification gates

Each extraction needs `pnpm run verify`, before/after ratchet numbers, and
review of the behavior-preserving diff. Completion-kernel moves additionally
need a zero-divergence golden gate and identical test count. The Phase 3
driver change requires the unit suite and headed Chrome `easy`, `medium`,
and `hard` staged E2E on the branch before merge, per the owner Decision Stamp.
The stages have not been certified on this working tree. Fireworks currently
has no credits, so that live-provider gate cannot be claimed from local mock
or unit results.

The ServiceNow injected-script residue remains LP-15 work. Do not detach it
under LP-16 or raise a ratchet budget to accommodate a move.
