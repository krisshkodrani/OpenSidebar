#!/usr/bin/env bash
# Lab setup script -- bootstraps Hermes Agent and GBrain
set -euo pipefail

LAB_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$LAB_DIR")"
DATA_DIR="$PROJECT_ROOT/data"

echo "=== OpenSidebar Lab Setup ==="
echo "Lab:     $LAB_DIR"
echo "Project: $PROJECT_ROOT"
echo ""

# Source .env from project root if it exists
if [ -f "$PROJECT_ROOT/.env" ]; then
  echo "Loading environment from .env"
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

# Check required env vars
if [ -z "${FIREWORKS_API_KEY:-}" ]; then
  echo "WARNING: FIREWORKS_API_KEY not set. Agents will not be able to call Kimi K2.5."
  echo "  Add it to $PROJECT_ROOT/.env or: export FIREWORKS_API_KEY=<your-key>"
  echo ""
fi

# Ensure submodules are initialized
echo "--- Initializing git submodules ---"
cd "$PROJECT_ROOT"
git submodule update --init --recursive lab/agents/hermes/repo lab/agents/gbrain/repo

# Create data directories
mkdir -p "$DATA_DIR/gbrain"
mkdir -p "$DATA_DIR"

# --- Hermes Agent ---
echo ""
echo "--- Setting up Hermes Agent ---"
if command -v hermes &>/dev/null; then
  echo "Hermes CLI already installed."
else
  echo "Installing Hermes Agent..."
  cd "$LAB_DIR/agents/hermes/repo"
  if [ -f "pyproject.toml" ]; then
    pip install -e . 2>&1 | tail -3
  elif [ -f "setup.py" ]; then
    pip install -e . 2>&1 | tail -3
  else
    echo "  Cannot auto-install. See lab/agents/hermes/repo/ for manual setup."
  fi
fi

# --- GBrain ---
echo ""
echo "--- Setting up GBrain ---"
cd "$LAB_DIR/agents/gbrain/repo"
if [ -f "package.json" ]; then
  echo "Installing GBrain dependencies..."
  if command -v bun &>/dev/null; then
    bun install 2>&1 | tail -3
  elif command -v npm &>/dev/null; then
    npm install 2>&1 | tail -3
  fi
fi

# Initialize GBrain database
echo "Initializing GBrain knowledge base..."
if command -v bun &>/dev/null && [ -f "dist/cli.js" ]; then
  bun run dist/cli.js init --data-dir "$DATA_DIR/gbrain" 2>&1 || echo "  (init may require build first: bun run build)"
else
  echo "  GBrain CLI not built yet. Run: cd lab/agents/gbrain/repo && bun run build"
fi

# Index lab content
echo ""
echo "--- Indexing lab content into GBrain ---"
for dir in rfcs research reports books/notes knowledge articles; do
  if [ -d "$LAB_DIR/$dir" ] && command -v bun &>/dev/null && [ -f "dist/cli.js" ]; then
    echo "  Indexing lab/$dir/"
    bun run dist/cli.js import "$LAB_DIR/$dir/" 2>&1 | tail -1 || true
  fi
done

echo ""
echo "=== Lab setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Set FIREWORKS_API_KEY if not already set"
echo "  2. Build GBrain: cd lab/agents/gbrain/repo && bun run build"
echo "  3. Start GBrain MCP: bun run dist/cli.js mcp --port 3847"
echo "  4. Configure Hermes: hermes model set fireworks/accounts/fireworks/models/kimi-k2.5"
echo "  5. Enable scheduled tasks in lab/agents/hermes/config.yaml"
