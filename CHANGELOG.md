# Changelog

All notable changes to OpenSidebar will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
