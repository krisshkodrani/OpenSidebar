# Goal: OpenSidebar × OpenClaw — Complete Integration

> **North star:** OpenClaw becomes the brain (canonical knowledge + orchestration);
> OpenSidebar stays the hands (tactical browser execution + a fast local cache).
> They connect over MCP with thick, intent-level tools. The user reaches one agent
> from the browser, Telegram, or CLI, and memory follows them everywhere — while the
> extension still works standalone when the daemon is off.

This document defines the full end-state and the phased path to it, with an explicit
**Definition of Done (DoD)** per phase. The approved implementation plan lives at
`~/.claude/plans/also-the-feature-that-cozy-waterfall.md`; this is the durable goal it
serves.

---

## Why

OpenSidebar has **no working cross-session memory today** — GBrain was never wired,
the site-learning loop was deleted, and extracted facts are stored but never
re-injected. Rather than rebuild a brain inside a browser extension, delegate that to
OpenClaw (a persistent daemon built for memory, scheduling, and messaging) and let
OpenSidebar do the one thing only it can: drive a **real authenticated browser
session**.

## Two senses of "OpenClaw" (read first)

The name appears in two complementary roles — keep them distinct:

- **OpenClaw the brain** — the persistent daemon (memory, scheduling, messaging,
  orchestration) this initiative integrates. The *strategic* tier.
- **OpenClaw the grading rubric** — "OpenClaw RL Guidelines v5"
  (`.artifacts/openclaw rl.pdf`): a 1–5 grade-to-lowest trajectory rubric
  (task_completion / tool_use / reliability / safety), action tiers T0–T3, and the
  `(state, action, reward)` RL data unit. Already adopted by the observability engine.

They reinforce each other: the rubric is the **evaluation/learning contract** the
brain uses to grade and learn from OpenSidebar runs. This is leverage, not a
conflict — see the enabling foundation below.

## Enabling foundation already landed (RFC LP-7, commit `add2c8dd`)

The Unified Observability Engine shipped infrastructure this initiative now builds on:

- **A proven stdio MCP server** (`scripts/obs/mcp-server.ts`, `@modelcontextprotocol/sdk@1.29.0`
  already a dependency, `.mcp.json`, `pnpm run mcp`) — the pattern Phase 2 reuses.
  Note its direction is *inward* (agents search our traces); Phase 2 adds the
  *outward* sibling (OpenClaw drives our browser).
- **OpenClaw-format graded trajectories already exported** (`scripts/obs/rl-trajectory.ts`,
  `export-trajectories.ts` → JSONL; `packages/observability-schema/src/rl-trajectory.ts`)
  — the learning signal Phase 3 feeds to the brain is already produced.
- **A canonical span spine** (`traces/spans/` + CAS blobs) as the single source of
  truth for trajectories — the migration target for Phase 6 (supersedes the flat
  `trajectory_json` in `apps/backend/src/db.ts`).

## Definition of "resolved" (the end state)

The initiative is complete when **all** of these are true:

1. **Single source of truth for knowledge.** Personal profile, learned site facts,
   and website skills are canonical in OpenClaw; the extension holds only a
   read-through cache. No competing/half-wired stores remain.
2. **Memory follows the user across surfaces.** A fact learned via Telegram is
   available in the browser, and vice versa.
3. **Standalone still works.** With the daemon off, the extension personalizes from
   cache and runs tasks — no hard dependency.
4. **OpenClaw can drive the browser** via thick MCP tools, getting authenticated
   sessions instead of detectable headless Playwright.
5. **Sensitive data is provably protected** — hard-gated from auto-transmission and
   encrypted at rest, end to end.
6. **One queue, one scheduler** — OpenClaw owns durable task state and timed pushes;
   the extension keeps only tactical resume.
7. **Privacy invariant holds even remote** — knowledge memory is loopback-only; the
   AWS path never stores it server-side.
8. **Batteries included** — a one-command install brings up an opinionated, loopback
   OpenClaw backend pre-wired to the extension.

## Locked decisions

| Decision | Choice |
| --- | --- |
| Coupling | Standalone via cache (works without the daemon) |
| LLM routing | Hybrid — executor direct to provider; planner via OpenClaw gateway |
| Sensitive data | Hard gate + encrypt at rest |
| Task-run queue | Local for v1, migrate to OpenClaw later |
| Deployment v1 | Local only; AWS/remote is a later additive path |

## Ownership (summary)

- **OpenClaw (strategic, canonical):** knowledge memory, job queue + scheduling,
  cross-session memory, messaging channels, profile file workspace, deep-reasoning model.
- **OpenSidebar (tactical, local):** authenticated browser session + DOM, page-level
  execution, operational state (checkpoints/keepalive/resume — always local), the
  knowledge cache, the MCP server surface, fast executor model.
- **Contract:** thick intent-level MCP tools; cache-sync (last-writer-wins per item);
  human-in-the-loop status (`{ status: "needs_human", reason }`).

## Cross-cutting invariants (true in every phase)

- **Loopback-only knowledge memory** — never bound to a public interface; never stored
  server-side once OpenClaw moves remote.
- **Standalone degradation** — every OpenClaw dependency has a local fallback.
- **Thick boundary** — OpenClaw never issues DOM primitives; only intent-level calls.
- **Observable** — OpenClaw-driven browser calls emit spans into the same span spine
  (RFC LP-7), so the brain's orchestration is traceable end-to-end, not a black box.

---

## Phases & Definition of Done

### Phase 0 — Ground truth & cleanup ✅ DONE
- **Objective:** establish the real state; remove dead/misleading memory subsystems.
- **Done:** GBrain artifacts deleted; `7589` in-process backend documented; 4 docs +
  3 memory files corrected; `lab_structure` memory removed. Committed as
  `docs: correct stale backend/memory references`.

### Phase 1 — Privacy hardening 🔜 NEXT (launch-blocking, OpenClaw-independent)
- **Objective:** make sensitive personal data provably safe before any public launch.
- **Key work:**
  - Hard sensitive gate: replace the soft `-Infinity` exclusion in
    `apps/extension/src/utils/personal-profile.ts` (`scoreDigestItem`,
    `selectRelevantProfileDigestItems`, `buildPersonalProfilePlannerContext`) with an
    explicit access control + per-task consent flag. Audit both injection sites:
    `background/orchestrator/index.ts` (~3643/3662) and
    `background/agent/writer-handoff.ts` (~166), plus the `resolveProfileFields`
    autofill path.
  - Encrypt-at-rest: encrypt `sensitive`-kind digest values in `chrome.storage.local`
    (WebCrypto; non-synced key); decrypt only at gated injection.
  - Privacy policy: update `PRIVACY_POLICY.md` to state plainly that enabled profile
    digest items are sent to the configured LLM provider, and how sensitive items are gated.
  - Consolidate: delete orphaned `/profile/resolve` + `/profile/context`
    (`apps/backend/src/routes/profile.ts`, `services/profile-service.ts` —
    `resolveSafeProfileContext`, backend `resolveProfileFields`) and their tests; keep
    `/profile/file` (CV alias).
  - Trace surface (new, from RFC LP-7): the observability MCP server
    (`scripts/obs/mcp-server.ts`) and span spine expose full traces — screenshots,
    perception, prompt content that may embed injected profile/sensitive data — to any
    agent in `.mcp.json`. Confirm this stays loopback-only and decide whether sensitive
    spans are redacted/gated at the span-mapper (`packages/observability-schema/src/map-trace-entry.ts`).
- **DoD:** unit tests prove sensitive items never appear in injected context **or in
  agent-readable spans** without consent; encrypt/decrypt round-trips; privacy policy
  matches behavior; orphaned endpoints + tests gone; `pnpm run verify` green.

### Phase 2 — MCP browser host + thick tools (the bridge)
- **Objective:** let OpenClaw drive the authenticated browser through one boundary.
- **Not greenfield** — reuses the proven stdio MCP pattern from RFC LP-7
  (`@modelcontextprotocol/sdk@1.29.0`, the `scripts/obs/mcp-server.ts` structure). This
  *outward* browser server is a sibling to the existing *inward* observability server.
- **Decisions:** transport = **loopback WebSocket** (SW connects as client; reconnect +
  keepalive); placement = **`scripts/browser-mcp/`** (talks over a bridge, imports no
  extension internals).
- **Stage 1 — DONE** (`a34f60c4`): thick intent-level tools
  (`browser_ping`/`navigate`/`screenshot`/`extract_structured`/`research_company`/
  `apply_to_job`/`run_task`), the `BrowserBridge` contract (`ok | needs_human | error`),
  the stdio MCP server, validate-then-forward `dispatch`, `NotConnectedBridge` default.
  7 tests; `pnpm run mcp:browser`.
- **Stage 2 — remaining:** the loopback WebSocket transport (`ws` dep) + the
  **extension-side handler** mapping a bridge request to an `AgentLoop` run and returning
  `needs_human` (touches orchestrator/SW — deferred until the completion-kernel WIP
  settles). Emit a span per call into the LP-7 spine.
- **DoD:** `browser_ping` round-trips from an MCP client to the live extension; a thick
  tool runs end-to-end; CAPTCHA/auth pauses surface as `needs_human`; calls appear as
  spans in the trace viewer.

### Phase 3 — Knowledge cache + sync + learning signal
- **Objective:** OpenClaw canonical for profile + website skills; extension is a cache;
  the brain learns from graded runs.
- **Stage 1 — DONE** (`1c8f7119`): the pure last-writer-wins sync engine
  (`utils/knowledge-sync.ts`) — `SyncedItem`/`SyncMap`/`KnowledgeStore`, `reconcile`
  (merged + push/pull sets, tombstones), `liveValues`/`stamp`/`tombstone`. 8 tests.
- **Stage 2 — remaining:** wrap `utils/personal-profile.ts` and `utils/website-skills.ts`
  as read-through caches over the OpenClaw `KnowledgeStore` (hydrate on connect,
  write-through when present, local-only + reconcile when absent). Sensitive items stay
  encrypted end-to-end. Needs the daemon + edits live storage paths.
- **Learning loop (head-start from LP-7):** the long-dead site-learning loop now has a
  real signal — OpenSidebar already exports **OpenClaw-format graded `(state, action,
  reward)` trajectories** (`scripts/obs/export-trajectories.ts`). Feed these to the brain
  so site facts/skills are *derived from graded outcomes* rather than re-extracted from
  scratch. The grading rubric is the contract; the brain owns retention + retrieval.
- **DoD:** kill the daemon mid-session → extension still personalizes from cache; edit
  profile in browser and via OpenClaw → reconciliation is deterministic; a graded
  trajectory updates a site skill that improves a repeat run; existing
  `tests/e2e/profile-*.test.ts` stay green.

### Phase 4 — Hybrid LLM routing
- **Objective:** strategic plans get OpenClaw memory; the hot loop stays fast.
- **Core — DONE** (`b3068d14`): `utils/llm-routing.ts` — `resolveLlmRoute` (executor
  always direct; planner prefers gateway) + `routePlannerCompletion` (gateway when
  present+healthy, graceful fallback to direct on absence OR error). 7 tests.
- **Stage 2 — remaining:** wire it into `TaskPlanner` / the planner pool in
  `background/llm/client.ts`; implement the `PlannerGateway` over OpenClaw. Needs the
  daemon.
- **DoD:** with daemon up, planner prompts carry OpenClaw memory; with daemon down,
  planner falls back and tasks still run; executor latency unchanged.

### Phase 5 — Opinionated in-repo OpenClaw backend
- **Objective:** one-command, batteries-included setup.
- **Scaffold — DONE** (`a3894b56`): `openclaw/` (not `backend/`, to avoid colliding
  with `apps/backend`) — `openclaw.config.yaml` (loopback bind; browser/exec off;
  registers the M2 MCP host), `SOUL.md`, `skills/opensidebar.md`, `install.sh`, README.
  Bakes the loopback-only invariant.
- **Remaining:** validate the exact OpenClaw config schema / CLI flags against the
  installed release; end-to-end `install.sh` run. Needs OpenClaw present.
- **DoD:** `install.sh` brings up a loopback OpenClaw pre-wired to the extension,
  prompting only for an API key + optional channel; defaults enforce the invariants.

### Phase 6 — Queue migration (deferred, post-v1)
- **Objective:** retire the duplicate task store.
- **Key work:** fold the live task-run SQLite durability (`apps/backend` library on
  7589) into OpenClaw's job queue. Repeats a known consolidation (standalone server →
  in-process library); carries resume-correctness risk, hence deferred.
- **Align to the span spine (RFC LP-7):** the durable trajectory record should target the
  canonical span-spine / RL-trajectory shape, **not** the legacy flat
  `trajectory_json: string[]` in `apps/backend/src/db.ts` (which LP-7 already supersedes).
  Migrate the queue and the trajectory store together so OpenClaw consumes one shape.
- **DoD:** task history/queue is canonical in OpenClaw in span-spine shape; the extension
  keeps only in-flight resume; resume-after-SW-death still works offline; no data loss on
  migrate.

### Phase 7 — Remote / AWS (deferred, additive)
- **Objective:** always-on scheduling, webhooks, messaging without a running laptop.
- **Key work:** move the OpenClaw Gateway to AWS; native host + extension stay local;
  reach back via Tailscale/Cloudflare Tunnel. (`apps/backend/src/server.ts`, the dead
  7590 HTTP skeleton, is the natural reuse point here.)
- **DoD:** remote Gateway drives the local browser over the tunnel; knowledge memory
  remains loopback/local-only (never persisted server-side); messaging channels live.

---

## Success metrics (whole initiative)

- **Statelessness gone:** repeat tasks on a known site reuse learned facts (measurable
  drop in turns / errors vs. cold).
- **Continuity:** a fact entered via one channel is used by another within one task.
- **Zero standalone regression:** all existing e2e suites pass with the daemon off.
- **Privacy:** no sensitive item reaches a provider without explicit consent (test-enforced);
  sensitive data encrypted at rest.
- **Footprint:** exactly one canonical home for profile, skills, facts, and the queue.

## Remaining loose ends (track to closure)

- Two stray GBrain mentions in RFCs `lp-0005`, `lp-0006` (forward-looking prose).
- Decide whether to keep `apps/backend/src/server.ts` (recommended: keep for Phase 7).
