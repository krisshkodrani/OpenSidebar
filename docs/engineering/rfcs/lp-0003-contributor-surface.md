# RFC LP-3 — Contributor Surface for Public Launch

Lifecycle status: Decision stamped
Date: 2026-06-10
Decision date: 2026-06-10 (owner approved in session)
Scope: `CONTRIBUTING.md`, `.github/` issue/PR templates and labels, a contribution-seams doc under `docs/engineering/`, curated good-first-issues. Documentation and repo process only — no product-runtime changes.
Related: SOTA Gap Analysis GAP-12 (pack plugin interface, P1 — referenced as the headline collaborator project, not implemented here)

## Problem

The launch goal is to attract collaborators, but the repo's interesting
behavior is concentrated where outsiders cannot safely work: `loop.ts`
(~385KB, `AgentLoop` ≈ 261 methods), `completion-kernel.ts` (~500KB), and
`skills.ts` (~4,000 lines with hardcoded activation dispatch). There is no
`CONTRIBUTING.md`, no issue taxonomy, and no statement of which surfaces are
open for contribution versus owner-gated. A motivated stranger today has two
options: a trivial doc fix, or a PR into a 10K-line file that will fail
review for reasons no document told them about (RFC decision discipline,
policy-module placement, fixture thinness, the WorkArena philosophy).

Every successful OSS agent project pairs launch with an explicit contribution
funnel; without one, launch traffic converts to zero PRs — or worse, to PRs
that burn maintainer time.

## Proposal

Documentation-and-process only; ship in days, not weeks.

### 1. `CONTRIBUTING.md` (repo root)

Short, pointing into existing docs rather than duplicating them:

- Setup (pnpm/corepack, `pnpm run dev`, load unpacked) and the verify gate
  (`pnpm run verify` before every PR).
- **The seam map** — where contributions are welcome, in order of friction:
  1. **E2E fixtures** — "found a page pattern the agent fails on? Add a
     failing fixture" is the canonical first PR. Fixtures are thin by policy;
     a failing fixture with a trace is a complete, valuable contribution
     even without a fix.
  2. **Policy modules** (`background/agent/*-policy.ts`) — bounded behavior
     changes with clear unit-test contracts.
  3. **Tools** (definition + args type + `content/actions.ts`, the
     three-layer naming rule stated explicitly).
  4. **Trace-viewer panels and analyses.**
  5. **Provider adapters** (BYOK provider matrix).
- **The do-not-enter map**: `loop.ts` and `completion-kernel.ts` changes are
  owner-gated and RFC-gated; generated files; benchmark-specific branches;
  domain logic outside adapters. One paragraph each on *why*, linking
  AGENTS.md.
- RFC decision discipline summarized in three sentences with a link to
  `docs/engineering/rfc-decision-process.md`.

### 2. Issue/PR infrastructure (`.github/`)

- Issue templates: bug (requires a trace or frozen bundle), fixture proposal
  (page pattern + expected behavior), feature/RFC pointer.
- PR template: checklist mirroring the verify gate + seam map.
- Label taxonomy: `good-first-issue`, `fixture`, `policy-module`, `tooling`,
  `trace-viewer`, `provider`, `rfc-required`, `owner-gated`.
- 10–15 curated good-first-issues at launch, drawn from: known E2E failure
  categories (the 11 categorized failures from the 2026-03 coverage session
  that remain open), trace-viewer follow-ups (e.g. issue #37 remnant work),
  provider-matrix gaps, and docs drift.

### 3. Contribution-seams doc (`docs/engineering/contribution-seams.md`)

The one-page architectural version of the seam map: a diagram of the runtime
with the open seams highlighted, the giants marked owner-gated, and GAP-12
(pack plugin interface) framed as the flagship collaborator project — "help
us design `registerPack()` so a Salesforce pack needs zero core-file edits".
Open research lanes (world-model action pre-verification, ST-WebAgentBench
safety scoring) listed as RFC invitations for research-minded collaborators.

### 4. Governance minimum

- License stays MIT (already in place).
- DCO sign-off (lightweight) rather than a CLA.
- `CODE_OF_CONDUCT.md` (Contributor Covenant, stock).
- A stated review SLA the owner can actually keep (e.g. first response within
  a week) — an honest small promise beats an aspirational broken one.

## Alternatives

- **Refactor the giants first, then invite contributors:** months of risk
  before launch, and the May analysis showed the current core is healthy and
  verified. The seam map gets the same safety outcome by routing around the
  giants instead of rewriting them. Rejected for launch (revisit post-launch).
- **Implement GAP-12 pack plugins now as the contribution surface:** P1-sized
  engineering with core-runtime risk; framing it as the flagship *project*
  gets the recruiting value without the pre-launch risk. Deferred to its own
  decision.
- **Launch without a funnel (status quo):** converts launch attention into
  drive-by issues and unreviewable PRs. Rejected.

## Testing

- `pnpm run verify` unaffected (docs/templates only).
- Dry run: one outside-the-project person follows CONTRIBUTING.md from clone
  to a passing fixture PR; friction points fixed before launch.

## Rollout

Small (~1–2 days of writing + issue curation). Ship first of the three P0s —
it has no code risk and everything else benefits from it being in place when
launch traffic arrives.

## Decision

Status: Approved

Chosen path:

- CONTRIBUTING.md with seam map and do-not-enter map, .github templates and
  label taxonomy, 10–15 curated good-first-issues, a contribution-seams doc
  framing GAP-12 and research lanes as collaborator projects, and minimum
  governance.
- Governance, as decided by the owner this session:
  - **Provenance:** MIT inbound=outbound only — no DCO sign-off, no CLA. The
    license already grants the needed terms; contribution implies licensing
    under the same MIT terms.
  - **Review SLA:** best-effort, with **no stated time guarantee**. State the
    project is maintained best-effort rather than promise a window the owner
    cannot keep.
  - **Code of Conduct:** keep the existing stock Contributor Covenant
    adaptation already in `CODE_OF_CONDUCT.md`.
- Good-first-issues are created as **live GitHub issues** via `gh` at
  implementation time, drawn from real, current failure categories and
  bounded SOTA-gap work (not invented placeholders).

Required edits before implementation:

- None. (The two prior blocking edits — governance confirmation and GFI
  approval — were resolved by the owner in this session.)

Non-blocking follow-ups:

- A short "architecture tour" screencast or annotated trace walkthrough;
  GitHub Discussions setup; a public roadmap page.

Do not do:

- No refactoring of `loop.ts`, `completion-kernel.ts`, or `skills.ts` under
  this RFC.
- No GAP-12 implementation under this RFC — it is recruited for, not built.
- Do not add a DCO bot, CLA assistant, or any stated response-time promise.
- Do not promise contribution scopes the owner cannot sustain.

Evidence required before merge:

- CONTRIBUTING.md, templates, labels, and seams doc merged; issues published.
- One completed dry-run contribution (clone → fixture PR → review) with
  friction notes addressed.

Next action:

- Implement
