#!/usr/bin/env bash
# Run Hermes Agent with Fireworks API key mapped correctly
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")"

# Source project .env
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a; source "$PROJECT_ROOT/.env"; set +a
fi

# Fireworks uses OpenAI-compatible API, so map the key
export OPENAI_API_KEY="${FIREWORKS_API_KEY:-$OPENAI_API_KEY}"

# Run hermes with all args forwarded
exec hermes "$@"
