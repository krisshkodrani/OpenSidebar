# AGENTS.md

Engineering policy for coding agents in this repo. For fast operational orientation
(commands, where things live, landmines, hard constraints) see `CLAUDE.md` first.
This file holds the deeper "how we make changes here" policy.

## Project Shape

OpenSidebar is a browser-agent Chrome extension with a small monorepo around it.

- `apps/extension/src/background` — agent runtime: orchestrator, agent loop, tools, LLM client, skills, checkpoints, durability.
- `apps/extension/src/content` — content-script code and page bridge.
- `apps/extension/src/sidepanel` — React UI to start/monitor tasks; reused by the overlay harness via a runtime port.
- `apps/extension/src/overlay` — draggable in-page overlay harness (host, runtime, driver, runner helpers).
- `apps/extension/src/background/environment` — partial environment ports for background page/content/persistence I/O.
- `apps/extension/src/trace-viewer` — trace viewer and analytics UI.
- `apps/extension/tests/background` — focused runtime and orchestrator tests.
- `apps/extension/tests/e2e` — fixture-driven E2E tests for real browser behavior.
- `scripts/run-e2e-staged.ts` — staged E2E runner (`easy`, `medium`, `hard`).
- `traces/runs` — recorded trace sessions from E2E and debugging runs.

Repo policy:

- Keep stable product docs in `docs/`; runtime artifacts local under `.artifacts/`.
- Active RFCs live in `docs/engineering/rfcs/`; investigations and scratch research notes stay out of the repo.
- If a real product bug or follow-up is found but not fixed now, create a GitHub issue when GitHub tools are available.

## Harness Architecture Direction

The stable decision is documented in `docs/architecture/runtime-boundaries.md`.
OpenSidebar has implemented a boundary-first harness split:

- **Extension (production):** Chrome sidepanel + `chromeUiRuntimePort` in `sidepanel/runtime.ts`, plus Chrome-backed background environment ports where they exist.
- **Overlay (testing):** draggable panel injected into a generic page via `src/overlay`, with an in-memory `UiRuntimePort` and reusable runner page-port helpers.
- **Headless/mock:** proven at the overlay runner page-port level; a full headless agent-core runtime and replay contract are still deferred.

The target is reusable agent-core behavior across extension, overlay, and headless.
This is **not** a single `BrowserAdapter` tree — use the existing small ports, don't
invent a parallel abstraction.

Constraints to preserve:

- Sidepanel/UI components must NOT import `chrome.*` directly. Use `sidepanel/runtime.ts`.
- New reusable background I/O should prefer `background/environment` ports where they exist. Chrome APIs are still expected in production shell/lifecycle code.
- Trajectories must avoid Chrome-specific fields (tab IDs, `chrome.storage` keys) when intended for cross-environment replay.

## Default Change Placement

- Put agent behavior changes in the product runtime first, usually under `apps/extension/src/background`.
- Put page-interaction fixes in reusable runtime policy, controllers, or skills before considering test changes.
- Keep content-script and bridge fixes in `apps/extension/src/content` or background tool/bridge code, not in fixtures.
- **E2E fixtures/harness:** keep thin — configure the environment, seed minimal state, collect diagnostics, assert results. No product logic.
- **Overlay harness:** treat as product-quality test infrastructure, not a throwaway fixture. Keep dependencies explicit.
- Use skills when a workflow pattern is stable and reusable across sites/tasks.
- Do not add repo-backed research workflows, vendored agent repos, or note systems to the product tree.

## Development Discipline

Bias toward small, verifiable, product-quality changes: think before coding,
simplicity first, surgical changes, goal-driven execution. The main failure mode is
applying one principle in isolation (e.g. using "simplicity" to skip real edge cases,
or "goal-driven" to overfit a test while missing the product behavior). Use judgment
for trivial tasks; do not trade correctness for speed.

- Surface meaningful ambiguity and state assumptions before editing when a wrong choice would be costly; otherwise proceed on a reasonable low-risk assumption and mention it.
- Implement the minimum change that satisfies the request. Prefer existing helpers, patterns, and boundaries over new mechanisms or speculative abstraction. If the implementation grows large, pause and look for a smaller design.
- Keep diffs tightly scoped. Don't reformat, rename, or refactor adjacent code unless required. Match existing style. Remove only what your own change makes obsolete; don't delete pre-existing dead code unless asked.
- Turn work into verifiable outcomes. For bug fixes, prefer a focused reproduction/regression test. For behavior changes, verify observable behavior, not planner artifacts. For refactors, preserve behavior and run the narrowest relevant tests.

## RFC Review And Decision Discipline

An RFC review is advisory until an authorized owner (the user or a maintainer)
records a Decision Stamp. Critique, recommendations, and implementation ideas do
not imply approval.

Use this lifecycle:

`Draft -> Reviewed -> Decision stamped -> Implementation plan -> Implementation -> Verification -> Archived or promoted to docs`

When reviewing an RFC:

- Do not end with critique alone. Summarize the recommendation, then obtain and
  record the owner's decision.
- Agents may recommend a status, but must not invent approval. If the owner has
  not decided, ask for the decision before implementation.
- Do not create an implementation plan or modify product code from an RFC whose
  decision is missing, `Parked`, `Rejected`, or `Needs more research`.
- For `Approved with edits`, complete the required RFC edits before implementation.
- Treat the latest owner-authored Decision Stamp as binding. The `Do not do`
  section defines the boundary agents must not reinterpret. For shipped behavior,
  current code and promoted stable docs remain authoritative.

Every decision must use the complete block below. Use `None` deliberately when a
section has no items; do not leave placeholders such as `TBD` or `...`.

```md
## Decision

Status: Approved / Approved with edits / Rejected / Parked / Needs more research

Chosen path:

- ...

Required edits before implementation:

- ...

Non-blocking follow-ups:

- ...

Do not do:

- ...

Evidence required before merge:

- ...

Next action:

- Implement / Revise RFC / Run spike / Archive
```

The canonical process and copy-ready review prompt are in
`docs/engineering/rfc-decision-process.md`. Active RFC drafts live in `docs/engineering/rfcs/` and require an owner
Decision Stamp before implementation. Validate stamps locally with
`pnpm rfcs:check -- <path>`.

### Feature direction changes

When a feature's direction changes, identify UX, copy, settings, docs, tests,
prompts, fixtures, or runtime paths left stale, duplicated, or half-replaced by the
pivot. If cleaning that up isn't already in scope, ask whether to polish it before
leaving it behind.

## Code Review Workflow

For non-trivial changes: implement → run relevant tests/typecheck/lint → self-review
the diff against the focus list below → fix concrete issues → re-run affected checks
→ summarize what changed and which checks passed.

Skip for single-line/trivial fixes, changes under ~30 net lines with no structural or
behavioral impact, and purely mechanical renames. When in doubt, do a quick self-review.

Review especially for: correctness bugs; async/race conditions; TypeScript type
issues; browser-automation brittleness and selector fragility; SPA re-render timing;
missing act-check-act verification; security/session/auth mistakes; unnecessary complexity.

## Product And E2E Design Rules

1. Target real product behavior, not just the current fixture. Domain behavior belongs in runtime policy, controllers, or skills — not test-only branches.
2. The harness stays thin: observe, seed minimal state, or assert outcomes only.
3. For a repeated, stable workflow, prefer a generic skill over ad hoc prompt tweaks. Skills encode reusable sequencing, evidence expectations, and tool discipline — never fixture selectors, hardcoded fixture text, or hidden E2E knowledge.
4. Planner/verifier estimates are not execution truth when they can be wrong. Heuristic gates may warn, rank, or defer, but must not silently turn future work into failure without direct evidence.
5. Recovery must be sincere: if state is uncertain, say so and re-ground — don't pretend.
6. Evaluation must be fair: a task succeeds only when the real user objective is met, not when intermediate planner artifacts look good.
7. Optimizations for long tasks preserve correctness first, reduce cost/turns second.
8. If a behavior is useful outside E2E, it belongs in the product; if useful only inside E2E, it belongs nowhere unless it is pure test instrumentation.
9. Prompts in fixtures/tests should read like natural user requests — no keyword stuffing, activation phrases, or hidden fixture knowledge.
10. Sidepanel UI components must be environment-agnostic (no direct `chrome.*`; use the bridge). Trajectories must be environment-agnostic (no tab IDs or `chrome.storage` keys in replayable entries).

## WorkArena And Generic Skill Philosophy

Treat WorkArena as a high-signal evaluator, not the product goal. A failure should
become a generic browser-agent capability improvement; a pass counts only when the
real validator passes without hidden benchmark knowledge.

Do not chase 100% by adding task-id branches, seed branches, hidden expected values,
or runner shortcuts. Prefer a transferable 80% over a brittle 100%. Before keeping a
WorkArena-motivated fix, ask whether it would help another realistic app with the same
workflow shape. Avoid product-name vocabularies, fixture nouns, seed entities, prompt
literals, and validator artifacts in runtime logic.

When ServiceNow/WorkArena exposes a stable workflow shape, prefer fix layers in order:
tool/runtime primitive → domain adapter grounded in stable platform semantics (forms,
tables, frames, reference fields, choice values, catalog state) → generic skill for
sequencing/evidence/tool discipline → planner policy only when routing is the repeated
failure → harness only for setup, session transfer, observation, validation, reporting.

Good generic skill candidates: menu navigation, form fill with field readback, list
filter/sort, dashboard/chart extraction, knowledge-search answer extraction, catalog
ordering, multi-tab checklist work, infeasible-task clarification. Keep skills as broad
as the workflow allows.

## E2E Workflow

- Prefer staged execution via `scripts/run-e2e-staged.ts`. Run `easy` → `medium` → `hard` unless scoped to one failing test.
- When a staged run fails, debug the first clean, high-signal failure before spending tokens on later suites. Re-run isolated files when iterating.
- Generated reports belong in `.artifacts/e2e/`, not `docs/`. Format spec: `docs/e2e-report-format.md`.

### Which environment

- **WorkArena tasks** (ServiceNow, Notion) → staged E2E runner (`pnpm run test:e2e:staged`) — benchmark fidelity, regression detection.
- **Generic site tasks** → Playwright harness — product correctness on real-world pages.
- **CI / headless** → mockAdapter — fast unit-level behavior, no browser.
- When fixing an agent-core bug, cover both a WorkArena-style and a generic case when practical.

### Runtime defaults

- Provider mode: `fireworks`; lane: `dev`; executor/planner model: the Fireworks default unless overridden.
- Override env vars: `E2E_PROVIDER`, `E2E_EXECUTOR_MODEL`, `E2E_TEMPERATURE`, `E2E_USE_VL_EXECUTOR`, `E2E_DIAGNOSTIC`.
- Keep harness config minimal; prefer runtime fixes over provider-specific test branching.

## Failure Triage Order

When an E2E or runtime task fails:

1. Identify the most general runtime cause.
2. Confirm it in traces or a focused test.
3. Fix product behavior in runtime policy, orchestration, bridge logic, or skills.
4. Add or update the narrowest regression test that proves the fix.
5. Re-run the isolated failing case before broader staged suites.

Do not start by patching the fixture or harness unless the failure is clearly caused
by test infrastructure. If a generic fix exposes the next bottleneck, keep following
the bottlenecks in order instead of patching around them in the harness.
