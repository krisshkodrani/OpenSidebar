# Documentation Policy

OpenSidebar keeps source-of-truth documentation in git and keeps research or experimental material outside the repo.

## Repo Documentation

Use `docs/` for stable information that should track the shipped product:

- setup, build, test, and release workflows
- current architecture and runtime ownership
- user-facing feature behavior
- security and privacy expectations
- design-system decisions that are already implemented

Repo docs should be maintained with code changes. If the implementation changes, update the relevant doc in the same PR or commit.

## Notion Documentation

Use Notion for material that is useful but not a stable product contract:

- RFCs and design proposals
- research reports and market scans
- model benchmarks and provider experiments
- E2E investigations and debugging narratives
- development journal notes
- temporary planning or speculative architecture

If a Notion note becomes a product decision, promote only the stable conclusion into `docs/` and keep the full investigation in Notion.

## RFC Decisions

RFCs follow this lifecycle:

`Draft -> Reviewed -> Decision stamped -> Implementation plan -> Implementation -> Verification -> Archived or promoted to docs`

A review does not authorize implementation. The user or a maintainer must record
the final Decision Stamp before an implementation plan or product-code change
starts. Agents may recommend a decision, but may not infer or assign approval.

Use [RFC Decision Process](engineering/rfc-decision-process.md) for the required
stamp, status semantics, review prompt, and implementation gate.

## Promotion Criteria

Move content from Notion into repo docs only when all of these are true:

- it describes behavior that exists in the current codebase
- it is useful to future contributors or users
- it is expected to remain valid for more than one development cycle
- it can be verified from source, tests, or release process

## Stale Content Rules

- Prefer deleting stale repo docs over preserving misleading information.
- Keep dated investigations out of `docs/`.
- Store generated E2E reports under `.artifacts/e2e/`.
- Do not add benchmark dumps, research citations, or RFC drafts to git.
- If a repo doc has legacy paths or model names, update it or mark it explicitly as historical.

## Notion Structure

Canonical Notion hub: `OpenSidebar HQ`.

Use the existing HQ surfaces this way:

- `RFCs`: active proposals, accepted designs, rejected designs, and stale proposals.
- `Architecture Decisions`: accepted decisions that should be easy to find without reading full RFCs.
- `Findings`: bugs, risks, investigation results, and cleanup needs that are not immediately fixed.
- `E2E Runs`: run records using the same metrics as repo-generated `.artifacts/e2e/` reports.
- `Archive`: imported repo artifacts, dated research, old reports, and one-off notes that should not sit in active repo docs.

| Property           | Values                                                                             |
| ------------------ | ---------------------------------------------------------------------------------- |
| Type               | RFC, Research, Experiment, E2E Report, Design Study, Debug Investigation, Decision |
| Lifecycle status   | Draft, In review, Decided, Implementing, Verifying, Promoted to Repo, Archived     |
| Decision           | Pending, Approved, Approved with edits, Rejected, Parked, Needs more research      |
| Area               | Runtime, UI, E2E, Models, Perception, Docs, CI                                     |
| Repo impact        | None, Follow-up issue, PR needed, Promoted                                         |
| Canonical repo doc | Link to the stable repo document, if promoted                                      |
