# OpenSidebar

Manifest V3 Chrome extension: an LLM browser agent that sees, clicks, and
navigates the web. Nx + pnpm monorepo. Deep policy lives in `AGENTS.md`; this
file is the fast operational orientation.

## Commands (Windows / PowerShell; pnpm@11, Node 22+)

| Task | Command |
| --- | --- |
| Build | `pnpm run build` (nx → vite, outputs `dist/`) |
| Test (all) | `pnpm test` (vitest) |
| One test file | `pnpm exec vitest run --config apps/extension/vitest.config.ts <path>` |
| Lint | `pnpm run lint` |
| Typecheck | `pnpm run typecheck` (tsc `-b`, project refs) |
| **Verify (run before finishing)** | `pnpm run verify` — lint + typecheck + test + build + dist-check |
| E2E (staged) | `pnpm run test:e2e:easy` → `:medium` → `:hard` (needs API key; headed Chrome) |

Run `easy` before `medium` before `hard` unless scoped to one failing test.

## Where things live

- `apps/extension/src/background` — agent runtime: orchestrator, agent loop, tools, LLM client, skills, checkpoints.
- `apps/extension/src/content` — content script, DOM tagging, page actions.
- `apps/extension/src/sidepanel` — React/Zustand UI (sidepanel + overlay harness).
- `apps/extension/src/trace-viewer` — trace/analytics UI.
- `packages/shared-types/src/messages.ts` — the cross-context contract: a ~64-variant
  `RuntimeMessage` union, handled with an exhaustive `never` check in `sidepanel/bridge.ts`.
- `docs/architecture/` — per-subsystem docs (agent-loop, orchestrator, perception-layer, runtime-boundaries, …).

### Landmines (read before editing)

- `background/agent/loop.ts` (~6.8K lines; `AgentLoop` ≈ 165 methods; under the
  decomposition ratchet — see below) and
  `background/agent/completion-kernel.ts` (~5.9K lines) are the giants and the
  most-churned files in the repo. `background/orchestrator/index.ts` (~5.8K
  lines) and the big `agent/completion/` analysis modules
  (`workflow-confirmation-analysis.ts` ~3.6K, `read-answer-analysis.ts` ~3.3K)
  are the next tier — same care applies. (`background/tools/index.ts` is now a
  ~130-line barrel; the bulk lives in `register-*.ts` modules and the
  ServiceNow adapter.) Sizes drift — trust
  `node scripts/loop-ratchet.mjs --report` over this prose.
- **The decomposition ratchet guards all of this** (LP-15 Phase 11, generalized
  in LP-16 Phase 0): `scripts/loop-ratchet.mjs` runs in the lint step and fails
  if any guarded file grows past its budget in
  `scripts/loop-ratchet-budget.json`. `loop.ts` tracks three metrics (total
  lines, method count, `loop()` length); the other four named landmines track
  total lines. In addition, EVERY source file under `apps/extension/src` and
  `packages/` is capped at 1,500 lines; files that pre-dated the cap are
  grandfathered in the budget's `oversized` map with shrink-only budgets of
  their own — so extracting landmine code into a fresh giant "helpers" file
  fails the ratchet too. Budgets may only go DOWN. If you must add code to a
  guarded file, extract at least as much out (into a `turn-machine.ts` phase,
  an `agent/completion/` contract module, a `register-*.ts` tool module, or a
  `*-policy.ts` module); run `node scripts/loop-ratchet.mjs --report` to see
  the numbers and tighten the budget after extracting. The `loop.ts` turn is
  decomposed into ordered phases (`agent/turn-machine.ts`): gates, escalation,
  feedback, prepare_model_turn, dispatch_tools, post_tool_guards, plan_monitor,
  completion, account_and_refresh. The full decomposition plan is RFC LP-16
  (`docs/engineering/rfcs/lp-0016-landmine-decomposition.md`).
- ServiceNow is a **partially** quarantined adapter, not a fully detached one.
  What IS contained in `background/tools/servicenow/` (definitions / records /
  references / navigation / register / register-list-actions / register-catalog
  / tool-hooks): the SN tool schemas, their registration, the knowledge-base,
  list-action, and catalog handlers, and the reference-resolution helpers.
  `tools/index.ts` talks to it only through the `servicenow/` register entry
  points and `tool-hooks.ts` façades — and adapter modules must never import
  `tools/index.ts` or the tools barrel (one-way rule). What is NOT yet
  extracted and still lives in generic files: the serialized main-world
  SN/Glide page scripts in `tools/main-world-bridge.ts` (they are injected into
  the page, so they can't import adapter code without a new injection
  mechanism); the SN record-form/catalog controller methods in
  `agent/loop.ts`; and smaller SN behavior in `orchestrator/skills.ts`,
  `agent/verification.ts`, `agent/catalog-order-policy.ts`, and
  `content/actions/interaction.ts`. Deleting the adapter dir would NOT remove
  ServiceNow from the runtime — full detachment is deferred to the LP-15
  runtime-as-library work.
- Completion/"is the task done?" has ONE authority: the pure pipeline in
  `agent/completion/pipeline.ts` (kernel decides accept/reject first; the
  absorbed pre-pipeline guard chain runs as ordered stages after it — their
  `legacy_done_guards` basis strings are historical vocabulary, not a parallel
  implementation). The golden corpus in `tests/fixtures/completion-corpus/`
  must replay byte-identical — regenerate with `UPDATE_COMPLETION_CORPUS=1`
  only when you intend a semantic change.
- Prefer the existing small `background/agent/*-policy.ts` modules over adding more
  logic to `AgentLoop`.

## Conventions

- **Tool param names must match across three layers**: the `ToolDefinition`
  (LLM-facing schema), the TypeScript args type, and `content/actions/`. Use `id`
  (integer) for element tag IDs — never `tag`.
- **UI must not import `chrome.*`** — route through `sidepanel/runtime.ts`.
- **Trajectory entries must be environment-agnostic** — no `tabId` / `chrome.storage`
  keys; they must replay identically across adapters.
- **Domain logic stays quarantined.** ServiceNow / WorkArena specifics belong in
  clearly-labeled adapters grounded in stable platform semantics — never in generic
  completion or runtime paths. Do not add task-id / seed / hidden-value branches to
  pass a benchmark.

## Never

- Edit generated files — `apps/extension/src/prompts/generated.ts` is built by
  `pnpm run prompts:build`; change the source, not the output.
- Commit `dist/`, `traces/`, or `.artifacts/` output (all git-ignored).
- Do not reintroduce Bun — it was removed; scripts run on `tsx`.

## When a feature changes direction

Look for stale copy, settings, prompts, tests, or fixtures left behind by the pivot,
and flag them rather than leaving them half-replaced.

## Pointers (load on demand)

- Full engineering policy, change-placement, and WorkArena philosophy → `AGENTS.md`.
- Failure triage order, E2E workflow, and E2E report format → `AGENTS.md`.
- Subsystem deep-dives → `docs/architecture/`.
