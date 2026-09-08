# Lightsail Playground parity and retirement audit

Status: the standalone Restock vertical slice is live on the shared Lightsail
host. This is implementation evidence, not a serverless-retirement approval or
an agent-integrated public-launch approval.

The comparison is between the retained rollback implementation in
`infra/sandbox` and the intended production implementation in
`apps/cloud-service`. The Lightsail backend is allowed to serve only Restock
until every row needed for broader cutover is proven. The Lambda/API Gateway/
DynamoDB stack remains deployable but must not accept new production runs after
cutover; it is removed only after the rollback drill and broader scenario parity.

| Contract | Lightsail implementation | Automated evidence | Restock cutover |
| --- | --- | --- | --- |
| Cognito authorization code + S256 PKCE and email OTP | `src/app.ts` auth routes and `passwordless-auth.ts`; both resolve to immutable Cognito `sub` | auth contract tests, manual email-OTP login, live subject migration/audit | Live for Restock |
| Opaque hashed account session | `web_sessions`; host-only `__Host-os_session`; Cognito `sub` owner | auth contract test and live database ownership audit | Live for Restock |
| Mutation Origin + double-submit CSRF | authenticated API middleware; separate `os_csrf` hash | production contract tests and public vertical smoke | Live for Restock |
| Account ownership and cross-cookie isolation | account-scoped repositories; target cookie is never accepted by account API | isolation test and public target/control smoke | Live for Restock |
| Scenario catalog | shared versioned contracts; service allowlists Restock creation | invalid-scenario/API tests | Restock only |
| Run create/list/delete | PostgreSQL transaction, filtered listing, hard delete | focused tests and public CloudFront-to-PostgreSQL vertical smoke | Live for Restock |
| Concurrent/daily quota | advisory account lock and transactional daily counter | live four-way contention and 26-request daily-limit smoke | Live for Restock |
| Idempotent creation | hashed account/key record in same transaction as run/quota | vertical-slice replay assertion | Ready locally |
| Revisioned control commands | pure shared reducer plus optimistic revision update | invalid-command/revision test | Ready locally |
| One-use launch capability | hashed, expiring capability consumed atomically | vertical-slice second-consumption `410` | Ready locally |
| Target-only session and closed projection | separate target session relation/cookie and explicit Restock projection | state/action/result non-disclosure assertions | Ready locally |
| Target mutation Origin check | target middleware | wrong-Origin assertion | Ready locally |
| Closed result validation | schema checks plus server-observed cart state | success and false-success tests | Ready locally |
| Expiry and retention | hourly cleanup, expiry checks, hard run deletion | code/type evidence | Clock/real-PostgreSQL cleanup test pending |
| Static target isolation | Vite target entry; deployment copies only its manifest dependency closure | boundary verifier and deployment dry run | Ready locally |
| CloudFront cookie/header isolation | distinct generated/validated origin-request policies and response-header policies | live distribution, cookie, CSP, HSTS, frame, and no-store audits | Live for Restock |
| Backup/restore | age-encrypted dump, private versioned object storage, version-aware pruning, separate-database restore | successful manual backup, offline decrypt, restore, schema/count/owner audit | Goal-1 restore proven; clean replacement-host rehearsal remains |
| Remaining scenario catalog | no Lightsail routes yet | none | Not ready; keep rollback backend |
| Extension handoff/result integration | completion reporter posts the target capability to `/api/v1/target/result` without account state | focused closed-payload test, extension typecheck/build/dist inspection, loaded-production-extension browser smoke | Built locally; reload and real-agent acceptance smoke required before agent-integrated public launch |

## Live evidence — 2026-08-08

- The public Restock sequence passed through CloudFront and the Lightsail API:
  authenticated session, create, two revisioned commands, launch, one-time
  handoff (`302` then `410`), closed target state, target action, accepted
  result, and deletion.
- Passwordless login was confirmed by the owner. The corrected deployment now
  stores the Cognito `sub`; the live audit found zero active email-owned
  sessions and one subject-owned session after migration.
- A 1,200-request authenticated load run at concurrency 20 completed with all
  responses `200`, about 56.6 requests/second, p50 320 ms, p95 616 ms, and no
  OOM or swap growth. The API remained within its 256 MiB container limit.
- Four simultaneous run creations produced exactly three acceptances and one
  concurrency rejection. The first 25 daily creations succeeded and the 26th
  was rejected. Synthetic records were removed afterward.
- A daily PostgreSQL dump was encrypted with the offline age recipient,
  uploaded to the private versioned backup bucket, downloaded, decrypted on the
  operator workstation, and restored into a separate database. Schema, row
  counts, and `playground_service` ownership passed; plaintext and the temporary
  restore database were removed.
- The shared host retained roughly 965 MiB available memory and 45 GiB free
  disk after the tests. API, backup, certificate-renewal, and automatic snapshot
  schedules were active; seven automatic Lightsail snapshots were present.

## Resource retirement inventory

After the final observation window and an owner-approved rollback drill, remove
the `OpenSidebarSandbox` application Lambda, API Gateway routes, DynamoDB table,
Lambda log group, and Lambda-only secret. Retain the Cognito user pool/client,
target S3 bucket, target CloudFront distribution/certificate, and static site
because the Lightsail topology reuses those boundaries. Never remove the LP-25
telemetry stack: it is unrelated and intentionally isolated.

The current evidence does **not** authorize that removal. Broader-scenario
parity, the rollback observation window, a clean replacement-host rehearsal,
structured visual/accessibility evidence, and a real-agent extension acceptance
smoke remain required before serverless retirement or agent-integrated public
launch.
