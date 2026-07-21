# RFC LP-21 — Prompt-Cache Stability, Correctness, and Measurement

Lifecycle status: Draft (not stamped)
Date: 2026-07-21
Scope: `background/agent/context.ts` (prompt construction, history compression), `background/agent/loop-skill-tools.ts` (tool-set selection), `background/agent/turn-phases/prepare-model-turn.ts` (affinity, request assembly), `background/llm/client.ts` (failover header preservation), `prompts/runtime/agent/system.md` (section naming), new `scripts/cache-report.mjs` + `scripts/prefix-ratchet.mjs`, new tests under `apps/extension/tests/background/`.
Related: [Token & planner analysis](../token-and-planner-analysis-2026-07-18.md) §3 (the 12,288 stall, now resolved); [LP-17 efficiency validation](../lp17-efficiency-validation-2026-07-18.md) §P3 (cache-aware block order); RFC LP-16 (the ratchet pattern this RFC reuses)

## Problem

### How the cache works, and why our layout defeats it

A prompt cache stores the model's per-token key/value tensors so that **prefill**
— the expensive part of a request — can be skipped for a span the provider has
already processed. Because attention is causal, the tensor for the token at
position *i* depends on every token before it. Reuse is therefore valid only
across an **identical prefix**, matched on tokens in blocks, and:

> A change at position *k* invalidates positions *k* through the end. There is
> no partial reuse of unchanged content that appears *after* a change.

This is the property that governs everything below. Unchanged content is
worthless if something before it moved. The prefix also includes the serialized
**tool/function definitions**, which most OpenAI-compatible servers place ahead
of the conversation.

Fireworks confirms the payoff is not latency-only: prompt caching is enabled by
default on serverless, and "cached prompt tokens are discounted compared to
regular prompt tokens. The default discount is 50%, but the exact discount
varies by model." Our seats are discounted 80% (minimax-m3, qwen3p7-plus,
kimi-k2p7-code) or 90% (glm-5p2, gpt-oss-120b). Documented TTL is "at least
several minutes… up to several hours," oldest-first eviction.

### Where we actually stand

Measured 2026-07-21 over the 120 newest trace files (1,895 executor calls,
34M prompt tokens, 2026-07-10 → 07-20):

| Seat | Calls | Realized hit | Avg prompt |
| --- | --- | --- | --- |
| executor / kimi-k2p7-code | 1,592 | 40.6% | 18,244 |
| executor / minimax-m3 | 303 | 19.9% | 16,304 |
| **Aggregate** | **1,895** | **37.6%** | — |

The same mechanism reaches **98.93%** in an isolated smoke test with a static
42K-char prefix (`.artifacts/fireworks-cache-smoke.json`, 2026-05-16). The gap
is ours, not the provider's.

One prior win is confirmed: **zero calls landed near the old 12,288-token cap**,
so LP-17 P3's block reordering genuinely fixed the positional stall diagnosed in
the July 18 analysis. The ceiling moved; it did not disappear.

### Decomposing the loss

A char-level longest-common-prefix analysis over consecutive executor turns
(60 trace files, 37 runs, 208 turn-pairs) separates *our* loss from the
*provider's*:

| Measure | Value | Meaning |
| --- | --- | --- |
| System-message common prefix | 58.5% | 41.5% of the system message changes per turn |
| **Full-request common prefix (ceiling)** | **29.8%** | The best any provider could do with what we send |
| **Realized provider hit (same turns)** | **22.7%** | What we actually got |
| Realization ratio | **76%** | Realized ÷ ceiling |

This is the central finding of this RFC. **We capture 76% of what our prompts
make available — the provider side is broadly working. The ceiling itself is
the defect.** Effort belongs in prompt construction, not in routing, retries, or
provider tuning.

### The four invalidators

1. **`context.ts:960-966` — an outright bug.** The per-turn element-ID list is
   injected via `content.replace("## Page Interpretation", …)`. String-pattern
   `replace` hits the *first* occurrence, which is `system.md:78` — a static
   rules section sitting **above** `{{persona}}` (line 120) and above
   `{{cacheBreakpoint}}` (line 124). Per-turn, per-page data therefore lands
   inside the region we believe is immutable, and every DOM change invalidates
   from there down. The sibling replacements for `## Page Content` and
   `## Visible Elements` are safe only by luck — their first template occurrence
   happens to fall after the breakpoint.
2. **Tool-set churn.** `applyToolProfile` falls through to
   `buildDomAwareProfile(snapshot.elements)` (`loop-skill-tools.ts:284-306`), so
   **the tool set is derived from the current page's DOM**; `applySkillToolRanking`
   (`:87-119`) then *reorders* it. Tool definitions serialize ahead of messages,
   so this can zero the cache independently of message layout. `toolCount`
   changed across **10.6%** of turn-pairs — and count is a weak proxy, since
   reordering leaves it unchanged, so true instability is strictly higher.
3. **In-place history rewriting.** `compressOldToolResults(2)` mutates historical
   message content on every tool message (`context.ts:458-460`, `:1356-1383`), and
   threshold compaction at history lengths 30/60/100 (`:1389-1468`) renumbers turn
   labels and, at HEAVY, rebuilds `this.history` wholesale. A tool result sent
   verbatim on turn N is sent truncated on turn N+2, breaking the prefix at
   turn N.
4. **Volatile tail.** `context.ts:1000` puts `Elapsed: Xs` into `{{turnBudget}}`.
   It sits after the breakpoint so it does not poison the prefix, but it
   guarantees the tail is never reusable.

### Why nothing catches this

`{{cacheBreakpoint}}` (`system.md:124`) is replaced with the empty string
(`context.ts:704`). It emits no provider directive and creates no boundary — it
is a comment. `cachedPrefixLength` (`loop-turn-preparation.ts:80`) is
`systemContent.indexOf("## Page Context")`, a *measurement* that, because of
invalidator 1, systematically **overstates** the true stable prefix. The block
ordering that LP-17 established is documented only in a comment
(`context.ts:47-50`). No test fails when volatile content moves upward. This
class of regression is currently invisible until it surfaces weeks later in a
cost report.

## Proposal

### 1. Make the stable-prefix contract explicit and enforced

Define three named regions of the executor request, in wire order, and state the
rule for each:

| Region | Contents | Rule |
| --- | --- | --- |
| **A — Immutable** | tool definitions, static rules, persona, `{{currentTask}}` | Byte-identical for an entire run. Any change is a defect. |
| **B — Run-stable** | plan instructions, skills, working notes | Changes only on genuine run-level events (plan created, skill loaded). Each change costs a full re-prefill of B and C; changes must be justified. |
| **C — Volatile** | page context, elements, page content, turn status, last action | Free to change every turn. Everything volatile belongs here and nowhere else. |

The contract is that **A never moves and B changes rarely**. Sections 2–6 bring
the code into line with it; sections 7–8 make violations fail CI.

### 2. P1 — Fix the `## Page Interpretation` collision

Rename the static rules heading at `system.md:78` (e.g. to
`## Reading The Page Interpretation`) so the anchor at `context.ts:960` is
unambiguous, **and** switch the injection to a dedicated placeholder
(`{{validElementIds}}`) placed in region C rather than relying on heading-text
matching. Apply the same treatment to the `## Page Content` and
`## Visible Elements` injections (`context.ts:909/921/930/941/953`), which are
correct today only by accident.

Add a lint-level guard: no `content.replace("## …")` against a heading that
occurs more than once in the template. This is the smallest diff with the
largest expected effect, and it is the one change I would ship alone if only one
were permitted.

### 3. P2 — Freeze tool definitions per run

Compute the tool array **once per run** and reuse it verbatim for every turn:

- Remove the DOM-derived fallback (`buildDomAwareProfile`) from the per-turn
  path. If DOM-sensitivity is genuinely needed, express it as *guidance text in
  region C* ("these tools are most relevant here"), never as a change to the
  serialized tool array.
- Keep `applySkillToolRanking`'s ranking signal but stop reordering the wire
  array — emit ranking as region-C text and serialize tools in a canonical
  (sorted) order.
- Where a tool must be genuinely unavailable, prefer refusing the call in
  dispatch over removing its definition, so the prefix is unaffected.

This is the invalidator that no message-layout work can compensate for, which is
why it ranks above the larger history change.

### 4. P3 — Make history append-only

Replace in-place mutation with append-only elision:

- `compressOldToolResults` must not rewrite existing message content. Instead,
  emit compression as a **new trailing message** ("earlier tool outputs N–M
  elided") and drop the elided messages only at a compaction boundary.
- When compaction is unavoidable, treat it as an explicit, logged **prefix-reset
  event**: rebuild once, emit a `prompt_prefix_reset` trace event with the
  reason, and accept the one-time cost. Resets should be rare and visible, not
  continuous and silent.
- Stop renumbering turn labels on each pass (`context.ts:1445-1454`); assign a
  turn number once at creation and keep it.

This is the largest change and the one that moves us toward the append-only
architecture the field converged on. It is sequenced last deliberately (§10).

### 5. P4 — Volatile-tail hygiene

Quantize `Elapsed: Xs` (`context.ts:1000`) to a coarse bucket (e.g. 30s) or drop
it in favour of the turn counter, which already conveys progress. Audit region C
for any other free-running value. This is small and independent.

### 6. P5 — Affinity stability

- `prepare-model-turn.ts:146` reads the mutable `host.taskId`, which is reset to
  `null` (`loop.ts:2588`) and later reassigned a freshly generated internal plan
  id (`start-planner-bootstrap.ts:210`), so affinity **changes identity mid-run**.
  Read the stable `host.taskIdRef` (`loop.ts:485/811`) instead.
- `rebuildForProvider` (`client.ts:1072-1088`) re-derives headers from the slot
  without the request, silently dropping affinity headers on the 429/402 failover
  path. Thread the request through so affinity survives failover.

Given the 76% realization ratio these are second-order, but both are small and
both remove noise from the measurements in §7.

### 7. Measurement: the three-number model

Every claim in this RFC is expressed as three numbers, and all future cache work
must report all three:

- **Ceiling** — full-request common-prefix fraction between consecutive turns.
  Provider-independent, computable offline from existing traces at zero API cost.
  Measures *our* prompt construction.
- **Realized** — token-weighted `cachedPromptTokens / promptTokens` from provider
  telemetry. Measures what we actually got.
- **Realization ratio** — realized ÷ ceiling. Measures provider-side effects
  (eviction, routing, cold start). Currently 76%.

Ship `scripts/cache-report.mjs` computing all three per seat and per run from
`traces/`, replacing the ad-hoc scripts used to produce this RFC's numbers.
Report token-weighted aggregates, never the mean of per-call percentages — the
two differ materially when prompt sizes vary.

**Methodology caveats to carry forward, not bury:**

- The ceiling is computed on **characters**, not tokens, and ignores block
  alignment; it is an approximation, and a slightly optimistic one.
- The per-seat gap (kimi 40.6% vs minimax-m3 19.9%) is **confounded by run
  length**. Every one of the eight worst-ceiling runs is minimax-m3 with 2–11
  turns, and short runs structurally cache worse (cold start plus a large
  turn-1→2 delta from the first-turn grounding block). This RFC does **not**
  claim minimax-m3 is a cache-poor model; §8.7 is how we find out.

### 8. Test strategy

The point of this section is that every fix above must be defended by something
that fails in CI, offline, without an API key.

**8.1 Prefix-stability unit tests.** Construct a `ContextManager`, feed two
synthetic snapshots that differ only in DOM content, call `getPrompt()` twice,
and assert the common prefix of the serialized requests exceeds a floor. Cases:
same page, different page, plan created between turns, tool result added, escalation
tier flip. *Hazard:* `getPrompt()` mutates `pageContentEmission`
(`context.ts:889`) and `page-content-policy.ts:64-66` guards double-invocation
within a turn — tests must drive it through the same path production uses.

**8.2 The prefix ratchet.** `scripts/prefix-ratchet.mjs`, run in the lint step
alongside `loop-ratchet.mjs`, computing the region-A prefix length for a fixed
fixture pair and failing if it drops below the budget in
`scripts/prompt-prefix-budget.json`. **Budgets may only go UP** — the mirror of
the decomposition ratchet, which the repo already understands. This is the single
control that would have caught the P1 bug the day it landed.

**8.3 Tool-set stability test.** Serialize the tool array across turns with
differing DOM snapshots and assert **byte-identical** output, including order.
Guards §3 permanently.

**8.4 Append-only history test.** Assert that for turns N and N+1, every message
present in both is byte-identical — i.e. history is only appended to. Compaction
turns are exempt but must emit `prompt_prefix_reset`; the test asserts the event
is present whenever the invariant is broken, so silent rewrites fail.

**8.5 Golden prompt-prefix corpus.** Following the completion-corpus precedent:
record serialized prompts for a fixed scripted run, replay byte-identically, and
regenerate only under an explicit env flag when a semantic change is intended.
Catches drift no targeted assertion anticipates.

**8.6 Offline ceiling report in CI.** Run `cache-report.mjs` over a small
committed trace fixture set and assert the ceiling exceeds a floor. Cheap,
deterministic, no network.

**8.7 Live A/B protocol.** Offline tests prove stability, not benefit. For each
phase: same task, same seat, same provider tier, **N ≥ 5 runs per arm**,
alternating arms to spread provider load, reporting all three numbers plus USD.
Control for run length by binning on turn count — this is also how the
kimi/minimax question in §7 gets settled. Uses the recorded-prompt replay path
where possible so browser nondeterminism does not contaminate the comparison.
**Live runs require the owner's approval before launch.**

### 9. Telemetry additions

- Record a **`toolSetHash`** in `llmRequest` (currently only `toolCount` is
  stored, which is why §7's tool-churn figure is a lower bound).
- Record a **`promptPrefixDigest`** — a hash of the first N chars of the
  serialized request — per turn, so a prefix break is directly observable in
  production rather than inferred.
- Emit `prompt_prefix_reset` on deliberate compaction (§4).
- Fix `cachedPrefixLength` to measure the *true* stable prefix once §2 lands, or
  remove it; today it misleads.
- Instrument the **planner seat**, which emits no `cacheTelemetry` at all in the
  current window.

### 10. Rollout and gates

Sequenced so that cheap, reversible changes are measured before expensive ones
are attempted:

| Phase | Content | Gate to proceed |
| --- | --- | --- |
| 0 | §7 `cache-report.mjs`, §9 telemetry, §8.2 ratchet at *current* budget | Baseline reproduced; ratchet green |
| 1 | §2 (P1 bug), §5 (P4), §6 (P5) + tests 8.1/8.3 | Ceiling measured; A/B per 8.7 |
| 2 | §3 (tool freeze) + test 8.3 | Ceiling measured; A/B |
| 3 | §4 (append-only history) + tests 8.4/8.5 | Ceiling measured; A/B |

Phase 0 must land first: without it, every later phase is unfalsifiable. Phases
1 and 2 are independently valuable and independently revertible. **Phase 3 is
explicitly conditional** — if phases 1–2 lift the ceiling to a level where the
remaining headroom does not justify restructuring history, we stop and say so.

Expected outcome is a ceiling materially above today's 29.8%; I am deliberately
not putting a target number on it, because the honest answer is that we do not
know how much of the 29.8% is attributable to the P1 bug versus the other three
invalidators. Phase 1's measurement is what converts that guess into a number.

## Non-goals

- **Anthropic-style explicit `cache_control` breakpoints.** Fireworks caching is
  implicit and positional; `annotateCacheControl` (`client.ts:576`) stays
  OpenRouter-only. Not needed if region A is genuinely stable.
- **Semantic / response caching.** Reusing model *outputs* across similar states
  is a correctness hazard for an agent that acts on live pages. Out of scope.
- **Provider-side tuning, dedicated deployments, or a self-hosted KV store.** The
  76% realization ratio says the provider side is not our problem.
- **Runtime caches** (`ToolResultCache`, screenshot, warmup). Separate concerns,
  correctness- and quota-driven, and largely well-built. Their hygiene gaps
  (`getCachedElements()` returning `[]`; the vestigial `PerceptionScreenshotState`)
  are worth a separate cleanup issue.
- **Cost-model accuracy.** Fixed 2026-07-21 (glm-5p2, minimax-m3, gpt-oss-120b
  rates); not revisited here.

## Risks

- **§4 is the risky one.** History compression exists to keep prompts inside the
  context budget. Append-only elision must not regress that; if it does, we get
  cache hits on prompts that overflow. Mitigation: phase 3 is gated and last, and
  the context-budget tests must pass unchanged.
- **Tool freezing may cost accuracy.** Wider tool sets can degrade model
  selection. Mitigation: express narrowing as region-C guidance and measure task
  success, not just tokens, in the 8.7 A/B. **A cache win that costs success rate
  is not a win** — this RFC's changes must be neutral or positive on the E2E
  suite.
- **The ceiling metric could be gamed.** A stable prefix full of useless boilerplate
  scores well. Mitigation: report ceiling alongside total prompt tokens and task
  success; never optimize ceiling alone.
- **Provider behaviour can change.** Fireworks discounts and TTLs are policy, not
  contract. Mitigation: `cache-report.mjs` makes drift visible; pricing rows carry
  `effectiveDate` and `sourceUrl`.
- **Char-based ceiling drifts from token reality** for content with unusual
  tokenization (long ID lists, base64). Acceptable for relative comparisons;
  revisit if absolute numbers start driving decisions.

## Open questions

1. **Is the minimax-m3 gap real or a run-length artifact?** §7 flags the
   confound; §8.7's binning settles it. Until then we should not re-seat on
   cache grounds.
2. **How much of the 29.8% ceiling does P1 alone explain?** Determines whether
   phases 2–3 are worth their cost. Answered by phase 1.
3. **Does Fireworks hash tool definitions into the cache prefix?** Assumed yes
   (standard for OpenAI-compatible servers) but unverified. A cheap two-request
   probe against the live endpoint would confirm it and decide §3's priority.
4. **Should region B exist at all?** Folding plan instructions into region C
   would simplify the contract at the cost of a longer volatile span.
5. **Is `x-multi-turn-session-id` doing anything measurable** beyond
   `x-session-affinity`? Currently set to a per-loop-run UUID, new for every node
   of a multi-node task.

## Recommended Decision

*Agent recommendation, not an owner Decision Stamp.*

Adopt phases 0 and 1, and defer the decision on phases 2 and 3 to the data phase
1 produces.

Phase 0 is pure instrumentation and costs little; without it every subsequent
claim is unfalsifiable, which is precisely how the 12,288 stall survived as long
as it did. Phase 1 contains a one-line fix to a genuine bug (§2) plus two small
correctness repairs, all covered by offline tests.

The strongest reason to act is not the token savings — it is that the
stable-prefix invariant is currently enforced by a comment
(`context.ts:47-50`), and this class of regression is silent. The ratchet in
§8.2 is the durable deliverable; the token savings are the dividend.

The strongest reason for restraint is that §3 and §4 touch tool selection and
context compression, both of which affect task success, and this RFC's evidence
is about tokens rather than success. Hence the gates, and hence the explicit
statement that a cache win costing success rate is not a win.
