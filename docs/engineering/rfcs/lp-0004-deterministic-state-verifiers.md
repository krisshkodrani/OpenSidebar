# RFC LP-4 — Deterministic State Verifiers and Advisory Judge

Lifecycle status: Draft (Recommended Decision only — not owner-stamped)
Date: 2026-06-26
Scope: `scripts/bench/webjudge.ts`, `scripts/bench/types.ts`, `scripts/run-bench.ts`, a new `scripts/bench/verifiers/` directory, `packages/shared-types/src/traces.ts` (`TraceSession`), `apps/extension/src/background/agent/trace.ts` (`TraceRecorder.finalize`), and the run-bench evidence writer
Related: OpenClaw RL Guidelines v5 (2026-06-11, `.artifacts/`) — "Does the final state prove the task was completed?" and the strong-vs-weak unit-test discipline; RFC LP-1 (public benchmark adapter / WebJudge); completion-kernel contract model (`completion-kernel.ts:152`, `:1021`)

## Problem

The benchmark grader is the inverse of our own runtime completion logic, and
that inconsistency is a measurement risk for the launch number.

- **Runtime is already state-based.** `completion-kernel.ts` decides "done" by
  evaluating typed `CompletionContract`s against DOM/snapshot **state**
  (`generateCompletionContract` at `completion-kernel.ts:152`; evaluators at
  `:1021–1089`; preflight guards read `snapshot.elements` / `visibleContent` at
  `preflight.ts:599–812`). This is the OpenClaw philosophy — grade the end
  state, not the narration.
- **The bench grader does the opposite.** `webjudge.ts` feeds the judge model
  `evidence.trajectory` (text, capped at 60 lines) plus `doneSummary` and
  `finalUrl` (`webjudge.ts:66–96`), and `run-bench.ts:judgeAndScore`
  (`:192–248`) makes that verdict the **sole** pass/fail authority. There are
  no deterministic assertions anywhere in the scoring path.

The OpenClaw spec is blunt about why this matters: "Treat every Eval as
assistive feedback, never as ground truth," and its unit tests assert over a
captured final state (`snapshots.json`) with exactly-one-match, field-level
checks — explicitly *underneath* the LLM rubric. Our published number currently
rests entirely on an LLM judge that, by the module's own docstring, is a
"documented approximation" (no screenshot grounding, judges text). Known
context from prior work: the perception A/B found judge-model choice made no
difference and executor nondeterminism is the bottleneck — i.e. the judge is
not where the signal is, but it is where all our pass/fail authority sits.

There is also a missing substrate: at session end we keep per-turn snapshots
but no canonical **final-state snapshot**. A deterministic verifier needs one
authoritative end-state object to assert against, and so does LP-6
(silver-trajectory pairing). This RFC introduces it once.

## Proposal

Three parts. Part 1 is the shared substrate; Parts 2–3 are the bench changes.

### 1. Final-state snapshot (shared substrate)

Add an optional `finalStateSnapshot?: TracePageStateCapture` to `TraceSession`
(`traces.ts:480`). `TracePageStateCapture` already carries everything a
verifier needs — `url`, `title`, `elementCount`, `domSnapshot` (full
`TaggedElement[]`), `domDistillation`, `screenshots` (`traces.ts:171–184`) — so
no new type is required.

Populate it in `TraceRecorder.finalize` (`trace.ts:611–680`) from the last
captured page state (the recorder already holds `postToolSnapshot` /
`pageState.postTool`). Capture is best-effort and additive: omit the field when
no page state exists (text-only / errored runs), exactly like the existing
optional-field spreads in `finalize`. No behavior change for any existing
consumer; the field is backward-compatible (optional, like every other
`TraceSession` field).

For the bench runner specifically, also persist the final state into the
per-task evidence file `run-bench.ts` already writes, so verifiers can run
offline without the trace server. Extend `BenchRunEvidence` (`scripts/bench/
types.ts`) with `finalState?: { url: string; domDistillation?: string;
elementSignatures?: string[] }` — a thin, judge-independent projection of the
snapshot.

### 2. Deterministic verifier layer (the authority)

Add `scripts/bench/verifiers/` holding per-task verifier functions keyed by
`task_id`, in the spirit of OpenClaw's `verifiers.py` but in TypeScript and
pure:

```ts
// scripts/bench/verifiers/types.ts
export interface TaskVerifier {
  taskId: string;
  // Pure assertion over captured final state + recorded evidence.
  verify(evidence: BenchRunEvidence): VerifierResult;
}
export interface VerifierResult {
  outcome: "pass" | "fail";
  // OpenClaw discipline: every fail names the concrete missing/incorrect fact.
  reason: string;
}
```

Verifiers must follow the spec's **strong-not-weak** rule: assert the specific
end state (exact URL match or pattern, a required value present in
`domDistillation`, exactly-one-match where the task names a unique target), not
"something happened." Where a task admits multiple valid end states, a verifier
may encode **OR-logic** (any branch passing → pass) — but only when the
alternatives are genuinely valid, never to paper over coverage.

A registry maps `task_id → TaskVerifier`. Coverage is partial by design and
grows over time; tasks without a verifier fall through to Part 3.

### 3. Judge becomes advisory where a verifier exists

In `run-bench.ts:judgeAndScore` (`:192–248`):

- If a verifier exists for the task → **the verifier decides** `outcome`. The
  WebJudge call still runs and its verdict + confidence + reasoning are recorded
  alongside, marked `authority: "verifier"`, judge `role: "advisory"`.
- If no verifier exists → WebJudge decides as today, recorded with
  `authority: "judge"`.
- The summary report (`summary.json` / `report.md`) reports both the headline
  number and a **verifier/judge disagreement rate** on the verifier-covered
  subset — the spec's "honest aggregates" discipline, and an ongoing calibration
  signal for the judge prompt.

No change to the agent runtime or `completion-kernel.ts`.

## Risks and guardrails

- **Verifier overfitting** (the spec's named failure mode): a verifier that
  asserts an exact filename/value the task never specified will wrongly fail
  correct runs. Guardrail: adopt OpenClaw's deletion rule — if a verifier
  assertion cannot be grounded in the task text, delete it; prefer pattern /
  contains / OR-logic over hardcoded literals; the disagreement-rate report
  surfaces verifiers that diverge from the judge for manual audit.
- **Snapshot bloat:** `domSnapshot` on every session could grow trace storage.
  Guardrail: the bench evidence projection (`finalState`) stores only
  `domDistillation` + `elementSignatures`, not the full `TaggedElement[]`; the
  full snapshot on `TraceSession` is optional and can be gated behind the
  existing recording config if size becomes an issue.
- **Partial coverage misread as full rigor:** report must always state how many
  scored tasks were verifier-backed vs judge-only, so the number is never
  presented as more deterministic than it is.

## Alternatives

- **Screenshot-ground the judge instead.** Improves the judge but keeps an LLM
  as sole authority — exactly what the spec warns against. Complementary, not a
  substitute; can proceed independently under LP-1.
- **Assert only on `finalUrl`.** Cheap but weak; fails the strong-not-weak
  discipline for any task whose success isn't a navigation. Kept as the
  simplest verifier shape, not the whole design.
- **Do nothing.** Launch number stays 100% LLM-judge, uncalibrated against any
  ground truth. Rejected.

## Testing

- Unit: verifier registry lookup; two example verifiers (one exact-match, one
  OR-logic) with pass/fail fixtures; the strong-vs-weak pair from the spec
  encoded as a regression (weak assertion must be rejected in review, not
  shipped — enforced by an example, not lint).
- Unit: `buildWebJudgePrompt` / `parseWebJudgeVerdict` unchanged and still
  green; new `authority`/`role` fields serialized in results.
- Snapshot: `TraceRecorder.finalize` populates `finalStateSnapshot` for a
  normal run and omits it for a text-only run (additive-field test).
- Bench dry-run: a small fixture run produces a `report.md` with the headline
  number plus the verifier/judge disagreement rate on the covered subset.

## Rollout

Small–medium (~2–3 days). Part 1 (snapshot) lands first and unblocks LP-6.
Parts 2–3 can ship with a handful of seed verifiers and grow. Adding verifiers
later needs no re-review; changing the authority-resolution rule (verifier vs
judge precedence) needs a stamp update.

## Recommended Decision

> This is an agent recommendation, not an owner Decision Stamp. Per
> `rfc-decision-process.md`, no implementation may begin until the owner records
> a `## Decision` stamp.

Recommended status: **Approved with edits**

Chosen path (recommended):

- Add `finalStateSnapshot` to `TraceSession`, populated best-effort in
  `TraceRecorder.finalize`; add a `finalState` projection to `BenchRunEvidence`.
- Add `scripts/bench/verifiers/` with a `task_id`-keyed registry of pure
  verifiers following the strong-not-weak + OR-logic + deletion-rule discipline.
- Make the verifier authoritative where present; keep WebJudge as advisory and
  as the fallback; report the verifier/judge disagreement rate.

Recommended edits before implementation:

- Decide the seed verifier set (which `task_id`s get day-one coverage) and the
  storage gate for full `domSnapshot` on `TraceSession`.

Recommended do-not-do:

- Do not change `completion-kernel.ts` or runtime completion behavior.
- Do not delete or weaken WebJudge — it remains the fallback and the calibration
  counterpart.

Recommended evidence before merge:

- Example verifiers passing/failing on fixtures; a bench dry-run report showing
  the disagreement-rate section; `finalStateSnapshot` additive-field tests.

Recommended next action: **Revise RFC** (settle seed set), then request a
Decision Stamp.
