# Contributing to OpenSidebar

OpenSidebar is an LLM browser agent that sees, clicks, and navigates the web —
a Manifest V3 Chrome extension on an Nx + pnpm monorepo. Thank you for
considering a contribution.

This guide is deliberately short. It points into the deeper docs rather than
duplicating them. Read it before opening your first PR — it tells you **where
contributions land cleanly** and **which surfaces are owner-gated**, so your
work doesn't fail review for a reason no document told you about.

## Quick Start

1. Fork and clone the repository.
2. Use Node.js 22+ and pnpm 11 (`corepack enable` gives you the pinned pnpm).
3. Run `corepack pnpm install`.
4. Copy `.env.example` to `.env` if you want local provider-backed runs (BYOK —
   bring your own API key).
5. Run `pnpm run dev` — starts the extension dev build, the unified local
   server, and the trace viewer.
6. Load the unpacked extension: `chrome://extensions` → Developer mode → **Load
   unpacked** → select `dist-dev/` (the dev build, labeled "OpenSidebar (dev)").
   For a standalone production build, run `pnpm run dist` and load `dist/`.

## The One Gate Before Every PR

```bash
pnpm run verify
```

`verify` runs RFC decision checks, lint, typecheck, the full unit/integration
test suite, the production build, and a dist sanity check. **A green `verify` is
the bar for every PR.** If it passes locally, review will not bounce you on
mechanics — only on substance.

E2E tests are separate (they need a real browser and an API key) and are not
required for most PRs:

```bash
pnpm run test:e2e        # build + real-browser E2E
```

## Where Contributions Land Cleanly — The Seam Map

The interesting behavior in this repo is concentrated in a few very large,
heavily-churned files. You do **not** need to touch those to make a valuable
contribution. These are the open seams, in rough order of lowest to highest
friction:

### 1. E2E fixtures — the canonical first PR

Found a page pattern the agent fails on? **Add a failing fixture.** Fixtures
live under `apps/extension/tests/e2e/fixtures/` and are thin by policy — a
self-contained HTML page that reproduces a real-world DOM/timing/interaction
shape. A failing fixture *with a trace attached* is a complete, valuable
contribution **even without a fix** — it gives a maintainer a deterministic
reproduction. Label such issues `fixture`.

### 2. Policy modules — bounded behavior changes

`apps/extension/src/background/agent/*-policy.ts` are small, single-purpose
modules with clear unit-test contracts (escalation rescue, stagnation, plan
progress, etc.). Behavior tweaks here are reviewable in isolation and the
preferred home for new agent logic — **prefer adding a policy module over
adding methods to `AgentLoop`.** Pair every change with a unit test. Label
`policy-module`.

### 3. Tools — three-layer naming rule

A tool spans three layers, and the **parameter names must match across all
three**:

- the `ToolDefinition` (LLM-facing schema),
- the TypeScript args type,
- `apps/extension/src/content/actions/` (the executor layer; interaction.ts et al).

Use `id` (an integer) for element tag IDs — never `tag`. Mismatches here are
the most common avoidable tool bug. Label `tooling`.

### 4. Trace-viewer panels and analyses

`apps/extension/src/trace-viewer/` is a React/Zustand app for inspecting agent
runs. New panels, diagnostics, and aggregate analyses are well-isolated from the
agent runtime — a good surface if you prefer frontend work. Label `trace-viewer`.

### 5. Provider adapters

OpenSidebar is BYOK across multiple providers. Extending the provider matrix
(new OpenAI-compatible endpoints, model defaults, failover behavior) lives in
the LLM client layer and is bounded by clear types. Label `provider`.

## The Do-Not-Enter Map

These surfaces are **owner-gated and RFC-gated**. PRs that change them without a
stamped RFC will be asked to step back to an issue first. Each is gated for a
specific reason:

- **`background/agent/loop.ts` (~10K lines) and
  `background/agent/completion-kernel.ts` (~14K lines).** These are the giants
  and the most-churned files in the repo, and completion ("is the task done?")
  logic is deliberately split between them. A change that looks local often
  isn't. Behavior changes here need an RFC decision first. See `CLAUDE.md`
  → *Landmines* and `AGENTS.md` → *Default Change Placement*.
- **`background/orchestrator/skills.ts`** — a large file with hardcoded activation
  dispatch. Formalizing it into a plugin interface is a *flagship* project
  (GAP-12, see below), not a drive-by edit.
- **Generated files** — e.g. `apps/extension/src/prompts/generated.ts` is built
  by `pnpm run prompts:build`. Change the source, never the output.
- **Benchmark-specific branches.** Do not add task-id, seed, or hidden-value
  branches to pass a benchmark. A transferable 80% beats a brittle 100%. See
  `AGENTS.md` → *WorkArena And Generic Skill Philosophy*.
- **Domain logic outside adapters.** ServiceNow / WorkArena specifics belong in
  clearly-labeled adapters grounded in stable platform semantics — never in
  generic completion or runtime paths.

When in doubt, **open an issue describing the behavior change before writing the
code.** That is faster than a PR that has to be unwound.

## RFC Decision Discipline

Non-trivial behavior changes are gated by a lightweight RFC decision process.
In three sentences: an RFC review is *advisory* until an authorized owner
records a **Decision Stamp**; the stamp's `Chosen path` and `Do not do` sections
are then the binding boundary for implementation; agents and contributors must
not invent approval or reinterpret a stamped decision in code. If your change is
owner-gated (see above) or otherwise needs a decision, start there. The full
workflow and a copy-ready review prompt are in
[`docs/engineering/rfc-decision-process.md`](docs/engineering/rfc-decision-process.md).

## Architecture Map

The active product surface:

- `apps/extension/src/background/` — agent runtime: orchestrator, agent loop,
  model routing, tool dispatch, skills, checkpoints.
- `apps/extension/src/content/` — content script, DOM tagging, snapshots, page
  actions.
- `apps/extension/src/sidepanel/` — React/Zustand UI: chat, settings, approvals,
  progress. (Must not import `chrome.*` directly — route through
  `sidepanel/runtime.ts`.)
- `apps/extension/src/trace-viewer/` — trace inspection and analytics UI.
- `packages/shared-types/` — the cross-context contract, including the
  `RuntimeMessage` union.
- `packages/prompts/` — prompt runtime and generated prompt assets.

For the deeper "how we make changes here" policy — change placement, the
WorkArena philosophy, failure-triage order, and the E2E workflow — read
[`AGENTS.md`](AGENTS.md). Per-subsystem deep-dives live in `docs/architecture/`.

## The Flagship Project & Research Lanes

If you want a meatier collaboration than a single fixture or policy tweak, the
[contribution-seams doc](docs/engineering/contribution-seams.md) frames the
**pack plugin interface** (GAP-12) — making it possible to add a Salesforce or
Zendesk pack with **zero core-file edits** — as the headline collaborator
project, along with open research lanes (visual grounding, action
pre-verification, safety scoring) that are RFC invitations rather than
ready-to-code tasks.

## Observability

OpenSidebar keeps a first-class trace/logging workflow — it's how you'll
diagnose agent behavior:

- Structured logs drain to `logs/`; session traces to `traces/`.
- The trace viewer is served at `http://127.0.0.1:7589/viewer`.

```bash
pnpm run logs          # unified local server + trace viewer
pnpm run logs:tail     # tail recent structured logs
pnpm run logs:errors   # error-level logs only
pnpm run traces -- list
```

When reporting a browser-agent bug, include the provider mode, model overrides,
task prompt, URL *shape* (not private URLs), and whether a local trace or E2E
report is available. **Redact page data, credentials, cookies, and API keys**
before attaching any diagnostics.

## Command Reference

| Command | Description |
| --- | --- |
| `pnpm run dev` | Extension dev stack + local logs + trace viewer |
| `pnpm run doctor` | Diagnose local setup (Node/pnpm/Chrome/env) |
| `pnpm run build` | Production build (outputs `dist/`; `pnpm run dist` is the same target) |
| `pnpm test` | Extension unit and integration suite (Vitest) |
| `pnpm run lint` | ESLint for extension, packages, scripts |
| `pnpm run typecheck` | TypeScript project-reference typecheck |
| `pnpm run verify` | **Pre-PR gate:** rfcs + lint + typecheck + test + build + dist-check |
| `pnpm run fmt` | Prettier for extension source and packages |
| `pnpm run fixtures` | Serve local E2E/demo fixtures |
| `pnpm run test:e2e` | Build + real-browser E2E tests |

## Governance

- **License:** [MIT](LICENSE). Contributions are accepted **inbound=outbound**
  under the same MIT terms — opening a pull request means you agree your
  contribution is licensed under MIT. There is no CLA and no DCO sign-off
  requirement.
- **Code of Conduct:** by participating you agree to the
  [Code of Conduct](CODE_OF_CONDUCT.md).
- **Review expectations:** OpenSidebar is maintained on a **best-effort** basis.
  We can't promise a response time — please don't read silence as rejection, and
  feel free to bump a stale thread politely.

## Good First Contributions

Browse issues labeled
[`good first issue`](https://github.com/krisshkodrani/OpenSidebar/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
and `fixture`. The single most useful first PR is a thin failing E2E fixture for
a real page the agent struggles with — see seam #1 above.
