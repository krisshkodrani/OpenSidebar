# Changelog

All notable changes to OpenSidebar will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added a release preflight command to validate generated artifact version, commit, hash, and publication readiness before tagging.

### Changed

- Synchronized the extension manifest version with the workspace package version for the OSS BYOK preview candidate.
- Updated the extension manifest description to describe multi-provider BYOK instead of OpenRouter-only setup.
- Documented the current permission, browser-data, and local-development API security posture.
- Added a public known-limitations page for the OSS BYOK preview.

### Fixed

- Hardened local backend/log-server origin handling so arbitrary browser origins are rejected.
- Restricted the E2E overlay bridge with per-mount bridge tokens, storage limits, and credential-key filtering.
- Reclassified cookies and browser history tools as high-risk actions.
- Blocked `execute_js` from reading page cookies/storage or making page-context network requests.
- Removed the unused vulnerable `uuid` dependency.

## [0.9.1 Release Checkpoint] - 2026-05-07

### Changed

- Promoted the completed runtime-boundary conclusions into stable architecture docs.
- Documented the shared side panel runtime port, overlay harness, and background environment port boundaries.
- Updated the WorkArena roadmap so the next checkpoint starts from staged E2E and guarded ServiceNow validation.

### Verified

- Full staged OpenSidebar E2E checkpoint passed when run in smaller chunks after the staged wrapper exceeded the tool timeout.
- WorkArena doctor reported ready, and the guarded ServiceNow `all-menu` seed `0` smoke passed with validation score `1`.
- Extension manifest bumped to `0.3.1`; workspace package bumped to `0.9.1`.

## [0.3.0 Demo Checkpoint] - 2026-05-05

### Added

- Local backend service for memory and scheduled task support
- Shared prompt runtime package and shared type package to support the staged repo split
- Release checklist documenting release verification, E2E smoke validation, and artifact checks

### Changed

- Reorganized the repository into `apps/extension`, `apps/backend`, and `packages/*`
- Preserved root developer commands while localizing app-specific Vite, Vitest, and TypeScript config
- CI now aligns with the current repo layout by running lint, extension tests, backend tests, and build

### Fixed

- Scheduled tasks now wait for real orchestrator completion before being marked finished
- Site knowledge metadata now round-trips through backend memory storage
- Trace viewer backend memory details no longer show stale content under the wrong expanded row

## [0.5.0] - 2026-02-25

### Changed

- Migrated from Bun to npm + tsx + Vitest for the standard Node.js toolchain
- `npm run dev` now runs the full dev stack (Vite HMR + log server + trace viewer)

### Removed

- Bun dependency and bun-types

## [0.4.0] - 2026-02-21

### Added

- Perception layer replacing raw DOM text and take_screenshot tool
- Vision-based page understanding via Groq Llama 4 Scout → GPT-4o-mini fallback
- Fingerprint-based caching for perception calls
- Structured perception output for page location, changes, blockers, visual-only evidence, and affordances

### Removed

- `vision.ts` module (replaced by `perception.ts`)
- `take_screenshot` tool (perception layer handles visual understanding automatically)

## [0.3.0] - 2026-02-16

### Added

- Orchestrator pipeline with planner → executor → verifier lanes
- Skills system (teach mode, learned skill replay, pin/enable controls)
- Demo recording and replay
- Saved prompts and prompt management
- React Toolkit (4 on-demand tools: inspect_react, react_set_input, inspect_react_tree, wait_for_react)
- Voice input via Browser Speech API and Groq Whisper
- Trace viewer UI (React-based, served at http://127.0.0.1:7589/viewer)
- Planner evaluation pipeline
- 5 new tools: dismiss_overlays, close_popups, batch_execute, recall_demo, and memory tools (update, delete, list_categories)
- Prompt registry with versioned, parameterized prompts

## [0.2.0] - 2026-02-12

### Added

- Tri-provider failover: Cerebras → Groq → OpenRouter for both fast and smart tiers
- Two-tier LLM architecture with independent provider pools
- GLM-4.7 as the smart model with native reasoning (replacing Kimi Swarm)
- Cerebras API key support for fastest inference (~3000 TPS)
- Context distillation on escalation (summarizeTrajectory)
- Session metrics with per-model cost attribution
- Stable hash-based element IDs (FNV-1a)
- Expanded tool count from 16 to 48+ tools

### Changed

- Replaced bimodal (fast/deep) with unified two-tier (fast/smart) architecture

## [0.1.0] - 2026-02-09

### Added

- Initial release of OpenSidebar
- Browser automation via natural language
- Visual DOM understanding with numeric tagging
- Bimodal AI: Cerebras (fast) + Kimi Swarm (deep research)
- Local memory system (SQLite + Voy + Transformers.js)
- Workspace isolation with Chrome Tab Groups
- Navigation persistence across page loads
- Real-time streaming responses
- Shadow DOM support for modern web apps
- 16 automation tools (click, type, scroll, navigate, etc.)
- Comprehensive test suite (93 tests)
- Full TypeScript implementation
- GitHub Actions CI/CD
