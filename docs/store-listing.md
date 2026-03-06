# Chrome Web Store Listing — OpenSidebar

Copy-paste reference for the Chrome Web Store developer dashboard.

---

## Short description (132 char max)

```
Open-source AI browser agent. Navigate, click, type, and automate web tasks from a side panel. BYOK via OpenRouter. No subscription.
```

## Full description

```
OpenSidebar — Open Source AI Browser Agent

An open-source Chrome extension that turns your browser into an AI-powered agent workspace. Navigate, read, click, type, and automate across web pages — all through natural conversation in the side panel. Bring your own API key via OpenRouter. No subscription required.

WHAT IT DOES

Chat with the AI agent in the sidebar while browsing any website. Describe what you want in plain language and the agent handles the rest — reading pages, clicking buttons, filling forms, and running multi-step workflows across tabs.

- Navigate and interact with any website via natural language
- Fill forms and handle repetitive data entry
- Extract information from web content
- Run multi-step processes across multiple tabs
- Record common workflows and let the agent replay them

SMART AGENT ARCHITECTURE

OpenSidebar uses a two-tier model system that keeps costs low and quality high:

- Executor model (GPT-OSS-120B) handles routine tasks — fast and cheap
- Planner model (DeepSeek V3.2) activates automatically when tasks get complex
- Perception layer (Gemini 2.5 Flash) understands pages visually — layout, modals, dynamic content
- Orchestrator breaks complex tasks into subtasks with a planner → executor → verifier pipeline

The agent detects when it's stuck and automatically escalates to smarter models, pivots strategy, or asks you for guidance — no babysitting required.

35 BROWSER TOOLS

DOM interaction, navigation, tab management, page analysis, and more. The agent chooses the right tools based on your instructions. Vimium-style element tagging ([1], [2], [3]...) gives the AI precise control over page elements.

PLAN BEFORE ACTING

For complex tasks, the agent creates a plan and asks for your approval before executing. Review the steps, add guidance if needed, then let it run. You can pause, resume, or skip steps at any time.

YOU'RE IN CONTROL

- Approve or reject plans before execution
- Pause / resume the agent mid-task
- High-risk actions require explicit approval
- Send real-time feedback to steer the agent while it works
- Stop the agent at any time

OPEN SOURCE & BYOK

- Full source code on GitHub (MIT license)
- Bring your own OpenRouter API key — you control your costs
- No subscription, no account, no cloud dependency beyond the LLM API
- All data stays in your browser's local storage
- No telemetry or analytics

FOR DEVELOPERS

- Built-in trace recording captures every agent session
- Offline eval framework for testing prompt quality
- Trace viewer UI for inspecting agent decisions turn-by-turn
- Extensible tool system — add your own tools

GETTING STARTED

1. Install this extension
2. Click the OpenSidebar icon to open the side panel
3. Open Settings and enter your OpenRouter API key (openrouter.ai)
4. Describe your task and let the agent work

USE SAFELY

Browser AI can encounter prompt injection — hidden instructions on websites that attempt to hijack the agent's actions. We recommend:

- Start with trusted sites
- Review before the agent handles financial or personal tasks
- High-risk actions (navigation, tab creation, downloads) are flagged
- URL sanitization blocks non-http(s) protocols
- Report issues on GitHub

Source code: https://github.com/OpenSidebar/OpenSidebar
```

---

## Feature comparison vs Claude in Chrome

| Feature | Claude in Chrome | OpenSidebar | Notes |
|---------|:---:|:---:|-------|
| Sidebar chat | ✅ | ✅ | Both have side panel chat |
| Click, type, scroll, navigate | ✅ | ✅ | OS has 35 tools vs Claude's unspecified |
| Form filling | ✅ | ✅ | |
| Data extraction | ✅ | ✅ | OS: read_page, find_element, execute_js |
| Multi-tab workflows | ✅ | ✅ | OS: auto-managed Chrome Tab Groups |
| Planning mode | ✅ | ✅ | OS: orchestrator with plan confirmation |
| Record workflows | ✅ | ✅ | OS: demo recording + replay |
| Vision/perception | ✅ (implied) | ✅ | OS: Gemini 2.5 Flash perception layer |
| Stagnation detection | ? | ✅ | OS unique: graduated intervention |
| Two-tier model escalation | ? | ✅ | OS unique: executor → planner |
| Trace recording + evals | ❌ | ✅ | OS unique: full offline eval framework |
| BYOK (bring your own key) | ❌ | ✅ | OS: OpenRouter, user controls costs |
| Open source | ❌ | ✅ | MIT license |
| Scheduled tasks | ✅ | ❌ | Claude only |
| Console log reading | ✅ | ❌ | Claude reads errors, DOM state, network |
| Claude Code integration | ✅ | ❌ | Terminal + browser loop |
| Desktop app integration | ✅ | ❌ | Claude Desktop → browser |
| Team/Enterprise controls | ✅ | ❌ | Admin allowlist/blocklist |
| Granular action pre-approval | ✅ | Partial | OS has risk-level approval, not per-action |
| No subscription required | ❌ | ✅ | Claude requires paid plan |
| Prompt injection warnings | ✅ | ✅ | Both acknowledge the risk |

### What we CAN'T claim (Claude has, we don't)

1. **Scheduled tasks** — no cron/recurring automation
2. **Console log / network request reading** — agent only sees DOM + screenshots
3. **IDE integration** — no Claude Code equivalent
4. **Desktop app control** — no desktop companion
5. **Enterprise admin controls** — no org-wide policies

### What we CAN claim (we have, Claude doesn't)

1. **Open source** (MIT) — full transparency, fork-friendly
2. **BYOK** — user controls their API spend via OpenRouter
3. **Two-tier model escalation** — cheap model for routine, smart model for hard tasks
4. **Trace recording + offline evals** — built-in quality framework
5. **No subscription** — free to use with your own API key
6. **Perception layer** — automatic vision-based page understanding every turn

---

## Tone / positioning notes

The description is honest about what OpenSidebar IS without claiming what it ISN'T. It competes on architecture (in-browser, BYOK, open source) rather than trying to match Claude's proprietary features.

Key positioning differences from Claude's description:
- Claude leads with "paid subscribers" → we lead with "open source, no subscription"
- Claude leads with integrations (Code, Desktop) → we lead with transparency and cost control
- Claude has "scheduled tasks" → we have "trace recording + evals" (developer-facing)
- Claude has enterprise controls → we have MIT license + fork-friendly
