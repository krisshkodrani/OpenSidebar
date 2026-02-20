# OpenSidebar — developer commands
# Requires: bun, make (GNU Make)

.PHONY: dev build lint test fmt clean logs viewer traces evals help

# ── Primary workflows ────────────────────────────────────────────

## Start full dev stack (build + log server + Vite HMR). Traces are captured.
dev:
	bun run dev:stack

## Production build only
build:
	bun run build

## Run all tests
test:
	bun test

## Lint source files
lint:
	bun run lint

## Format source files
fmt:
	bun run fmt

# ── Logs & Traces ────────────────────────────────────────────────

## Start log drain server (captures logs + traces on port 7589)
logs:
	bun run logs

## Open trace viewer UI in browser
viewer:
	@echo "Starting server... open http://127.0.0.1:7589/viewer"
	bun run viewer

## List captured trace sessions
traces:
	bun run traces:list

## Show aggregate trace statistics
traces-stats:
	bun run traces:stats

## Tail recent log entries
logs-tail:
	bun run logs:tail

## Show error-level log entries
logs-errors:
	bun run logs:errors

## Delete all traces and start fresh
traces-clean:
	rm -f traces/*.jsonl
	rm -f traces/runs/*.jsonl
	rm -rf traces/archive/*
	@echo "All traces cleared."

# ── Evals ────────────────────────────────────────────────────────

## Convert traces to eval cases
evals-convert:
	bun run evals:convert

## Run eval cases against LLM
evals-run:
	bun run evals:run

## Show eval statistics
evals-stats:
	bun run evals:stats

## Pattern analysis across eval results
evals-analyze:
	bun run evals:analyze

# ── Housekeeping ─────────────────────────────────────────────────

## Remove build artifacts
clean:
	rm -rf dist/
	bun run clean:vite-artifacts

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
