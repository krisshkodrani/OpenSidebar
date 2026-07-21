# RFC LP-21 — Prompt-Cache Stability, Correctness, and Measurement

Lifecycle status: Draft (not stamped) — **revision 3**, after two rounds of
glm-5p2 second-opinion design review (2026-07-21). Round 1 found the revision-1
measurement methodology unsound; round 2 found a factual misattribution and a
causal error that revision 2 had introduced. See "Review history" for what
changed in each round.
Date: 2026-07-21
Scope: `background/agent/context.ts` (prompt construction, history compression), `background/agent/loop-skill-tools.ts` (tool-set selection), `background/agent/turn-phases/prepare-model-turn.ts` (affinity, request assembly), `background/llm/client.ts` (failover header preservation), `prompts/runtime/agent/system.md` (section naming), new `scripts/cache-report.mjs` + `scripts/prefix-ratchet.mjs`, new tests under `apps/extension/tests/background/`.
Related: [Token & planner analysis](../token-and-planner-analysis-2026-07-18.md) §3 (the 12,288 stall); [LP-17 efficiency validation](../lp17-efficiency-validation-2026-07-18.md) §P3 (cache-aware block order); RFC LP-16 (the ratchet pattern this RFC reuses)

## Problem

### How the cache works, and why our layout defeats it

A prompt cache stores the model's per-token key/value tensors so that **prefill**
— the expensive part of a request — can be skipped for a span the provider has
already processed. Because attention is causal, the tensor for the token at
position *i* depends on every token before it. Reuse is therefore valid only
across an **identical prefix**, matched on tokens in blocks, and:

> A change at position *k* invalidates positions *k* through the end. There is
> no partial reuse of unchanged content that appears *after* a change.

Unchanged content is worthless if something before it moved. Two refinements
that matter for the metrics below: matching is on **tokens in blocks**
(typically 16–256), so sub-block changes invalidate the whole containing block;
and the cache can match against **any recently held prefix**, not only the
immediately preceding request's.

The prefix is generally assumed to include the serialized **tool/function
definitions**, which most OpenAI-compatible servers place ahead of the
conversation. For Fireworks specifically this is **unverified** — §10 Phase 0
includes a probe, and §3 is gated on its result.

Fireworks confirms the payoff is not latency-only: prompt caching is enabled by
default on serverless, and "cached prompt tokens are discounted compared to
regular prompt tokens. The default discount is 50%, but the exact discount
varies by model." Our seats are discounted 80% (minimax-m3, qwen3p7-plus,
kimi-k2p7-code) or 90% (glm-5p2, gpt-oss-120b). Documented TTL is "at least
several minutes… up to several hours," oldest-first eviction.

### Where we actually stand

Realized hit rate over the 120 newest trace files (1,895 executor calls, 34M
prompt tokens, 2026-07-10 → 07-20):

| Seat | Calls | Realized hit | Avg prompt |
| --- | --- | --- | --- |
| executor / kimi-k2p7-code | 1,592 | 40.6% | 18,244 |
| executor / minimax-m3 | 303 | 19.9% | 16,304 |
| **Aggregate** | **1,895** | **37.6%** | — |

An isolated smoke test reaches **98.93%** with a static 42K-char prefix
(`.artifacts/fireworks-cache-smoke.json`, 2026-05-16). That test establishes
only that the provider *can* cache — it sends an identical prefix twice, back to
back, with no competing load. It is **not** evidence about TTL under real
inter-turn intervals, eviction under concurrent runs, routing, or block
alignment with real prompts, and this RFC does not use it as such.

One prior result is confirmed: **zero calls landed near the old 12,288-token
cap**, so LP-17 P3's reordering removed that specific positional stall. Absolute
cached volume per seat (all telemetry-bearing entries, 400 trace files):

| Seat | Entries | Cached tok p50 | p90 | Date range |
| --- | --- | --- | --- | --- |
| kimi-k2p7-code | 2,302 | 7,207 | 9,426 | 2026-07-09 → 07-11 |
| gemma-4-31b | 326 | 3,200 | 6,528 | 2026-07-09 → 07-21 |
| minimax-m3 | 303 | 2,489 | 6,370 | 2026-07-20 → 07-20 |

*(Revision 2 quoted "kimi's p90 is ~6.5K"; that was gemma's number
misattributed. Corrected here.)*

**These seats are not comparable, and the reason is not run length.** They come
from different date windows spanning executor-prompt version changes — kimi's
data is 07-09→07-11, minimax's is entirely 07-20, and prompt v7 landed 07-20.
The apparent "seat gap" (kimi 40.6% vs minimax 19.9%) is therefore confounded
with prompt version and with whatever else changed across eleven days. Revision 1
blamed run length; revision 2 withdrew that; revision 3 concludes the comparison
**cannot be made at all with this data**, and §11 open question 1 is rewritten
accordingly.

### Measuring the gap: what is ours versus the provider's

Two prefix-overlap metrics, computed offline from trace-stored request messages
(120 trace files, 120 runs, 368 turn-pairs):

| Metric | Value |
| --- | --- |
| Overlap vs **previous** turn | 28.6% |
| Overlap vs **best prior** turn in the run | **30.6%** |
| Realized provider hit (same subset) | ~22.3% |

**These are prefix-overlap observations, not a ceiling.** Revision 1 called the
consecutive-turn number a "ceiling" and divided the realized rate by it to get a
"76% realization ratio". That was wrong in three ways, and the framing is
withdrawn:

1. **It is not an upper bound.** The provider may match any recently held
   prefix, so consecutive-turn overlap *understates* opportunity. Measured
   directly: best-prior overlap is 30.6% versus 28.6% consecutive — real, but a
   **2-point** effect, not a large one.
2. **It is not a lower bound either.** Block quantization and eviction let the
   provider do worse than the raw overlap suggests.
3. **It is dimensionally inconsistent with the realized rate.** Overlap is
   measured in **characters**; the realized rate is `cachedPromptTokens /
   promptTokens`, in **tokens**. The stable region is token-dense prose
   (~4 chars/token) while the volatile region is token-sparse JSON and ID lists
   (~2.5), so char-overlap likely **overstates** token-overlap — a bias pointing
   toward this RFC's own thesis, which is where scepticism belongs. Correcting
   this needs real tokenization and is a Phase 0 deliverable (§10); until then
   no ratio of these two numbers should be quoted as a finding.

Because of (3) the two numbers are reported side by side and **not divided**.

**Population caveat, stated plainly.** The overlap numbers above come from a
120-file window that happened to contain only gemma-4-31b (214 pairs) and
minimax-m3 (154 pairs), while the 37.6% aggregate is kimi-heavy. Revision 2
attributed this to kimi traces not storing request messages; that was wrong —
**all three seats store messages in 100% of entries**, and the absence of kimi
was purely an artifact of selecting the newest files by mtime. Widening to 400
files yields 2,531 analysable turn-pairs including kimi, and the
divergence-position results below are computed on that full set. The realized
figure quoted above (~22.3%) is still the one computed *on the same turns* as
the 368-pair overlap numbers, which remain gemma/minimax-only; treat the overlap
percentages as provisional until recomputed across the wider set.

| Seat (overlap subset) | Pairs | Prev overlap | Best-prior overlap | Realized | Cached tok p50 / p90 |
| --- | --- | --- | --- | --- | --- |
| gemma-4-31b | 214 | 28.2% | 30.8% | 21.9% | 3,840 / 6,528 |
| minimax-m3 | 154 | 28.9% | 30.3% | 22.8% | 4,036 / 6,410 |

**A revision-1 claim that the data does not support:** I attributed the
kimi/minimax gap to run length, on the reasoning that short runs cache worse.
Binned by run length, that is not what happens — overlap is *slightly lower* for
long runs and realized rate is flat:

| Run length | Pairs | Prev overlap | Best-prior overlap | Realized |
| --- | --- | --- | --- | --- |
| 2–3 turns | 35 | 30.3% | 30.3% | 20.2% |
| 4–8 turns | 161 | 30.6% | 33.0% | 23.0% |
| 9+ turns | 172 | 26.9% | 29.0% | 22.1% |

So the run-length explanation is withdrawn too. The seat gap remains
**unexplained**, and §11 open question 1 now covers it without a preferred
hypothesis.

### The three invalidators (and one tail optimization)

Revision 1 listed "four invalidators". One of them does not invalidate the
prefix, so the count is corrected to three.

**1. `context.ts:960-966` — a prefix-breaking bug.** The per-turn element-ID
list is injected via `content.replace("## Page Interpretation", …)`.
String-pattern `replace` hits the *first* occurrence, which is `system.md:78` —
a static rules section **above** `{{persona}}` (line 120) and above
`{{cacheBreakpoint}}` (line 124). Per-turn data therefore lands inside the
region we treat as immutable.

Revision 1 called this a hypothesis. Revision 2 offered a 50.8%
"divergence before the `## Page Context` anchor" statistic — but that anchor sits
at the start of region C, so "before it" includes all of region A **and** all of
region B, and a legitimate plan update produces the same signature. That metric
was an upper bound on this bug, not a measure of it, and using it as the Phase 1
gate would let the fix "pass" while the cache did not improve.

Measured against the injection site itself (2,531 turn-pairs): the first
divergence falls within ±400 chars of the element-ID injection point in
**25.9%** of system-message breaks. So invalidator 1 plausibly accounts for
about a quarter of prefix breaks, not half. The median break sits at **51.9%**
of the way through the system message (p10 17.9%, p90 73.4%), so a substantial
share of divergence is elsewhere and still unattributed.

Phase 1's gate is therefore **"divergence at the `system.md:78` injection site
falls to zero"**, not "the aggregate divergence rate drops".

**2. Tool-set churn.** `applyToolProfile` falls through to
`buildDomAwareProfile(snapshot.elements)` (`loop-skill-tools.ts:284-306`), so the
tool set is derived from the current page's DOM; `applySkillToolRanking`
(`:87-119`) reorders it. `toolCount` changed on 10.6% of turn-pairs, a lower
bound since reordering leaves the count unchanged. **This matters only if
Fireworks hashes tool definitions into the cache key, which is unverified** —
hence the Phase 0 probe gating §3.

**3. In-place history rewriting.** `compressOldToolResults(2)` mutates
historical message content on every tool message (`context.ts:458-460`,
`:1356-1383`); threshold compaction (`:1389-1468`) renumbers turn labels and, at
HEAVY, rebuilds history wholesale.

Measured directly, **history is mutated in 368 of 368 turn-pairs (100%)** —
every turn rewrites bytes it has already sent.

**But this cannot currently be costing us any cache.** The cache breaks at the
*first* divergence, and the first divergence is **inside the system message in
2,531 of 2,531 turn-pairs (100%)**. The prefix never survives message 0, so it
never reaches history at all. History mutation is real, universal, and — as long
as the system message keeps changing — **irrelevant to the hit rate**.

Revision 2 used the 100% mutation rate to *raise* Phase 3's priority. That was a
causal error: it measured a defect without checking whether the defect was
reachable. Revision 3 demotes Phase 3 to conditional-and-last, justified on
context-growth grounds rather than cache grounds, and only re-evaluated **after**
the system message is stable enough for the prefix to reach history.

**This same measurement points at a structural fix the earlier revisions
missed** — see §2a.

**Tail optimization (not an invalidator).** `context.ts:1000` puts `Elapsed: Xs`
into `{{turnBudget}}`, after the breakpoint. It does not poison the prefix; it
only prevents tail reuse. Worth fixing, not weighted with the three above.

### Why nothing catches this

`{{cacheBreakpoint}}` (`system.md:124`) is replaced with the empty string
(`context.ts:704`) — it emits no provider directive and creates no boundary.
`cachedPrefixLength` (`loop-turn-preparation.ts:80`) is
`systemContent.indexOf("## Page Context")`, which invalidator 1 makes an
overstatement of the true stable prefix half the time. The block ordering LP-17
established is documented only in a comment (`context.ts:47-50`). No test fails
when volatile content moves upward.

## Proposal

### 1. Make the stable-prefix contract explicit and enforced

| Region | Contents | Rule |
| --- | --- | --- |
| **A — Immutable** | tool definitions, static rules, persona, `{{currentTask}}` | Byte-identical for an entire run. Any change is a defect. |
| **B — Run-stable** | plan instructions, skills, working notes | Changes only on genuine run-level events; each change costs a full re-prefill of B and C. |
| **C — Volatile** | page context, elements, page content, turn status, last action | Free to change every turn. Everything volatile belongs here. |

### 2. P1 — Fix the `## Page Interpretation` collision

Rename the static heading at `system.md:78`, **and** switch the injection to a
dedicated `{{validElementIds}}` placeholder in region C rather than
heading-text matching. Apply the same treatment to the `## Page Content` and
`## Visible Elements` injections (`context.ts:909/921/930/941/953`), correct
today only by accident.

Add a **structural** lint guard: fail if any `content.replace("## …")` targets a
heading occurring more than once in the template. This catches the bug class by
construction rather than by behaviour.

### 2a. P0 — Move region C out of the system message *(new in revision 3)*

The single most consequential fact in this RFC is that the first divergence is
inside message 0 in **100%** of turn-pairs. That is close to structural: page
context, visible elements, page content, turn status, and last-action outcome
are all embedded *in the system message* (`system.md:129-155`), so message 0
necessarily changes every turn, and the prefix necessarily dies there.

Every fix in §2–§4 is an attempt to make a perpetually-changing message change
less. The structural alternative is to stop putting volatile content in it:

- Keep the system message as **region A + B only** — rules, persona, task, plan.
- Emit **region C as a trailing user message** appended each turn.

Then message 0 is byte-stable for the whole run, history becomes reachable by
the cache, and each turn re-prefills only its own tail. This is also what makes
§4 meaningful: append-only history is worthless while message 0 breaks first.

This is a larger change than §2 and touches how the model reads page state, so
it carries the attention-quality risk noted in Risks. It is proposed as a
**Phase 1b spike measured against §2's result**, not as a commitment — but it
is likely the ceiling on how much §2 alone can achieve.

### 3. P2 — Freeze tool definitions per run *(gated on the Phase 0 probe)*

**If and only if** the Phase 0 probe confirms Fireworks includes tool
definitions in the cache key:

- Compute the tool array once per run; serialize in canonical sorted order.
- Keep `applySkillToolRanking`'s signal but express it as region-C guidance
  text, not as reordering of the wire array.

**Revision 2 reverses a revision-1 proposal.** Revision 1 suggested keeping
unavailable tools in the definition and refusing at dispatch. That trades a
one-time prefix break for a per-turn behaviour cost: the model sees a tool,
plans to use it, and gets an error — wasting turns and inviting worse
alternatives. It also contradicted this RFC's own rule that a cache win costing
success rate is not a win. **Corrected position:** if a tool must be
unavailable, remove it and accept the prefix break. Phase 0 measures how often
availability actually changes; if rarely, the whole question is moot.

### 4. P3 — Make history append-only *(conditional; cache benefit is currently zero)*

History is mutated on 100% of turns, but the cache never reaches it (§Problem).
**Until §2a lands, this change cannot improve the hit rate at all.** It is
retained because it is a genuine architectural defect and because it becomes
load-bearing the moment message 0 is stabilised — not because it pays today. If
§2a is rejected, this section should be re-evaluated purely on context-growth
grounds, or dropped. When it does land:

- `compressOldToolResults` must not rewrite existing content. Emit compression
  as a **new trailing message** and drop elided messages only at a compaction
  boundary.
- Treat unavoidable compaction as an explicit **prefix-reset event**: rebuild
  once, emit `prompt_prefix_reset` with a reason, accept the one-time cost.
  Resets should be rare and visible, not continuous and silent.
- Assign turn numbers once at creation; stop renumbering (`:1445-1454`).

### 5. P4 — Tail hygiene

Quantize `Elapsed: Xs` (`context.ts:1000`) to a coarse bucket or drop it in
favour of the turn counter. Audit region C for other free-running values.

### 6. P5 — Affinity stability *(no longer dismissed as second-order)*

- `prepare-model-turn.ts:146` reads the mutable `host.taskId`, reset to `null`
  (`loop.ts:2588`) then reassigned an internal plan id — affinity changes
  identity mid-run. Read the stable `host.taskIdRef` instead.
- `rebuildForProvider` (`client.ts:1072-1088`) drops affinity headers on the
  429/402 failover path.

Revision 1 called these second-order on the strength of the (now-withdrawn) 76%
ratio — circular, since a mid-run affinity change could reroute to a node
without the cache and account for much of the gap directly. Phase 0 correlates
hit rate against affinity changes before this is ranked.

### 7. Measurement

Report, per seat and per run-length bin, never mixed across populations:

- **Prev-turn overlap** and **best-prior overlap** — prompt-construction
  observables, computed offline at zero API cost. Defined precisely: for turn
  *N*, prev-turn overlap is `LCP(prompt_{N-1}, prompt_N) / len(prompt_N)`;
  best-prior overlap is `max over M < N of LCP(prompt_M, prompt_N) / len(prompt_N)`.
- **First-divergence position** — absolute offset, and which message and region
  it falls in. This is the metric that says *where* the cache dies, and it is
  the one that showed history mutation to be unreachable.
- **Realized hit** — token-weighted `cachedPromptTokens / promptTokens`.
- **Absolute cached tokens** (p50/p90) alongside percentages, since percentage
  and volume can move in opposite directions (see the 12,288 discussion).
- **Cost in USD**, using the corrected per-seat cached rates. Percentage points
  are not interpretable as savings; an 80–90% discount means a cached token
  costs 5–10× less, and which *tokens* become cached matters as much as how
  many.

Ship `scripts/cache-report.mjs` computing all of these, replacing the ad-hoc
scripts used for this RFC. Report token-weighted aggregates, never the mean of
per-call percentages.

**Known limitation:** overlap is currently character-based. Phase 0 must
tokenize (real BPE, or a per-region chars-per-token correction) before any
overlap number is compared against a token-based realized rate.

### 8. Test strategy

**8.1 Prefix-stability unit tests.** Build a `ContextManager`, feed two
synthetic snapshots differing only in DOM, call `getPrompt()` twice, assert the
common prefix exceeds a floor. Cases: same page, different page, plan created
between turns, tool result added, tier flip. *Hazard:* `getPrompt()` mutates
`pageContentEmission` (`context.ts:889`) and `page-content-policy.ts:64-66`
guards double-invocation — tests must drive the production path.

**8.2 The prefix ratchet.** `scripts/prefix-ratchet.mjs` in the lint step,
failing if region-A prefix length drops below budget; **budgets may only go UP**.

Two corrections from review: the fixture **must exercise every
`content.replace("## …")` injection path with a DOM change between turns**, or
it passes while the bug persists; and the initial budget must be set from the
**expected** region-A length per §1, not from today's measured length, which
would encode the bug as the baseline. The ratchet is a regression guard — the
structural lint in §2 is what makes it a correctness check.

**8.3 Tool-set stability test.** Assert byte-identical serialized tool arrays
across turns with differing DOM, including order.

**8.4 Append-only history test.** Assert every message present in both turn N
and N+1 is byte-identical. **The exemption must be narrow**: only threshold-level
compaction (the HEAVY rebuild at `:1389-1468`) is exempt, and only when it emits
`prompt_prefix_reset`. Per-turn `compressOldToolResults` is **not** exempt —
since it runs every turn, a loosely-worded "compaction turns are exempt" clause
would let the test pass vacuously on the exact behaviour it exists to catch.

**8.5 Golden prompt-prefix corpus.** Record serialized prompts for a scripted
run, replay byte-identically, regenerate only under an explicit env flag.

**8.6 Offline overlap report in CI** over a committed trace fixture set, with a
floor. Deterministic, no network.

**8.7 Live A/B protocol.** Same task, same seat, same tier. **Arms must be
sequential with a quiescent gap, not alternating** — on a shared pool,
alternating arms evict each other's blocks, depressing both and masking the
effect. Report each arm's first-turn hit rate as a cache-warmth indicator.
**N is computed from the run-to-run variance measured in Phase 0, against a
pre-registered minimum effect size** — revision 1's flat "N ≥ 5" is withdrawn as
underpowered for the effect sizes in play. A sequential design may stop early on
a large effect. Report all metrics from §7 plus task success. **Live runs
require the owner's approval before launch.**

### 9. Telemetry additions

- **`toolSetHash`** in `llmRequest` (only `toolCount` is stored today).
- **`promptPrefixDigest`** per turn, so prefix breaks are observable directly.
- **Affinity header value** per request, to make §6's correlation computable.
- `prompt_prefix_reset` on deliberate compaction.
- Fix or remove `cachedPrefixLength`, which currently misleads.
- Instrument the **planner seat**, which emits no `cacheTelemetry` at all.

### 10. Rollout and gates

| Phase | Content | Gate to proceed |
| --- | --- | --- |
| 0 | §7 report (tokenized, cost-aware), §9 telemetry, §8.2 ratchet at current budget, **tool-definition cache-key probe**, **block-size probe**, **isolated-load experiment**, tool-availability churn count, affinity/hit correlation | Baseline reproduced; probes answered |
| 1 | §2 (P1 bug + structural lint), §5, §6 + tests 8.1/8.3 | Divergence **at the injection site** (today 25.9%) falls to zero; overlap re-measured; A/B incl. task success |
| 1b | §2a spike — region C moved to a trailing user message | Measured against Phase 1: does first divergence leave message 0? Task success neutral or better |
| 2 | §3 tool freeze + test 8.3 | **Only if the Phase 0 probe was positive**; overlap re-measured; A/B |
| 3 | §4 append-only history + tests 8.4/8.5 | **Only after §2a**, since cache benefit is zero until message 0 is stable |

**The isolated-load experiment is the cheapest discriminator in the plan and
must run first.** The whole RFC assumes the gap is prompt construction. On a
shared serverless pool with oldest-first eviction, concurrent traffic — our own
CI, other tenants — can evict KV blocks between turns regardless of what we
send. Running the same task back-to-back with no concurrent load and comparing
the realized rate against the mixed-load aggregate separates internal from
external causes. If isolated runs are dramatically better, none of §2–§4 is the
main lever.

Phase 0 must land first: without it every later claim is unfalsifiable. Phases 1
and 2 are independently revertible. **Phase 2 may be dropped entirely** by a
negative probe. Phase 3 is justified by the 100% mutation measurement but
remains last because it carries the most task-success risk.

No target number is given. How much of the overlap gap is invalidator 1 versus 2
versus 3 is unknown; Phase 1's re-measurement of the 50.8% divergence statistic
is the first real decomposition.

## Non-goals

- **Anthropic-style explicit `cache_control` breakpoints.** Fireworks caching is
  implicit and positional; `annotateCacheControl` (`client.ts:576`) stays
  OpenRouter-only.
- **Semantic / response caching.** Reusing model *outputs* across live-page
  states is a correctness hazard.
- **Dedicated deployments or a self-hosted KV store.**
- **Runtime caches** (`ToolResultCache`, screenshot, warmup) — separate
  concerns, largely well-built. Their hygiene gaps (`getCachedElements()`
  returning `[]`; the vestigial `PerceptionScreenshotState`) deserve their own
  issue.
- **Cost-model accuracy.** Fixed 2026-07-21; not revisited here.

## Risks

- **§4 is the riskiest.** History compression exists to keep prompts inside the
  context budget. Append-only elision must not regress that.
- **Context growth is not just a budget question.** Append-only history grows the
  prompt between compactions, and longer contexts can degrade attention quality
  *within* budget. A prompt at 95% cache-hit and 90% of budget may perform worse
  than one at 40% and 60%. Phase 3's A/B must measure task success across the
  growth curve, not merely assert the hard cap still passes.
- **Tool freezing may cost accuracy.** Measure success, not just tokens.
- **Overlap can be gamed** by stable boilerplate. Always report alongside total
  prompt tokens, cost, and success.
- **Char-based overlap drifts from token reality**; §7 flags this as a Phase 0
  fix, and no ratio is quoted until it lands.
- **Reordering can degrade action selection, and this is a Phase 1 risk, not
  only a Phase 3 one.** Pushing page state later in the prompt (§2a especially)
  moves the most action-relevant information furthest from the generation
  position. Phase 1 and 1b A/Bs must measure task success, not just overlap.
- **External eviction may dominate.** If concurrent load is evicting our blocks,
  every fix here is a rounding error. The Phase 0 isolated-load experiment is
  what rules this in or out.
- **Provider behaviour is policy, not contract.** `cache-report.mjs` makes drift
  visible.

## Open questions

1. **Is there a kimi/minimax gap at all?** The two seats' data come from
   different date windows spanning prompt-version changes (kimi 07-09→07-11;
   minimax 07-20; prompt v7 landed 07-20), so the observed 40.6% vs 19.9% is
   confounded and may be a prompt-version difference rather than a seat
   difference. Revision 1 blamed run length; revision 2 withdrew that; revision 3
   holds that **the comparison cannot be made with existing data**. A matched
   A/B on one prompt version is the only way to answer it. **Do not re-seat on
   cache grounds.**
2. **Does Fireworks hash tool definitions into the cache prefix?** Gates §3
   entirely. Phase 0 probe.
3. **How much of the 50.8% early-divergence rate is invalidator 1 alone?**
   Phase 1 re-measurement answers it.
4. **Is affinity first- or second-order?** Phase 0 correlation.
5. **Should region B exist at all?** Folding plan instructions into region C
   simplifies the contract at the cost of a longer volatile span.
6. **What is Fireworks' block size?** It sets the quantization floor: a 1-token
   change wastes a whole block, so a 256-token block makes sub-block tail
   hygiene (§5) pointless while a 16-token block makes it worthwhile. Phase 0
   probe: vary the prefix at increasing offsets and watch where cached tokens
   step down.
7. **Is external eviction the dominant term?** Phase 0 isolated-load experiment.
8. **Can the cache persist across runs?** TTL is minutes-to-hours and our
   analysis is strictly within-run. If the system message were byte-stable
   across runs of the same task type, turn 1 could hit warm — an opportunity
   none of the current metrics even look for. `promptPrefixDigest` (§9) would
   make it measurable.

## Recommended Decision

*Agent recommendation, not an owner Decision Stamp.*

Adopt phases 0 and 1. Defer phases 2 and 3 to the data phase 0 and 1 produce —
phase 2 explicitly conditional on the tool-definition probe.

Phase 0 is instrumentation and costs little; without it every later claim is
unfalsifiable, which is how the 12,288 stall survived as long as it did. Phase 1
contains a fix to a bug whose signature is now measured in half of all
turn-pairs, plus two small correctness repairs, all covered by offline tests.

The strongest reason to act is that the stable-prefix invariant is enforced by a
comment (`context.ts:47-50`) and this regression class is silent. The ratchet
and the structural lint are the durable deliverables; token savings are the
dividend.

The strongest reason for restraint is that §3 and §4 touch tool selection and
context compression, both of which affect task success, while this RFC's
evidence is about tokens. Hence the gates, and hence the rule that a cache win
costing success rate is not a win.

## Review history

**Revision 3 (2026-07-21)** — after a second glm-5p2 review round on revision 2.
This round found errors revision 2 had *introduced*:

- **Corrected a factual misattribution.** Revision 2 said "kimi's p90 cached
  tokens is ~6.5K"; that was gemma's figure. Kimi is p50 7,207 / p90 9,426. A
  per-seat table now carries the real numbers.
- **Corrected the invalidator-1 statistic.** The revision-2 metric ("divergence
  before the `## Page Context` anchor", 50.8%) spans regions A *and* B, so a
  routine plan update produces the same signature. Measured at the injection
  site itself, the figure is **25.9%** — a quarter of breaks, not half. The
  Phase 1 gate is rewritten to "divergence at `system.md:78` falls to zero,"
  since the old gate could pass without any cache improvement.
- **Reversed revision 2's elevation of Phase 3.** Revision 2 used the 100%
  history-mutation rate to raise its priority. But first divergence is inside
  the system message in **100%** of 2,531 turn-pairs, so the cache never reaches
  history and mutation costs nothing today. Phase 3 is demoted to
  conditional-and-last.
- **Added §2a**, the structural fix the first two revisions missed: move region C
  out of the system message into a trailing user message. If message 0 always
  changes, every other fix is trying to make a perpetually-changing message
  change less.
- **Withdrew the seat-gap framing entirely.** The seats' data come from
  different date windows spanning prompt-version changes, so the comparison is
  confounded and cannot be made with existing data.
- **Corrected the revision-2 claim that kimi traces lack request messages** —
  all seats store them 100% of the time; kimi's absence was an artifact of
  sampling the newest files by mtime.
- **Added the isolated-load experiment** to Phase 0. If concurrent traffic is
  evicting our blocks, no prompt fix matters — and this is the cheapest test in
  the plan.
- Also: narrowed §8.4's exemption so it cannot pass vacuously; made A/B arms
  sequential to avoid cross-arm eviction; defined best-prior overlap formally;
  added a block-size probe; moved attention-quality risk forward to Phase 1.

**Revision 2 (2026-07-21)** — after a glm-5p2 second-opinion design review
(`node .artifacts/rfc-design-review-lp21.mjs`). Material changes:

- **Withdrew the "29.8% ceiling" and the "76% realization ratio."** The
  consecutive-turn overlap is neither an upper nor a lower bound, and dividing a
  char-based number by a token-based one is dimensionally invalid. Both numbers
  are now reported side by side, undivided, with the char/token correction as a
  Phase 0 deliverable.
- **Added best-prior overlap** (30.6% vs 28.6% consecutive) — the review was
  right in principle; the measured magnitude is 2 points.
- **Disclosed the population mismatch.** The overlap subset contains no kimi
  runs; the 37.6% aggregate is kimi-heavy. Revision 1 placed both in one section
  without flagging that they are not comparable.
- **Withdrew the run-length explanation** of the seat gap — binned data
  contradicts it.
- **Recounted "four invalidators" as three plus a tail optimization.**
- **Measured invalidator 3 rather than asserting it.** The review judged the
  evidence thin; direct measurement shows history is mutated in **100%** of
  turn-pairs, which *raises* Phase 3's justification. This is the one review
  finding the data refutes.
- **Converted invalidator 1 from hypothesis to measurement**: first divergence
  falls before the `## Page Context` anchor in 50.8% of turn-pairs.
- **Gated Phase 2 on a tool-definition cache-key probe**, moved to Phase 0.
  Revision 1 committed to the highest-risk change on an unverified assumption.
- **Reversed the dispatch-refusal proposal** in §3, which contradicted this
  RFC's own success-rate rule.
- **Stopped dismissing affinity as second-order** — the reasoning was circular.
- **Hardened the ratchet** with fixture-coverage and budget-derivation
  requirements, plus a structural lint so the bug class is caught by
  construction.
- **Replaced "N ≥ 5"** with power derived from Phase 0 variance against a
  pre-registered effect size.
- **Added a cost model, and the context-growth/quality tradeoff** to Phase 3's
  gate.
- **Demoted the 98.93% smoke test** to evidence of capability only.
