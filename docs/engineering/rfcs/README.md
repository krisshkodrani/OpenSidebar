# Launch-Prep RFC Drafts (P0)

Draft RFCs for the three P0 launch blockers identified in
[SOTA Gap Analysis](../sota-gap-analysis.md) (2026-06-08) and the follow-up
orchestration review (2026-06-10). Per repo policy the canonical home for
active RFCs is Notion; these are local Markdown drafts pending transfer and an
owner decision.

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
