#!/usr/bin/env bash
# Re-index all lab markdown into GBrain (idempotent -- unchanged files are skipped)
set -euo pipefail

LAB_DIR="$(cd "$(dirname "$0")" && pwd)"
GBRAIN_CLI="$LAB_DIR/agents/gbrain/repo/src/cli.ts"

# Source .env for API keys
if [ -f "$LAB_DIR/../.env" ]; then
  set -a; source "$LAB_DIR/../.env"; set +a
fi

cd "$LAB_DIR/agents/gbrain/repo"

echo "=== Indexing lab content into GBrain ==="

DIRS=(
  "rfcs"
  "research"
  "reports"
  "e2e-reports"
  "books/notes"
  "knowledge"
  "articles"
  "archive"
  "experiments"
)

TOTAL_PAGES=0
TOTAL_CHUNKS=0

for dir in "${DIRS[@]}"; do
  FULL="$LAB_DIR/$dir"
  if [ -d "$FULL" ]; then
    echo ""
    echo "--- lab/$dir ---"
    bun run "$GBRAIN_CLI" import "$FULL" --no-embed 2>&1
  fi
done

# Also index repo docs (architecture, features, guides)
echo ""
echo "--- docs/ ---"
bun run "$GBRAIN_CLI" import "$LAB_DIR/../docs" --no-embed 2>&1

echo ""
echo "=== Index complete ==="
bun run "$GBRAIN_CLI" stats 2>&1
