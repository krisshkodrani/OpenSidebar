# Codex browser bridge

OpenSidebar can act as Codex's browser runtime through a local, task-first MCP
server. The MCP process and extension authenticate each other on loopback before
either side accepts a tool frame.

## Windows installation

From the repository root:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm bridge:install
```

The installer:

1. creates a 256-bit local pairing token;
2. writes a user-only config under `%LOCALAPPDATA%\OpenSidebar`;
3. registers the `opensidebar-browser` stdio MCP server with Codex; and
4. prints a `port:token` pairing code.

Open the extension, then go to **Settings → Advanced settings → Codex browser
bridge**, paste the pairing code, and choose **Pair**. Restart Codex so it loads
the new MCP server.

The generated Codex entry uses the supported stdio form:

```text
codex mcp add opensidebar-browser --env BROWSER_MCP_WS_PORT=... --env BROWSER_MCP_AUTH_TOKEN=... -- corepack pnpm --dir <repo> mcp:browser
```

## Verify or remove

```powershell
corepack pnpm bridge:doctor
corepack pnpm bridge:uninstall
```

After uninstalling, choose **Disconnect** in the extension to remove its copy of
the pairing token.

## Security boundaries

- The WebSocket host refuses non-loopback bind addresses.
- A fresh nonce and HMAC-SHA-256 proof authenticate both peers on every
  connection. Requests are ignored until the handshake completes.
- Delegated tasks require an explicit domain allowlist, orchestrator-enforced
  cost/turn/time budgets, mandatory checkpoints, and optional model-role
  restrictions.
- Local files are limited to 10 MB, canonicalized, hashed, transferred only over
  the authenticated loopback channel, held only in memory, and attached only
  after a one-time approval bound to the task, tab, origin, and file-input ID.
- Persisted task history is bounded and redacted; local file paths and bytes are
  never persisted.
