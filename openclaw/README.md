# OpenClaw backend for OpenSidebar (RFC LP-8)

Turns OpenSidebar into a two-tier agent: **OpenClaw the brain** (memory, planning,
scheduling, chat) + **OpenSidebar the hands** (your real, authenticated browser),
bridged by the browser MCP host (`scripts/browser-mcp/`).

You drive it **from the browser, in and out** — OpenClaw's WebChat at
`http://127.0.0.1:18789`. No Telegram or other channel is required (you can add
one later for phone/async access to the same agent).

## Contents

| Path | Purpose |
| --- | --- |
| `openclaw.json` | Real OpenClaw config (JSON5): loopback gateway :18789, model, WebChat, and the `opensidebar` MCP server. For a **native** install. |
| `openclaw.docker.json` | Same config for Docker — MCP url points at the `browser-mcp` compose service. Mounted into the container. |
| `workspace/AGENTS.md` `SOUL.md` `TOOLS.md` | Injected into every session: operating instructions, persona/guardrails, and the browser tool reference. |
| `workspace/PROFILE.md` | **Canonical** personalization profile the brain reads. Sensitive values stay encrypted in the extension, never here. |
| `workspace/skills/opensidebar/SKILL.md` | When/how to call the thick browser tools and handle `needs_human`. |
| `install.sh` | Native one-command setup: install OpenClaw, lay down config + workspace, validate, onboard. |
| `adapter/` | Offline stub gateway for tests/dev (see "Standalone / offline"). Not the real brain. |

## How it connects

```
You ──WebChat (http://127.0.0.1:18789)──▶ OpenClaw (brain)
                                              │  mcp.servers.opensidebar
                                              │  → streamable-http :8788
                                              ▼
                                  browser-mcp host ──WebSocket :8787──▶ Chrome extension
                                                                        (your authenticated session)
```

OpenClaw is the MCP **client**; it calls OpenSidebar's thick browser tools for
anything on a logged-in / bot-protected / live page, and uses its own built-in
browser for nothing authenticated (per `SOUL.md`).

## Quick start — Docker (recommended)

```bash
echo "ANTHROPIC_API_KEY=sk-ant-…" > .env     # repo root, next to docker-compose.yml
docker compose up                             # openclaw + browser-mcp + viewer
```

Then load the OpenSidebar extension in Chrome and set, in its
`chrome.storage.local`: `opensidebar:browserMcpWsPort = 8787`. Chat at
`http://127.0.0.1:18789`.

## Quick start — native

```bash
bash openclaw/install.sh          # add --force to overwrite existing config
# in another terminal: start the hands
BROWSER_MCP_HTTP_PORT=8788 BROWSER_MCP_WS_PORT=8787 pnpm run mcp:browser
openclaw gateway start            # start the brain
openclaw doctor                   # verify
```

## Personalization

`workspace/PROFILE.md` is the canonical profile — edit it, or let OpenSidebar
project its non-sensitive profile digest into it. **Sensitive** fields (IDs,
license numbers, secrets) never enter this workspace or OpenClaw storage; they
stay AES-GCM-encrypted in the extension and are injected into a single tool call
only with your per-task consent.

## Invariants (non-negotiable)

- **Loopback-only knowledge memory.** The gateway binds to loopback; the profile
  never leaves the machine. Even after moving the gateway to a VPS, it's reached
  over a tunnel and never persisted server-side.
- **OpenSidebar owns the browser.** All authenticated/live web work routes through
  the `opensidebar` MCP tools so it uses your real session.
- **Standalone still works.** This backend is additive — the extension keeps
  working without OpenClaw (it falls back to a local cache).

## Standalone / offline (stub adapter)

The `adapter/` is a dependency-free in-memory gateway implementing the *legacy*
LP-8 client contract (`/api/planner`, `/api/knowledge`). It is **not** the real
OpenClaw and the real gateway does not serve those paths — it exists only to
exercise the extension's hybrid/knowledge paths without a daemon:

```bash
docker compose --profile dev up browser-mcp viewer openclaw-adapter
```

## Status / caveat

The native MCP transport, config shape, and browser tool surface follow the real
OpenClaw docs (docs.openclaw.ai) and the streamable-http bridge is validated. The
**Docker image entrypoint + onboarding** behaviour of `ghcr.io/openclaw/openclaw`
should be confirmed against the version you pin — run `openclaw doctor` /
`openclaw config validate` and adjust `openclaw.json` if your release differs.
