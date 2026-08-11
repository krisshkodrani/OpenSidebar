# E2EE trace sync activation runbook

Status: implementation-ready; production capabilities remain disabled.

## Fixed safety boundary

The service receives an authenticated generic index and `.ostrace` ciphertext.
It never receives the recovery key, plaintext bundle, task title, page content,
screenshots, prompts, or model output. PostgreSQL remains authoritative and
Temporal is not involved.

## Provision without activation

1. From an administrator workstation with AWS CLI credentials, run
   `node scripts/provision-trace-sync.mjs` with `AWS_REGION`, `AWS_ACCOUNT_ID`,
   and optionally `TRACE_BUCKET_NAME` set.
2. Grant the Lightsail service identity only `s3:GetObject`, `s3:PutObject`,
   and `s3:DeleteObject` on the printed `v1/accounts/*` object prefix. Do not
   grant bucket-policy, ACL, website, or public-access mutations.
3. Set `TRACE_BUCKET_NAME` on the host. Keep `TRACE_SYNC_ENABLED`,
   `TRACE_UPLOADS_ENABLED`, and `TRACE_DOWNLOADS_ENABLED` false.
4. Deploy the backend and portal. Confirm migration 008, `/health/ready`, and
   that `/api/v1/traces` is unavailable while the parent flag is false.

The S3 35-day lifecycle is defense in depth. The application owns the advertised
30-day retention and deletion state machine. Versioning protects interrupted
operations; lifecycle removes old noncurrent versions after seven days.

## Named-tester activation order

Use the Cognito `sub`, never email, in both `CLOUD_TESTER_SUBJECTS` and
`TRACE_TESTER_SUBJECTS`.

1. Set the one intended subject in `TRACE_TESTER_SUBJECTS`.
2. Enable `TRACE_SYNC_ENABLED` only. Verify list/usage and disabled upload and
   download responses.
3. Enable downloads, then uploads. Never enable a child flag while the parent is
   false and never add an unnamed subject.
4. In the extension, explicitly opt in and save settings. Complete a harmless
   Playground task, observe the 30-second local-only grace period, and test
   pause, resume, retry, and **Keep local only**.
5. Copy the recovery key to a second browser. Verify wrong-key failure first,
   then successful decrypt with the copied key. Restart both browsers and the
   service and repeat the open.
6. Delete a trace while S3 is temporarily unavailable. Restore access, retry,
   and verify both object and metadata disappear. Verify a repeated delete does
   not resurrect or duplicate the object.
7. Confirm PostgreSQL, service logs, backups, and S3 metadata contain no task
   title or trace content. Confirm the target origin receives no account cookie.

## Green-light gates

- All automated crypto, API, extension, typecheck, lint, and production-build
  checks pass on the deploy commit.
- Two-browser recovery and restart pass with the exact published extension.
- Interrupted upload resumes idempotently; interrupted delete is retryable.
- Account isolation and the 500 MB quota fail closed.
- Peak API memory remains below the existing host alert threshold during the
  largest accepted bundle and concurrent relay traffic.
- The owner records the named-tester activation and rollback decision.

Rollback is immediate: disable `TRACE_UPLOADS_ENABLED` first, then downloads,
then the parent capability. Do not delete the bucket or migration during an
incident; retain ciphertext for bounded recovery or user-requested deletion.
