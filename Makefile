# OpenSidebar — developer commands
# Requires: node, npm, make (GNU Make)

.PHONY: dev build test lint fmt logs traces \
	evals-critique evals-extract evals-validate \
	clean help

# ── Primary workflows ────────────────────────────────────────────

## Full dev stack: Vite HMR + log server + trace viewer
dev:
	npm run dev

## Production build
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

## Start log drain server + trace viewer (port 7589)
logs:
	npm run logs

## List captured trace sessions
traces:
	npm run traces list

# ── Evals ────────────────────────────────────────────────────────

## Run unified critique: replay golden cases, judge, generate report
## Optional: TAG=find_element_loop to filter by pathology
evals-critique:
	npm run evals:critique $(if $(TAG),-- --tag $(TAG))

## Extract golden case from trace turn
## Usage: make evals-extract S=<session> T=<turn> TAG=<pathology> TOOL=<name>
evals-extract:
	npx tsx evals/cli.ts extract $(S) $(T) $(if $(TAG),--tag $(TAG)) $(if $(TOOL),--correct-tool $(TOOL))

## Structural validation of golden cases (no API key needed)
evals-validate:
	npm run evals:validate

# ── Housekeeping ─────────────────────────────────────────────────

## Remove build artifacts
clean:
	rm -rf dist/
	tsx scripts/vite-clean.ts --clean-only

## Show available targets
help:
	@echo ""
	@echo "  make dev              Full dev stack (Vite + logs + trace viewer)"
	@echo "  make build            Production build"
	@echo "  make test             Run all tests"
	@echo "  make lint             Lint source files"
	@echo "  make fmt              Format source files"
	@echo ""
	@echo "  make logs             Start log server + trace viewer (port 7589)"
	@echo "  make traces           List trace sessions"
	@echo ""
	@echo "  make evals-critique                        Replay + judge + report"
	@echo "  make evals-critique TAG=find_element_loop  Filter by pathology"
	@echo "  make evals-extract S=<id> T=<turn> TAG=<p> Extract golden case"
	@echo "  make evals-validate                        Structural validation (offline)"
	@echo ""
	@echo "  make clean            Remove build artifacts"
	@echo ""
	@echo "  For advanced commands: npm run traces -- help"
	@echo "                         npm run evals -- help"
	@echo ""
