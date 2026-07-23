# Tools Audit — OpenSidebar, 2026-07-23

Companion to `skills-audit-2026-07-23.md`, same method: per finding, **how it
is** (verbatim, `file:line`), **why it should be different**, **change plan**.
All claims verified against the working tree on 2026-07-23.

Why tools deserve this audit even more than skills: the selected skill costs one
injected body per node; **tool definitions ride in every request on every
turn**. The full surface is 52 tools (50 in `background/tools/definitions.ts`,
2 in the ServiceNow adapter), ≈ **10.4K tokens** of schema if sent unfiltered
(measured: `node scratchpad/tool-def-tokens.mjs`, chars/4 per `*_DEF`). A
per-turn profile pipeline filters and reorders that list — which is where the
biggest finding lives (Finding 5).

## The best-practices frame (criteria)

Adapted from Anthropic's tool-writing guidance for agents, plus this repo's own
conventions (CLAUDE.md three-layer parity rule):

1. **Descriptions are directives with negative cases** — when to use, when NOT,
   with accurate cross-references to the sibling tool covering the negative
   case; no contradictions with skills or prompts.
2. **Schemas are strict** — enums over free strings, `required` that matches
   reality, param names identical across ToolDefinition ↔ TS args ↔
   `content/actions/`.
3. **Consolidate: workflow-shaped tools over primitive chains** the model must
   re-derive each run.
4. **Results are token-efficient; errors steer recovery.**
5. **The tool surface is stable enough to cache** — per-turn churn in the tools
   array is a cache-key change at the provider, and must be measured, not
   assumed free.
6. **Tool use is evaluated** — not just execution correctness, but selection
   quality and misuse rates.

Headline: this codebase is **well ahead of baseline** on 1–3 (several
definitions are textbook), and the material findings are on 5 (unmeasured cache
churn), 2 (a parity-test blind spot), and 6 (no selection-quality evals) — plus
a handful of specific description defects.

---

## Finding 1 — Descriptions: mostly exemplary; five concrete defects

### How it is

The good ones are genuinely good — directive, negative-cased, cross-referenced,
with anti-overuse guards:

- `READ_PAGE` (`definitions.ts:131`): *"Only needed after find_element fails or
  dynamic content changes. Snapshot already refreshes after every action —
  don't call just to re-read."*
- `COMPOSE_TEXT` (`:59`): *"Use this — not type_text — for any free-text answer
  or prose … Do NOT use it for short structured values (names, emails, dates,
  numbers); type those directly."*
- `CLICK_COORDINATES` (`:741`): *"ONLY use when the target has no [N] tag …
  Prefer click_element when a tag exists."*
- `INSPECT_REGION` (`:911`): cross-refs (*"Try inspect_chart first"*) plus a
  budget (*"Max 2 per turn"*).

The defects, all verified:

1. **Contradiction with the active skill.** `HIDE_ELEMENT_DEF`
   (`definitions.ts:416`): *"To dismiss ALL overlays at once, use
   dismiss_overlays."* When `modal-overlay-recovery` is selected, the injected
   skill body (`skill-bodies.ts`) says *"Do NOT use dismiss_overlays"* — both
   texts sit in the same prompt. (The skill's stated reason is also wrong; the
   tool description is the accurate one — `autoDismissModals`
   (`content.ts:846-855`) clicks real close buttons first. Documented as the
   skills audit's Finding 3.)
2. **Internal-facing description #1.** `UPDATE_PLAN_DEF` (`:1302`): *"Update
   the current task plan… **Intercepted by the agent loop to broadcast progress
   to the side panel.**"* The second sentence describes plumbing, not
   when-to-call. It spends tokens telling the model something only maintainers
   care about, and gives no trigger ("after completing a plan step", "when the
   plan changed").
3. **Internal-facing description #2.** `CREATE_WINDOW_DEF` (`:1283`): *"Open a
   new browser window. **Used by the orchestrator for parallel lane
   execution.**"* If it's orchestrator-only, the executor shouldn't see it at
   all (it *is* in the registry the executor gets); if the executor may use it,
   the description must say when. Currently it's neither.
4. **Description/schema mismatch.** `UPLOAD_FILE_DEF` (`:650`): description
   says *"**Provide a url** for the remote file to fetch and attach"* — but
   `required: ["id"]` only (`:663`). An omitted `url` passes schema validation
   and fails at runtime (`register-core-actions.ts:84` returns *"Error: provide
   a url…"*). The schema should encode what the prose demands.
5. **Bare one-liners in the riskiest category.** `SET_COOKIE_DEF` (`:808`):
   *"Set a cookie for a URL."* `DELETE_COOKIE_DEF` (`:827`), `GET_COOKIES_DEF`
   (`:790`), `SEARCH_HISTORY_DEF` (`:843`) are similar. These are the
   privacy-sensitive tools, and they carry the least guidance in the file —
   no when-to-use, no caution, no cross-reference.

### Why it should be different

Every description is read ~every turn; a contradiction (defect 1) forces the
model to arbitrate between its tool list and its skill on each overlay task,
and internal-facing text (2, 3) is the tool-side version of the "no-op
instruction" — tokens that cannot change behavior. Defect 4 is the exact
failure class the repo's own parity test was built for (silent no-op at
runtime), just between description and schema instead of between layers.

### Change plan

- Defect 1 resolves with the skills-audit Finding 3 rewrite (skill body starts
  "Use dismiss_overlays first…") — one PR covers both sides.
- Defects 2–3: rewrite as directives ("Call after completing or revising a plan
  step; summary is shown to the user") — or, for `create_window`, add it to the
  executor's `disabledTools` set if it is truly orchestrator-only
  (`prepare-model-turn.ts:97` already threads an exclusion set).
- Defect 4: make it `required: ["id", "url"]` — then `tool-param-parity`'s
  required-vs-optional check (`tool-param-parity.test.ts:211-217`) will keep
  the interface honest (`UploadFileArgs` needs the same change).
- Defect 5: one sentence each: purpose + when-not (e.g. *"Only for tasks the
  user explicitly framed around cookies/session state; never to bypass consent
  UIs."*).

---

## Finding 2 — Schema quality: strong core, with a parity-test blind spot

### How it is

The repo has something most agent codebases lack: `tool-param-parity.test.ts`
(274 lines, issue #43/PR #84) mechanically compares schema ↔
`shared-types/tools.ts` interfaces ↔ `content/actions/index.ts` dispatch casts,
plus a convention test (no `tag`; `id` is integer). It already caught 2 stale
interfaces at introduction.

Verified gaps:

- **ServiceNow definitions are outside all three parity checks.** The test
  builds its universe from `import * as toolDefs from
  ".../tools/definitions"` (`tool-param-parity.test.ts:22`);
  `OPEN_SERVICENOW_MODULE_DEF` / `CONFIGURE_SERVICENOW_FORM_DEF` live in
  `tools/servicenow/definitions.ts` and are never imported — so even the
  no-`tag`/id-integer conventions test skips them.
- **Silent unpairing.** Schema↔interface tests run only for tools whose
  `XxxArgs` interface exists by naming convention; 45 `*Args` interfaces exist
  for 52 tools. The floor assertion (`:200`, `paired.length >= 30`) prevents
  mass silence but lets individual tools drop out of coverage unnoticed.
- **Union-shaped tools aren't schema-encoded.** `navigate` (`:158`,
  `required: []`) — prose says "Provide url OR query, not both"; schema accepts
  neither and both. Same shape: `scroll_page` (y or direction, `:121`),
  `inspect_region` (id or rect, `:941`). An empty `navigate()` call is
  schema-valid and meaningless.
- **Free strings that should be enums.** `apply_list_filter.conditions[].operator`
  (`:1013`) enumerates its legal values in prose ("is", "is empty", "is not",
  "starts with") instead of an `enum`. Contrast `apply_list_sort.direction`
  (`:1072`) which does it right.

### Why it should be different

The parity test's premise (its own header, `:9-14`: mismatches are "silent at
runtime") applies with extra force to the SN tools — they are the two most
complex schemas in the system (`configure_catalog_item` is the single biggest
def at ~906 est. tokens; `configure_servicenow_form` ~429) and the two the
model gets wrong at the highest cost (submits on enterprise forms). Historical
proof: issue #43's audit found `ConfigureCatalogItemArgs` missing
`optionFields` — exactly this family.

### Change plan

1. Import `../../src/background/tools/servicenow/definitions` into the parity
   test's `defsByWireName` (one-line change at `:22`, plus module import).
2. Replace the ≥30 floor with an explicit allowlist of known-uninterfaced tools
   so a *new* unpaired tool fails loudly; burn the list down opportunistically.
3. Encode unions: either JSON-schema `oneOf`/`anyOf` where providers accept it
   (verify against the OpenAI-compat subset Fireworks supports), or at minimum
   keep prose but add handler-side errors that name the missing param.
   (Correction on recheck: the `navigate` handler already rejects empty and
   double-armed calls — `tools/index.ts:59-60` — so the gap is schema-level
   only there; `scroll_page` and `inspect_region` remain to be checked.)
4. `operator` → `enum` (and check the SN records helper accepts exactly that
   set).

---

## Finding 3 — Consolidation: the repo already made the right bet; two candidates remain

### How it is

The catalog shows deliberate workflow-shaped consolidation, each description
explicitly steering away from the primitive chain it replaces:

- `apply_list_filter` (`:995`): *"call this as the first mutation **instead of
  manually clicking complex filter-builder widgets**"* — likewise
  `apply_list_sort`, `apply_list_action`, `configure_catalog_item` (*"instead
  of separate select_option, set_checkbox, type_text, radio-option clicks, and
  submit clicks"*), `configure_servicenow_form`, `search_knowledge_base`,
  `select_option` (native + custom comboboxes in one tool), `compose_text`
  (delegates prose to the Writer seat).

This is criterion 3 done properly, and it's where the token budget goes: the
top 6 defs by size are all workflow tools (~3.3K est. tokens of the 10.4K).

The read/inspect family is 9 tools (`read_page`, `read_element`,
`find_element`, `inspect_hidden`, `xray_page`, `inspect_region`,
`inspect_chart`, `inspect_table`, `inspect_filter_state`) but the
disambiguation web is nearly complete — each hard case cross-references its
sibling (find_element↔inspect_hidden, xray_page→inspect_hidden,
inspect_region→inspect_chart, read_element→"check the snapshot first").

Remaining candidates:

- `extract_form_state` (`:611`) vs `inspect_table`/`inspect_filter_state`:
  three read-only "summarize structured UI" tools with no cross-references
  among them; none says when it beats the others.
- `xray_page` (`:1273`) is a stateful toggle ("Call again to disable") — the
  only tool whose second identical call *undoes* the first; toggle state is the
  kind of hidden state that produces stuck loops. Worth checking trace evidence
  for xray left on.

### Why it should be different

Only marginally — this criterion is largely satisfied. The two candidates cost
little but are the natural next dedup pass, and the skills-audit's
`navigate-read-return` retirement idea (a `lookup_and_return` composite) would
slot into exactly this pattern.

### Change plan

Add mutual cross-references to the three structured-read tools (one sentence
each); audit traces for orphaned xray toggles and, if found, auto-disable xray
on navigation. No mergers recommended now.

---

## Finding 4 — Results: good truncation discipline; error strings uneven

### How it is

Sampled handlers show consistent budget discipline on the read side:
`register-inspection.ts` caps everything (`slice(0, TEXT_MAX)` `:183`, per-list
caps `:296,:353,:427-470`), and defaults/max bounds are declared in the schemas
("default: 30, max: 100"). Good recovery-steering examples exist:
`dismiss_overlays` reports survivors with a next step —
*"Warning: overlay [N] still covers X% of viewport. **Use hide_element to
remove it.**"* (`register-interaction.ts:171`); `go_back` returns the landing
URL + "Fresh page snapshot is available" (`register-core-actions.ts:188`).

Uneven spots:

- `registry.ts:63`: *"Error: Tool ${name} not found."* — no pointer to the
  capability catalog or the active tool list (this fires exactly when the model
  hallucinated a tool name, i.e. when guidance matters most).
- `registry.ts:75`: *"Error: Invalid JSON arguments for ${name}."* — doesn't
  echo the expected parameter names, though they're one lookup away.
- Bare errors like `register-core-actions.ts:190` *"Error going back: msg"* —
  passthrough of a Chrome exception with no suggested recovery
  (vs the `go_back` def's own claim that history can be unreliable —
  `navigate-read-return`'s skill even warns about it).

### Why it should be different

An error string is the only feedback channel at the moment of failure; a
recovery hint there is worth more than the same hint in a description the model
read 40 turns ago. The three registry-level strings are shared by all 52 tools,
so they're the highest-leverage lines in the whole result surface.

### Change plan

1. `registry.ts:63` → append the turn's available tool names (the registry has
   `this.definitions`): *"Not found. Available: click_element, type_text, …"*
   (capped).
2. `registry.ts:75` → append `Object.keys(def.function.parameters.properties)`.
3. Sweep `register-*.ts` `Error …` returns for missing next-step hints; fix the
   worst ~5 (go_back, upload_file fetch failures already decent).

---

## Finding 5 — Cache stability: the tools array is reordered per turn and nobody can see it

### How it is

The per-turn pipeline (`turn-phases/prepare-model-turn.ts:104-107`):

```ts
selectTools: (definitions) => {
  const selected = host.applySkillToolRanking(
    host.applySkillToolSuppression(host.applyToolProfile(definitions)),
  );
```

- `applyToolProfile` (`loop-skill-tools.ts:201-309`) filters by plan-step
  profile or DOM-aware profile — the tool SET changes across steps and DOM
  states, and widens on step stagnation (`:231`).
- `applySkillToolRanking` (`:73-143`) **reorders** the survivors into
  preferred/neutral/discouraged buckets whenever a skill is active.

Meanwhile the LP-21 prefix telemetry fingerprints **messages only**:
`fingerprintPrompt(messages)` (`loop-turn-preparation.ts:90`;
`prompt-prefix-telemetry.ts:166-167` takes `messages: LLMMessage[]`). The
tools array is passed to the LLM client separately and is never fingerprinted.
The #107 fix was aware of the SET problem for the *catalog message* — its
comment (`tool-capabilities.ts:278-282`) even notes reordering is "sorted away"
*for the catalog* — but the tools **array** sent as the API `tools` param is
not sorted away; ranking mutates its byte order turn over turn.

OpenAI-compatible providers include the `tools` param in the cached prefix (it
precedes messages in the serialized prompt). So:

- a tool-profile switch, a stagnation widening, a DOM-profile delta, or a
  skill-ranking flip changes the request's cache key **ahead of every message**;
- the divergence classifier can't attribute it — regions are only
  `system` / `history` / `volatile_tail`
  (`.artifacts/cache/baseline-2026-07-23.json`);
- and the baseline's headline anomaly is exactly an attribution hole:
  **`unexplainedDivergencePct: 99.02`** on the minimax-m3 executor group (205
  warm turns) — divergence the message fingerprint cannot explain. An input the
  telemetry doesn't hash is precisely what such a residue would look like.

### Why it should be different

This is the highest-stakes finding in the audit: the pipeline deliberately
trades guidance (profiles, ranking) for what may be systematic warm-miss on
~10K tokens of schema prefix, and the trade has never been priced because the
measuring instrument doesn't cover the input. It is also a direct candidate for
LP-21 #103's remaining unexplained divergence — evidence for step 3, not a new
investigation.

### Change plan

1. **Instrument first** (small, safe): extend `fingerprintPrompt` (or add a
   sibling `fingerprintTools`) to hash the ordered tool-name list + def bytes;
   add a `tools` divergence region to the classifier and `cache:report`. Feed
   into the LP-21 natural-data observation window already running — no new
   synthetic runs needed (Kris's standing call).
2. **If tools-churn shows up hot**, cheap mitigations in preference order:
   a. Sort the final selected array canonically (by wire name) and express
      skill preference ONLY through the capability catalog / skill body —
      ranking's effect on model choice is unmeasured, its cache cost would now
      be measured; ablate it (the trace event `skill_tool_ranking_applied`
      already exists to compare).
   b. Stabilize the SET: send the union of profile tools for the whole node
      instead of per-turn deltas, keeping per-turn *suppression* to the
      capability-catalog text (volatile tail, already cache-cheap post-#107).
3. Decision on 2 belongs with LP-21 step 3/4 — this audit's deliverable is the
   instrument and the hypothesis, cross-referenced in issue #103.

---

## Finding 6 — Evals: execution is heavily tested; selection is not

### How it is

Existing coverage is substantial: `tools.test.ts` (7,101 lines — handler
execution), `tool-param-parity.test.ts` (schema parity),
`tool-capabilities.test.ts` (catalog), `blind-tool-call-policy.test.ts`,
`tool-recovery.test.ts`, `repeat-action-policy` tests, plus the E2E tiers.

What has no coverage: **whether the model picks the right tool** — the thing
descriptions exist to cause. Nothing measures wrong-tool rates (type_text where
compose_text was prescribed; manual filter-builder clicking where
apply_list_filter exists; click_coordinates with a tag available), and no test
would catch a description regression that doubles misuse. The raw material
exists: traces record every tool call with args, and `escalate`'s
`missing_tool` assessments (`tool-capabilities.ts:307`) already formalize one
misuse class.

### Why it should be different

Mirror of the skills audit Finding 4: the repo can prove a tool *works* but not
that it gets *chosen*; every description improvement (Finding 1) is currently
unverifiable. The criterion's ablation logic applies to descriptions too — e.g.
does `READ_PAGE`'s anti-overuse sentence actually reduce redundant read_page
calls? One trace query would answer it.

### Change plan

1. Add a trace-analysis pass (fits the existing trace-viewer `analyze.ts`
   pattern) computing per-run: redundant `read_page` count, manual-chain count
   on pages where a workflow tool was available, `click_coordinates`-with-tag
   count, tool-not-found count. Surface in the Analytics tab next to the
   skills' `skillIds` capture.
2. Treat those four rates as the regression metric for any future description
   change — same paired-run machinery as the skills-audit Finding 4 plan.

---

## Scorecard

| Criterion | Grade | One-line evidence |
| --- | --- | --- |
| 1. Descriptions | **Strong, 5 defects** | COMPOSE_TEXT/CLICK_COORDINATES exemplary; hide_element↔skill contradiction; UPDATE_PLAN/CREATE_WINDOW internal-facing; upload_file prose≠schema; cookie tools bare |
| 2. Schemas | **Strong, blind spot** | Parity test is best-in-class but never sees the 2 biggest schemas (SN adapter); union tools unencoded; one prose-enum |
| 3. Consolidation | **Pass** | 8 workflow tools each steering away from primitive chains; read-family disambiguation near-complete |
| 4. Results | **Pass, uneven errors** | Inspection truncation disciplined; registry's 2 shared error strings give no recovery hint |
| 5. Cache stability | **Unmeasured risk** | Tools array filtered+reordered per turn; `fingerprintPrompt(messages)` never hashes it; baseline shows 99.02% unexplained divergence |
| 6. Evals | **Half-built** | 7.1K lines of execution tests; zero selection-quality measurement |

## Priority actions

| # | Action | Finding | Size |
| --- | --- | --- | --- |
| 1 | Fingerprint the tools array + add `tools` divergence region to cache:report | 5 | Small; feeds LP-21 #103 directly |
| 2 | Import SN defs into `tool-param-parity.test.ts`; allowlist instead of ≥30 floor | 2 | Small |
| 3 | Fix the 5 description defects (pair defect 1 with the skills-audit modal fix) | 1 | Small |
| 4 | Registry error strings: available-tools + expected-params hints | 4 | Tiny |
| 5 | Selection-quality trace metrics (4 misuse rates) in Analytics | 6 | Medium |
| 6 | `upload_file` required fix; `operator` enum; empty-call rejections for union tools | 2 | Small |
| 7 | (Conditional on #1's data) canonical tool ordering; ablate skill ranking | 5 | Decision belongs to LP-21 step 3/4 |

Cross-links: skills audit Findings 3 (overlay contradiction), 4 (paired-run
eval machinery), 5 (ablation switches) share change plans with #3, #5, #7 here.
