# Opinionated OpenClaw backend (RFC LP-8, M5)

The batteries-included OpenClaw configuration that turns OpenSidebar into a
two-tier agent: **OpenClaw the brain** (memory, scheduling, messaging channels)
+ **OpenSidebar the hands** (a real authenticated browser), bridged by the MCP
browser host (`scripts/browser-mcp/`, RFC LP-8 M2).

## Contents

| File | Purpose |
| --- | --- |
| `openclaw.config.yaml` | Loopback gateway; browser/exec tools off (OpenSidebar owns the browser); scoped fs; models; registers the `opensidebar` MCP server. |
| `SOUL.md` | Agent personality + guardrails (intent-not-clicks, preview before submit, no credential storage, loopback-only profile). |
| `skills/opensidebar.md` | SKILL.md teaching *when/how* to call the thick browser tools and how to handle `needs_human`. |
| `install.sh` | One-command setup: install OpenClaw, lay down this config, onboard. |

## Quick start

```bash
bash openclaw/install.sh        # add --force to overwrite an existing config
```

Then set your model API key and run `openclaw start`. Optionally add a Telegram
(or other) channel for mobile/async use.

## Invariants (non-negotiable)

- **Loopback-only knowledge memory.** The gateway binds to loopback; the personal
  profile / knowledge store never leaves the machine — even after the gateway
  moves to a VPS (M7), it's reached over a tunnel and never persisted server-side.
- **OpenSidebar owns the browser.** OpenClaw's built-in browser/Playwright is
  disabled; all web work routes through the `opensidebar` MCP tools so it uses the
  user's authenticated session.
- **Standalone still works.** This backend is additive — the extension keeps
  working without OpenClaw running (it falls back to a local cache).

## Gateway HTTP contract (OpenSidebar → OpenClaw)

The extension's OpenClaw client (`apps/extension/src/utils/openclaw-client.ts`)
expects the loopback gateway (or a thin adapter shipped here) to serve:

| Method + path | Body | Returns | Used by |
| --- | --- | --- | --- |
| `GET /health` | — | `200` when up | gateway availability probe (M4) |
| `POST /api/planner` | `{ query, context? }` | `{ content, injectedContext? }` | hybrid planner routing (M4) |
| `GET /api/knowledge/{namespace}` | — | `SyncMap` | knowledge pull (M3) |
| `PUT /api/knowledge/{namespace}` | `{ items: SyncMap }` | `200` | knowledge push (M3) |

`SyncMap` is `Record<string, { value, updatedAt, deleted? }>` (last-writer-wins).
OpenSidebar *defines* this contract; OpenClaw (or this adapter) conforms to it.

## Status / caveat

This is the **opinionated scaffold** from the integration spec. The exact OpenClaw
config keys, CLI flags, and onboarding command should be **validated against your
installed OpenClaw version** and adjusted as needed. The wiring of the extension
side (the WebSocket transport + the AgentLoop handler the MCP host calls) is
RFC LP-8 M2 Stage 2.
