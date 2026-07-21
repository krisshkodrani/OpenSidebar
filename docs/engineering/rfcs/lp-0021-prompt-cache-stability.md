# RFC LP-21 — Prompt-Cache Stability

Lifecycle status: Draft (not stamped) — **revision 4 (final draft)**. Revisions
1–3 were corrected by two rounds of adversarial design review; revision 4 folds
in direct experiments against the Fireworks API that settled three open
questions and eliminated one proposed workstream. See "Revision history".
Date: 2026-07-21
Scope: `background/agent/context.ts` (prompt construction), `prompts/runtime/agent/system.md` (block layout), `background/agent/turn-phases/prepare-model-turn.ts` (affinity), `background/llm/client.ts` (failover headers), new `scripts/cache-report.mjs` + `scripts/prefix-ratchet.mjs`, new tests under `apps/extension/tests/background/`.
Related: [Token & planner analysis](../token-and-planner-analysis-2026-07-18.md) §3; [LP-17 efficiency validation](../lp17-efficiency-validation-2026-07-18.md) §P3; RFC LP-16 (the ratchet pattern reused here)

## Problem

### How prefix caching behaves — measured, not assumed

A prompt cache stores the model's per-token key/value tensors so **prefill** can
be skipped for a span the provider has already processed. Attention is causal,
so a stored tensor is reusable only if every preceding token is identical:

> A change at position *k* invalidates positions *k* through the end. Content
> after a change is worthless even if it did not change.

Revisions 1–3 asserted the rest of the mechanics from general knowledge. They
are now measured directly against Fireworks with `minimax-m3` and a stable
~17.3K-token prompt (`.artifacts/cache-probe.mjs`, protocol in the appendix):

| Experiment | Result | What it establishes |
| --- | --- | --- |
| Identical request, repeated | 0% → **100%** (17,350/17,351) | Caching engages fully; no configuration needed |
| Idle 5s / 15s / 30s / 60s | **100%** at every gap | **No idle eviction at agent cadence** |
| Append one tool definition | 98.8% | Tool defs are in the key… |
| Reorder the same two tools | 98.5% | …but cost only ~1.5% — they serialize near the **end** |
| One char changed at 75% / 50% / 25% / 1% of the prompt | 73.9% / 49.5% / 25.1% / 1.6% | **Cache retained ≈ fraction of prompt before the first change**, near-linear, no coarse block penalty |

The last row is the governing result for this RFC. **Cache is a linear function
of how far into the prompt the first change occurs.** Every percentage point by
which we push the first divergence later is a percentage point of cache
recovered. That converts prompt layout from a qualitative concern into a
directly optimisable quantity.

Fireworks discounts cached input — enabled by default on serverless, "the
default discount is 50%, but the exact discount varies by model." Our seats are
discounted 80% (minimax-m3, qwen3p7-plus, kimi-k2p7-code) or 90% (glm-5p2,
gpt-oss-120b), so a cached token costs 5–10× less than a fresh one. Cerebras
also caches — reported via `usage`, not headers — but publishes no cached rate,
so our cost model bills its cached tokens at full price (conservative, but
wrong).

### Where we stand

| Seat / provider | Calls | Realized hit | Window |
| --- | --- | --- | --- |
| kimi-k2p7-code / fireworks | 1,576 | 40.7% | 2026-07-10 → 07-11 |
| gemma-4-31b / cerebras | 636 | 23.7% | 2026-07-21 |
| minimax-m3 / fireworks | 303 | 19.9% | 2026-07-20 |

**These seats are not comparable.** Their data come from different date windows
spanning executor-prompt version changes (prompt v7 landed 07-20). Revision 1
blamed run length for the spread and revision 2 withdrew that; the honest
position is that no seat comparison can be made from this data. Do not re-seat
on cache grounds.

Also note **190 of 826 gemma turns (23%) reported no usage at all** — the calls
succeeded but Cerebras returned a null usage object, so those tokens are
invisible to both cost and cache accounting. The 23.7% describes only the
reporting 77%.

### The cause: the prefix dies in message 0

Across **2,531 of 2,531 turn-pairs (100%)**, the first divergence between
consecutive prompts falls **inside the system message**. The median break sits
**51.9%** of the way through it (p10 17.9%, p90 73.4%).

The reason is structural: page context, visible elements, page content, turn
status, and last-action outcome are all embedded *in the system message*
(`system.md:129-155`). Message 0 therefore changes every turn by construction,
and the linear result above says we lose everything after that point.

Combined, these two measurements explain the production numbers without needing
any other cause: if the first change lands about halfway through a system
message that dominates the prompt, a 20–40% hit rate is the expected outcome.

One contributing bug sits inside that region. `context.ts:960-966` injects the
per-turn element-ID list with `content.replace("## Page Interpretation", …)`,
and string-pattern `replace` hits the *first* occurrence — `system.md:78`, a
static rules section **above** `{{persona}}` and above `{{cacheBreakpoint}}`.
Measured at the injection site, this accounts for **25.9%** of system-message
breaks: real, worth fixing, but not the main story.

### What is *not* the problem

Three candidates are ruled out by measurement. Recording them matters as much as
the positive findings, because two of them were proposed workstreams in earlier
revisions of this document:

- **Provider eviction between turns.** The cache held at 100% across a 60-second
  idle gap. Revisions 2–3 treated this as the gate on everything else.
- **Tool-set churn.** Tool definitions serialize near the end of the prefix, so
  even reordering them costs ~1.5%. Revision 1 claimed this "can zero the cache
  independently of message layout." It cannot. **The tool-freezing workstream is
  dropped.**
- **History rewriting.** History is mutated in 368 of 368 turn-pairs (100%) —
  but since the prefix never survives message 0, the cache never reaches
  history, so this costs nothing today. It becomes relevant only after the
  system message is stabilised.

### Why nothing catches this

`{{cacheBreakpoint}}` (`system.md:124`) is replaced with the empty string
(`context.ts:704`) — it emits no provider directive and creates no boundary.
`cachedPrefixLength` (`loop-turn-preparation.ts:80`) measures to `## Page
Context`, overstating the true stable prefix. The block ordering LP-17
established lives only in a comment (`context.ts:47-50`). **No test fails when
volatile content moves earlier in the prompt.**

## Proposal

### 1. The stable-prefix contract

| Region | Contents | Rule |
| --- | --- | --- |
| **A — Immutable** | static rules, persona, `{{currentTask}}` | Byte-identical for an entire run |
| **B — Run-stable** | plan instructions, skills, working notes | Changes only on real run-level events |
| **C — Volatile** | page context, elements, page content, turn status, last action | Changes freely — **and must not live in the system message** |

### 2. P1 — Move region C out of the system message *(primary fix)*

Emit the system message as **regions A + B only**, and append **region C as a
trailing user message** each turn.

Message 0 then becomes byte-stable for the whole run. The first divergence moves
from the middle of the system message to the start of the appended tail, and by
the linear result that converts directly into cache. It also makes P5 meaningful
— append-only history is worthless while message 0 breaks first.

This is the change that addresses the measured cause. Everything else in this
RFC is secondary to it.

### 3. P2 — Fix the `## Page Interpretation` collision

Rename the static heading at `system.md:78` **and** switch the injection to a
dedicated `{{validElementIds}}` placeholder in region C. Apply the same to the
`## Page Content` and `## Visible Elements` injections
(`context.ts:909/921/930/941/953`), which are correct today only by accident.

Add a **structural lint**: fail if any `content.replace("## …")` targets a
heading occurring more than once in the template. This catches the bug class by
construction. Worth shipping on correctness grounds regardless of cache impact.

### 4. P3 — Tail hygiene

Quantize `Elapsed: Xs` (`context.ts:1000`) to a coarse bucket or drop it in
favour of the turn counter. Small, independent, and now known to be worth
roughly its own size in cache rather than nothing.

### 5. P4 — Affinity stability

`prepare-model-turn.ts:146` reads the mutable `host.taskId`, which is reset to
`null` (`loop.ts:2588`) and reassigned an internal plan id mid-run — affinity
changes identity mid-task. Read the stable `host.taskIdRef`. Separately,
`rebuildForProvider` (`client.ts:1072-1088`) drops affinity headers on the
429/402 failover path.

### 6. P5 — Append-only history *(conditional on P1)*

History is rewritten on 100% of turns, which is a genuine architectural defect,
but it **cannot improve the hit rate until P1 lands**. When it does:

- `compressOldToolResults` must not rewrite existing content; emit compression
  as a new trailing message and drop elided messages only at a compaction
  boundary.
- Treat unavoidable compaction as an explicit **prefix-reset event**: rebuild
  once, emit `prompt_prefix_reset`, accept the one-time cost.
- Assign turn numbers once at creation; stop renumbering (`:1445-1454`).

### 7. Measurement

`scripts/cache-report.mjs` reports, per seat and per run-length bin, never mixed
across populations:

- **First-divergence position** — absolute offset and which message/region it
  falls in. Given the linear result, this is the most predictive single metric
  we have, and it is computable offline at zero API cost.
- **Realized hit** — token-weighted `cachedPromptTokens / promptTokens`.
- **Absolute cached tokens** (p50/p90) alongside percentages.
- **Cost in USD** using per-seat cached rates. Percentage points are not
  interpretable as savings.

Overlap metrics are character-based today; tokenize before comparing them
against token-based realized rates.

### 8. Tests

**8.1 Prefix-stability units.** Build a `ContextManager`, feed two snapshots
differing only in DOM, assert the common prefix of the serialized requests
exceeds a floor. Cases: same page, different page, plan created, tool result
added, tier flip. *Hazard:* `getPrompt()` mutates `pageContentEmission`
(`context.ts:889`); drive the production path.

**8.2 The prefix ratchet.** `scripts/prefix-ratchet.mjs` in the lint step;
**budgets may only go UP**. The fixture must exercise every
`content.replace("## …")` path with a DOM change between turns, and the initial
budget must be derived from the *expected* region-A length per §1 — seeding it
from today's measurement would encode the bug as the baseline. The ratchet is a
regression guard; §3's structural lint is what makes it a correctness check.

**8.3 System-message stability test.** After P1, assert message 0 is
byte-identical across turns within a run. This is the direct test of the primary
fix and the strongest single assertion in this plan.

**8.4 Append-only history test.** Assert every message present in both turn N
and N+1 is byte-identical. **The exemption must be narrow** — only
threshold-level compaction (the HEAVY rebuild at `:1389-1468`), and only when it
emits `prompt_prefix_reset`. Per-turn `compressOldToolResults` is not exempt;
since it runs every turn, a loose exemption would let the test pass vacuously on
the exact behaviour it exists to catch.

**8.5 Golden prompt-prefix corpus.** Record serialized prompts for a scripted
run, replay byte-identically, regenerate only under an explicit env flag.

**8.6 Offline report in CI** over committed trace fixtures, with a floor.

**8.7 Live A/B.** Same task, same seat, **sequential arms with a quiescent gap**
— alternating arms on a shared pool evict each other. N derived from the
variance measured in Phase 0 against a pre-registered effect size. Report every
metric in §7 **plus task success**. **Live runs require the owner's approval.**

### 9. Telemetry

- **`promptPrefixDigest`** per turn, so prefix breaks are directly observable.
- **First-divergence offset** recorded per turn.
- Affinity header value per request.
- `prompt_prefix_reset` on deliberate compaction.
- Fix or remove `cachedPrefixLength`, which currently misleads.
- Instrument the **planner seat** (no `cacheTelemetry` at all today) and
  investigate Cerebras's **23% null-usage rate**.

### 10. Rollout

| Phase | Content | Gate to proceed |
| --- | --- | --- |
| 0 | §7 report, §9 telemetry, §8.2 ratchet at current budget | Baseline reproduced |
| 1 | §3 (P1 collision + structural lint), §4, §5 + tests 8.1/8.2 | Divergence at the injection site falls to zero |
| 2 | **§2 (move region C out of message 0)** + test 8.3 | Message 0 byte-stable across a run; realized hit re-measured; A/B incl. task success |
| 3 | §6 append-only history + tests 8.4/8.5 | Only after phase 2; A/B including context-growth effects |

Phase 1 is cheap and independently justified. **Phase 2 is where the value is**,
and it is sequenced second only because phase 1's fixes are trivially reversible
and make phase 2's measurement cleaner.

No target hit rate is committed. The linear result implies the ceiling is set by
where the first change lands, so the honest prediction is directional: message 0
becoming stable should move the first divergence past the entire system message.
Phase 2's measurement is what turns that into a number.

## Non-goals

- **Explicit `cache_control` breakpoints.** Fireworks caching is implicit and
  positional; `annotateCacheControl` (`client.ts:576`) stays OpenRouter-only.
- **Semantic / response caching.** Reusing outputs across live-page states is a
  correctness hazard.
- **Tool-definition freezing.** Refuted by measurement; see Problem.
- **Provider-side work** — dedicated deployments, self-hosted KV, routing
  changes. Idle eviction is ruled out.
- **Runtime caches** (`ToolResultCache`, screenshot, warmup). Their hygiene gaps
  (`getCachedElements()` returning `[]`; the vestigial
  `PerceptionScreenshotState`) deserve a separate issue.

## Risks

- **P1 moves page state away from the generation position.** Causal attention
  means the model attends backward; putting the page description at the end of
  the prompt is arguably *better* for recency, but it is a real behavioural
  change and could alter action selection either way. **Phase 2's A/B must
  measure task success, not just cache.** A cache win that costs success rate is
  not a win.
- **P5 interacts with the context budget.** Append-only history grows the prompt
  between compactions, and longer contexts can degrade quality even within
  budget. Phase 3 must measure across the growth curve, not just assert the hard
  cap passes.
- **Sporadic total misses may cap the achievable rate.** See open question 1.
- **Overlap metrics can be gamed** by stable boilerplate. Always report
  alongside total prompt tokens, cost, and success.
- **Provider behaviour is policy, not contract.** `cache-report.mjs` makes drift
  visible; pricing rows carry `effectiveDate` and `sourceUrl`.

## Open questions

1. **Why do some requests return 0% despite a long shared prefix?** Two of eight
   novel-prefix probe requests cached nothing, then hit normally on retry — 
   matching the "~8 turns had cache=0" note in the July 18 analysis. If a fifth
   of turns randomly get nothing, that caps the achievable rate regardless of
   layout. The probe sample is far too small; this needs a dedicated run and is
   the most important remaining unknown.
2. **Is there a real seat difference?** Unanswerable from existing data — the
   seats' traces span different weeks and prompt versions.
3. **Why do 23% of Cerebras turns report no usage?** Those tokens are invisible
   to cost and cache accounting.
4. **Should region B exist at all?** Folding plan instructions into region C
   simplifies the contract at the cost of a longer volatile span.
5. **Can the cache persist across runs?** TTL is minutes-to-hours and our
   analysis is strictly within-run. A byte-stable system message across runs of
   the same task type could make turn 1 hit warm.

## Recommended Decision

*Agent recommendation, not an owner Decision Stamp.*

Adopt phases 0, 1, and 2. Defer phase 3.

Phase 1 fixes a genuine bug and installs the enforcement that was missing.
Phase 2 is the substance: the cause is measured, the mechanism is measured, and
the relationship between them is linear, so the expected direction is not in
doubt even though the magnitude is. Phase 3 is real but currently inert.

The strongest reason to act is that the stable-prefix invariant is enforced by a
comment and this regression class is silent — a ratchet and a structural lint
fix that permanently. The strongest reason for restraint is that phase 2 changes
where the model reads page state, which is a task-success risk that token
metrics will not detect; that is what phase 2's gate is for.

## Appendix — probe protocol

`node .artifacts/cache-probe.mjs [model]`, with `.artifacts/cache-probe-tail.mjs`
for the late-position follow-up. Both are git-ignored and load
`FIREWORKS_API_KEY` from `.env`. Method: a deterministic ~17.3K-token system
prompt, `max_tokens: 8`, `temperature: 0`, a fixed `x-session-affinity` header,
and cached counts read from the `fireworks-prompt-tokens` /
`fireworks-cached-prompt-tokens` response headers. Total cost of the full run is
a few cents. Re-run these before trusting any claim in the Problem section that
begins "measured".

## Revision history

- **Revision 4 (final draft)** — direct API probes settled three open questions.
  Idle eviction ruled out (100% at 60s). Tool-definition churn ruled out (~1.5%;
  they serialize at the end, not the front) and the tool-freezing workstream
  **dropped**. Cache proven linear in first-change position, which promotes
  moving region C out of message 0 to the primary fix. Added the sporadic-0%
  finding as the top open question.
- **Revision 3** — after review round 2. Corrected a misattribution (gemma's
  cached-token figures had been quoted as kimi's); corrected the invalidator-1
  statistic from 50.8% to 25.9% after finding the earlier metric spanned regions
  A *and* B; reversed revision 2's elevation of history rewriting after
  measuring that the cache never reaches history; withdrew the seat comparison
  as confounded by date window and prompt version.
- **Revision 2** — after review round 1. Withdrew the "29.8% ceiling" and the
  "76% realization ratio" (neither an upper nor lower bound, and computed by
  dividing a character-based figure by a token-based one); withdrew the
  run-length explanation of the seat gap; demoted the 98.93% smoke test to
  evidence of capability only.
- **Revision 1** — initial draft. Its central metric and two of its four claimed
  invalidators did not survive review.
