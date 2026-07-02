# RFC LP-6 — Silver-Trajectory Repair & Failure Justifications

Lifecycle status: Draft (Recommended Decision only — not owner-stamped)
Date: 2026-06-26
Scope: `packages/shared-types/src/traces.ts` (`TraceSession` linkage fields), `apps/extension/src/background/agent/trace.ts` (recorder), trace server endpoints (`/traces/session`, optional `/annotations`), `apps/extension/src/trace-viewer/` (pairing view + annotation panel, store), reuse of `orchestrator/verifier.ts` types
Related: OpenClaw RL Guidelines v5 (2026-06-11, `.artifacts/`) — "Silver trajectory" (clone + steer to the fully-correct end state) and the 3-area failure-justification framework (why-correct / why-present / what-the-model-did-wrong, no hedging); depends on **LP-4** `finalStateSnapshot`; complements LP-2 partial-progress handoff

## Problem

We capture rich per-run traces (`TraceRecorder`, full-fidelity `TraceEntry`) and
have a trace-viewer to inspect them, but failed runs are a dead end: there is no
way to (a) turn a failure into a corrected golden reference, or (b) record a
disciplined, grounded explanation of *why* it failed. Two specific gaps:

- **No golden-pair concept.** Sessions are independent records (`TraceSession`,
  `traces.ts:480`); nothing links a failed model run to a corrected run of the
  same task. OpenClaw's core data unit is exactly this pair — the model
  trajectory plus a **Silver trajectory** that reaches the fully-correct end
  state. That pairing is what makes a trace a regression asset and a teaching
  example (and it feeds naturally into GBrain site-specific learning / AWM-style
  workflow memory).
- **Failure analysis is ad-hoc and speculative.** The viewer surfaces a
  heuristic `failureClass` and there's an orchestrator `NodeVerificationResult`
  (`orchestrator/verifier.ts:34`), but there's no place to record the OpenClaw
  3-area justification, which bans hedging ("likely", "probably") and requires
  citing the specific turn. Without that discipline, failure notes are
  unciteable and don't accumulate into anything.

Note on scope: OpenClaw's silver flow allows re-running/overriding the model.
We have **no replay engine** (confirmed: `TraceEntry` carries enough to replay,
but nothing re-executes it). This RFC deliberately does **not** build replay — a
"silver" run is simply a fresh, human-guided run that is *tagged and linked* to
the failed one. That delivers the golden-pair value without the large replay
lift.

## Proposal

Three parts: linkage (recorder), pairing (viewer), justification (viewer +
storage). Part 0 is the LP-4 dependency.

### 0. Dependency

`finalStateSnapshot` on `TraceSession` (introduced in LP-4) is the canonical
end-state both members of a pair are compared on. LP-6 assumes it exists; if
LP-4 has not landed, LP-6's pairing view shows only the recorded summary, not a
state diff.

### 1. Pair linkage (recorder + types)

Add two optional fields to `TraceSession` (`traces.ts:480`), both backward
compatible:

- `kind?: "model" | "silver"` (default treated as `"model"` when absent).
- `repairsSessionId?: string` — on a silver session, the failed session it
  corrects.

A silver run is started from the viewer against the **same task query** as the
failed run; `TraceRecorder` already accepts the query/correlation context at
construction, so it only needs to thread these two fields through to
`finalize` (`trace.ts:611–680`), alongside the existing optional-field spreads.
No new recording machinery.

### 2. Silver pairing view (trace-viewer)

In `apps/extension/src/trace-viewer/`:

- From a failed session, a **"Promote to silver"** action records the operator's
  intent to produce a corrected run for that task (it sets up the link target;
  the corrected run itself is produced by running the agent guided to success,
  recorded normally, then stamped `kind: "silver"` + `repairsSessionId`).
- A **paired view** renders model vs silver side-by-side: outcomes, turn counts,
  and — when LP-4 has landed — a `finalStateSnapshot` diff (URL, key
  element/text deltas). The store already manages sessions/runs/filters
  (`store/types.ts`); add a `pairing` selector and a paired-detail route.

This gives a browsable corpus of "what went wrong / what the corrected run did"
keyed by task — the regression and teaching asset.

### 3. Failure justifications (viewer + storage)

Add an **annotation panel** attached to a turn (`TurnCard.tsx`) and to the
session, capturing OpenClaw's 3-area framework per failure:

- **Why the check is correct** — grounded in the task; cite the requirement.
- **Why it matters** — what a correct vs incorrect run looks like.
- **What the model did wrong** — definitive, citing a specific `turnId` /
  tool execution; **no hedging language**.

Reuse the `NodeVerificationResult` shape (`orchestrator/verifier.ts:34`) where
it fits; persist annotations via a new `/annotations` endpoint on the trace
server (port 7589) keyed by `sessionId` + optional `turnId`, or piggyback the
`/traces/session` record if a separate endpoint is over-scoped for v1. Enforce
the spec's **deletion rule** in the UI: an annotation that cannot fill all three
areas with a citation is not saveable as a "justified failure" — it stays a
plain note.

## Risks and guardrails

- **Scope creep into a replay engine.** Explicitly out of scope; silver = a
  tagged fresh run. Guardrail: no `TraceEntry` re-execution code in this RFC; if
  replay is later wanted it gets its own RFC.
- **Linkage drift / orphan pairs.** A silver run whose `repairsSessionId` points
  at a missing session. Guardrail: pairing view tolerates dangling links
  (renders the silver alone with an "unlinked" marker); linkage is advisory
  metadata, never a hard dependency for rendering.
- **Annotation as unfalsifiable narrative.** The whole point is to prevent
  hand-wavy failure notes. Guardrail: the 3-area + citation + deletion rule is
  enforced by the panel, mirroring the spec; free-form notes remain available
  but are not labeled "justified failure."
- **Storage growth from paired snapshots.** Bounded by LP-4's projection choice;
  silver pairs are operator-created (not every run), so volume is low.

## Alternatives

- **Build a replay engine and auto-repair.** Much larger, and unsafe on live
  writes (the same reason tree-search recovery was out of scope in LP-2).
  Rejected for now; tagged fresh runs capture the dataset value.
- **Store golden pairs outside the trace system** (separate dataset repo).
  Loses the viewer integration and the link to live traces; duplicates schema.
  Rejected.
- **Free-form failure notes only.** Cheap, but reproduces today's unciteable
  analysis. Rejected — the discipline is the value.
- **Do nothing.** Failures stay a dead end; no regression corpus, no structured
  failure record to feed learning. Rejected.

## Testing

- Types/recorder: `finalize` threads `kind` + `repairsSessionId`; additive-field
  tests for both present and absent; backward-compat read of an old session
  (fields absent → treated as `model`, no link).
- Viewer: paired view renders a model+silver pair, a dangling link
  ("unlinked" marker), and — when `finalStateSnapshot` present — a state diff.
- Annotation: panel rejects save-as-justified when any of the 3 areas is empty
  or lacks a citation; accepts a complete one; persisted annotation round-trips
  through the chosen endpoint.

## Rollout

Medium (~3–4 days). Sequenced **after LP-4** (needs `finalStateSnapshot` for the
state diff; pairing/annotation can begin in parallel against summaries only).
Linkage fields and annotation schema are additive; changing the silver
definition (e.g. introducing replay) would need a new stamp.

## Recommended Decision

> This is an agent recommendation, not an owner Decision Stamp. Per
> `rfc-decision-process.md`, no implementation may begin until the owner records
> a `## Decision` stamp.

Recommended status: **Approved with edits**

Chosen path (recommended):

- Add `kind` + `repairsSessionId` to `TraceSession`, threaded through
  `TraceRecorder.finalize`.
- Add a trace-viewer paired view (model vs silver, with a `finalStateSnapshot`
  diff once LP-4 lands) and a "Promote to silver" action.
- Add a 3-area, citation-enforced failure-justification annotation panel with
  the deletion rule, persisted via `/annotations` (or `/traces/session` for v1).
- Explicitly exclude a replay engine.

Recommended edits before implementation:

- Confirm storage choice (`/annotations` endpoint vs piggyback on
  `/traces/session`) and whether v1 ships the state diff or summary-only pairing
  (gated on LP-4 timing).

Recommended do-not-do:

- Do not build `TraceEntry` replay / auto-repair in this RFC.
- Do not allow a "justified failure" to be saved without all three areas + a
  turn citation.

Recommended evidence before merge:

- Additive-field + backward-compat tests; paired view rendering a real
  model+silver pair and a dangling link; annotation panel enforcing the 3-area
  deletion rule with a round-trip persistence test.

Recommended next action: **Revise RFC** (settle storage + LP-4 sequencing),
then request a Decision Stamp.
