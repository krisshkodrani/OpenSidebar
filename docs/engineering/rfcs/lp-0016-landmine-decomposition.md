# RFC LP-16 — Landmine Decomposition: Ratchet Everything, Split the Giants, One Completion Authority

Lifecycle status: Draft (Recommended Decision only — not owner-stamped)
Date: 2026-07-08
Scope: `scripts/loop-ratchet.mjs` (generalized to a multi-file decomposition
ratchet), `background/agent/` (completion-kernel.ts split, loop.ts turn-machine
completion, legacy completion-guard absorption), `background/tools/`
(index.ts family split, SN-residue quarantine), `background/orchestrator/`
(index.ts decomposition), CLAUDE.md landmines section
Related: LP-15 (three consolidations — this RFC executes its deferred
decomposition follow-ups: loop()→driver, 32-cast retirement, ratchet
tightening), LP-15 Phase 7b (completion authority flip), LP-15 Phase 11
(turn-machine foundation), LP-15 Phase 12 (SN adapter quarantine),
AGENTS.md change-placement policy

## Problem

Four files carry a "landmine" warning in CLAUDE.md because they are
simultaneously the largest and the most-churned surfaces in the repo
(completion-kernel.ts and its test file are the #1/#2 most-touched files in
all of git history at 462/472 commits; loop.ts is #3 at 201+101):

1. `background/agent/completion-kernel.ts` — 14,402 lines. Only 10 exports;
   internally clean pure `generate*`/`evaluate*` pairs per contract kind. Big
   but mechanically splittable, and nothing guards its size today.
2. `background/agent/loop.ts` — 10,309 lines, 187 methods, 2,467-line
   `loop()`. Under the LP-15 Phase 11 ratchet, but only 2 of 9 declared turn
   phases (`prepare_model_turn`, `gates`) are extracted. End-state targets:
   3,500 / 80 / 200.
3. `background/tools/index.ts` — 6,800 lines. One giant `registerTools()`
   with inline handlers, plus leftover ServiceNow residue (injected Glide
   scripts, KB fetch, list-action handlers) that could not move into the
   adapter.
4. `background/orchestrator/index.ts` — 6,702 lines, 112-method class,
   preceded by ~670 lines of free functions.

A fifth landmine is behavioral, not size: completion logic is still split.
LP-15 Phase 7b made the pipeline the single authority, but the legacy guard
chain survives inside loop.ts as injected callbacks (kernel-reject / planner),
so touching completion still means reasoning about two files.

The ratchet mechanism works — loop.ts is the only landmine that shrank
(10,616 → 10,309) — but it covers one file out of four. Everything else can
still grow unbounded.

## Proposal (one sentence)

Extend the proven loop-ratchet to all four giants so no landmine can grow,
then decompose each along its measured internal seams in small verify-green
pure-movement PRs — kernel by contract kind, loop by turn phase, tools by
tool family, orchestrator by responsibility — absorbing the legacy completion
guards into the pipeline along the way, until the CLAUDE.md landmines section
can be deleted because it no longer describes anything.

## Measured baseline (explored 2026-07-08)

- Ratchet report: `{fileLines: 10309, methodCount: 187, loopMethodLines: 2467}`
  vs end-state budget targets 3,500 / 80 / 200. Budgets are monotonic-down and
  enforced in the lint step.
- completion-kernel.ts exports exactly 10 symbols. Its body is organized as
  per-kind pairs — `generateQuizSelectionContract`/`evaluateQuizSelection`,
  form-fill, draft-only, navigation, read-answer, workflow-confirmation —
  plus shared evidence/label helpers. `agent/completion/` already exists
  (workflow-confirmation-types lives there), so the split has a home.
- `agent/turn-machine.ts` declares all nine phase IDs in `TURN_PHASE_ORDER`:
  gates, escalation, feedback, prepare_model_turn, dispatch_tools,
  post_tool_guards, plan_monitor, completion, account_and_refresh. Seven
  remain unextracted; account_and_refresh is scattered across 8 exit paths
  (the known hard case, per LP-15 Phase 11).
- tools/index.ts already contains the target idiom: the two SN tools register
  via imported `registerXxx(toolRegistry)` functions while every generic tool
  registers inline inside `registerTools()`. The split is "make everything
  look like the SN registration".
- orchestrator/index.ts opens with ~670 lines of free functions
  (navigation-goal heuristics, plan-state builders) before the class begins —
  pure moves with zero coupling risk.
- Safety nets in place from LP-15: the Phase-0 golden harness and
  zero-divergence gate over completion, the deterministic
  orchestrator-integration test over reroute/fallback building, and the
  turn-machine pinning test.

## Standing rules (every phase, every PR)

- Pure code movement: no behavior change, no public-symbol renames, no API
  changes.
- One extraction per PR, roughly ≤1,000 moved lines — small is success.
- `pnpm run verify` green before merge; no PR opens otherwise.
- The ratchet budget for the touched file is tightened in the same PR as the
  extraction, with before/after numbers in the PR description.
- Phase-11 lesson applies throughout: invoke host methods via arrow functions;
  bare `host.method` references lose `this`.

## Phase 0 — Guardrails everywhere (1 PR)

Generalize `scripts/loop-ratchet.mjs` into a decomposition ratchet driven by a
budget map keyed by file. Keep the three loop.ts metrics; add `fileLines`
budgets at current size for completion-kernel.ts (14,402), tools/index.ts
(6,800), orchestrator/index.ts (6,702), and orchestrator/skills.ts (3,997).
Same lint-step wiring, same monotonic-down rule. Update CLAUDE.md and the PR
template. From this point no landmine can grow and every later extraction is
locked in.

## Phase 1 — Split the completion kernel by contract kind (~5 PRs)

Extract one module per contract kind into `agent/completion/` —
`quiz-selection-contract.ts`, `form-fill-contract.ts`,
`draft-only-contract.ts`, `navigation-contract.ts`,
`read-answer-contract.ts`, `workflow-confirmation-contract.ts` — each
carrying its private helpers, plus `contract-shared.ts` for the common
evidence/label utilities. completion-kernel.ts becomes a façade re-exporting
the same 10 symbols. Split `completion-kernel.test.ts` (472 touches, 7.9K
lines as the repo's largest churn magnet) to mirror the new modules in the
same PRs. The golden harness and zero-divergence gate make each move
verifiable.

Exit: façade + shared ≤ ~1.5K lines; no kind module above ~2.5K.

## Phase 2 — One completion authority (1–2 PRs)

Absorb the legacy guard callbacks injected into the pipeline by Phase 7b
(kernel-reject / planner) into proper pipeline stages — they are already
effects-as-data-shaped — so the loop's completion step becomes a thin
`runCompletionPipeline` call. This is the point where the "completion logic
is split between two files" landmine is deleted, not reworded. Must land
before Phase 3 extracts the `completion` turn phase, so we do not extract
code that is about to be absorbed.

## Phase 3 — Finish the loop.ts turn machine (~8–10 PRs)

Extract the remaining seven phases in coupling order:
feedback → escalation → plan_monitor → post_tool_guards → dispatch_tools →
completion (after Phase 2) → account_and_refresh last. For
account_and_refresh, first normalize all 8 exit paths through a single
exit-builder helper, then extract — converting the known hard case into a
mechanical one. Once all nine phases exist, replace the `loop()` body with a
driver over `TURN_PHASE_ORDER` executing `TurnPhaseResult`s; then retire the
32 `this as unknown as XHost` casts and burn method count down via the
existing `*-policy.ts` idiom (narrow hosts like `RegionZoomHost`, never
another `AgentLoopToolHandlerHost`).

Exit: the ratchet end-state — 3,500 lines / 80 methods / 200-line `loop()`.

## Phase 4 — Split tools/index.ts by tool family (~3 PRs)

Extract `register-interaction.ts`, `register-navigation.ts`,
`register-tabs.ts`, `register-downloads.ts`, `register-page-inspection.ts`
(etc.), each exporting `registerXxx(toolRegistry)` exactly like the existing
SN registration; `index.ts` shrinks to imports plus ordered register calls.
Quarantine the remaining SN residue — injected Glide page scripts, KB fetch,
list-action handlers — into one clearly-named `servicenow-injected` module:
it is genuinely blocked on the LP-15 runtime-as-library injection mechanism
(injected scripts are serialized into the page and cannot import adapter
code), so we label it rather than fight it. The one-way rule holds: adapter
modules never import the barrel.

Exit: tools/index.ts ≤ ~1K lines.

## Phase 5 — Decompose the orchestrator (~3–4 PRs)

First the pure moves: the ~670 lines of free functions become
`orchestrator/navigation-goal-heuristics.ts` and `orchestrator/plan-state.ts`.
Then split the 112-method class along its visible seams: node scheduling /
parallel workers (max-workers, horizon expansion), reroute + fallback plan
building (protected by the deterministic CI integration test from the
create-incident fix), and completion-envelope handling. The SN behavior in
skills.ts stays deferred to the SN-detach follow-up but is ratchet-guarded
from Phase 0.

Exit: orchestrator/index.ts ≤ ~3K lines.

## Phase 6 — De-list the landmines (1 PR)

Rewrite the CLAUDE.md landmines section to match reality as each file crosses
its target; delete warnings that no longer apply (per the repo's stale-copy
rule). Pin the ratchet at end-state budgets as a permanent size guard rather
than a decomposition tool.

## Sequencing and parallelism

~20–27 small verify-green PRs total. Phases 1, 3, 4, and 5 touch disjoint
files and can run in parallel on separate branches once Phase 0 lands. Hard
ordering constraints: Phase 0 first; Phase 2 before Phase 3's `completion`
phase extraction. Phase 6 trails whichever file finishes last.

## Risks

- **Churn collision:** completion-kernel.ts and loop.ts are the most-churned
  files in the repo; long-lived decomposition branches will conflict with
  feature work. Mitigation: every PR is small, pure movement, and merges
  fast — decomposition never sits unmerged for more than a day or two.
- **Façade drift:** after Phase 1, new completion code could accrete in the
  façade instead of the kind modules. Mitigation: the Phase-0 ratchet budget
  on completion-kernel.ts keeps the façade at its post-split size.
- **Test-split fidelity:** splitting completion-kernel.test.ts risks silently
  dropping cases. Mitigation: assert the total test count is identical
  before/after in each split PR, and rely on the zero-divergence golden gate.
- **account_and_refresh:** the 8-exit-path extraction is the one place pure
  movement is impossible; the exit-builder normalization step is a small
  behavior-preserving refactor that must be reviewed as such, with the
  turn-machine pinning test extended to cover it first.

## Recommended Decision

> This is an agent recommendation, not an owner Decision Stamp. Per
> `rfc-decision-process.md`, no implementation may begin until the owner records
> a `## Decision` stamp.

Recommended status: **Approved**

Chosen path (recommended):

- All six phases as written, ~20–27 small verify-green pure-movement PRs.
- Phase 0 (multi-file ratchet) lands first and immediately — one PR, no
  behavioral surface.
- Phases 1 and 3 run as the priority track (the two files that are both
  largest and most-churned); Phases 4 and 5 interleave as parallel branches
  whenever the priority track is blocked on review.
- No feature freeze — the pure-movement rule plus fast merges keeps
  decomposition from colliding with feature work.

Recommended edits before implementation:

- Owner decides: (a) whether Phase 1 keeps the completion-kernel façade
  permanently or flips importers to deep imports in a follow-up; (b) whether
  Phase 3's final `loop()`→driver flip lands as one PR or split per
  phase-group.

Recommended do-not-do:

- No behavior changes, renames, or API changes ride along with extraction PRs.
- No ratchet budget is ever raised; no landmine file is exempted from Phase 0.
- The ServiceNow injected-script residue is quarantined and labeled, not
  detached — full detachment stays with the LP-15 runtime-as-library work.

Recommended evidence before merge (each PR):

- `pnpm run verify` green; before/after ratchet numbers in the PR description;
  for completion-kernel PRs, the zero-divergence golden gate and an identical
  before/after test count for the split test files.

Recommended next action: **Implement** (after owner stamp), starting with
Phase 0.
