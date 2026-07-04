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
- `packages/shared-types/src/messages.ts` — the cross-context contract: a ~62-variant
  `RuntimeMessage` union, handled with an exhaustive `never` check in `sidepanel/bridge.ts`.
- `docs/architecture/` — per-subsystem docs (agent-loop, orchestrator, perception-layer, runtime-boundaries, …).

### Landmines (read before editing)

- `background/agent/loop.ts` (~11K lines; `AgentLoop` ≈ 290 methods) and
  `background/agent/completion-kernel.ts` (~14K lines) are the giants and the
  most-churned files in the repo. `background/tools/index.ts` (~7K lines after
  the ServiceNow adapter extraction) and `background/orchestrator/index.ts`
  (~7.5K lines) are the next tier — same care applies.
- ServiceNow-specific tool logic lives in `background/tools/servicenow/`
  (records/references/navigation/register). Modules there must never import
  `tools/index.ts` or the tools barrel — the dependency points one way.
- Completion/"is the task done?" logic is **split** between those two files (a
  deterministic contract kernel + a legacy guard chain in the loop). Reason about
  both when you touch completion behavior.
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
