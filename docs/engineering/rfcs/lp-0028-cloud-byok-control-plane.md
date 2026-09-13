# LP-28: Lightsail cloud control plane, BYOK vault, and model relay

Status: approved for implementation. Owner direction revised 2026-08-07 to use
a $12 Lightsail host, local PostgreSQL, no application Lambda/API Gateway, and
an optional final-phase open-source Temporal spike on the same host.

## Context

OpenSidebar currently stores provider credentials in extension-local storage and
calls model providers directly. Extension storage is origin-isolated from
ordinary third-party extensions, but is not a hardware-backed secret boundary
and cannot protect keys after extension, dependency, profile, or device
compromise.

Moving a credential helps only when it is never returned to the extension. The
backend must therefore vault provider keys and relay model requests. The same
account boundary can support safe preferences, cloud sessions, and the existing
OpenSidebar Playground without paying for a fragmented serverless control plane
at the first-few-users stage.

This reverses the current public promise of no hosted relay. Privacy, onboarding,
provider, Chrome Web Store, incident-response, and deletion copy must change
before production activation.

LP-25 remains authoritative for optional anonymous fleet telemetry. Its public,
content-free ingest pipeline remains serverless and operationally isolated.

## Goals

- Require one OpenSidebar account across extension, `opensidebar.com`, and the
  Playground.
- Store provider credentials as KMS-encrypted ciphertext and never reveal them.
- Relay OpenRouter and Fireworks requests without persisting model content.
- Sync safe preferences while device-local safety settings remain authoritative.
- Run the initial product backend for a few testers within a USD 25 monthly AWS
  budget on one $12 Lightsail server.
- Reuse existing static S3/CloudFront site and Playground assets and preserve the
  separate human-control versus agent-target origins.
- Make later migration to a larger Lightsail instance or managed services an
  operational change, not an extension-protocol rewrite.

## Non-goals

- High availability or a production uptime promise on the $12 topology.
- Hosting provider inference or paying user model charges.
- Moving browser tools, page grounding, agent planning/execution, approvals, or
  site/navigation safety policy out of the extension.
- Storing relay prompts, screenshots, tool data, responses, or reasoning.
- Moving LP-25 telemetry or its Athena source of truth into PostgreSQL.
- Exposing Temporal, PostgreSQL, or an administrative UI to the public internet.

## Target topology

```text
CloudFront opensidebar.com
  static marketing/site assets       -> private S3
  /account, /settings, /playground    -> private S3 application assets
  /api/*                              -> HTTPS Lightsail origin

CloudFront play.opensidebar.com
  scenario target assets             -> private S3
  /launch/*, /api/playground/target/* -> HTTPS Lightsail origin

$12 Lightsail instance (2 vCPU, 2 GB RAM, 60 GB SSD, 3 TB transfer)
  Caddy
    -> OpenSidebar Node service
         account/control API
         credential vault
         safe preference API
         streaming LLM relay
         session/checkpoint API
         Playground API
         Temporal worker (Phase 8 only)
    -> open-source Temporal Server (Phase 8 only, if spike passes)
    -> PostgreSQL

AWS managed boundaries retained
  Cognito     identity and token issuance
  KMS         provider/session encryption keys
  S3          encrypted checkpoints, exports, static assets, backups
  CloudFront  TLS/static delivery/origin routing
  SES         Cognito email delivery
  LP-25 stack telemetry only
```

No application Lambda, API Gateway, DynamoDB, ECS, RDS, NAT Gateway, or Temporal
Cloud is used in the initial topology. Existing control-plane/serverless code is
treated as spike code and removed or archived after equivalent Lightsail tests
pass. Existing Sandbox DynamoDB records need no production migration because the
Sandbox is not yet a public production system; synthetic development runs may be
discarded deliberately.

## Public hosts and origin separation

| Host/path                                      | Role                                          | Origin                                     |
| ---------------------------------------------- | --------------------------------------------- | ------------------------------------------ |
| `opensidebar.com/*`                            | Marketing and documentation                   | Existing private S3                        |
| `opensidebar.com/account*`                     | Account, devices, credentials, cloud sessions | S3 application shell                       |
| `opensidebar.com/playground*`                  | Playground catalog and human Control Center   | `apps/sandbox` assets in private S3        |
| `opensidebar.com/api/*`                        | Authenticated product and Playground APIs     | Lightsail through CloudFront custom origin |
| `play.opensidebar.com/run/*`                   | Agent-visible synthetic target                | Separate private S3 distribution           |
| `play.opensidebar.com/launch/*`                | One-time target handoff                       | Lightsail origin, no cache                 |
| `play.opensidebar.com/api/playground/target/*` | Bounded target state/actions                  | Lightsail origin, no cache                 |

The human account cookie is `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and
host-only with a `__Host-` prefix. It is never sent to `play.opensidebar.com`.
The target receives a distinct short-lived host-only capability after consuming
a one-time launch token. Target responses never disclose private controls,
future scheduled values, expected results, account identity, credentials, cloud
sessions, or provider configuration.

CloudFront forwards only the allowlisted methods, cookies, CSRF header, origin,
and required query fields for each dynamic behavior; caching is disabled. It
never forwards the public viewer `Host` as the Lightsail upstream Host unless
Caddy is explicitly configured for it. API responses use `Cache-Control:
no-store`.

## Identity and sessions

Use one Cognito User Pool for extension and website identities:

- Google federation plus email fallback for the main product account;
- Cognito-native email OTP for the low-friction Playground journey where
  supported by the selected tier;
- one public PKCE app client for the extension;
- one public authorization-code/PKCE web client or backend-mediated OTP flow for
  `opensidebar.com`;
- one Cognito `sub` as the durable owner key across product and Playground.

The extension holds short-lived access tokens and the minimum revocable refresh
material required for persistent sign-in. The website uses a server-generated
opaque session cookie whose hash and Cognito subject are stored in PostgreSQL.
The website never exposes Cognito refresh tokens to JavaScript. Logging out a
device revokes the local session and registered device; logout-all increments an
account session epoch and invokes Cognito revocation where supported.

The extension and website do not share bearer/session tokens. They share account
identity through Cognito and may show a short-lived user-confirmed linking code
when the website needs to associate an installed extension device.

## PostgreSQL layout

One PostgreSQL process serves separate databases and roles:

```text
temporal database, owner temporal_service (created for the Phase-8 spike only)
  Temporal persistence and visibility tables only

opensidebar database, owner opensidebar_service
  accounts                 account lifecycle/session epoch
  web_sessions             opaque token hash, CSRF, expiry, revocation
  devices                  extension installations and revocation
  preferences              safe settings plus optimistic revision
  encrypted_credentials    ciphertext, wrapped DEK, provider, verification
  sessions                 cloud-session metadata/read model
  checkpoint_index         immutable S3 references and revisions
  leases                   one active execution device per session
  commands                 LP-31 lifecycle metadata
  command_idempotency      bounded mutation deduplication
  quota_counters           account/provider/day or month counters
  deletion_jobs            idempotent resource cleanup

playground schema, owner playground_service
  auth_challenges          bounded OTP wrapper metadata
  playground_sessions      website session relation
  runs                     scenario state, revision, expiry, owner
  run_events               bounded state-change timeline
  target_capabilities      hashed one-time/target tokens and expiry
  playground_quotas        per-account/email/IP coarse counters
```

Roles cannot read each other's private tables except through reviewed views or
service functions. Temporal cannot read OpenSidebar/Playground tables directly;
Activities call application modules through typed interfaces. PostgreSQL listens
only on loopback/container networking and never on the public interface.

Use transactional migrations, schema-version recording, connection pools capped
for 2 GB RAM, WAL/checkpoint tuning appropriate for the disk, autovacuum, and
daily encrypted logical backups to S3. Provider keys and checkpoint bodies never
enter PostgreSQL plaintext.

## Credential vault

Initially support OpenRouter and Fireworks.

1. User explicitly submits a credential over HTTPS after authentication.
2. Backend normalizes size/format and verifies it against the allowlisted
   provider endpoint with a ten-second timeout.
3. Backend asks KMS for a fresh 256-bit data key bound to account, provider, and
   purpose.
4. It encrypts the credential with AES-256-GCM and stores ciphertext, wrapped
   data key, nonce/tag, fingerprint suffix, and verification time.
5. It zeroes plaintext key buffers where the runtime permits.
6. APIs return only `CredentialStatus`; there is no reveal/download path.

The relay decrypts only for an authorized request. A short process-memory cache
may avoid one KMS call per model request only after a security review; cache keys
are account/provider scoped, values expire within five minutes, deletion/revoke
invalidates them, and no cache is persisted.

Existing local credentials migrate explicitly one at a time: upload, verify,
encrypt/store, read status, then delete the local copy. Any failure retains the
local key. Automatic upload is forbidden.

## LLM relay

The extension sends a closed `RelayRequestV1`: provider, reviewed model catalog
ID, messages/tools, generation controls, request/idempotency ID, and abort scope.
It cannot provide arbitrary URL, path, header, or credential.

The Node service:

- validates Cognito subject, device, payload cap, provider/model allowlist,
  concurrent streams, and monthly request/token quota;
- decrypts the credential and constructs the provider-specific request;
- streams OpenAI-compatible output through Caddy to the extension;
- forwards client cancellation upstream;
- records only coarse provider/model catalog ID, status class, token counts,
  latency bucket, and quota totals;
- never persists or logs prompt, screenshot, messages, tool schema/results,
  response, reasoning, Authorization header, or credential.

Initial limits on the $12 host:

- three concurrent model streams globally;
- one or two streams per account;
- 8 MiB request and response-stream caps unless measured otherwise;
- 15-minute hard stream timeout and shorter provider idle timeout;
- hard account request/token ceilings with no subscription billing;
- provider circuit breaker and independent relay kill switch.

The user remains responsible for provider costs through BYOK.

## Settings split

Cloud-safe preferences include provider/model choices, `maxTurns`, theme,
metrics/detail display, built-in skill toggles, lane topology, temperature,
perception/image budget, Nitro, and presence preferences. They use a closed
schema and optimistic revision/ETag.

Device-local settings include approvals, plan confirmation, navigation/site
policy, allowed origins, Chrome permissions, notification permission, telemetry
consent, local traces, active browser state, and authentication tokens. Remote
JSON containing a local-safety field is rejected rather than ignored. Current
local safety settings always win.

Provider credentials are vault records, not settings.

## Site and Playground integration

- Add Account, Devices, Provider Keys, Preferences, Sessions, and Playground
  entry points to `opensidebar.com` while keeping marketing pages static.
- Reuse `apps/sandbox` as the Playground application rather than creating a
  competing app. The product-facing name becomes “Playground”; internal package
  names may migrate mechanically after behavior stabilizes.
- Preserve LP-26's Control Center/target separation and state-based validators.
- Playground runs use synthetic state only and cannot read a user's cloud agent
  session, provider key, relay payload, ordinary browsing history, or raw trace.
- A user may explicitly start an OpenSidebar cloud session from a Playground run;
  the link stores only `playgroundRunId` in the encrypted session checkpoint and
  gives the run validator only a closed terminal result.
- Website-to-extension integration is a trusted-origin, user-gesture handshake
  limited to install/version detection, device linking, sidepanel open request
  if Chrome permits, and explicit task/session handoff. It cannot start a task,
  reveal settings/keys, or grant browser permission silently.
- The Playground can exercise login, relay, sessions, checkpoints, reconnect,
  restore, and later Temporal workflows using safe synthetic targets, making it
  the product-quality integration environment rather than a hidden fixture.

LP-26 remains the authority for scenario design, quotas, target capabilities,
fair result validation, and visual behavior; it must be amended from Lambda/
DynamoDB/API Gateway to this shared Lightsail/PostgreSQL origin before hosted
implementation continues.

## Server deployment and resource budget

Run Docker Compose or equivalent supervised services:

```text
caddy
postgres
temporal
opensidebar-service  (API + relay + Temporal worker in one Node process first)
backup/maintenance jobs
```

Target memory:

| Component                  |       Target RSS |
| -------------------------- | ---------------: |
| OS and daemon overhead     |      200–300 MiB |
| PostgreSQL                 |      300–450 MiB |
| Temporal Server            |      600–900 MiB |
| OpenSidebar Node process   |      250–450 MiB |
| Caddy                      |        30–80 MiB |
| Required ordinary headroom | at least 200 MiB |

Configure PostgreSQL approximately with 128 MiB shared buffers, 4 MiB work mem,
30 maximum connections, and bounded application pools. Cap Node heap at a
measured 256–384 MiB, disable Temporal UI ordinarily, use 2 GB emergency swap
only, and prevent Docker image/log accumulation.

Disk budget on 60 GB: 10 GB system/images, 15 GB PostgreSQL, 10 GB Temporal
history, 2 GB logs, 2 GB temporary work, and at least 20 GB safety/upgrade
headroom. Alert at 60/75/85% disk and 65/75/85% sustained memory.

## Backup, recovery, and availability

- Daily encrypted `pg_dump` for both databases to private S3; retain seven daily
  and four weekly backups.
- Daily Lightsail snapshots; retention sized to the USD 25 budget.
- Test database-only and full-instance restoration before external beta and
  quarterly thereafter.
- Static IP remains attached and can be remapped to a replacement instance.
- Infrastructure/configuration is reproducible from repo scripts; secrets are
  restored from Secrets Manager/parameters, not baked into snapshots.

This is single-node infrastructure. On host failure, account APIs, relay,
Temporal, PostgreSQL, and Playground dynamic state are unavailable. The
extension pauses cloud sessions, keeps local safety/state, issues no cloud
command, and reconciles its journal/checkpoint after recovery. Product copy for
the testing phase must not claim high availability.

Upgrade to the $24 4 GB plan when ordinary memory exceeds 75%, swap is used,
more than three concurrent streams are required, PostgreSQL connections queue,
Temporal task latency breaches the measured SLO, disk exceeds 60% after cleanup,
or the beta exceeds roughly 20 active testers. Split PostgreSQL/Temporal/relay
only after measurement identifies the first bottleneck.

## Security and operations

- Public firewall exposes 80/443 only; SSH is IP-restricted or tunnelled.
- Caddy enforces TLS, body limits, timeouts, security headers, origin routing,
  and coarse IP rate limits; application enforces account/device quotas.
- PostgreSQL and Temporal gRPC/UI bind privately. No public administrative UI.
- Services run as distinct non-root identities with read-only images/filesystems
  where practical and minimum Linux capabilities.
- Automatic security updates, container dependency scanning, secret rotation,
  database migration rollback, health checks, process restart limits, and
  content-free alerts are required.
- No WAF is required for the private test phase. Add CloudFront AWS WAF or move
  public APIs behind a stronger managed edge when opening an unrestricted beta.
- Emergency flags independently disable login/email, credential writes, relay,
  session writes/restores, Playground run creation, and Temporal command issue.

## Cost ceiling

For a few users:

| Item                                | Monthly target |
| ----------------------------------- | -------------: |
| $12 Lightsail instance              |            $12 |
| snapshots and S3 PostgreSQL backups |           $1–3 |
| two product KMS keys/requests       |        $2–2.10 |
| Secrets Manager                     |     $0.80–1.20 |
| S3 checkpoints/exports              |    under $0.25 |
| Cognito under free MAU allowance    |             $0 |
| monitoring/email/miscellaneous      |           $0–3 |
| separate LP-25 telemetry            |           $1–3 |
| **Expected total**                  |     **$17–24** |

Set a USD 25 monthly budget with alerts at USD 10, 18, and 23. Provider inference
is charged to user BYOK accounts and excluded.

## Rollout

1. Local Compose with synthetic identities/providers and existing Playground.
2. Provision Lightsail, DNS/origin TLS, KMS/S3/Cognito, PostgreSQL migrations,
   backups, and health/budget alerts.
3. Internal website/extension account linking and Playground state migration.
4. OpenRouter/Fireworks credential migration and relay parity.
5. Safe preferences, LP-29 sessions, LP-30 restore, LP-31 reconnect.
6. Open-source Temporal integration only after LP-29–31 contracts pass locally.
7. A few named testers under concurrency and spend caps.
8. Upgrade/re-architecture review before unrestricted beta.

Rollback routes CloudFront API behaviors to a maintenance response, disables
new cloud operations, preserves delete/export paths where safe, and leaves local
extension behavior available. Provider keys remain encrypted and never fall back
to cloud-to-extension revelation.

## Verification

- Cross-account, cookie, CSRF, target-capability, device, quota, and origin tests.
- Credential encrypt/decrypt/replace/delete and proof no API returns plaintext.
- OpenRouter/Fireworks streaming parity, abort, quota, timeout, and concurrency
  tests on the 2 GB host.
- Forbidden-content scans over PostgreSQL, S3 metadata, logs, errors, backups,
  Temporal history, and bundles.
- Cloud preference tests prove remote state cannot weaken local safety policy.
- CloudFront tests prove apex cookies never reach `play.opensidebar.com` and API
  responses are not cached.
- Playground state/result tests remain deterministic and cannot access product
  account secrets/session content.
- Worker/host/database kill and restore drills preserve previous checkpoints and
  never duplicate a sensitive browser action.
- Sustained memory/disk/CPU/concurrent-stream test on the exact $12 bundle.
- Privacy, provider, onboarding, account deletion, site/Playground, Chrome Web
  Store, backup/retention, and incident-response documentation reviewed together.

## Decision

Status: Approved

Chosen path:

- Replace the planned serverless application control plane with one $12
  Lightsail host running Caddy, the modular OpenSidebar Node service, and local
  PostgreSQL. Reserve capacity and deployment boundaries for open-source
  Temporal, but add it only at the final LP-32 spike/adoption phase.
- Retain Cognito, KMS, S3, CloudFront/Route 53/ACM, SES, and the isolated LP-25
  telemetry stack as managed AWS boundaries; use no application Lambda, API
  Gateway, DynamoDB, ECS, RDS, NAT Gateway, or Temporal Cloud initially.
- Unify extension, `opensidebar.com`, and Playground ownership through one
  Cognito subject while preserving separate extension tokens, apex web sessions,
  and target capabilities.
- Integrate `apps/sandbox` as the public Playground and preserve
  `play.opensidebar.com` as a structurally isolated agent-visible origin.
- Operate under a USD 25 testing budget and upgrade from the $12 bundle at the
  explicit resource/usage gates in this RFC.
- Deliver Milestone 2 as one allowlisted cloud-BYOK slice: pinned extension
  identity, direct Cognito PKCE, revocable device sessions, OpenRouter and
  Fireworks KMS vault/relay, explicit local-key activation, revisioned safe
  preferences, and Chakra account/settings routes on `opensidebar.com`.
- Use a dedicated least-privilege Lightsail IAM access key for the credential
  KMS key during testing, and enforce 2,000 relay requests plus 10 million
  tokens per account per UTC month.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Re-evaluate managed PostgreSQL, a larger/multiple host deployment, or Temporal
  Cloud after measured tester load and recovery experience.
- Evaluate client-side end-to-end checkpoint encryption separately.
- LP-26 is amended, the exact Frankfurt/shared-host deployment is recorded, and
  the parity audit governs retirement of `infra/control-plane`.
- Implement whole-account deletion with the LP-29 cloud-session lifecycle;
  Milestone 2 must still support credential deletion, device revocation, and
  logout-all.

Do not do:

- Do not expose PostgreSQL, Temporal, administration, credentials, or target
  private controls publicly.
- Do not upload local keys/sessions automatically, return provider keys, retain
  relay content, or let cloud state weaken device-local safety.
- Do not merge the Playground target origin/cookie with the human Control Center.
- Do not move LP-25 telemetry into account/session/PostgreSQL data or link it to
  identities.
- Do not describe the single-node test topology as highly available.
- Do not silently fall back from cloud relay to a retained/local key, sync
  device-local safety fields, or enable non-allowlisted accounts.

Evidence required before merge:

- PKCE/device-token rotation and revocation tests; cross-account and exact-origin
  authorization; credential encrypt/decrypt/replace/delete and plaintext
  absence audits; OpenRouter/Fireworks streaming, abort, quota, timeout, and
  concurrency parity; safe-preference conflict/safety-field tests; exact-host
  resource evidence; encrypted backup/restore; browser migration evidence; and
  matching privacy/provider/store copy.

Next action:

- Implement

## Implementation status (2026-08-08)

The Milestone 2 application slice is implemented locally behind default-off
feature flags. It includes Cognito PKCE and website link-code authentication,
revocable rotating device sessions, the KMS envelope-encrypted OpenRouter and
Fireworks credential vault, the non-retaining streaming relay with quotas and
cancellation, revisioned safe-preference sync, explicit two-stage local-key
migration, and Chakra account/settings UI. Infrastructure scripts provision the
separate PostgreSQL role/database, least-privilege KMS identity, exact Cognito
extension callback, and CloudFront origin policy.

Focused authentication, vault, relay, API, policy, and extension tests pass
locally. Privacy and website copy describe both local/direct and optional cloud
modes. The cloud feature flags remain disabled in production.

The published Chrome Web Store identity is
`hakbnbbkiehiofnafdkcibbnkbdmjiha`. Its exact Cognito callback and dedicated
public PKCE client were provisioned on 2026-08-08. Web Store updates retain the
published identity without a source-manifest key. The KMS key, least-privilege
host identity, isolated PostgreSQL control role/schema, and Milestone 2 image are
live on the shared Lightsail host. The Chakra account/settings bundle is live;
the allowlisted backend is at the `auth` rollout stage, with credential writes,
preference writes, and relay still disabled. Playground regression checks pass
after the control-router isolation fix. The `0.7.2` Web Store update artifact
contains the exact Cognito configuration and passes local preflight.

Remaining activation work is the Web Store dashboard upload/privacy-copy update,
published-extension migration smoke, credential verification, encrypted
backup/restore and exact-host resource evidence, then staged credential,
preference, and relay enablement with a real provider-stream acceptance test.
This remains an allowlisted test slice, not general availability.
