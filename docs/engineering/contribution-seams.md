# Contribution Seams

A one-page architectural companion to [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
It shows the runtime at a glance, marks **where outside contributions land
cleanly** (open seams) versus **what is owner-gated** (the giants), and frames
the flagship collaborator project and open research lanes.

If `CONTRIBUTING.md` is "how do I contribute," this is "where does my change
fit in the machine."

## The runtime, with seams marked

```
                          ┌────────────────────────────────────────────┐
   user query             │              SIDE PANEL  (React/Zustand)    │
        │                 │   chat · settings · approvals · progress    │  ← seam: UI must not import chrome.*
        ▼                 └───────────────┬────────────────────────────┘
┌───────────────────┐                     │ RuntimeMessage (bridge.ts, exhaustive union)
│   ORCHESTRATOR    │  ◀──────────────────┘
│  TaskPlanner →    │
│  TaskNode[] →     │   ╔══════════════════════════════════════════════╗
│  per-node loop →  │   ║   ░░ OWNER-GATED GIANTS ░░                    ║
│  verifier         │   ║                                              ║
└─────────┬─────────┘   ║   loop.ts            (~10K lines)            ║
          │             ║   completion-kernel.ts (~14K lines)          ║
          ▼             ║   skills.ts          (hardcoded dispatch)    ║
   ┌─────────────┐      ║                                              ║
   │  AGENT LOOP │ ─────╫─▶ completion logic is SPLIT across the first ║
   │  observe →  │      ║   two — a "local" change often isn't.        ║
   │  think →    │      ╚══════════════════════════════════════════════╝
   │  act →      │
   │  done       │      ── open seams (contribute here) ──────────────
   └──────┬──────┘
          │             • background/agent/*-policy.ts   → seam: POLICY MODULES
          ▼             • tools/*  + content/actions.ts   → seam: TOOLS (3-layer naming)
   ┌─────────────┐      • content/ DOM tagging, snapshots → (advanced)
   │ CONTENT     │      • trace-viewer/                   → seam: PANELS & ANALYSES
   │ SCRIPT      │      • llm/ provider client            → seam: PROVIDER ADAPTERS
   │ DOM ↔ page  │      • tests/e2e/fixtures/             → seam: FIXTURES (start here)
   └─────────────┘
          │
          ▼
   ┌─────────────┐      ┌───────────────────────────────────────┐
   │  THE PAGE   │      │ BACKEND (7589 /api/backend): durable   │
   └─────────────┘      │ task runs + scheduling (SQLite)        │
                        └───────────────────────────────────────┘
```

## Open seams (ordered by friction)

| # | Seam | Path | Why it's safe to enter | Label |
|---|------|------|------------------------|-------|
| 1 | **E2E fixtures** | `apps/extension/tests/e2e/fixtures/` | Thin, self-contained HTML. A failing fixture + trace is a complete contribution even without a fix. | `fixture` |
| 2 | **Policy modules** | `background/agent/*-policy.ts` | Small, single-purpose, unit-tested in isolation. The preferred home for new agent logic. | `policy-module` |
| 3 | **Tools** | `tools/*` + `content/actions.ts` | Bounded by the three-layer naming rule (schema = args type = executor). | `tooling` |
| 4 | **Trace-viewer** | `apps/extension/src/trace-viewer/` | React app, decoupled from the agent runtime. | `trace-viewer` |
| 5 | **Provider adapters** | `background/agent/llm/` | BYOK matrix; bounded by clear types. | `provider` |

Why these and not the giants: the May 2026 architecture review found the core
**healthy and verified**. The seam map gets contributors the same safety outcome
by **routing around** `loop.ts` / `completion-kernel.ts` / `skills.ts` rather
than asking newcomers to rewrite them. Owner-gated does not mean frozen — it
means a stamped RFC decision comes before the code (see
[`rfc-decision-process.md`](rfc-decision-process.md)).

## Flagship collaborator project — GAP-12: the pack plugin interface

The most impactful thing a collaborator can help design.

**Today**, adding a platform pack (Salesforce, SAP, Zendesk) requires editing
**four core files**: `skills.ts` (descriptors + bodies + a hardcoded
`if (pack.id === …)` activation chain), `tools/index.ts` (tool definitions), and
`loop.ts` (controller logic). The skill *selection* pipeline is already clean and
respects per-pack toggles — but there is no `registerPack()` API, no file-system
discovery, and platform tools fatten the core even when their pack is disabled.

**The goal:** a conforming plugin interface so a new pack needs **zero core-file
edits**.

```typescript
interface PackPlugin {
  readonly pack: SkillPack;
  readonly tools: ToolDefinition[];
  readonly skills: LoadedSkillContract[];
  readonly activation: (input: SkillMatcherInput) => ActivationResult | null;
  readonly controller?: (loop: AgentLoop) => Promise<LoopResult | null>;
}
// registerPack(new ServiceNowPlatformPack());
// registerPack(new SalesforcePlatformPack());
```

Extracting the existing `servicenow-platform` pack into the **first conforming
implementation** is the proof the interface works. This is P1-sized engineering
with real core-runtime surface area — it is **recruited for, not yet built**, and
will land under its own RFC decision. The full analysis is in
[`sota-gap-analysis.md`](sota-gap-analysis.md) (§3.4, GAP-12). If this is the
kind of architectural work you want, open a feature/RFC issue and say so.

## Open research lanes (RFC invitations)

For research-minded collaborators. These are framed as RFC invitations — bring a
design and evidence, not a finished PR:

- **Visual grounding / set-of-marks** (GAP-5) — overlay numbered boxes on
  screenshots so the model can reference visual markers, not just DOM tag IDs.
  Improves reliability on dashboards and image-heavy pages.
- **Action pre-verification / world model** — predict the effect of an action
  before executing it on live writes, to cut wasted mutating turns.
- **Safety scoring** (GAP-7) — a context-aware action guard that scores a
  proposed tool call given page context (e.g. "delete" on `/admin` ≫ `/test`),
  beyond the current tool-level risk tiers.
- **Cross-session learning** (GAP-1) — automatic extraction of success/failure
  patterns from traces, retrieved into planner context on repeat visits.

See [`sota-gap-analysis.md`](sota-gap-analysis.md) for the full gap matrix,
priorities, and where OpenSidebar already leads SOTA (deterministic completion
verification, lane-level fault isolation, plan repair).

## Where to start

A thin failing E2E fixture for a real page the agent struggles with (seam #1) is
the canonical first PR. Browse
[`good first issue`](https://github.com/krisshkodrani/OpenSidebar/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
and `fixture` issues, or file a fixture proposal.
