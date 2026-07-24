# Skills & Tools Roadmap — post-audit, post-baseline (2026-07-23)

Where this comes from: the two audits (`skills-audit-2026-07-23.md`,
`tools-audit-2026-07-23.md`), the fixes shipped in **PR #114 (merged)** and
**PR #115 (open)**, and the **on-arm baseline** run 2026-07-23 16:22–17:44Z
(34 e2e runs, 421 instrumented warm turns; full numbers in
`.artifacts/skills-baseline/RESULTS.md`). Every item below is grounded in
measured data, not prose; items the data killed are listed at the bottom so
they stay dead.

Legend: **[gate]** = needs Kris's decision or approval before work starts.

---

## Now (this week)

### 1. Diagnose `continuation-act-check-act` turn-1 `task_stopped` — first, blocking
0/3 trials failed identically at turn 1 with `task_stopped: "Stopped by user
during execution"` — a harness/turn-contract failure, not agent behavior.
Suspects: today's merges (#111 append-only history, #114) vs the stop-drain
contract (PR #89 semantics). **Until diagnosed, no continuation-family result
is trustworthy**, which also blocks parts of any future ablation arm.
- Repro: single run of the fixture; diff turn-1 message flow vs a pre-#111 trace.
- Size: half a day. Exit: root cause named; fix or fixture-contract update.

### 2. Land PR #115 **[gate: review]**
Two trace-verified live findings (Phase-D app-content guard; modal skill no
longer suppresses `type_text`). The baseline dist already ran with these; main
should match what was measured.

### 3. LP-21: hunt the surviving history-rewrite source
The baseline's biggest surprise: **history diverges on 221 unflagged turns
(unexplained 80.6%) on a build that includes #111 append-only**. The remaining
rewrite source is not compaction (resets are now flagged and counted:
escalation_summarize ×22, threshold compactions) and not the tools array
(now separately attributed).
- Approach: take 3 high-divergence baseline traces, byte-diff consecutive
  turns' history messages at the first diverging block
  (`firstDivergenceMessageIndex` + offset are in every trace) — the rewrite
  will be visible in cleartext.
- This feeds the #103 natural-data verdict directly; the verdict itself stays
  on natural usage per standing decision. **[gate: any fix lands via PR]**
- Size: 1–2 days investigation.

### 4. `press_key` multi-char rejection (small)
Baseline showed the failure mode end-to-end: `press_key("user@test.com")`
"pressed" a 13-char key, then an email was typed one keypress at a time.
Handler-side: reject multi-char non-named keys with
*"press_key takes a single key; use type_text for text."*
- Size: ~20 lines + test. Pairs with a `KeyName` allowlist if we want enums.

---

## Next (1–2 weeks)

### 5. Off-arm ablation runs **[gate: approval + spend]**
The on-arm exists; the switch (`disabledSkillIds`) exists; the fired-skill
list is known (11 skills — RESULTS.md §2). Buy off-arms ONLY for fixtures
where a skill fired, 3 trials each, same seat/prompt population.
- Readout: task success + turns + `costPerWarmTurnUsd`, per fixture,
  on vs off. Skills with parity → first retirement candidates
  (`structured-form-fill` and `search-answer-extraction` were the audit's
  predictions; now testable).
- Depends on item 1 (act-check-act must be trustworthy first).

### 6. Matcher precedence review (two flagship misses)
Baseline: `cross-tab-compare` and `cart-modify-checkout` never fire on their
own flagship fixtures (`chart-value-extraction` and
`list-row-action`/`catalog-order` win). Not wrong outcomes — but if a skill
cannot fire on the fixture it was written for, either the precedence order or
the skill's reason to exist is off. Fold into item 5's data: if the winners
produce equal outcomes, retire the losers instead of reordering the matcher.
- Also port the disk skills' "Do not use for" lists into matcher guards
  (deferred audit F2 action) — with items 5/6 as the before/after measurement.

### 7. Modal fixture timeout headroom (small)
modal-overlays 0/3 in-sequence yet the task completed in the UI every time
(and passed standalone at 127s). The agent finishes; declaring done outruns
the fixture timeout under sequential load. Either widen that fixture's
timeout or profile the completion tail (kernel accept path) on minimax pace.

### 8. Tool-SET stabilization spike — only if LP-21 wants the ~14pp
Tools churn is real but modest: 53/421 warm turns (12.6%), all `set_changed`.
The mitigation consistent with the data is a **per-node tool-profile union**
(stable set for the node's lifetime; per-turn steering stays in the
capability catalog tail, which is already cache-cheap post-#107).
- Do AFTER item 3: history is 6× the cache cost of tools today; fix the big
  leak first. **[gate: A/B approval]**

---

## Later (parked until triggers fire)

### 9. Skill markdown→TS generator (audit F1 end state)
`skills/workflow/` as single source, generated into
`skill-catalog.generated.ts`/`skill-bodies.generated.ts` via the
`prompts:build` pattern; backfill the 21 runtime-only skills to disk; delete
the hand-written pair (~2.5K lines off the landmine ledger).
Trigger: first time drift-parity friction actually bites (the
`skill-disk-parity` test currently holds the line). Also clean the stale
"Relevance" test references found during baseline prep (job-board,
support-ticket, multi-step-form, procurement-list don't exist).

### 10. Selection-quality metrics in the trace viewer (audit F6/T6)
Promote `scan-misuse.mjs` + the expected-skills comparison into
`trace-viewer` Analytics (the `skillIds` capture already exists). Baseline
misuse was ~clean, so this is monitoring, not firefighting — build it when
the Analytics tab is next touched (issues #44/#37/#45 lineage).

### 11. Maturity lifecycle (audit F5.3)
All 30 skills are perpetual `candidate`. After the first off-arm results:
promote what beats its off-arm to `active`, delete what doesn't, document the
rule in `skills/README.md`. Meaningless until item 5 produces data.

### 12. Union-shaped schemas + operator enums (audit T2, low)
`navigate`/`scroll_page`/`inspect_region` accept empty calls schema-side
(handlers already reject); `apply_list_filter.operator` enumerates values in
prose. Encode as `oneOf`/`enum` only after verifying the Fireworks
OpenAI-compat subset. Zero observed misuse in the baseline → low priority.

### 13. Bluebox-owned skill description (`bluebox-overview`)
Passive description, no triggers (audit F6). Upstream-owned by `bluebox
setup` — file it upstream rather than hand-editing local copies.

---

## Dead — killed by baseline data (do not resurrect without new evidence)

- **Canonical tool ordering / `applySkillToolRanking` ablation** (was tools
  audit action #7): 53/53 tools divergences were `set_changed`, **zero**
  `reordered`. Ranking's reorder never broke the cache once. The churn is the
  SET (see item 8).
- **"Skills are being wrongly selected" as a general problem**: 0 wrong-hits
  across 33 fixture runs. The real issues are narrower: two flagship-fixture
  precedence misses (item 6) and blunt suppression (fixed in #115).
- **"Tool misuse is widespread"**: 0 redundant read_page / 0 coord-clicks /
  0 tool-not-found across 95 runs. Keep the scanner; drop the alarm.

## Standing constraints
- E2E/live-agent launches need Kris's approval; rebuild dist-dev with
  `--skip-nx-cache` before ANY run reflects working-tree code.
- #103's verdict comes from natural data (Kris's call); baselines inform,
  they do not decide.
- One population per comparison: same seat, provider, prompt version;
  compare `costPerWarmTurnUsd`, never absolute cost.
- Budgets in `loop-ratchet-budget.json` only go down; landmine files need
  offsetting extraction before any addition.
