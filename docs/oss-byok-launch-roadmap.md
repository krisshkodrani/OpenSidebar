# OSS BYOK Launch Roadmap

This roadmap defines the documentation and release-readiness work for a broad GitHub-first open-source launch of OpenSidebar as a bring-your-own-key browser agent.

The target is a public source release with manual unpacked Chrome installation and a GitHub release artifact. Chrome Web Store submission is a later distribution path, not the first launch gate.

## Launch Goal

A new user should be able to:

- understand what OpenSidebar does and what it does not promise;
- audit where page data, screenshots, logs, and API keys go;
- clone the repo, install dependencies, build `dist/`, and load the unpacked extension;
- configure at least one supported BYOK provider;
- run a safe first task and stop the agent if needed;
- report a useful bug or contribute a focused change.

## Positioning

OpenSidebar is an open-source Chrome extension that runs an AI browser agent from the side panel. The agent can inspect pages, call structured browser tools, verify progress, and record local traces for debugging.

Public launch messaging should emphasize:

- open-source and auditable;
- BYOK provider accounts, with no OpenSidebar-hosted relay;
- local-first traces and settings;
- configurable safety gates for plans and high-risk actions;
- agent behavior is useful but not guaranteed, so users should supervise sensitive tasks.

Avoid claiming:

- production-grade automation on every website;
- passive browsing monitoring;
- hidden hosted telemetry or server-side task execution;
- benchmark-perfect behavior as the product goal.

## Provider Matrix

Keep this table aligned with `UserSettings["providerMode"]` and the Settings UI.

| Provider mode | Required key(s) | Role | Launch status | Notes |
| --- | --- | --- | --- | --- |
| `fireworks` | `FIREWORKS_API_KEY` / Fireworks key in Settings | Executor and planner | Recommended default | Current docs and E2E default use Fireworks. |
| `fireworks-deepseek` | Fireworks + `DEEPSEEK_API_KEY` | Fireworks executor, DeepSeek planner/verifier | Advanced | Requires two configured keys. |
| `openrouter` | `OPENROUTER_API_KEY` / OpenRouter key in Settings | Executor and planner | Supported | Public BYOK option; model availability depends on OpenRouter. |
| `openrouter-groq` | OpenRouter + Groq key | OpenRouter executor, Groq planner | Advanced | Requires clear setup docs before advertising broadly. |
| `openai-groq` | OpenAI-compatible key + Groq key | OpenAI-compatible executor, Groq planner | Advanced | Keep documented as advanced unless the setup path is polished. |
| `moonshot` | `KIMI_API_KEY` | Executor and planner | Supported | Direct Moonshot/Kimi provider mode. |
| `xiaomi` | `XIAOMI_API_KEY` | Executor and planner | Supported for agent traffic | Xiaomi MiMo support is scoped to the agent provider stack. |

Launch docs should state that provider behavior, pricing, quotas, retention, and rate limits are governed by the selected provider.

## Phase P0: Trust And Installability

Exit criteria:

- README and Getting Started both require Node.js `>=22`.
- README, Privacy Policy, Security Policy, and Store Listing do not contradict the safety posture.
- Manifest, package version, changelog, and release notes have a single intended launch version before tagging.
- Manifest description says multi-provider BYOK rather than OpenRouter-only BYOK.
- Privacy Policy links point to the active repository.
- Permission explanations cover broad host access, tabs, cookies, history, downloads, and screenshots/tab capture.
- First-run setup explains how to add a provider key and run a safe first task.

Current alignment controls:

- `package.json` and `apps/extension/manifest.json` must advertise the same version before tagging.
- `pnpm run ci:dist` checks that the built `dist/manifest.json` version matches `package.json`.
- `apps/extension/manifest.json` should describe multi-provider BYOK rather than a single provider-specific setup path.

## Phase P1: BYOK Clarity

Exit criteria:

- Provider matrix is visible from README or Getting Started.
- Settings docs explain provider modes, required keys, and which modes need multiple keys.
- Docs clearly say page context and screenshots may be sent to the selected model provider when a task needs them.
- Docs clearly say the local log server and trace viewer are development/local-only tools.
- Provider failure expectations are documented: invalid key, quota exhausted, rate limit, model unavailable, and provider outage.

## Phase P2: Contributor Readiness

Exit criteria:

- `CONTRIBUTING.md` names the current command set and expected validation loop.
- Bug report template asks for provider mode, model, Chrome version, task prompt, trace/report availability, and whether sensitive data has been redacted.
- Security Policy names supported branches/releases and where to report security issues.
- Documentation index links to the launch roadmap, provider setup, privacy policy, security policy, and release checklist.

## Phase P3: Public Proof

Exit criteria:

- A fresh clone can run `corepack enable`, `corepack pnpm install`, `corepack pnpm run dist`, and load `dist/` in Chrome.
- At least one recommended BYOK provider completes a safe first-task smoke.
- `pnpm run release:verify` passes on the launch candidate.
- A real-browser smoke run is recorded for the launch candidate when runtime behavior changed.
- A GitHub release has a tag, changelog entry, `corepack pnpm run release:package` zip/checksum, `corepack pnpm run release:preflight` evidence, and known limitations.
- Screenshots or a short demo show the side panel, settings/provider setup, a completed task, and the trace viewer.

## GitHub Launch Definition Of Done

The launch candidate is ready when:

- public docs are internally consistent;
- supported provider modes are documented with required keys;
- safety posture is configurable confirmation behavior;
- privacy and permission claims match the extension manifest and runtime behavior;
- install and first-task instructions work from a fresh clone;
- contribution and bug-report paths are usable by someone outside the project;
- release artifacts can be reproduced and preflighted from checked-in commands.
