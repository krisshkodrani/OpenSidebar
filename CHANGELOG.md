# Changelog

All notable changes to OpenSidebar will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.1] - 2026-07-29

### Fixed

- **The composer keeps a valid caret through run-state transitions.** Switching
  between active and idle task states no longer leaves the content-editable
  input with a stale selection or inserts new text at the wrong position.
- **Workspace grouping now follows the complete tab lifecycle.** New and spawned
  tabs are adopted into the correct workspace group, group appearance is kept
  in sync, and reopen/cleanup paths no longer leave grouping state behind.
- **DOMPurify is updated to the patched `3.4.12` release.** The obsolete
  `@types/dompurify` stub is removed because DOMPurify ships its own types.

### Changed

- **Release material now has one customer story and one developer story.** The
  website, repository overview, Chrome Web Store copy, screenshots, and narrated
  films are split by audience. Store assets show only the shipping extension;
  trace and observability material stays in the developer path.
- **The canonical customer and developer films use a British female voice.**
  Their timed narration specs and reproducible site/store staging are maintained
  in the repository.

## [0.6.0] - 2026-07-22

### Fixed

- **Fireworks GPT-OSS 120B is selectable again.** The curated Fireworks model
  list offered the catalog-style `openai/gpt-oss-120b` id, which 404s on the
  Fireworks endpoint — picking it for a planner or writer seat silently broke
  every call for that seat. The list now offers the `accounts/…` API id, and a
  settings migration repairs the id already stored for affected users (only on
  Fireworks-served provider modes — the same id is the correct one on Groq and
  OpenRouter). Groq's GPT-OSS 20B also gained its missing pricing row, so runs
  on it are no longer costed as free.
- **Fireworks cached-input rates and the GLM 5.2 seat price are corrected**, so
  run-cost accounting reflects what providers actually charge — cached input is
  no longer priced at the full uncached rate.
- **Tool-call pairing is enforced positionally, not by set membership.** A turn
  that emitted the same tool call twice could pair the results ambiguously; the
  agent now matches each call to its result by position, so duplicate calls in a
  turn resolve to the correct results.
- **JobAgent reference console live-run records persist**, and a missing trace
  sink is now surfaced instead of silently dropping the run's trace. (Reference
  workflow — see the agent-backend bridge note under Added.)

### Changed

- **Completion's rollback flag is gone (RFC LP-15/LP-16 follow-up).** The pure
  pipeline has been the single completion authority since the Phase 7b flip;
  `completionDeterministicAcceptanceEnabled` (never surfaced in settings) and
  the shadow-comparison scaffolding behind it are removed after zero recorded
  divergence across the full trace corpus. Completion decision records bump to
  version 3.
- **ServiceNow record-form and catalog controllers move into the agent-side
  quarantine adapter.** ~1,150 lines leave `agent/loop.ts` for
  `agent/servicenow/`, continuing the LP-15 Phase 12 detachment; `loop.ts` is
  down to ~5.6K lines / 148 methods (from ~10.3K at the start of the LP-16
  decomposition). Behavior-preserving.
- **`RuntimeMessage` is composed of per-domain sub-unions** (session, progress,
  interaction, content-protocol, skills, watch-mode, e2e) under
  `shared-types/src/messages/`, so a consumer can type against just its own
  slice. Existing imports are unaffected. Two dead variants (`SETTINGS_UPDATE`,
  `SPEECH_TRANSCRIPTION_RESULT`) that nothing sent or handled are removed.
- **The decomposition ratchet now guards the whole tree.** Every source file
  under `apps/extension/src` and `packages/` is capped at 1,500 lines, with
  pre-existing larger files grandfathered on shrink-only budgets — so extracting
  code out of a landmine file into a fresh giant no longer passes lint.
- **Prompt-cache stability (RFC LP-21).** Per-turn page state moved out of the
  system message so the cached prefix survives across turns, and the system
  prompt is kept byte-stable for the same reason. Warm-cache hit rate rose from
  ~29.6% to ~43.4% (≈14% lower input cost) with no change to agent behavior.

### Added

- **Optional agent-backend bridge — experimental reference integration.** The
  browser can be exposed as thick tools to an *external* agent runtime over the
  existing default-off loopback WebSocket bridge; a local [pi](https://pi.dev)
  session is the reference driver (`.pi/extensions/opensidebar.ts` registers the
  seven browser tools with their JSON schemas passed through verbatim), and any
  MCP client can connect via `pnpm run mcp:browser`. This is a **reference
  implementation, not a supported end-user feature**: it has no setup UI, is
  enabled only by a hidden `opensidebar:browserMcpWsPort` key, and exists to
  demonstrate the "extension = hands, external runtime = brain" architecture. The
  bridge now actually delivers completions in a real browser (the service-worker
  broadcast never reached in-process subscribers before — proven fixed by a new
  offline e2e), carries the run's `PartialProgressHandoff` on every status,
  supports session-scoped tab reuse (missions sharing a session continue in one
  tab and workspace, with serialized starts), and honors mid-run cancellation via
  a new `{ id, cancel: true }` wire frame. Consequential actions (e.g. a form
  submit) stay hard-gated behind human approval, forwarded over the wire — the
  bridge never bypasses the gate. A `scripts/jobagent/` reference workflow builds
  on this to demonstrate a supervised, human-gated job-application loop (see
  [`scripts/jobagent/README.md`](scripts/jobagent/README.md)); it is likewise a
  reference implementation, not a product feature.
- **Trace-viewer Analytics tab.** The viewer is simplified — the Fleet views are
  retired in favor of a single Analytics tab with escalation fire-rate /
  rescue-rate aggregates, explicit task-outcome classification on
  `task_completed`, completion findings attributed to the authoritative
  decision, and an insights export.

### Removed

- **OpenClaw integration (RFC LP-8 M3–M5).** The `openclaw/` scaffold and stub
  gateway, the planner-gateway routing (`llm-routing.ts`, `openclaw-client.ts`),
  the knowledge-sync layer (`knowledge-sync*.ts`, sync paths in website-skills
  and personal-profile), the dormant bridge `agent-runner.ts`, and the Docker
  services/scripts that ran them. The generic pieces OpenClaw drove — the
  browser MCP host, the WebSocket bridge, the thick tools, and the M1 at-rest
  profile encryption — all remain; pi (or any MCP client) is the brain now.
  The "OpenClaw RL Guidelines" trajectory-grading rubric in the observability
  engine is unrelated and unchanged.

## [0.5.0] - 2026-07-09

Agent-loop decomposition (RFC LP-16, Phase 3 "driver-flip"): the ~2,300-line
`loop()` turn method is now a ~260-line driver over nine focused, individually
tested turn phases (gates, escalation, feedback, prepare-model-turn,
prepare-turn-context, dispatch-tools, post-tool-guards, plan-monitor,
completion) plus the text-response path and an escalation-controller factory.
Turn state moved onto explicit per-run / per-turn scopes; behavior-preserving,
validated end-to-end (full unit suite + staged e2e). The decomposition ratchet
that guards the landmine files is tightened accordingly. Also ships the demo
recording/promo tooling.

## [0.4.0] - 2026-07-07

Verification subsystem + loop decomposition (RFC LP-15, "three consolidations"):
a single completion authority backed by a contract kernel and a model judge,
safer consequential form submits, a provenance-bearing memory store, and the
start of decomposing the agent loop into named phases behind a size ratchet.

### Added

- **Rubric judge + entailment gate (RFC LP-15 Phase 10).** High-risk task
  completions are re-checked by a model judge against known facts before they are
  accepted; a pure, zero-model entailment pre-filter resolves claims the trusted
  corpus already entails so the (paid) judge is skipped on the common path. The
  judge only ever makes completion *stricter* (accept → reroute on a failed or
  contradicted verdict) and fails open to human approval on timeout/error. New
  `judge` model seat (defaults to GLM-5.2).
- **Form-submit dry-run (RFC LP-15 Phase 8).** Before a consequential form
  submit, the agent captures the live field state (`extract_form_state` tool),
  diffs it against the approved draft, and surfaces any unexpected diff at the
  human approval gate — it never bypasses approval.
- **Trusted-corpus store (RFC LP-15 Phase 9).** One provenance-bearing memory
  store unifying personal-profile facts, website skills, and extracted facts,
  each carrying where/when/by-which-model it came from. Shadow-populated from the
  legacy stores this release (website-skill reads flip to it; profile/extracted
  reads follow next release).
- **Loop decomposition ratchet (RFC LP-15 Phase 11).** A checked-in budget
  (`scripts/loop-ratchet.mjs`, wired into lint) that prevents `loop.ts` from
  growing — the agent loop is being decomposed into named turn phases
  (`turn-machine.ts`) incrementally, protected against regression.

### Changed

- **Completion has one authority now (RFC LP-15 Phase 7a/7b).** A deterministic
  contract kernel plus pure, effects-as-data guards replace the legacy inline
  guard chain that decided "is the task done?"; the flip landed behind a
  zero-divergence golden-replay gate.
- ServiceNow trusted-workflow logic moves into an agent-side quarantine adapter
  (`agent/servicenow/`, RFC LP-15 Phase 12), preserving the one-way import rule.
- Escalation state machine and per-turn accumulators extracted from the loop into
  `EscalationTierController` and `TurnState` (RFC LP-15 Phase 6); the
  `prepare_model_turn` and `gates` turn phases moved out of `loop()`.

### Fixed

- **Planner-fallback form plans no longer strand mid-form.** When the planner
  lane times out, the fallback node builder now collapses synthesized
  fill-then-submit plans into one coherent node (and receives real page
  context), fixing runs that filled a form but never submitted it. ServiceNow
  hard submit rejections ("Invalid update") now trigger diagnose-don't-resubmit
  instead of an identical-retry loop.
- ServiceNow instances on custom/vanity domains are recognized by
  domain-independent URL fingerprints, so platform skills activate without a
  `.service-now.com` hostname.
- The built-in trace viewer is served from the dev-surface build again
  (`dist-dev/`); `/viewer` had 404'd since production builds began stripping the
  dev-only viewer from `dist/`.

### Docs

- README restructured around the product story, with two recorded demo collages
  (open web + ServiceNow) embedded, refreshed screenshots, and demo/montage
  tooling committed (`scripts/build-demo-montage.mjs`,
  `scripts/record-trace-viewer-demo.mjs`, `docs/guides/demo-video-style.md`).
- Chrome Web Store submission kit: refreshed listing copy, privacy-tab answers
  (permission justifications + data disclosures), and a store-graphics builder
  (`scripts/build-store-assets.mjs`).

## [0.3.5] - 2026-07-06

Perception overhaul: the agent owns its screenshot pipeline end to end, sees the
page more like a human (magnified regions, closed shadow roots, new-since-last-
turn markers), and defaults to vision-in-the-loop perception where it helps.

### Added

- `inspect_region` tool (RFC LP-13): magnified zoom of a small target region,
  cropped from the raw capture, for reading tiny text and controls.
- New-element marking (RFC LP-10): elements new since the last snapshot are
  flagged so the agent focuses on what changed.
- Closed shadow-root traversal (RFC LP-12 Phase A): perception reaches elements
  inside closed shadow DOM.
- Perception telemetry: per-turn perception-mode counters and structured-turn
  cache-efficacy counters in `SessionMetrics` (RFC LP-11); perception trace
  events promoted to the typed trace registry.
- `E2E_PLANNER_MODEL` override + a perception-default A/B harness for
  planner-seat and perception evals.

### Changed

- **`unified_vl` is now the auto-mode default (RFC LP-11).** The runtime chooses
  vision-in-the-loop perception by default when page/task signals warrant it,
  behind an auto decision. Breaking: default perception behavior changes.
- Executor default is now `kimi-k2p7-code`, behind an executor-eligibility
  policy and a VL-capability gate in the perception mode decision.
- Perception owns screenshot resolution / format / scale (RFC LP-9); zoom crops
  come from the raw capture through a q90 pipeline input.
- Prompt guidance: `inspect_chart`-first, `inspect_region`-for-pixels.

## [0.3.0] - 2026-07-02

Launch-hardening release: escalation rescue, a public benchmark harness, a
unified observability engine, and an experimental OpenClaw "brain" integration
— all additive and default-off where they touch the agent runtime.

### Added

- Escalation rescue ("converge or escalate", RFC LP-2): stuck runs are detected
  and escalated to the planner tier instead of burning turns to `max_turns`.
- Public benchmark adapter (RFC LP-1): Online-Mind2Web task set vendored with a
  runnable harness (`scripts/bench/`), WebJudge scoring, and a benchmark plan.
- Unified observability engine (RFC LP-7): OTel-style span spine as the trace
  source of truth, an agent-callable MCP trace-search server (`pnpm run mcp`),
  and RL-format trajectory export.
- Trace viewer: trajectory scorecard, daily success-rate/cost trend chart on
  the Metrics tab, and a design-system polish pass.
- Experimental OpenClaw integration (RFC LP-8, default-off): browser MCP host
  exposing thick browser tools over loopback WebSocket + streamable-http,
  knowledge sync with a last-writer-wins read-through cache, hybrid planner
  routing through an OpenClaw gateway with graceful fallback, an in-repo
  OpenClaw config scaffold, and a dockerized server stack (`docker compose up`:
  gateway + browser MCP + trace viewer).
- Optional Writer specialist role for free-text composition subtasks.
- Generic cross-tab readiness signal for multi-tab tasks.
- Contributor surface (RFC LP-3): seam map in CONTRIBUTING, issue templates,
  labels, and good-first-issue guidance.
- RFC decision governance: decision stamps validated in `verify`/`release:verify`.
- Model catalog: Kimi K2.7 Code and GLM 5.2 added to the curated Fireworks list.

### Removed

- The local backend service (task-run durability ledger + profile file
  service) is removed entirely. The extension is now fully self-contained:
  tasks recover from in-browser checkpoints across service-worker restarts,
  and end when the browser closes. The `upload_file` tool takes a URL only
  (the backend-served `profileFile: "cv"` alias is gone); Profile Notes in
  extension storage are unaffected.
- Dev/test surface no longer ships in the production build: the trace viewer,
  e2e helper pages, and all localhost log/trace/backend calls are dev-only,
  enforced by a dist check.

### Security & Privacy

- Sensitive profile data is now gated behind explicit per-task consent and
  encrypted at rest (AES-GCM) in extension storage.
- PII redaction at the observability MCP boundary before traces reach agents.
- Removed orphaned profile endpoints (`/profile/resolve`, `/profile/context`).
- Privacy policy expanded to disclose profile-data handling and gating.
- The entire `traces/` runtime data directory is now git-ignored.

### Fixed

- Completion handshake deadlock in the agent loop.
- WebCrypto encryption on ArrayBuffer-backed typed arrays.

## [0.2.3] - 2026-06-05

Initial public release — an open-source, bring-your-own-key Chrome (Manifest V3)
browser agent that perceives, reasons, and acts on the web from a side panel.

### Added

- Autonomous agent loop: perceive → reason → act → verify, driven by natural-language tasks.
- Two-tier model architecture (executor + planner) with automatic escalation and stuck-recovery.
- Orchestration with planner, executor, and verifier lanes for multi-step tasks, plus optional plan confirmation.
- Perception layer with unified vision and structured DOM modes, screenshot understanding, and cross-lingual support.
- Generic browser tools: click, type, scroll, select, tab management, uploads, downloads, page reading, and overlay dismissal.
- Bring-your-own-key provider support (Fireworks, OpenRouter, and direct provider modes); keys stay in local Chrome storage.
- Configurable safety gates: per-tool approval, navigation controls, and high-risk action review.
- Local personalization via Profile Notes + reviewable digest for form and application tasks.
- Optional local backend for long-term memory and durable task scheduling.
- Built-in trace viewer with full-fidelity traces, structured logs, and session metrics.
- Reusable workflow skills and a thin, benchmark-agnostic harness for validation.

### Security & Privacy

- No telemetry or hosted relay; provider traffic goes only to the configured provider.
- `execute_js` and high-risk browser-data tools are guarded and classified for explicit review.

See [Known Limitations](./docs/known-limitations.md) before using on sensitive sites.
