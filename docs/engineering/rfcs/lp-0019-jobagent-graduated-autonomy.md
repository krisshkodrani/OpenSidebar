# RFC LP-19 — JobAgent Graduated Autonomy (Auto-Approve Policy)

Lifecycle status: **Parked (2026-07-22)** — JobAgent ships as a reference
implementation, not a supported product feature; this RFC is parked pending a
decision to productize the JobAgent pipeline, and is not scheduled for
implementation. Prior status: Draft (not stamped) — revision 2, incorporating the
[glm-5p2 second-opinion review](../rfc-review-jobagent-autonomy-glm-2026-07-20.md)
(F1, F2, F4, F10, F11, F14, M1, M3)
Date: 2026-07-20
Scope: a new pure policy module in `scripts/jobagent/` (`autonomy-policy.ts`), a field-categorization module (§6), console approval routes (policy consultation + decision recording), the auto-approved review surface. The consequential-click gate's own semantics, timeout, and replay mechanics are untouched — only who answers it changes. **L2 additionally requires one extension-side change** (§7, form-state re-verification at approval time), which is a hard prerequisite for that level and that level only; L0 and L1 need no extension change.
Related: [JobAgent automation gap analysis](../jobagent-automation-gap-analysis.md) §G3; RFC LP-18 (approval-decision log — a hard prerequisite, §4; plus the `fill-failed` status and pacing); RFC LP-20 (its drafted content is permanently excluded from autonomy); `.artifacts/pi-live` live-proof notes 2026-07-19; risk-notes honesty lifecycle in the seed schema

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
  TODOs, no `drafted` content) auto-advance `reviewing → ready`. Submit gate
  stays human.
- **L2 — auto-submit-clean**: additionally, a fill whose forwarded dry-run
  diff classifies **`clean`** under the bidirectional coverage rule (§2.1) is
  auto-approved at the submit gate. Anything short of `clean` parks for human
  approval exactly as today.

Levels are strictly cumulative and the setting is one line in the seed config
— trivially revertible to L0.

**L2 is disabled during LP-18's quiet hours.** The entire value of the submit
gate is that a human can catch what the machine cannot; auto-submitting while
the owner is predictably asleep removes the safety net exactly when it is
least replaceable. An owner who wants round-the-clock autonomy disables quiet
hours — an explicit, audited configuration change rather than an implicit
consequence of a schedule setting.

### 2. Hard always-park rules (apply at every level)

A kit or submit is parked for human review regardless of level when any of:

- any field's provenance is `drafted` (LP-20 content) that has not been
  human-promoted to the answer library;
- any field's answer comes from a library entry marked `context-bound`
  (LP-20 §3) — an answer written for a specific listing may not be replayed
  onto another;
- any field falls in a **context-sensitive category** (§6.2): relocation,
  location-specific work authorization, start-date/availability, experience
  or eligibility claims, and work-preference questions. These are the answers
  whose *correctness depends on which job is being applied to*, so a
  perfectly-curated library answer can still be wrong here — and the form
  family threshold makes replay more likely, not less, since precedent
  accumulates per ATS platform rather than per context;
- any field's category is **unknown** to the categorizer (§6.1 — unknown
  fails closed, never open);
- the package carries a discovery risk flag (unknown location qualifier,
  duplicate-risk, criteria matched on a fallback), or carries LP-18's
  `outOfScope` flag — including when that flag was set by the re-assess pass
  *after* the fill began, which is exactly the case where no human has yet
  seen that the criteria changed;
- the form contains a field category on the sensitive list (compensation,
  legal/visa attestations, criminal-history or background questions,
  references' PII, free-text about third parties);
- the dry-run reports anything other than `clean` (L2, §2.1), or the gate
  fires on a tool call that is not the expected submit click (unexpected
  consequential action = automatic deny + park + notification);
- the same package has been auto-denied, flagged wrong (§3.1), or has
  reached `fill-failed` before.

### 2.1 Bidirectional dry-run coverage

`clean` must mean "the application is complete and correct", not merely "what
we tried to type, we typed". The classification therefore requires **both**
directions to hold:

- every field the kit intended to fill was found and byte-matched (including
  checkbox/radio state, per `dfaa5e04`); **and**
- every field the form exposes as required at dry-run time was accounted for
  by the kit.

Without the second direction, a form that grew a required field the kit never
saw — dynamically injected EEOC blocks and AJAX-loaded sections are routine on
real ATS forms — would classify `clean` and auto-submit an incomplete
application. Any unaccounted required field forces a park.

**L2 is additionally restricted to fills whose form is fully visible at
dry-run time.** Multi-page and progressively-disclosed forms may not expose
later-page required fields at all, so the second direction above passes
*vacuously* — it verifies only what the page chose to reveal.

"Fully visible" must therefore be an assertion the form analysis makes, never
an absence of evidence. A form qualifies only when **all** hold:

- no pagination or step affordance is present (next/continue/step-N controls,
  `role="tablist"` sections, progress indicators) — the selector/heuristic
  list is an ATS-corpus spike, Open Question 4;
- a submit control is present and enabled in the captured state;
- the kit's own field set is fully accounted for in the capture (a kit
  expecting fields the page never showed implies undisclosed pages).

Anything else — including "we could not tell" — parks. This is the same
fail-closed principle as §6.1: an unrecognized form shape must stop the
pipeline rather than be assumed simple.

### 3. Earned thresholds, not day-one trust

L1/L2 only activate per **form family** after N human-approved,
clean-in-hindsight precedents recorded in LP-18's `approval-decisions.jsonl`
(recommended N=5 for L1, N=10 with zero dry-run discrepancies for L2). This
makes the EggAI failure mode structurally survivable: a new form family always
starts at L0.

**The fingerprint is computed at kit-draft time, not from the dry-run.** L1
decides *before* any fill exists, so a dry-run-derived fingerprint would be
unavailable at the only moment L1 needs it — the family could never be matched
and L1 could never activate. The drafter already captures the form's field
set, so the family is:

```
formFamily = ATS platform id
           + sha256 of the sorted (normalized label, control type, required)
             triples captured at draft time
```

Label normalization (case, whitespace, punctuation, and stripping of
listing-specific interpolations such as the company name) is specified with
the module so two applications on the same ATS template hash identically. The
same fingerprint is written to the audit log at draft time, so precedent
counting and L1's lookup use one definition.

**The fill-time dry-run recomputes the same hash over its own captured field
set and compares.** This is a distinct check from §2.1's coverage assertion,
which only asks whether required fields are accounted for: a form that renames
"First Name" to "Given Name" changes the family without adding any required
field, so coverage would pass while the form is no longer the one whose
precedents earned the autonomy. Recomputation catches that class.

A fingerprint mismatch means the form changed under us: automatic park, and
the family's precedent count does not advance for that fill. Because
normalization is shared, benign re-orderings and whitespace churn do not
trip it; a genuine label, type, or required-flag change does.

### 3.1 Correction signal: an explicit human action

A family's precedent count is only trustworthy if a wrong auto-approval can
knock it down. Inferring "the owner corrected something" from library edits or
kit edits is unreliable — the owner may edit the library for unrelated
reasons, may fix nothing at all and simply remember, or may notice the error
long after the application is gone. An undetected correction means a family
with a systematic error stays auto-approved indefinitely, which is the worst
failure this policy can have.

So the signal is a deliberate action, not an inference: the console's
auto-approved review list carries a **"flag as wrong"** control on every
policy-approved submission. Flagging:

- resets that form family to L0 immediately (both gates human again);
- records the flag, the reason, and the offending field labels in
  `policy-decisions.jsonl`;
- feeds the post-submission error response (§8).

Nothing else resets a family. The rule is therefore checkable: a family is at
L1/L2 exactly when its precedent count is met and no flag has been recorded
since.

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
timeout, and replay mechanics are untouched, but the approval carries a
freshness token (§7).

### 6. Field categorization (how a category is known at all)

The always-park rules lean on field *categories*, so how a field acquires one
is load-bearing policy, not an implementation detail. Two rules:

**6.1 Categorization is deterministic and fails closed.** A label-matching
module (`field-categories.ts`, owner-editable pattern map, no LLM) maps a
form field to exactly one category. A field that matches no pattern is
`unknown`, and `unknown` **always parks**. Categories are an allowlist of
what may proceed, never a blocklist of what may not: a new question shape
("have you ever been convicted of a crime?") that nobody anticipated must
stop the pipeline rather than sail through it. Every unknown encountered is
logged so the owner can categorize it once and move on.

**6.2 Three category classes** with different treatment:

| Class | Examples | L1/L2 treatment |
| --- | --- | --- |
| Safe | name, email, phone, LinkedIn/portfolio URL, pronouns, how-did-you-hear | Eligible for autonomy |
| Context-sensitive | relocation, location-specific authorization, availability/start date, experience & eligibility claims, work preferences | Always park (§2) |
| Sensitive | compensation, legal/visa attestations, criminal history, references' PII, third-party free text | Always park (§2) |

The distinction between the last two rows matters for diagnosis, not for
behavior: context-sensitive answers are wrong *because the job changed*,
sensitive answers are wrong to automate *at all*.

### 7. Form freshness at the moment of approval (L2 only)

At L0 a human reads the dry-run and approves seconds later, with eyes on the
page. At L2 nobody is watching between classification and
`browser_respond_approval`, and a form can change in that window: a session
expires, dynamic content loads, the page navigates. Auto-approving against a
stale snapshot could submit something nobody ever classified.

L2 therefore requires the gated tool call to be replayed only if the form
state still matches what was classified. The extension re-captures form state
at the moment of approval and compares it against a digest carried on the
approval response; a mismatch aborts the submit and parks. **This is an
extension-side change** — small, but real, and stated here rather than hidden
behind "gate semantics untouched".

This check is a **hard prerequisite for L2, not an option.** A console-side
re-dry-run immediately before responding was considered and rejected: it
narrows the window without closing it, since the form can still change
between the console's re-check and the extension's replay — and L2 is
precisely the configuration with no human watching the page. L0 and L1 need
no extension change; an owner unwilling to take the extension change simply
does not run L2.

### 8. When prevention fails: post-submission response

Every rule above is preventive, and applications cannot be unsubmitted — so
the policy needs an answer for the case where a wrong one goes out (including
at L0, by ordinary human error). The "flag as wrong" action (§3.1) is the
entry point:

- the flagged submission is recorded with its reason and offending fields;
- the form family drops to L0 (§3.1);
- the console offers a **withdrawal/correction email draft** from a template,
  addressed from the package's recorded contact, for the owner to send or
  discard.

Sending is the owner's action, never the pipeline's. This is deliberately
minimal: the goal is that a known-bad submission produces a record and a
prepared response, not that the system attempts remediation on its own.

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
  form-family threshold, and the flag-resets-family rule (§3.1).
- **Contextually-wrong-but-correctly-sourced answers** — a library answer
  that was right for the job it was curated on and wrong for this one. This
  is the residual risk the earlier draft under-weighted; §2's
  context-sensitive category class and LP-20's `context-bound` marking now
  address it directly, and §6.1's fail-closed unknown handling keeps
  uncategorized question shapes out of autonomy entirely. Residual after
  that: a *safe*-category answer that is nonetheless wrong here (e.g. a
  portfolio URL that should differ by role). Low impact by construction of
  the safe list, and the flag action reaches it after the fact.
- **Dry-run blind spots**: `clean` is only as good as `extract_form_state`
  coverage (checkbox state was such a gap until `dfaa5e04`). §2.1's
  bidirectional assertion is the guard; the residual is a required field the
  form does not *expose* as required at dry-run time, which is why L2 is
  restricted to fully-visible single-page forms.
- **Silent drift into full autonomy**: levels are global and explicit, the
  auto-approved list is always visible, and LP-18's digest reports every
  policy approval.
- **Categorization rot**: the pattern map is owner-maintained, so an
  unmaintained map parks more and more fields. That is the correct failure
  direction (annoying, not unsafe), and unknown-field logging tells the owner
  exactly what to add.

## Open questions

1. N thresholds (5/10 recommended) — calibrate against LP-18's first weeks of
   `approval-decisions.jsonl` before stamping numbers.
2. Is `approvedBy` worth surfacing in the package JSON schema (visible to
   external tooling) or console-log only?
3. Should the safe category list be per-candidate (seed dir) or shipped as a
   sensible default with owner overrides? Recommendation: shipped default +
   overrides, so a fresh install is not autonomous-by-omission.
4. What exactly counts as a "pagination control" for §2.1's single-page
   detection — a spike over the real ATS corpus (Greenhouse, Ashby, Workday,
   Lever) should produce the selector/heuristic list before L2 ships.

## Recommended Decision

Approve the level structure, the always-park rules including the
context-sensitive class, draft-time form-family fingerprinting with fill-time
recomputation, bidirectional dry-run coverage with explicit single-page
qualification, fail-closed categorization, the quiet-hours prohibition on L2,
the mandatory approval-time freshness check for L2 (§7), and the explicit
flag-as-wrong correction signal. Defer activation thresholds until LP-18
(including its approval-decision log) has produced ≥2 weeks of history.

Implement `autonomy-policy.ts` and `field-categories.ts` as pure modules with
exhaustive offline tests, including regression fixtures that must park at
every level: the EggAI wrong-but-confident kit; a relocation question answered
from a library entry curated elsewhere; an uncategorized novel question; a
form that grew a required field between draft and dry-run; a form that renamed
a field without changing its required set (fingerprint mismatch, coverage
clean); a multi-page form whose first page looks complete; and a package
flagged `outOfScope` mid-fill. Ship with L0 hardwired until the owner stamps
the threshold numbers into this RFC.
