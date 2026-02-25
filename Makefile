# OpenSidebar — developer commands
# Requires: node, npm, make (GNU Make)

.PHONY: dev build lint test fmt clean logs viewer traces evals help

# ── Primary workflows ────────────────────────────────────────────

## Start full dev stack (build + log server + Vite HMR). Traces are captured.
dev:
	npm run dev:stack

## Production build only
build:
	npm run build

## Run all tests
test:
	npm test

## Lint source files
lint:
	npm run lint

## Format source files
fmt:
	npm run fmt

# ── Logs & Traces ────────────────────────────────────────────────

## Start log drain server (captures logs + traces on port 7589)
logs:
	npm run logs

## Open trace viewer UI in browser
viewer:
	@echo "Starting server... open http://127.0.0.1:7589/viewer"
	npm run viewer

## List captured trace sessions
traces:
	npm run traces:list

## Show aggregate trace statistics
traces-stats:
	npm run traces:stats

## Tail recent log entries
logs-tail:
	npm run logs:tail

## Show error-level log entries
logs-errors:
	npm run logs:errors

## Delete all traces and start fresh
traces-clean:
	rm -f traces/*.jsonl
	rm -f traces/runs/*.jsonl
	rm -rf traces/archive/*
	@echo "All traces cleared."

# ── Evals ────────────────────────────────────────────────────────

## Convert traces to eval cases
evals-convert:
	npm run evals:convert

## Run eval cases against LLM
evals-run:
	npm run evals:run

## Show eval statistics
evals-stats:
	npm run evals:stats

## Pattern analysis across eval results
evals-analyze:
	npm run evals:analyze

# ── Housekeeping ─────────────────────────────────────────────────

## Remove build artifacts
clean:
	rm -rf dist/
	npm run clean:vite-artifacts

## Show available targets
help:
	@echo ""
	@echo "  make dev            Full dev stack (build + logs + Vite HMR)"
	@echo "  make build          Production build"
	@echo "  make test           Run all tests"
	@echo "  make lint           Lint source files"
	@echo "  make fmt            Format source files"
	@echo ""
	@echo "  make logs           Start log drain server (port 7589)"
	@echo "  make viewer         Start server + trace viewer UI"
	@echo "  make traces         List trace sessions"
	@echo "  make traces-stats   Aggregate trace statistics"
	@echo "  make traces-clean   Delete all traces"
	@echo "  make logs-tail      Tail recent logs"
	@echo "  make logs-errors    Show error logs"
	@echo ""
	@echo "  make evals-convert  Convert traces to eval cases"
	@echo "  make evals-run      Run evals against LLM"
	@echo "  make evals-stats    Eval statistics"
	@echo "  make evals-analyze  Pattern analysis"
	@echo ""
	@echo "  make clean          Remove build artifacts"
	@echo ""
