#!/usr/bin/env bash
# Opinionated OpenClaw backend installer for OpenSidebar (RFC LP-8, M5).
#
# Brings up a loopback OpenClaw pre-wired to the OpenSidebar browser MCP host.
# Prompts only for an API key (+ an optional messaging channel).
#
# Validate against your installed OpenClaw version — flag/command names below
# follow the integration spec and may need adjusting to the exact release.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
WORKSPACE="${OPENSIDEBAR_WORKSPACE:-$HOME/opensidebar-workspace}"

echo "[openclaw-install] repo:      $REPO_DIR"
echo "[openclaw-install] home:      $OPENCLAW_HOME"
echo "[openclaw-install] workspace: $WORKSPACE"

# 1. Install OpenClaw (skip if already present).
if ! command -v openclaw >/dev/null 2>&1; then
  echo "[openclaw-install] installing openclaw…"
  npm install -g openclaw@latest
else
  echo "[openclaw-install] openclaw already installed: $(command -v openclaw)"
fi

# 2. Lay down the opinionated config + SOUL + skills (no overwrite without --force).
mkdir -p "$OPENCLAW_HOME/skills" "$WORKSPACE"
copy() { if [[ -e "$2" && "${1:-}" != "--force" ]]; then echo "  keep  $2 (exists)"; else cp "$3" "$4"; echo "  write $4"; fi; }
copy "${1:-}" "$OPENCLAW_HOME/openclaw.config.yaml" "$REPO_DIR/openclaw/openclaw.config.yaml" "$OPENCLAW_HOME/openclaw.config.yaml"
copy "${1:-}" "$OPENCLAW_HOME/SOUL.md"              "$REPO_DIR/openclaw/SOUL.md"              "$OPENCLAW_HOME/SOUL.md"
copy "${1:-}" "$OPENCLAW_HOME/skills/opensidebar.md" "$REPO_DIR/openclaw/skills/opensidebar.md" "$OPENCLAW_HOME/skills/opensidebar.md"

# 3. Onboard non-interactively using the baked config; prompt only for an API key.
echo "[openclaw-install] running onboarding (uses the pre-baked config)…"
openclaw onboard --skip-wizard --config "$OPENCLAW_HOME/openclaw.config.yaml" || {
  echo "[openclaw-install] onboarding command differs in your OpenClaw version — run it manually with the config above." >&2
}

echo "[openclaw-install] done. Loopback gateway pre-wired to the OpenSidebar browser MCP host."
echo "  Next: set your model API key, then 'openclaw start'. Optional: add a Telegram channel."
