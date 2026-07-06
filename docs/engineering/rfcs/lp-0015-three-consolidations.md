# RFC LP-15 — Three Consolidations: Runtime Library, Verification Subsystem, Loop Decomposition

Lifecycle status: Decision stamped
Date: 2026-07-05
Decision date: 2026-07-05 (owner selected scope in session: FULL four-station
verification, FULL chrome.* extraction, execution AFTER v0.3.0 + perception-stack
merge)
Scope: `background/environment/` port layer, `background/agent/` (loop.ts,
completion pipeline, controllers), `background/orchestrator/` (verifier, evidence),
`background/tools/` (ports plumbing, extract_form_state, dry-run metadata),
`background/memory/` (new trusted-corpus store), llm judge seat, test fakes +
headless smoke, two new e2e fixtures
Related: LP-4 (deterministic state verifiers), LP-8 (OpenClaw browser bridge),
verifiability-of-done discussion (2026-07-05); AGENTS.md change-placement policy

## Problem

Three structural debts limit correctness and reuse:

1. **Completion authority is split.** The deterministic contract kernel
   (`completion-kernel.ts`, 14,402 lines, clean pure functions) and a legacy guard
   chain (~40 coupled methods inside `AgentLoop.handleDoneToolCall`, loop.ts:2801)
   both decide "is the task done", layered with a bounce-bypass escape hatch.
   Every completion change requires reasoning about two systems.
2. **The runtime cannot run headless.** ~356 direct `chrome.*` references across
   28 background files (tools/index.ts 45, workspaces/manager.ts 41, loop.ts 25,
   orchestrator/index.ts 25). The `environment/` ports layer exists but is
   embryonic: 3 ports, and `PersistencePort` has zero consumers. Unit tests fake
   a global `chrome` object; benchmarks and OpenClaw M6/M7 each re-solve driving
   the runtime.
3. **AgentLoop is a god object.** 11,294 lines, ~290 methods, a 2,666-line
   `loop()` method, ~90 loose instance fields, 32 `this as unknown as XHost`
   casts across 8 host interfaces.

Meanwhile the verifiability-of-done direction (job-application-class autonomy via
OpenClaw) needs machinery that doesn't exist yet: dry-run of irreversible actions,
claim-vs-corpus entailment, a rubric judge seat, and a provenance-bearing trusted
corpus.

## Proposal (one sentence)

Make OpenSidebar "verifiable hands": a headless-capable runtime library
(`createAgentRuntime(env)`) where perception, action, and verification are peer
subsystems behind typed ports, completion has exactly one authority (the contract
kernel driving a pure-policy pipeline), and every HIGH-risk mutation passes
dry-run → evidence → diff → approve → commit.

## Measured baseline (explored 2026-07-05)

- Both clients already converge on `orchestrator.startTask` (sidepanel via
  background.ts:1345, OpenClaw via browser-bridge/orchestrator-driver.ts:84) —
  that is the natural library API.
- The kernel is clean; the coupled part is the loop-side guard methods. Extraction
  recipe proven by the existing `*-policy.ts` pattern (pure `assess(input) →
  TypedDecision`) and the narrow-host pattern (`RegionZoomHost`, ~12 typed members);
  the anti-pattern to avoid is `AgentLoopToolHandlerHost` (~40 members, `any`).
- Most turn-scoped state lives as locals inside `loop()`; instance fields are
  session-scoped — good news for a TurnState struct.
- The three memory stores (personal-profile, website-skills, extracted-fact-map)
  have unifiable CRUD shapes; only extracted-fact-map lacks provenance entirely.
- `mutation-ledger.ts` (201 lines) already fingerprints DOM state and
  short-circuits replays — the sealing mechanism for dry-run commits exists.

## Branch/PR sequence

All branches cut from post-v0.3.0, post-perception-merge main. Each PR lands
verify-green (`corepack pnpm run verify`); e2e always via `extension:build-e2e` /
dist-dev, never prod dist.

| # | Branch | Goal | Size | Risk | E2E |
|---|--------|------|------|------|-----|
| 0 | `refactor/completion-golden-harness` | Completion-decision recording + replay corpus | M | Low | easy (records corpus) |
| 1 | `refactor/loop-metrics-extract` | AgentTelemetryController (~11 methods off loop) | S | Low | unit+golden |
| 2 | `refactor/loop-checkpoint-coordinator` | CheckpointCoordinator owning MutationLedger (~7 methods) | S | Low | easy |
| 3 | `refactor/persistence-port-adoption` | All chrome.storage → PersistencePort + versioned-store helper | M | Low | easy |
| 4a | `refactor/env-messaging-events` | RuntimeMessagingPort, NavigationEventsPort, SchedulerPort | M | Med | easy |
| 4b | `refactor/env-tool-ports` | 7 API-family ports; migrate tools/, infrastructure/, loop, loop-tool-handlers | L | Med | medium |
| 4c | `refactor/env-peripheral-ports` | NotificationsPort, AudioCapturePort; workspaces/notifications/speech/warmup/servicenow | M | Med | medium |
| 5 | `refactor/runtime-composition-root` | createAgentRuntime(env); background.ts = shell; fake-port kit; delete global.chrome; headless smoke | M | Med | medium |
| 6 | `refactor/turn-state-escalation-perception` | TurnState struct; EscalationTierController; PerceptionCoordinator | M | Med | medium |
| 7a | `refactor/completion-pipeline-shadow` | Guards → pure policies; ordered runner in SHADOW mode | L | Med | medium + divergence assert |
| 7b | `refactor/completion-pipeline-flip` | Pipeline becomes authority; delete legacy chain | M | **High** | full staged (easy→hard) |
| 8 | `feat/dry-run-commit-protocol` | extract_form_state; dry-run→diff→approve→commit; ledger sealing | L | High | hard + NEW form fixture |
| 9 | `feat/trusted-corpus-store` | Unified corpus store + provenance; migrate 3 legacy stores | M | Med | medium |
| 10 | `feat/entailment-judge-seat` | Judge model seat; entailment gate; risk routing | M | Med | hard + NEW claims fixture |
| 11 | `refactor/turn-state-machine` | loop() → phase driver (~150 lines); TurnContext replaces host casts | L | High | full staged + golden v2 |
| 12 | `refactor/servicenow-workflow-adapter` | ~35-method trusted-workflow cluster → servicenow adapter | L | Med | hard (SN fixtures) |

Parallelizable: 3/4a alongside 1/2 (disjoint files). Dependencies: 7a needs
0+1+2+6; 8 needs 7b; 9 needs 3; 10 needs 8+9; 11 needs 7b; 12 needs 7b+8 and
trails.

Sequencing rationale: (1) the guard extraction is done once, as completion-pipeline
work, never twice — it is simultaneously C-B station 1 and C-C's biggest cluster;
(2) PersistencePort adoption is a hard prerequisite for the corpus store; (3) the
cheapest loop extractions land first so the riskiest phase diffs against a smaller
loop.ts, and the golden harness lands before anything touches completion.

## Phase essentials

### Phase 0 — Golden harness
Tap the single choke point `AgentLoop.handleDoneToolCall` (loop.ts:2801): serialize
the full input surface (userRequest, summary, snapshot + digest, evidence-ledger
contents, counters `doneRejections` / `consecutiveSameKindRejections` /
`lastContractRejectionKind`, plan-validation input, workflow-control state) and the
decision (verdict, contractKind, guardId, reason, recoveryHint) into
`CompletionDecisionRecord` (new `agent/completion/decision-record.ts`,
recordVersion field). Recording behind dev flag
`opensidebar:recordCompletionDecisions`; exported via e2e helpers to
`tests/fixtures/completion-corpus/*.json`. Corpus: one easy+medium recorded run
(~50–200 records) covering all 6 contract kinds, kernel-accept, kernel-reject, the
same-kind-bounce bypass, and fallthrough `legacy_done_guards`; plus 3–4 hand-built
rare-path records (moneyTable, workflowContract). Deliverable:
`tests/unit/completion-replay.test.ts` asserting byte-identical decisions.

### Phases 1–2 — Cheap loop extractions
- `agent/agent-telemetry-controller.ts`: `AgentTelemetryController` class (pattern:
  StagnationMonitor); bodies already live in loop-metrics.ts/agent-telemetry.ts —
  convert host-cast wrappers into one field, inline call sites, delete ~11 methods.
- `agent/checkpoint-coordinator.ts`: `CheckpointCoordinator` owning MutationLedger
  (absorbs the replay lookup at loop.ts:1289, the record path from
  loop-tool-handlers.ts, the two-tier ephemeral behavior, and turn-checkpoint
  persist/restore). Constructor takes `PersistencePort` from day one (chrome impl
  until Phase 5). Owning the ledger here is deliberate: Phase 8 seals dry-run
  commits through this coordinator.

### Phase 3 — PersistencePort adoption
Add `onChanged(listener): () => void` to `PersistenceStorageArea`. New
`environment/versioned-store.ts`: `createVersionedStore<T>(area, key, {version,
migrate})` → `{load, save, update, remove}`. Migrate the ~10 direct runtime
chrome.storage callers + the utils wrappers (settings-storage, personal-profile,
website-skills) via an optional port param defaulting to the chrome impl. Sidepanel
write paths untouched (UI never imports background code). Encrypted profile notes
pass through as opaque bytes. The first in-memory port fake lands here and seeds
the Phase 5 test kit.

### Phases 4a–4c — Port families (12 new ports, NO god port)
A monolithic ToolEnvironmentPort would reproduce the AgentLoopToolHandlerHost
anti-pattern. Family split:
- 4a: `RuntimeMessagingPort` {broadcast, request, onMessage} — TASK_COMPLETION and
  the OpenClaw workspaceId correlation move onto it; `NavigationEventsPort`
  {onCommitted, onCompleted, onHistoryStateUpdated} (infrastructure/navigation.ts's
  15 refs); `SchedulerPort` {createAlarm, clearAlarm, onAlarm, keepAlive}
  (keepalive.ts).
- 4b: `DownloadsPort`, `CookiesPort`, `HistoryPort`, `SearchPort`, `TabGroupsPort`,
  `WindowsPort`, `PermissionsPort`; `ContentBridgePort` gains
  `executeFunction<T>(tabId, fn, args)` for scripting.executeScript{func}. Tools
  receive ports through the existing tool-execution context (one plumbing change,
  then tools/index.ts's 45 refs migrate tool-by-tool); servicenow/ receives ports
  via the same context, preserving the never-import-tools/index quarantine. No tool
  schema changes. Aggregate `RuntimeEnvironment` interface (a bundle of ports, for
  injection only).
- 4c: `NotificationsPort`, `AudioCapturePort` (chrome impl hides
  tabCapture+offscreen); migrate notifications.ts (21), speech/tab-audio.ts (9),
  perception/warmup.ts (8), workspaces/manager.ts (41 — mostly consumes 4b's
  ports). Speech has no e2e — manual smoke, noted gap.

Stays chrome-direct in the shell: chrome.sidePanel, onInstalled, extension
lifecycle in background.ts.

### Phase 5 — Composition root + headless proof
New `background/runtime.ts`: `createAgentRuntime(env: RuntimeEnvironment, config):
AgentRuntime` exposing `{orchestrator.startTask, onTaskCompletion, dispose}`.
background.ts (59 refs, stays shell) builds `createChromeEnvironment()` and routes
handleUserChat into the runtime; browser-bridge/orchestrator-driver.ts takes
`AgentRuntime` instead of importing the orchestrator — sidepanel and OpenClaw
become literal peers. New `tests/fakes/environment.ts`
(`createFakeEnvironment(overrides?)`: Map-backed persistence, scripted
page/content ports modeled on the proven puppeteer port in
tests/e2e/helpers/overlay-page-port.ts, event-emitter messaging). Migrate unit
suites off `global.chrome`; delete the tests/setup.ts chrome fake; add a lint/grep
ban on `chrome.` outside environment/chrome.ts + background.ts + UI. Headless
smoke `tests/headless/runtime-smoke.test.ts`: fake env + local-mock-provider,
scripted 3-step task, assert TASK_COMPLETION on the fake messaging port +
kernel-accepted envelope + `globalThis.chrome === undefined` canary.

### Phase 6 — TurnState + two controllers
`agent/turn-state.ts`: struct capturing the loop() locals (orientationPhase,
recentSuccesses, toolFailCounts, recentToolCalls, discoveredTagIds,
resultPageProgress). `agent/escalation-tier-controller.ts` (absorbs ~8 methods +
escalationTier/cooldown locals; `onTurnStart(signals) → EscalationDirective`,
`recordOutcome`). `agent/perception-coordinator.ts` (absorbs ~14 methods incl.
refreshPerceptionAndTriage; port-injected). Pin with a unit test the invariant
that perception refresh runs at the END of an iteration (it feeds the NEXT turn's
snapshot) — after the completion check, never before. Lands after the
perception-stack merge so the coordinator wraps the final surface once.

### Phases 7a/7b — Completion pipeline (the critical phases)
Single decision object `CompletionPipelineDecision` {verdict, basis:
"kernel" | "kernel_bypass_legacy" | "legacy_done_guards", contractKind,
rejectedBy: CompletionGuardId, reason, recoveryHint, effects:
CompletionEffect[]} — ALL state mutations become declarative effects
({increment_done_rejections}, {set_rejection_kind}, {post_context_message},
{emit_trace}, {escalation_rescue}), applied by a ~40-line loop-side
`applyCompletionEffects` shim.

Runner `agent/completion/pipeline.ts` preserves the measured order EXACTLY:
idempotency → summary/grounding preflights → kernel
(evaluateGeneratedCompletionCandidate; accept → return basis "kernel"; reject →
same-kind-bounce bypass check — port the exact counter semantics at
loop.ts:2871-2879 incl. the `completion_contract_bypassed` trace; do NOT restate
the threshold from memory) → legacy policies in fixed order (max-rejections gate,
grounding-read, moneyTable, earlyMultiStep, taskContract, workflowContract,
listDetailReview) → planner precheck/validation via injected async
`deps.plannerValidator` (the only model-calling stage; stubbed in replay) →
pendingAutocomplete → missingRequiredEvidence → fallthrough accept
"legacy_done_guards".

Guard files (pure `assess(input) → GuardOutcome`, ≤300 lines each):
`agent/completion/guards/{rejection-budget,grounding,contract,domain,planner}-guards.ts`.

7a runs the pipeline in SHADOW (legacy still decides; divergence emits a
`completion_pipeline_divergence` trace and fails the replay test). 7b flips
authority, deletes `rejectDoneBeforePlanValidation` (loop.ts:1942) + the
`rejectDoneFor*` family + shadow plumbing (~40 methods out of loop.ts), and
re-records corpus v2 from a hard-tier run. Kernel-file rule: completion-kernel.ts
is FROZEN — its 5 public functions (generateCompletionContract,
deriveCompletionEvidenceFromToolOutcome, deriveCompletionEvidenceFromSnapshot,
evaluateCompletionContract, buildCompletionRecoveryHint) are the contract; wrap
via completion-evaluation-service.ts-style adapters; splitting the 14K facade is
explicitly out of scope.

### Phase 8 — Dry-run → diff → approve → commit
Scope: tools in RiskLevel.HIGH ∩ MUTATION_SENSITIVE_TOOLS (metadata.ts) doing
form/record writes; new metadata axis `supportsDryRun: boolean`; rollout starts
with form submit only (servicenow writes join in Phase 12).
`extract_form_state`: content action + LOW-risk read-only tool (names synchronized
across the three layers per CLAUDE.md) returning {formKey, fields[{name, selector,
kind, value, disabled}], submitTargets}. New CompletionEvidence union member
`form_state_captured` (logicalKey `form:${formKey}`, dedups in the ledger).
orchestrator/verifier.ts `programmaticVerify` gains a structural `formStateDelta`
alongside today's coarse urlChanged||titleChanged.
Protocol in new `agent/mutation-dry-run-policy.ts`, invoked from
sequential-pre-tool-gate.ts next to ensureToolApproval: ticket → auto-injected
extract_form_state → pure `diffFormStateAgainstDraft(captured, draft)` against the
approved-draft artifact (DraftOnly contract payload or confirmed plan field map) →
unexpected diff routes to approval-policy.ts with the rendered diff; a clean diff
on a pre-approved draft auto-approves → commit → post-commit re-capture →
CheckpointCoordinator.recordMutation seals {fingerprint, formKey, diffHash,
ticketId}. NEW e2e fixture: multi-field form + confirmation page, hard tier.

### Phase 9 — Trusted-corpus store
`background/memory/trusted-corpus.ts`: `TrustedCorpusEntry` {id, kind:
personal_profile_fact | website_skill | extracted_fact, claimKey, scope{origin,
pathPattern}, value (opaque; encrypted stays CEK-wrapped), encrypted, provenance
{source: user_input | analyzer | tool_output | observation, url, sourceQuote,
taskId, nodeId, toolCallId, capturedAt, provider, model}, confidence, version,
timestamps}. `createTrustedCorpusStore(persistence)` on key
`opensidebar:trustedCorpus` via Phase 3's versioned-store. Lazy reversible
migration: first query transforms personalProfile + userWebsiteSkills; legacy keys
kept one release; the profile sidepanel write path is unchanged and the corpus
re-syncs via onChanged; decryption stays in personal-profile's CEK code.
extracted-fact-map lifts out of the checkpoint blob: the producer
(orchestrator/index.ts:1552) writes corpus entries WITH provenance (the fields it
lacks today); handoff.ts:249 reads briefs from the corpus;
structuredProgress["extracted-facts"] shadows for one release, then dies.

### Phase 10 — Entailment gate + judge seat
Judge = new model seat in llm/ (already chrome-clean) beside
planner/executor/perception/writer. `agent/completion/entailment-gate.ts`: pure
pre-filter matching claims against corpus claimKeys; only unresolved claims reach
the model. `agent/completion/judge.ts`: `runRubricJudge(rubric{claim, criteria[{id,
description, required}], evidence, corpusFacts}, seat) → JudgeVerdict{pass,
perCriterion, entailment[{claimKey, entailed | contradicted | unsupported}],
confidence}`. Rubric criteria must be OUTCOME-grounded, not process quotas (lesson
from the LP-11 validator failures). Risk routing (the first non-approval consumer
of RiskLevel): LOW → kernel contract only (zero added latency); MEDIUM → +
structural evidence check; HIGH → + entailment + judge + human per
approval-policy.ts when the judge fails or finds a contradiction. Wire:
programmaticVerify gains a riskTier param; accept|retry|reroute consumes
JudgeVerdict. Verdict cache keyed hash(claimKey + evidence digest); cheap fast
model on the seat; hard timeouts; fail-open-to-human. NEW e2e claims fixture: a
page contradicting a seeded corpus entry; hard tier asserts reroute/human-gate.

### Phase 11 — Turn state machine
`agent/turn-machine.ts`: `TurnPhaseId` = gates | escalation | feedback |
prepare_model_turn | dispatch_tools | post_tool_guards | plan_monitor | completion
| account_and_refresh (matches the measured iteration order). `TurnPhase.run(ctx)
→ {continue | skip_to | end_turn | end_task}`. `TurnContext` {state: TurnState,
escalation, perception, checkpoints, telemetry, completion pipeline facade, env,
typed narrow accessors} replaces the 8 host interfaces / 32 `this as unknown as X`
casts. Existing loop-turn-preparation.ts / turn-retry.ts /
loop-response-processing.ts become prepare_model_turn's body; the dispatch hosts
become dispatch_tools. loop() → ~150-line driver.
Continuous-extraction ratchet: `scripts/loop-ratchet.mjs` in the lint step of
verify against a checked-in `scripts/loop-ratchet-budget.json` (budgets only go
down); CLAUDE.md landmine section extended; PR-template checklist line.
End-state targets: loop.ts ≤ 3,500 lines, AgentLoop ≤ 80 methods, loop() ≤ 200
lines. Phase-order pinning test: account_and_refresh strictly after completion.

### Phase 12 — ServiceNow trusted-workflow adapter
The ~35-method cluster moves to `servicenow/trusted-workflow-adapter.ts` behind a
domain interface consumed via the tool context (quarantine preserved: never
imports tools/index.ts). Plugs into workflow-control-state.ts, the
WorkflowConfirmation contract, and Phase 8's dry-run for SN write tools.
Hard-tier SN fixtures.

## Validation strategy

- Pure refactors (1, 2, 3, 4a–c, 5, 6, 11): verify green + golden replay
  unchanged + the listed e2e tier; port phases get per-port fake unit suites.
- Completion (7a/7b): zero-divergence shadow gate on corpus v1 → minimal-diff
  flip → corpus v2 re-record; divergence trace assertion wired into the e2e
  harness.
- New behavior (8, 10): the two new fixtures (form-submit, claims), hard tier,
  dist-dev only.
- Store migration (9): unit tests per legacy shape; one-release dual-read shadow.
- Continuous: loop-ratchet from Phase 11; `chrome.` grep/lint ban from Phase 5.

## Risks

1. **Completion semantics drift** (bypass counter, max-rejections interplay) →
   golden corpus before any change; shadow zero-divergence gate; effects-as-data;
   the flip is a minimal diff.
2. **Rebase burn on loop.ts** → strict ordering, short-lived branches, cheapest
   extractions first, an announced loop.ts freeze during 7a/7b; guard files are
   NEW files (conflict-free adds), loop-side diffs are deletions.
3. **MV3 SW lifetime vs new async layers** (judge calls, dry-run round-trips) →
   SchedulerPort.keepAlive around long awaits; checkpoint before judge/dry-run
   awaits; judge hard timeout, fail-open to human approval.
4. **Entailment/judge latency + cost** → risk routing (LOW pays nothing), pure
   pre-filter, verdict cache, cheap model on the seat.
5. **Scope creep into completion-kernel.ts (14K)** → kernel declared frozen; its
   5 public functions are the contract; the facade split is explicitly out of
   scope for all 13 phases.

## Explicitly out of scope

v0.3.0 launch mechanics (user-only); perception LP-12 Phase B / LP-14; Mind2Web
rerun; GLM-5.2 planner eval; dropping the backend durability ledger (separate,
already-decided cleanup — can ride Phase 3 or land independently).

## Decision

Status: Approved

Chosen path:

- Full four-station verification subsystem (contracts, evidence, entailment,
  judge) including the provenance-bearing trusted-corpus store.
- Full chrome.* extraction behind family-split ports; only background.ts stays
  chrome-direct as the extension shell.
- The 13-phase branch sequence above, cheapest loop extractions first, completion
  flip via shadow mode, golden replay harness before any completion change.

Required edits before implementation:

- Execution blocked until v0.3.0 ships and the 7-branch perception stack merges
  to main; all branches cut from post-merge main.

Non-blocking follow-ups:

- Splitting the completion-kernel.ts facade (ratchet candidate only).
- E2E coverage for speech (currently manual smoke only).
- Removing the legacy useVLExecutor option.

Do not do:

- No monolithic ToolEnvironmentPort (family-split ports only).
- No edits to completion-kernel.ts's five public functions — the kernel is frozen
  for all 13 phases.
- No completion-authority flip (7b) without a zero-divergence shadow gate on the
  golden corpus.
- No e2e against prod dist/ — dist-dev via extension:build-e2e only.

Evidence required before merge:

- Per the Validation strategy section: golden-replay parity for every refactor
  phase, zero-divergence shadow gate then corpus v2 for the completion flip,
  headless runtime smoke for the composition root, the form-submit and claims
  fixtures at hard tier for dry-run and entailment/judge, and staged e2e at each
  phase's listed tier with verify green throughout.

Next action:

- Implement (first branch `refactor/completion-golden-harness`, cut from
  post-merge main)
