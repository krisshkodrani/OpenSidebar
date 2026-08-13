# OpenSidebar Lightsail cloud platform roadmap

Status: sequencing roadmap. LP-28 is owner-approved. Each
follow-on RFC requires its own owner Decision Stamp before implementation.

## Goal and operating constraint

Deliver account-backed BYOK, safe preference sync, encrypted restorable sessions,
and the public Playground for the first few users on one USD 12/month Lightsail
server. Keep the total testing AWS
bill within USD 25/month, excluding each user's own model-provider charges.

The initial product backend is intentionally a modular monolith:

```text
opensidebar.com + play.opensidebar.com
  -> CloudFront static S3 and dynamic Lightsail origins

$12 Lightsail host
  -> Caddy
  -> OpenSidebar Node service (API, relay, worker, Playground)
  -> PostgreSQL-authoritative session/device coordination
  -> Temporal absent from production (LP-32/33 are parked research)
  -> local PostgreSQL (separate databases/roles)

Managed AWS retained
  -> Cognito, KMS, S3, CloudFront/Route53/ACM, SES
  -> LP-25 telemetry stack only
```

No application Lambda, API Gateway, DynamoDB, ECS, RDS, NAT Gateway, or Temporal
Cloud is part of the initial topology. The architecture optimizes for a few
testers and honest recoverability, not high availability.

## Stable boundaries

- The extension owns live browser interaction, page grounding, approvals, site
  access, navigation policy, local traces, and safety enforcement.
- The Lightsail service owns authenticated APIs, encrypted-key use, relay,
  revisioned data, quotas, device/session coordination, and Playground state.
- PostgreSQL owns small transactional metadata; encrypted checkpoint bodies and
  exports live in S3; KMS wraps provider/session data keys.
- PostgreSQL owns durable coordination on the shared host. Temporal research is
  retained in-repo but has no active infrastructure or production enablement.
- `opensidebar.com` hosts marketing, accounts, sessions, and the human Playground
  Control Center. `play.opensidebar.com` hosts isolated agent-visible targets.
- Apex account cookies never reach the target host; target capabilities never
  authorize account APIs.
- LP-25 telemetry remains optional, anonymous, content-free, serverless, and
  unlinkable to accounts, devices, sessions, Playground runs, relay requests, or
  Temporal workflows.

## RFC series

| Order | RFC                                                                                           | Decision owned                                                                                                            | Status/dependency                                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | [LP-28 — Lightsail control plane, vault, and relay](rfcs/lp-0028-cloud-byok-control-plane.md) | $12 topology, Cognito identity, PostgreSQL, vault, relay, settings, site/Playground integration, budget and upgrade gates | Approved; account/auth stage live, 0.7.2 update and write/relay acceptance pending                                                                                     |
| 2     | [LP-26 — Public Playground](rfcs/lp-0026-public-sandbox.md)                                   | Scenario catalog, Control Center/target split, target capabilities, quotas, validation and public UX                      | Approved but requires Lightsail backend amendment from its earlier serverless design                                                                                   |
| 3     | [LP-29 — Cloud session privacy and storage](rfcs/lp-0029-cloud-session-privacy-storage.md)    | Consent, retained fields, PostgreSQL/S3 layout, encryption, retention, deletion and export                                | Approved with edits; encrypted disabled foundation implemented; deletion/export acceptance pending                                                                     |
| 4     | [LP-30 — Portable checkpoint and restore](rfcs/lp-0030-portable-checkpoint-restore.md)        | Environment-neutral checkpoint schema, atomic commit, compatibility, re-grounding and approvals                           | Approved; end-to-end restore implemented and verified behind disabled flags                                                                                            |
| 5     | [LP-31 — Device reconnect and browser commands](rfcs/lp-0031-device-command-protocol.md)      | Device registration, transport, leases, duplicate suppression, cancellation and takeover                                  | Approved with edits; reconnect/takeover, bounded read/text, and locally approved postcondition-verified clicks pass behind disabled flags; activation remains deferred |
| 6     | [LP-32/33 — parked Temporal research](rfcs/lp-0033-isolated-temporal-evaluation.md)           | Preserve the evaluated workflow option without adding an active service or production dependency                          | Parked after shared and isolated resource/latency failures; $7 host deleted                                                                                            |
| 7     | [LP-35 — Hosted browser MCP and supervised remote missions](rfcs/lp-0035-hosted-browser-mcp.md) | Codex supervises semantic plans and evidence while the extension remains browser executor and safety authority | Approved; named-tester read-only delivery/cancellation passed, encrypted progress/result/approval transport and local continuation are implemented, synthetic approval acceptance and hosted MCP remain |

Temporal is no longer an active roadmap phase. Its RFCs, implementation spike,
and gate evidence remain available if a future owner decision reopens it.

LP-34 adds the next disabled milestone: a normalized Chakra UI application under
`/app`, a browser-neutral Viewer, and account-owner-only E2EE trace sync. Its
PostgreSQL/S3 foundation, 30-day retention, 500 MB quota, and extension opt-in
remain named-tester-only with all trace capability flags disabled until the
recovery, deletion, restart, and two-browser acceptance suite passes.

LP-35 hosted activation is sequenced after the `0.7.3` release. The prepared
`0.7.3` source contains disabled foundation code but no operable Codex control
path. The feature-specific
[hosted browser MCP roadmap](hosted-browser-mcp-roadmap.md) controls extension
delivery, hosted MCP/OAuth, parity, localhost deletion, and named-tester rollout.

Chrome Web Store approval and server activation follow the independent
[cloud production activation runbook](cloud-production-activation-runbook.md).
Approval of extension 0.7.2 does not enable session, checkpoint, device-command,
or Temporal capabilities.

## Phase 0 — Reconcile existing work

The worktree contains an early `infra/control-plane` serverless implementation
and a more mature `infra/sandbox` API Gateway/Lambda/DynamoDB implementation.
Neither is the new production topology.

Actions:

- Inventory pure contracts/policies/tests worth retaining.
- Extract provider validation, envelope encryption, safe preference validation,
  Playground reducers/contracts, auth/cookie/CSRF policy, run ownership, quota,
  target-capability, and result-validation logic from AWS handlers.
- Put reusable server modules behind repository/service interfaces with
  PostgreSQL implementations.
- Do not remove the serverless implementations until parity tests pass; then
  remove deployment paths, dependencies, docs, and scripts so there is one
  production backend.
- Preserve unrelated Sandbox/static-site and extension worktree changes.

Exit gate: the [Lightsail Playground parity and retirement audit](lightsail-playground-parity.md)
maps retained security/product behavior to its Lightsail module/test and
identifies every retired AWS resource. Pending evidence remains explicit there.

## Phase 1 — Reproducible $12 host

Provision one 2 vCPU/2 GB/60 GB Lightsail Linux instance in the selected EU
region with an attached static IP.

Deliver:

- Docker Compose or equivalent for Caddy, PostgreSQL, and one modular Node
  service containing API, relay, Playground, and PostgreSQL maintenance modules.
- Only ports 80/443 public; PostgreSQL, metrics, and admin
  endpoints private.
- Non-root containers, read-only filesystems where feasible, explicit memory/
  CPU/log limits, automatic security updates, dependency scanning, health checks
  and bounded restart policy.
- PostgreSQL `opensidebar` database with separate Playground schema/role,
  transactional migrations, durability indexes, and capped pools.
- Daily Lightsail snapshot plus encrypted daily/weekly PostgreSQL dumps to S3;
  restore automation and tested static-IP remap.
- Lightsail/health/budget alerts without request-body logging.

Initial resource limits:

- PostgreSQL shared buffers 128 MiB, work mem 4 MiB, max connections 30.
- OpenSidebar Node heap 256–384 MiB after measurement.
- Three global relay streams, one or two per account.
- 2 GB swap for emergency survival only; ordinary swap use triggers upgrade.
- Disk alerts 60/75/85%; memory alerts 65/75/85% sustained.

Exit gate: recreate the host from a clean instance, restore PostgreSQL, run
the synthetic Playground, relay, and session/device recovery suites, and remain within memory,
disk, and USD 25 budget projections.

## Phase 2 — Unified identity and opensidebar.com shell

Use one Cognito User Pool and owner `sub` across extension, website, and
Playground, while keeping credentials separated by client/surface.

- Extension: authorization-code PKCE public client and revocable device record.
- Website: server-generated opaque, hashed, host-only `__Host-os_session` cookie
  after Cognito Google/email flow; CSRF token for mutations.
- Playground: Cognito email OTP may remain its low-friction entry, but resolves
  to the same account subject and web session model.
- Website and extension never share bearer/refresh tokens. Optional device
  linking uses a short-lived user-confirmed code.
- Add static `/account`, `/settings`, `/sessions`, and `/playground` shells to
  the existing site deployment and route `/api/*` through CloudFront to Caddy.
- Preserve short-cache HTML and immutable hashed asset policy; dynamic API and
  launch routes are no-store.

Exit gate: login/logout/logout-all/delete, CSRF, callback, token expiry,
cross-origin, cookie-leak, session fixation, account enumeration, and device
revocation tests pass. `play.opensidebar.com` never receives the apex cookie.

## Phase 3 — Playground consolidation

Promote the existing `apps/sandbox` product as the public “Playground” without
rebuilding its scenario logic.

- Keep `opensidebar.com/playground` as catalog and private human Control Center.
- Keep `play.opensidebar.com/run/{publicRunId}` as realistic agent-visible target.
- Adopt Chakra UI v3 for the human-facing Playground, account, settings, and
  sessions shell. Define an OpenSidebar `createSystem` theme from the existing
  warm-light tokens and keep reusable compositions in a small web UI package.
- Use TanStack Query for API/server state, Zustand only for small ephemeral UI
  state, React Hook Form for forms, and route/search parameters for navigable
  state. PostgreSQL remains authoritative; do not mirror cloud records into a
  global client store or persist the query cache initially.
- Feed revisioned polling/SSE updates into TanStack Query. Reconnect performs an
  authoritative HTTP refetch; streams are notification accelerators, not state.
- Do not wrap `play.opensidebar.com` targets in the Chakra provider. Target
  scenarios retain independent CSS and fictional-product identities.
- Move run/session/quota/capability persistence from DynamoDB to the Playground
  PostgreSQL schema with equivalent expiry checks, ownership, revisions, CSRF,
  idempotency, and closed projections.
- Route apex and target APIs through CloudFront to the Lightsail origin while
  forwarding only their distinct allowlisted cookies/headers.
- Preserve one-time launch token consumption into a target-only host cookie.
- Keep scenario reducers and final-state validators pure and shared with E2E.
- Add explicit extension linking and “Open in OpenSidebar” handoff, limited to a
  selected synthetic run and natural task text.
- Allow a Playground run to link to a cloud agent session only by opaque IDs;
  session storage cannot read private future control state, and the validator
  receives only the closed terminal result.

Exit gate: LP-26 ownership, quota, expiry, target non-disclosure, scenario,
accessibility, result, and visual tests pass against PostgreSQL/Lightsail. A DOM,
screenshot, tab-title, network, and cookie audit proves private controls and
expected answers are absent from agent-visible targets.
Visual evidence also covers Chakra focus states, keyboard navigation,
desktop/mobile layouts, loading/error/empty states, and opensidebar.com parity.

## Phase 4 — Vault, relay, and preference migration

- Implement KMS envelope-encrypted OpenRouter/Fireworks credentials in
  PostgreSQL; never reveal plaintext.
- Add explicit local-key migration: verify, encrypt/store, confirm status, then
  remove local copy.
- Move provider URL/header/payload translation and streaming parsing behind the
  Lightsail relay; clients cannot select arbitrary upstreams.
- Enforce account/device authorization, concurrency, token/request limits,
  cancellation, timeouts, provider circuit breakers, and kill switch.
- Store no relay content and disable content-bearing access/error logs.
- Sync closed safe preferences with optimistic revision; reject local-safety
  fields and keep current device policy authoritative.

Exit gate: provider parity, migration interruption, credential replacement/
deletion, KMS context, SSRF/header injection, quota, concurrency, abort, stream,
log/bundle/database/backup secret audits, and provider-outage tests pass on the
exact $12 host.

## Phase 5 — LP-29 encrypted cloud sessions

- Store session/checkpoint indexes in PostgreSQL and encrypted immutable
  checkpoint objects in private S3 under a session KMS key.
- Existing sessions remain `local_only`; explicit modes are
  `cloud_checkpointed` and `cloud_archived`.
- Implement revisioned append-only commit, list, inspect, pin, export, retention,
  delete-session, and delete-account jobs.
- Maintenance runs through supervised Node jobs initially; Temporal must not yet
  be required for correctness.
- Daily backups contain ciphertext and metadata only; deletion/backup expiry is
  documented honestly.

Exit gate: LP-29 encryption, cross-account isolation, atomicity, export,
retention, deletion, backup and outage evidence passes.

## Phase 6 — LP-30 portable restore

Status: implemented and verified behind disabled feature flags. See the
[portable checkpoint restore report](portable-checkpoint-restore-report.md).

- Project a closed, bounded, environment-neutral checkpoint rather than
  uploading current Chrome-specific checkpoint objects or raw traces.
- Save locally first, upload/commit cloud second.
- Restore into a new local run/workspace, choose/open a permitted page,
  re-observe, invalidate element references, show changed state, and stay paused
  until explicit Continue.
- Pending or uncertain sensitive actions receive fresh approval and direct
  observation; irreversible outcome-unknown actions are never retried silently.
- Support current and one previous schema; older/newer sessions are read-only/
  exportable.

Exit gate: dual-write parity, corruption/fork/compatibility, worker restart,
navigation, stale page, approval, side-effect uncertainty, and real-browser
restore tests pass.

## Phase 7 — LP-31 reconnect and device handoff

Status: published-client reconnect/takeover UX, bounded read/reversible-text and
locally approved guarded-click dispatch, real
two-profile Chrome, and exact-host PostgreSQL acceptance passed behind disabled
flags. Non-click sensitive browser actions remain deferred. See the
[device reconnect and handoff report](device-reconnect-handoff-report.md).

- Add stable device, connection, lease, command, attempt, and idempotency IDs.
- Begin with authenticated SSE plus HTTPS mutations because it is simpler on one
  Caddy/Node host; measure WebSocket only if bidirectional latency requires it.
- Persist one active execution lease per session in PostgreSQL and a local
  extension attempt journal before browser dispatch.
- Reconnect reconciles journal, command state, lease generation, and checkpoint
  revision. A started action is observed, never blindly repeated.
- Same-device resume first; explicit cross-device takeover later with lease
  generation bump, old-device revocation, re-grounding, and fresh approval.

Exit gate: state-machine/property, crash injection, duplicate delivery,
cancellation, expired lease, revocation, and two-browser-profile takeover tests
prove at most one OpenSidebar dispatch attempt and honest outcome-unknown handling.

## Phase 8 — PostgreSQL durability hardening

Status: implemented and verified behind disabled feature flags. See the
[PostgreSQL durability report](postgres-durability-report.md).

Use PostgreSQL plus supervised Node maintenance as the complete durability path
for the named-tester phase.

- Expire stale leases, connections, idempotency records, upload intents, and
  undispatched commands through indexed, idempotent maintenance statements.
- Never auto-expire or retry `accepted`/`started` commands; reconcile them from
  the extension attempt journal and direct page observation.
- Complete session export/deletion/retention jobs, with S3 deletion ordered so
  PostgreSQL never claims deletion before object cleanup is confirmed.
- Run crash/restart, duplicate-delivery, stuck-operation, checkpoint corruption,
  PostgreSQL backup, isolated restore, and two-profile handoff tests.
- Record maintenance counts, oldest pending age, database size, pool pressure,
  memory/swap, and restore time without logging user content.

Exit gate: the PostgreSQL path passes LP-29 through LP-31 evidence on the exact
$12 host for named testers. Temporal remains parked; reopening it requires a new
owner-stamped RFC. See the retained
[isolated spike report](temporal-isolated-report.md).

## Phase 9 — Named-tester release

Status: staged activation controls are implemented and locally verified but
remain disabled. Global session stages are intersected with a dedicated Cognito
subject allowlist; after configuration reload, allowlist removal is enforced on
the next authenticated request and refresh. No tester has been activated by
this implementation work.

The post-0.7.2 backend and Chakra dashboard deployment is now live with every
session, checkpoint, export, device-command, takeover, and Temporal flag
disabled. Production baseline, CloudFront authenticated-header forwarding,
Playground regression, PostgreSQL durability, isolated restore, and closed-route
evidence are recorded in the
[post-0.7.2 disabled deployment report](post-072-disabled-deployment-report.md).

The first read-only Chakra Control Center slice is also implemented at
`/dashboard`, `/sessions`, and `/dashboard/activation`. It exposes closed
account/session metadata, an operational session timeline, and operator-only
effective activation state. Detailed trace content remains local to the
extension; the website does not download checkpoint bodies or trace payloads.

- Enable only allowlisted accounts initially.
- Publish matching privacy, provider, account/session deletion, backup,
  availability, Playground, Chrome Web Store, and incident-response copy.
- Run synthetic health checks and daily backup verification.
- Review weekly unit metrics: active users, sessions, relay calls/duration/bytes,
  provider errors, checkpoint bytes, PostgreSQL coordination actions/database size,
  memory/swap, disk, restores, and spend.
- Do not log the content behind those counts.

Upgrade from $12 to $24 when any LP-28 resource gate fires. Before unrestricted
public beta, conduct a separate architecture decision for WAF/managed edge,
managed PostgreSQL/high availability, multiple hosts, or Temporal Cloud.

## Phase 10 — Authenticated cloud UX normalization

Status: planned after the 0.7.2 named-tester acceptance sequence. Collect UX
findings during acceptance, then address them as one coherent surface rather
than applying isolated copy and layout patches during security-sensitive gates.

- Present one consistent authenticated shell, identity treatment, navigation,
  spacing, typography, and responsive layout across Account, Dashboard,
  Sessions, Settings, and the Playground Control Center.
- Make signed-in, signed-out, expired, revoked, loading, empty, disabled,
  partially enabled, and error states mutually consistent. Never show a stale
  signed-in identity beside a sign-in-required error.
- Normalize capability language so account authentication, local provider
  availability, encrypted credential storage, preference sync, relay readiness,
  and cloud sessions are visibly distinct instead of appearing as one generic
  “Cloud” state.
- Replace the generic “Add an API key” welcome state when an account is linked
  but cloud credentials or relay are intentionally unavailable. Always explain
  the next available action without implying that sign-in failed.
- Keep destructive and consequential actions explicit: sign out, revoke device,
  remove credential, remove local key, delete session, and delete account must
  have clear scope and confirmation language.
- Validate keyboard navigation, focus, contrast, mobile/desktop layouts, browser
  restart, token expiry, device revocation, partial rollout stages, and account
  deletion with visual and interaction evidence.

Exit gate: a named tester can move between every authenticated surface and
correctly explain current identity, credential location, active inference mode,
enabled capabilities, and the next safe action without contradictory UI state.

## Cost plan

| Component                           | Monthly test target |
| ----------------------------------- | ------------------: |
| Lightsail 2 GB server               |                 $12 |
| snapshots and encrypted DB backups  |                $1–3 |
| two product KMS keys and operations |             $2–2.10 |
| Secrets Manager                     |          $0.80–1.20 |
| S3 checkpoint/export data           |         under $0.25 |
| Cognito under free MAU tier         |                  $0 |
| monitoring/SES/miscellaneous        |                $0–3 |
| isolated telemetry stack            |                $1–3 |
| **Expected total**                  |          **$17–24** |

Budget alerts: USD 10, USD 18, USD 23; ceiling USD 25. No provider inference is
included because BYOK users pay providers directly.

## Cross-cutting acceptance criteria

- One production application backend and one authoritative PostgreSQL migration
  history; no parallel serverless control path after parity.
- Account deletion revokes access immediately and deletes credentials,
  preferences, devices, sessions, checkpoint objects, Playground runs, and any
  separately approved orchestration state within documented windows.
- Backend outage pauses cloud behavior and never bypasses local safety.
- Apex/target cookies and private/public Playground projections never cross.
- Relay content stays non-retained even when the separately consented session
  store is enabled.
- Provider keys and session plaintext appear nowhere in PostgreSQL, backups,
  logs, metrics, errors, orchestration history, telemetry, or client responses.
- Every state mutation is revisioned/idempotent; every browser side effect is
  checked against current lease, checkpoint, page, local policy, and approval.
- Host restoration, database restoration, rollback, and upgrade procedures are
  tested rather than only documented.

## Current state

- LP-28: revised and approved for Lightsail. Its Goal-1 shared-host
  foundation is live: isolated PostgreSQL ownership, bounded Node service,
  Cognito subject identity, CloudFront routing/security headers, encrypted
  backups, restore evidence, timers, quotas, and exact-host load evidence.
- LP-26: amended and approved with edits for Playground on the shared host. The
  standalone Restock control/target/result slice is live and has passed the
  public API smoke. The corrected extension result handoff is present in the
  production `dist`; a reload plus real-agent acceptance smoke remains before
  calling the Playground agent-integrated or retiring the rollback backend.
- LP-29–LP-31: owner-approved PostgreSQL/Lightsail contracts. LP-29 durability
  and LP-30 portable restore are implemented and verified behind disabled
  flags. LP-31 published-client reconnect/takeover UX, paused restore,
  bounded read/reversible-text and locally approved guarded-click handling,
  real two-profile Chrome, and exact-host acceptance pass. Non-click sensitive
  dispatch and staged named-tester activation remain.
- LP-32: bounded exact-host spike complete. Shared-host adoption is rejected by
  reconnect-latency and Playground-isolation evidence; PostgreSQL remains
  authoritative and all Temporal flags remain disabled.
- Post-0.7.2 deployment: the current backend image and Chakra dashboard are live
  behind the existing production origins. Authenticated apex API forwarding was
  corrected and verified. All cloud-session/device/Temporal flags remain false,
  and both the session-tester and operator allowlists remain empty.
- Existing static `opensidebar.com`, `apps/sandbox`, scenario contracts, and
  serverless prototype code are implementation evidence, not permission to keep
  conflicting production architectures.
