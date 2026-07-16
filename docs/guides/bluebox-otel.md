# Bluebox telemetry for the e2e harness and browser MCP host

The repo's two Node-side runtimes can export OpenTelemetry (traces + logs +
metrics) to Bluebox, so test-run history becomes something you can *ask* about
("which e2e tests got slower this week?", "what exactly failed in last night's
run?") instead of something you grep out of console logs.

**Default-off.** Without configuration, nothing changes: no export, no SDK
loaded, no timing impact. The gate is `OTEL_EXPORTER_OTLP_ENDPOINT`.

## What is instrumented

| Service | `OTEL_SERVICE_NAME` | Signals |
| --- | --- | --- |
| Staged e2e runner (`scripts/run-e2e-staged.ts`) | `opensidebar-e2e-harness` | Span per staged run + per suite (outcome: passed / flaky-passed / failed / collection-error), suite-outcome counter. Hands `TRACEPARENT` to the vitest children. |
| Vitest e2e reporter (`apps/extension/tests/e2e/helpers/otel-reporter.ts`) | `opensidebar-e2e-harness` | Span per test (status, duration, retryCount — pass-on-retry shows as `flaky-pass`), ERROR log record with the exact failure text, test counter + duration histogram. Joins the runner's trace via `TRACEPARENT`. |
| Browser MCP host (`scripts/browser-mcp/server.ts`) | `opensidebar-browser-mcp` | Span per thick tool call (`browser_tool <name>`, status), tool-call counter, ERROR log per failed call. |

Not instrumented, deliberately: the Chrome extension (browser context — ingest
tokens must never ship in a bundle; its telemetry stays in the in-house trace
engine), the pi → `WebSocketBridge` direct path (keeping OTel out of the
module graph pi's loader compiles), and the log-server/obs tooling (they *are*
the in-house observability stack).

## Setup (once)

1. Copy the Bluebox-managed template to the local config file (both
   git-ignored):

   ```bash
   cp .env.otel.bluebox-template .env.otel
   ```

2. In `.env.otel`, the endpoint + protocol are already filled by Bluebox.
   Leave `OTEL_SERVICE_NAME` empty — the services set their own names.

3. Add the ingest token line. Get the value from Bluebox: **Setup page →
   instrumentation step → Reveal token**. Quote it — the value contains a
   space:

   ```bash
   OTEL_EXPORTER_OTLP_HEADERS="Authorization=Api-Token <token from Bluebox>"
   ```

   The token goes in `.env.otel` only — never in a tracked file, never in a
   CLI argument.

That's it. The next staged e2e run and the next `pnpm run mcp:browser` session
export automatically (`scripts/otel/sdk.ts` reads `.env.otel` at startup;
real environment variables win over the file). Metrics use delta temporality
and http/protobuf transport — both required by Bluebox ingest; don't change
them.

## Agent-run traces (`opensidebar-agent-runtime`)

The in-house span spine (`traces/spans/`, RFC LP-7) is already OTel-shaped —
`ObsSpan` carries `gen_ai.*` conventions — so agent runs are unified into
Bluebox by an emitter, not a second pipeline:

- **Live**: the log-server drain streams every spine write out as OTLP when
  configured (`scripts/obs/otel-emit.ts`, hooked at the three spine dual-write
  sites). Runs appear as `orchestrator.run → agent.session → agent.turn →
  gen_ai.chat / execute_tool / gen_ai.perception` traces. Root spans arrive
  when the session record lands (end of run).
- **Backfill**: `pnpm run obs:export-otel -- [--session <id>] [--run <id>]
  [--from/--to] [--outcome completed] [--limit 20] [--dry-run]` replays
  historical spine sessions. Ids are deterministic (sha256-remapped trace id,
  spine span ids verbatim), so a re-export re-sends the same spans instead of
  minting duplicates. **Ingest-window caveat (verified):** Dynatrace accepts
  the request but silently drops spans whose timestamps are too old — a
  day-old session never appears while a current-time span does. Backfill soon
  after a run, or rely on the live hook; the CLI warns for sessions >1h old.

Export-boundary rules: every string attribute/event/status is passed through
`redactPii` and capped at 4000 chars; screenshots/DOM/prompts NEVER leave the
machine (only `os.blob.<kind>` CAS refs ride along). The trace viewer and obs
MCP are unchanged and remain the forensic source of truth.

**Query split**: ask Bluebox for history and correlation; use the trace
viewer / obs MCP for depth (screenshots, full prompts, adjudication).

## Asking Bluebox about runs

```bash
bluebox ask --service opensidebar-e2e-harness "which tests failed in the last staged run, and why?"
bluebox ask --service opensidebar-e2e-harness "which e2e tests have the highest flaky-pass rate this week?"
bluebox ask --service opensidebar-browser-mcp "show failed browser tool calls today with their error text"
bluebox ask --service opensidebar-agent-runtime "which agent runs failed yesterday, and which tools were erroring in them?"
bluebox ask --service opensidebar-agent-runtime "how has gen_ai.chat latency trended across runs this week?"
```
