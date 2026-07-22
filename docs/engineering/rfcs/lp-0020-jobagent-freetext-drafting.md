# RFC LP-20 — JobAgent Free-Text Answer Drafting (Honesty-Gated)

Lifecycle status: **Parked (2026-07-22)** — JobAgent ships as a reference
implementation, not a supported product feature; this RFC is parked pending a
decision to productize the JobAgent pipeline, and is not scheduled for
implementation. Prior status: Draft (not stamped) — revision 2, incorporating the
[glm-5p2 second-opinion review](../rfc-review-jobagent-autonomy-glm-2026-07-20.md)
(F7, F12, F13, F15)
Date: 2026-07-20
Scope: `scripts/jobagent/` drafting extensions (`freetext-drafting.ts`), answer-library schema extension (including the `context-free`/`context-bound` marking), console kit-review UI (draft display against sources, edit-then-approve, promote-to-library), and the shared blocking-reason vocabulary LP-18's notifications consume. Uses the existing writer/planner LLM seat via the console's own API client — no extension changes, no new model seats. CV-variant selection is **not** in scope (see Non-goals).
Related: [JobAgent automation gap analysis](../jobagent-automation-gap-analysis.md) §G4; risk-notes honesty lifecycle (`approved`/`needs_review`) in the seed schema; RFC LP-19 (drafted content is always-park until promoted; consumes `context-bound`); RFC LP-18 (drafting stage hosts this; consumes the blocking-reason vocabulary)

## Problem

The deterministic drafter resolves structured fields (identity, saved
answers, defaults, skips) and correctly refuses everything else as TODOs. In
practice that means every bespoke prompt — "Why do you want to work here?",
"Describe a project you're proud of", cover letters — dead-ends as a TODO the
owner writes by hand in a console textarea for every single application. This
is the highest-friction human step that is *not* a judgment gate: the
judgment ("is this claim about me true and well-put?") is real, but the
composition is exactly what an LLM should draft for review.

The seed schema anticipated this: `risk-notes.md` defines an
`approved`/`needs_review` lifecycle for prose, and the Phase-5 design states
that only `approved` content may enter the fill manifest — drafted prose is
structurally unsubmittable. The pipeline just never got the drafting arm.

## Proposal

### 1. A `drafted` provenance kind

The kit drafter gains one new resolution path: when a field is free-text and
unresolved, generate a draft with the writer-seat LLM and attach provenance
`{kind: "drafted", model, promptHash, sources: [...]}`. A drafted field is
**equivalent to a TODO for gating purposes**: it blocks kit approval until the
human either edits-and-approves or rejects it. The difference from a TODO is
purely that the textarea starts full instead of empty.

**Shared blocking-reason vocabulary.** Because a kit can now be blocked for
two different reasons that demand different human work, this RFC owns the
vocabulary that LP-18's notifications and the console UI both consume:
`todo` (no answer exists — write one) and `drafted` (a draft is waiting —
review or edit it). Defined in one module, imported by both, so the two RFCs
cannot drift into telling the owner "TODO" when the real task is a two-second
read-and-approve.

### 2. Grounded drafting inputs, honesty rules enforced structurally

The drafting prompt receives only: the job listing's recorded description
(from the discovery audit), the candidate's profile.yml + CV text, the
answer library's already-approved prose, and the question label. It is
explicitly instructed (and the output is post-checked) to:

- make no factual claim absent from profile/CV/library (post-check: every
  named employer, project, technology, and credential in the draft must
  string-match the source corpus; violations demote the draft to a plain TODO
  with the violation listed);
- never state availability, compensation, or legal status (those field
  categories are LP-19 sensitive-list items and are excluded from drafting
  entirely);
- match the answer-library voice examples when present.

The post-check is deterministic and lives beside the drafter with offline
tests; the LLM is never trusted to grade itself.

**What the post-check does not catch, stated plainly.** It is a string-level
fabrication detector: it finds invented employers, projects, technologies, and
credentials. It does **not** catch paraphrase inflation ("I led the team" from
a CV that says "member of the team"), misleading omission, or claims that are
true but irrelevant. The human gate remains the actual safety boundary for
drafted prose — the post-check narrows what the human must hunt for, it does
not replace the hunt.

That is why the review UI matters as much as the check: the draft is shown
**beside its source corpus with matched phrases highlighted**, so the human
reads the draft *against* the evidence rather than in isolation. Sentences
containing any proper noun or credential not matched in the corpus are
flagged for attention. The goal is to make review faster without making it
shallower; a UI that merely presents prose invites skimming, which is exactly
how a paraphrased fabrication would get through.

### 3. Approve-once: promotion into the answer library

When the owner approves a drafted answer, the console offers promotion to the
answer library in one of two forms:

- **verbatim** (question-keyed): reused exactly when the same question
  fingerprint recurs;
- **template** (the owner generalizes it once, with `{{company}}`-style
  slots filled from the listing record at draft time).

**Verbatim promotion is blocked for listing-specific answers.** "Why do you
want to work here?" has the same question fingerprint at every company, so a
verbatim answer containing "I'm excited about AcmeCorp's mission…" would
resolve as ordinary `answer` provenance on BetaCorp's form — putting one
company's name on another's application, and at LP-19 L1 doing so with no
human in the loop. It is an honesty failure with real consequences for the
candidate.

So promotion runs the same proper-noun detector the post-check uses (§2): if
the approved text contains any proper noun drawn from the listing (company,
product, location-specific phrasing), verbatim promotion is refused and only
template promotion is offered, with the offending tokens shown as the reason.

Every library entry is marked accordingly:

- `context-free` — safe to replay verbatim anywhere (e.g. "How did you hear
  about us?", a standing accessibility note). **Only these are eligible for
  LP-19 autonomy.**
- `context-bound` — a template whose slots must be filled from the current
  listing, or an answer the owner explicitly marked as situational. Always
  parks under LP-19 §2, at every level.

Promoted entries carry `approvedAt`, original provenance, and this marking.
On future kits the deterministic drafter resolves them as ordinary `answer`
provenance — which is what makes LP-19 L1 autonomy reachable for repeat
*context-free* question shapes, while first-encounter and situational
questions always stay human-gated.

## Non-goals

- **No auto-approval of drafted content, ever, at any LP-19 level.** Autonomy
  applies only to human-curated provenance; a draft becomes curated by being
  promoted, not by aging.
- No fine-tuning, no per-application model calls beyond the draft itself.
- No drafting for fields the deterministic drafter can resolve — the LLM
  never overrides the library.
- No scraping beyond the already-recorded listing data (drafting adds no new
  network surface).
- **CV-variant selection is out of scope.** The gap analysis lists it as a
  standalone item and it stays one: it is a deterministic listing→variant
  rule with nothing to do with free-text drafting, and folding it in here
  invites an implementer to couple variant choice to the drafting prompt when
  the two should be independent.

## Risks

- **Plausible fabrication** that slips the string post-check (paraphrased
  claims, inflation, omission). Mitigation: the human gate is retained
  unconditionally, and §2's source-beside-draft review UI is what keeps that
  gate meaningful as volume grows. The RFC does not claim the post-check makes
  drafts trustworthy — it claims it makes review tractable.
- **Voice homogenization** — every application sounds the same. Template
  promotion (owner-authored generalization) rather than silent verbatim reuse
  is the guard; the digest can report reuse counts per entry.
- **Promotion-time misclassification** — an answer marked `context-free` that
  is actually situational (no proper noun, but "I'm drawn to early-stage
  hardware teams" on a fintech application). The detector cannot catch this;
  the owner's marking is the control, and LP-19's flag-as-wrong action (§3.1)
  is the recovery path.
- **Cost/latency in the drafting stage**: one writer-seat call per free-text
  field, only on first encounter; repeat questions hit the library. Bounded
  and cheap relative to the fill itself.

## Open questions

1. Which seat drafts: the glm-5p2 writer default, or route through pi so
   drafting benefits from pi's context of the whole package? Recommendation:
   direct writer-seat call from the console (simpler, no port handover), pi
   reserved for discovery.
2. Question fingerprinting for library reuse (exact label vs. normalized
   embedding-free token match) — spike on the real question corpus after a
   few weeks of sweeps.
3. Should rejected drafts be retained as negative examples in the library
   (never resurface this phrasing)?

## Recommended Decision

Approve the `drafted` provenance kind, the grounded-input rule, the
deterministic fabrication post-check with its stated limits, the
source-beside-draft review UI, and approve-once promotion with the
verbatim block and `context-free`/`context-bound` marking. CV-variant
selection is dropped from this RFC and stays a standalone item.

Implement offline-testable (fake LLM seam, real post-check), gated behind the
drafting stage so LP-18-scheduled kits get drafts automatically but nothing
changes for manual kit building until then. Independent of LP-19, but two
pieces of shared vocabulary must land in single modules imported by both, so
the RFCs cannot drift: the always-park provenance string (`kind: "drafted"`)
plus the `context-free`/`context-bound` marking consumed by LP-19 §2, and the
`todo`/`drafted` blocking reasons consumed by LP-18 §3. Regression fixtures
must include a company-specific draft that promotion refuses to store
verbatim.
