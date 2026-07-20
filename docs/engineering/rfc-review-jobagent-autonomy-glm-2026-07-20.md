# Second-Opinion Review of the JobAgent Autonomy RFCs (glm-5p2, 2026-07-20)

An independent design review of the LP-18/19/20 drafts plus the
[gap analysis](jobagent-automation-gap-analysis.md), obtained from
`accounts/fireworks/models/glm-5p2` (temperature 0, critical-design-review
system prompt, all four documents as input; raw output archived at
`.artifacts/rfc-design-review-glm.md`). The CI `/ai-review` pass
(deepseek-v4-pro + gpt-oss-120b judge) on PR #90 reported no findings — its
lenses are code-oriented, so that result carries no design signal either way.

**GLM's overall verdict: "not yet ready to stamp." After assessing each
finding: agreed.** Of 15 findings + 3 missed-entirely items, I assess
12 findings as correct (3 of those with a modified fix), 2 as partially
correct, and 1 as cosmetic. All three missed-entirely items are legitimate.
The RFC drafts should be revised before Decision Stamps.

Legend — **Accept**: fold the fix into the RFC as proposed. **Accept-mod**:
the problem is real, the proposed fix needs adjustment. **Partial**: the
concern is real but overstated or half-right. **Cosmetic**: no design change
needed.

## Findings and assessment

### F1 — L2 can auto-submit contextually-wrong library answers · **Accept** (high severity)

GLM: a correct-provenance answer curated for one job ("relocate? → Yes") is
wrong for another job with the same form family; the family threshold makes
this *more* likely, since precedent accumulates on the platform, not the
context.

Assessment: correct, and the sharpest safety finding. The always-park rules
guard provenance and category but not context-dependence. Fix for LP-19 §2:
add a *context-sensitive category* list (relocation, location-specific
authorization, experience/eligibility claims, work preferences) that always
parks at L2 regardless of provenance. GLM's alternative (per-answer usage
thresholds) is heavier machinery for the same protection; the category list
is simpler and auditable.

### F2 — Form-family fingerprint is circular at L1 · **Accept** (spec bug)

GLM: the family is defined by the *dry-run* field set, but the dry-run
happens during the fill — after the L1 decision point. L1 as written cannot
evaluate its own threshold.

Assessment: correct, outright spec bug. Kit drafting already captures the
form's field set (labels/types/required), so the fingerprint must be defined
at **draft time** from that capture, with the algorithm specified so LP-18
can log it. The dry-run then checks the *same* family at L2.

### F3 — LP-18's audit log lacks what LP-19 calibrates against · **Accept**

GLM: `scheduler-log.jsonl` records scheduler actions; LP-19's thresholds need
*human approval decisions* (approve/reject/edit, kit snapshot, dry-run hash).
The sequencing premise fails as written.

Assessment: correct. LP-18 §4 must add an approval-decision log alongside the
scheduler log; LP-19 declares an explicit dependency on it. This is exactly
the kind of cross-RFC drift the review was for.

### F4 — Dry-run coverage assertion is one-directional · **Accept**

GLM: verifying "every kit field matched" misses required form fields the kit
never addressed (dynamically injected EEOC blocks, AJAX-loaded fields) —
`clean` could describe an incomplete application.

Assessment: correct; make the assertion bidirectional (kit⊆form matched AND
form-required⊆kit accounted). Additional caveat the review implies but does
not state: multi-page forms may not expose later-page fields at dry-run time
at all — LP-19 should restrict L2 to single-page-verified fills until that is
characterized.

### F5 — 409-as-bug is wrong under scheduler/human races · **Accept**

GLM: a human editing/approving between scheduler check and act produces
legitimate 409s; treating them as bugs means noise or a stopped scheduler.

Assessment: correct. Fix: on 409, re-read package state and re-evaluate next
loop tick; only a transition the scheduler derived from *fresh* state that
still 409s is a bug. LP-18 should also state the concurrency model (single
event loop in the console process).

### F6 — Re-assess pass ignores post-`reviewing` states · **Accept-mod**

GLM: criteria changes don't re-score `ready`/`filled-awaiting-submit`/
`awaiting-approval` packages; at L2 an out-of-scope application could submit
untouched by human hands.

Assessment: real gap, overbroad fix. For `ready`: re-assess and park with
notification (accept as proposed). For in-flight fills: parking mid-fill adds
abort machinery; it is enough that (a) the submit-gate approval screen shows
an out-of-scope warning, and (b) at L2 an out-of-scope package is an
always-park condition — which composes with F1's rule set naturally.

### F7 — Verbatim promotion is an honesty landmine · **Accept** (high severity)

GLM: "Why AcmeCorp?" promoted verbatim resolves for BetaCorp's identical
question fingerprint; at L1 that auto-advances with another company's name in
the answer.

Assessment: correct and concrete. Fix as proposed: block verbatim promotion
when the draft contains listing-derived proper nouns (the post-check corpus
already identifies them); mark library entries `context-free` vs
`context-bound`; only `context-free` counts as autonomy-eligible provenance.
This also retroactively strengthens F1.

### F8 — Parked approvals starve discovery via the port · **Accept-mod**

GLM: a fill at `awaiting-approval` holds the bridge port up to 600s; with the
scheduler re-running expired fills, sweeps can be delayed indefinitely.
Proposes releasing the port mid-fill.

Assessment: the starvation mechanism is real, but port-release-mid-fill means
making a paused fill survive a bridge teardown — new, risky machinery touching
the orchestrator's resume path. Cheaper fix closing the same loop: (a) an
expired approval **never auto-re-runs** — it parks for human action (this also
kills the infinite park-expire-refill cycle), and (b) sweeps get a reserved
schedule window during which no fill launches. Starvation becomes bounded at
one gate-expiry.

### F9 — "No lifecycle changes" contradicts "failed fills park" · **Accept**

GLM: there is no failed status, so a failed fill sitting at `ready` is
re-filled forever, or the implementer invents a shadow flag.

Assessment: correct, real contradiction with LP-18's own non-goal. Add a
`fill-failed` status with explicit transitions (`ready → fill-failed` on
error; `fill-failed → ready` human retry; `fill-failed → archived` discard)
through `recordStatus`. Honest lifecycle addition beats a side-channel.

### F10 — L2 during quiet hours is a prerequisite, not an open question · **Accept**

Assessment: agree with the conclusion. Auto-submitting while the owner is
unreachable removes the safety net at its weakest moment, and the cost of the
hard rule is zero (an owner wanting 24/7 disables quiet hours — an explicit,
audited config change). Promote from open question to §2 hard rule.

### F11 — Post-hoc correction detection is undefined · **Accept**

GLM: the family-reset rule (the primary feedback loop against a persistently
wrong family) has no detection mechanism.

Assessment: correct. Fix as proposed: an explicit "flag as wrong" action on
the auto-approved review list; flagging resets the family to L0 and is
recorded in `policy-decisions.jsonl`. Deliberate human signal, not inference
from edits.

### F12 — Post-check insufficiency / review-burden paradox · **Partial**

GLM: the string post-check misses paraphrased claims; if humans must read
carefully anyway, LP-20's value shrinks; if they trust the check, fabrications
slip through.

Assessment: the tension is real but overstated — drafting value is not just a
full textarea (question comprehension, library voice, structure). The
proposed *fix* is good regardless of the framing: the review UI shows the
draft against the source corpus with matched phrases highlighted, so review
gets faster without getting shallower. Adopt the fix, keep LP-20's honest
statement that the human gate is the actual safety boundary.

### F13 — Notifications don't distinguish TODO from drafted · **Accept** (minor)

Assessment: correct cross-RFC gap (LP-18 §3 predates LP-20's `drafted` kind).
Fix: notifications carry a per-field blocking-reason from a shared vocabulary
defined once (LP-20 already proposes shared vocabulary for the always-park
string; extend it).

### F14 — Unknown field categories fail open · **Accept** (high severity)

GLM: the sensitive list is a blocklist; a new sensitive question ("ever been
convicted?") defaults to auto-approvable.

Assessment: correct — fail-open categorization in a safety-critical gate.
Invert: maintain a *safe-category allowlist*; anything uncategorized parks.
Additional issue both drafts share and the review only brushes: **how fields
get categorized is itself unspecified** (deterministic label classifier?
owner-maintained map?). The revision must specify the mechanism, else F14's
fix is unimplementable.

### F15 — CV-variant scope contradiction · **Cosmetic**

Assessment: the gap analysis calls it standalone; LP-20 includes it as
severable. That is a wording inconsistency, not a design defect. Cleanest
resolution: drop §4 from LP-20 and leave it a standalone item, as the gap
analysis says. No safety content either way.

## Missed-entirely items

### M1 — No post-submission error response · **Accept**

Real gap. Minimal scope for LP-19: the "flag as wrong" action (F11) doubles
as the error-record entry point; add an optional owner-triggered follow-up
(withdrawal-email draft from a template). Anything more is out of scope.

### M2 — No submission pacing / rate caps · **Accept** (high value, cheap)

Real and important — ATS bot detection is an account-level risk the drafts
never mention. Belongs in LP-18's `schedule.json`: max submissions/day,
minimum inter-submission interval, randomized jitter. Trivial to implement,
should have been in the draft.

### M3 — No dry-run→approve TOCTOU check at L2 · **Accept, with scope impact**

Real: at L2 nobody looks at the page between dry-run classification and
`browser_respond_approval`; the form can change in that window. Fix requires
a re-verification of form state at approval time — which means an
**extension-side change**, contradicting LP-19's "no extension changes"
scope line. The revision must either add that scope honestly or gate L2 on a
console-side re-dry-run immediately before responding (weaker, but
extension-free). Decide at stamp time.

## Disposition summary

| Verdict | Findings |
| --- | --- |
| Accept | F1 F2 F3 F4 F5 F7 F9 F10 F11 F13 F14 · M1 M2 M3 |
| Accept with modified fix | F6 F8 |
| Partial | F12 |
| Cosmetic / no change | F15 |

## Recommended next step

Revise all three drafts before stamping — the review changes no architecture
but corrects one spec bug (F2), three cross-RFC drift errors (F3, F9, F13),
and hardens the autonomy policy materially (F1, F7, F14, F10, M3). The
sequencing recommendation survives intact (LP-18 → LP-20 ∥ → LP-19), with
LP-18's prerequisite restated as "LP-18 *including approval-decision
logging*".

## Revision 2 and re-review (same day)

All accepted dispositions were folded into the three drafts, then the same
model was asked to grade its own findings against the revised text
(`node .artifacts/rfc-review-verify.mjs`, raw output in `.artifacts/`). This
adversarial re-check earned its keep immediately: it closed 16 of 18 findings
but held two at PARTIAL and surfaced four new ones, including a genuine
safety regression introduced by the revision itself.

| Round-1 re-check | Outcome |
| --- | --- |
| 16 of 18 original findings | CLOSED with quoted text |
| F6 (out-of-scope in-flight packages) | PARTIAL → fixed with a durable `outOfScope` flag that survives into `filled-awaiting-submit`/`awaiting-approval` and always-parks under LP-19 §2 |
| M3 (L2 TOCTOU) | PARTIAL, because the console-side fallback left the window open → fixed by making the extension-side freshness check a **hard prerequisite for L2**, fallback removed |

The four new findings, all fixed:

- **N1 — L2 auto-submissions would bypass pacing entirely** (the one that
  matters). Pacing counters were derived from "human gate actions", but at L2
  the console answers the gate, so policy-approved submissions would not have
  counted — defeating the bot-detection protection M2 was added for. Fixed:
  `approval-decisions.jsonl` now records *every* gate resolution with
  `approvedBy: human | policy`; precedents count only `human` rows, pacing
  counts both. This was a defect the revision introduced, caught only because
  the re-check was adversarial rather than confirmatory.
- **N2 — fingerprint mismatch was undetectable.** §3 said the dry-run does not
  recompute the family, so nothing could detect a form renaming a field
  without changing its required set. Fixed: the dry-run recomputes the same
  hash and compares; coverage and fingerprint are now explicitly distinct
  checks.
- **N3 — "fully visible form" was an absence of evidence.** A multi-page form
  passes coverage vacuously. Fixed: positive qualification (no pagination
  affordance, submit control present, kit field set fully accounted for);
  "cannot tell" parks.
- **N4 — scope/open-question contradiction** on whether the extension change
  was required. Resolved by M3's fix: required for L2, not needed for L0/L1.

**Round 2** re-checked those six fixes the same way: **all 22 findings
(F1–F15, M1–M3, N1–N4) CLOSED, no new findings introduced**, verdict "ready
for a decision stamp". It confirmed the two previously-partial items are now
fully resolved — the `outOfScope` cross-reference exists in LP-19's actual
rule list rather than only in LP-18's prose, and the L2 freshness check is a
hard prerequisite with the weaker fallback explicitly rejected. One minor
under-specification was noted and deliberately left: how the `outOfScope`
flag clears if criteria revert. It fails safe (the flag parks), so it is an
implementation detail, not a design gap.

**Assessment of the re-check itself:** N1 alone justifies the pass. A
confirmatory re-read ("does the revision mention pacing? yes") would have
missed it; the finding only appears if you trace which log the counters read
and who writes rows to it. Worth repeating this two-round pattern on any RFC
whose revisions touch safety-critical accounting.

Two mechanical notes for whoever reruns these scripts: long reasoning passes
exceed undici's `headersTimeout` while the socket sits header-silent, so the
request must stream (an `AbortSignal` does not help — it governs a different
timer); and round 2's prompt carries both the prior review and the longer
revised drafts, so it needs a materially larger `max_tokens` than round 1.
Both scripts fail loudly on truncation rather than reporting a partial review
as a clean one.

## Status

Revision 2 of all three RFCs is **re-reviewed clean and awaiting owner
Decision Stamps**. Two items are deliberately left for the stamp: LP-19's
activation thresholds (N=5/10 recommended, to be calibrated against LP-18's
first weeks of `approval-decisions.jsonl`) and LP-19 Open Question 4's
ATS-corpus spike for pagination detection, which gates L2 but not L0/L1.
