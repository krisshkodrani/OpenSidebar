# RFC LP-20 — JobAgent Free-Text Answer Drafting (Honesty-Gated)

Lifecycle status: Draft (not stamped)
Date: 2026-07-20
Scope: `scripts/jobagent/` drafting extensions (`freetext-drafting.ts`), answer-library schema extension, console kit-review UI (draft display, edit-then-approve, promote-to-library), optional CV-variant selection rule. Uses the existing writer/planner LLM seat via the console's own API client — no extension changes, no new model seats.
Related: [JobAgent automation gap analysis](../jobagent-automation-gap-analysis.md) §G4; risk-notes honesty lifecycle (`approved`/`needs_review`) in the seed schema; RFC LP-19 (drafted content is always-park until promoted); RFC LP-18 (drafting stage hosts this)

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

### 3. Approve-once: promotion into the answer library

When the owner approves a drafted answer, the console offers promotion to the
answer library in one of two forms:

- **verbatim** (question-keyed): reused exactly when the same question
  fingerprint recurs;
- **template** (the owner generalizes it once, with `{{company}}`-style
  slots filled from the listing record at draft time).

Promoted entries carry `approvedAt` + original provenance. On future kits the
deterministic drafter resolves these as ordinary `answer` provenance — which
is what makes LP-19 L1 autonomy reachable for repeat question shapes while
first-encounter questions always stay human-gated.

### 4. CV-variant selection (small, optional, same surface)

The seed holds 11 CV variants but kits always attach the default. Add a
deterministic selection rule (keyword map from listing → variant, owner-
editable, falls back to default + risk flag on ambiguity) in the same
drafting stage. Explicitly severable if the owner prefers to keep this
manual.

## Non-goals

- **No auto-approval of drafted content, ever, at any LP-19 level.** Autonomy
  applies only to human-curated provenance; a draft becomes curated by being
  promoted, not by aging.
- No fine-tuning, no per-application model calls beyond the draft itself.
- No drafting for fields the deterministic drafter can resolve — the LLM
  never overrides the library.
- No scraping beyond the already-recorded listing data (drafting adds no new
  network surface).

## Risks

- **Plausible fabrication** that slips the string post-check (paraphrased
  claims). Mitigation: the human gate is retained unconditionally; the
  post-check narrows the review burden rather than replacing it. The draft UI
  highlights every sentence containing a non-matched proper noun.
- **Voice homogenization** — every application sounds the same. Template
  promotion (owner-authored generalization) rather than silent verbatim reuse
  is the guard; the digest can report reuse counts per entry.
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
deterministic fabrication post-check, and approve-once promotion. Treat CV-
variant selection as a severable amendment for the owner to keep or drop.
Implement offline-testable (fake LLM seam, real post-check), gated behind the
drafting stage so LP-18-scheduled kits get drafts automatically but nothing
changes for manual kit building until then. Independent of LP-19; must land
its always-park exclusion string (`kind: "drafted"`) in shared vocabulary so
the two RFCs cannot drift.
