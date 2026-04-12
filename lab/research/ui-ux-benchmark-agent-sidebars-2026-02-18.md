# OpenSidebar UI/UX Research: Agent Sidebar + Settings

Date: 2026-02-18  
Scope: Sidepanel chat UI, run-state surfaces, tool transparency, settings information architecture, safety/privacy controls.

## 1) Benchmark Set (Current Market)

Compared against current public docs for major computer-use products:

- OpenAI ChatGPT agent / Operator integration
  - https://openai.com/index/introducing-operator/
  - https://help.openai.com/id-id/articles/11752874-agen-chatgpt
  - https://openai.com/policies/using-chatgpt-agent-in-line-with-our-policies/
- Anthropic Claude computer use tool
  - https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/computer-use-tool
- Perplexity Comet Assistant
  - https://comet-help.perplexity.ai/en/articles/11734688-assistant-panel
  - https://comet-help.perplexity.ai/en/articles/12658082-control-what-comet-assistant-can-use
  - https://comet-help.perplexity.ai/en/articles/12867415-comet-assistant-privacy-data-use
- Skyvern (automation + observability)
  - https://docs-new.skyvern.com/getting-started/quickstart
  - https://docs.skyvern.com/observability/overview

## 2) Cross-Product UX Patterns (What Good Looks Like)

1. Human control at critical points
- Explicit confirmations for high-impact actions.
- Takeover mode for credentials/payment/CAPTCHA.
- Sensitive-site supervision mode (watch mode).

2. Progressive disclosure for complexity
- Assistant-first simple view.
- Advanced traces/details behind expandable controls.
- Power features visible only when relevant.

3. Strong privacy controls in settings
- Clear toggles for what context agent can access.
- Site-level blocklists for agent actions.
- One-click data cleanup and clear retention explanations.

4. Lightweight, high-signal run status
- Compact run strip with state and progress.
- Actionable prompts only when user decision needed.
- Avoid multiple competing banners.

5. Debuggability for power users
- Session replay/trace visibility.
- Structured logs and event timelines.
- But debug surfaces are secondary, not always-on.

## 3) Current OpenSidebar UI Review

Reviewed files:
- `src/sidepanel/App.tsx`
- `src/sidepanel/components/Header.tsx`
- `src/sidepanel/components/StatusBar.tsx`
- `src/sidepanel/components/ArchitectureStrip.tsx`
- `src/sidepanel/components/ControlBar.tsx`
- `src/sidepanel/components/MessageBubble.tsx`
- `src/sidepanel/components/StepTimeline.tsx`
- `src/sidepanel/components/ToolCallBadge.tsx`
- `src/sidepanel/components/SettingsDrawer.tsx`
- `src/sidepanel/components/InputArea.tsx`

Key issues:

1. Too many simultaneous status surfaces
- Top stack can show multiple banners plus `OrchestratorConsole` + `PlanBoard`.
- Header also shows both `StatusBar` and `ArchitectureStrip`.
- Bottom shows `ControlBar` and metrics.
- Net effect: fragmented attention and visual noise.

2. Message rows are over-instrumented by default
- Timeline + tool badges + completion summary all rendered inline.
- Great for debugging, but too dense for normal task execution.

3. Debug detail has same visual weight as primary conversation
- Tool cards are strongly styled (cards, borders, iconography) and repeated.
- This competes with the assistant�s actual answer.

4. Settings IA is flat and long
- Current drawer mixes frequent, advanced, dangerous, and enterprise-style controls in one scroll.
- High cognitive load, weak discoverability for novice users.

5. Safety/privacy controls exist, but need stronger grouping and copy hierarchy
- Good controls are present (`bypassApprovals`, tool restrictions, metrics).
- Missing explicit site blocklist and clearer �risk level� grouping UX.

## 4) Recommendations (Prioritized)

### P0 (highest impact, low-medium effort)

1. Create one unified Run Status Strip
- Replace redundant status surfaces with a single compact strip.
- Show: state, turn count, provider, pause/resume, and only one active warning.
- Keep escalations/approvals as interruptive cards only when needed.

2. Default to simple transcript mode
- In `MessageBubble`, show assistant text first.
- Move `StepTimeline` and `ToolCallBadge` under a single "Details" expander.
- Persist user preference: "Always show details" (off by default).

3. Split settings into Basic vs Advanced
- Basic tab: API key, model/provider strategy, safety defaults, theme.
- Advanced tab: budgets, tool restrictions, debugging, replay, dry-run options.

4. Safety block in settings
- Group all high-risk controls together with warning style.
- Add clearer labels:
  - "Require approval for high-risk actions" (default on)
  - "Bypass approvals" as destructive/advanced toggle.

### P1 (important)

1. Privacy & data section modeled after best-in-class tools
- Add clear context access controls and retention copy.
- Add site/domain denylist for agent actions and context ingestion.
- Add one-click "Clear session/browser agent data" action.

2. Reduce header density
- Keep either `StatusBar` or `ArchitectureStrip` by default.
- Move architecture lanes behind a small "System" disclosure.

3. Improve tool transparency UX
- Replace per-tool cards with compact table rows by default.
- Open full input/output payload only on click.

### P2 (polish)

1. UX presets
- "Focus mode": minimal UI, no debug cards.
- "Builder mode": full telemetry and traces.

2. Onboarding for critical controls
- First-run prompts for approvals, screenshots, and privacy behavior.

## 5) Proposed Settings Information Architecture

- General
- Agent
- Privacy & Security
- Integrations
- Appearance
- Advanced

Suggested mapping:

- General: theme, language, voice, saved prompts behavior.
- Agent: max turns, provider strategy, token budget.
- Privacy & Security: approvals, site blocklist, data retention, clear-data.
- Integrations: OpenRouter API key, app connectors.
- Appearance: compact mode, detail defaults, metrics visibility.
- Advanced: replay, dry-run, orchestration internals, debug exports.

## 6) UX Acceptance Metrics

Track before/after:

- Time-to-first-action from opening sidebar.
- Task completion rate.
- Mid-run user interruptions (manual stop/pause rate).
- Settings error rate (misconfigured dangerous toggles).
- Subjective clutter score (1-5) from user tests.

## 7) Concrete Next Iteration (Design + Build)

Week 1 implementation target:

1. Build unified run strip and hide redundant surfaces by default.
2. Add "Details" disclosure in messages for timeline/tools.
3. Refactor settings into Basic/Advanced tabs.
4. Add Safety section with clearer labels and destructive styling.
5. Add Privacy section with site blocklist scaffold and clear-data action.

This preserves OpenSidebar's power-user diagnostics while making default UX significantly cleaner for everyday use.
