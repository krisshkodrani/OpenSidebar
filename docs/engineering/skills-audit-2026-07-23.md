# Skills Audit — OpenSidebar, 2026-07-23 (rev 2, rechecked)

Audited against five best practices for **programmatically embedded** skills
(the end user never sees them; the agent selects them autonomously). Every
claim below was re-verified against the working tree on 2026-07-23. Each
finding is presented as: **how it is** (verbatim evidence), **why it should be
different**, and **the change plan**.

Revision note: rev 1 repeated the `modal-overlay-recovery` skill's claim that
`dismiss_overlays` only CSS-hides overlays. The recheck read the actual
implementation and that claim is only true of its *fallback* path — see
Finding 3, which changes the recommended fix.

---

## Finding 1 — Two skill systems; the visible one is dead, and it has drifted

### How it is

The extension ships **30 skills** hardcoded as TypeScript literals:

- `background/orchestrator/skill-catalog.ts` (1,019 lines) — 30 descriptors
- `background/orchestrator/skill-bodies.ts` (1,568 lines) — 30 procedure bodies

The repo also carries `skills/workflow/<id>/{descriptor.json,SKILL.md}` — 9
directories mirroring 9 of those 30. **Nothing reads them.** A repo-wide search
for `skills/workflow`, `descriptor.json`, or `SKILL.md` in `apps/extension/src`
and `scripts/` finds only `scripts/validate-skills.ts` (schema lint on the dead
tree) and two references to `skills/jobagent/SKILL.md` (a different, live
system). MV3 has no filesystem access and no build step inlines the markdown.

Yet `skills/README.md:47` states:

> The workflow skills in this directory are wired into runtime selection and
> prompt assembly.

And the two copies have already diverged. Concrete diffs for
`modal-overlay-recovery`:

| | `skills/workflow/.../descriptor.json` (dead) | `skill-catalog.ts` (live) |
| --- | --- | --- |
| `discouragedTools` | `["done", "navigate", "type_text", "dismiss_overlays"]` | `["navigate", "type_text", "dismiss_overlays"]` — no `done` |
| triggers | 7, incl. `"can't see the page"`, `"overlays blocking"` | 5 — those two missing |
| notes | 3, ending *"Do **not** call done until ALL blocking overlays are confirmed gone."* | 4, ending *"**Call done after** ALL blocking overlays are confirmed gone."* + an extra stop-searching note the disk copy lacks |

Same skill, opposite emphasis about `done`, and the live copy has a 4th note
nobody mirrored back. Smaller drift elsewhere: `hover-reveal-navigation`
description "hover, **wait**, verify" (disk) vs "hover, verify" (live);
`transactional-act-check-act` trigger "**destructive or** confirm-gated
workflow" (disk) vs "confirm-gated workflow" (live); disk uses `memoryScope`,
live uses `contextScope` — and `validate-skills.ts:124` accepts either, which
is exactly how the split stayed invisible.

### Why it should be different

A green `skills:validate` currently certifies files that cannot affect
behavior, while the files that *do* affect behavior have no validation and no
single source of truth. Anyone editing `skills/workflow/` believes they changed
the agent (the README says so) and ships a no-op. Anyone editing the live
catalog silently widens the drift. This is the failure mode that makes every
other criterion unauditable: you cannot evaluate, ablate, or retire a skill
when the repo disagrees with itself about what the skill says.

### Change plan

Pick one source of truth. Recommendation: **the markdown tree**, generated into
TS at build time — the repo already has this exact pattern
(`pnpm run prompts:build` → `src/prompts/generated.ts`, marked do-not-edit).

1. Extend each `descriptor.json` with the runtime-only fields
   (`requiredEvidence`, `commonFailures`, `executionContract`,
   `requiredEvidenceTypes`, `packId`), and normalize `memoryScope` →
   `contextScope` (drop the alias in `validate-skills.ts:124`).
2. Backfill the 21 runtime-only skills (`email-reply-careful`,
   `paginated-table-scan`, the ServiceNow pair, …) into `skills/workflow/` from
   the live catalog — the live copy wins every drift conflict, since it is
   what's been running and passing E2E.
3. Write `scripts/build-skills.ts` emitting
   `background/orchestrator/skill-catalog.generated.ts` +
   `skill-bodies.generated.ts`; wire it beside `prompts:build`; add a
   dist-check-style staleness guard so CI fails if generated output ≠ sources.
4. Delete the hand-written `skill-catalog.ts` / `skill-bodies.ts` (~2,580
   lines off the landmine ledger; `skills.ts` shrinks toward pure selection
   logic — a ratchet win).
5. Fix `skills/README.md:47` in the same PR ("wired into runtime" becomes true
   at that moment).

Cheap interim guard if the generator waits: a unit test asserting the 9
mirrored ids are field-identical between disk and catalog — it fails today,
which is the point.

---

## Finding 2 — Negative cases exist but are filed where nothing reads them

### How it is

Skill selection is deterministic — `selectPrimarySkillWithKeywordMatcher`
(`skills.ts`) regex-matches the objective/page corpus; the model never sees the
catalog, only the one selected body (injected via `handoff.ts:342-357`). That
makes per-turn description cost ~1 line instead of 30 — better than the
criterion's baseline, and worth stating as a design decision.

But the "when NOT to use" contract is split across three places that don't
talk:

- **Disk `SKILL.md` (dead):** every one of the 9 has an explicit negative
  block, e.g. `cart-modify-checkout`: *"Do not use it for: initial product
  discovery without cart state; generic product-page browsing; non-commerce
  forms…"*. Reaches neither matcher nor model.
- **Live matcher:** `structured-form-fill` is selected by **four** independent
  conditions (`skills.ts:1271-1319` — configurator pattern, profile-field
  pattern, `currentStepLooksLikeFormFill`, plus the generic form regex);
  `transactional-act-check-act` by three, the last being a broad
  `transactionPattern.test(corpus)` fallback.
- **Live body:** warnings arrive *after* selection —
  `transactional-act-check-act`: *"Do not treat this as a catch-all 'hard
  task' skill"*; `budget-aware-execution`: *"Do not use it as the default mode
  for every task."* A prose warning cannot undo a regex that already fired.
  Across all 30 live bodies: 0 "When To Use" sections, 4 negative-case
  phrasings (the disk files' negatives were never ported).

### Why it should be different

For an embedded agent, over-triggering is the cost center: a wrongly-selected
skill injects ~50 lines of off-target procedure into every turn of that node
and skews tool policy (`preferredTools`/`discouragedTools` feed
`resolveSkillToolProfile`). The criterion says "define negative cases" — this
repo *did*, then filed them in the dead tree. `planner.test.ts` has 45 negative
assertions, so non-selection is tested, but the tests pin outcomes of guards
that exist only implicitly in regex ordering.

### Change plan

1. In the Finding-1 schema, add a first-class `notFor: string[]` to the
   descriptor; the generator emits it into the body as a "Not for:" block so
   the model gets the negative case even when the matcher over-fires.
2. Port each disk negative into matcher guards where it's mechanically
   checkable — e.g. `cart-modify-checkout`'s "no cart state yet" becomes: the
   `cartPattern` arm (`skills.ts:1303`) requires a cart/checkout page marker or
   an explicit modify-verb, not just the word "cart" in the objective.
3. Add one `planner.test.ts` case per `notFor` entry asserting non-selection
   (extending the existing 45), so negatives are pinned, not folklore.

---

## Finding 3 — A 52-line skill exists to route around a tool, and it misdescribes the tool

### How it is

`skill-bodies.ts` (`modal-overlay-recovery`, step 2):

> Do NOT use dismiss_overlays — it hides elements visually but does not
> trigger application state changes, so overlays may reappear or remain
> functional.

The actual implementation (`content.ts:800-862`, `autoDismissModals`) tries a
**real close-button click first**, and only falls back to CSS-hiding:

```ts
const closeBtn = findCloseButton(el);
if (closeBtn) {
  closeBtn.click();          // real click — React/Vue state DOES update
  dismissed++;
} else {
  dismissElement(el);        // fallback: data-osb-dismissed → display:none
  dismissed++;
}
```

So the skill bans the tool wholesale for a defect only its fallback path has —
then prescribes, manually, in ~6 numbered steps plus 3 `commonFailures` plus a
4-part `executionContract`, almost exactly what the tool's primary path already
does (find close button → click → re-scan; the tool even reports a
`remainingOverlay` warning, `register-interaction.ts:171`). Meanwhile the
`hide_element` tool description (`definitions.ts:416`) still *recommends*
`dismiss_overlays` "to dismiss ALL overlays at once" — the model receives
contradictory instructions in the same prompt whenever this skill is active.

`navigate-read-return` has the same shape more mildly: 7 fixed steps (record
URL → navigate → read → store → go_back → verify origin) with no judgment
branch — a path, not an outcome.

### Why it should be different

Criterion 3: if the sequence is exact and unvarying, make it code — a skill
spends tokens every activation and re-derives the loop nondeterministically.
Worse here: skill prose and tool description now disagree, and the skill's
factual claim about the tool is stale or was never precise. That is exactly the
"skills as unmaintained second implementation" trap.

### Change plan

1. Make `dismiss_overlays`'s result report *which path* each dismissal took —
   `clicked close button (3), css-hidden (1, may reappear)` — one-line change
   in `autoDismissModals`'s `DismissResult` + message formatting in
   `register-interaction.ts:166-172`.
2. Strengthen the fallback: dispatch Escape / synthesized click on the
   overlay's most-likely control before CSS-hiding, so the fallback is rarer.
3. Rewrite the skill body to match reality: "Use `dismiss_overlays` first; for
   any overlay it reports as css-hidden, click its real close control and
   re-read." The body should shrink from ~52 lines to ~15.
4. Then ablate (Finding 5 machinery): if pass rate on
   `tests/e2e/modal-overlays.test.ts` + `continuation-act-check-act.test.ts`
   holds with the slim body — or with none — retire accordingly.
5. Re-audit `navigate-read-return` the same way after a `lookup_and_return`
   composite is considered.

---

## Finding 4 — Selection is well-tested; effectiveness has never been measured

### How it is

- `tests/background/planner.test.ts`: **56** `selectPrimarySkill` call sites,
  **45** negative assertions. Deterministic, offline, isolated — the
  "clean environment" and sample-count requirements are met *for selection*.
- Effectiveness: nothing. No test anywhere asserts that injecting a skill body
  changes task success, turn count, or token spend. The E2E harness already
  records which skills fired per run (`tests/e2e/helpers/diagnostics.ts:729-770`
  collects `skillIds` from `plan_decomposed` / node events) — and that data is
  used only for reporting.
- Cross-harness: bodies were tuned during LP-17 against specific executor
  seats; the seat has changed three times since 2026-07-10 (kimi → minimax-m3
  default, qwen3p7-plus strongest). No eval has ever re-run skills across
  seats.
- Multi-trial: matcher determinism makes trials moot for selection, but the 3–6
  trial requirement applies to the *behavioral* effect of a body, which is
  untested at any trial count.

### Why it should be different

The criterion's core loop — measure with/without, repeatedly, per harness — is
the only way to know a skill earns its tokens. Today the repo can prove a skill
*fires* correctly but not that it *helps*; every body is de facto
grandfathered.

### Change plan

1. Add `E2E_SUITE_FLAGS=--skills=off` (plumbed through the existing
   `enabledSkillPackIds`/candidate mechanism once Finding 5 lands) so a tier
   can run skill-free.
2. Extend the E2E report (`helpers/report.ts`) with a per-test
   `skillIds × outcome × tokens` row; the capture already exists, this is
   formatting.
3. Baseline protocol: easy+medium tiers, 3 runs on / 3 runs off, per executor
   seat in the default rotation. Gate on the existing flaky-telemetry tooling
   to keep noise honest. (Live-agent runs need Kris's approval per standing
   policy — this plan stops at the tooling until then.)

---

## Finding 5 — Retirement is impossible: 26 of 30 skills have no off switch

### How it is

`resolveEligibleSkillCandidates` (`skills.ts:349-353`):

```ts
for (const skill of SKILL_CATALOG) {
  if (!skill.packId) {
    addSkill(skill, "Core workflow skills are always eligible.", "always");
  }
}
```

`packId` appears **4 times** in the catalog — `email-reply-careful`,
`multi-tab-checklist-workflow`, and the two ServiceNow skills, via 3
`BUILT_IN_SKILL_PACKS` (all `enabledByDefault: true`). Every other skill is
unconditionally eligible; `enabledSkillPackIds` (the only knob, surfaced in
`settings-slice.ts:16`) cannot touch them. And all 30 descriptors say
`maturity: "candidate"` — in the catalog's lifetime not one skill has been
promoted to `active` or retired, so the field encodes nothing.

### Why it should be different

Criterion 5 treats skills as scaffolding to be removed when the base model
absorbs the workflow. Likely candidates already exist (`structured-form-fill`'s
submit-last discipline, `search-answer-extraction`) — but the comparison run
literally cannot be configured. A catalog that only grows converges on 30
always-candidate skills nobody can justify or delete.

### Change plan

1. Add `disabledSkillIds?: readonly string[]` to `SkillCatalogOptions`
   (`skill-types.ts:51`) and filter in `resolveEligibleSkillCandidates` — a
   ~10-line change that unblocks all ablation, without forcing every skill
   into a pack.
2. Plumb it from settings/E2E flags like `enabledSkillPackIds` already is.
3. Define maturity transitions in `skills/README.md`: `candidate` → `active`
   requires a Finding-4 paired run showing improvement; `active` → deleted when
   a paired run shows parity without it. First ablation targets:
   `modal-overlay-recovery` (post Finding-3 fix), `structured-form-fill`,
   `search-answer-extraction`.

---

## Finding 6 — `.claude/skills/` (coding-agent side): one weak description

### How it is

These five ARE description-selected, so criterion 1 applies literally. Four are
exemplary — hard directives, explicit negatives, literal trigger strings
(`production-query`: *"Use BEFORE designing, planning, or implementing any
change to a live, Bluebox-visible service"* + ~20 triggers;
`bluebox-otel-instrumentation`: *"Do NOT use for OpenTelemetry setups that
target a non-Bluebox backend"*). `jobagent/SKILL.md` is a 12-line adapter
deferring to the shared spec, mechanically enforced by `skill-lint.mjs`.

The outlier — `bluebox-overview`:

> Teaches a coding agent what Bluebox is, when to invoke it, and how to phrase
> requests so the agent picks the right Bluebox skill…

Passive, no trigger conditions, no negatives — it pays description rent in
every session while telling the model nothing about *when*.

### Why it should be different

A description that doesn't state when-to-fire either never triggers (wasted
rent) or triggers on vibes (wrong-skill selection) — precisely the criterion-1
failure. Note: these four Bluebox skills are installed by `bluebox setup` (per
their `compatibility` frontmatter), so the fix may belong upstream.

### Change plan

Rewrite as a directive router — *"Use when the user mentions Bluebox but no
more specific Bluebox skill matches; route investigation-marker tickets to
bluebox-investigation-context, OTel setup to bluebox-otel-instrumentation,
production questions to production-query. Do not use when a specific marker or
trigger already matches."* If upstream-owned, file it against `bluebox setup`
instead of hand-editing.

---

## Summary scorecard and sequencing

| Criterion | Grade | Key evidence |
| --- | --- | --- |
| 1. Descriptions | **Strong architecture, misfiled negatives** | 1-line/turn cost by design; disk negatives reach nothing; 4-way `structured-form-fill` triggers |
| 2. Lean & layered | **Pass** | Bodies 28–73 lines (median ~52); ~8 filler hits repo-wide; `## Relevance` sections are authoring metadata in instruction files |
| 3. Outcomes vs paths | **Mixed** | `modal-overlay-recovery` re-implements its banned tool's primary path; skill prose contradicts `definitions.ts:416` |
| 4. Eval harness | **Half-built** | 56/45 selection cases; zero effectiveness measurement; `skillIds` capture exists unused |
| 5. Ablation | **Blocked** | `!skill.packId → always eligible`; 26/30 unswitchable; 30/30 forever-`candidate` |

Execution order (each PR-sized):

1. **Ablation switch** (F5.1-2) — smallest change, unblocks measurement.
2. **Generator + drift resolution** (F1) — single source of truth; ratchet win.
3. **`dismiss_overlays` truth-telling + skill rewrite** (F3).
4. **Negative-case port + non-selection tests** (F2).
5. **Paired on/off baseline** (F4) — needs 1; live runs need Kris's approval.
6. **`bluebox-overview` rewrite or upstream issue** (F6) — independent, anytime.
