# Hosted MCP operations

Public instructions: <https://opensidebar.com/connect/mcp>.

## Interactive candidate — not released

The 2026-10-07 local candidate adds `executionClass: "interactive"` to task
creation. The default remains `read_only`. Interactive tasks require all three:
`HOSTED_MCP_INTERACTIVE_ENABLED=true`, a newly consented
`browser.tasks.interact` OAuth scope, and a fresh
`remote_browser_interactive_v1` device handshake. The extension advertises this
only with `VITE_REMOTE_INTERACTIVE_ENABLED=true`. Both flags remain off. Migration
024 adds capability metadata with a false default; an old client's next poll
clears interactive readiness. Existing website sessions can supply expanded
consent without another sign-in. Existing OAuth grants do not gain new scopes.

The bounded `remote_interactive` tool profile excludes arbitrary JavaScript,
cookie tools, browser history and unrestricted profile access. File transfer is
not yet enabled in this profile. Interrupted interactive attempts remain
mutation-sensitive even if a supervisor labels a step read-only.

Local Stop now aborts before network I/O and persists a tombstone, preventing
restart from dispatching stopped work. Local denial also stops execution when a
remote approval has already won the network race. Cancellation is not rollback
of actions that have already reached a website.

The direct-action contract, controller and browser adapter are implemented and
tested locally under `background/remote-control`. They use existing content
actions, opaque references, document identity/mutation epochs, idempotency and
an interrupted-attempt journal. They are **not connected to hosted MCP yet**;
their execution, authorization and persistence ports still require production
wiring. No direct-control capability is advertised.

Remaining release work:

- Wire hosted direct-session operations into existing durable delivery and
  shared target ownership, including task/direct handoff and policy-bound
  approvals. Add corresponding scopes without expanding existing grants.
- Implement account/session-bound encrypted upload, download and screenshot
  artifacts, screenshot masking, expiry/deletion, and transfer endpoints.
- Complete the control UI and public guide for those actual capabilities.
- Prove both modes in real Chrome, including Stop, approvals, reconnect,
  Playground synchronization, and the PlayScenario chat/upload/export journey.
- Deploy compatible backend changes, publish the extension, and only then
  widen tester access. The outstanding AWS runtime credential rotation was
  completed on 2026-10-07: KMS roundtrip and production readiness passed, the
  exposed key was deleted, and IAM permissions were unchanged.

Candidate evidence is in `.artifacts/remote-control/20261007/`. Repository
verification passed (571 test files / 5,664 tests, lint, typecheck, build and
distribution checks). A disposable PostgreSQL test verifies migration
repeatability and capability expiry/downgrade. These checks do not establish
live direct-control readiness. The candidate has not been deployed.

## Existing sessions and consent

The MCP authorization endpoint redirects to `/app/connect/codex`. A valid
website session opens consent immediately. An expired or absent session goes
through the website sign-in adapter and returns to the same validated consent
request. Do not route signed-in users through a separate Cognito login.

Consent issues a separate, revocable integration credential; the website cookie
is never copied into the MCP client. Codes expire after two minutes, access
tokens after fifteen minutes, and refresh families after thirty days. PKCE,
client/resource/redirect bindings, CSRF, refresh rotation and replay revocation
are enforced server-side. Device revocation and account session epochs also
invalidate integration access. Tokens are stored as hashes in migration 023.

The release retains the approved-account pilot and read-only remote task limits.
Other MCP clients require registered callback configuration. An authorization
record alone is not evidence of a working client: discover tools, list devices,
and check the intended browser is online and ready before starting a task.

## Shared-server routing

The current production configuration is `/opt/shared-apps/deploy/Caddyfile`;
`infra/lightsail/Caddyfile` describes the earlier API-origin deployment and must
not replace the shared-server configuration. The target host must serve its SPA
entry point for run URLs while keeping target API and launch routes separate:

```caddyfile
handle /run/* {
  root * /srv/opensidebar-target
  header Cache-Control "no-store"
  header X-Robots-Tag "noindex, nofollow"
  rewrite * /index.html
  file_server
}
```

This handler belongs inside `https://play.opensidebar.com`. Without it, the
launch endpoint can create a valid target session but the redirected `/run/...`
URL returns an HTTP 404. The entry point contains no private run state; target
API calls still require the host-only session cookie.

Validate Caddy configuration before applying it. With the deployed Caddy 2.11
and file-based configuration, `SIGUSR1` reloads gracefully even with its admin
API disabled. Hold `/run/lock/shared-apps-backup.lock` for shared-host mutations.
Never reset or seed the production database for acceptance tests.

## 2026-10-07 release evidence and rollback

- API image tag: `shared-opensidebar-api:mcp-session-20261007`.
- API/web rollback snapshot:
  `/opt/shared-apps/releases/opensidebar-mcp-session-20261007-r1`.
- Proxy rollback snapshot:
  `/opt/shared-apps/releases/opensidebar-target-route-20261007/Caddyfile.before`.
- Local evidence: `.artifacts/mcp-session/20261007/` (ignored runtime artifacts).
- Cloud suite: 138 passed, 3 skipped; dedicated PostgreSQL OAuth concurrency,
  replay and cascade test passed. Frontend builds, focused lint/typecheck and
  session/consent acceptance checks passed. Eight viewport/theme accessibility
  checks reported no violations. These are scoped checks, not a claim that all
  unrelated extension tests pass.
- Real Codex CLI OAuth completed using the existing Chrome website session,
  without another OTP. Official app-server tool discovery returned six tools;
  `browser_list_devices` returned the existing online Chrome as ready.
- The reported production run URL returned HTTP 200 and rendered the simulated
  shop in Chrome. Triggering restock updated the control page to inventory 12.
  Automatic target refresh and a full agent-run completion still need a clean
  browser acceptance check; user tab changes interrupted that final observation.

Keep migration 023 when rolling back the API image; it is additive. Restore only
the affected app files and image reference, preserving other apps and subsequent
operator changes. Validate routing, health, static assets and real MCP discovery
after deployment. Do not include environment files or credentials in evidence.


## Remote startup verification (2026-10-07)

The local extension now enforces a sender-side page-connection deadline and a
separate 15-second preflight deadline. A cancelled or expired preflight cannot
later dispatch an agent task. Its panel distinguishes tab selection, page
connection, agent startup, and observed agent activity; stale activity shows an
elapsed-time notice rather than implying continuing progress.

Plan confirmations are forwarded through the existing workspace-bound approval
channel. Stopping one workspace only cancels that workspace's pending plans.
The remote runner starts the existing service-worker keepalive before model
work. Read/report plan synthesis defers requests containing unsupported actions
to the model planner instead of silently dropping their requested mutations.

Validation: the final `pnpm run verify` passed 573 test files / 5,679 tests,
lint, type checking, build, and distribution checks. Earlier attempts hit one
transient Vitest module-load failure and one grid-tagging test failure; the
isolated grid test and final full run passed. Cloud tests ran 140 passing with
four environment-dependent skips.

Live Chrome evidence: mission `805bb485-b2ca-4768-9032-945882645439` completed
through hosted MCP and returned the actual PlayScenario heading and capacity
notice. Local cancellation was also confirmed through MCP. Through the
OpenSidebar side panel, the agent opened the fictional acceptance workspace,
entered its bounded chat request, encountered the capacity gate, and submitted
when the gate opened. PlayScenario rendered a two-question assistant response
and marked interpretation complete. Mission `18368fad-86df-434d-ad7e-04da46a942a7` then confirmed that the message and two-question response survived a reload and that export links were available. These checks do not establish upload/RAG
or direct-action MCP readiness. Keep the hosted read-only rollout restriction.

For an unpacked extension loaded from `dist`, finish builds before acceptance,
then reload the extension and target page. Rebuilding that directory during a
live run can invalidate the loaded build's hashed resources. Preserve existing
account and device sessions; a build reload does not require signing out.
