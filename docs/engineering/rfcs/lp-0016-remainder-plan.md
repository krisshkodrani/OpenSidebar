# LP-16 Landmine Decomposition — Remainder Execution Plan

**Status:** Phases 0, 1, 2, 4, 5 complete + tested and **merged** (PR #76 → `chore/settings-provider-demo`, merge commit `fce585f0`, 68 verified commits, full `verify` EXIT=0, 4,531 tests). Phase 3 is partial. This document scopes the remaining work.

Companion to the RFC: [`lp-0016-landmine-decomposition.md`](./lp-0016-landmine-decomposition.md). Progress notes live in memory `lp16_implementation.md`.

## 1. Where things stand (post-merge)

| Landmine | Start | Merged | Result |
| --- | --- | --- | --- |
| `tools/index.ts` | 6,801 | **146** | eliminated |
| `orchestrator/skills.ts` | 3,997 | **1,350** | eliminated |
| `completion-kernel.ts` | 14,403 | **5,891** | −59%, split by contract kind |
| `orchestrator/index.ts` | 6,703 | **5,786** | all per-workspace state behind controllers |
| `agent/loop.ts` | 10,309 | **9,056** | −12%; 5/9 turn phases + all self-contained subsystems relocated |

**Phase 3 done so far:** 5/9 turn phases extracted (`gates`, `escalation`, `feedback`, `prepare_model_turn`, `plan_monitor`) plus the whole done-against-active-plan subsystem (`done-plan-rejection`, `done-plan-validation`, `done-diagnostics`), `turn-checkpoint`, `shadow-completion`, and `navigate-guard` — each a behavior-preserving dispatch-host relocation.

## 2. Remainder — four items

### A. Phase 3 driver-flip (the one blocking item) — **needs headed-Chrome e2e**

**Goal.** Extract the remaining 4 turn phases (`dispatch_tools`, `post_tool_guards`, `completion`, `account_and_refresh`) from `loop()` (~2,344 lines). They cannot be extracted as clean phases today because `loop()` holds ~30 mutable turn-locals that the phases read/write plus mid-block `continue`/`break`/`return`. The enabling refactor is the **driver-flip**: convert `loop()` into a thin driver over a `TurnContext` that holds the per-turn state.

**Why it is genuinely e2e-gated (not a false blocker).** The extraction is only behavior-preserving if every local is placed in the correct scope, and a miscategorization passes the mock unit suite (175 `agent.test.ts` tests) but fails at runtime. Two scopes, determinable from the declaration site:

- **Session-scoped** (declared *before* the `while`, persist across turns): `tabId`, `prevElementCount`, `consecutiveTextOnly`, `totalTextOnly`, `doneSummary`, `esc`, `previousBudgetUrgencyLevel`, `consecutiveAllFailTurns`, `consecutiveAllFailDeterministicTurns`, `turnState`, `verifiedFinalClickBypassKeys`, `blockedActions`, `turnsSinceStepEscalation`, `consecutiveExplorationTurns`, `consecutiveBlindToolTurns`, `lastReadElementId`, `consecutiveReadElementSameId`, `recentOutcomes`, `recentObservationProgressKeys`, `subgoalAttempts`, `serviceNowMissingFieldSearchEvidence`, `lastActionMemoryPlanIndex` → become **driver-level state** (a `LoopSession` object or `this._` fields), NOT reset per turn.
- **Turn-scoped** (declared *inside* the `while`): `response`, `doneSignaled`, `domModified`, `visuallyModified`, `lastDomAffectingToolName`, `missingFieldAdmissionSummary`, `effectiveToolCalls`, … → become **`TurnContext` fields**, freshly constructed at the top of each iteration.

**Approach (staged, each stage full-suite-green + headed-e2e-validated):**
1. **Introduce `TurnContext`** — a class constructed at the top of each `while` iteration holding the turn-scoped locals with their current initial values. Replace in-loop reads/writes with `ctx.x`. No phase extraction yet; pure local→field move. Validate: unit suite + `test:e2e:easy`.
2. **Introduce `LoopSession`** (or promote to `this._session`) for the session-scoped locals; the `while` loops over `session`. Validate: unit + `easy`.
3. **Encode control flow as results.** Replace mid-block `continue`/`break`/`return` in the dispatch region with a `TurnPhaseResult` union (`continue` | `break` | `end_task(result)` | `proceed`). Validate: unit + `easy` → `medium`.
4. **Extract the 4 phases** one at a time via the existing dispatch-host idiom (`runDispatchToolsPhase(ctx, session, host)` etc.), loop() becoming a driver that sequences them and interprets their results. Validate each: unit + `easy` → `medium` → `hard`.

**Verification (mandatory, in order).** `pnpm run verify` (unit) after every commit, **then** `pnpm run test:e2e:easy → :medium → :hard` (needs `API key` + headed Chrome) after each stage — this is the only check that distinguishes a correct flip from a subtly-wrong one. Ratchet: `loop()` target `loopMethodLines` 200, `loop.ts` `fileLines` 3,500, `methodCount` 80 (per budget-json end-state).

**Risk / effort.** High risk (state-layout change), ~4 staged PRs, e2e-gated. Do NOT land unit-only.

### B. Pre-flip `loop.ts` relocations (optional, no e2e) — **safe, do anytime**

A clean vein of single-caller behavior-preserving relocations remains (verified by `scan by distinctThis`): `recordCompletionDecisionOutcome`, `acceptFromPipelineDecision`, `refreshSnapshot`, `getWorkflowTabToolRedirect`, `captureScreenshotForVLExecutor`, and similar. Each ~40–90 lines, dispatch-host idiom, full-suite-verified, ratchet-tightened. These shrink `loop.ts` further before the flip but do **not** close Phase 3. Reusable scripts + gotchas are in memory `lp16_implementation.md` (watch `(agent as any).X` test call sites + test-helper re-exports — both caught by the full suite).

### C. RFC-deferred: ServiceNow record-form controller (LP-15 Phase 12) — **out of LP-16 scope**

~1,140 lines of SN record-form behavior still in `loop.ts`. Detachment is deferred to the LP-15 runtime-as-library injection work (the injected page scripts need a new injection mechanism to import adapter code). Track under LP-15, not LP-16.

### D. Path to `main`

LP-16 now rides on `chore/settings-provider-demo`. **PR #75 (`chore/settings-provider-demo` → `main`, OPEN)** carries the demo tooling; when it merges, the LP-16 work reaches `main` with it. Alternatively, cut a fresh PR retargeting just the LP-16 commit range to `main` if the demo work needs to land separately.

## 3. Sequencing

1. **Now (no e2e):** optionally continue item **B** to shrink `loop.ts` further; land PR #75 to carry LP-16 to `main` (item **D**).
2. **With headed-Chrome e2e:** execute item **A** stages 1→4, each e2e-validated. This completes Phase 3 and thus all 6 LP-16 phases.
3. **Under LP-15:** item **C** (SN controller detachment).

## 4. Acceptance for "Phase 3 complete"

- All 9 turn phases live in `agent/turn-phases/` (or dispatch-host modules); `loop()` is a driver.
- `loop.ts` ratchet at/under end-state budget; `loopMethodLines` ≤ 200.
- Full `verify` green **and** `test:e2e:easy/medium/hard` green on the branch.
