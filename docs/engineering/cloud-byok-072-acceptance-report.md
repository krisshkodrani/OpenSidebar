# Cloud BYOK 0.7.2 acceptance report

Date started: 2026-08-11

Status: deployed for one named tester. Gates 1 and 2 pass in the published
extension, and the real Cloud relay path passes. The two-profile preference UX
exercise, relay failure/cancellation matrix, and 24-hour soak remain before any
allowlist expansion.

## Invariants

- Chrome Web Store item: `hakbnbbkiehiofnafdkcibbnkbdmjiha`, version `0.7.2`
- Named general cloud testers: one Cognito subject
- Cloud-session tester subjects: zero
- Cloud-session, checkpoint, export, device-command, takeover, and Temporal
  capabilities remain disabled throughout this acceptance sequence.

## Gate 1 — authentication

Server-side evidence passes:

- Cognito pool `OpenSidebar` has deletion protection enabled and one estimated user.
- The public `OpenSidebarExtension` client uses authorization-code flow with
  `openid email`, token revocation, user-enumeration protection, no client secret,
  and the exact published extension callback.
- The built 0.7.2 bundle pins `https://opensidebar.com` and contains the account
  link-code flow. Direct extension sign-in is intentionally unavailable in this
  client.
- Authenticated access and refresh-token rotation returned HTTP 200 through the
  apex CloudFront route.
- Reusing the old refresh token returned 401 `refresh_reused` and revoked the
  rotated token family.
- Device revocation returned 204 and the revoked access token subsequently
  returned 401.
- A valid synthetic session for an unallowlisted account returned 403
  `cloud_access_not_enabled`.
- Synthetic database records were removed after the probe.

Real-client evidence passes:

- The published 0.7.2 extension linked through a website code and displayed the
  expected account identity.
- Chrome restart preserved authentication; explicit sign-out and relink passed.
- Website device revocation was enforced on the extension's next request, and
  a new link restored access.
- Local-mode execution remained independent throughout authentication changes.

## Gate 2 — credential verification and activation

- One OpenRouter credential verified and was stored with a complete encryption
  envelope; account APIs and UI exposed only status and fingerprint metadata.
- Chrome and API restarts preserved the cloud record while Local mode continued
  to execute successfully.
- Deleting the cloud copy left Local execution working; re-verification then
  restored one encrypted cloud record.
- The first explicit Cloud activation save returned `revision_conflict`. This
  exposed a PostgreSQL repository defect: an `INSERT ... SELECT WHERE expected=0`
  prevented the `ON CONFLICT` update path from running for later revisions.
- The repository now uses one atomic update-or-insert CTE. Local tests,
  typechecking, build, isolated image smoke, and a rollback-only PostgreSQL
  create/update/stale-write regression passed. Image
  `opensidebar-cloud-service:preference-revision-fix-20260811` was deployed and
  verified with relay and every session/device/Temporal flag disabled before
  relay activation.
- Explicit activation advanced the stored preference to revision 2 with Cloud
  inference selected. After restart, the UI showed the verified cloud
  credential, Cloud-mode connection copy, and empty local key field.
- The post-activation task correctly reached the disabled relay, but its larger
  automatic retry exposed a proxy mismatch: nginx retained a 64 KiB global
  request limit while the application contract permits 8 MiB relay requests.
  The proxy now applies 8 MiB only to the relay route and 10 MiB only to future
  checkpoint intents, retaining 64 KiB elsewhere. Configuration validation,
  reload, and content-free 128 KiB route probes passed (`401` at the
  unauthenticated relay boundary versus `413` on a regular API route).

## Later gates

- Gate 3: repository create/update/stale-write behavior passes; the real
  two-profile import UX exercise is deferred and remains required before
  allowlist expansion.
- Gate 4: the published extension completed a real OpenRouter Cloud task. The
  aggregate audit recorded three completed model calls, zero active/failed
  calls, coarse token accounting, and zero content-bearing columns in relay
  persistence.
- Gate 5: 24-hour internal soak and owner limited-beta decision.

The owner chose to continue the single-tester relay deployment while deferring
the second-profile UX exercise. That exception does not authorize allowlist
expansion; Gate 3's real two-profile exercise remains required before expansion.

## Relay hardening evidence

- Automated relay coverage passes streaming and usage accounting, duplicate
  request rejection, request and token quotas, per-account concurrency, hard
  and idle cancellation, response-size enforcement, circuit breaking, and
  provider 401, 429, and 5xx terminal accounting.
- Application tests prove the relay retains its dedicated 8 MiB request limit
  while regular API routes remain capped at 64 KiB. Production nginx probes
  independently prove the same route separation.
- Cloud mode uses only the relay sentinel. Explicit Local mode requires a local
  provider key and never retains that sentinel, preventing silent local
  fallback from a failed Cloud request.
- The next extension package explicitly calls the authenticated relay cancel
  endpoint when its abort signal fires and has a regression test proving it
  never contacts a provider directly. Published 0.7.2 continues to cancel its
  relay fetch through the browser signal; the explicit endpoint call cannot be
  retrofitted into an already-published package.
- API restart recovery now transitions only `active` relay records older than
  the 15-minute hard timeout to terminal `failed/interrupted`. The 16-minute
  cutoff prevents candidate or overlapping instances from corrupting current
  streams; a one-minute maintenance pass bounds recovery after the cutoff.
- Image `opensidebar-cloud-service:relay-hardening-20260811` passed checksum,
  isolated candidate smoke, readiness, and deployment rollback guards. A live
  restart drill converted one temporary 20-minute-old metadata-only request to
  `failed/interrupted`; the probe row was then deleted.
- Post-drill production evidence: API healthy, zero OOM/restart failures, three
  completed real model calls, zero active or failed real calls, zero forbidden
  content-bearing relay columns, zero recent credential/authorization-header
  log patterns, and all session/device/Temporal flags disabled.

## Remaining 24-hour soak requirements

- Keep the allowlist at the single named tester and sample request terminal
  states, quota totals, memory, swap activity, disk, container health, and
  neighbor service health through at least 24 hours.
- Perform one real user cancellation with the published client and confirm the
  request becomes terminal rather than remaining active after the timeout.
- Exercise explicit Cloud-to-Local switching with a newly entered local key;
  confirm a disabled or failed relay never silently selects that key.
- Run the two-profile preference import and stale-edit UX exercise.
- Re-run privacy canary scans, encrypted backup/isolated restore evidence, and
  device revocation before an owner decision to expand the allowlist.

## UX findings queued for Phase 10

- After website device revocation, the server correctly rejects the next
  request but 0.7.2 keeps rendering the cached signed-in identity beside the
  sign-in-required error.
- The generic welcome message asks for an API key even when the account is
  linked, without distinguishing Local provider readiness, encrypted cloud
  credential state, and relay availability.
- The authenticated website surfaces need one normalized shell and consistent
  signed-in/loading/empty/error/disabled states.
