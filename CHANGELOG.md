# Changelog

All notable changes to OpenSidebar will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
