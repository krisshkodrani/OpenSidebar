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

## Asking Bluebox about runs

```bash
bluebox ask --service opensidebar-e2e-harness "which tests failed in the last staged run, and why?"
bluebox ask --service opensidebar-e2e-harness "which e2e tests have the highest flaky-pass rate this week?"
bluebox ask --service opensidebar-browser-mcp "show failed browser tool calls today with their error text"
```
