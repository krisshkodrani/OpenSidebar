# RFC LP-19 — JobAgent Graduated Autonomy (Auto-Approve Policy)

Lifecycle status: Draft (not stamped)
Date: 2026-07-20
Scope: a new pure policy module in `scripts/jobagent/` (`autonomy-policy.ts`), console approval routes (policy consultation + decision recording), status-lifecycle additions for auto-approved transitions. No extension changes; the consequential-click gate itself is untouched — only who answers it changes.
Related: [JobAgent automation gap analysis](../jobagent-automation-gap-analysis.md) §G3; RFC LP-18 (audit log & throughput prerequisite); RFC LP-20 (its drafted content is permanently excluded from autonomy); `.artifacts/pi-live` live-proof notes 2026-07-19; risk-notes honesty lifecycle in the seed schema

## Problem

Both human gates — kit approval and submit approval — are unconditionally
manual. That is correct today: the 2026-07-18 live smoke produced a kit whose
four wrong answers all carried *confident* provenance and an empty
`unresolved` list, which is exactly the kit a naive auto-approve would have
submitted. But permanent double-manual review does not scale with LP-18
throughput, and the pipeline already computes everything needed to distinguish
"mechanically certain" from "needs judgment": per-field provenance, dry-run
byte-match (including checkbox state since `dfaa5e04`), risk flags from
discovery, and an enforced status lifecycle.

The gap is a policy that converts those signals plus a *track record* into
selectively earned autonomy — with hard rules for what may never be
auto-approved.

## Proposal

### 1. Autonomy levels (per-candidate, global setting)

- **L0 — manual** (today's behavior, the default): both gates human.
- **L1 — auto-fill-ready**: kits whose every field is `identity`- or
  `answer`-library-sourced (no `default`, no `skip` on required fields, zero
  TODOs) auto-advance `reviewing → ready`. Submit gate stays human.
- **L2 — auto-submit-clean**: additionally, a fill whose forwarded dry-run
  diff classifies **`clean`** (every field byte-matched, checkboxes included,
  nothing missing/unexpected) is auto-approved at the submit gate. Anything
  short of `clean` parks for human approval exactly as today.

Levels are strictly cumulative and the setting is one line in the seed config
— trivially revertible to L0.

### 2. Hard always-park rules (apply at every level)

A kit or submit is parked for human review regardless of level when any of:

- any field's provenance is `drafted` (LP-20 content) that has not been
  human-promoted to the answer library;
- the package carries a discovery risk flag (unknown location qualifier,
  duplicate-risk, criteria matched on a fallback);
- the form contains a field category on the sensitive list (compensation,
  legal/visa attestations, references' PII, free-text about third parties);
- the dry-run reports anything other than `clean` (L2), or the gate fires on
  a tool call that is not the expected submit click (unexpected consequential
  action = automatic deny + park + notification);
- the same package has been auto-denied or has failed a fill before.

### 3. Earned thresholds, not day-one trust

L1/L2 only activate per **form family** (ATS platform + form fingerprint from
the dry-run field set) after N human-approved, clean-in-hindsight precedents
recorded in LP-18's `scheduler-log.jsonl` (recommended N=5 for L1, N=10 with
zero dry-run discrepancies for L2). A single post-hoc correction (owner edits
an answer after an auto-approved fill) resets that family to manual. This
makes the EggAI failure mode structurally survivable: a new form family always
starts at L0.

### 4. Lifecycle and audit

- New statuses `ready(auto)` and `submitted-auto` are **not** added; instead
  `recordStatus` gains an `approvedBy: "human" | "policy"` annotation on the
  existing transitions, so the lifecycle graph is unchanged and historical
  tooling keeps working. `recordStatus` remains the only writer.
- Every policy decision (approve/park/deny + which rule fired) is appended to
  a `policy-decisions.jsonl` with the full input snapshot, so any
  auto-approval is reconstructible after the fact.
- The console approvals inbox shows policy-approved items in a separate
  "auto-approved (review anytime)" list for spot-checking.

### 5. What answers the forwarded gate

At L2 the console answers `browser_respond_approval` itself after evaluating
the dry-run diff — the same mechanical byte-check pi was designed to perform
in the Phase-4 "grounded submit" design. The extension-side gate semantics,
timeout, and replay mechanics are untouched.

## Non-goals

- No LLM judgment anywhere in the policy: every criterion is a deterministic
  predicate over recorded data. If a signal is not mechanically checkable it
  parks.
- No relaxation of the drafting TODO gate; TODOs always block.
- No per-run owner overrides ("just this once") — changing the level is the
  only override, to keep the audit trail honest.

## Risks

- **Wrong-but-confident answers** (the EggAI class) passing L1. Mitigated by
  provenance restriction (library/identity only — both human-curated), the
  form-family threshold, and the reset-on-correction rule. Residual risk is
  a *correct-provenance* answer that is contextually wrong for this job; the
  sensitive-field list and LP-20's exclusion cover the highest-impact cases.
- **Dry-run blind spots**: `clean` is only as good as `extract_form_state`
  coverage (checkbox state was such a gap until `dfaa5e04`). Before L2 ships,
  add a coverage assertion: the dry-run must account for every field the kit
  intended to fill, else classify as not-clean.
- **Silent drift into full autonomy**: levels are global and explicit, the
  auto-approved list is always visible, and LP-18's digest reports every
  policy approval.

## Open questions

1. N thresholds (5/10 recommended) — calibrate against LP-18's first weeks of
   logs before stamping numbers.
2. Should L2 require LP-18's quiet-hours to be *off* (i.e. only auto-submit
   when the owner is plausibly reachable)?
3. Is `approvedBy` worth surfacing in the package JSON schema (visible to
   external tooling) or console-log only?

## Recommended Decision

Approve the level structure and always-park rules now; defer activation
thresholds until LP-18 has produced ≥2 weeks of audit history. Implement
`autonomy-policy.ts` as a pure module with exhaustive offline tests (including
a regression fixture reproducing the EggAI wrong-but-confident kit, which must
park at every level). Ship with L0 hardwired until the owner stamps the
threshold numbers into this RFC.
