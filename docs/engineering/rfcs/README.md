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
