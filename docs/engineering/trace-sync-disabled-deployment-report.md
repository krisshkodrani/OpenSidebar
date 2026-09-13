# E2EE trace sync disabled deployment report

Date: 2026-08-11

Status: private storage and production code deployed; all trace capabilities remain disabled. Exact-host verification passed. Real two-browser acceptance is pending because the Codex CLI currently exposes no connected browser profiles.

## Storage boundary

- Bucket: `opensidebar-traces-534344665432-eu-central-1` in `eu-central-1`.
- S3 Block Public Access: all four controls enabled.
- Object ownership: bucket-owner enforced; ACLs disabled.
- Encryption at rest: S3-managed AES-256.
- Versioning: enabled.
- Lifecycle below `v1/accounts/`: current objects expire after 35 days, noncurrent versions after seven days, and incomplete multipart uploads after one day.
- The service identity can get bucket location and get, put, or delete objects only below `v1/accounts/*`. It cannot list the bucket or mutate bucket policy, ACL, lifecycle, or public access.
- The bucket and `traces.cloud_traces` table were empty after deployment.

## Production deployment

- Host: Lightsail `playscenario-launch-small` (`small_3_0`), Frankfurt.
- Image: `opensidebar-cloud-service:trace-sync-disabled-20260811`.
- API container: healthy, zero restarts.
- PostgreSQL migration: `traces.schema_migrations` version 8.
- Portal deployment: canonical `/app`, `/app/account`, `/app/settings`, `/app/sessions`, `/app/viewer`, `/app/playground`, `/app/sign-in`, and `/app/internal/activation` routes deployed and invalidated.
- Playground deployment: the target origin received only the target entry's three-file dependency closure.

## Effective trace flags

```text
TRACE_SYNC_ENABLED=false
TRACE_UPLOADS_ENABLED=false
TRACE_DOWNLOADS_ENABLED=false
TRACE_TESTER_SUBJECTS=
TRACE_BUCKET_NAME=opensidebar-traces-534344665432-eu-central-1
```

No trace tester is activated and no browser can upload, list, or download cloud traces.

## Exact-host evidence

- `https://api-origin.opensidebar.com/health/ready`: HTTP 200, `{"status":"ready"}`.
- `https://opensidebar.com/app`, `/app/viewer`, `/app/settings`, and `/app/playground`: HTTP 200 and the same `control-qR50UndR.js` application bundle.
- `https://play.opensidebar.com/`: HTTP 200 and `target-Bq9qVYzu.js`; target HTML contains no Control Center bundle reference.
- Unauthenticated trace requests through both the apex and exact API origin fail closed with HTTP 401.
- Both CloudFront invalidations completed.
- API memory was about 39 MiB of 256 MiB; PostgreSQL about 105 MiB of 768 MiB; host available memory about 992 MiB; root disk 55% used.

## Remaining acceptance gate

The browser-control runtime returned an empty browser list, so no real browser profile is connected to this CLI session. Staged named-tester activation and the required real two-browser wrong-key, recovery-key, restart, upload-resume, and deletion checks were therefore not run. Keep all trace flags disabled until two real profiles are connected and the procedure in `trace-sync-activation-runbook.md` completes. The published 0.7.2 extension also predates this trace-sync client, so the exact-published-extension green-light gate requires a later release containing these changes.
