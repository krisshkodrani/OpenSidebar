#!/usr/bin/env bash
# Opinionated OpenClaw backend installer for OpenSidebar (RFC LP-8).
#
# Brings up a loopback OpenClaw — the "brain" — pre-wired to the OpenSidebar
# browser MCP host (the "hands"). Browser in/out via WebChat; no Telegram needed.
#
# Commands/flags below target the real OpenClaw CLI (docs.openclaw.ai). Run
# `openclaw doctor` afterward and adjust for your installed version if needed.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
WORKSPACE="$OPENCLAW_HOME/workspace"
FILE_WORKSPACE="${OPENSIDEBAR_WORKSPACE:-$HOME/opensidebar-workspace}"
FORCE="${1:-}"

echo "[openclaw-install] repo:           $REPO_DIR"
echo "[openclaw-install] openclaw home:  $OPENCLAW_HOME"
echo "[openclaw-install] workspace:      $WORKSPACE"
echo "[openclaw-install] file workspace: $FILE_WORKSPACE"

# 1. Install OpenClaw (Node 24 recommended, or 22.19+). Skip if already present.
if ! command -v openclaw >/dev/null 2>&1; then
  echo "[openclaw-install] installing openclaw…"
  npm install -g openclaw@latest
else
  echo "[openclaw-install] openclaw already installed: $(command -v openclaw)"
fi

# 2. Lay down the opinionated config + workspace (AGENTS/SOUL/TOOLS/PROFILE +
#    skills). Never overwrite an existing file unless called with --force.
mkdir -p "$WORKSPACE/skills/opensidebar" "$FILE_WORKSPACE"
copy() { # copy() SRC DST
  if [[ -e "$2" && "$FORCE" != "--force" ]]; then echo "  keep  $2 (exists)";
  else mkdir -p "$(dirname "$2")"; cp "$1" "$2"; echo "  write $2"; fi
}
copy "$REPO_DIR/openclaw/openclaw.json"                       "$OPENCLAW_HOME/openclaw.json"
copy "$REPO_DIR/openclaw/workspace/AGENTS.md"                 "$WORKSPACE/AGENTS.md"
copy "$REPO_DIR/openclaw/workspace/SOUL.md"                   "$WORKSPACE/SOUL.md"
copy "$REPO_DIR/openclaw/workspace/TOOLS.md"                  "$WORKSPACE/TOOLS.md"
copy "$REPO_DIR/openclaw/workspace/PROFILE.md"                "$WORKSPACE/PROFILE.md"
copy "$REPO_DIR/openclaw/workspace/skills/opensidebar/SKILL.md" "$WORKSPACE/skills/opensidebar/SKILL.md"

# 3. Validate the config against the installed OpenClaw schema (it refuses to
#    start on unknown keys).
echo "[openclaw-install] validating config…"
openclaw config validate || {
  echo "[openclaw-install] config validation failed — reconcile openclaw.json with your OpenClaw version." >&2
  exit 1
}

# 4. Onboard (prompts for a model API key + optional channels) and install the
#    gateway daemon.
echo "[openclaw-install] running onboarding…"
openclaw onboard --install-daemon || {
  echo "[openclaw-install] onboarding command differs in your OpenClaw version — run 'openclaw onboard' manually." >&2
}

cat <<EOF

[openclaw-install] done.

Next:
  1. Start the OpenSidebar browser host (the hands), exposing MCP over http :8788
     and the extension WebSocket on :8787:
       BROWSER_MCP_HTTP_PORT=8788 BROWSER_MCP_WS_PORT=8787 pnpm run mcp:browser
  2. Start the brain:
       openclaw gateway start
       openclaw doctor          # verify
  3. Load the OpenSidebar extension in Chrome and set in its chrome.storage.local:
       opensidebar:browserMcpWsPort = 8787
  4. Chat in/out from the browser at  http://127.0.0.1:18789  (WebChat).

Or skip 1–2 with Docker:  docker compose up
EOF
