# RFC LP-23 — Parse-First Discovery and Tentative Kits (link → table → iterate → fill)

Lifecycle status: **Draft (not stamped)** — awaiting a Decision Stamp before implementation. Back to the LP-18/19/20 house rule: LP-22's build-ahead-of-stamp sequence was a one-off on explicit owner instruction, not precedent.
Date: 2026-07-23
Scope: new `scripts/jobagent/ats/` adapter layer (Ashby, Greenhouse, Lever, generic HTML) with a three-tier fetch; a fourth field provenance (`proposed`) plus a per-field review marker in the kit-draft schema; two CLI verbs (`set`, `accept`) and a `--tentative` drafting mode; `approve-kit` refusal rule extended; wrapper updates in `skills/jobagent/`. The daemon stays LLM-free. **Neither human gate is removed; the kit gate gains a stricter refusal condition.**
Related: RFC LP-22 (this amends its §6 "hand-authored library stays canonical" boundary); RFC LP-20 (free-text drafting — stays parked as written; §4 below supersedes its scope with a containment story it lacked); [JobAgent README](../../../scripts/jobagent/README.md) (safety model); issue #110 (cvServe derivation — orthogonal, unchanged by this RFC)

## Problem

The owner's target loop is: *drop a link → get the description and every form
field back as a tentative, editable table in Claude Code / pi / Codex →
iterate on the answers → agree → only then does OpenSidebar touch the form.*

The first real-employer run (Ashby "Engineering Manager - EU", 2026-07-23)
showed how far the current pipeline is from that, in four concrete ways:

1. **Discovery is slow and model-dependent.** Every `assess`/`questions` call
   drives the browser through an LLM extraction (~4 minutes per posting), and
   on its first real page the extractor returned prose instead of JSON. The
   instruction was hardened the same day, but field discovery still depends on
   model output when, for the major ATSes, the data is sitting in a public
   JSON endpoint or server-rendered HTML.
2. **Select options get lost between stages.** The live form's three factual
   selects (country, visa sponsorship, EMEA timezone) became TODOs *even
   though the answer library had matching answers*, because the extractor did
   not capture the dropdown options and drafting — correctly — refuses to put
   free text into a select whose choices it never saw. The ATS APIs expose
   those options verbatim. This is the fourth between-stage-contract defect in
   this series (LP-22 revision 3's lens): extraction owed drafting the
   options and did not deliver them.
3. **The application form hides behind a click.** The posting URL had no
   fields; the real form lived at a different URL the extractor did not
   surface, and a human had to find it. ATS adapters know the form URL by
   construction.
4. **Drafting refuses the questions that matter.** Ten of fourteen fields came
   back TODO. Three were essays. Under the current rule — "drafting never
   invents an answer" — the table the owner wants (a complete tentative
   version to iterate on) is structurally impossible.

Point 4 is the policy question. Points 1–3 are engineering.

## Proposal

### 1. Parse-first discovery: three tiers, browser last

`assess` and `questions` try, in order:

| Tier | Mechanism | Cost | Needs bridge? |
| --- | --- | --- | --- |
| 1 | **ATS adapter** — recognise the URL, call the ATS's public API | ~1s | no |
| 2 | **Static HTML parse** — fetch the page, read server-rendered/embedded JSON | ~1s | no |
| 3 | **OpenSidebar extraction** — today's path, unchanged | minutes | yes |

Adapters live in `scripts/jobagent/ats/` (one module per ATS + a `generic`
HTML tier), selected by URL shape (`jobs.ashbyhq.com`,
`boards.greenhouse.io` / `job-boards.greenhouse.io`, `jobs.lever.co`). Each
returns the same `{listing, questions, formUrl}` shape tier 3 produces, so
everything downstream is tier-blind. **Filling always uses OpenSidebar** —
this RFC changes how we *read* postings, never how we *write* to them.

What the adapters deliver that tier 3 could not, stated as the between-stage
contract:

- **Select options, verbatim** — Greenhouse's job-board API returns questions
  with their option lists when asked (`questions=true`); this alone converts
  the live run's three factual TODOs into library-resolvable fields.
- **The real form URL by construction**, not by hoping the extractor spots an
  Apply link.
- **Demographic-section structure** — Greenhouse separates EEOC/demographic
  questions from the application proper in its payload, which makes §3's
  never-propose rule detectable structurally rather than by keyword alone.
- **Determinism** — no model in the discovery loop, so the prose-instead-of-
  JSON failure class disappears for tiers 1–2, and repeated calls are
  byte-stable.

A side effect worth naming: tiers 1–2 need no bridge, so `assess`/`questions`
stop contending with active runs (today they 409 while a fill holds the
bridge).

**Phase 0 is a verification spike, not a formality.** Greenhouse's questions
API is documented and known-good. Ashby's public posting API covers listings;
whether the *application form definition* (fields + options) is reachable via
its API or only via the JSON embedded in the server-rendered application page
must be established empirically — same for Lever. The spike's output is a
per-ATS table of what each tier actually yields, and any ATS that cannot
deliver options falls through to tier 3 rather than shipping a half-adapter.

### 2. Tentative kits: the `proposed` provenance

A new drafting mode fills **every** field, but what it cannot ground in the
library it marks with a fourth provenance kind:

```
identity | answer | default   — from the human-authored library (unchanged)
proposed                      — drafted by the agent platform; NOT yet the owner's words
skip                          — deliberately left blank (unchanged)
todo                          — nothing proposed yet (unchanged)
```

Rules that make this safe rather than cosmetic:

- **The daemon never writes a proposal.** It stays deterministic and LLM-free.
  Proposals are authored by the agent platform (Claude Code / pi / Codex — the
  thing that is already a model) and recorded through the CLI. The daemon's
  job is bookkeeping: store the text, store the provenance, refuse approval
  until review.
- **Every proposal carries a `basis`** — a short string naming what it was
  grounded in ("posting: 'you'll own the EU team's hiring'", "CV: led 4-person
  platform team", "library: remote-work"). A proposal with no stateable basis
  is a smell the reviewer should see.
- **Proposals render distinctly** in every surface — the CLI table and all
  three wrappers mark them (`PROPOSED ⚠`), so the owner can always tell their
  words from the platform's.
- **Never-propose list**: demographic/EEO fields (age, gender, race/ethnicity,
  veteran status, disability, and Ashby's "Background" section) are never
  proposed — rendered as `skip` with a note, owner fills or leaves blank.
  Detection is structural where the ATS separates them (Greenhouse) and by a
  deliberately generous matcher elsewhere; the fail-safe direction is chosen
  explicitly: a false positive skips a legitimate question (owner fills it, no
  harm), a false negative would propose a demographic answer (harm), so the
  matcher errs wide.
- **The CV slot is untouched** by tentative mode — #110's guard and derivation
  question stand as they are.

### 3. The review loop: iterate, then agree

Two verbs close the gap between "here is a table" and "I agree":

```
jobagent set <name> "<label>" "<text>"     # owner supplies/overwrites an answer
                                           #   → provenance becomes answer:owner
jobagent accept <name> "<label>"           # owner adopts a proposal as-is
jobagent accept <name> --all-proposed      # explicit bulk adoption (logged as such)
```

`approve-kit` refuses while **any field's provenance is `proposed`** — on top
of the existing unresolved-TODO refusal. So the sequence is structurally:
propose → owner edits or accepts each → approve → fill. Silence never converts
a proposal into an answer; the bulk form exists because re-typing ten accepts
is hostile, but it is a distinct, logged act, not a default.

The iteration itself is conversational — the owner tells the platform "make
the second essay shorter and mention the LP-16 decomposition", the platform
re-proposes via `set --proposed`, the table re-renders. The verbs are the
substrate; the wrappers describe the loop.

### 4. Relationship to LP-20 and LP-22

This un-parks **LP-20's substance** (free-text drafting) with the containment
LP-20 lacked: proposals are provenance-marked, basis-carrying, individually
reviewed, and structurally unable to reach a form unreviewed. LP-20 itself
stays parked as written — its scope (drafting inside the deterministic host
pipeline) is superseded by §2's split, where the platform proposes and the
host only bookkeeps. LP-22 §6's line "the hand-authored library stays
canonical" is amended to: **the library stays the only source that resolves
without review; everything else is proposed and gated.** The 2026-07-18
lesson that motivated the original rule — four confidently-wrong answers with
clean provenance — is answered by the review marker, not by prohibition.

## Non-goals

- Auto-approval of anything (LP-19 stays parked; the gates stand).
- Submitting, scheduling, or unattended operation.
- Multi-page ATS traversal (unchanged hard stop; the spike may shrink this for
  ATSes whose APIs expose all pages' fields at once, but that is a finding to
  report, not a commitment).
- Proposing demographic answers, ever.
- cvServe derivation (#110 proceeds independently).

## Phases

| Phase | Work | Exit criterion |
| --- | --- | --- |
| 0 | ATS spike: what do Ashby/Greenhouse/Lever actually expose? | Per-ATS table of listing/questions/options availability per tier, checked into the RFC dir |
| 1 | Adapter layer + three-tier fetch behind `assess`/`questions` | The live Ashby posting resolves in seconds with its 14 fields **and their select options**; tier 3 still reachable by flag and by fallback |
| 2 | `proposed` provenance + review marker + `set`/`accept` verbs | `approve-kit` refuses an unreviewed proposal; accepts after `accept`; owner `set` overrides always |
| 3 | Tentative mode end-to-end on the parked Ashby package | The full 14-row table renders with 4 library-resolved, 7 proposed-with-basis, 3+ skipped (demographics); nothing fillable until reviewed |
| 4 | Wrapper updates (shared spec + three thin adapters) | Same table, same iterate loop, all platforms; skill lint stays green |
| 5 | One supervised real fill from an agreed tentative kit | Filled via OpenSidebar, page-verified, submit gate exercised or explicitly deferred by the owner |

## Test plan

- **Adapters** — recorded-fixture tests per ATS (no live HTTP in CI); URL
  recognition; tier fallback order; a malformed payload degrades to the next
  tier, never to invented fields.
- **Schema** — `proposed`/reviewed round-trips through save/load; old drafts
  without the field still parse (additive change, no version bump if possible).
- **Gate** — refusal on unreviewed proposals; `accept` and `set` transitions;
  bulk-accept is logged distinctly.
- **Never-propose** — the matcher against a corpus of real demographic labels
  from all three ATSes, asserting the wide-erring direction.
- **Skill lint** — extended only if wrappers need new vocabulary; the existing
  restate-nothing rule already covers the table presentation.

## Risks

| Risk | Mitigation |
| --- | --- |
| ATS APIs change or differ per-org (custom domains, disabled boards) | Tier fallback is the design, not an afterthought; adapters are recognisers + parsers, never required |
| Proposals normalise into "the agent writes my applications" | Provenance + per-field review + distinct rendering; the bulk accept is logged; the never-propose list is hard-coded, not configurable |
| A proposal reaches a form unreviewed via a stale kit | The refusal keys off provenance stored in the draft, not off UI state — an old kit with `proposed` fields is refused regardless of how it got there |
| Basis strings become decorative | Review presents basis next to text; a proposal with basis "—" renders as a warning; reviewers were told why it matters |
| Between-stage contracts again (LP-22's lesson) | Each phase names what it owes the next in its exit criterion — options from adapters to drafting is the load-bearing example, stated in §1 |
| Demographic matcher misses a novel phrasing | Errs wide by design; Greenhouse-style structural separation preferred where available; corpus test grows with each new ATS seen |

## Decisions already made in session (2026-07-23)

Recorded so the stamp confirms rather than re-litigates:

1. **Scope of proposals: everything, marked** — the owner chose full tentative
   tables with distinct `PROPOSED` provenance and review-gated approval, over
   facts-only and over unmarked proposals.
2. **Fetch route: parse-first, OpenSidebar fallback** — over always-browser.
3. **The loop shape**: link → table → iterate → agree → OpenSidebar fills →
   submit gate. Confirmed by the owner in their own words ("then I can iterate
   on these and if I agree we use opensidebar to fill").

## Open questions for the stamp

1. **Demographic carve-out** — recommended and described in §2, raised in
   session but not explicitly confirmed by the owner. Confirm or amend.
2. **Bulk accept** — keep `--all-proposed`, or force per-field review? §3
   recommends keeping it as a distinct logged act.
3. **Where proposals live before recording** — the platform drafts in-context
   and records via `set --proposed`; is a draft-file round-trip (like
   `edit-draft`) also wanted for long essays?

## Recommended Decision

Approve phases 0–2 immediately (spike, adapters, schema+verbs) — they are
engineering with no policy content, and phase 1 alone fixes the slowest and
most fragile part of the real-world loop demonstrated today. Approve phases
3–5 with the demographic carve-out confirmed, since they enact the policy
change §4 describes. Sequence after PR #106's follow-ups only if #110's fix
lands first is desired; otherwise independent.
