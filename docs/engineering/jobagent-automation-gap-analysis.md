# JobAgent Automation Gap Analysis (2026-07-20)

What separates the live-proven JobAgent pipeline from an end-to-end automated
job-application system, based on the state after the pi-backend merge
(`4fa4dce2`) and the 2026-07-19 live verification of the full fill + approval
loop. Each gap links to the RFC that proposes closing it, or is marked as a
small standalone item.

## What works today (the baseline)

Every stage below is merged to main; items marked *live-proven* were verified
against the real page, not agent self-report.

| Stage | Mechanism | Status |
| --- | --- | --- |
| Discovery | pi sweep over criteria file → `assessListing` → dedupe → `reviewing` package + audit trail | Live (first sweep: 9 queued / 23 rejected) |
| Kit drafting | Deterministic answer library + identity, per-field provenance, TODO gates | Live-smoked; 5 real-form bugs fixed with regression tests |
| Kit approval | Human review in console; approve blocked while TODOs remain | Live |
| Fill | Console-owned WS bridge runs the fill mission; manifest-only values | Live-proven (byte-exact, `filled-awaiting-submit`) |
| Submit gate | Consequential-click pause → forwarded approval + dry-run diff → human approve → resume | Live-proven (`submitted-by-user`, page-verified) |
| Safety spine | `recordStatus` sole status writer (409 on illegal jumps); PII outside repo; mission cannot invent values | In force |

The pipeline is autonomous *between* two human clicks: kit approval ("these
answers are mine") and submit approval ("send it"). Everything else is manual
*triggering* of autonomous stages.

## Gaps

### G1 — No scheduler: every stage is hand-cranked (→ RFC LP-18)

Nothing triggers a discovery sweep, drafts kits for new `reviewing` packages,
or launches fills for `ready` kits. Each stage runs only when a human invokes
it from the console or CLI. This is the single largest distance-to-automation
item because it compounds: with a scheduler, the two approval gates become the
only human touches; without one, every package needs ~4 manual initiations.

### G2 — No notification channel: approvals require a watched console (→ RFC LP-18)

A run parked at `awaiting-approval` (600s expiry) or a kit with TODOs is
invisible unless the console UI is open. Async automation needs a push
(desktop/webhook) when human input is the blocking dependency, plus a digest
for non-blocking events (sweep results, completed fills).

### G3 — No auto-approve policy: both gates are unconditionally manual (→ RFC LP-19)

Deliberate for now — the EggAI smoke produced a kit with four *confident wrong
answers* and an empty `unresolved` list, exactly the failure a naive
auto-approve would wave through. But the grounded substrate for selective
autonomy already exists: dry-run byte-match (incl. checkbox state), provenance
kinds, risk flags, and the status lifecycle. What is missing is a policy that
converts a *track record* into earned autonomy, with hard always-park rules.

### G4 — No free-text drafting: bespoke questions dead-end as TODOs (→ RFC LP-20)

The deterministic drafter covers structured fields. Any "why this company?",
cover letter, or open question becomes a TODO the human must write by hand in
the console. The `risk-notes.md` honesty lifecycle (`approved`/`needs_review`)
anticipated LLM-drafted prose gated by human approval, but no drafting path is
wired to it.

### G5 — Single-package serialization (→ RFC LP-18, constraint honored)

One bridge port owner + one run mutex means fills are strictly sequential.
This is a correctness constraint (orchestrator same-workspace replacement is
unsafe under concurrency), not a bug — the scheduler must respect it, and
throughput scaling is out of scope until the constraint itself is redesigned.

### G6 — No submission pacing (→ RFC LP-18, added in revision 2)

Surfaced by the glm-5p2 review: nothing limits how fast applications go out.
Automated submissions arriving in a burst are an account-level risk (ATS bot
detection), and a flagged candidate account is a worse outcome than a slow
queue. Daily/weekly caps, a minimum inter-submission interval, and jitter now
live in LP-18 §6.

### G7 — No post-submission error response (→ RFC LP-19, added in revision 2)

Also from the review: every rule in the series is preventive, and applications
cannot be unsubmitted. There was no path for "a wrong one went out" — not even
a record. LP-19 §8 now makes the flag-as-wrong action the entry point, with a
templated withdrawal/correction draft the owner may send or discard.

### Smaller standalone items (no RFC needed)

- **`outcomeSummary` capped upstream** — executor's full final words are not
  recoverable from run records (pi-backend task #36). Telemetry fix.
- **CV variant selection** — the seed holds 11 CV variants but kits always use
  the default; per-job selection is a deterministic listing→variant rule. It
  was briefly folded into LP-20 and removed again in revision 2: it has
  nothing to do with free-text drafting and stays standalone.
- **Stale queue hygiene** — 4 geo-rejected packages from the first sweep still
  sit as `reviewing`; a re-assess pass over queued packages when criteria
  change would fold naturally into LP-18's sweep stage.
- **Criteria refinements** — marketplace excludes, board-specific handling
  (ai-jobs.net registration wall makes it a dead board).

## Proposed division and sequencing

- **[RFC LP-18 — Queue scheduler & notification channel](rfcs/lp-0018-jobagent-scheduler-notifications.md)**
  (machinery): closes G1, G2, G6, honors G5. No autonomy-policy change — both
  human gates stay exactly as they are.
- **[RFC LP-19 — Graduated autonomy policy](rfcs/lp-0019-jobagent-graduated-autonomy.md)**
  (risk policy): closes G3, G7. Depends on LP-18's **approval-decision log**
  (LP-18 §4) — not merely on elapsed time — since its thresholds count human
  decisions the scheduler log does not record.
- **[RFC LP-20 — Free-text answer drafting](rfcs/lp-0020-jobagent-freetext-drafting.md)**
  (content): closes G4. Independent of both; its drafts are permanently
  excluded from LP-19 auto-approval until human-approved into the library, and
  it owns the `context-free`/`context-bound` marking LP-19 depends on.

Sequencing: LP-18 first (compounds everything), LP-20 in parallel
(independent surface), LP-19 last and only after LP-18 — *including its
approval-decision log* — has produced enough clean history to calibrate its
thresholds.

## Revision history

- **Revision 1** (2026-07-20, PR #90): initial gap analysis and three drafts.
- **Revision 2** (2026-07-20, this document + all three RFCs): incorporates
  the [glm-5p2 second-opinion review](rfc-review-jobagent-autonomy-glm-2026-07-20.md).
  Added G6 (pacing) and G7 (post-submission response); corrected the LP-19
  dependency from "track-record volume" to LP-18's approval-decision log;
  moved CV-variant selection back out of LP-20.
