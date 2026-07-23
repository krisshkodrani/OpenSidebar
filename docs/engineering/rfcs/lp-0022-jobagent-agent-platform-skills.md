# RFC LP-22 — JobAgent as an Agent-Platform Skill (Claude Code, pi, Codex)

Lifecycle status: **Decision stamped**
Date: 2026-07-23
Decision date: 2026-07-23 (owner decided in session: slug + host-hash ingest
naming, an `AGENTS.md` pointer for Codex rather than an inlined copy, and no
`assess` verdict cache; directed phases 0–1 be implemented ahead of this stamp;
chose manifest re-fill over cross-run tab continuity for issue #109)
Revision 3 — the implementation ran **ahead of** the stamp on owner instruction,
which inverts the LP-18/19/20 house rule of stamp-then-build. Recorded plainly
here so the sequence is not read as precedent. Phases 0–1 shipped as PR #106 and
the full loop was live-proven the same day (see Implementation status).
Scope: `scripts/jobagent-console/` (three new CLI verbs: `ingest`, `assess`, `questions`; no new authority), `scripts/jobagent/` (single-listing ingest path reusing `assessListing`/`recordDiscovery`; form-question extraction), new `skills/jobagent/` shared skill spec plus three thin per-platform wrappers. No extension changes. **Neither human gate changes.**
Related: [JobAgent README](../../../scripts/jobagent/README.md) (safety model); [pi-backend spike](../pi-backend-spike.md) Phase 9; RFC LP-19 (graduated autonomy — remains parked; §6 explains why this RFC does not depend on it), RFC LP-20 (free-text drafting — remains parked)

## Problem

The JobAgent pipeline is complete and live-proven (2026-07-19) but had exactly
one front-end: a single-file web console. That UI was deleted on 2026-07-23 in
favour of a headless daemon plus an 18-verb CLI, on the reasoning that a UI is
a worse editor than an agent for the parts of this pipeline that are writing
and judgment, and a worse queue than a table for the parts that are state.

That leaves the pipeline with a good seam and no driver. Three gaps remain
between "the CLI works" and "an agent applies to a job":

1. **Nothing finds postings outside the configured boards.** Discovery is a
   browser sweep over `search-criteria.json`. A posting you were sent a link to,
   or one that a web search would surface, has no way in.
2. **Nothing produces the form's questions.** `buildKitDraft` takes a
   `FormQuestion[]`, and no host-side code extracts one — the deleted UI relied
   on a human typing them. So the drafting stage, which is the one that turns
   criteria + CV into field values, has no automatic input. This is the actual
   blocker behind "fill the fields automatically", and it is invisible until you
   try to run the loop headlessly.
3. **No platform knows the verbs.** Claude Code, pi, and Codex each need to be
   told what to call and how to judge the output.

## Proposal

### 1. Shape: one CLI, three thin skills

The CLI is the implementation. Each skill is a markdown wrapper that names the
verbs, the judgment rules, and the gates — no pipeline logic in prompt form.

```
  Claude Code skill ─┐
  pi skill ──────────┼──▶  pnpm run jobagent <verb>  ──▶  daemon  ──▶  OpenSidebar
  Codex skill ───────┘         (one tested surface)      (WS bridge)     (the hands)
```

The rule is load-bearing, not stylistic: three prompt dialects reimplementing
triage will drift within a week, and the drift will be silent because each
platform's output looks plausible. Anything a skill needs to *decide* is a
verb's output; anything it needs to *do* is a verb.

**Test that enforces it:** a skill lint (§7) fails if a skill file contains
lifecycle vocabulary (`filled-awaiting-submit`, `submitted-by-user`, ratchet
ordering) outside a fenced quotation of CLI output. Status semantics live in
`recordStatus`; a skill that restates them has begun to fork.

### 2. New verb: `jobagent ingest <url>`

Creates an application package from a single posting URL — the "get a link"
path, and the sink for whatever the skill's web search turns up.

```
pnpm run jobagent ingest https://boards.example/acme/ai-engineer --source websearch
```

1. Opens the URL through the daemon's existing bridge (`browser_run_task` with
   an extraction-only instruction — no clicks, no forms).
2. Extracts `{title, company, location, url, snippet}` — the same shape the
   board sweep already passes to `recordDiscovery`.
3. Feeds it to `recordDiscovery(listing, criteria)` **unchanged**, so criteria
   matching, dedupe, geo/scope rejection, and package writing stay one code
   path with the sweep. A posting that fails criteria is rejected with its
   reason, exactly as a swept one is — ingest is not a criteria bypass.
4. Prints the created package name, or the rejection reason, and exits 0/1.

`--source` is recorded verbatim in the package's provenance so a later audit
can tell a searched posting from a swept one.

**Naming.** The package dir is `company-title` slugified when both were
extracted (`refurbed-ai-product-manager`), and the URL host plus a short hash
when they were not (`boards-greenhouse-io-a3f9c1`). `--name` overrides either.
Ingest never fails on a messy title alone — an unreadable name is recoverable,
a refused ingest in the middle of a twenty-result sweep is friction.

### 3. New verb: `jobagent assess <url>`

Scores a URL against `search-criteria.json` and prints the verdict **without**
creating a package or writing anything. This exists so a skill holding twenty
search results can filter before it ingests, at one page-load each rather than
twenty package writes. Read-only; safe to run at any time.

**Stateless — no verdict cache.** Every call re-loads and re-scores. A cache
would buy unmeasured latency at the cost of an invalidation rule, and its
failure mode is a stale `rejected` that silently hides a job worth applying to.
Revisit when real search-result volume is known (see Resolved decisions §3).

### 4. New verb: `jobagent questions <name>`

Extracts the application form's question labels through OpenSidebar and writes
`questions.json` into the package dir — closing gap (2).

```
pnpm run jobagent questions acme-ai-engineer   # → questions.json, N questions
pnpm run jobagent draft acme-ai-engineer       # now needs no hand-authored input
```

Extraction is deliberately **structural, not semantic**: it reads label text,
input kind, and required-ness from the tagged DOM. It does not guess what a
question means — that is `buildKitDraft`'s job, against the human-authored
answer library, with per-field provenance as it works today.

Multi-page/stepped ATS forms are explicitly **out of scope for v1**: `questions`
reports the pagination it detected and exits 1 with `partial: true` in `--json`
rather than silently drafting a kit for page one of four. A kit built from a
partial extraction is exactly the failure the honesty property is meant to
prevent. (This is the same ATS pagination spike that gates LP-19 L2.)

### 5. The loop, end to end

```
skill: web search ──▶ jobagent assess <url>        (cheap filter, no writes)
                 └──▶ jobagent ingest <url>        (package, criteria-checked)
                      jobagent questions <name>    (form → questions.json)
                      jobagent draft <name>        (questions + answer library → kit)
                      ── HUMAN: review, resolve TODOs, approve-kit ──
                      jobagent fill <name> --follow (fills; never submits)
                      ── HUMAN: decide <approvalId> ──
                      jobagent submit <name> --follow
```

Everything above the first gate is mechanical and belongs to the skill.
Everything at or below it is judgment and belongs to a person.

### 6. Safety model: unchanged, and why that survives "automatically"

"Fill the fields automatically based on our criteria and CV" is satisfied by
automating *discovery, extraction, and drafting* — the three mechanical steps.
It is **not** satisfied by removing `approve-kit`, and this RFC does not.

- **`approve-kit` stays mandatory** before any fill. The agent can still type
  only what a human froze into the run config.
- **The submit gate stays** — `decide` is a separate, deliberate call.
- **The answer library stays hand-authored.** The CV remains an upload artifact
  and a `cvVariants` path. Nothing in this RFC derives typed answers from CV
  prose; that is LP-20, still parked.

The evidence for holding this line is on the record: the 2026-07-18 live smoke
produced a kit whose four wrong answers all carried confident provenance and an
**empty `unresolved` list**. Automating the input to drafting makes that failure
mode more frequent, not less — more packages reach the drafter unattended. The
gate is what converts a confident-wrong kit into a diff someone reads.

Consequence to accept honestly: this RFC raises throughput up to the gate and
not past it. If the gate becomes the bottleneck, the answer is LP-19's
graduated autonomy with its thresholds stamped — not an exception added here.

### 7. Per-platform packaging

One spec, three wrappers. `skills/jobagent/SKILL.md` holds the verb table,
the judgment rules, and the gate protocol; each platform file is a thin adapter.

| Platform | Lives at | Search primitive | Gate presentation |
| --- | --- | --- | --- |
| Claude Code | `.claude/skills/jobagent/SKILL.md` | `WebSearch` | `AskUserQuestion` at the kit and submit gates |
| pi | `.pi/extensions/jobagent-skill.ts` | pi's own search | prompt in the pi session |
| Codex | `skills/jobagent/SKILL.md`, discovered via a pointer section in `AGENTS.md` | Codex web search | prompt in the Codex session |

`skills/jobagent/SKILL.md` is the single source of truth for all three; the
platform files are adapters. `AGENTS.md` gets a short pointer to it and stays a
policy document — the verb table is never copied into it, because §1's
anti-drift rule applies to the spec itself as much as to the wrappers.

Two notes on the split:

- **`.pi/extensions/jobagent.ts` stays as it is.** It is the browser-side
  driver the daemon spawns for board sweeps, not a skill, and it is not
  duplicated by the pi skill. The pi *skill* drives the CLI like the other two.
- **The gate protocol is identical everywhere:** on `--follow` returning at
  `awaiting-approval`, the skill surfaces the approval `context` verbatim, asks
  its human, then calls `decide`. A skill must never call `decide` on its own
  reasoning; the lint in §1 covers the vocabulary, and review covers the rest.

## Non-goals

- Scheduling or unattended operation (LP-18, parked).
- Auto-approval of kits or submits (LP-19, parked).
- LLM-drafted free-text answers (LP-20, parked).
- Multi-page ATS form traversal (§4; spike first).
- Rebuilding any web UI. `jobagent queue` is the queue view.

## Phases

| Phase | Work | Exit criterion | Status (2026-07-23) |
| --- | --- | --- | --- |
| 0 | `assess` + `ingest` over the existing `recordDiscovery` path | A pasted URL becomes a criteria-checked package; a rejected one reports its reason | **Done** — PR #106 |
| 1 | `questions` extraction (single-page forms; partial detection) | `questions` → `draft` runs with no hand-authored input on a fixture form | **Done** — PR #106 |
| 2 | `skills/jobagent/SKILL.md` shared spec + skill lint | Lint fails a skill that restates lifecycle vocabulary | **Spec done, lint NOT built** |
| 3 | Claude Code wrapper | Full loop to the kit gate, driven by the skill, on a fixture | Not started |
| 4 | pi + Codex wrappers | Same transcript shape on all three; no behavioural divergence | **pi adapter done; Codex not started** |
| 5 | One supervised live run, end to end | Filled and submitted with both gates exercised, page-verified | **Done** — see Implementation status |

Phases 3 and 4 are deliberately ordered: prove the loop on one platform before
paying the cost of three, so a spec bug is found once. In practice phase 4's pi
half ran first (pi already had a bridge driver), which is how phase 5 completed
before phase 3 — worth noting so the ordering rationale is not read as having
been followed.

The **skill lint is the outstanding piece of phase 2** and the only mechanical
guard against §1's drift risk. Until it exists, "wrappers stay thin" is a
convention, not an invariant.

## Test plan

- **Unit** — `assess`/`ingest` verdicts against fixture criteria, including
  rejection reasons; `questions` extraction against the e2e fixture forms,
  including a paginated one that must report `partial` and exit 1.
- **Offline** — extend `jobagent-cli.test.ts`; no new network paths in tests.
- **Skill lint** — §1, run in the lint step alongside `loop-ratchet.mjs`.
- **E2E** — one `easy`-tier fixture run covering ingest → questions → draft.
  Live employer forms stay manual and supervised, per the README.

## Risks

| Risk | Mitigation |
| --- | --- |
| Search returns aggregator/spam URLs that ingest as junk packages | `assess` filters before ingest; `--source` provenance makes junk auditable and bulk-archivable |
| Question extraction silently misses fields on a JS-heavy ATS | Partial detection is an error, not a warning (§4); kit stays unbuilt |
| A skill starts making gate decisions to "be helpful" | Gate protocol is explicit; skill lint on lifecycle vocabulary; the daemon is the only status writer regardless of what a skill believes |
| Three wrappers drift | One shared `SKILL.md`; wrappers are adapters only; phase 4 asserts identical transcript shape |
| Ingest becomes a criteria bypass | Ingest goes through `recordDiscovery` unchanged — same matching, same dedupe, same rejection |

**Neither defect that actually materialised is in the table above.** Both were
found by running the loop, not by reasoning about it, and both lived in the
seams *between* the stages this RFC treated as already-solved:

| Defect | Why the table missed it |
| --- | --- |
| The kit's `formUrl` was the posting, not the form — a fill would have opened the job board and found nothing to fill (fixed, PR #106) | The RFC reasoned about ingest and drafting separately and never asked what ingest owed drafting. `applyUrl` was extracted and then dropped on the floor. |
| `submit` opened its own tab, so it never saw the fill it was meant to submit; the run failed before reaching the approval gate (issue #109, fixed) | The RFC treated fill/submit as pre-existing and out of scope. The assumption "already filled in this browser" was true but useless — form state is per-tab, and the two runs get different tabs. |

The transferable lesson for the remaining phases: this RFC's risk analysis was
good at *within-stage* failure (bad extraction, drifting skills) and blind to
*between-stage* contracts. Phases 2–4 should be reviewed with that lens — what
does each stage owe the next, and what silently gets dropped between them.

## Implementation status (2026-07-23)

Phases 0–1 shipped as **PR #106** (4 commits) the same day this RFC was written,
on owner instruction ahead of the stamp.

**Proven live**, driving the real extension against local fixture pages, with a
throwaway seed dir and no real employer involved:

- pi, given only a posting URL and `skills/jobagent/SKILL.md`, ran
  assess → ingest → questions → draft unaided, extracted **10/10** form fields,
  and **stopped at the kit gate** with 3 unresolved questions, nothing filled,
  nothing approved. Its own words: *"The library has no answers for these, and
  I cannot invent them."*
- The post-gate half then ran through the CLI: `edit-draft` → `approve-kit` →
  `fill` → **approval gate** → `decide approve` → `submitted-by-user`. The fill
  was verified byte-exact by reading the page directly rather than trusting the
  agent's self-report, and the submission was confirmed by the fixture's own
  `Application received` heading and result marker.

Both gates were observed doing their job: `approve-kit` returned a 409 listing
the three unresolved fields, and the submit paused for a human decision that the
CLI surfaced verbatim.

**Not proven:** multi-page ATS forms (out of scope, §4), any real employer form,
and the Claude Code and Codex wrappers (phases 3–4). The fixture kit is
deliberately unable to answer three of the form's ten questions, and
`jobagent-fixture-kit.test.ts` pins that — so the rehearsal cannot quietly
degrade into a no-op if someone later completes the fixture library.

## Resolved decisions (2026-07-23)

The three questions this RFC opened were decided by the owner on 2026-07-23,
before stamping. They are recorded here rather than deleted so the reasoning
survives.

1. **Package naming for ingested postings — slug, with host+hash fallback.**
   Slugify `company-title` when both are extracted; fall back to the URL host
   plus a short hash when they are not; `--name` always overrides. Names stay
   readable in `jobagent queue` for the common case, and ingest never fails
   merely because a page had a messy title. Rejected: requiring `--name` on
   every ingest (puts a naming decision in front of the twenty-results-from-
   one-search case this RFC exists to automate) and always host+hash (makes
   the queue unreadable at a glance — the one thing the deleted UI was good
   at).
2. **Codex skill — a pointer in `AGENTS.md`, not an inline copy.** A short
   section in `AGENTS.md` points at `skills/jobagent/SKILL.md`, which stays
   the single shared spec all three platforms read. `AGENTS.md` stays a policy
   document, and the verb table has exactly one copy — which is the anti-drift
   rule in §1 applied to itself. Rejected: inlining the runbook into
   `AGENTS.md` (a second copy that will drift) and shipping no `AGENTS.md`
   pointer at all (Codex then cannot discover the skill without being handed
   the path every session).
3. **`assess` does not cache.** It stays stateless: load, score, print, forget.
   A cache buys latency we have not measured while adding an invalidation rule
   (criteria changed? posting edited in place? how long?), and its failure mode
   is the bad one — a stale `rejected` verdict silently hides a job worth
   applying to. Revisit once real search-result volume is known. Rejected: a
   URL+criteria-hash cache (a posting edited in place still reads stale) and
   pushing the dedupe rule into skill prompt text (§1 forbids exactly that:
   three platforms would interpret it three ways).

## Stale copy noted (not changed here)

RFC LP-18's Scope line still lists "console UI (schedule panel, event feed)" as
a surface. That UI no longer exists. LP-18 is parked, so it is left as-is
deliberately — but if it is ever un-parked, that scope line needs rewriting
against the CLI.
