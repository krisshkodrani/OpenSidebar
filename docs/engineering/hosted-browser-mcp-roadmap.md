# Hosted browser MCP delivery roadmap

Date: 2026-08-12

Status: LP-35 approved; Phase 5 contract, target-selection loop, scoped resource
server, mission adapter, and Cognito boundary implemented default-off; disabled
deployment and real Codex acceptance remain.

## Outcome

Provide one supported supervised Codex control path:

```text
Codex mission supervisor
  -> scoped MCP over HTTPS at opensidebar.com
  -> durable encrypted remote mission
  -> selected signed-in OpenSidebar extension
  -> MissionWorker -> existing AgentLoop and local safety policy
  -> browser
```

Codex supplies semantic steps, judges bounded evidence, and revises the plan.
The backend coordinates encrypted transport and bounded lifecycle metadata. It
does not observe pages, plan clicks, hold browser credentials, or become the
browser safety authority.

## Release boundary

Hosted MCP is post-`0.7.3` work. The prepared `0.7.3` candidate contains the
disabled LP-35 foundation commits through `3c76d0c1`, but exposes no operable
hosted-browser path. Hosted supervision targets a default-off `0.7.4` or later
named-tester build and ships only after the complete path and LP-35 evidence
gates pass.

## Current capability

| Capability | Status | Evidence |
| --- | --- | --- |
| Versioned mission metadata/payload contracts | Complete | `f4b364c8`, `b08ff147` |
| Input and lifecycle policy | Complete | Three focused policy tests |
| Ordered PostgreSQL metadata and idempotency | Complete | Migration 009 and repository in `1d290a41` |
| KMS-envelope-encrypted mission payload | Complete | Device-bound encryption test |
| Account create/status API | Complete, disabled | `82b0565e` |
| Selected-device delivery and transition API | Complete, disabled | Device-isolation and lifecycle API tests |
| Adapter to existing agent runtime | Complete | Three extension runner tests |
| Local supervised worker and scripted supervisor | Complete locally | Worker, restart-journal, stale-revision, retry, and uncertainty tests pass |
| Local-only recoverable composer drafts | Complete locally | Local isolation, size, discard, and failed-send tests pass |
| Revisioned device rename | Complete locally | Backend conflict tests and extension/account UI typechecks pass |
| Automatic extension consumption | Named-tester read-only vertical slice accepted | Real Chrome completed exact-existing-tab mission `45a55bbd` on 2026-08-13 through cloud relay; encrypted grounded result contained `Example Domain`; no new tab, navigation, local key, repeated link code, or manual diagnostic relay |
| Durable progress/approval/result return | Progress, approval preview/decision, result, and coordinator cancel implemented | Approval decisions are immutable, KMS-encrypted, ID/digest/expiry-bound, readable only by the selected device, and subject to a fresh local site-access check; real consequential acceptance remains intentionally blocked by the read-only rollout profile |
| Sidepanel remote-run UX | Account requester, sanitized task summary, device/target/expiry, target-choice handoff, approval preview, local deny/cancel, and account remote-work switch implemented | Real duplicate-tab and synthetic approval visual acceptance remain |
| Connection normalization | Implemented locally | Browser, Codex integration, and test-client identities are distinct; repeated acceptance clients collapse into one history row; online/offline/revoked state is explicit |
| Ambiguous existing-tab selection | Implemented locally | Duplicate exact URLs return bounded title/group/window labels plus mission-scoped opaque handles; Chrome identifiers stay local; expiry, URL revalidation, sibling replay, and stale-tab tests pass |
| Hosted MCP protocol contract | Complete locally, mounted behind disabled flag | Six-tool SDK conformance, Streamable HTTP initialize, and scope tests pass |
| Hosted MCP OAuth resource boundary | Implemented and provisioned, disabled | RFC 9728 metadata advertises the Cognito issuer; AWS has a separate public PKCE client, fixed loopback callback, MCP resource, and six scopes; resource-bound tokens require the exact audience; website cookies and extension-client tokens fail; local integration revocation wins |
| Hosted MCP operations adapter | Complete locally, disabled | Device listing/selection, creation, status, target selection, revision-bound evidence supervision, approval response, and cancellation are implemented |
| MCP transport sessions and quotas | Complete locally, disabled | Account/client-bound Streamable HTTP sessions expire after 30 idle minutes; creation, polling, and mutation use separate hashed per-account quotas |
| Production E2E and cutover | Not started | Blocks localhost deletion |

## Phase 1 — Local supervisor and harness vertical slice

Goal: prove Codex-style planning, evidence judgment, and replanning without a
hosted dependency.

Deliver environment-neutral mission, step, evidence, attempt, and supervisor
decision contracts; a `MissionWorker` over `RemoteMissionRunner`; an in-memory
transport and scripted supervisor; and mission-level overlay/Playwright driver
operations. Keep independent fixture validators outside product logic. Record
dogfood artifacts only under `.artifacts/`.

Exit gate: read-only completion, failed-first-plan replan, evidence request,
stale revision, duplicate decision, cancellation, approval, and worker versus
supervisor versus validator classification pass deterministically.

## Phase 2 — Extension delivery vertical slice

Goal: one allowlisted signed-in extension receives and completes one read-only
mission created through the HTTP API.

Deliver:

- Add a small `RemoteMissionTransportPort` under the background environment
  boundary. Chrome uses authenticated HTTPS long polling; tests use memory.
- Start bounded polling only while signed in and the remote-mission build flag is
  enabled. Use alarms/reconnect rather than a permanent MV3 keepalive.
- Persist last acknowledged sequence and a bounded local mission-attempt record
  before starting the agent.
- Validate device, schema, expiry, origin, and local site/navigation policy
  immediately before acceptance.
- Dispatch through `RemoteMissionRunner`; do not call orchestrator internals from
  the transport.
- Post accepted, running, and terminal transitions with idempotent mutations.
- On restart after `running`, observe/reconcile before retry; ambiguous effects
  become `outcome_unknown`.

Exit gate:

- Memory-port tests cover ordered delivery, duplicate frames, abort, restart,
  expired mission, wrong device, and terminal replay.
- Real extension E2E completes a read-only mission after service-worker restart
  without duplicate `AgentLoop` dispatch.

## Phase 3 — Result, approval, and cancellation envelopes

Goal: account callers can safely follow and control a mission without receiving
raw browser state.

Deliver:

- Define bounded encrypted mission output containing progress summary, terminal
  summary, and approval preview. Keep raw page content, screenshots, traces, and
  tool results out of this channel.
- Store the terminal outcome, summary, and sanitized diagnostic in a distinct
  mission/device-bound encrypted object. Require it before accepting matching
  terminal metadata and return it only to an authorized account coordinator.
- Retain submitted encrypted mission content for 30 days. Delete every current
  and non-current object version on expiry, manual deletion, or account deletion;
  clean up uploads orphaned by failed metadata commits.
- Persist approval ID, action digest, expiry, expected effect, and coarse risk;
  never persist raw form values in metadata or logs.
- Add account decision and cancellation APIs with idempotency keys.
- Route a valid decision through the same mission/session in
  `RemoteMissionRunner.respondApproval`.
- Revalidate digest, expiry, page origin, fresh grounding, and local policy
  immediately before dispatch. Local deny/cancel wins.
- Cancellation before start prevents dispatch. Cancellation after start aborts
  where possible, observes state, and reports success/failure/unknown honestly.

Exit gate:

- Approval, denial, expiry, stale digest, changed origin, local-policy change,
  cancel-before-start, and cancel-after-effect tests pass.
- Consequential `outcome_unknown` missions are never automatically retried.

## Phase 4 — Local visibility, drafts, device naming, and control

Goal: remotely initiated browser work is never invisible to the person using the
browser.

Deliver:

- Show remote requester, sanitized instruction summary, selected device, state,
  age/expiry, and current local workspace in the sidepanel.
- Show approval preview with local deny and cancel controls.
- Distinguish queued/offline, running, waiting for approval, cancelling,
  completed, failed, and uncertain states.
- Keep the sidepanel environment-neutral through `sidepanel/runtime.ts`.
- Add account-level remote-control enable/disable and an immediate local stop.
- Save unfinished composer text locally by account/workspace/mode, restore it
  after panel/browser restart, retain it after failed send, and clear it only
  after confirmed submission or explicit discard. Never upload drafts.
- Let users rename the stable extension device from both the panel and account
  site using revision-checked updates; Codex uses the current display name.

Exit gate:

- Sidepanel tests and visual checks cover light/dark/narrow layouts, keyboard
  access, restart, expired authentication, revoked device, and partial rollout.

Implementation status (2026-08-13):

- Composer drafts are local-only, account/workspace/mode scoped, restart-safe,
  retained after failed sends, and covered by focused tests.
- Stable device names can be changed with revision checks from the extension and
  account site.
- The sidepanel remote-task card now shows the signed-in account email, bounded
  task summary, selected browser name, target context, mission expiry, lifecycle
  state, approval preview, and local deny/cancel controls. UI operations cross
  `sidepanel/runtime.ts`; the component imports no Chrome API.
- Local deny is approval-ID/action-digest bound and local cancel is idempotent at
  the cloud API. Both preserve bounded local context while state changes.
- Remaining before the Phase 4 exit gate: real-browser visual acceptance for
  light/dark/narrow and restart, explicit offline/revoked/partial-rollout
  presentation, and the account-level remote-control switch. The build-time and
  named-tester gates remain the outer kill switches meanwhile.

After reloading the Phase 4 acceptance build, real exact-existing-tab missions
`98fe16b7-8b41-4525-a91e-d717ee1cb35f` and
`b19639e6-ccdd-40b6-8e42-d978df8ed729` completed successfully. The tester
confirmed that the remote-task card appeared with account/device/task context
and the local Cancel control. A third mission
`5dd54e73-4eb8-480a-b1ac-1e84664157bb` also completed before a cancellation
could be committed. Therefore visual visibility is accepted, while the local
button's real cancellation evidence remains open; the already-passing unit and
cloud/runtime cancellation evidence is not misreported as that UI evidence.

## Phase 5 — Hosted MCP and scoped authorization

Goal: Codex uses `opensidebar.com` directly without a localhost helper.

Deliver:

- Add a standards-conformant hosted MCP endpoint as a thin adapter over the
  mission APIs.
- Implement reviewed OAuth discovery/authorization for remote MCP clients with
  narrowly scoped, revocable credentials. Do not reuse extension refresh tokens
  or broad website sessions.
- Expose only:
  - `browser_list_devices`
  - `browser_start_task`
  - `browser_get_task`
  - `browser_continue_task`
  - `browser_respond_approval`
  - `browser_cancel_task`
- Require explicit device selection unless exactly one eligible connected
  device exists; always return the selected device.
- Return job-style mission IDs and bounded status rather than holding one MCP
  request open for the browser run.
- Enforce per-account creation, polling, and mutation quotas separately.
- Resolve an existing-page target on the selected device. If exactly one tab
  matches, continue automatically. If several tabs match, move the mission to
  `target_selection_required` and return only encrypted, bounded choices such
  as window label, tab-group title, page title, and a short-lived opaque target
  handle. Codex asks the user which context to use, then submits the chosen
  handle through `browser_continue_task` without starting a second mission.
- Never expose Chrome tab/group/window IDs or a general inventory of open tabs.
  Target handles are device-, mission-, and connection-bound, expire quickly,
  and are revalidated locally immediately before execution.

Implementation sequence:

1. **Close the Phase 4 control gate.** Add the deterministic paused fixture,
   explicit offline/revoked/partial-rollout presentation, and the account-level
   remote-work switch before relying on remote authorization.
2. **Freeze contracts.** Add `target_selection_required`, encrypted bounded
   target-choice envelopes, opaque handle expiry/binding, and the typed
   `select_target` continuation decision. Add lifecycle, replay, stale-handle,
   duplicate-URL, and privacy tests first.
3. **Add scoped authorization.** Use a separate MCP OAuth client and narrowly
   scoped, revocable grants for device discovery, target resolution, task
   creation/read/control, and approval response. Extension refresh tokens and
   website session cookies remain invalid at the MCP boundary.
4. **Mount the hosted adapter.** Serve Streamable HTTP at the hosted MCP origin;
   keep the MCP layer a thin translation over existing account, mission, and
   continuation APIs. Do not add planner or browser logic to the backend.
5. **Connect Codex.** Complete one browser-based OAuth link, verify credential
   refresh/revocation, and confirm Codex can discover the six bounded tools in a
   new conversation without a localhost bridge or repeated link codes.
6. **Prove the conversation loop.** Exercise one unique-tab task and one
   duplicate-URL task across named groups. For the latter Codex must ask, for
   example, “I found this page in both Work and Personal. Which one should I
   use?”, then continue on only the selected tab.
7. **Run security and resilience gates.** Cover cross-account handles, stale or
   replayed selections, changed groups/tabs, offline devices, OAuth revocation,
   quotas, cancellation, approval, backend restart, and extension restart.

Provisioning is dry-run-first through
`pnpm cloud:provision-hosted-mcp-cognito`. Codex and Cognito must share one
fixed loopback callback, for example `http://localhost:1455/callback`, set in
Codex as both `mcp_oauth_callback_url` and `mcp_oauth_callback_port`. The
provisioner requires that exact value in `OPENSIDEBAR_MCP_CALLBACK_URL`, creates
the `https://opensidebar.com/mcp` resource server and six custom scopes, and
prints the issuer/client/scope-prefix values. Codex is then registered with the
returned public client ID and `--oauth-resource https://opensidebar.com/mcp`.
This avoids dynamic registration and repeated link codes while preserving PKCE.
The server flag remains false throughout provisioning.

Browser process launching is deliberately outside Phase 5. Record it as a later
opt-in desktop/native-companion research item; a closed browser remains an
offline device and queued work must say that Chrome needs to be opened.

Exit gate:

- MCP protocol/conformance tests pass with a Codex-like client.
- Scope confusion, token replay/revocation, cross-account identifiers, device
  revocation, quota, and origin/header injection tests pass.
- Duplicate URLs in different tab groups always require an explicit Codex-side
  selection, and a selected opaque handle cannot resolve to a different tab.
- No tab inventory, Chrome identifier, candidate title/group label, or target
  handle appears in PostgreSQL metadata, ordinary logs, or fleet telemetry.

## Phase 6 — Production-shaped parity

Goal: prove hosted delivery is safer and at least as capable as the localhost
bridge before removing anything.

Run:

- Read-only task completion in a real extension.
- Consequential approval, denial, and expiry.
- Cancellation before and after possible external effect.
- MV3 suspension and Chrome restart at every lifecycle boundary.
- Backend/API restart and lost response after committed mutation.
- Duplicate and out-of-order delivery.
- Device revocation during queued/running work.
- Two signed-in profiles competing for one mission/device selection.
- Backend outage while local-only OpenSidebar use remains functional.
- Privacy scan of logs, PostgreSQL, S3 metadata, metrics, traces, and fleet
  telemetry.

Exit gate:

- Zero duplicate agent dispatches in injected duplicate/restart cases.
- No automatic retry of uncertain consequential effects.
- No plaintext mission content outside the encrypted object and selected device.
- Full lint, typecheck, unit/backend tests, build, dist verification, and relevant
  real-browser E2E pass without raising decomposition budgets.

## Phase 7 — Cutover and deletion

Goal: leave one supported integration and no half-replaced local path.

After Phase 5 passes:

- Remove `scripts/browser-mcp` and `mcp:browser` scripts.
- Remove extension WebSocket client/startup and
  `opensidebar:browserMcpWsPort`.
- Remove Docker bridge-port wiring and localhost bridge E2Es.
- Rename bridge-specific approval types to neutral remote-mission types, then
  remove `shared-types/browser-bridge.ts` when no product references remain.
- Rewrite JobAgent, architecture, setup, changelog, and troubleshooting material
  that assumes localhost ownership.
- Search the repository for `browser-bridge`, `browser-mcp`, `mcp:browser`,
  `BROWSER_MCP_WS_PORT`, and `opensidebar:browserMcpWsPort`; every survivor must
  be current historical evidence or intentionally retained product vocabulary.

Exit gate:

- Hosted MCP completes the parity suite from a clean installation.
- Localhost setup is unnecessary and absent from supported documentation.
- Rollback is the hosted feature flag, not restoration of a second transport.

## Phase 8 — Named-tester rollout

- Keep server and extension flags default off.
- Enable only named accounts and explicitly selected devices.
- Publish matching account, privacy, retention, remote-control, approval, and
  Chrome Web Store disclosures before activation.
- Monitor content-free counts: created/running/terminal/expired missions,
  reconnect latency, duplicate suppression, approval wait time, outcome class,
  and backend errors.
- Do not collect instructions, URLs, page content, approvals, results, device
  identifiers in fleet telemetry, or browser history.

General availability requires a separate rollout decision after named-tester
evidence; it is not implied by completing implementation.

## Immediate next work

1. Deploy the reviewed backend with `HOSTED_MCP_ENABLED=false`, the provisioned
   Cognito issuer/client/scope prefix present, and exact-host routing for `/mcp`
   plus protected-resource discovery. Do not configure Codex until the disabled
   deployment and routing checks pass.
2. Add a safe synthetic approval fixture that can exercise account decision,
   denial, expiry, and same-session continuation without a real website effect.
3. Run exact-host Codex OAuth, unique-tab, duplicate-tab/group selection,
   cancellation, token refresh/revocation, backend restart, and extension
   restart acceptance before enabling any additional tester.

The Phase 2 named-tester read-only acceptance gate passed on 2026-08-13. The
ignored report records mission `45a55bbd-8e40-4e31-98f1-177c401634e8` as
`succeeded/completed` in 58.9 seconds with an encrypted grounded `Example
Domain` result. The reusable coordinator was bootstrapped once and then used a
rotating refresh session. Exact-existing-tab selection remained stable even
when another Chrome tab was active.

The Phase 3 backend candidate
`remote-mission-progress-cancel-v1-20260813` was then deployed with the same
allowlist and flags. Exact-existing-tab mission `debe50c8-9c5a-4875-8b66-ba60842ead61`
completed `succeeded/completed` in 65.4 seconds, proving the new encrypted
artifact layout remains compatible with the accepted read-only client. The
container remained healthy with zero restarts and its 256 MiB cap. The
cancellation-watcher exercise then used the reloaded Phase 3 extension.

That cancellation exercise passed at the cloud/runtime boundary after the
Phase 3 extension reload. Mission `3f10bacc-24c0-44ad-97a8-1fc5fefe0c56`
reached `running` and was coordinator-cancelled after 24.1 seconds. Its metadata
and encrypted artifact remained `cancelled/cancelled`; one already-active relay
request finished 0.9 seconds after cancellation and the extension issued no
further model requests or terminal overwrite. A second queued diagnostic missed
the worker's already-fetched batch and was manually cancelled, so it is not
claimed as immediate-handoff evidence.

The approval-envelope backend candidate
`remote-mission-approval-v1-20260813` is now live behind the same named-tester
boundary. Compatibility mission `1c4fdf8b-a96d-4f34-a202-67540defd07b`
completed `succeeded/completed` in 76.5 seconds. The API container remained
healthy with zero restarts and its 256 MiB cap; checkpoint, export, device
command/takeover, and both Temporal flags remained disabled. Consequential
remote missions remain impossible under the hard read-only client profile.

This ordering validates the actual browser execution path before investing in
the public MCP facade.

Current production boundary: `CLOUD_SESSIONS_ENABLED` and
`REMOTE_MISSIONS_ENABLED` are enabled only for the single configured session
tester. Checkpoint writes/restores, exports, device commands/takeover, and both
Temporal flags remain disabled. `HOSTED_MCP_ENABLED` is also false. The separate
Cognito MCP resource and public PKCE client were provisioned and read-back
verified on 2026-08-13, but no MCP backend route is enabled. The acceptance-only build is marked
`releaseEligible: false`, and the normal distribution verifier rejects it.
