# Changelog

All notable changes to OpenSidebar will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
