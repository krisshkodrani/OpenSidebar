# Launch-Prep RFC Drafts (P0)

Draft RFCs for the three P0 launch blockers identified in
[SOTA Gap Analysis](../sota-gap-analysis.md) (2026-06-08) and the follow-up
orchestration review (2026-06-10). This directory is the canonical
in-repo home for active RFC drafts.

These drafts are **not stamped**. Each ends with a "Recommended Decision"
section that is an agent recommendation, not an owner Decision Stamp. Per
[RFC Decision Process](../rfc-decision-process.md), no implementation may begin
until the owner records a Decision Stamp. When ratified, copy the recommended
stamp into a `## Decision` section (editing as needed) and validate with
`pnpm rfcs:check -- <path>`.

| # | RFC | P0 issue | Depends on |
| --- | --- | --- | --- |
| LP-1 | [Public benchmark adapter & published numbers](lp-0001-public-benchmark-adapter.md) | Launch has no externally verifiable performance floor | None |
| LP-2 | [Escalation rescue: converge or escalate](lp-0002-escalation-rescue.md) | Stuck runs never recover; ~19% of runs hit max_turns | None (LP-1 harness helps measurement) — **Approved 2026-06-10, in implementation** |
| LP-3 | [Contributor surface for public launch](lp-0003-contributor-surface.md) | Core is contributor-hostile; no on-ramp for collaborators | None |

Suggested sequencing: LP-3 (cheap, unblocks collaborators) in parallel with
LP-2 (biggest live-performance lever), then LP-1 (largest; benefits from LP-2
landing first so published numbers reflect the rescued agent).

## Eval-Methodology RFC Drafts (P1)

Draft RFCs inspired by the **OpenClaw RL Guidelines v5** (2026-06-11,
`.artifacts/`) — a single-model data-generation/eval spec whose core ideas
(grade the final *state* not the trajectory narration; treat LLM judges as
assistive not authoritative; capture a corrected "silver" trajectory as the data
unit; enforce disciplined, citeable failure justifications; cover adversarial
Scenario Types) map directly onto OpenSidebar's harness, bench, and trace-viewer.
Same status rules as above: **not stamped**, each ends with a "Recommended
Decision" (agent recommendation, not an owner Decision Stamp). No implementation
until the owner records a Decision Stamp.

| # | RFC | Item it implements | Depends on |
| --- | --- | --- | --- |
| LP-4 | [Deterministic state verifiers & advisory judge](lp-0004-deterministic-state-verifiers.md) | Grade bench on final state; demote WebJudge to advisory; add `finalStateSnapshot` | None |
| LP-5 | [Adversarial & safety E2E suite](lp-0005-adversarial-safety-e2e-suite.md) | Prompt-injection / destructive-action / credential-leak coverage | None |
| LP-6 | [Silver-trajectory repair & failure justifications](lp-0006-silver-trajectory-repair.md) | Golden model↔silver pairs + 3-area citeable failure notes | LP-4 (`finalStateSnapshot`) |

Suggested sequencing: LP-4 first (its `finalStateSnapshot` is the shared
substrate LP-6 reuses), LP-5 in parallel (independent, harness-only), then LP-6.

## Observability RFC Drafts (P1)

Draft RFC for the trace/trajectory data layer — making it serve **both** the
human viewer and agents (e.g. Claude Code) with first-class trace search, and
collapsing the dual JSONL+SQLite store + duplicated aggregation into one canonical
span spine. Same status rules: **not stamped**, ends with a "Recommended
Decision". No implementation until the owner records a Decision Stamp.

| # | RFC | Item it implements | Depends on |
| --- | --- | --- | --- |
| LP-7 | [Unified observability engine (agent-callable trace search)](lp-0007-unified-observability-engine.md) | MCP-first agent trace search; OTel-GenAI span spine as single source of truth; DuckDB analytics; RL `(state,action,reward)` trajectory projection | None for Stage A; reuses LP-4 (`finalStateSnapshot`/verifier reward), complements LP-6 (silver pairs) — **Decision stamped 2026-06-27; Stages A (stdio MCP, 12 tools, `scripts/obs/`), B0 (`packages/observability-schema`), B3 (RL trajectory + export), B4 (viewer RL Trajectory tab), B1 (full-fidelity spine; **spine authoritative-by-default for record reads** with SQLite as a derived index for aggregates; dual-read parity verified; kill-switch `OBS_DISABLE_SPINE_READS`) implemented; only the optional physical delete of the derived legacy store (gated on e2e + DuckDB/B2 for aggregate perf if SQLite retired) pending** |

Suggested sequencing: ship Stage A (the MCP server over the existing store)
independently for immediate agent-search value; the storage-rearchitecture
B-stages land additively underneath the stable MCP/HTTP contract.

## Perception series (post-v0.3.0, from the 2026-07-04 SOTA audit)

All drafts pending owner Decision Stamps. Sequencing: LP-10 (smallest,
orthogonal) and LP-9 items 1–3 first; LP-11's default flip gates on an A/B
that should run after LP-9; LP-13 depends on LP-9's scale factor; LP-12
Phase A anytime, Phase B behind a flag until CWS clears; LP-14 parked.

| # | RFC | Problem | Depends on |
| --- | --- | --- | --- |
| LP-9 | [Screenshot pipeline engineering](lp-0009-screenshot-pipeline-engineering.md) | Unowned native-res JPEG q70 screenshots; no scale factor; dead panoramic code | None |
| LP-10 | [New-element diff marking](lp-0010-new-element-diff-marking.md) | Executor can't see what changed since its last action | None (stable IDs shipped) |
| LP-11 | [unified_vl as default perception mode](lp-0011-unified-vl-default.md) | Separate observation model is non-standard; field grounds vision in the executor | LP-9 (for fair A/B) |
| LP-12 | [Extension-native reach](lp-0012-extension-native-reach.md) | Closed shadow roots + cross-origin iframes invisible; extension APIs unused | None |
| LP-13 | [Region zoom tool](lp-0013-region-zoom-tool.md) | Small text/canvas targets unreadable; no zoom action | LP-9 (scale factor) |
| LP-14 | [In-browser PDF handling](lp-0014-pdf-handling.md) | PDF tabs are opaque; no text extraction | None (recommend parked) |

## JobAgent autonomy series (2026-07-20)

Draft RFCs from the [JobAgent automation gap analysis](../jobagent-automation-gap-analysis.md)
(2026-07-20), written after the full fill + approval loop was live-proven on
2026-07-19. The LP-17 label belongs to the efficiency-fixes implementation
workstream (no RFC file), so this series starts at LP-18. Same status rules:
**not stamped**, each ends with a "Recommended Decision". No implementation
until the owner records a Decision Stamp.

| # | RFC | Gap it closes | Depends on |
| --- | --- | --- | --- |
| LP-18 | [JobAgent queue scheduler & notification channel](lp-0018-jobagent-scheduler-notifications.md) | Every pipeline stage is hand-cranked; approvals invisible without the console open; no submission pacing | None |
| LP-19 | [JobAgent graduated autonomy (auto-approve policy)](lp-0019-jobagent-graduated-autonomy.md) | Both human gates unconditionally manual; no path to earned selective autonomy; no post-submission error response | LP-18 §4 (approval-decision log) |
| LP-20 | [JobAgent free-text answer drafting](lp-0020-jobagent-freetext-drafting.md) | Bespoke questions/cover letters dead-end as hand-written TODOs | None (owns vocabulary LP-18/LP-19 import) |

Suggested sequencing: LP-18 first (compounds everything and generates the
approval-decision log), LP-20 in parallel (independent surface), LP-19 last —
activate only after that log calibrates its thresholds.

All three are at **revision 2**: a glm-5p2 second-opinion design review
([assessed report](../rfc-review-jobagent-autonomy-glm-2026-07-20.md),
2026-07-20) found one spec bug, three cross-RFC drift errors, and several
policy hardenings, all of which are now folded in. The revised drafts were
re-reviewed by the same model, which confirmed every finding closed. They
remain **unstamped** — awaiting owner Decision Stamps, with two questions
called out for the stamp (LP-19's threshold numbers and its §7
extension-side-vs-console-side freshness check).

## Prompt-cache series (2026-07-21)

Draft RFC from the 2026-07-21 caching review, which confirmed that Fireworks
discounts cached input on serverless (so prompt caching is a cost lever, not a
latency-only one) and measured a 29.8% prompt-construction *ceiling* against a
22.7% realized hit rate — i.e. the provider side is broadly working and our
prompt layout is the defect. Same status rules: **not stamped**, ends with a
"Recommended Decision". No implementation until the owner records a Decision
Stamp.

| # | RFC | Problem | Depends on |
| --- | --- | --- | --- |
| LP-21 | [Prompt-cache stability, correctness, and measurement](lp-0021-prompt-cache-stability.md) | Four invalidators break the stable prefix every turn — including a `String.replace` collision that injects per-turn element IDs above the cache breakpoint; the invariant is enforced only by a code comment, so the regression class is silent | None (reuses LP-16's ratchet pattern) |

Suggested sequencing: phase 0 (measurement + ratchet) first — without it every
later claim is unfalsifiable — then phase 1 (the bug fix and two small repairs).
Phases 2 (tool freezing) and 3 (append-only history) are deliberately gated on
what phase 1 measures.

## Post-launch consolidation series

LP-15 was decision-stamped and executed 2026-07-05→07 (all twelve phases'
first passes merged); LP-16 picks up its deferred decomposition follow-ups
and extends them to every oversized file. LP-16 is **not stamped** — same
status rules as above.

| # | RFC | Problem | Depends on |
| --- | --- | --- | --- |
| LP-15 | [Three consolidations: runtime library, verification subsystem, loop decomposition](lp-0015-three-consolidations.md) | Split completion authority; no headless runtime; AgentLoop god object | None — **Decision stamped 2026-07-05; first passes of all phases merged 2026-07-07** |
| LP-16 | [Landmine decomposition](lp-0016-landmine-decomposition.md) · [remainder plan](lp-0016-remainder-plan.md) | Four files (kernel 14.4K, loop 10.3K, tools 6.8K, orchestrator 6.7K) are the largest *and* most-churned surfaces; only loop.ts is ratchet-guarded. Phases 0/1/2/4/5 landed (PR #76); Phase 3 partial — remainder plan tracks the e2e-gated driver-flip | LP-15 (turn-machine, pipeline authority, golden gate — all landed) |
